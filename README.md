# mere

A personal reverse-engineering CLI tool manager built with TypeScript and Bun.
It provides **list / install / update**, without proxying tool execution or managing Skills.

## Development

```bash
bun install
bun run index.ts --help
bun run index.ts list
bun test                 # 10 core offline tests; archive fixtures require tar
bun run typecheck
bun run build
./dist/mere list
```

The compiled executable includes the Bun runtime; users do not need Bun or Node.
Installation supports Linux and macOS. Reading tar.gz archives requires tar; reading zip archives requires unzip.
Only the configured executable is extracted. Tools requiring companion files or complex installation steps are not supported yet.

## Commands

```bash
mere list
mere install diana
mere install kuna
mere install diana --version diana-v0.2.7
mere update diana
mere update kuna --yes
```

- `list` reads local records only and displays supported tools, installation status, versions, and command paths.
- `install` defaults to the public upstream Latest release. `--version` selects an exact tag, including a prerelease. Existing installations are not implicitly upgraded; missing commands or executables are repaired at their recorded version.
- `update` compares the installed tag with the tag selected by upstream Latest. It displays Release and compare links before asking for confirmation. Non-interactive updates require `--yes`.
- Cancelling an update does not download or replace the tool.
- mere manages only its own installations and refuses to overwrite unrelated commands.

## Public Releases Only

mere does not use the GitHub REST API, authentication, or tokens.

1. Send `HEAD https://github.com/<owner>/<repo>/releases/latest`.
2. Read the tag from the redirect's `Location`.
3. If the installed tag matches, finish without downloading.
4. Otherwise, show the public Release and compare links for review.
5. Download a configured asset directly from `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>`.

Asset candidates come from each tool's known publishing layout. Only HTTP 404 advances to the next candidate; other errors stop the operation.
A tag outside the tool's configured release channel is rejected rather than searching feeds or scraping pages.
A pinned installation uses the specified tag directly; its public asset must exist.

This avoids REST API quotas, not all GitHub website restrictions. HTTP 403/429 is reported without falling back to another endpoint to bypass limits.
Cross-version release notes are no longer collected automatically; the CLI provides links instead.
Tag equality does not detect assets replaced under the same tag, and no semantic version ordering or Release ID comparison is performed.
Older installation records containing a Release ID remain readable; that field is ignored.

### Download Checks

- Verify Content-Length when the download provides an unencoded length.
- Verify a SHA-256 digest when the tool definition supplies a trusted expected `digest`.
- Require a nonempty executable and a successful verification command before activation.

Diana and Kuna currently have **no configured expected digest**. Public asset downloads do not expose the REST API's asset digest, so these installs have no independent checksum verification.
The verification command is currently `--version`; only its exit status is checked, not the version text.
Only install from trusted repositories: verification executes the downloaded program.

## Supported Tools

| Tool    | Repository                                            | Assets                                                                   |
| ------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `diana` | [TsingShui/Diana](https://github.com/TsingShui/Diana) | Linux musl / macOS, x64 and arm64                                        |
| `kuna`  | [Noelo-Lab/kuna](https://github.com/Noelo-Lab/kuna)   | Linux / macOS, x64 and arm64; Linux x64 prefers musl with a GNU fallback |

Diana accepts `diana-v*` CLI tags. Kuna selects CLI archives rather than specs packages or Ghidra extensions.
Kuna Linux arm64 and GNU fallback binaries require glibc.
mere does not execute either tool's built-in Skill installation commands.

## Adding Tools

Add a TypeScript definition to `src/tools.ts`. Verify the actual upstream publishing layout first.

```ts
{
  name: "example",
  description: "Tool purpose",
  repository: "owner/repository",
  verifyArgs: ["--version"],
  selectAssets(release, platform) {
    if (platform.os !== "linux" || platform.arch !== "x64") {
      throw new Error("No assets configured for this platform.");
    }
    return [{
      name: `example-${release.tag}-linux-x64.tar.gz`,
      format: "tar.gz",
      binaryPath: "bin/example",
    }];
  },
}
```

`selectAssets` returns ordered candidates. `name` is an exact public asset filename; `binaryPath` is the exact archive entry, without wildcards.
Formats are `binary`, `tar.gz`, and `zip`.
Optional `command` changes the executable name; `acceptRelease` filters tags; `digest` on a candidate accepts an expected `sha256:<hex>` value.

## Local Files

Data defaults to `~/.mere`, with tool installations stored under `~/.mere/tools/`.
Command links default to `~/.local/bin`. Ensure that directory is on PATH; mere does not modify shell configuration.

```text
~/.mere/tools/<tool>/
├── versions/<unique-id>/
│   ├── <command>
│   └── receipt.json
└── current -> versions/<unique-id>

~/.local/bin/<command> -> .../<tool>/current/<command>
```

Downloads and verification happen in a temporary directory. A single atomic current-link switch activates the executable and its installation record together.
Failures preserve the current version. Old versions are retained; cleanup and rollback commands are not provided.

Override the base data directory with `MERE_HOME` (tools are stored under `$MERE_HOME/tools/`) and the command-link directory with `MERE_BIN_DIR`.
Per-tool lock files prevent concurrent changes. If a killed process leaves a lock behind, confirm that no operation is running before removing the lock named in the error message.
