# Tool Catalog

Edit `tools.json`, increase its positive integer `revision`, and push to `main`.
The catalog workflow publishes `tools.json` to the mutable `catalog-v1` Release in this repository.
It does not build a CLI release. Keep the catalog Release as a prerelease, never Latest, and do not make it immutable.

## Schema 1

Each tool has `name`, `description`, `repository` (`owner/repo`), `verifyArgs`, and `platforms`.
Optional `command` defaults to `name`; Windows adds `.exe` when necessary.
Optional `source` is `github` (default) or `nuget`. NuGet entries require a fixed normalized package version and a SHA-256 digest for each ZIP asset; each asset `name` is a lowercase NuGet package ID, not a URL. Only the selected executable entry is extracted.
The Skill Tools table uses `description` as its task/scope, `command` (or `name`) as the executable, and `learn` as its documentation entry. Optional `learn` defaults to `<command> --help`; it must start with the tool's own command and may contain only plain arguments, as in `kuna install-skill --print`. It is rendered as text, never executed. Write descriptions as concise action phrases, such as `Analyze APK/DEX code` or `Download an APK for analysis`; there is no separate Skill tool list to maintain.
Optional `fallback` maps a package manager to the package name providing the tool where the catalog has no build: `{"cargo": "apkeep", "brew": "apkeep"}`. Managers are a closed set (`cargo`, `brew`), listed in priority order with cross-platform managers first, and values are plain package names rather than commands. myre never runs them: `install` prints the first available manager's command, `list` reports a matching executable found on PATH outside `MYRE_BIN_DIR` as `External`, and `update` or `uninstall` refuse to touch it. Only declare a package after confirming it is the same tool, since a name can belong to an unrelated package.
See [Skill synchronization](#skill-synchronization) for ownership and update behavior.
Optional `tagPrefix` both selects the release channel and strips that prefix for `{version}`.
Optional `numericVersion` requires the first character after the prefix to be a digit; it does not parse or compare semantic versions.
Without a prefix, `{version}` is the unchanged upstream tag.

### Version policy

`version` is optional; omit it or use `{"mode": "latest"}` to resolve the upstream Latest Release.
Use `{"mode": "fixed", "tag": "v1.2.3"}` to install only that exact Release tag. Fixed tags must satisfy `tagPrefix` and `numericVersion` when configured.

For fixed tools, `install --version` cannot override the catalog. `update` compares the installed tag with the catalog tag, without querying upstream Latest; changing the catalog tag makes it available for a confirmed update. `install` never upgrades an existing tool. If its executable is missing and the catalog now fixes a different tag, use `update` rather than repairing the old tag with the new asset rules.

A fixed tag alone does not guarantee immutable release assets. For integrity pinning, configure a trusted `digest` for every applicable asset and update the digests whenever the fixed tag changes.

Older clients that do not support `version` or `source` reject catalogs containing them and use their cache or bundled fallback. Upgrade myre before relying on fixed policies or NuGet packages. NuGet versions use the exact normalized package version, which can differ from the upstream GitHub Release tag; update the pinned version and all digests together.

Platform keys are `linux-x64`, `linux-arm64`, `macos-x64`, `macos-arm64`, and `windows-x64`.
This does not add new CLI distribution targets. Each platform specifies:

- `format`: `binary`, `tar.gz`, or `zip`.
- `binaryPath`: exact executable entry, required for archives.
- `assets`: ordered objects with `name` and optional `digest` (`sha256:<64 hex digits>`).

Asset names support `{tag}` and `{version}`. Archive paths also support `{assetStem}`:
the chosen asset name without `.tar.gz` or `.zip`. No expressions, scripts, arbitrary download URLs, or wildcards are accepted.
Verify upstream Releases and publishing workflows before changing these rules.

The runtime trusts this fixed GitHub source over HTTPS. Catalog documents are limited to 1 MiB and are schema-validated before use.
Older revisions and same-revision content changes cannot replace a valid newer cache.
Caching uses atomic replacement; concurrent refreshes do not overwrite each other while the cache lock is held.
Per-tool installation receipts remain authoritative for installed versions, ownership, and uninstalling, even if entries disappear or change ownership. Listing descriptions use the selected catalog when repository and command still match, and otherwise fall back to the receipt.
A repository or command change requires uninstalling the old installation before adopting the new definition.

## Skill synchronization

The CLI bundles the guide template and fallback catalog. `myre skill` and `myre skill install` use the newest valid cached or bundled catalog without network access, including in native binaries.

Installation adds a hidden checksum and catalog revision marker. Reinstalling updates only unmodified, myre-managed files. Symlinks, unmanaged files, and user edits are preserved; remove an old, unmarked Skill manually before reinstalling.

`install`, `update`, and `list --refresh` try to synchronize the installed Tools index using the same selected catalog, including validated fallbacks. They preserve the rest of the guide, never install a missing Skill, skip unchanged content, and refuse older revisions. Synchronization failures only warn and do not block tool operations.
