import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { ToolManager, type ManagerOptions } from "../src/manager";
import type { Fetcher } from "../src/releases";
import type { ToolDefinition } from "../src/tools";

const script = (version: string) =>
  new TextEncoder().encode(`#!/bin/sh\nprintf '%s\\n' '${version}'\n`);

class FakePublicGitHub {
  releases = new Map<string, Uint8Array>();
  latest = "";
  requests: string[] = [];
  downloadCount = 0;
  contentLength?: number;

  add(tag: string, content = script(tag)) {
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
  const directory = await mkdtemp(join(tmpdir(), "mere-test-"));
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
    binary: join(binDir, "fixture"),
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
      "bin/fixture": script("v1"),
      unrelated: "must not be installed",
    },
    { compress: "gzip" },
  );
  f.upstream.add("v1", await archive.bytes());
  f.tool.selectAssets = () => [
    { name: "missing", format: "tar.gz", binaryPath: "bin/fixture" },
    { name: "fixture", format: "tar.gz", binaryPath: "bin/fixture" },
  ];

  await f.manager.install("fixture");
  expect(await output(f.binary)).toBe("v1");
  expect(
    await Bun.file(join(f.root, "current/receipt.json")).json(),
  ).toMatchObject({
    schema: 1,
    tool: "fixture",
    tag: "v1",
    asset: "fixture",
  });
  expect((await readdir(join(f.root, "current"))).sort()).toEqual([
    "fixture",
    "receipt.json",
  ]);

  const count = f.upstream.requests.length;
  await f.manager.install("fixture");
  expect(f.upstream.requests).toHaveLength(count);
});

test("update installs a ZIP, shows review links, and skips unchanged tags", async () => {
  const f = await fixture();
  await f.manager.install("fixture");
  const previous = await readlink(join(f.root, "current"));
  f.upstream.add(
    "v2",
    zipSync({
      "bin/fixture": script("v2"),
      unrelated: new TextEncoder().encode("must not be installed"),
    }),
  );
  f.tool.selectAssets = () => [
    { name: "fixture", format: "zip", binaryPath: "bin/fixture" },
  ];

  await f.manager.update("fixture");
  expect(await output(f.binary)).toBe("v2");
  expect((await readdir(join(f.root, "current"))).sort()).toEqual([
    "fixture",
    "receipt.json",
  ]);
  expect((await f.manager.list())[0]?.version).toBe("v2");
  expect(f.logs.join("\n")).toContain(
    "https://github.com/test/fixture/releases/tag/v2",
  );
  expect(f.logs.join("\n")).toContain(
    "https://github.com/test/fixture/compare/v1...v2",
  );
  expect(await Bun.file(join(f.root, previous, "fixture")).exists()).toBe(true);
  const count = f.upstream.requests.length;
  await f.manager.update("fixture");
  expect(f.upstream.requests).toHaveLength(count + 1);
  expect(f.upstream.downloadCount).toBe(2);
});

test("cancelled update does not download or replace the current version", async () => {
  const f = await fixture({ confirm: async () => false });
  await f.manager.install("fixture");
  f.upstream.add("v2");
  await f.manager.update("fixture");
  expect(f.upstream.downloadCount).toBe(1);
  expect(await output(f.binary)).toBe("v1");
  expect(f.logs.at(-1)).toBe("Update cancelled.");
});

test("download size mismatch preserves the current version and cleans temporary files", async () => {
  const f = await fixture();
  await f.manager.install("fixture");
  f.upstream.add("v2");
  f.upstream.contentLength = script("v2").byteLength + 1;
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
  f.upstream.add("v2", new TextEncoder().encode("#!/bin/sh\nexit 2\n"));
  await expect(f.manager.update("fixture", { yes: true })).rejects.toThrow(
    "Executable verification failed",
  );
  expect(await output(f.binary)).toBe("v1");
  expect((await f.manager.list())[0]?.version).toBe("v1");
});

test("install refuses to overwrite an unmanaged command", async () => {
  const f = await fixture();
  await Bun.write(f.binary, "do not overwrite");
  await expect(f.manager.install("fixture")).rejects.toThrow(
    "Refusing to overwrite",
  );
  expect(await Bun.file(f.binary).text()).toBe("do not overwrite");
  expect(f.upstream.requests).toHaveLength(0);
});
