# Tool Catalog

Edit `tools.json`, increase its positive integer `revision`, and push to `main`.
The catalog workflow publishes `tools.json` to the mutable `catalog-v1` Release in this repository.
It does not build a CLI release. Keep the catalog Release as a prerelease, never Latest, and do not make it immutable.

## Schema 1

Each tool has `name`, `description`, `repository` (`owner/repo`), `verifyArgs`, and `platforms`.
Optional `command` defaults to `name`; Windows adds `.exe` when necessary.
Optional `tagPrefix` both selects the release channel and strips that prefix for `{version}`.
Optional `numericVersion` requires the first character after the prefix to be a digit; it does not parse or compare semantic versions.
Without a prefix, `{version}` is the unchanged upstream tag.

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
Per-tool installation receipts remain authoritative for offline listing and uninstalling, even if entries disappear or change ownership.
A repository or command change requires uninstalling the old installation before adopting the new definition.
