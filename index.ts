#!/usr/bin/env bun
import { ToolManager } from "./src/manager";
import { loadTools } from "./src/catalog";

const help = `myre - reverse-engineering CLI tool manager

Usage:
  myre list [--refresh]
  myre install [<tool> | --all | -all]
  myre install <tool> --version <tag>
  myre update <tool> [--yes]
  myre uninstall <tool>`;

type Command =
  | { name: "help" }
  | { name: "list"; refresh: boolean }
  | { name: "install"; tool?: string; version?: string }
  | { name: "update"; tool: string; yes: boolean }
  | { name: "uninstall"; tool: string };

export function parseArgs(args: string[]): Command {
  if (
    args.length === 0 ||
    (args.length === 1 && ["--help", "-h"].includes(args[0]!))
  )
    return { name: "help" };
  const [command, tool, ...flags] = args;
  if (command === "list") {
    if (args.length === 1) return { name: "list", refresh: false };
    if (args.length === 2 && tool === "--refresh")
      return { name: "list", refresh: true };
    throw new Error("list accepts only --refresh.");
  }
  if (!["install", "update", "uninstall"].includes(command!))
    throw new Error(`Invalid command: ${command}`);
  if (command === "install" && (!tool || ["--all", "-all"].includes(tool))) {
    if (flags.length)
      throw new Error(
        "Installing all tools does not accept extra arguments; --version requires a single tool.",
      );
    return { name: "install" };
  }
  if (!tool || tool.startsWith("-"))
    throw new Error(`${command} requires a tool name.`);
  if (command === "uninstall") {
    if (flags.length) throw new Error("uninstall accepts only a tool name.");
    return { name: "uninstall", tool };
  }
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
    const refresh =
      command.name === "install" ||
      command.name === "update" ||
      (command.name === "list" && command.refresh);
    const tools = await loadTools(refresh);
    const manager = new ToolManager(tools, { confirm });
    switch (command.name) {
      case "list": {
        const rows = await manager.list();
        if (!rows.length) {
          console.log(
            "No tools in the current catalog. Use myre list --refresh to refresh it.",
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
      case "install": {
        const names = command.tool
          ? [command.tool]
          : tools
              .filter(
                (tool) =>
                  !tool.supports ||
                  tool.supports({ os: process.platform, arch: process.arch }),
              )
              .map((tool) => tool.name);
        if (!names.length)
          throw new Error("No catalog tools support this platform.");
        for (const name of names)
          await manager.install(name, { version: command.version });
        break;
      }
      case "update":
        await manager.update(command.tool, { yes: command.yes });
        break;
      case "uninstall":
        await manager.uninstall(command.tool);
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
