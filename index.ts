#!/usr/bin/env bun
import { ToolManager } from "./src/manager";
import { tools } from "./src/tools";

const help = `myre - reverse-engineering CLI tool manager

Usage:
  myre list
  myre install <tool> [--version <tag>]
  myre update <tool> [--yes]

list reads local state without network access.
install defaults to the public upstream Latest release.
update compares tags and shows release/compare links before confirmation.
Non-interactive updates require --yes. No GitHub API or token is used.
`;

type Command =
  | { name: "help" }
  | { name: "list" }
  | { name: "install"; tool: string; version?: string }
  | { name: "update"; tool: string; yes: boolean };

export function parseArgs(args: string[]): Command {
  if (
    args.length === 0 ||
    (args.length === 1 && ["--help", "-h"].includes(args[0]!))
  )
    return { name: "help" };
  const [command, tool, ...flags] = args;
  if (command === "list" && args.length === 1) return { name: "list" };
  if (command !== "install" && command !== "update")
    throw new Error(`Invalid command: ${command}`);
  if (!tool || tool.startsWith("-"))
    throw new Error(`${command} requires a tool name.`);
  if (command === "install") {
    if (flags.length === 0) return { name: "install", tool };
    if (
      flags.length === 2 &&
      flags[0] === "--version" &&
      flags[1] &&
      !flags[1].startsWith("-")
    ) {
      return { name: "install", tool, version: flags[1] };
    }
    throw new Error("install accepts only --version <tag>.");
  }
  if (
    flags.length > 1 ||
    (flags.length === 1 && !["--yes", "-y"].includes(flags[0]!))
  ) {
    throw new Error("update accepts only --yes or -y.");
  }
  return { name: "update", tool, yes: flags.length === 1 };
}

async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY)
    throw new Error(
      "Cannot confirm an update non-interactively; review the release and use --yes.",
    );
  return ["y", "yes"].includes(
    (prompt(`${message} [y/N]`) ?? "").trim().toLowerCase(),
  );
}

export async function main(args = Bun.argv.slice(2)): Promise<number> {
  try {
    const command = parseArgs(args);
    if (command.name === "help") {
      console.log(help);
      return 0;
    }
    const manager = new ToolManager(tools, { confirm });
    switch (command.name) {
      case "list": {
        const rows = await manager.list();
        if (!rows.length) {
          console.log(
            "No tools configured. Register tool definitions in src/tools.ts.",
          );
          break;
        }
        const labels = {
          installed: "Installed",
          "not-installed": "Not installed",
          broken: "Broken",
        };
        console.log(
          ["Tool", "Status", "Version", "Path", "Description"].join("\t"),
        );
        for (const row of rows) {
          console.log(
            [
              row.name,
              labels[row.status],
              row.version ?? "-",
              row.path ?? "-",
              row.description,
            ].join("\t"),
          );
          if (row.error) console.log(`  ${row.error}`);
        }
        break;
      }
      case "install":
        await manager.install(command.tool, { version: command.version });
        break;
      case "update":
        await manager.update(command.tool, { yes: command.yes });
        break;
    }
    return 0;
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
}

// This executable entry point must also start after a compiled binary is relocated.
process.exitCode = await main();
