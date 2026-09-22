#!/usr/bin/env node
/**
 * Generates `prisma/schema.dev.prisma` from `prisma/schema.prisma`.
 *
 * Why: this project targets PostgreSQL (production) and Prisma cannot read the
 * datasource `provider` from an env var. To let developers run the full stack
 * locally without a Postgres server we keep a second schema that is byte-for-byte
 * identical except for the datasource block.
 *
 * For that to be safe, the canonical schema deliberately avoids PostgreSQL-only
 * features (no enums, no String[], no Json, no @db.* native types, no fulltext).
 * Everything stored that way goes through `utils/json.js` helpers.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, 'prisma/schema.prisma');
const out = resolve(root, 'prisma/schema.dev.prisma');

if (!existsSync(src)) {
  console.error('[gen-dev-schema] prisma/schema.prisma not found — skipping.');
  process.exit(0);
}

const canonical = readFileSync(src, 'utf8');

const devDatasource = `datasource db {
  // ⚠️  GENERATED FILE — do not edit. Source: prisma/schema.prisma
  // Local development only. Production uses PostgreSQL.
  provider = "sqlite"
  url      = env("DATABASE_URL")
}`;

const datasourceRe = /datasource\s+db\s*\{[\s\S]*?\n\}/;
if (!datasourceRe.test(canonical)) {
  console.error('[gen-dev-schema] could not locate `datasource db` block — aborting.');
  process.exit(1);
}

const banner = `// ⚠️  GENERATED FILE — do not edit.
// Regenerate with: npm run postinstall  (or node tools/gen-dev-schema.mjs)
// Identical to prisma/schema.prisma except provider = "sqlite" + SQLITE_URL.
`;

const generated = banner + canonical.replace(datasourceRe, devDatasource);
writeFileSync(out, generated, 'utf8');
console.log(`[gen-dev-schema] wrote ${out.replace(root + '\\', '').replace(root + '/', '')}`);
