# myre

A lightweight reverse-engineering CLI tool manager using public GitHub Releases.

## Quick Start

Install the native binary on Linux (glibc) or macOS (arm64):

```bash
curl -fsSL https://raw.githubusercontent.com/TsingShui/myre/main/install.sh | sh
```

Requires `curl`, `tar`, and `sha256sum` or `shasum`. Installs to `~/.local/bin` without overwriting an existing command; set `MYRE_INSTALL_DIR` to an absolute path to change the destination. Add it to PATH yourself.

Alternatively, install from GitHub with [Bun](https://bun.sh):

```bash
bun install -g github:TsingShui/myre#main
```

Bun must be on PATH; add its global bin directory (`bun pm bin -g`) too. Windows users can also download a native binary from [GitHub Releases](https://github.com/TsingShui/myre/releases/latest).

```bash
myre list --refresh
myre install                # all supported tools; -all and --all are aliases
myre install diana          # one tool; add --version <tag> for a specific release
myre update diana           # add --yes for non-interactive updates
myre uninstall diana
```

## Tools

- [Diana](https://github.com/TsingShui/Diana) — APK / DEX decompilation and static analysis.
- [Kuna](https://github.com/Noelo-Lab/kuna) — native binary decompilation.

## Catalog and Paths

`install` and `update` refresh the tool catalog, falling back to a cached or bundled copy. `list` and `uninstall` work offline; use `list --refresh` to fetch the catalog.

Tools and the catalog cache live in `~/.myre`; command links go in `~/.local/bin`. Override these with `MYRE_HOME` and `MYRE_BIN_DIR`. Windows requires Developer Mode or symbolic-link privileges.

To maintain tools, edit [catalog/tools.json](catalog/tools.json), increment `revision`, and push to `main`. The catalog publishes independently of CLI releases. See the [catalog format](catalog/README.md).

## Development

Requires Bun. Run `bun install`, `bun run typecheck`, and `bun run build`. Unit tests and smoke checks are prohibited.
