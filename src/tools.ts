import type { Release } from "./releases";

export interface AssetSelection {
  name: string;
  format: "binary" | "tar.gz" | "zip";
  /** Exact archive entry to read; only this file is extracted. */
  binaryPath?: string;
  /** Optional expected digest obtained from a trusted public source. */
  digest?: string;
}

export interface Platform {
  os: NodeJS.Platform;
  arch: string;
}

export interface ToolIdentity {
  name: string;
  repository: string;
  command?: string;
  source?: "github" | "nuget";
}

export type VersionPolicy = { mode: "latest" } | { mode: "fixed"; tag: string };

/** Cross-platform managers first: the order is the fallback priority. */
export const packageManagers = ["cargo", "brew"] as const;
export type PackageManager = (typeof packageManagers)[number];

/** Printed for the user to run; myre never runs another package manager. */
export function externalCommand(
  manager: PackageManager,
  packageName: string,
): string {
  return `${manager} install ${packageName}`;
}

export interface ToolDefinition extends ToolIdentity {
  description: string;
  /** Documentation entry point; defaults to `<command> --help`. */
  learn?: string;
  /** Package managers that provide this tool outside the catalog. */
  fallback?: Record<string, string>;
  version?: VersionPolicy;
  supports?(platform: Platform): boolean;
  acceptRelease?(release: Release): boolean;
  selectAssets(release: Release, platform: Platform): AssetSelection[];
  verifyArgs: string[];
}

export function platformKey(platform: Platform): string {
  const os =
    platform.os === "darwin"
      ? "macos"
      : platform.os === "win32"
        ? "windows"
        : platform.os;
  return `${os}-${platform.arch}`;
}

export function validateIdentity(tool: ToolIdentity): void {
  const command = tool.command ?? tool.name;
  if (
    (tool.source !== undefined &&
      tool.source !== "github" &&
      tool.source !== "nuget") ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(tool.name) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(command) ||
    ["receipt.json", "myre", "myre.exe"].includes(command.toLowerCase()) ||
    !/^[\w.-]+\/[\w.-]+$/.test(tool.repository) ||
    tool.repository.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error(`Invalid tool identity: ${tool.name}`);
}

/** Closed manager set with validated package names; never a command string. */
export function validateFallback(tool: {
  name: string;
  fallback?: Record<string, string>;
}): void {
  const fallback = tool.fallback;
  if (fallback === undefined) return;
  const entries = Object.entries(fallback);
  if (!entries.length || entries.length > packageManagers.length)
    throw new Error(`Invalid catalog fallback: ${tool.name}`);
  for (const [manager, packageName] of entries)
    if (
      !packageManagers.includes(manager as PackageManager) ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(packageName)
    )
      throw new Error(`Invalid catalog fallback: ${tool.name}`);
}

/** Inert documentation command: the tool's own executable plus plain arguments. */
export function learnCommand(tool: ToolIdentity & { learn?: string }): string {
  const command = tool.command ?? tool.name;
  const learn = tool.learn ?? `${command} --help`;
  const tokens = learn.split(" ");
  if (
    learn.length > 128 ||
    tokens[0] !== command ||
    tokens.some((token) => !/^-{0,2}[a-zA-Z0-9][\w.\/=:@,+-]*$/.test(token))
  )
    throw new Error(`Invalid documentation command: ${tool.name}`);
  return learn;
}

export function validateBinaryPath(entry: string): string {
  if (
    !entry ||
    entry.startsWith("/") ||
    entry.startsWith("-") ||
    /[\\:\x00\r\n*?\[\]{}!]/.test(entry) ||
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
