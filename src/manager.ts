import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { GitHub, type Fetcher, type Release } from "./releases";
import type { AssetSelection, Platform, ToolDefinition } from "./tools";

interface Receipt {
  schema: 1;
  tool: string;
  command: string;
  repository: string;
  tag: string;
  asset?: string;
  installedAt: string;
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
  const entry = selection.binaryPath;
  if (
    !entry ||
    entry.startsWith("/") ||
    entry.startsWith("-") ||
    /[\\\x00\r\n*?\[\]]/.test(entry) ||
    entry
      .replace(/^\.\//, "")
      .split("/")
      .some((part) => !part || part === ".." || part === ".")
  )
    throw new Error(
      "Archives require a safe, exact binaryPath without wildcards.",
    );
  return entry;
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
  const args =
    selection.format === "tar.gz"
      ? ["tar", "-xOzf", archive, "--", entry]
      : ["unzip", "-p", archive, entry];
  const file = await open(output, "wx", 0o755);
  try {
    // Stream only the selected entry to a file, never extract an archive tree.
    const child = Bun.spawn(args, {
      stdout: file.fd,
      stderr: "pipe",
      timeout: 60_000,
    });
    const stderr = await new Response(child.stderr).text();
    if ((await child.exited) !== 0)
      throw new Error(
        `Archive extraction failed (${args[0]}): ${stderr.trim()}`,
      );
  } finally {
    await file.close();
  }
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
    const commands = new Set<string>();
    for (const tool of definitions) {
      const command = tool.command ?? tool.name;
      if (
        !/^[a-z0-9][a-z0-9_-]*$/.test(tool.name) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(command) ||
        command === "receipt.json"
      ) {
        throw new Error(`Invalid tool name or command: ${tool.name}`);
      }
      if (
        !/^[\w.-]+\/[\w.-]+$/.test(tool.repository) ||
        tool.repository.split("/").some((part) => part === "." || part === "..")
      ) {
        throw new Error(`Invalid GitHub repository: ${tool.repository}`);
      }
      if (this.definitions.has(tool.name) || commands.has(command))
        throw new Error(`Duplicate tool name or command: ${tool.name}`);
      this.definitions.set(tool.name, tool);
      commands.add(command);
    }
    this.dataDir = resolve(
      options.dataDir ?? process.env.MERE_HOME ?? join(homedir(), ".mere"),
    );
    this.binDir = resolve(
      options.binDir ??
        process.env.MERE_BIN_DIR ??
        join(homedir(), ".local/bin"),
    );
    this.platform = options.platform ?? {
      os: process.platform,
      arch: process.arch,
    };
    this.github = new GitHub(options.fetcher);
    this.log = options.log ?? console.log;
    this.confirm = options.confirm ?? (async () => false);
  }

  private tool(name: string): ToolDefinition {
    const tool = this.definitions.get(name);
    if (!tool)
      throw new Error(
        `Unsupported tool: ${name}. Run mere list to view supported tools.`,
      );
    return tool;
  }

  private root(tool: ToolDefinition): string {
    return join(this.dataDir, "tools", tool.name);
  }

  private bin(tool: ToolDefinition): string {
    return join(this.binDir, tool.command ?? tool.name);
  }

  private async installation(
    tool: ToolDefinition,
  ): Promise<Installation | null> {
    const root = this.root(tool);
    const current = join(root, "current");
    const info = await inspect(current);
    if (!info) return null;
    if (!info.isSymbolicLink())
      throw new Error(`Not a mere-managed version link: ${current}`);
    const directory = resolve(root, await readlink(current));
    if (
      dirname(directory) !== join(root, "versions") ||
      !(await inspect(directory))?.isDirectory()
    ) {
      throw new Error(`Invalid installation directory: ${current}`);
    }
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
      receipt.tool !== tool.name ||
      receipt.command !== (tool.command ?? tool.name) ||
      receipt.repository !== tool.repository ||
      typeof receipt.tag !== "string" ||
      !receipt.tag ||
      typeof receipt.installedAt !== "string"
    )
      throw new Error(
        `Invalid installation record or changed tool definition: ${tool.name}`,
      );
    return {
      receipt: receipt as Receipt,
      executable: join(directory, tool.command ?? tool.name),
    };
  }

  /** Returns false for a missing link; refuses to overwrite any unrelated file. */
  private async ownsBin(tool: ToolDefinition): Promise<boolean> {
    const path = this.bin(tool);
    const info = await inspect(path);
    if (!info) return false;
    const target = join(this.root(tool), "current", tool.command ?? tool.name);
    if (
      !info.isSymbolicLink() ||
      resolve(dirname(path), await readlink(path)) !== target
    ) {
      throw new Error(
        `Refusing to overwrite a file not owned by mere: ${path}`,
      );
    }
    return true;
  }

  private async ensureBin(tool: ToolDefinition): Promise<boolean> {
    if (await this.ownsBin(tool)) return false;
    await mkdir(this.binDir, { recursive: true });
    await symlink(
      join(this.root(tool), "current", tool.command ?? tool.name),
      this.bin(tool),
    );
    return true;
  }

  async list(): Promise<ToolRow[]> {
    const rows: ToolRow[] = [];
    for (const tool of this.definitions.values()) {
      const row: ToolRow = {
        name: tool.name,
        description: tool.description,
        status: "not-installed",
      };
      try {
        const installation = await this.installation(tool);
        if (installation) {
          row.version = installation.receipt.tag;
          row.path = this.bin(tool);
          const binary = await inspect(installation.executable);
          row.status =
            binary?.isFile() &&
            (binary.mode & 0o111) !== 0 &&
            (await this.ownsBin(tool))
              ? "installed"
              : "broken";
          if (row.status === "broken")
            row.error =
              "Executable or command link is missing; run install to repair it.";
        }
      } catch (error) {
        row.status = "broken";
        row.error = message(error);
      }
      rows.push(row);
    }
    return rows;
  }

  private async locked<T>(
    tool: ToolDefinition,
    action: () => Promise<T>,
  ): Promise<T> {
    if (this.platform.os !== "linux" && this.platform.os !== "darwin")
      throw new Error("Installation currently supports Linux and macOS only.");
    const root = this.root(tool);
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
    await this.locked(tool, async () => {
      const installed = await this.installation(tool);
      await this.ownsBin(tool);
      if (installed) {
        if (options.version && options.version !== installed.receipt.tag) {
          throw new Error(
            `${name} is already installed at ${installed.receipt.tag}; use update to change versions.`,
          );
        }
        const binary = await inspect(installed.executable);
        if (binary?.isFile() && (binary.mode & 0o111) !== 0) {
          await this.ensureBin(tool);
          this.log(
            `${name} is installed at ${installed.receipt.tag}: ${this.bin(tool)}`,
          );
          return;
        }
      }
      // Repair a missing executable at its recorded version, without implicitly upgrading.
      const release = await this.github.release(
        tool.repository,
        installed?.receipt.tag ?? options.version,
        tool.acceptRelease,
      );
      await this.activate(tool, release);
    });
  }

  async update(name: string, options: { yes?: boolean } = {}): Promise<void> {
    const tool = this.tool(name);
    await this.locked(tool, async () => {
      const installed = await this.installation(tool);
      if (!installed)
        throw new Error(
          `${name} is not installed; run mere install ${name} first.`,
        );
      await this.ownsBin(tool);
      const release = await this.github.release(
        tool.repository,
        undefined,
        tool.acceptRelease,
      );
      if (release.tag === installed.receipt.tag) {
        const binary = await inspect(installed.executable);
        if (binary?.isFile() && (binary.mode & 0o111) !== 0) {
          await this.ensureBin(tool);
          this.log(`${name} is already at the latest release: ${release.tag}`);
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
        "Latest is selected by upstream; tags are not compared as semantic versions.",
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
      await Bun.write(archive, response);
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
      const executable = join(staging, tool.command ?? tool.name);
      await extract(archive, executable, selection);
      if (!(await stat(executable)).size)
        throw new Error("The selected executable is empty.");
      await chmod(executable, 0o755);
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
        command: tool.command ?? tool.name,
        repository: tool.repository,
        tag: release.tag,
        asset: selection.name,
        installedAt: new Date().toISOString(),
      };
      await Bun.write(
        join(staging, "receipt.json"),
        `${JSON.stringify(receipt, null, 2)}\n`,
      );
      await rm(archive);
      await rename(staging, directory);
      binCreated = await this.ensureBin(tool);
      // Receipt and executable move together: a single atomic link switch commits both.
      await symlink(relative(root, directory), temporaryLink);
      await rename(temporaryLink, join(root, "current"));
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
