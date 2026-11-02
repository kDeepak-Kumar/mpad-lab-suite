import fs from 'node:fs';
import path from 'node:path';
import { CIVIL_LAB_TEMPLATES, DEFAULT_TEMPLATES, DEFAULT_NUMBERING, type DocKind } from '@suite/shared';
import { db, insert, migrate, now, toJson } from './db';
import { hashPassword } from './auth-hash';
import { ensurePlatform } from './meta';
import { PACK_CATALOG, OTHER_CATALOG, type CatalogSeed } from './packs';

/**
 * First start: creates the company, the owner account, templates and a starter rate card.
 * - Company profile can come from a private JSON file (SEED_FILE, default ./private/seed.json, never committed).
 * - Owner login from ADMIN_EMAIL / ADMIN_PASSWORD (defaults are for local demos only).
 * - SEED_DEMO=true also adds demo staff, clients and equipment.
 */

const DEMO_COMPANY = {
  name: 'Demo Civil Testing Laboratory Pvt Ltd',
  tagline: 'Quality you can build on',
  cin: 'U00000TS2020PTC000000', gstin: '36AAAAA0000A1Z5', pan: 'AAAAA0000A', stateCode: '36',
  address: 'Plot 1, Industrial Area, Hyderabad - 500 001, Telangana',
  phone: '+91 90000 00000', email: 'lab@example.com', website: 'www.example.com', jurisdiction: 'Hyderabad',
  accreditation: { body: 'NABL', certNo: 'TC-00000', validTill: '' },
  bank: { name: 'Demo Civil Testing Laboratory Pvt Ltd', branch: 'Main branch', ifsc: 'DEMO0000000', bank: 'Demo Bank', account: '000000000000' },
  numbering: { ...DEFAULT_NUMBERING, quote: 'DCTL/{SEQ:3}/{FY}', sample: 'DCTL/{CLIENT}/{SEQ:4}/{MM}/{YYYY}', report: 'DCTL-TR/{SEQ:4}/{FY}' },
  defaults: {
    gstRate: 18, sac: '998346', validityDays: 30, paymentTermsDays: 30,
    quoteNotes: 'GST 18% will be applicable on above rates.\nReport / results will be communicated only after receiving full payment.',
    reportNotes: '(*) Details as furnished by the customer.\nAbove test results relate only to the samples tested.\nReport shall not be reproduced, except in full, without the written approval of the lab.\nAny corrections invalidate this report.',
  },
  smtp: {},
};

function gstin(state: string, pan: string, entity = '1') {
  const base = `${state}${pan}${entity}Z`;
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) { const v = chars.indexOf(base[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(v / 36) + (v % 36); }
  return base + chars[(36 - (sum % 36)) % 36];
}

export async function seedIfEmpty() {
  const existing = await db('companies').first();
  if (existing) return;
  const seedFile = process.env.SEED_FILE || path.resolve(process.cwd(), 'private', 'seed.json');
  const alt = path.resolve(process.cwd(), '..', 'private', 'seed.json');
  const file = [seedFile, alt].find((f) => fs.existsSync(f));
  const priv = file ? JSON.parse(fs.readFileSync(file, 'utf8')) as { company?: Record<string, unknown>; catalog?: CatalogSeed[]; users?: { name: string; email: string; role: string; designation?: string; qualifications?: string }[] } : {};
  if (file) console.log(`seeding company profile from ${file}`);

  const companyData = { ...DEMO_COMPANY, ...(priv.company ?? {}) } as Record<string, unknown> & { name: string };
  const { name, ...data } = companyData;
  const cid = await insert(db, 'companies', { name, data: toJson(data), created_at: now() });

  const adminEmail = (process.env.ADMIN_EMAIL || 'owner@demo.lab').toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || 'Demo@12345';
  await insert(db, 'users', { company_id: cid, name: process.env.ADMIN_NAME || 'Owner', email: adminEmail, password_hash: await hashPassword(adminPass), role: 'owner', designation: 'Director', created_at: now() });

  for (const t of CIVIL_LAB_TEMPLATES) await insert(db, 'obs_templates', { company_id: cid, code: t.code, version: t.version, definition: toJson(t), active: true, created_at: now() });
  for (const kind of Object.keys(DEFAULT_TEMPLATES) as DocKind[]) {
    const def = DEFAULT_TEMPLATES[kind];
    await insert(db, 'doc_templates', { company_id: cid, kind, version: 1, name: def.name, definition: toJson(def), is_default: true, created_at: now() });
  }
  for (const c of priv.catalog ?? [...PACK_CATALOG, ...OTHER_CATALOG]) await insert(db, 'catalog', { ...c, company_id: cid, sac: '998346', gst_rate: 18, active: true, created_at: now() });

  if (process.env.SEED_DEMO === 'true' || !process.env.ADMIN_EMAIL) {
    const pass = await hashPassword(adminPass);
    const staff = priv.users ?? [
      { name: 'Ravi (Technician)', email: 'tech@demo.lab', role: 'technician', designation: 'Lab Technician' },
      { name: 'Suma (Reviewer)', email: 'reviewer@demo.lab', role: 'reviewer', designation: 'Technical Manager' },
      { name: 'Dr. K. Rao', email: 'signatory@demo.lab', role: 'signatory', designation: 'Director (Technical)', qualifications: 'B.E (Civil), M.E (Geotechnical)' },
      { name: 'Anita (Accounts)', email: 'accounts@demo.lab', role: 'accountant', designation: 'Accounts' },
      { name: 'Kiran (Front desk)', email: 'frontdesk@demo.lab', role: 'frontdesk', designation: 'Front office' },
    ];
    for (const u of staff) await insert(db, 'users', { company_id: cid, ...u, email: u.email.toLowerCase(), password_hash: pass, created_at: now() });
    await insert(db, 'equipment', { company_id: cid, name: 'Proving ring 50 kN (PR-01)', category: 'Proving ring', id_no: 'PR-01', make: 'Demo', data: toJson({ factor: 0.04995 }), cert_no: 'CAL/DEMO/1274-01', cal_date: '2026-08-24', due_date: '2027-08-23', active: true, created_at: now() });
    const eqp = (name: string, category: string, id_no: string, data: Record<string, number>) => insert(db, 'equipment', { company_id: cid, name, category, id_no, make: 'Demo', data: toJson(data), cert_no: `CAL/DEMO/${id_no}`, cal_date: '2026-06-01', due_date: '2027-05-31', active: true, created_at: now() });
    await eqp('Rebound hammer type N (RH-01)', 'Rebound hammer', 'RH-01', { anvil_avg: 80, anvil_nominal: 80 });
    await eqp('UPV tester 54 kHz (UPV-01)', 'Ultrasonic pulse velocity tester', 'UPV-01', { ref_time: 25.4 });
    await eqp('Universal testing machine 1000 kN (UTM-01)', 'Universal testing machine', 'UTM-01', { correction: 1 });
    await eqp('Blaine apparatus (BL-01)', 'Blaine air permeability apparatus', 'BL-01', { bed_volume: 1.85, ref_area: 300, ref_time: 58, ref_density: 3.15, ref_porosity: 0.5 });
    await eqp('Sand pouring cylinder (SPC-01)', 'Sand pouring cylinder', 'SPC-01', { cone_mass: 450, sand_density: 1.45 });
    await eqp('Core cutter 1000 cc (CC-01)', 'Core cutter', 'CC-01', { volume: 1000, mass: 1050 });
    await eqp('Heavy compaction mould 1000 cc (MLD-01)', 'Compaction mould', 'MLD-01', { volume: 1000, mass: 4250 });
    await eqp('Cylindrical measure 15 litre (CM-15)', 'Cylindrical measure', 'CM-15', { volume: 15, mass: 9.2 });
    await eqp('Cylindrical measure 3 litre (CM-03)', 'Cylindrical measure', 'CM-03', { volume: 3, mass: 2.1 });
    await insert(db, 'equipment', { company_id: cid, name: 'Compression testing machine 2000 kN (CTM-01)', category: 'Compression testing machine', id_no: 'CTM-01', make: 'Demo', data: toJson({}), cert_no: 'CAL/DEMO/2201', cal_date: '2026-02-10', due_date: '2027-02-09', active: true, created_at: now() });
    const c1 = await insert(db, 'clients', { company_id: cid, name: 'Sunrise Infra Projects Pvt Ltd', short_code: 'SIPL', type: 'company', gstin: gstin('36', 'AAECS1234K'), state_code: '36', pan: 'AAECS1234K', address: 'Plot 22, Financial District, Gachibowli, Hyderabad - 500032, Telangana', email: 'qc@sunrise.example', phone: '+91 90000 11111', payment_terms_days: 30, opening_balance: 0, created_at: now() });
    await insert(db, 'sites', { company_id: cid, client_id: c1, name: 'Tower A – Kokapet', address: 'Kokapet, Hyderabad', project: 'Residential towers phase 1', created_at: now() });
    await insert(db, 'sites', { company_id: cid, client_id: c1, name: 'Villas – Tellapur', address: 'Tellapur, Hyderabad', project: 'Gated villas', created_at: now() });
    await insert(db, 'contacts', { company_id: cid, client_id: c1, name: 'Mr. Ram Prasad', role: 'QC Engineer', phone: '+91 99999 00000', email: 'ram@sunrise.example', receives: toJson(['quote', 'report']), created_at: now() });
    const c2 = await insert(db, 'clients', { company_id: cid, name: 'Deccan Developers Pvt Ltd', short_code: 'DDPL', type: 'company', gstin: gstin('27', 'AAACD5225H'), state_code: '27', pan: 'AAACD5225H', address: 'Civil Lines, Nagpur - 440001, Maharashtra', email: 'accounts@deccan.example', phone: '+91 90000 22222', payment_terms_days: 15, opening_balance: 0, created_at: now() });
    await insert(db, 'sites', { company_id: cid, client_id: c2, name: 'Data centre – Shamshabad', address: 'Shamshabad, Hyderabad', project: 'Data centre building', created_at: now() });
    await insert(db, 'contacts', { company_id: cid, client_id: c2, name: 'Ms. Priya', role: 'Project Manager', phone: '+91 98888 00000', email: 'priya@deccan.example', receives: toJson(['quote', 'report', 'invoice']), created_at: now() });
    console.log(`Demo data created. Sign in as ${adminEmail} / ${adminPass} (also tech@, reviewer@, signatory@, accounts@, frontdesk@demo.lab with the same password).`);
  } else {
    console.log(`Company created. Owner login: ${adminEmail}`);
  }
}

// `npm run seed` – reset a local demo database
if (process.argv[1]?.endsWith('seed.ts')) {
  (async () => {
    if (process.env.DB_CLIENT !== 'mysql') {
      const f = process.env.DATABASE_FILE || path.resolve(process.cwd(), 'data', 'suite.sqlite');
      for (const x of [f, f + '-wal', f + '-shm']) if (fs.existsSync(x)) fs.unlinkSync(x);
    }
    await migrate();
    await seedIfEmpty();
    await ensurePlatform();
    await db.destroy();
  })();
}
