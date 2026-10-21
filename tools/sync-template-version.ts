// Run after `changeset version`: the bundled workflows name the version they ship in, so a copy taken straight from
// templates/ is never stale. `stamp init` pins the version it installs either way.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
for (const file of ["templates/stamp.yml", "templates/stamp-digest.yml"]) writeFileSync(file, readFileSync(file, "utf8").replace(/^(\s*STAMP_VERSION: )\S+/m, `$1${version}`));
