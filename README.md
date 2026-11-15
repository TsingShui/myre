# mere

A lightweight reverse-engineering CLI tool manager built with TypeScript and Bun.
Install and update tools from public GitHub Releases without an API token.

Supports [Diana](https://github.com/TsingShui/Diana) and [Kuna](https://github.com/Noelo-Lab/kuna) on Linux and macOS (x64 / arm64).

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

## Installation Paths

- Tools: `~/.mere/tools/`
- Command symlinks: `~/.local/bin/` — add this directory to PATH.
- Overrides: `MERE_HOME` and `MERE_BIN_DIR`.

Requires `tar` for tar.gz archives or `unzip` for zip archives. Existing unrelated commands are never overwritten.

## Development

```bash
bun test
bun run typecheck
```

Add tool definitions in `src/tools.ts`.
