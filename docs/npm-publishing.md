# npm Publishing

## Packages

- `myre`: Node.js launcher with four exact-version optional dependencies.
- `myre-linux-x64` and `myre-linux-arm64`: glibc Linux binaries.
- `myre-macos-arm64`: Apple Silicon binary.
- `myre-windows-x64`: Windows binary.

npm selects packages through `os`, `cpu`, and Linux `libc` metadata.
The launcher only resolves and executes the installed binary; it never downloads from GitHub or maintains another cache.
Do not omit optional dependencies. macOS x64 is not supported.

## First Publication

The repository root stays private. CI generates the publishable packages from verified Release binaries.
No npm account or publishing rights are assumed, and automatic npm publishing starts disabled.

1. Push a version tag such as `v0.1.0` after the workflow is committed.
2. Wait for the four native builds, npm packaging, and GitHub Release publication to succeed.
3. Download the `npm-packages` workflow artifact:

   ```bash
   gh run download <run-id> -n npm-packages -D dist/npm
   ```

4. From the source checkout, log in with your own npm account and publish:

   ```bash
   npm login --registry=https://registry.npmjs.org
   bun run scripts/npm.ts publish dist/npm
   ```

The script verifies all five tarballs before publishing. Platform packages go first; `myre` goes last.
Names must be available or owned by your account. Preview artifacts from manual runs cannot be published.

## Trusted Publishing

After the first publication, configure a GitHub Actions Trusted Publisher in the npm settings of **each of the five packages**:

- Owner: `TsingShui`
- Repository: `myre`
- Workflow filename: `release.yml`
- Environment: leave unset.

Then set the GitHub repository variable `NPM_PUBLISH_ENABLED` to `true`.
Subsequent tag releases publish through OIDC after the GitHub Release succeeds.
No long-lived npm token is stored in the repository or CI secrets.
The workflow uses Node.js 24, a pinned npm CLI, and `id-token: write`.

If publishing fails partway, rerun only the failed npm publishing job with its original artifacts.
Identical published versions are skipped; different contents at the same version are rejected.
Stable versions use `latest`; prereleases use `next`.

See [npm's trusted publishing requirements](https://docs.npmjs.com/trusted-publishers/) before enabling CI publishing.
