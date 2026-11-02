import knexFactory, { type Knex } from 'knex';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const canLoad = (m: string) => { try { req(m); return true; } catch { return false; } };

/**
 * SQLite without native add-ons: if better-sqlite3 is not installed (e.g. very new Node.js on Windows),
 * use Node's built-in `node:sqlite` through the same Knex dialect.
 */
function builtinSqliteClient() {
  const { DatabaseSync } = req('node:sqlite');
  const Base = req('knex/lib/dialects/better-sqlite3');
  class Shim {
    db: any;
    constructor(file: string) { this.db = new DatabaseSync(file); }
    prepare(sql: string) {
      const st = this.db.prepare(sql);
      const reader = typeof st.columns === 'function' ? st.columns().length > 0 : /^\s*(select|pragma|with|explain)\b|\breturning\b/i.test(sql);
      return { reader, safeIntegers() { /* not needed */ }, all: (b: unknown[]) => st.all(...(b ?? [])), run: (b: unknown[]) => st.run(...(b ?? [])) };
    }
    pragma(s: string) { this.db.exec(`PRAGMA ${s}`); }
    close() { this.db.close(); }
  }
  return class BuiltinSqliteClient extends Base { _driver() { return Shim; } };
}

/**
 * Database: SQLite for local development and demos, MySQL/MariaDB on cPanel hosting.
 * Set DB_CLIENT=mysql and MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE in production.
 * JSON values are stored as text so the same schema works on both.
 */
export function createDb(): Knex {
  const client = process.env.DB_CLIENT || 'sqlite';
  if (client === 'mysql') {
    return knexFactory({
      client: 'mysql2',
      connection: {
        host: process.env.MYSQL_HOST || 'localhost',
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        charset: 'utf8mb4',
        dateStrings: true,
      },
      pool: { min: 0, max: 5 },
    });
  }
  const file = process.env.DATABASE_FILE || path.resolve(process.cwd(), 'data', 'suite.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const useBuiltin = process.env.SQLITE_DRIVER === 'builtin' || !canLoad('better-sqlite3');
  if (useBuiltin) console.log('Using the built-in Node.js SQLite engine');
  return knexFactory({
    client: (useBuiltin ? builtinSqliteClient() : 'better-sqlite3') as any,
    connection: { filename: file },
    useNullAsDefault: true,
    pool: { afterCreate: (conn: { pragma: (s: string) => void }, done: () => void) => { conn.pragma('foreign_keys = ON'); conn.pragma('journal_mode = WAL'); done(); } },
  });
}

export const db = createDb();

type Migration = { id: string; up: (k: Knex) => Promise<void> };

const json = (t: Knex.CreateTableBuilder, name: string) => t.text(name, 'longtext');
const ts = (t: Knex.CreateTableBuilder) => { t.string('created_at', 32); };

const migrations: Migration[] = [
  {
    id: '001_core',
    up: async (k) => {
      await k.schema.createTable('companies', (t) => { t.increments('id'); t.string('name', 200).notNullable(); json(t, 'data'); ts(t); });
      await k.schema.createTable('users', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable().references('companies.id');
        t.string('name', 120).notNullable(); t.string('email', 190).notNullable().unique(); t.string('password_hash', 120).notNullable();
        t.string('role', 30).notNullable(); t.string('designation', 120); t.text('qualifications'); t.string('phone', 40);
        t.text('signature', 'longtext'); t.boolean('active').defaultTo(true); ts(t);
      });
      await k.schema.createTable('clients', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable().references('companies.id');
        t.string('name', 200).notNullable(); t.string('short_code', 20); t.string('type', 30).defaultTo('company');
        t.string('gstin', 20); t.string('state_code', 4); t.string('pan', 20); t.text('address');
        t.string('email', 190); t.string('phone', 40); t.integer('payment_terms_days').unsigned().defaultTo(30);
        t.decimal('opening_balance', 14, 2).defaultTo(0); t.text('notes'); json(t, 'data'); ts(t);
        t.index(['company_id', 'name']);
      });
      await k.schema.createTable('sites', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.integer('client_id').unsigned().notNullable().references('clients.id');
        t.string('name', 200).notNullable(); t.text('address'); t.string('project', 200); t.string('po_number', 80); t.string('state_code', 4); json(t, 'data'); ts(t);
      });
      await k.schema.createTable('contacts', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.integer('client_id').unsigned().notNullable().references('clients.id');
        t.integer('site_id').unsigned().nullable(); t.string('name', 120).notNullable(); t.string('role', 80); t.string('phone', 40); t.string('email', 190);
        json(t, 'receives'); ts(t);
      });
      await k.schema.createTable('catalog', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.string('code', 40); t.string('material', 60);
        t.text('billing_name').notNullable(); t.string('report_name', 200); t.string('method', 200); t.boolean('nabl').defaultTo(false);
        t.string('unit', 40).defaultTo('Per sample'); t.decimal('rate', 14, 2).defaultTo(0); t.string('sac', 12).defaultTo('998346');
        t.decimal('gst_rate', 5, 2).defaultTo(18); t.text('conditions'); t.text('report_notes'); t.string('obs_template_code', 60);
        t.integer('tat_days').unsigned(); t.boolean('active').defaultTo(true); ts(t);
      });
      await k.schema.createTable('equipment', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.string('name', 160).notNullable(); t.string('category', 80);
        t.string('id_no', 60); t.string('make', 120); json(t, 'data'); t.string('cert_no', 120); t.string('cal_date', 10); t.string('due_date', 10);
        t.boolean('active').defaultTo(true); ts(t);
      });
      await k.schema.createTable('obs_templates', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.string('code', 60).notNullable(); t.integer('version').unsigned().notNullable();
        json(t, 'definition'); t.boolean('active').defaultTo(true); ts(t); t.unique(['company_id', 'code', 'version']);
      });
      await k.schema.createTable('doc_templates', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.string('kind', 20).notNullable(); t.integer('version').unsigned().notNullable();
        t.string('name', 160); json(t, 'definition'); t.boolean('is_default').defaultTo(false); ts(t);
      });
      await k.schema.createTable('counters', (t) => {
        t.integer('company_id').unsigned().notNullable(); t.string('kind', 20).notNullable(); t.string('scope', 20).notNullable(); t.integer('value').unsigned().notNullable();
        t.primary(['company_id', 'kind', 'scope']);
      });
      await k.schema.createTable('work_orders', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.string('number', 60); t.integer('client_id').unsigned().notNullable().references('clients.id');
        t.integer('site_id').unsigned().nullable(); t.integer('quote_id').unsigned().nullable(); t.string('date', 10); t.string('status', 20).defaultTo('open');
        t.string('customer_ref', 200); t.text('notes'); ts(t);
      });
      await k.schema.createTable('documents', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.string('kind', 20).notNullable(); t.string('number', 60);
        t.string('status', 20).notNullable().defaultTo('draft'); t.integer('client_id').unsigned().nullable(); t.integer('site_id').unsigned().nullable();
        t.integer('work_order_id').unsigned().nullable(); t.integer('parent_id').unsigned().nullable(); t.integer('revision').unsigned().defaultTo(0);
        t.string('date', 10); json(t, 'data'); json(t, 'overrides'); t.integer('template_id').unsigned(); json(t, 'totals'); t.decimal('total', 14, 2).defaultTo(0);
        t.string('issued_at', 32); t.integer('issued_by').unsigned(); t.string('hash', 80); t.integer('created_by').unsigned(); ts(t); t.string('updated_at', 32);
        t.index(['company_id', 'kind', 'status']);
      });
      await k.schema.createTable('samples', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.integer('work_order_id').unsigned().nullable(); t.integer('client_id').unsigned().notNullable();
        t.integer('site_id').unsigned().nullable(); t.integer('seq').unsigned(); t.string('code', 80); t.string('ulr', 60); t.string('material', 60);
        t.string('description', 300); t.string('quantity', 80); t.string('condition', 120); t.string('source', 200);
        t.string('received_date', 10); t.string('customer_ref', 200); t.string('specification', 200); t.string('sample_label', 80);
        json(t, 'data'); t.string('status', 20).defaultTo('registered'); ts(t);
      });
      await k.schema.createTable('tests', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.integer('sample_id').unsigned().notNullable().references('samples.id');
        t.integer('catalog_id').unsigned().nullable(); t.string('template_code', 60); t.integer('template_version').unsigned();
        t.string('status', 20).notNullable().defaultTo('pending'); t.integer('assigned_to').unsigned().nullable(); t.string('due_date', 10);
        json(t, 'observation'); json(t, 'results'); json(t, 'checks'); t.string('started_at', 10); t.string('completed_at', 10);
        t.integer('entered_by').unsigned(); t.string('submitted_at', 32); t.integer('reviewed_by').unsigned(); t.string('reviewed_at', 32); t.text('review_note');
        t.integer('report_id').unsigned().nullable(); ts(t);
      });
      await k.schema.createTable('payments', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.string('number', 60); t.integer('client_id').unsigned().notNullable();
        t.string('date', 10); t.decimal('amount', 14, 2).notNullable(); t.decimal('tds', 14, 2).defaultTo(0); t.string('mode', 30);
        t.string('reference', 200); t.text('notes'); json(t, 'allocations'); t.integer('created_by').unsigned(); ts(t);
      });
      await k.schema.createTable('audit_log', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.integer('user_id').unsigned(); t.string('entity', 30); t.integer('entity_id').unsigned();
        t.string('action', 60); json(t, 'detail'); t.string('at', 32); t.index(['company_id', 'entity', 'entity_id']);
      });
    },
  },
  {
    id: '002_platform',
    up: async (k) => {
      await k.schema.createTable('meta', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.string('kind', 30).notNullable(); t.string('key', 120).notNullable();
        t.integer('owner_id').unsigned().nullable(); json(t, 'data'); t.string('updated_at', 32);
        t.unique(['company_id', 'kind', 'key']);
      });
      await k.schema.alterTable('documents', (t) => { t.string('accreditation', 30); });
      await k.schema.alterTable('samples', (t) => { t.string('accreditation', 30); t.index(['company_id', 'client_id']); });
      await k.schema.alterTable('contacts', (t) => { json(t, 'data'); });
      await k.schema.alterTable('catalog', (t) => { json(t, 'data'); });
      await k.schema.alterTable('work_orders', (t) => { json(t, 'data'); t.string('accreditation', 30); });
      await k.schema.alterTable('payments', (t) => { json(t, 'data'); });
      await k.schema.alterTable('tests', (t) => { t.index(['company_id', 'status']); t.index(['sample_id']); });
      await k.schema.alterTable('documents', (t) => { t.index(['company_id', 'client_id']); });
      // existing data: samples with a ULR were NABL-scope
      await k('samples').whereNotNull('ulr').update({ accreditation: 'NABL' });
      await k('samples').whereNull('ulr').update({ accreditation: 'Non-NABL' });
      await k('documents').where({ kind: 'report' }).update({ accreditation: 'NABL' });
    },
  },
  {
    id: '003_crm',
    up: async (k) => {
      await k.schema.createTable('activities', (t) => {
        t.increments('id'); t.integer('company_id').unsigned().notNullable(); t.integer('client_id').unsigned().nullable();
        t.string('type', 20).notNullable(); t.string('subject', 300).notNullable(); t.text('notes');
        t.string('due_date', 10).nullable(); t.string('done_at', 32).nullable(); t.string('outcome', 300).nullable();
        t.integer('assigned_to').unsigned().nullable(); t.integer('created_by').unsigned().nullable();
        t.string('link_kind', 20).nullable(); t.integer('link_id').unsigned().nullable(); t.string('created_at', 32);
        t.index(['company_id', 'assigned_to', 'done_at']); t.index(['company_id', 'client_id']);
      });
    },
  },
];

export async function migrate(k: Knex = db) {
  if (!(await k.schema.hasTable('_migrations'))) {
    await k.schema.createTable('_migrations', (t) => { t.string('id', 80).primary(); t.string('run_at', 32); });
  }
  const done = new Set((await k('_migrations').select('id')).map((r: { id: string }) => r.id));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await m.up(k);
    await k('_migrations').insert({ id: m.id, run_at: new Date().toISOString() });
    console.log(`migration ${m.id} applied`);
  }
}

export const now = () => new Date().toISOString();
/** Today's date in the business time zone (default India), as YYYY-MM-DD. */
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' });

export function parseJson<T = unknown>(v: unknown, fallback: T): T {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
export const toJson = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

/** Parse the JSON text columns of a row. */
export function row<T extends Record<string, unknown>>(r: T | undefined, jsonCols: string[]): T | undefined {
  if (!r) return r;
  const out: Record<string, unknown> = { ...r };
  for (const c of jsonCols) out[c] = parseJson(out[c], null);
  for (const k of ['active', 'nabl', 'is_default']) if (k in out) out[k] = Boolean(out[k]);
  for (const k of ['rate', 'gst_rate', 'opening_balance', 'total', 'amount', 'tds']) if (k in out && out[k] !== null) out[k] = Number(out[k]);
  return out as T;
}

/** Insert and return the new id (works on SQLite and MySQL). */
export async function insert(k: Knex, table: string, values: Record<string, unknown>): Promise<number> {
  const res = await k(table).insert(values);
  return Number(Array.isArray(res) ? res[0] : res);
}
