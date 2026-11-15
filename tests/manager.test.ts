import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { ToolManager, type ManagerOptions } from "../src/manager";
import type { Fetcher } from "../src/releases";
import type { ToolDefinition } from "../src/tools";

const windows = process.platform === "win32";
const binaryName = windows ? "fixture.exe" : "fixture";
const binaries = new Map<string, Uint8Array>();
let fixtureDirectory: string;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "myre-native-fixtures-"));
  for (const version of ["v1", "v2", "broken"]) {
    const outfile = join(
      fixtureDirectory,
      `${version}${windows ? ".exe" : ""}`,
    );
    const result = await Bun.build({
      entrypoints: [
        fileURLToPath(new URL("./fixtures/tool.ts", import.meta.url)),
      ],
      compile: { outfile, autoloadDotenv: false, autoloadBunfig: false },
      define: { FIXTURE_VERSION: JSON.stringify(version) },
    });
    if (!result.success)
      throw new AggregateError(result.logs, "Failed to compile test fixture.");
    binaries.set(version, await Bun.file(outfile).bytes());
  }
}, 120_000);

afterAll(async () => {
  if (fixtureDirectory)
    await rm(fixtureDirectory, { recursive: true, force: true });
});

function executable(version: string): Uint8Array {
  const binary = binaries.get(version);
  if (!binary) throw new Error(`Unknown fixture version: ${version}`);
  return binary;
}

class FakePublicGitHub {
  releases = new Map<string, Uint8Array>();
  latest = "";
  requests: string[] = [];
  downloadCount = 0;
  contentLength?: number;

  add(tag: string, content = executable(tag)) {
    this.releases.set(tag, content);
    this.latest = tag;
  }

  fetch: Fetcher = async (input, init) => {
    this.requests.push(input);
    const url = new URL(input);
    if (
      url.origin !== "https://github.com" ||
      new Headers(init?.headers).has("Authorization")
    ) {
      throw new Error(
        "Only unauthenticated public GitHub requests are allowed.",
      );
    }
    if (url.pathname === "/test/fixture/releases/latest") {
      expect(init?.method).toBe("HEAD");
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: {
          Location: `https://github.com/test/fixture/releases/tag/${encodeURIComponent(this.latest)}`,
        },
      });
    }
    const asset = url.pathname.match(
      /^\/test\/fixture\/releases\/download\/([^/]+)\/([^/]+)$/,
    );
    if (asset) {
      expect(init?.method).toBe("GET");
      const content = this.releases.get(decodeURIComponent(asset[1]!));
      if (!content || asset[2] !== "fixture")
        return new Response(null, { status: 404 });
      this.downloadCount++;
      return new Response(content, {
        headers: {
          "Content-Length": String(this.contentLength ?? content.byteLength),
        },
      });
    }
    throw new Error(`Unexpected public URL: ${input}`);
  };
}

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(options: ManagerOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "myre-test-"));
  temporary.push(directory);
  const dataDir = join(directory, "data");
  const binDir = join(directory, "bin");
  const root = join(dataDir, "tools/fixture");
  const upstream = new FakePublicGitHub();
  upstream.add("v1");
  const logs: string[] = [];
  const tool: ToolDefinition = {
    name: "fixture",
    description: "Test tool",
    repository: "test/fixture",
    verifyArgs: ["--version"],
    selectAssets: () => [{ name: "fixture", format: "binary" }],
  };
  const manager = new ToolManager([tool], {
    dataDir,
    binDir,
    fetcher: upstream.fetch,
    log: (line) => logs.push(line),
    confirm: async () => true,
    ...options,
  });
  return {
    manager,
    upstream,
    logs,
    tool,
    directory,
    root,
    binary: join(binDir, binaryName),
    currentDirectory: async () => {
      const target = resolve(
        root,
        await readlink(join(root, windows ? "current.exe" : "current")),
      );
      return windows ? dirname(target) : target;
    },
  };
}

async function output(binary: string): Promise<string> {
  const child = Bun.spawn([binary, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  return text.trim();
}

test("list reads local installation state without network or filesystem changes", async () => {
  const f = await fixture();
  expect(await f.manager.list()).toEqual([
    { name: "fixture", description: "Test tool", status: "not-installed" },
  ]);
  expect(f.upstream.requests).toHaveLength(0);
  expect(await readdir(f.directory)).toEqual([]);

  await f.manager.install("fixture");
  const count = f.upstream.requests.length;
  expect((await f.manager.list())[0]).toMatchObject({
    status: "installed",
    version: "v1",
  });
  expect(f.upstream.requests).toHaveLength(count);
});

test("install downloads a public archive with a 404 fallback and remains idempotent", async () => {
  const f = await fixture();
  const archive = new Bun.Archive(
    {
      [`bin/${binaryName}`]: executable("v1"),
      unrelated: "must not be installed",
    },
    { compress: "gzip", level: 1 },
  );
  f.upstream.add("v1", await archive.bytes());
  f.tool.selectAssets = () => [
    { name: "missing", format: "tar.gz", binaryPath: `bin/${binaryName}` },
    { name: "fixture", format: "tar.gz", binaryPath: `bin/${binaryName}` },
  ];

  await f.manager.install("fixture");
  expect(await output(f.binary)).toBe("v1");
  expect(
    await Bun.file(join(await f.currentDirectory(), "receipt.json")).json(),
  ).toMatchObject({
    schema: 1,
    tool: "fixture",
    tag: "v1",
    asset: "fixture",
  });
  expect((await readdir(await f.currentDirectory())).sort()).toEqual([
    binaryName,
    "receipt.json",
  ]);

  const count = f.upstream.requests.length;
  await f.manager.install("fixture");
  expect(f.upstream.requests).toHaveLength(count);
}, 60_000);

test("update supports cancellation, installs a ZIP, and skips unchanged tags", async () => {
  let confirmed = false;
  const f = await fixture({ confirm: async () => confirmed });
  await f.manager.install("fixture");
  const previous = await f.currentDirectory();
  f.upstream.add(
    "v2",
    zipSync(
      {
        [`bin/${binaryName}`]: executable("v2"),
        unrelated: new TextEncoder().encode("must not be installed"),
      },
      { level: 1 },
    ),
  );
  f.tool.selectAssets = () => [
    { name: "fixture", format: "zip", binaryPath: `bin/${binaryName}` },
  ];

  await f.manager.update("fixture");
  expect(f.upstream.downloadCount).toBe(1);
  expect(await output(f.binary)).toBe("v1");
  expect(f.logs.at(-1)).toBe("Update cancelled.");

  confirmed = true;
  await f.manager.update("fixture");
  expect(await output(f.binary)).toBe("v2");
  expect((await readdir(await f.currentDirectory())).sort()).toEqual([
    binaryName,
    "receipt.json",
  ]);
  expect((await f.manager.list())[0]?.version).toBe("v2");
  expect(f.logs.join("\n")).toContain(
    "https://github.com/test/fixture/releases/tag/v2",
  );
  expect(f.logs.join("\n")).toContain(
    "https://github.com/test/fixture/compare/v1...v2",
  );
  expect(await Bun.file(join(previous, binaryName)).exists()).toBe(true);
  const count = f.upstream.requests.length;
  await f.manager.update("fixture");
  expect(f.upstream.requests).toHaveLength(count + 1);
  expect(f.upstream.downloadCount).toBe(2);
}, 60_000);

test("uninstall validates ownership, removes all managed versions offline, and respects locks", async () => {
  const f = await fixture();
  await f.manager.install("fixture");
  const previous = await f.currentDirectory();
  f.upstream.add("v2");
  await f.manager.update("fixture", { yes: true });
  const active = await f.currentDirectory();
  const requests = f.upstream.requests.length;

  const lock = join(f.root, ".lock");
  await Bun.write(lock, "another operation");
  await expect(f.manager.uninstall("fixture")).rejects.toThrow(
    "Another operation",
  );
  expect(await output(f.binary)).toBe("v2");
  await rm(lock);

  const outside = join(f.directory, "unrelated");
  const protectedFile = join(outside, "keep.txt");
  await Bun.write(protectedFile, "do not remove");
  const foreign = join(f.root, "versions", "unrelated");
  await symlink(outside, foreign, "dir");
  await expect(f.manager.uninstall("fixture")).rejects.toThrow(
    "Not a myre-managed version directory",
  );
  expect(await Bun.file(protectedFile).text()).toBe("do not remove");
  await rm(foreign);

  await Bun.write(join(foreign, "keep.txt"), "unmanaged version");
  await expect(f.manager.uninstall("fixture")).rejects.toThrow(
    "Cannot read installation record",
  );
  expect(await Bun.file(join(foreign, "keep.txt")).text()).toBe(
    "unmanaged version",
  );
  expect(await output(f.binary)).toBe("v2");
  await rm(foreign, { recursive: true });

  // A missing executable must not prevent removal of its valid installation record.
  await rm(join(active, binaryName));
  await f.manager.uninstall("fixture");
  expect((await f.manager.list())[0]?.status).toBe("not-installed");
  expect(await readdir(f.root)).toEqual([]);
  await expect(readlink(f.binary)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await Bun.file(join(previous, "receipt.json")).exists()).toBe(false);
  expect(await Bun.file(join(active, "receipt.json")).exists()).toBe(false);
  expect(await Bun.file(protectedFile).text()).toBe("do not remove");
  expect(f.logs.at(-1)).toBe("fixture uninstalled.");

  await f.manager.uninstall("fixture");
  expect(f.logs.at(-1)).toBe("fixture is not installed.");
  expect(f.upstream.requests).toHaveLength(requests);
}, 60_000);

test("download size mismatch preserves the current version and cleans temporary files", async () => {
  const f = await fixture();
  await f.manager.install("fixture");
  f.upstream.add("v2");
  f.upstream.contentLength = executable("v2").byteLength + 1;
  await expect(f.manager.update("fixture", { yes: true })).rejects.toThrow(
    "Content-Length",
  );
  expect(await output(f.binary)).toBe("v1");
  expect((await f.manager.list())[0]?.version).toBe("v1");
  expect(await readdir(join(f.root, "versions"))).toHaveLength(1);
  expect(await readdir(f.root)).not.toContain(".lock");
});

test("failed executable verification preserves the previous installation", async () => {
  const f = await fixture();
  await f.manager.install("fixture");
  f.upstream.add("v2", executable("broken"));
  await expect(f.manager.update("fixture", { yes: true })).rejects.toThrow(
    "Executable verification failed",
  );
  expect(await output(f.binary)).toBe("v1");
  expect((await f.manager.list())[0]?.version).toBe("v1");
});

test("install and uninstall refuse to modify an unmanaged command", async () => {
  const f = await fixture();
  await Bun.write(f.binary, "do not overwrite");
  await expect(f.manager.install("fixture")).rejects.toThrow(
    "not owned by myre",
  );
  await expect(f.manager.uninstall("fixture")).rejects.toThrow(
    "not owned by myre",
  );
  expect(await Bun.file(f.binary).text()).toBe("do not overwrite");
  expect(f.upstream.requests).toHaveLength(0);

  await rm(f.binary);
  await f.manager.install("fixture");
  const requests = f.upstream.requests.length;
  await rm(f.binary);
  await Bun.write(f.binary, "replacement command");
  await expect(f.manager.uninstall("fixture")).rejects.toThrow(
    "not owned by myre",
  );
  expect(await Bun.file(f.binary).text()).toBe("replacement command");
  expect((await f.manager.list())[0]?.version).toBe("v1");
  expect(await readdir(f.root)).not.toContain(".lock");
  expect(f.upstream.requests).toHaveLength(requests);
});
