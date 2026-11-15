import { chmod, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import {
  assetName,
  commandName,
  packageName,
  platforms,
  type Platform,
} from "../npm/platforms";

const root = fileURLToPath(new URL("../", import.meta.url));
const registry = "https://registry.npmjs.org";
const repository = {
  type: "git",
  url: "git+https://github.com/TsingShui/myre.git",
  directory: "npm",
};

interface PackageFile {
  name: string;
  file: string;
  integrity: string;
}

interface Manifest {
  tag: string;
  version: string;
  packages: PackageFile[];
}

function validateVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(version)) {
    throw new Error("Invalid npm version.");
  }
}

function versionForTag(tag: string): string {
  if (tag === "dev") return "0.0.0-dev";
  if (!tag.startsWith("v")) throw new Error("Release tags must start with v.");
  const version = tag.slice(1);
  validateVersion(version);
  return version;
}

export async function npmCommand(): Promise<string[]> {
  const node = Bun.which("node");
  const npm = Bun.which(process.platform === "win32" ? "npm.cmd" : "npm");
  if (!node || !npm)
    throw new Error("Node.js 22+ and npm are required for npm packaging.");
  const cli =
    process.platform === "win32"
      ? join(dirname(npm), "node_modules/npm/bin/npm-cli.js")
      : await realpath(npm);
  if (!(await Bun.file(cli).exists()))
    throw new Error("Cannot locate npm-cli.js in this Node installation.");
  return [node, cli];
}

async function runNpm(args: string[], cwd: string, interactive = false) {
  const cmd = [...(await npmCommand()), ...args];
  if (interactive) {
    const child = Bun.spawn(cmd, {
      cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      timeout: 300_000,
    });
    return { status: await child.exited, stdout: "", stderr: "" };
  }
  const child = Bun.spawn(cmd, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 300_000,
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

async function integrity(path: string): Promise<string> {
  const hash = new Bun.CryptoHasher("sha512");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return `sha512-${hash.digest("base64")}`;
}

async function metadata(directory: string, value: object): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Bun.write(
    join(directory, "package.json"),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

/** Generate npm tarballs without downloading, publishing, or running install scripts. */
export async function buildPackages(
  output: string,
  version: string,
  binaries: ReadonlyMap<Platform, Uint8Array>,
): Promise<PackageFile[]> {
  validateVersion(version);
  await mkdir(output, { recursive: true });
  const staging = join(output, ".staging");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const config = join(staging, "npmrc");
  await Bun.write(config, "");
  const packages: PackageFile[] = [];
  const pack = async (name: string, directory: string) => {
    const result = await runNpm(
      [
        "pack",
        directory,
        "--pack-destination",
        output,
        "--json",
        "--ignore-scripts",
        "--offline",
        "--cache",
        join(output, ".cache"),
        "--userconfig",
        config,
      ],
      root,
    );
    if (result.status !== 0)
      throw new Error(`npm pack failed: ${result.stderr || result.stdout}`);
    const response = JSON.parse(result.stdout);
    // npm 12 keys results by package name; older versions return an array.
    const details = Array.isArray(response) ? response[0] : response?.[name];
    const file = `${name}-${version}.tgz`;
    if (
      details?.name !== name ||
      details?.version !== version ||
      details?.filename !== file
    ) {
      throw new Error(
        `npm pack returned unexpected package metadata: ${result.stdout}`,
      );
    }
    packages.push({
      name,
      file,
      integrity: await integrity(join(output, file)),
    });
  };

  for (const [platform, bytes] of binaries) {
    const target = platforms[platform];
    const name = packageName(platform);
    const directory = join(staging, name);
    await metadata(directory, {
      name,
      version,
      description: `Native myre executable for ${platform}.`,
      repository,
      files: ["bin"],
      os: [target.os],
      cpu: [target.arch],
      ...(target.os === "linux" ? { libc: "glibc" } : {}),
      publishConfig: { access: "public", registry },
    });
    const binary = join(directory, "bin", commandName(platform));
    await Bun.write(binary, bytes);
    if (process.platform !== "win32") await chmod(binary, 0o755);
    await Bun.write(
      join(directory, "README.md"),
      `# ${name}\n\nPlatform binary for [myre](https://github.com/TsingShui/myre). Install myre instead.\n`,
    );
    await pack(name, directory);
  }

  const directory = join(staging, "myre");
  await metadata(directory, {
    name: "myre",
    version,
    description: "A lightweight reverse-engineering CLI tool manager.",
    repository,
    type: "commonjs",
    engines: { node: ">=22" },
    files: ["bin"],
    bin: { myre: "bin/myre.cjs" },
    optionalDependencies: Object.fromEntries(
      (Object.keys(platforms) as Platform[]).map((platform) => [
        packageName(platform),
        version,
      ]),
    ),
    publishConfig: { access: "public", registry },
  });
  await mkdir(join(directory, "bin"), { recursive: true });
  const launcher = join(directory, "bin/myre.cjs");
  const result = await Bun.build({
    entrypoints: [join(root, "npm/cli.ts")],
    target: "node",
    format: "cjs",
    outdir: join(directory, "bin"),
    naming: "myre.cjs",
    define: { MYRE_VERSION: JSON.stringify(version) },
  });
  if (!result.success)
    throw new AggregateError(result.logs, "Cannot build the Node launcher.");
  if (process.platform !== "win32") await chmod(launcher, 0o755);
  await Bun.write(
    join(directory, "README.md"),
    await Bun.file(join(root, "README.md")).text(),
  );
  await pack("myre", directory);
  return packages;
}

async function pack(archives: string, output: string): Promise<void> {
  const tag = process.env.RELEASE_VERSION ?? "dev";
  const version = versionForTag(tag);
  const binaries = new Map<Platform, Uint8Array>();
  for (const platform of Object.keys(platforms) as Platform[]) {
    const data = await Bun.file(
      join(archives, assetName(platform, tag)),
    ).bytes();
    const command = commandName(platform);
    let bytes: Uint8Array | undefined;
    if (platforms[platform].os === "win32") {
      bytes = unzipSync(data, { filter: (file) => file.name === command })[
        command
      ];
    } else {
      const file = (await new Bun.Archive(data).files(command)).get(command);
      bytes = file ? new Uint8Array(await file.arrayBuffer()) : undefined;
    }
    if (!bytes?.byteLength)
      throw new Error(`Missing executable in ${assetName(platform, tag)}.`);
    binaries.set(platform, bytes);
  }
  const manifest: Manifest = {
    tag,
    version,
    packages: await buildPackages(output, version, binaries),
  };
  await Bun.write(
    join(output, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `Prepared ${manifest.packages.length} npm packages for ${version}.`,
  );
}

async function publish(directory: string): Promise<void> {
  const manifest: Manifest = await Bun.file(
    join(directory, "manifest.json"),
  ).json();
  const expected = [
    ...(Object.keys(platforms) as Platform[]).map(packageName),
    "myre",
  ];
  if (
    manifest.tag === "dev" ||
    manifest.version !== versionForTag(manifest.tag) ||
    (process.env.RELEASE_VERSION &&
      process.env.RELEASE_VERSION !== manifest.tag) ||
    !Array.isArray(manifest.packages) ||
    manifest.packages.length !== expected.length
  )
    throw new Error(
      "Invalid npm release manifest; preview packages cannot be published.",
    );
  for (const [index, pkg] of manifest.packages.entries()) {
    if (
      pkg.name !== expected[index] ||
      pkg.file !== `${pkg.name}-${manifest.version}.tgz` ||
      pkg.integrity !== (await integrity(join(directory, pkg.file)))
    ) {
      throw new Error("npm package order, filename, or integrity is invalid.");
    }
  }
  const tag = manifest.version.includes("-") ? "next" : "latest";
  for (const pkg of manifest.packages) {
    const existing = await runNpm(
      [
        "view",
        `${pkg.name}@${manifest.version}`,
        "dist.integrity",
        "--json",
        "--registry",
        registry,
      ],
      root,
    );
    if (existing.status === 0) {
      const response = JSON.parse(existing.stdout);
      const published =
        Array.isArray(response) && response.length === 1
          ? response[0]
          : response;
      if (published !== pkg.integrity)
        throw new Error(
          `Refusing to replace different published contents: ${pkg.name}@${manifest.version}.`,
        );
      console.log(`Already published: ${pkg.name}@${manifest.version}`);
      continue;
    }
    let code: string | undefined;
    try {
      code = JSON.parse(existing.stdout).error?.code;
    } catch {}
    if (code !== "E404")
      throw new Error(
        `Cannot query npm: ${existing.stderr || existing.stdout}`,
      );
    const result = await runNpm(
      [
        "publish",
        join(directory, pkg.file),
        "--access",
        "public",
        "--tag",
        tag,
        "--registry",
        registry,
      ],
      root,
      true,
    );
    if (result.status !== 0)
      throw new Error(
        `Publishing failed for ${pkg.name}; rerun with the same artifacts.`,
      );
  }
}

async function main(): Promise<void> {
  const [command, input, output] = Bun.argv.slice(2);
  if (command === "pack")
    await pack(
      resolve(input ?? join(root, "dist/release")),
      resolve(output ?? join(root, "dist/npm")),
    );
  else if (command === "publish" && !output)
    await publish(resolve(input ?? join(root, "dist/npm")));
  else
    throw new Error(
      "Usage: bun scripts/npm.ts pack [archives] [output] | publish [directory]",
    );
}

if (import.meta.main) await main();
