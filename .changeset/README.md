# Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) to version
and publish the MCP server (`mcp-servers/jpyc-ec-purchase`).

## When you make a change worth releasing

```bash
npx changeset
```

Pick the package, the bump type (patch/minor/major), and write a short
description. Commit the generated markdown file in `.changeset/` along with
your code.

## How releases happen

The `.github/workflows/release.yml` workflow watches `main`. When changesets
are queued, it opens a PR titled "Version Packages" that bumps the version
and updates the changelog. Merging that PR triggers the actual `npm publish`
(via the `NPM_TOKEN` secret).
