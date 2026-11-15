# mere

A lightweight reverse-engineering CLI tool manager built with TypeScript and Bun.
Install and update tools from public GitHub Releases without an API token.

## Quick Start

```bash
bun install
bun run build

./dist/mere list
./dist/mere install diana
./dist/mere install kuna
./dist/mere update diana
```

Use `install <tool> --version <tag>` for a specific release and `update <tool> --yes` for non-interactive updates.

## Tools

- [Diana](https://github.com/TsingShui/Diana)
- [Kuna](https://github.com/Noelo-Lab/kuna)

Supported platforms: Linux and macOS (x64 / arm64).

## Installation Paths

- Tools: `~/.mere/tools/`
- Command symlinks: `~/.local/bin/` — add this directory to PATH.
- Overrides: `MERE_HOME` and `MERE_BIN_DIR`.

Archives are unpacked in-process; no system `tar` or `unzip` is required. Existing unrelated commands are never overwritten.

## Development

```bash
bun test
bun run typecheck
```

Add tool definitions in `src/tools.ts`.
