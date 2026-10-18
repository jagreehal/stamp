// Check the documentation without executing its example commands or fetching placeholder packs.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { PolicySchema } from '../../src/policy.ts';

const root = path.resolve(import.meta.dir, '../..');
const content = path.join(root, 'docs/src/content/docs');
const project = 'stamp';
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const pages = files(content).filter((file) => file.endsWith('.md'));
const routes = new Set(pages.map((file) => path.relative(content, file).replace(/\.md$/, '').replace(/^index$/, '')));
const sidebar = readFileSync(path.join(root, 'docs/astro.config.mjs'), 'utf8');
const listed = new Set([...sidebar.matchAll(/"slug":\s*"([^"]*)"/g)].map((match) => match[1]));
const problems: string[] = [];
const reference = readFileSync(path.join(content, 'reference/configuration.md'), 'utf8');
for (const field of Object.keys(PolicySchema.shape)) {
  if (!reference.includes('`' + field + '`') && !reference.includes('`' + field + '.')) problems.push(`configuration reference omits schema field: ${field}`);
}

let examples = 0;
for (const route of routes) if (!listed.has(route)) problems.push(`page missing from navigation: ${route || 'index'}`);
for (const route of listed) if (!routes.has(route!)) problems.push(`navigation points to a missing page: ${route}`);
for (const file of [...pages, path.join(root, 'README.md')]) {
  const text = readFileSync(file, 'utf8');
  if (file !== path.join(root, 'README.md')) {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text);
    if (!frontmatter || typeof parse(frontmatter[1]!).title !== 'string') problems.push(`${file}: missing title`);
  }
  // Code examples can contain Markdown links as data; check prose links separately.
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
  for (const [, label, href] of prose.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    if (!href) continue;
    const source = `https://github.com/jagreehal/${project}/blob/main/`;
    if (href.startsWith(source)) {
      const repoPath = decodeURIComponent(href.slice(source.length).split(/[?#]/)[0]!);
      if (!existsSync(path.join(root, repoPath))) problems.push(`${file}: missing repository source ${href}`);
    }
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) continue;
    const target = href.split(/[?#]/)[0]!;
    if (target.startsWith(`/${project}/`)) {
      const route = target.slice(project.length + 2).replace(/\/$/, '');
      if (!routes.has(route)) problems.push(`${file}: missing page ${href} (${label})`);
    } else if (target.startsWith('/')) problems.push(`${file}: link bypasses project base: ${href}`);
    else if (!existsSync(path.resolve(path.dirname(file), target))) problems.push(`${file}: missing file ${href}`);
  }
  for (const [, code] of text.matchAll(/^```yaml validate-config\n([\s\S]*?)^```/gm)) {
    try {
      PolicySchema.parse(parse(code));
      examples++;
    } catch (error) {
      problems.push(`${file}: invalid configuration example: ${error}`);
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Docs: ${pages.length} pages, navigation and source links checked; ${examples} configuration examples validated.`);
