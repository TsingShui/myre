import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { commandName, packageName, platformKey } from "../npm/platforms";
import { buildPackages, npmCommand } from "../scripts/npm";
import { diana, tools, type ToolDefinition } from "../src/tools";

test("npm CLI dispatches installs and uninstalls, reads ~/.myre/tools, and preserves exit codes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "myre-cli-test-~ "));
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
  const capture = async (args: string[]) => {
    const child = Bun.spawn(args, {
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
  const invoke = async (args: string[]) =>
    capture([...(await npmCommand()), ...args]);
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
            `file:${relative(consumer, join(output, pkg.file)).replaceAll("\\", "/")}`,
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

    const bin = join(directory, ".local/bin");
    await mkdir(bin, { recursive: true });
    const installedFixture = async (tool: ToolDefinition, tag: string) => {
      const name = tool.command ?? tool.name;
      const command = windows && !name.endsWith(".exe") ? `${name}.exe` : name;
      const root = join(directory, ".myre/tools", tool.name);
      const version = join(root, "versions/fixture");
      await mkdir(version, { recursive: true });
      await Bun.write(join(version, command), "local installation fixture");
      if (!windows) await chmod(join(version, command), 0o755);
      await Bun.write(
        join(version, "receipt.json"),
        JSON.stringify({
          schema: 1,
          tool: tool.name,
          command,
          repository: tool.repository,
          tag,
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
    };
    await installedFixture(diana, "diana-v0.2.7");

    const list = await run("list");
    if (list.exitCode !== 0 || !list.stdout) {
      const direct = await capture([executable, "list"]);
      throw new Error(
        `CLI startup failed: ${JSON.stringify({ npm: list, direct })}`,
      );
    }
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain(
      `diana\tInstalled\tdiana-v0.2.7\t${join(bin, command)}`,
    );
    expect(list.stdout).toContain("kuna");
    expect(list.stdout).toContain("Not installed");
    expect(list.stderr).toBe("");

    for (const tool of tools) {
      if (tool.name !== diana.name) await installedFixture(tool, "fixture");
    }
    for (const args of [[], ["-all"], ["--all"]]) {
      const installed = await run("install", ...args);
      expect(installed.exitCode).toBe(0);
      expect(installed.stderr).toBe("");
      for (const tool of tools)
        expect(installed.stdout).toContain(`${tool.name} is installed at `);
    }
    for (const flags of [[], ["--version", "diana-v0.2.7"]]) {
      const single = await run("install", "diana", ...flags);
      expect(single.exitCode).toBe(0);
      expect(single.stdout).toContain("diana is installed at diana-v0.2.7");
      expect(single.stdout).not.toContain("kuna");
    }
    const versionedAll = await run("install", "-all", "--version", "v1");
    expect(versionedAll.exitCode).toBe(1);
    expect(versionedAll.stderr).toContain("--version requires a single tool");

    const removed = await run("uninstall", "diana");
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toContain("diana uninstalled.");
    const remaining = await run("list");
    expect(remaining.stdout).toContain("diana\tNot installed");
    expect(remaining.stdout).toContain("kuna\tInstalled");
    expect((await run("uninstall", "diana")).stdout).toContain(
      "diana is not installed.",
    );
    const unnamed = await run("uninstall");
    expect(unnamed.exitCode).toBe(1);
    expect(unnamed.stderr).toContain("uninstall requires a tool name");
    expect((await run("uninstall", "--all")).exitCode).toBe(1);
    expect((await run("uninstall", "kuna", "--yes")).exitCode).toBe(1);

    await Bun.write(join(bin, command), "unrelated command");
    const blocked = await run("install");
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain("not owned by myre");
    expect(await Bun.file(join(bin, command)).text()).toBe("unrelated command");

    const invalid = await run("run", "diana");
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("Invalid command");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
