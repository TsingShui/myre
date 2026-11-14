import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("CLI reads ~/.mere/tools by default and rejects unsupported commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mere-cli-test-"));
  const run = async (...args: string[]) => {
    const child = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(new URL("../index.ts", import.meta.url)),
        ...args,
      ],
      {
        env: {
          ...process.env,
          HOME: directory,
          MERE_HOME: undefined,
          MERE_BIN_DIR: undefined,
          XDG_DATA_HOME: join(directory, "xdg"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  };

  try {
    const root = join(directory, ".mere/tools/diana");
    const version = join(root, "versions/fixture");
    const bin = join(directory, ".local/bin");
    await mkdir(version, { recursive: true });
    await mkdir(bin, { recursive: true });
    await Bun.write(join(version, "diana"), "#!/bin/sh\nexit 0\n");
    await chmod(join(version, "diana"), 0o755);
    await Bun.write(
      join(version, "receipt.json"),
      JSON.stringify({
        schema: 1,
        tool: "diana",
        command: "diana",
        repository: "TsingShui/Diana",
        tag: "diana-v0.2.7",
        installedAt: new Date().toISOString(),
      }),
    );
    await symlink("versions/fixture", join(root, "current"));
    await symlink(join(root, "current/diana"), join(bin, "diana"));

    const list = await run("list");
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain(
      `diana\tInstalled\tdiana-v0.2.7\t${join(bin, "diana")}`,
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
});
