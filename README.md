# Lab Suite – all-in-one business application (civil testing laboratory pack)

One centralised web application for running a testing laboratory end to end:

**client & sites → quotation → work order → sample register (job code, ULR) → observation sheet → review → test report (verify, sign, issue) → invoice → payment → ledger**, with registers, reminders and a dashboard reading from the same data.

It is built as a **generic core + industry pack**: clients, documents, GST, numbering, templates, ledgers and roles are industry-neutral; the civil-lab pack adds observation sheets (CBR, Proctor, gradation, Atterberg limits, free swell, concrete cubes) defined as data, not code.

## What is included (v0.1)

| Area | Features |
| --- | --- |
| Clients | Client → sites/projects → contacts; GSTIN check (format + checksum) fills state and PAN; duplicate warning; client page with quotes, samples, reports, invoices, ledger and activity timeline |
| Quotations | Rate quote (unit rates, NABL / Non-NABL remark) or estimate (qty, totals, GST); rate-card picker; test conditions added to notes automatically; sent quotes are locked, changes via revisions (R1, R2); accept → work order or invoice |
| Laboratory | Sample inward with job code and ULR numbering; tests assigned with due dates from turnaround; observation sheets with live Excel-style formulas, rule checks, charts and calibration pulled from the equipment register (expired equipment is blocked) |
| Review | Technician submits → reviewer accepts or returns with a note; the person who entered data cannot review it; corrections keep old value, new value and reason |
| Reports | Combined report from accepted tests of one or more samples (grouped rows, one column per sample); only notes for the tests on the report; draft → verification → sign & issue (signature, seal, number, fingerprint); amendments as new revisions |
| Invoices & money | Invoice from the work order bills only tested work (no double billing); CGST/SGST vs IGST by place of supply; amount in words (lakh/crore); payments with TDS and allocation; client ledger, statement of account, ageing |
| Documents | One block-based designer for every document: show/hide/reorder blocks, rename columns, edit text, fonts, margins, letterhead mode; per-document edits or “save to template” (versioned); print/PDF, PNG, Word export; email from the company mailbox |
| Registers | Sample inward, tests, report issue, quotations, GST sales, receipts, calibration – filter by date, export to Excel |
| Admin | Company profile and branding, numbering formats, default notes, users and roles, rate card with CSV import/export, equipment, templates |

## Run locally

```bash
npm install
npm run dev            # API on :4000 and web on :5173 (proxied)
```
Open http://localhost:5173 and sign in as `owner@demo.lab` / `Demo@12345`.
Other demo users (same password): `frontdesk@`, `tech@`, `reviewer@`, `signatory@`, `accounts@demo.lab`.

Reset the demo database: `npm run seed`.

A private company profile for local testing can be placed at `private/seed.json` (git-ignored) – it is used only when the database is first created.

## Tests

```bash
npm test                                   # formula engine, GST, words, numbering, CBR acceptance values
npm run build && PORT=4000 node server/dist/server.cjs &
node scripts/api-flow.mjs http://localhost:4000      # whole workflow through the API
node scripts/ui-check.mjs http://localhost:4000      # every screen + observation→report flow in a browser
```

The CBR template reproduces the lab’s Excel sheet: proving-ring factor 0.04995 kN/div → 5.0935 kgf/div; 43.2 div at 2.5 mm → 11.21 kg/cm² → **CBR 16.0 %**.

## Try it without a server

**On your own computer (data is kept):** install Node.js 20 LTS from nodejs.org, download this repository (Code → Download ZIP, or `git clone`), then in the folder run:
```
npm install
npm run build
npm start
```
Open http://localhost:4000. Others on the same Wi-Fi/office network can open `http://<your-computer-IP>:4000` (allow Node.js through the Windows firewall when asked).

**Public test link on Render (free):** render.com → New + → Blueprint → choose this repository → Apply. The `render.yaml` file sets everything up. On the free plan the app sleeps when idle and the demo data resets on restart, so use it for demos, not real work.

## Deploying
See **[DEPLOY.md](DEPLOY.md)** (cPanel Node.js app + MySQL; GitHub Actions publishes a ready-built `deploy` branch).

## Project structure

```
shared/   formula engine, observation templates, GST/totals, numbering, document templates (used by server and browser)
server/   Express API, Knex (SQLite locally, MySQL in production), auth & roles, workflow rules
web/      React + Mantine screens, document renderer and designer, exports
scripts/  end-to-end API and browser tests
```

## Adding a new test (observation sheet)
Templates are JSON (Settings → Templates → Observation sheets, or `shared/src/packs/civil-lab.ts`):
- `headerFields` – values entered once (test condition, mould volume…)
- `constants` – fixed values or `fromEquipment` (e.g. proving-ring factor)
- `derived` – scalar formulas, e.g. `mf*1000/g`
- `grids` – reading tables; columns are inputs or formulas using other columns of the same row
- `results` – formulas over everything, grid columns are arrays: `LOOKUPX(2.5, readings.pen, readings.load_kgcm2)`
- `checks` – `when` formula + warning/error message
- `chart`, `reportRows` – graph and the rows printed on the report

Formula syntax is Excel’s: `IF`, `IFERROR`, `AND`, `OR`, `ROUND`, `SUM`, `AVERAGE`, `MIN`, `MAX`, `INDEX`, `MATCH`, `PI`, `SQRT`, `ABS`, plus `LOOKUPX` and `INTERP` (linear interpolation).

Templates marked *simplified* (Proctor, gradation, Atterberg) capture results with basic calculations and should be replaced by the lab’s own sheets.

## Before go-live – items to confirm
- ULR number format (Settings → Numbering) against the current NABL requirement.
- GST: place of supply wording and SAC code with the CA.
- Decision rules / statement of conformity wording on reports.
- Upload logo, NABL symbol, seal and each signatory’s signature in the app (never commit them to the repository).
