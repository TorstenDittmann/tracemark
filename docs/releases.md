# npm releases

The 10 public packages under `packages/` share a version and are published publicly to npmjs.com. `@tracemark/errors` and `@tracemark/flags` stay private: their code is bundled into the SDKs. The app, Python SDK and Go SDK are not part of this release.

## First release: 0.1.0

1. Create or join the `tracemark` organization on npmjs.com. Your account must have permission to create and publish its packages. Public scoped packages are free.
2. Use Node.js 24 LTS, npm 11.5.1+ and Bun 1.4+.
3. Sign in interactively; do not put npm tokens in the repository:

   ```sh
   npm login --registry=https://registry.npmjs.org/
   npm whoami --registry=https://registry.npmjs.org/
   ```

4. Validate and publish from the repository root:

   ```sh
   bun install --frozen-lockfile
   bun run check
   bun run test:release
   bun run --filter './packages/*' typecheck
   bun run --filter './packages/*' test
   bun run release:check
   bun run --filter '@tracemark/browser' size
   bun run release:publish
   ```

   Approve any npm authentication/2FA prompts. The release helper builds the packages and stages only `dist/`, each package's README and manifest, and the root MIT license. It checks packed exports and publishes the checked tarballs in dependency order. Don't use `npm publish --workspaces`: that would include private workspaces and bypass these checks. Publishing is not atomic; if a release fails partway through, fix the cause and rerun it. Already published versions are skipped, not overwritten.

If using Node.js 26 locally, its experimental Web Storage conflicts with the browser test environment. Run tests with `NODE_OPTIONS=--no-experimental-webstorage`; the release workflow uses Node.js 24 instead.

## Enable token-free GitHub publishing

After the first local publish, open **Settings → Trusted publishing** on npmjs.com for **each** public package and add GitHub Actions:

- Organization or user: `TorstenDittmann`
- Repository: `tracemark`
- Workflow filename: `npm.yml`
- Environment name: leave empty
- Allow direct publishing with `npm publish`

The workflow uses GitHub-hosted runners, `id-token: write` and npm OIDC, with automatic provenance for a public repository. No `NPM_TOKEN` secret is needed. npm requires a newly configured trusted publisher to complete a successful publish within two days; configure it shortly before the next release, or recreate it if it expires.

## Subsequent stable releases

```sh
bun run release:version 0.2.0
bun install
bun run release:check
```

The version command updates public manifests, internal runtime/peer ranges and both SDK version constants. Private package versions stay unchanged. Review and commit the changes, including `bun.lock`, then push the commit and a matching release tag:

```sh
git tag npm-v0.2.0
git push origin main
git push origin npm-v0.2.0
```

Only create the tag after configuring every package's trusted publisher. The workflow checks the tag against all package versions, runs lint, package type checks, tests, tarball validation and browser size budgets, then publishes with the `latest` dist-tag. Re-run a failed workflow to resume a partial release.

`npm-v*` tags are separate from the `v*` tags used for container images. This release helper intentionally accepts stable versions only; prereleases need a separate dist-tag policy before publishing.
