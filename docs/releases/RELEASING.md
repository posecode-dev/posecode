# Releasing PoseCode packages

PoseCode publishes five npm packages as one fixed-version release:

- `posecode-parser`
- `posecode-render`
- `posecode-share`
- `posecode-embed`
- `posecode-mcp`

The release workflow also publishes `packages/posecode-mcp/server.json` to the
official MCP Registry after npm publication succeeds.

The 0.3 release uses a mixed open-source model. `posecode-parser` and
`posecode-share` remain Apache-2.0. `posecode-render`, `posecode-embed`, and
`posecode-mcp` are AGPL-3.0-only with a separately negotiated commercial
option. Run the package checks to verify that each tarball contains the license
declared by its manifest.

## One-time repository setup

For each npm package above, configure an npm trusted publisher with:

- Provider: GitHub Actions
- Organization: `posecode-dev`
- Repository: `posecode`
- Workflow filename: `release.yml`
- Allowed action: npm publish

The workflow uses GitHub OIDC, so no long-lived npm token is required. In the
GitHub repository Actions settings, allow GitHub Actions to create pull
requests. The workflow also needs the permissions declared in
`.github/workflows/release.yml`.

## Normal release flow

1. Run `npm run changeset` in each pull request that changes a public package.
2. Merge the pull request into `main`.
3. Review the automatically maintained `chore: release packages` pull request.
4. Obtain explicit final approval for the irreversible npm and GitHub release.
5. Merge the release pull request only after that approval.
6. The next release workflow publishes the npm packages, creates GitHub
   releases, and updates the official MCP Registry through GitHub OIDC.

The first run can be started from the Actions tab with **Release packages → Run
workflow** after trusted publishing is configured. If changesets are waiting,
merge the generated release pull request; the following run publishes every
local package version that is newer than npm.

## Local verification

```bash
npm ci
npm run typecheck
npm run build:packages
npm run check:packages
npm test
```

`npm run check:packages` fails if public package versions drift, built entry
points are missing from a tarball, internal dependency versions disagree, or
the MCP Registry manifest does not match `posecode-mcp`.
