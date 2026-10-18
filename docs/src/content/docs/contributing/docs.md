---
title: "Maintain the documentation"
---

Edit pages under `docs/src/content/docs/`. The Markdown files are the source for this site; keep the root README as a short introduction with links to the guides.

## Run the site

Use the Node version in the repository's `.node-version` file (24) for site development and CI. The documentation dependencies are separate from the CLI dependencies.

Run these commands from the Stamp repository root:

```bash
bun install --frozen-lockfile
bun install --cwd docs --frozen-lockfile
bun run docs:dev
```

Open the URL Astro prints. For a production preview:

```bash
bun run docs:build
bun run docs:preview
```

`docs:check` checks page links, navigation coverage, and configuration examples. `docs:build` runs those checks, builds the static site and search index, then checks local HTML links and anchors in the output. Search works in the production preview.

## Add a guide

Give the page a `title` in YAML frontmatter and add it to the sidebar in `docs/astro.config.mjs`. Use `/stamp/path/to/page/` for a site link. The remark plugin rewrites that prefix when `BASE` changes. Link source files to their GitHub URL rather than to an unpublished file path.

Show prerequisites, a command, the expected result and the next action. Label commands for the terminal or the coding agent. Use placeholders for credentials and organisation names.

For a complete configuration example, use a `yaml validate-config` fence. The checker validates it with Stamp's policy schema. Use a regular `yaml` fence for a fragment that belongs inside another file.

## Build and deployment

The Docs workflow validates pull requests and builds a Pages artifact. Pushes to `main` and manual workflow runs deploy to GitHub Pages. Choose **GitHub Actions** as the Pages source in repository settings.

`actions/configure-pages` supplies `SITE` and `BASE` on deployment. The default base is `/stamp`. You can check a root deployment with:

```bash
BASE=/ bun run docs:build
```

Keep docs dependencies in `docs/package.json` and commit `docs/bun.lock`. The CLI package does not need the site dependencies at runtime.
