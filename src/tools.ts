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

export interface ToolDefinition extends ToolIdentity {
  description: string;
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
