#!/usr/bin/env node
/**
 * Deletes the local SQLite dev database so `npm run db:dev:push` starts clean.
 * Refuses to touch anything that is not the local dev file.
 */
import { existsSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['prisma/dev.db', 'prisma/dev.db-journal'];

for (const f of files) {
  const p = resolve(root, f);
  if (!existsSync(p)) continue;
  const size = statSync(p).size;
  rmSync(p, { force: true });
  console.log(`[db-reset] removed ${f} (${size} bytes)`);
}
console.log('[db-reset] done. Run: npm run db:dev:push');
