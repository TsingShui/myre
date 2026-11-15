# myre

A lightweight reverse-engineering CLI tool manager built with TypeScript and Bun.
Install, update, and uninstall tools from public GitHub Releases without an API token.

## Quick Start

Requires Node.js 22+:

```bash
npx myre@latest list
npx myre@latest install
npx myre@latest update diana
```

`install` installs all tools; `install -all` and `install --all` are explicit aliases.
Tools are installed sequentially, stopping on the first failure. Already installed tools are not upgraded.
Use `install <tool>` for one tool, or `install <tool> --version <tag>` for a specific release.
Use `update <tool> --yes` for non-interactive updates.

`uninstall <tool>` removes that tool's managed versions and command link without network access.
A tool name is required for uninstalling.

## Tools

- [Diana](https://github.com/TsingShui/Diana)
- [Kuna](https://github.com/Noelo-Lab/kuna)

Supported platforms: Linux (glibc, x64 / arm64), macOS (arm64), Windows (x64).

## Installation Paths

- Tools: `~/.myre/tools/`
- Command symlinks: `~/.local/bin/` — add this directory to PATH.
- Overrides: `MYRE_HOME` and `MYRE_BIN_DIR`.

Installing tools needs no system `tar` or `unzip`. Existing unrelated commands are never modified.
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
