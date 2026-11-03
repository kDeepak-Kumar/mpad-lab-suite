const { chromium } = require('playwright');
(async () => {
  const [base, out, w, h] = [process.argv[2], process.argv[3], Number(process.argv[4] || 390), Number(process.argv[5] || 844)];
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 800, hasTouch: true }); const p = await ctx.newPage();
  await p.goto(base + '/login'); await p.waitForTimeout(800); await p.screenshot({ path: `${out}/login.png` });
  await p.getByLabel(/email/i).fill('owner@demo.lab'); await p.getByLabel(/password/i).fill('Demo@12345'); await p.getByRole('button', { name: /sign in/i }).click(); await p.waitForTimeout(1500);
  const pages = (process.argv[6] || '/,/samples,/tests,/clients,/quotes,/invoices,/documents/1,/tests/1,/settings/company').split(',');
  for (const u of pages) { await p.goto(base + u); await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/${u.replace(/\//g, '_') || 'home'}.png`, fullPage: false }); }
  await b.close();
})();
