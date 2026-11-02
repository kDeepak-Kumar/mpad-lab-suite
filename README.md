# Lab Suite – all-in-one business application (civil testing laboratory pack)

One centralised web application for running a testing laboratory end to end:

**client & sites → quotation → work order → sample register (job code, ULR) → observation sheet → review → test report (verify, sign, issue) → invoice → payment → ledger**, with registers, reminders and a dashboard reading from the same data.

It is built as a **generic core + industry pack**: clients, documents, GST, numbering, templates, ledgers and roles are industry-neutral; the civil-lab pack adds observation sheets (CBR, Proctor, gradation, Atterberg limits, free swell, concrete cubes) defined as data, not code.

## What is included (v0.3)

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
| Report type | NABL / Non-NABL on samples, reports, quotes and invoices; ULR only for NABL; NABL and standard letterhead profiles (designed header or uploaded images); filters and analytics by type |
| Editable documents | Every automatic value (number, date, client name, address, GSTIN, site, contact, job code, ULR, dates…) has a lock – unlock to type your own; quotes can be rate-only or show quantity, amount and GST |
| List views | Search, per-column filters, sorting, column chooser, saved personal/shared views and export on every list |
| Analytics & AI | KPIs (revenue, forecast, pipeline, conversion, outstanding, unbilled work, turnaround), default dashboard, report builder with forecast, saved reports; “Ask about your business” in plain English – built-in assistant works offline, any AI model (free Gemini/Groq/OpenRouter/Ollama or paid) can be connected in Settings |
| IS test pack (v0.3) | 50 observation sheets with IS procedures, worked examples and requirements: **soil** (IS 2720 – moisture, specific gravity, sieve analysis with D10/D30/D60 and IS 1498 group, Atterberg limits with flow curve and classification, shrinkage limit, light/heavy compaction with ZAV and fitted peak, CBR, FSI, UCS, direct shear, core cutter, sand replacement), **coarse aggregate** (IS 2386 / IS 383 – sieve analysis with grading limits, flakiness & elongation, impact, crushing, LA abrasion, specific gravity & absorption, bulk density, soundness, 10% fines, deleterious), **fine aggregate** (sieve analysis with zone and FM, specific gravity, bulk density, bulking, silt / finer than 75 µm, soundness), **cement** (IS 4031 with IS 269 / 1489 / 455 limits by type), **steel** (IS 1786 by grade and diameter), **concrete** (IS 516 cubes, flexure, split tensile) and **NDT** (rebound hammer with the Aimil chart for positions A/B/C rounded to 0.5 N/mm², UPV grading, cores to IS 456 acceptance, cover meter) |
| Soil field tests | Plate load (IS 1888: natural and log–log curves, shear and settlement criteria, plate-to-footing conversion), SPT (IS 2131: refusal reported as >50, overburden and dilatancy corrections), borehole logs (strata patterns, SPT N with depth, samples, core recovery and RQD, site profile for several boreholes), safe bearing capacity from SPT (Teng + Terzaghi–Peck) and from c–φ (IS 6403), pile pull-out and lateral load tests (IS 2911-4, unloading cycles, IS safe loads) |
| Template editor | Settings → Templates → Observation sheets opens a form editor: inputs, equipment, constants and IS tables, reading tables and formulas, checks, report rows / details / text / tables, graphs (log axes, reversed axes, fixed or automatic scales) and the procedure / worked example – every formula is checked as you type and shows its example value; “Copy as new test” creates a new sheet |
| Observation sheets | Procedure, sample calculation and IS references beside every sheet; constants from the equipment calibration certificate or entered manually (highlighted, logged); drop-downs and text cells; log-scale/limit/best-fit charts; reports get a “Requirement as per IS” column, detail tables (sieves, cubes, bars, locations) and graphs |
| CRM | Follow-ups (call, visit, email, WhatsApp, meeting, task, note) per client with due dates, outcome and next follow-up; automatic follow-up call when a quotation is sent; due follow-ups in the bell; QR code on issued reports opens a public page that confirms the report is genuine (and flags amended/withdrawn reports) |
| Setup (no code) | Custom fields on any object, page layouts (order/hide), picklists, roles with tab access, record CRUD, actions and field-level access; System Administrator role with full control that skips workflow validations (all audited) |

## Run locally

```bash
npm install
npm run dev            # API on :4000 and web on :5173 (proxied)
```
Open http://localhost:5173 and sign in as `admin@demo.lab` (System Administrator) or `owner@demo.lab`, password `Demo@12345`.
Other demo users (same password): `frontdesk@`, `tech@`, `reviewer@`, `signatory@`, `accounts@demo.lab`.

Reset the demo database: `npm run seed`.

A private company profile for local testing can be placed at `private/seed.json` (git-ignored) – it is used only when the database is first created.

## Tests

```bash
npm test                                   # formula engine, GST, words, numbering, CBR values, every template's worked example
npm run build && PORT=4000 node server/dist/server.cjs &
node scripts/api-flow.mjs http://localhost:4000      # whole workflow through the API
node scripts/ui-check.mjs http://localhost:4000      # every screen + observation→report flow in a browser
node scripts/pack-check.mjs http://localhost:4000    # enters every template's worked example, screenshots sheets and reports
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
Templates are data (Settings → Templates → Observation sheets, or `shared/src/packs/*.ts`, one file per material):
- `headerFields` – values entered once (grade, nominal size, test condition…), with optional `default`
- `constants` – fixed values or `fromEquipment` (e.g. `ring.factor` from the proving-ring certificate); testers can override unless `locked`
- `tables` – lookup tables such as IS 383 limits or the rebound-hammer chart, used as `name.column` lists
- `derived` – scalar formulas, e.g. `mf*1000/g`
- `grids` – reading tables; columns are inputs (number, text or drop-down) or formulas. Columns are evaluated in order, so a formula can use earlier columns of every row: `SUMTO(sv.ret, ROW())` gives a cumulative sum
- `results` – formulas over everything, grid columns are arrays: `LOOKUPX(2.5, readings.pen, readings.load_kgcm2)`
- `checks` – `when` formula + warning/error message
- `chart` (with extra `series`, `xLog`, `fit`), `reportRows` (with `spec` / `specFormula` for the IS requirement), `reportTables`
- `procedure`, `sampleCalc` (text with `{result}` or `{grid.column#row:decimals}` placeholders), `references`, `example` (inputs and expected results – checked by `npm test`)

Formula syntax is Excel’s: `IF`, `IFERROR`, `AND`, `OR`, `NOT`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `MROUND`, `SUM`, `COUNT`, `COUNTA`, `COUNTIF`, `AVERAGE`, `MEDIAN`, `STDEV`, `MIN`, `MAX`, `LARGE`, `SMALL`, `INDEX`, `MATCH`, `SLOPE`, `INTERCEPT`, `FORECAST`, `LOG10`, `LN`, `EXP`, `SQRT`, `POWER`, `PI`, `ATAN`, `DEGREES`, `LEFT`, `RIGHT`, `LEN`, `FIXED`, `CONCAT`, plus `LOOKUPX`, `INTERP` (linear interpolation), `SUMTO`, `PEAKX`/`PEAKY` (compaction peak) and `MINUTES` (clock time → minutes).

Earlier versions of a template stay in the database, so tests already recorded keep the sheet they were tested on; new tests use the latest version. On start-up the server adds any new template versions, catalog items and equipment categories from the pack without changing what the lab has edited.

## Before go-live – items to confirm
- ULR number format (Settings → Numbering) against the current NABL requirement.
- GST: place of supply wording and SAC code with the CA.
- Decision rules / statement of conformity wording on reports.
- Check the IS limits in the templates against the editions in the lab’s NABL scope (they are editable constants/tables) and the rebound-hammer chart values against the lab’s own hammer chart.
- Catalog rates and NABL flags for the new tests are indicative – set them in Settings → Rate card.
- Upload logo, NABL symbol, seal and each signatory’s signature in the app (never commit them to the repository).
