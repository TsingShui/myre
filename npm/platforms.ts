export const platforms = {
  "linux-x64": { os: "linux", arch: "x64", target: "bun-linux-x64" },
  "linux-arm64": { os: "linux", arch: "arm64", target: "bun-linux-arm64" },
  "macos-arm64": { os: "darwin", arch: "arm64", target: "bun-darwin-arm64" },
  "windows-x64": { os: "win32", arch: "x64", target: "bun-windows-x64" },
} as const;

export type Platform = keyof typeof platforms;

export function platformKey(
  os: string = process.platform,
  arch: string = process.arch,
): Platform {
  const key = `${os === "darwin" ? "macos" : os === "win32" ? "windows" : os}-${arch}`;
  if (!Object.hasOwn(platforms, key))
    throw new Error(`Unsupported platform: ${os}/${arch}.`);
  return key as Platform;
}

export function packageName(platform: Platform): string {
  return `myre-${platform}`;
}

export function commandName(platform: Platform): string {
  return platforms[platform].os === "win32" ? "myre.exe" : "myre";
}

export function assetName(platform: Platform, tag: string): string {
  return `myre-${tag}-${platform}.${platforms[platform].os === "win32" ? "zip" : "tar.gz"}`;
}
