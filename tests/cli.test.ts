import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { commandName, packageName, platformKey } from "../npm/platforms";
import { buildPackages, npmCommand } from "../scripts/npm";

test("npm CLI uses the matching binary, reads ~/.myre/tools, and preserves exit codes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "myre-cli-test-"));
  const windows = process.platform === "win32";
  const command = windows ? "diana.exe" : "diana";
  const consumer = join(directory, "consumer");
  const cache = join(directory, "npm-cache");
  const config = join(directory, "npmrc");
  const env = {
    ...process.env,
    HOME: directory,
    USERPROFILE: directory,
    MYRE_HOME: undefined,
    MYRE_BIN_DIR: undefined,
    XDG_DATA_HOME: join(directory, "xdg"),
    XDG_CACHE_HOME: join(directory, "cache"),
    npm_config_update_notifier: "false",
  };
  const invoke = async (args: string[]) => {
    const child = Bun.spawn([...(await npmCommand()), ...args], {
      cwd: consumer,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  };
  const flags = [
    "--offline",
    "--cache",
    cache,
    "--userconfig",
    config,
    "--registry",
    "https://registry.npmjs.org",
  ];
  const run = (...args: string[]) =>
    invoke(["exec", ...flags, "--", "myre", ...args]);

  try {
    await mkdir(consumer, { recursive: true });
    await Bun.write(config, "");
    const platform = platformKey();
    const executable = join(directory, commandName(platform));
    const build = await Bun.build({
      entrypoints: [fileURLToPath(new URL("../index.ts", import.meta.url))],
      compile: {
        outfile: executable,
        autoloadDotenv: false,
        autoloadBunfig: false,
      },
    });
    if (!build.success)
      throw new AggregateError(
        build.logs,
        "Cannot compile the npm test binary.",
      );
    const output = join(directory, "npm");
    const packages = await buildPackages(
      output,
      "0.0.0-test",
      new Map([[platform, await Bun.file(executable).bytes()]]),
    );
    await Bun.write(
      join(consumer, "package.json"),
      JSON.stringify({
        private: true,
        dependencies: Object.fromEntries(
          packages.map((pkg) => [
            pkg.name,
            pathToFileURL(join(output, pkg.file)).href,
          ]),
        ),
      }),
    );
    const installed = await invoke([
      "install",
      ...flags,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
    if (installed.exitCode !== 0)
      throw new Error(installed.stderr || installed.stdout);
    expect(
      await Bun.file(
        join(consumer, "node_modules", packageName(platform), "package.json"),
      ).exists(),
    ).toBe(true);
    const main = await Bun.file(
      join(consumer, "node_modules/myre/package.json"),
    ).json();
    expect(Object.keys(main.optionalDependencies)).toHaveLength(4);
    expect(main.optionalDependencies["myre-macos-x64"]).toBeUndefined();

    const root = join(directory, ".myre/tools/diana");
    const version = join(root, "versions/fixture");
    const bin = join(directory, ".local/bin");
    await mkdir(version, { recursive: true });
    await mkdir(bin, { recursive: true });
    await Bun.write(join(version, command), "local installation fixture");
    if (!windows) await chmod(join(version, command), 0o755);
    await Bun.write(
      join(version, "receipt.json"),
      JSON.stringify({
        schema: 1,
        tool: "diana",
        command,
        repository: "TsingShui/Diana",
        tag: "diana-v0.2.7",
        installedAt: new Date().toISOString(),
      }),
    );
    const current = join(root, windows ? "current.exe" : "current");
    await symlink(
      windows
        ? join("versions", "fixture", command)
        : join("versions", "fixture"),
      current,
      windows ? "file" : "dir",
    );
    await symlink(
      windows ? current : join(current, command),
      join(bin, command),
      "file",
    );

    const list = await run("list");
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain(
      `diana\tInstalled\tdiana-v0.2.7\t${join(bin, command)}`,
    );
    expect(list.stdout).toContain("kuna");
    expect(list.stdout).toContain("Not installed");
    expect(list.stderr).toBe("");

    const invalid = await run("run", "diana");
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("Invalid command");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
