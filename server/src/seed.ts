import fs from 'node:fs';
import path from 'node:path';
import { CIVIL_LAB_TEMPLATES, DEFAULT_TEMPLATES, DEFAULT_NUMBERING, type DocKind } from '@suite/shared';
import { db, insert, migrate, now, toJson } from './db';
import { hashPassword } from './auth-hash';
import { ensurePlatform } from './meta';

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

type CatalogSeed = { code: string; material: string; billing_name: string; report_name: string; method: string; nabl: boolean; unit: string; rate: number; obs_template_code: string | null; tat_days: number; conditions?: string; report_notes?: string };
const DEMO_CATALOG: CatalogSeed[] = [
  { code: 'SOIL-MP', material: 'Soil', billing_name: 'Determining MDD and OMC of soil by heavy compaction method', report_name: 'Modified Proctor', method: 'IS 2720 (Part 8) : 1983 RA 2020', nabl: true, unit: 'Per sample', rate: 3000, obs_template_code: 'PROCTOR-HEAVY', tat_days: 3 },
  { code: 'SOIL-GR', material: 'Soil', billing_name: 'Gradation analysis of soil', report_name: 'Gradation analysis of soil', method: 'IS 2720 (Part 4) : 1985 RA 2020', nabl: true, unit: 'Per sample', rate: 900, obs_template_code: 'GRADATION-SOIL', tat_days: 2 },
  { code: 'SOIL-AL', material: 'Soil', billing_name: 'Atterberg limits of soil', report_name: 'Atterberg limits', method: 'IS 2720 (Part 5) : 1985 RA 2020', nabl: true, unit: 'Per sample', rate: 1000, obs_template_code: 'ATTERBERG', tat_days: 2 },
  { code: 'SOIL-FSI', material: 'Soil', billing_name: 'Free swell index of soil', report_name: 'Free swell index', method: 'IS 2720 (Part 40) : 1977 RA 2021', nabl: true, unit: 'Per sample', rate: 600, obs_template_code: 'FSI', tat_days: 2 },
  { code: 'SOIL-CBR', material: 'Soil', billing_name: 'California bearing ratio (CBR) of soil, soaked', report_name: 'CBR', method: 'IS 2720 (Part 16) : 1987 RA 2021', nabl: true, unit: 'Per sample', rate: 2500, obs_template_code: 'CBR-LAB', tat_days: 6,
    report_notes: 'As per IS 2720 (Part 16) : 1987, Clause 7.3: generally the CBR value at 2.5 mm penetration will be greater than that at 5 mm penetration, and in such a case the former shall be taken as the CBR value for design purposes.' },
  { code: 'CON-CUBE', material: 'Concrete', billing_name: 'Compressive strength of concrete cubes (set of 3)', report_name: 'Compressive strength of concrete cubes', method: 'IS 516 (Part 1/Sec 1) : 2021', nabl: true, unit: 'Per set', rate: 600, obs_template_code: 'CUBE-COMP', tat_days: 1 },
  { code: 'FLD-PLT', material: 'Soil', billing_name: 'Conducting plate load test on soil as per IS 1888 : 1982', report_name: 'Plate load test', method: 'IS 1888 : 1982', nabl: true, unit: 'Per point', rate: 18000, obs_template_code: null, tat_days: 5,
    conditions: 'Reaction load should be provided from customer end along with 2 helpers.' },
  { code: 'MISC-TRN', material: 'Service', billing_name: 'Transportation charges', report_name: '', method: '', nabl: false, unit: 'Per visit', rate: 7000, obs_template_code: null, tat_days: 0 },
];

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
  for (const c of priv.catalog ?? DEMO_CATALOG) await insert(db, 'catalog', { ...c, company_id: cid, sac: '998346', gst_rate: 18, active: true, created_at: now() });

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
