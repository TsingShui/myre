# Project Maintenance

## Code Layout

- `index.ts`: CLI parsing, output, confirmation, and dispatch.
- `src/tools.ts`: Tool definitions, Release filtering, and platform asset selection.
- `src/releases.ts`: Public GitHub Release links and asset downloads.
- `src/manager.ts`: Installation records, installation, updates, locking, and version switching.
- `tests/`: Core offline tests.
- `npm/`: Node-only launcher and supported distribution platforms.
- `scripts/release.ts`: Native release builds, packaging, and checksums.
- `scripts/npm.ts`: npm package generation and ordered publishing.
- `.github/workflows/release.yml`: Four-target verification and Release publishing.
- `README.md`: Usage and development instructions.

## Conventions

- Use TypeScript and Bun. Prefer Bun and standard-library functionality over unnecessary dependencies or abstractions.
- Use English only for project-authored code, comments, documentation, CLI text, and tests.
- Keep `README.md` synchronized with command behavior.
- Format changed files with `bun fmt`.

## Maintaining Tools

- Register tools in `src/tools.ts`.
- Verify upstream Releases and publishing workflows before changing asset names, supported platforms, archive paths, or verification commands.
- Derive versions from upstream Releases; do not hardcode the latest version or assume every tag follows semantic versioning.

## Safety Invariants

- Manage only myre-owned installations; never overwrite unrelated commands or modify shell configuration.
- Download, check integrity, and verify the executable before switching versions. Failures must preserve the existing installation.
- Switch executables and installation records together, and preserve per-tool locking.
- Check available Content-Length headers and configured expected SHA-256 digests. Read only the selected executable entry from archives.
- Use public GitHub Release URLs only, without REST API or authentication dependencies in the tool manager.
- Publish platform npm packages before the main package. Publish generated tarballs, never the private repository root.

## Verification

After code changes, run:

```bash
bun test
bun run typecheck
bun run build
./dist/myre list
```

Maintain the 10 focused core offline tests using simulated Releases and temporary files.
For live installation checks, isolate `MYRE_HOME`, `MYRE_BIN_DIR`, and `XDG_CACHE_HOME` in temporary directories and clean up afterward.
