# myre

A lightweight reverse-engineering CLI tool manager built with TypeScript and Bun.
Install and update tools from public GitHub Releases without an API token.

## Quick Start

Once published to npm, use Node.js 22+:

```bash
npx myre@latest list
npx myre@latest install diana
npx myre@latest install kuna
npx myre@latest update diana
```

Use `install <tool> --version <tag>` for a specific release and `update <tool> --yes` for non-interactive updates.

## Tools

- [Diana](https://github.com/TsingShui/Diana)
- [Kuna](https://github.com/Noelo-Lab/kuna)

Supported platforms: Linux (glibc, x64 / arm64), macOS (arm64), Windows (x64).

## Installation Paths

- Tools: `~/.myre/tools/`
- Command symlinks: `~/.local/bin/` — add this directory to PATH.
- Overrides: `MYRE_HOME` and `MYRE_BIN_DIR`.

Installing tools needs no system `tar` or `unzip`. Existing unrelated commands are never overwritten.
Windows requires Developer Mode or symbolic-link privileges.

## Releases

Tag releases build four native targets and five npm packages. Manual workflow runs never publish.
See [npm publishing](docs/npm-publishing.md) for first-publish setup and opt-in CI publishing.

## Development

Requires Bun and Node.js 22+ with npm.

```bash
bun install
bun test
bun run typecheck
bun run build
./dist/myre list
```

Add tool definitions in `src/tools.ts`.
