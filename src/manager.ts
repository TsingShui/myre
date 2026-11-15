import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { unzipSync } from "fflate";
import { GitHub, type Fetcher, type Release } from "./releases";
import {
  validateBinaryPath,
  validateIdentity,
  type AssetSelection,
  type Platform,
  type ToolDefinition,
  type ToolIdentity,
} from "./tools";

interface Receipt {
  schema: 1;
  tool: string;
  command: string;
  repository: string;
  tag: string;
  asset?: string;
  installedAt: string;
  description?: string;
}

interface Installation {
  receipt: Receipt;
  executable: string;
}

export interface ToolRow {
  name: string;
  description: string;
  status: "installed" | "not-installed" | "broken";
  version?: string;
  path?: string;
  error?: string;
}

export interface ManagerOptions {
  dataDir?: string;
  binDir?: string;
  fetcher?: Fetcher;
  platform?: Platform;
  log?: (message: string) => void;
  confirm?: (message: string) => Promise<boolean>;
}

async function inspect(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateEntry(selection: AssetSelection): string {
  return validateBinaryPath(selection.binaryPath ?? "");
}

function displaySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

async function downloadWithProgress(
  response: Response,
  path: string,
  length: string | null,
): Promise<void> {
  if (
    length !== null &&
    (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
  ) {
    await response.body?.cancel();
    throw new Error("Invalid download Content-Length.");
  }
  const total = length === null ? undefined : Number(length);
  if (!process.stderr.isTTY || !response.body) {
    await Bun.write(path, response);
    return;
  }
  let received = 0;
  let lastUpdate = 0;
  const show = () => {
    const progress =
      total && total > 0
        ? `${Math.min(100, (received / total) * 100).toFixed(1)}% (${displaySize(received)} / ${displaySize(total)})`
        : displaySize(received);
    process.stderr.write(`\r\x1b[2KDownloading: ${progress}`);
  };
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (Date.now() - lastUpdate >= 100) {
          show();
          lastUpdate = Date.now();
        }
        controller.enqueue(chunk);
      },
    }),
  );
  show();
  try {
    await Bun.write(path, new Response(body));
    show();
  } finally {
    process.stderr.write("\n");
  }
}

async function extract(
  archive: string,
  output: string,
  selection: AssetSelection,
): Promise<void> {
  if (selection.format === "binary") {
    await copyFile(archive, output);
    return;
  }
  const entry = validateEntry(selection);
  const data = await Bun.file(archive).bytes();
  if (selection.format === "tar.gz") {
    const files = await new Bun.Archive(data).files(entry);
    const file = files.get(entry);
    if (!file) throw new Error(`Archive entry not found: ${entry}`);
    await Bun.write(output, file);
    return;
  }
  const files = unzipSync(data, {
    filter: (file) => file.name === entry,
  });
  const file = Object.hasOwn(files, entry) ? files[entry] : undefined;
  if (!file) throw new Error(`Archive entry not found: ${entry}`);
  // Write only the selected bytes, never archive paths or links.
  await Bun.write(output, file);
}

export class ToolManager {
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly github: GitHub;
  private readonly dataDir: string;
  private readonly binDir: string;
  private readonly platform: Platform;
  private readonly log: (message: string) => void;
  private readonly confirm: (message: string) => Promise<boolean>;

  constructor(
    definitions: readonly ToolDefinition[],
    options: ManagerOptions = {},
  ) {
    this.platform = options.platform ?? {
      os: process.platform,
      arch: process.arch,
    };
    const commands = new Set<string>();
    for (const tool of definitions) {
      validateIdentity(tool);
      const command = this.command(tool);
      const commandKey = this.windows ? command.toLowerCase() : command;
      if (this.definitions.has(tool.name) || commands.has(commandKey))
        throw new Error(`Duplicate tool name or command: ${tool.name}`);
      this.definitions.set(tool.name, tool);
      commands.add(commandKey);
    }
    this.dataDir = resolve(
      options.dataDir ?? process.env.MYRE_HOME ?? join(homedir(), ".myre"),
    );
    this.binDir = resolve(
      options.binDir ??
        process.env.MYRE_BIN_DIR ??
        join(homedir(), ".local/bin"),
    );
    this.github = new GitHub(options.fetcher);
    this.log = options.log ?? console.log;
    this.confirm = options.confirm ?? (async () => false);
  }

  private tool(name: string): ToolDefinition {
    const tool = this.definitions.get(name);
    if (!tool)
      throw new Error(
        `Unsupported tool: ${name}. Run myre list to view supported tools.`,
      );
    return tool;
  }

  private root(tool: Pick<ToolIdentity, "name">): string {
    return join(this.dataDir, "tools", tool.name);
  }

  private get windows(): boolean {
    return this.platform.os === "win32";
  }

  private command(tool: ToolIdentity): string {
    const name = tool.command ?? tool.name;
    return this.windows && !name.toLowerCase().endsWith(".exe")
      ? `${name}.exe`
      : name;
  }

  private bin(tool: ToolIdentity): string {
    return join(this.binDir, this.command(tool));
  }

  private current(tool: Pick<ToolIdentity, "name">): string {
    return join(this.root(tool), this.windows ? "current.exe" : "current");
  }

  private activeExecutable(tool: ToolIdentity): string {
    return this.windows
      ? this.current(tool)
      : join(this.current(tool), this.command(tool));
  }

  private samePath(left: string, right: string): boolean {
    return this.windows
      ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
      : resolve(left) === resolve(right);
  }

  private async executableExists(path: string): Promise<boolean> {
    const file = await inspect(path);
    return !!file?.isFile() && (this.windows || (file.mode & 0o111) !== 0);
  }

  private async createLink(
    target: string,
    path: string,
    type: "file" | "dir",
  ): Promise<void> {
    try {
      await symlink(target, path, type);
    } catch (error) {
      if (this.windows && (error as NodeJS.ErrnoException).code === "EPERM") {
        throw new Error(
          "Windows symbolic links require Developer Mode or symbolic-link privileges.",
        );
      }
      throw error;
    }
  }

  private async installation(
    tool: Pick<ToolIdentity, "name">,
  ): Promise<Installation | null> {
    const root = this.root(tool);
    const current = this.current(tool);
    const info = await inspect(current);
    if (!info) return null;
    if (!info.isSymbolicLink())
      throw new Error(`Not a myre-managed version link: ${current}`);
    const target = resolve(root, await readlink(current));
    const directory = this.windows ? dirname(target) : target;
    if (
      !this.samePath(dirname(directory), join(root, "versions")) ||
      !(await inspect(directory))?.isDirectory() ||
      !(await inspect(join(root, "versions")))?.isDirectory()
    ) {
      throw new Error(`Invalid installation directory: ${current}`);
    }
    const receipt = await this.receipt(tool.name, directory);
    if (
      this.windows &&
      !this.samePath(target, join(directory, receipt.command))
    )
      throw new Error(`Invalid executable link: ${current}`);
    return { receipt, executable: join(directory, receipt.command) };
  }

  private async receipt(name: string, directory: string): Promise<Receipt> {
    let value: unknown;
    try {
      value = JSON.parse(
        await readFile(join(directory, "receipt.json"), "utf8"),
      );
    } catch {
      throw new Error(
        `Cannot read installation record: ${directory}/receipt.json`,
      );
    }
    const receipt = value as Partial<Receipt> | null;
    if (
      !receipt ||
      receipt.schema !== 1 ||
      receipt.tool !== name ||
      typeof receipt.command !== "string" ||
      typeof receipt.repository !== "string" ||
      typeof receipt.tag !== "string" ||
      !receipt.tag ||
      typeof receipt.installedAt !== "string" ||
      (receipt.description !== undefined &&
        typeof receipt.description !== "string")
    )
      throw new Error(`Invalid installation record: ${name}`);
    validateIdentity({
      name,
      command: receipt.command,
      repository: receipt.repository,
    });
    return receipt as Receipt;
  }

  private assertOwnership(tool: ToolIdentity, receipt: Receipt): void {
    if (
      receipt.command !== this.command(tool) ||
      receipt.repository !== tool.repository
    )
      throw new Error(
        `Catalog ownership changed for ${tool.name}; uninstall the existing installation before installing its new definition.`,
      );
  }

  private identity(receipt: Receipt): ToolIdentity {
    return {
      name: receipt.tool,
      repository: receipt.repository,
      command: receipt.command,
    };
  }

  /** Returns false for a missing link; refuses to modify any unrelated file. */
  private async ownsBin(tool: ToolIdentity): Promise<boolean> {
    const path = this.bin(tool);
    const info = await inspect(path);
    if (!info) return false;
    const target = this.activeExecutable(tool);
    if (
      !info.isSymbolicLink() ||
      !this.samePath(resolve(dirname(path), await readlink(path)), target)
    ) {
      throw new Error(`Refusing to modify a file not owned by myre: ${path}`);
    }
    return true;
  }

  private async ensureBin(tool: ToolIdentity): Promise<boolean> {
    if (await this.ownsBin(tool)) return false;
    await mkdir(this.binDir, { recursive: true });
    await this.createLink(this.activeExecutable(tool), this.bin(tool), "file");
    return true;
  }

  async list(): Promise<ToolRow[]> {
    const names = new Set(this.definitions.keys());
    try {
      for (const name of await readdir(join(this.dataDir, "tools")))
        if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) names.add(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const rows: ToolRow[] = [];
    for (const name of names) {
      const definition = this.definitions.get(name);
      const row: ToolRow = {
        name,
        description:
          definition?.description ?? "Installed tool absent from the catalog",
        status: "not-installed",
      };
      try {
        const installation = await this.installation({ name });
        if (installation) {
          const tool = this.identity(installation.receipt);
          const ownershipChanged =
            definition !== undefined &&
            (definition.repository !== tool.repository ||
              this.command(definition) !== this.command(tool));
          row.description =
            definition && !ownershipChanged
              ? definition.description
              : (installation.receipt.description ?? row.description);
          row.version = installation.receipt.tag;
          row.path = this.bin(tool);
          row.status =
            (await this.executableExists(installation.executable)) &&
            (await this.ownsBin(tool))
              ? "installed"
              : "broken";
          if (row.status === "broken")
            row.error =
              "Executable or command link is missing; run install to repair it.";
          if (ownershipChanged)
            row.error =
              "Catalog ownership changed; uninstall before installing the new definition.";
        } else if (!definition) continue;
      } catch (error) {
        row.status = "broken";
        row.error = message(error);
      }
      rows.push(row);
    }
    return rows;
  }

  private async locked<T>(
    tool: Pick<ToolIdentity, "name">,
    action: () => Promise<T>,
  ): Promise<T> {
    if (!["linux", "darwin", "win32"].includes(this.platform.os))
      throw new Error("Installation supports Linux, macOS, and Windows.");
    const root = this.root(tool);
    const info = await inspect(root);
    if (info && !info.isDirectory())
      throw new Error(`Not a myre-managed tool directory: ${root}`);
    await mkdir(root, { recursive: true });
    const path = join(root, ".lock");
    let lock;
    try {
      lock = await open(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(
          `Another operation is handling ${tool.name}. If it has exited, inspect the lock file: ${path}`,
        );
      throw error;
    }
    try {
      await lock.writeFile(`${process.pid}\n`);
      return await action();
    } finally {
      await lock.close();
      await rm(path, { force: true });
    }
  }

  async install(
    name: string,
    options: { version?: string } = {},
  ): Promise<void> {
    const tool = this.tool(name);
    const fixed = tool.version?.mode === "fixed" ? tool.version.tag : undefined;
    if (fixed && options.version && options.version !== fixed)
      throw new Error(
        `${name} is fixed to ${fixed} by the catalog; --version cannot override it.`,
      );
    await this.locked(tool, async () => {
      const installed = await this.installation(tool);
      if (installed) this.assertOwnership(tool, installed.receipt);
      await this.ownsBin(tool);
      if (installed) {
        if (options.version && options.version !== installed.receipt.tag) {
          throw new Error(
            `${name} is already installed at ${installed.receipt.tag}; use update to change versions.`,
          );
        }
        if (await this.executableExists(installed.executable)) {
          await this.ensureBin(tool);
          this.log(`${name} is already installed: ${installed.receipt.tag}`);
          return;
        }
      }
      // Repair only when the current catalog still describes the installed version.
      if (installed && fixed && installed.receipt.tag !== fixed)
        throw new Error(
          `${name} is recorded at ${installed.receipt.tag}, but the catalog fixes ${fixed}; use update to repair it.`,
        );
      const release = await this.github.release(
        tool.repository,
        installed?.receipt.tag ?? options.version ?? fixed,
        tool.acceptRelease,
      );
      await this.activate(tool, release);
    });
  }

  async uninstall(name: string): Promise<void> {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name))
      throw new Error(`Invalid tool name: ${name}`);
    const hint = { name };
    if (!this.definitions.has(name) && !(await inspect(this.root(hint))))
      this.tool(name);
    await this.locked(hint, async () => {
      const installed = await this.installation(hint);
      const versions = join(this.root(hint), "versions");
      const info = await inspect(versions);
      const directories: string[] = [];
      const receipts: Receipt[] = [];
      if (info) {
        if (!info.isDirectory())
          throw new Error(`Not a myre-managed versions directory: ${versions}`);
        for (const entry of await readdir(versions)) {
          const directory = join(versions, entry);
          if (!(await inspect(directory))?.isDirectory())
            throw new Error(
              `Not a myre-managed version directory: ${directory}`,
            );
          receipts.push(await this.receipt(name, directory));
          directories.push(directory);
        }
      }
      const stored = installed?.receipt ?? receipts[0];
      const tool = stored ? this.identity(stored) : this.definitions.get(name);
      if (!tool) {
        this.log(`${name} is not installed.`);
        return;
      }
      for (const receipt of receipts) this.assertOwnership(tool, receipt);
      const ownsBin = await this.ownsBin(tool);
      // Validate every version before deleting any links or installation files.
      if (ownsBin) await rm(this.bin(tool));
      if (installed) await rm(this.current(tool));
      for (const directory of directories)
        await rm(directory, { recursive: true });
      if (info) await rmdir(versions);
      // Keep the root stable for per-tool locking, including concurrent installs.
      this.log(
        installed || ownsBin || directories.length
          ? `${name} uninstalled.`
          : `${name} is not installed.`,
      );
    });
  }

  async update(name: string, options: { yes?: boolean } = {}): Promise<void> {
    const tool = this.tool(name);
    await this.locked(tool, async () => {
      const installed = await this.installation(tool);
      if (!installed)
        throw new Error(
          `${name} is not installed; run myre install ${name} first.`,
        );
      this.assertOwnership(tool, installed.receipt);
      await this.ownsBin(tool);
      const fixed =
        tool.version?.mode === "fixed" ? tool.version.tag : undefined;
      const release = await this.github.release(
        tool.repository,
        fixed,
        tool.acceptRelease,
      );
      if (release.tag === installed.receipt.tag) {
        if (await this.executableExists(installed.executable)) {
          await this.ensureBin(tool);
          this.log(
            fixed
              ? `${name} is already at the catalog's fixed version: ${release.tag}`
              : `${name} is already at the latest release: ${release.tag}`,
          );
        } else {
          this.log(`Repairing ${name} at ${release.tag}.`);
          await this.activate(tool, release);
        }
        return;
      }
      this.log(`${name}: ${installed.receipt.tag} -> ${release.tag}`);
      this.log(`Release notes: ${release.url}`);
      this.log(
        `Compare: https://github.com/${tool.repository}/compare/${encodeURIComponent(installed.receipt.tag)}...${encodeURIComponent(release.tag)}`,
      );
      this.log(
        fixed
          ? `Version ${fixed} is selected by the catalog; tags are not compared as semantic versions.`
          : "Latest is selected by upstream; tags are not compared as semantic versions.",
      );
      if (
        !options.yes &&
        !(await this.confirm(
          `Update ${name} from ${installed.receipt.tag} to ${release.tag}?`,
        ))
      ) {
        this.log("Update cancelled.");
        return;
      }
      await this.activate(tool, release);
    });
  }

  private async activate(
    tool: ToolDefinition,
    release: Release,
  ): Promise<void> {
    const selections = tool.selectAssets(release, this.platform);
    if (!selections.length)
      throw new Error("No assets are configured for this platform.");
    for (const selection of selections) {
      if (!["binary", "tar.gz", "zip"].includes(selection.format))
        throw new Error(`Unsupported archive format: ${selection.format}`);
      if (selection.format !== "binary") validateEntry(selection);
    }
    const root = this.root(tool);
    const versions = join(root, "versions");
    await mkdir(versions, { recursive: true });
    const staging = await mkdtemp(join(versions, ".stage-"));
    const directory = join(versions, crypto.randomUUID());
    const temporaryLink = join(root, `.current-${crypto.randomUUID()}`);
    let binCreated = false;
    let committed = false;
    try {
      const archive = join(staging, ".download");
      let download:
        { selection: AssetSelection; response: Response } | undefined;
      for (const selection of selections) {
        const response = await this.github.download(
          tool.repository,
          release.tag,
          selection.name,
        );
        if (response) {
          download = { selection, response };
          break;
        }
      }
      if (!download)
        throw new Error(
          `No public asset found for ${release.tag}: ${selections.map((asset) => asset.name).join(", ")}`,
        );
      const { selection, response } = download;
      this.log(`Downloading ${tool.name} ${release.tag}: ${selection.name}`);
      const encoding = response.headers.get("content-encoding");
      const length =
        !encoding || encoding === "identity"
          ? response.headers.get("content-length")
          : null;
      await downloadWithProgress(response, archive, length);
      if (
        length !== null &&
        (!/^\d+$/.test(length) || (await stat(archive)).size !== Number(length))
      )
        throw new Error("Download size does not match Content-Length.");
      if (selection.digest) {
        if (!/^sha256:[a-f0-9]{64}$/i.test(selection.digest))
          throw new Error(`Invalid expected asset digest: ${selection.digest}`);
        const hasher = new Bun.CryptoHasher("sha256");
        for await (const chunk of Bun.file(archive).stream())
          hasher.update(chunk);
        if (`sha256:${hasher.digest("hex")}` !== selection.digest.toLowerCase())
          throw new Error("SHA-256 verification failed.");
      }
      const executable = join(staging, this.command(tool));
      await extract(archive, executable, selection);
      if (!(await stat(executable)).size)
        throw new Error("The selected executable is empty.");
      if (!this.windows) await chmod(executable, 0o755);
      const child = Bun.spawn([executable, ...tool.verifyArgs], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15_000,
      });
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exit !== 0)
        throw new Error(
          `Executable verification failed (${exit}): ${(stderr || stdout).trim()}`,
        );
      const receipt: Receipt = {
        schema: 1,
        tool: tool.name,
        command: this.command(tool),
        repository: tool.repository,
        tag: release.tag,
        asset: selection.name,
        installedAt: new Date().toISOString(),
        description: tool.description,
      };
      await Bun.write(
        join(staging, "receipt.json"),
        `${JSON.stringify(receipt, null, 2)}\n`,
      );
      await rm(archive);
      await rename(staging, directory);
      binCreated = await this.ensureBin(tool);
      // Receipt and executable move together: a single atomic link switch commits both.
      const target = this.windows
        ? join(directory, this.command(tool))
        : directory;
      await this.createLink(
        relative(root, target),
        temporaryLink,
        this.windows ? "file" : "dir",
      );
      await rename(temporaryLink, this.current(tool));
      committed = true;
      this.log(`${tool.name} installed at ${release.tag}: ${this.bin(tool)}`);
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      await rm(temporaryLink, { force: true }).catch(() => {});
      if (!committed) {
        if (binCreated)
          await rm(this.bin(tool), { force: true }).catch(() => {});
        await rm(directory, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
