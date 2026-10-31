import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, 'src/index.ts')],
  outfile: path.join(here, 'dist/server.cjs'),
  bundle: true, platform: 'node', target: 'node18', format: 'cjs', sourcemap: true,
  alias: { '@suite/shared': path.join(here, '../shared/src/index.ts') },
  // database drivers and knex stay as normal dependencies (installed on the host)
  external: ['knex', 'mysql2', 'better-sqlite3', 'pg', 'sqlite3', 'tedious', 'oracledb', 'pg-query-stream'],
  banner: { js: "const import_meta_url = require('url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': 'import_meta_url' },
  logLevel: 'info',
});
