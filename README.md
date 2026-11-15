# myre

A lightweight reverse-engineering CLI tool manager built with TypeScript and Bun.
Install, update, and uninstall tools from public GitHub Releases without an API token.

## Quick Start

Download the archive for your platform from [GitHub Releases](https://github.com/TsingShui/myre/releases/latest),
extract `myre` (`myre.exe` on Windows), and place it on PATH. No Bun or Node.js is required to run it.

```bash
myre list --refresh
myre install
myre update diana
myre uninstall diana
```

`install` installs all tools supported on this platform; `install -all` and `install --all` are aliases.
Tools are installed sequentially, stopping on the first failure. Existing versions are not upgraded.
Use `install <tool>` for one tool, or `install <tool> --version <tag>` for a specific release.
Use `update <tool> --yes` for non-interactive updates. Uninstall requires a tool name.

## Tools

The bundled catalog includes [Diana](https://github.com/TsingShui/Diana) and [Kuna](https://github.com/Noelo-Lab/kuna).
Supported distributions: Linux (glibc, x64 / arm64), macOS (arm64), Windows (x64).

## Dynamic Catalog

`install` and `update` refresh the [remote tool catalog](https://github.com/TsingShui/myre/releases/download/catalog-v1/tools.json).
Network or validation failures retain the last valid cached or bundled catalog and print a warning.
`list` and `uninstall` stay offline; use `list --refresh` to explicitly refresh the list.
Removed catalog entries remain available for listing and uninstalling through local installation records.

Maintain [catalog/tools.json](catalog/tools.json) and increase `revision` when its contents change.
Pushing to `main` publishes the table independently through the catalog workflow, without rebuilding the CLI.
See [catalog format](catalog/README.md). The `catalog-v1` Release must stay mutable and is never marked Latest.

## Installation Paths

- Tools: `~/.myre/tools/`
- Catalog cache: `~/.myre/catalog.json`
- Command symlinks: `~/.local/bin/` — add this directory to PATH.
- Overrides: `MYRE_HOME` and `MYRE_BIN_DIR`.

Installing tools needs no system `tar` or `unzip`. Unrelated commands are never modified.
Windows requires Developer Mode or symbolic-link privileges.

## Development and Releases

Requires Bun. Verification uses type checking and builds only; unit tests and smoke checks are prohibited.

```bash
bun install
bun run typecheck
bun run build
```

Version tags build and publish four native archives with `SHA256SUMS`. Manual Release workflow runs do not publish.
