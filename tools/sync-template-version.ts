// Run after `changeset version`: the bundled workflows name the version they ship in, so a copy taken straight from
// templates/ is never stale. `stamp init` pins the version it installs either way. The policies' schema link pins it too.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const sync = (file: string, re: RegExp) => writeFileSync(file, readFileSync(file, "utf8").replace(re, `$1${version}`));
for (const file of ["templates/stamp.yml", "templates/stamp-digest.yml"]) sync(file, /^(\s*STAMP_VERSION: )\S+/m);
for (const file of [".stamp/policy.yml", "templates/policy-strict.yml"]) sync(file, /(\$schema=https:\/\/unpkg\.com\/@jagreehal\/stamp@)[^/]+/);
