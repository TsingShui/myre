import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";

import {
  platforms as targets,
  assetName as releaseAssetName,
  type Platform,
} from "../npm/platforms";

const root = fileURLToPath(new URL("../", import.meta.url));
const version = process.env.RELEASE_VERSION ?? "dev";

function assetName(platform: string): string {
  return releaseAssetName(platform as Platform, version);
}

async function run(args: string[], env = process.env): Promise<void> {
  const child = Bun.spawn(args, {
    cwd: root,
    env,
    stdout: "inherit",
    stderr: "inherit",
    timeout: 120_000,
  });
  if ((await child.exited) !== 0)
    throw new Error(`Command failed: ${args.join(" ")}`);
}

async function build(): Promise<void> {
  const platform = process.env.RELEASE_TARGET;
  if (!platform || !Object.hasOwn(targets, platform))
    throw new Error("Set RELEASE_TARGET to a supported platform.");
  const target = targets[platform as keyof typeof targets];
  if (process.platform !== target.os || process.arch !== target.arch) {
    throw new Error(
      `Build and smoke-test ${platform} on a matching native runner.`,
    );
  }
  const directory = join(root, "dist/build", platform);
  const output = join(root, "dist/release");
  const command = target.os === "win32" ? "myre.exe" : "myre";
  const executable = join(directory, command);
  await mkdir(directory, { recursive: true });
  await mkdir(output, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(root, "index.ts")],
    compile: {
      target: target.target,
      outfile: executable,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    minify: true,
  });
  if (!result.success)
    throw new AggregateError(result.logs, "Release compilation failed.");
  if (target.os !== "win32") await chmod(executable, 0o755);

  const temporary = await mkdtemp(join(tmpdir(), "myre-release-smoke-"));
  try {
    const env = {
      ...process.env,
      MYRE_HOME: join(temporary, "data"),
      MYRE_BIN_DIR: join(temporary, "bin"),
      XDG_CACHE_HOME: join(temporary, "cache"),
    };
    await run([executable, "--help"], env);
    await run([executable, "list"], env);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  const archive = join(output, assetName(platform));
  const bytes = await Bun.file(executable).bytes();
  let unpacked: Uint8Array | undefined;
  if (target.os === "win32") {
    const data = zipSync({ [command]: bytes });
    await Bun.write(archive, data);
    unpacked = unzipSync(data)[command];
  } else {
    // CI's host tar preserves executable mode; installation never invokes tar.
    await run(["tar", "-czf", archive, "-C", directory, command]);
    const files = await new Bun.Archive(await Bun.file(archive).bytes()).files(
      command,
    );
    const file = files.get(command);
    unpacked = file ? new Uint8Array(await file.arrayBuffer()) : undefined;
  }
  if (
    !unpacked ||
    new Bun.CryptoHasher("sha256").update(unpacked).digest("hex") !==
      new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
  ) {
    throw new Error("Packaged executable does not match the verified binary.");
  }
  console.log(`Created ${archive}`);
}

async function checksums(directory: string): Promise<void> {
  const expected = Object.keys(targets).map(assetName).sort();
  const files = (await readdir(directory))
    .filter((name) => name !== "SHA256SUMS")
    .sort();
  if (JSON.stringify(files) !== JSON.stringify(expected))
    throw new Error("Release assets are missing or unexpected.");
  const lines: string[] = [];
  for (const name of expected) {
    const hash = new Bun.CryptoHasher("sha256");
    for await (const chunk of Bun.file(join(directory, name)).stream())
      hash.update(chunk);
    lines.push(`${hash.digest("hex")}  ${name}`);
  }
  await Bun.write(join(directory, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  if (
    !/^(?:dev|v\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?)$/.test(
      version,
    )
  ) {
    throw new Error(
      "Release versions must be vMAJOR.MINOR.PATCH, optionally with a prerelease suffix.",
    );
  }
  const [command = "build", directory] = Bun.argv.slice(2);
  if (command === "build" && !directory) await build();
  else if (command === "checksums")
    await checksums(resolve(directory ?? join(root, "dist/release")));
  else
    throw new Error(
      "Usage: bun scripts/release.ts build | checksums [directory]",
    );
}

if (import.meta.main) await main();
