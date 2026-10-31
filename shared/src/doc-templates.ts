/**
 * Document templates = page setup + an ordered list of blocks with editable props.
 * A document stores its data and optional per-document overrides; the renderer merges
 * template → overrides → data. "Save to template" promotes overrides into a new template version.
 */

export type DocKind = 'quote' | 'invoice' | 'report' | 'receipt' | 'statement';

export interface Column { key: string; label: string; visible: boolean; align?: 'left' | 'center' | 'right'; width?: number }
export interface Block {
  id: string;
  type: string;
  visible: boolean;
  props: Record<string, unknown>;
}
export interface DocTemplate {
  kind: DocKind;
  name: string;
  page: { size: 'A4' | 'Letter'; orientation: 'portrait' | 'landscape'; marginMm: number; letterheadMode: boolean; fontSize: number; fontFamily: string; accent: string };
  docControl?: string;
  blocks: Block[];
}
export interface DocOverrides {
  page?: Partial<DocTemplate['page']>;
  blocks?: Record<string, { visible?: boolean; props?: Record<string, unknown> }>;
  order?: string[];
}

export function applyOverrides(t: DocTemplate, o?: DocOverrides | null): DocTemplate {
  if (!o) return t;
  const blocks = t.blocks.map((b) => {
    const ov = o.blocks?.[b.id];
    if (!ov) return b;
    return { ...b, visible: ov.visible ?? b.visible, props: { ...b.props, ...(ov.props ?? {}) } };
  });
  if (o.order?.length) blocks.sort((a, b) => {
    const ia = o.order!.indexOf(a.id), ib = o.order!.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  return { ...t, page: { ...t.page, ...(o.page ?? {}) }, blocks };
}

const page: DocTemplate['page'] = { size: 'A4', orientation: 'portrait', marginMm: 12, letterheadMode: false, fontSize: 11, fontFamily: 'Times New Roman, Times, serif', accent: '#1f3a68' };
const col = (key: string, label: string, align: Column['align'] = 'left', width?: number, visible = true): Column => ({ key, label, align, width, visible });

export const DEFAULT_TEMPLATES: Record<DocKind, DocTemplate> = {
  quote: {
    kind: 'quote', name: 'Quotation (standard)', page,
    blocks: [
      { id: 'letterhead', type: 'letterhead', visible: true, props: { showLogo: true, showCIN: true, showGST: true, showAccreditation: false } },
      { id: 'title', type: 'title', visible: true, props: { text: 'QUOTATION', subtitle: 'Subject to {{company.jurisdiction}} Jurisdiction' } },
      { id: 'party', type: 'party', visible: true, props: {
        toLabel: 'To,', showGstin: false, projectLabel: 'Project Name',
        rows: [
          { label: 'Date', field: 'dateText' }, { label: 'Quotation No', field: 'number' },
          { label: 'Customer Reference No.', field: 'customerRef' }, { label: 'Contact Person', field: 'contact.name' },
          { label: 'Phone No', field: 'contact.phone' }, { label: 'Mail Id', field: 'contact.email' },
        ] } },
      { id: 'items', type: 'items', visible: true, props: { columns: [
        col('sno', 'S No.', 'center', 7), col('description', 'Description & Specification', 'left'), col('rate', 'Rate', 'right', 12),
        col('qty', 'Qty.', 'center', 10), col('unit', 'Unit', 'center', 12), col('amount', 'Amount (Rs.)', 'right', 13), col('remarks', 'Remarks', 'center', 12),
      ] } },
      { id: 'totals', type: 'totals', visible: true, props: { subtotal: 'Total', discount: 'Discount', cgst: 'CGST', sgst: 'SGST', igst: 'IGST', roundOff: 'Round off', total: 'Amount Incl GST' } },
      { id: 'words', type: 'amountWords', visible: true, props: { label: 'Total Amount' } },
      { id: 'notes', type: 'notes', visible: true, props: { title: 'Note:' } },
      { id: 'signature', type: 'signature', visible: true, props: { forText: '{{company.name}}', label: '', showSeal: false, showName: false, showSignature: false } },
      { id: 'footer', type: 'footer', visible: true, props: {} },
    ],
  },
  invoice: {
    kind: 'invoice', name: 'Tax invoice (standard)', page,
    blocks: [
      { id: 'letterhead', type: 'letterhead', visible: true, props: { showLogo: true, showCIN: true, showGST: true, showAccreditation: false } },
      { id: 'title', type: 'title', visible: true, props: { text: 'TAX INVOICE', subtitle: '(Issued Under section 31 of GST Act, 2017)' } },
      { id: 'party', type: 'party', visible: true, props: {
        toLabel: '', showGstin: true, projectLabel: 'Site / Project', boxed: true,
        rows: [
          { label: 'Invoice No.', field: 'number' }, { label: 'Date', field: 'dateText' },
          { label: 'Place of Supply', field: 'placeOfSupplyName' }, { label: 'State Code', field: 'placeOfSupply' },
          { label: '', field: 'copyLabel' },
        ] } },
      { id: 'items', type: 'items', visible: true, props: { columns: [
        col('sno', 'S No.', 'center', 7), col('description', 'Name of the Test', 'left'), col('rate', 'Unit Rate (Rs.)', 'right', 14),
        col('qty', 'Qty.', 'center', 9), col('unit', 'Unit', 'center', 10, false), col('amount', 'Total Rs.', 'right', 14), col('remarks', 'Remarks', 'center', 10, false),
      ] } },
      { id: 'totals', type: 'totals', visible: true, props: { subtotal: 'Total', discount: 'Discount', cgst: 'CGST', sgst: 'SGST', igst: 'IGST', roundOff: 'Round off', total: 'Amount Incl GST' } },
      { id: 'words', type: 'amountWords', visible: true, props: { label: 'Total Amount Payable' } },
      { id: 'info', type: 'text', visible: true, props: { text: 'GSTIN : {{company.gstin}}\nSubject to {{company.jurisdiction}} jurisdiction\nService Code (SAC): {{doc.sac}} (Technical Testing and Analysis)\nCross cheque/ DD should be drawn in favour of {{company.name}}, payable at {{company.jurisdiction}}.\nFor Online payments:', align: 'left', size: 10 } },
      { id: 'bankSign', type: 'bankSignature', visible: true, props: { bankTitle: 'BANK DETAILS', forText: 'For {{company.name}}', label: 'AUTHORIZED SIGNATORY', showSeal: true, showSignature: true, showName: true } },
      { id: 'footer', type: 'footer', visible: true, props: {} },
    ],
  },
  report: {
    kind: 'report', name: 'Test report (combined table)', page: { ...page, marginMm: 10 },
    docControl: 'TR/01',
    blocks: [
      { id: 'letterhead', type: 'letterhead', visible: true, props: { showLogo: true, showCIN: true, showGST: true, showAccreditation: true } },
      { id: 'docControl', type: 'text', visible: true, props: { text: '{{template.docControl}}', align: 'right', size: 9 } },
      { id: 'reportInfo', type: 'reportInfo', visible: true, props: {
        customerTitle: 'Name and Address of the Customer',
        rows: [
          { label: 'Test Order/ Job code No', field: 'jobCodeText' }, { label: 'ULR No.', field: 'ulr' },
          { label: 'Date of sample Received', field: 'receivedText' }, { label: 'Date of Test', field: 'testDatesText' },
          { label: 'Date of Issue', field: 'issueText' }, { label: 'Specification*', field: 'specification' },
          { label: 'Condition of sample at lab', field: 'condition' }, { label: 'Source of sample', field: 'source' },
        ] } },
      { id: 'tableTitle', type: 'title', visible: true, props: { text: 'TABLE-1', subtitle: 'TEST REPORT ON {{doc.materialUpper}}', small: true } },
      { id: 'results', type: 'results', visible: true, props: { sno: 'S.No', test: 'Name of Test', units: 'Units', method: 'Test method', sampleHeader: 'Sample ID*', resultsLabel: 'Results' } },
      { id: 'remarks', type: 'remarks', visible: true, props: { label: 'Remarks:' } },
      { id: 'charts', type: 'charts', visible: false, props: { title: 'Graphs' } },
      { id: 'notes', type: 'notes', visible: true, props: { title: 'Note:' } },
      { id: 'end', type: 'text', visible: true, props: { text: '*** END OF REPORT ***', align: 'center', size: 11 } },
      { id: 'signature', type: 'signature', visible: true, props: { forText: 'For {{company.name}}', label: 'AUTHORIZED SIGNATORY', showSeal: true, showName: true, showSignature: true, showQualifications: true, align: 'left' } },
      { id: 'footer', type: 'footer', visible: true, props: {} },
    ],
  },
  receipt: {
    kind: 'receipt', name: 'Payment receipt', page,
    blocks: [
      { id: 'letterhead', type: 'letterhead', visible: true, props: { showLogo: true, showCIN: true, showGST: true, showAccreditation: false } },
      { id: 'title', type: 'title', visible: true, props: { text: 'PAYMENT RECEIPT', subtitle: '' } },
      { id: 'body', type: 'receiptBody', visible: true, props: {} },
      { id: 'signature', type: 'signature', visible: true, props: { forText: 'For {{company.name}}', label: 'AUTHORIZED SIGNATORY', showSeal: true, showName: true, showSignature: true } },
      { id: 'footer', type: 'footer', visible: true, props: {} },
    ],
  },
  statement: {
    kind: 'statement', name: 'Statement of account', page,
    blocks: [
      { id: 'letterhead', type: 'letterhead', visible: true, props: { showLogo: true, showCIN: true, showGST: true, showAccreditation: false } },
      { id: 'title', type: 'title', visible: true, props: { text: 'STATEMENT OF ACCOUNT', subtitle: '' } },
      { id: 'body', type: 'statementBody', visible: true, props: {} },
      { id: 'footer', type: 'footer', visible: true, props: {} },
    ],
  },
};

export const BLOCK_LABELS: Record<string, string> = {
  letterhead: 'Company header', title: 'Title', party: 'Client and document details', items: 'Items table', totals: 'Totals and GST',
  amountWords: 'Amount in words', notes: 'Notes / terms', signature: 'Signature', bankSignature: 'Bank details and signature', footer: 'Company footer',
  text: 'Text', reportInfo: 'Report details', results: 'Results table', remarks: 'Remarks', charts: 'Graphs', receiptBody: 'Receipt details', statementBody: 'Statement',
};
