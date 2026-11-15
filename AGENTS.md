# Project Maintenance

## Code Layout

- `index.ts`: CLI parsing, output, confirmation, and dispatch.
- `catalog/tools.json`: Declarative tool definitions, Release filtering, and platform assets.
- `src/catalog.ts`: Catalog validation, templates, remote refresh, caching, and bundled fallback.
- `SKILL.md` and `src/skill.ts`: Static guidance, catalog-derived tool index, and managed Skill installation/synchronization.
- `src/tools.ts`: Tool interfaces and shared identity/path validation.
- `src/releases.ts`: Public GitHub Release links and asset downloads.
- `src/manager.ts`: Installation records, installation, updates, locking, and version switching.
- `install.sh`: Native CLI installer for Linux and macOS.
- `scripts/release.ts`: Native release builds, packaging, and checksums.
- `scripts/catalog.ts`: Independent catalog Release publication.
- `.github/workflows/`: Catalog publication and four-target native Release builds.
- `README.md`: Usage and development instructions.

## Conventions

- Use TypeScript and Bun. Prefer Bun and standard-library functionality over unnecessary dependencies or abstractions.
- Use English only for project-authored code, comments, documentation, CLI text.
- Keep `README.md` synchronized with command behavior.
- Format changed files with `bun fmt`.

## Maintaining Tools

- Register tools in `catalog/tools.json` and increase `revision` for content changes.
- Publish the catalog through its dedicated workflow; do not rebuild the CLI for compatible catalog changes.
- Verify upstream Releases and publishing workflows before changing asset names, supported platforms, archive paths, or verification commands.
- Derive versions from upstream Releases; do not hardcode the latest version or assume every tag follows semantic versioning.

## Safety Invariants

- Manage only myre-owned installations; never overwrite unrelated commands or modify shell configuration.
- Download, check integrity, and verify the executable before switching versions. Failures must preserve the existing installation.
- Switch executables and installation records together, and preserve per-tool locking.
- Check available Content-Length headers and configured expected SHA-256 digests. Read only the selected executable entry from archives.
- Use public GitHub Release URLs only, without REST API or authentication dependencies in the tool manager.
- Fetch catalog data only from the fixed public GitHub Release URL. Reject unsupported schemas, unsafe identities/paths, and executable catalog code.
- Keep listing and uninstalling offline by default, using local receipts even for tools removed from the catalog.
- Keep `catalog-v1` mutable and separate from Latest native CLI releases.

## Verification

Unit tests and smoke checks are prohibited. Do not add or run them, including `bun test` or CLI execution for verification.
Use only type checking and builds for verification:

```bash
bun run typecheck
bun run build
```
