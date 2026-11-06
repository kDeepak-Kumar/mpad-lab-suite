/** How-to articles used by the assistant ("how do I …") and searchable without any AI provider. */
export interface HelpArticle { id: string; title: string; keywords: string[]; steps: string[]; link?: string; perm?: string }

export const HELP: HelpArticle[] = [
  { id: 'new-quote', title: 'Create a quotation', keywords: ['quote', 'quotation', 'estimate', 'rate', 'offer'], perm: 'quote.create', link: '/quotes/new',
    steps: ['Click **+ New → Quotation** (top bar) or Quotations → New quotation.', 'Choose the client, site and contact.', 'Add tests from the rate card; rates, GST and totals fill in.', 'Save, then **Send** by email or WhatsApp. A sent quotation is locked; use Revise to change it.'] },
  { id: 'quote-to-wo', title: 'Turn an accepted quotation into a work order', keywords: ['work order', 'accepted', 'convert', 'po'], perm: 'quote.edit', link: '/quotes',
    steps: ['Open the quotation and mark it **Accepted**.', 'Click **Create work order**. Samples registered against it pick up the quoted tests.'] },
  { id: 'register-sample', title: 'Register a sample (inward)', keywords: ['sample', 'register', 'inward', 'receive', 'job code', 'ulr'], perm: 'sample.create', link: '/samples?new=1',
    steps: ['Click **+ New → Register sample**.', 'Pick the client / work order, material, quantity and condition.', 'Tick the tests; assign technicians and due dates.', 'Save. The job code and ULR (for NABL) are generated; print the sample label.'] },
  { id: 'observations', title: 'Enter test observations', keywords: ['observation', 'sheet', 'result', 'technician', 'enter', 'test'], perm: 'test.edit', link: '/tests?tab=mine',
    steps: ['Open **Tests & observations → My tests**.', 'Open a test, fill in the sheet; results calculate automatically.', 'Select the equipment used (expired calibration is refused).', 'Click **Submit for review**.'] },
  { id: 'review', title: 'Review and accept observations', keywords: ['review', 'accept', 'return', 'reviewer', 'check'], perm: 'reviewTests', link: '/tests?tab=review',
    steps: ['Open **Tests & observations → To review**.', 'Check the sheet, then **Accept** or **Return** with a note to the technician.'] },
  { id: 'report', title: 'Prepare, verify and sign a test report', keywords: ['report', 'prepare', 'sign', 'issue', 'verify', 'certificate'], perm: 'prepareReports', link: '/reports/prepare',
    steps: ['Open **Prepare report** and tick the accepted tests of a sample.', 'Create the report; check remarks and layout.', 'Send for verification; the authorised signatory signs and issues it.', 'Issued reports carry a QR code that clients can verify.'] },
  { id: 'invoice', title: 'Create an invoice', keywords: ['invoice', 'bill', 'billing', 'gst', 'tax invoice'], perm: 'invoice.create', link: '/invoices/new',
    steps: ['From a work order click **Invoice tested work**, or use **+ New → Invoice**.', 'Check lines, GST (IGST for out-of-state) and the place of supply.', 'Issue it, then send by email or WhatsApp.'] },
  { id: 'payment', title: 'Record a payment received (with TDS)', keywords: ['payment', 'receipt', 'tds', 'received', 'collection', 'paid'], perm: 'recordPayments', link: '/payments?new=1',
    steps: ['Click **+ New → Record payment**.', 'Choose the client; open invoices are listed.', 'Enter the amount and TDS and allocate to invoices. Invoice status updates automatically.'] },
  { id: 'ledger', title: 'See what a client owes (ledger)', keywords: ['ledger', 'outstanding', 'owe', 'due', 'statement', 'balance'], perm: 'invoice.read', link: '/ledger',
    steps: ['Open **Ledgers** and choose the client.', 'Download or WhatsApp the statement of account.'] },
  { id: 'equipment', title: 'Add equipment and calibration certificates', keywords: ['equipment', 'calibration', 'certificate', 'due', 'instrument'], perm: 'equipment.edit', link: '/equipment',
    steps: ['Open **Equipment** → Add equipment (or Import from Excel).', 'Enter calibration date, due date and factors; attach the certificate.', 'Due/expired calibrations appear in reminders and the daily alert email.'] },
  { id: 'outsourcing', title: 'Send tests to an external laboratory', keywords: ['outsource', 'external', 'subcontract', 'vendor lab'], perm: 'manageOutsourcing', link: '/outsourcing',
    steps: ['Open the sample → **Send tests to an external laboratory**.', 'Record dispatch evidence; when their report arrives, import the results.', 'Results print with a "*" and the sub-contracting note.'] },
  { id: 'purchases', title: 'Record a vendor bill', keywords: ['purchase', 'vendor', 'bill', 'expense', 'itc'], perm: 'managePurchases', link: '/purchases',
    steps: ['Open **Purchases → New bill**, choose the vendor and attach the bill copy.', 'Taxes are calculated; the bill flows into GST input tax credit.'] },
  { id: 'gst', title: 'GST returns', keywords: ['gst', 'gstr', 'return', 'gstr1', 'gstr3b'], perm: 'manageGst', link: '/gst',
    steps: ['Open **GST returns**, pick the month and click Sync.', 'Review outward supplies and purchase bills, then export.'] },
  { id: 'followup', title: 'Add a follow-up (call, visit, reminder)', keywords: ['follow up', 'followup', 'call', 'visit', 'reminder', 'task'], perm: 'client.read', link: '/followups?new=1',
    steps: ['Click **+ New → Follow-up**, set type, client, subject and due date.', 'It appears in your reminders until marked done.'] },
  { id: 'list-views', title: 'Save and pin list views', keywords: ['list view', 'filter', 'columns', 'view', 'pin', 'save view'], link: '/samples',
    steps: ['On any list, change search, filters or fields (column button).', 'Click **Save…** → Update the view or Save as a new view.', 'Open the view menu → **Pin as my default** to open it every time.'] },
  { id: 'favourites', title: 'Favourites and recent items', keywords: ['favourite', 'favorite', 'star', 'recent', 'shortcut'],
    steps: ['Click the ☆ next to any page title, record or list view.', 'It appears at the top of the left menu; drag to reorder.'] },
  { id: 'recycle', title: 'Delete and restore records (Recycle Bin)', keywords: ['delete', 'restore', 'recycle', 'bin', 'undo', 'remove'], perm: '__admin', link: '/settings/recycle-bin',
    steps: ['System Administrators see a red delete icon on records.', 'Deleted records go to **Administration → Recycle Bin** and can be restored within 30 or 60 days.'] },
  { id: 'users', title: 'Add a user and set permissions', keywords: ['user', 'invite', 'role', 'permission', 'access', 'staff login'], perm: 'users', link: '/settings/users',
    steps: ['Open **Users** → Invite user; choose the role.', 'Roles and what they can see are set under **Setup → Roles**.'] },
  { id: 'branding', title: 'Logo, colours and letterheads', keywords: ['logo', 'colour', 'color', 'branding', 'letterhead', 'theme'], perm: 'settings', link: '/settings/company?section=branding',
    steps: ['Open **Company & branding → Logo & sign-in page** for logo, seal and app colours.', 'Letterheads are under **Letterheads**.'] },
  { id: 'ai-setup', title: 'Connect an AI provider', keywords: ['ai', 'gemini', 'openai', 'claude', 'groq', 'api key', 'model', 'assistant'], perm: 'settings', link: '/settings/company?section=ai',
    steps: ['Open **Company & branding → AI assistant** and click **Setup guide**.', 'Pick a provider (free options available), paste the API key, choose a model and **Test connection**.', 'Save. The key stays on the server and is never shown again.'] },
  { id: 'two-factor', title: 'Two-step verification and password', keywords: ['password', '2fa', 'two step', 'otp', 'security', 'login'], link: '/account',
    steps: ['Open **My account & security** (avatar menu).', 'Change your password or turn on two-step verification with an authenticator app.'] },
  { id: 'whatsapp', title: 'Send documents on WhatsApp', keywords: ['whatsapp', 'share', 'send'],
    steps: ['On a quotation, invoice or report click **WhatsApp**.', 'Pick the contact; the PDF is prepared and WhatsApp opens with the message.'] },
  { id: 'analytics', title: 'Reports and analytics', keywords: ['analytics', 'chart', 'dashboard', 'report builder', 'trend'], perm: 'viewAnalytics', link: '/analytics',
    steps: ['Open **Analytics & AI** and ask a question in plain words, or build a report.', 'Add any report to a dashboard.'] },
];

export function searchHelp(q: string, allowed: (perm?: string) => boolean, n = 3) {
  const words = q.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const scored = HELP.filter((a) => allowed(a.perm)).map((a) => {
    const hay = `${a.title} ${a.keywords.join(' ')}`.toLowerCase();
    let s = 0;
    for (const k of a.keywords) if (q.toLowerCase().includes(k)) s += 3;
    for (const w of words) if (hay.includes(w)) s += 1;
    return { a, s };
  }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
  return scored.slice(0, n).map((x) => x.a);
}
