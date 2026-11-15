import { expect, test } from "bun:test";
import { diana, kuna } from "../src/tools";

test("Diana builds CLI asset candidates and rejects GUI release tags", () => {
  const release = {
    tag: "diana-v0.2.7",
    url: "https://github.com/TsingShui/Diana/releases/tag/diana-v0.2.7",
  };
  expect(diana.acceptRelease?.(release)).toBe(true);
  expect(diana.selectAssets(release, { os: "linux", arch: "x64" })[0]).toEqual({
    name: "diana-0.2.7-x86_64-unknown-linux-musl.tar.gz",
    format: "tar.gz",
    binaryPath: "diana",
  });
  expect(diana.acceptRelease?.({ tag: "diana-gui-v1", url: "" })).toBe(false);
  expect(diana.selectAssets(release, { os: "win32", arch: "x64" })[0]).toEqual({
    name: "diana-0.2.7-x86_64-pc-windows-msvc.zip",
    format: "zip",
    binaryPath: "diana.exe",
  });
});

test("Kuna prefers the musl CLI archive and provides a GNU fallback", () => {
  const release = {
    tag: "v1.998",
    url: "https://github.com/Noelo-Lab/kuna/releases/tag/v1.998",
  };
  expect(kuna.selectAssets(release, { os: "linux", arch: "x64" })).toEqual([
    {
      name: "kuna-v1.998-linux-x86_64-musl.tar.gz",
      format: "tar.gz",
      binaryPath: "kuna-v1.998-linux-x86_64-musl/kuna",
    },
    {
      name: "kuna-v1.998-linux-x86_64.tar.gz",
      format: "tar.gz",
      binaryPath: "kuna-v1.998-linux-x86_64/kuna",
    },
  ]);
  expect(kuna.selectAssets(release, { os: "win32", arch: "x64" })[0]).toEqual({
    name: "kuna-v1.998-windows-x86_64.zip",
    format: "zip",
    binaryPath: "kuna-v1.998-windows-x86_64/kuna.exe",
  });
});
