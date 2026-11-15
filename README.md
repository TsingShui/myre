# myre

A lightweight reverse-engineering CLI tool manager using public GitHub Releases.

## Install

Using [Bun](https://bun.sh):

```bash
bun install -g github:TsingShui/myre#main
```

Or use the native installer on Linux (glibc) and macOS (arm64):

```bash
curl -fsSL https://raw.githubusercontent.com/TsingShui/myre/main/install.sh | sh
```

Prebuilt binaries are also available on [GitHub Releases](https://github.com/TsingShui/myre/releases/latest).

## Usage

```bash
myre list                  # offline; --refresh fetches the catalog
myre install diana         # --version <tag> selects a release
myre install               # all supported tools
myre update diana          # --yes for non-interactive updates
myre uninstall diana
```

## Tools

- [Diana](https://github.com/TsingShui/Diana) — Analyze APK/DEX code.
- [Kuna](https://github.com/Noelo-Lab/kuna) — Analyze native binaries.
- [ilspycmd](https://github.com/TsingShui/ILSpy/releases) — Analyze .NET assemblies (NativeAOT builds of [ILSpy](https://github.com/icsharpcode/ILSpy); macOS builds are not notarized).
- [apkeep](https://github.com/EFForg/apkeep) — Download an APK for analysis (Linux/Windows).

## Agent Skill

```bash
myre skill                 # print the reverse guide
myre skill install         # ~/.agents/skills/myre/SKILL.md
```

Catalog refreshes sync the installed Skill's tool index without overwriting user edits. [Details](catalog/README.md#skill-synchronization).

## Catalog and Paths

`install` and `update` refresh the catalog with cached/bundled fallback. `list` and `uninstall` are offline by default.

Data: `~/.myre` (`MYRE_HOME`); commands: `~/.local/bin` (`MYRE_BIN_DIR`). Windows needs Developer Mode or symlink privileges.

Maintain tools through the [catalog](catalog/README.md), independently of CLI releases.

## Development

Requires Bun. Run `bun install`, `bun run typecheck`, and `bun run build`. Unit tests and smoke checks are prohibited.
