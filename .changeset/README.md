# Changesets

Add a changeset for every pull request that changes a public PoseCode package:

```bash
npm run changeset
```

Choose the affected package and the SemVer impact, then commit the generated
Markdown file with the code change. The five public packages are released as a
fixed group so their versions and internal dependency ranges stay aligned.

Changes that only affect tests, internal tooling, or the private playground do
not need a changeset.
