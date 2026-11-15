import { mkdir, open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import bundled from "../catalog/tools.json";
import { validateReleaseTag } from "./releases";
import {
  platformKey,
  validateBinaryPath,
  validateIdentity,
  type AssetSelection,
  type ToolDefinition,
  type VersionPolicy,
} from "./tools";

export const catalogURL =
  "https://github.com/TsingShui/myre/releases/download/catalog-v1/tools.json";
const limit = 1024 * 1024;
const platforms = new Set([
  "linux-x64",
  "linux-arm64",
  "macos-x64",
  "macos-arm64",
  "windows-x64",
]);

interface CatalogPlatform {
  format: AssetSelection["format"];
  binaryPath?: string;
  assets: { name: string; digest?: string }[];
}
interface CatalogTool {
  name: string;
  description: string;
  repository: string;
  command?: string;
  tagPrefix?: string;
  numericVersion?: boolean;
  version?: VersionPolicy;
  verifyArgs: string[];
  platforms: Record<string, CatalogPlatform>;
}
export interface Catalog {
  schemaVersion: 1;
  revision: number;
  tools: CatalogTool[];
}

function object(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Catalog fields must be objects.");
  if (keys && Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(
      "Unknown catalog field; update myre if a newer schema is required.",
    );
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error("Invalid catalog string.");
  return value;
}
function array(value: unknown, max: number, allowEmpty = false): unknown[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && !value.length) ||
    value.length > max
  )
    throw new Error("Invalid catalog array length.");
  return value;
}
function parseVersion(value: unknown): VersionPolicy {
  const policy = object(value, ["mode", "tag"]);
  if (policy.mode === "latest" && policy.tag === undefined)
    return { mode: "latest" };
  if (policy.mode === "fixed") {
    const tag = string(policy.tag);
    validateReleaseTag(tag);
    return { mode: "fixed", tag };
  }
  throw new Error("Invalid catalog version policy.");
}
function render(template: string, values: Record<string, string>): string {
  const result = template.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key))
      throw new Error(`Unknown catalog variable: ${key}`);
    return values[key]!;
  });
  if (/[{}]/.test(result)) throw new Error("Unresolved catalog template.");
  return result;
}
function assetName(name: string): string {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[/\\\x00-\x1f\x7f{}]/.test(name)
  )
    throw new Error("Invalid catalog asset name.");
  return name;
}

/** Parse data only: catalog entries cannot supply code, URLs, or shell commands. */
export function parseCatalog(value: unknown): Catalog {
  const source = object(value, ["schemaVersion", "revision", "tools"]);
  if (source.schemaVersion !== 1)
    throw new Error("Unsupported catalog schema; update myre.");
  if (!Number.isSafeInteger(source.revision) || (source.revision as number) < 1)
    throw new Error("Invalid catalog revision.");
  const names = new Set<string>();
  const commands = new Set<string>();
  const tools = array(source.tools, 256, true).map((value) => {
    const raw = object(value, [
      "name",
      "description",
      "repository",
      "command",
      "tagPrefix",
      "numericVersion",
      "version",
      "verifyArgs",
      "platforms",
    ]);
    const tool: CatalogTool = {
      name: string(raw.name),
      description: string(raw.description),
      repository: string(raw.repository),
      command: raw.command === undefined ? undefined : string(raw.command),
      tagPrefix:
        raw.tagPrefix === undefined ? undefined : string(raw.tagPrefix),
      numericVersion:
        raw.numericVersion === undefined
          ? undefined
          : (raw.numericVersion as boolean),
      version:
        raw.version === undefined ? undefined : parseVersion(raw.version),
      verifyArgs: array(raw.verifyArgs, 16).map(string),
      platforms: {},
    };
    validateIdentity(tool);
    if (
      tool.numericVersion !== undefined &&
      typeof tool.numericVersion !== "boolean"
    )
      throw new Error("numericVersion must be a boolean.");
    if (tool.version?.mode === "fixed") {
      const tag = tool.version.tag;
      if (
        (tool.tagPrefix && !tag.startsWith(tool.tagPrefix)) ||
        (tool.numericVersion &&
          !/^\d/.test(tool.tagPrefix ? tag.slice(tool.tagPrefix.length) : tag))
      )
        throw new Error(
          `Fixed version is outside the release channel: ${tool.name}`,
        );
    }
    const command = (tool.command ?? tool.name)
      .toLowerCase()
      .replace(/\.exe$/, "");
    if (names.has(tool.name) || commands.has(command))
      throw new Error("Duplicate catalog tool or command.");
    names.add(tool.name);
    commands.add(command);
    const entries = Object.entries(object(raw.platforms));
    if (!entries.length || entries.length > platforms.size)
      throw new Error("Invalid catalog platforms.");
    for (const [key, value] of entries) {
      if (!platforms.has(key))
        throw new Error(`Unsupported catalog platform: ${key}`);
      const entry = object(value, ["format", "binaryPath", "assets"]);
      if (!["binary", "tar.gz", "zip"].includes(entry.format as string))
        throw new Error("Unsupported catalog archive format.");
      const format = entry.format as CatalogPlatform["format"];
      const binaryPath =
        entry.binaryPath === undefined ? undefined : string(entry.binaryPath);
      if (format !== "binary")
        validateBinaryPath(
          render(string(binaryPath), {
            tag: "x",
            version: "x",
            assetStem: "x",
          }),
        );
      const assets = array(entry.assets, 8).map((value) => {
        const asset = object(value, ["name", "digest"]);
        const name = string(asset.name);
        assetName(render(name, { tag: "x", version: "x" }));
        const digest =
          asset.digest === undefined ? undefined : string(asset.digest);
        if (digest && !/^sha256:[a-f0-9]{64}$/i.test(digest))
          throw new Error("Invalid catalog SHA-256 digest.");
        return { name, digest };
      });
      tool.platforms[key] = { format, binaryPath, assets };
    }
    return tool;
  });
  const catalog: Catalog = {
    schemaVersion: 1,
    revision: source.revision as number,
    tools,
  };
  if (
    new TextEncoder().encode(`${JSON.stringify(catalog, null, 2)}\n`)
      .byteLength > limit
  )
    throw new Error("Catalog exceeds the 1 MiB limit.");
  return catalog;
}

function definitions(catalog: Catalog): ToolDefinition[] {
  return catalog.tools.map((tool) => {
    const version = (tag: string) =>
      tool.tagPrefix ? tag.slice(tool.tagPrefix.length) : tag;
    const accepts = (tag: string) =>
      (!tool.tagPrefix || tag.startsWith(tool.tagPrefix)) &&
      (!tool.numericVersion || /^\d/.test(version(tag)));
    return {
      ...tool,
      supports: (platform) =>
        Object.hasOwn(tool.platforms, platformKey(platform)),
      acceptRelease: (release) => accepts(release.tag),
      selectAssets(release, platform) {
        if (!accepts(release.tag))
          throw new Error(
            `Release ${release.tag} is outside this tool's release channel.`,
          );
        const entry = tool.platforms[platformKey(platform)];
        if (!entry)
          throw new Error(
            `Unsupported platform for ${tool.name}: ${platformKey(platform)}`,
          );
        return entry.assets.map((asset) => {
          const name = assetName(
            render(asset.name, {
              tag: release.tag,
              version: version(release.tag),
            }),
          );
          const assetStem =
            entry.format === "binary"
              ? name
              : name.slice(0, -(entry.format.length + 1));
          return {
            name,
            format: entry.format,
            digest: asset.digest,
            binaryPath:
              entry.format === "binary"
                ? undefined
                : validateBinaryPath(
                    render(entry.binaryPath!, {
                      tag: release.tag,
                      version: version(release.tag),
                      assetStem,
                    }),
                  ),
          };
        });
      },
    };
  });
}

async function readCache(path: string): Promise<Catalog | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return;
  try {
    if (file.size > limit) throw new Error("Catalog cache is too large.");
    return parseCatalog(await file.json());
  } catch (error) {
    console.warn(
      `Ignoring invalid catalog cache: ${error instanceof Error ? error.message : error}`,
    );
  }
}
function newest(candidate: Catalog, current: Catalog): Catalog {
  if (candidate.revision < current.revision) {
    console.warn("Ignoring an older catalog revision.");
    return current;
  }
  if (
    candidate.revision === current.revision &&
    JSON.stringify(candidate) !== JSON.stringify(current)
  )
    throw new Error("Catalog contents changed without a revision increase.");
  return candidate;
}
async function download(): Promise<Catalog> {
  const response = await fetch(catalogURL, {
    credentials: "omit",
    headers: { "User-Agent": "myre", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(8000),
  });
  const length = response.headers.get("content-length");
  if (
    !response.ok ||
    (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))
  ) {
    await response.body?.cancel();
    throw new Error(
      `Catalog HTTP ${response.status} or invalid Content-Length.`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty catalog response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Catalog exceeds the 1 MiB limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const encoding = response.headers.get("content-encoding");
  if (
    length !== null &&
    (!encoding || encoding === "identity") &&
    size !== Number(length)
  )
    throw new Error("Catalog size does not match Content-Length.");
  return parseCatalog(await new Response(new Blob(chunks)).json());
}

/** Refresh only when requested; offline reads never create files or use the network. */
export async function loadTools(refresh = false): Promise<ToolDefinition[]> {
  const directory = resolve(process.env.MYRE_HOME ?? join(homedir(), ".myre"));
  const path = join(directory, "catalog.json");
  const bundledCatalog = parseCatalog(bundled);
  const cached = await readCache(path);
  let selected =
    cached && cached.revision >= bundledCatalog.revision
      ? cached
      : bundledCatalog;
  if (refresh) {
    console.error("Refreshing catalog...");
    try {
      selected = newest(await download(), selected);
    } catch (error) {
      console.warn(
        `Cannot refresh tool catalog; using revision ${selected.revision}: ${error instanceof Error ? error.message : error}`,
      );
      return definitions(selected);
    }
    let lock;
    const lockPath = join(directory, ".catalog.lock");
    const temporary = join(directory, `.catalog-${crypto.randomUUID()}.json`);
    try {
      await mkdir(directory, { recursive: true });
      lock = await open(lockPath, "wx", 0o600);
      const latest = await readCache(path);
      if (latest) {
        try {
          selected = newest(selected, latest);
        } catch (error) {
          selected = latest;
          throw error;
        }
      }
      await Bun.write(temporary, `${JSON.stringify(selected, null, 2)}\n`);
      await rename(temporary, path);
    } catch (error) {
      console.warn(
        `Catalog loaded but cache was not updated: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
      if (lock) {
        await lock.close();
        await rm(lockPath, { force: true });
      }
    }
    console.error(`Catalog ready (revision ${selected.revision}).`);
  }
  return definitions(selected);
}
