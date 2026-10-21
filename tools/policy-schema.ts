// Writes .stamp/policy.schema.json from PolicySchema. src/config.test.ts fails when the two drift.
import { writeFileSync } from "node:fs";
import { policyJsonSchema } from "../src/policy.ts";

writeFileSync(".stamp/policy.schema.json", `${JSON.stringify(policyJsonSchema(), null, 2)}\n`);
