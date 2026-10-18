// Check generated HTML rather than guessing the framework's heading IDs and route rewriting.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../dist');
const base = (process.env.BASE ?? '/stamp').replace(/\/$/, '');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const html = files(root).filter((file) => file.endsWith('.html'));
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const ids = new Map(html.map((file) => [file, new Set([...readFileSync(file, 'utf8').matchAll(/\bid=["']([^"']+)["']/g)].map((m) => decode(m[1]!)))]));
const errors = new Set<string>();
let checked = 0;
for (const file of html) {
  for (const [, raw] of readFileSync(file, 'utf8').matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    const href = decode(raw!);
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue;
    const url = new URL(href, 'https://docs.invalid' + base + '/' + path.relative(root, file).replace(/index\.html$/, ''));
    if (url.pathname !== base && !url.pathname.startsWith(base + '/')) {
      errors.add(`${path.relative(root, file)}: outside base path: ${href}`);
      continue;
    }
    const targetPath = decodeURIComponent(url.pathname.slice(base.length));
    let target = path.join(root, targetPath);
    if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!existsSync(target)) errors.add(`${path.relative(root, file)}: missing target ${href}`);
    else if (url.hash && ids.has(target) && !ids.get(target)!.has(decodeURIComponent(url.hash.slice(1)))) errors.add(`${path.relative(root, file)}: missing anchor ${href}`);
    checked++;
  }
}
if (!html.length) errors.add('No built HTML pages found.');
if (errors.size) {
  console.error([...errors].join('\n'));
  process.exit(1);
}
console.log(`Built docs: ${html.length} HTML pages and ${checked} local links/assets checked.`);
