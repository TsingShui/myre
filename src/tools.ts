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

export interface ToolDefinition {
  name: string;
  description: string;
  repository: string;
  command?: string;
  acceptRelease?(release: Release): boolean;
  selectAssets(release: Release, platform: Platform): AssetSelection[];
  verifyArgs: string[];
}

function architecture(platform: Platform): "x86_64" | "aarch64" {
  if (platform.arch === "x64") return "x86_64";
  if (platform.arch === "arm64") return "aarch64";
  throw new Error(`Unsupported CPU architecture: ${platform.arch}`);
}

function archives(
  names: string[],
  binaryPath: (name: string) => string,
): AssetSelection[] {
  return names.map((name) => ({
    name,
    format: "tar.gz",
    binaryPath: binaryPath(name),
  }));
}

export const diana: ToolDefinition = {
  name: "diana",
  description: "APK / DEX decompilation and static analysis",
  repository: "TsingShui/Diana",
  verifyArgs: ["--version"],
  acceptRelease: (release) => /^diana-v\d/.test(release.tag),
  selectAssets(release, platform) {
    const arch = architecture(platform);
    const os =
      platform.os === "linux"
        ? "unknown-linux-musl"
        : platform.os === "darwin"
          ? "apple-darwin"
          : undefined;
    if (!os)
      throw new Error(`Unsupported operating system for Diana: ${platform.os}`);
    const target = `${arch}-${os}`;
    const version = release.tag.replace(/^diana-v/, "");
    return archives(
      [
        `diana-${version}-${target}.tar.gz`,
        `diana-v${version}-${target}.tar.gz`,
        `diana-${target}.tar.gz`,
      ],
      () => "diana",
    );
  },
};

export const kuna: ToolDefinition = {
  name: "kuna",
  description: "Native binary decompilation",
  repository: "Noelo-Lab/kuna",
  verifyArgs: ["--version"],
  selectAssets(release, platform) {
    const arch = architecture(platform) === "aarch64" ? "arm64" : "x86_64";
    const targets =
      platform.os === "linux"
        ? arch === "x86_64"
          ? ["linux-x86_64-musl", "linux-x86_64"]
          : ["linux-arm64"]
        : platform.os === "darwin"
          ? [`macos-${arch}`]
          : [];
    if (!targets.length)
      throw new Error(`Unsupported operating system for Kuna: ${platform.os}`);
    return archives(
      targets.map((target) => `kuna-${release.tag}-${target}.tar.gz`),
      (name) => `${name.slice(0, -".tar.gz".length)}/kuna`,
    );
  },
};

export const tools: ToolDefinition[] = [diana, kuna];
