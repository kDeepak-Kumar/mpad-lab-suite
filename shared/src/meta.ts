/**
 * Metadata: objects, fields, picklists, layouts and roles. Admins customise these at runtime
 * (Setup), the same way a Salesforce admin adds fields, picklist values and permissions.
 */

export type MetaFieldType = 'text' | 'textarea' | 'number' | 'integer' | 'currency' | 'date' | 'picklist' | 'multipicklist' | 'checkbox' | 'email' | 'phone' | 'state';

export interface FieldDef {
  key: string; label: string; type: MetaFieldType;
  picklist?: string; required?: boolean; help?: string;
  custom?: boolean;           // admin-created, stored in data.custom
  system?: boolean;           // cannot be removed or hidden from layouts
  defaultValue?: unknown;
}
export interface ObjectDef { key: string; label: string; plural: string; fields: FieldDef[] }

const f = (key: string, label: string, type: MetaFieldType = 'text', extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type, ...extra });

export const OBJECTS: ObjectDef[] = [
  { key: 'client', label: 'Client', plural: 'Clients', fields: [
    f('name', 'Client (legal) name', 'text', { required: true, system: true }), f('short_code', 'Short code', 'text', { help: 'Used in job codes, e.g. XDPL' }),
    f('type', 'Type', 'picklist', { picklist: 'client_type' }), f('gstin', 'GSTIN'), f('state_code', 'State (place of supply)', 'state'), f('pan', 'PAN'),
    f('email', 'Email', 'email'), f('phone', 'Phone', 'phone'), f('payment_terms_days', 'Payment terms (days)', 'integer'),
    f('opening_balance', 'Opening balance', 'currency'), f('address', 'Billing address', 'textarea'), f('notes', 'Notes', 'textarea'),
  ] },
  { key: 'site', label: 'Site / project', plural: 'Sites', fields: [
    f('name', 'Site name', 'text', { required: true, system: true }), f('project', 'Project name'), f('po_number', 'Client PO / WO no.'), f('state_code', 'State', 'state'), f('address', 'Site address', 'textarea'),
  ] },
  { key: 'contact', label: 'Contact', plural: 'Contacts', fields: [
    f('name', 'Name', 'text', { required: true, system: true }), f('role', 'Role'), f('phone', 'Phone', 'phone'), f('email', 'Email', 'email'),
  ] },
  { key: 'sample', label: 'Sample', plural: 'Samples', fields: [
    f('accreditation', 'Report type', 'picklist', { picklist: 'accreditation', required: true, system: true }), f('material', 'Material', 'picklist', { picklist: 'material', required: true, system: true }),
    f('received_date', 'Date received', 'date', { required: true, system: true }), f('quantity', 'Quantity received'), f('condition', 'Condition at lab', 'picklist', { picklist: 'sample_condition' }),
    f('source', 'Source of sample', 'picklist', { picklist: 'sample_source' }), f('customer_ref', 'Customer reference'), f('sample_label', 'Sample ID (customer)'),
    f('specification', 'Specification'), f('description', 'Description / location', 'textarea'),
  ] },
  { key: 'catalog', label: 'Rate card item', plural: 'Rate card', fields: [
    f('billing_name', 'Billing description', 'textarea', { required: true, system: true }), f('report_name', 'Report name'), f('method', 'Test method'), f('code', 'Code'),
    f('material', 'Material', 'picklist', { picklist: 'material' }), f('unit', 'Pricing unit', 'picklist', { picklist: 'unit' }), f('rate', 'Rate', 'currency'),
    f('sac', 'SAC'), f('gst_rate', 'GST %', 'number'), f('tat_days', 'Turnaround (days)', 'integer'), f('nabl', 'Within NABL scope', 'checkbox'), f('active', 'Active', 'checkbox'),
    f('conditions', 'Conditions (added to quotation notes)', 'textarea'), f('report_notes', 'Report notes (only on reports with this test)', 'textarea'),
  ] },
  { key: 'equipment', label: 'Equipment', plural: 'Equipment', fields: [
    f('name', 'Name', 'text', { required: true, system: true }), f('category', 'Category', 'picklist', { picklist: 'equipment_category' }), f('id_no', 'ID number'), f('make', 'Make / model'),
    f('cert_no', 'Calibration certificate no.'), f('cal_date', 'Calibrated on', 'date'), f('due_date', 'Calibration due', 'date'),
  ] },
  { key: 'quote', label: 'Quotation', plural: 'Quotations', fields: [] },
  { key: 'workorder', label: 'Work order', plural: 'Work orders', fields: [] },
  { key: 'report', label: 'Test report', plural: 'Test reports', fields: [] },
  { key: 'invoice', label: 'Invoice', plural: 'Invoices', fields: [] },
  { key: 'payment', label: 'Payment', plural: 'Payments', fields: [] },
  { key: 'test', label: 'Test', plural: 'Tests', fields: [] },
];
export const objectDef = (k: string) => OBJECTS.find((o) => o.key === k);

export interface PicklistValue { value: string; label?: string; active?: boolean; color?: string }
export interface Picklist { key: string; label: string; values: PicklistValue[]; system?: boolean }

const pl = (key: string, label: string, values: string[], extra: Partial<Picklist> = {}): Picklist => ({ key, label, values: values.map((v) => ({ value: v, active: true })), ...extra });
export const DEFAULT_PICKLISTS: Picklist[] = [
  { ...pl('accreditation', 'Report type (accreditation)', ['NABL', 'Non-NABL'], { system: true }), values: [{ value: 'NABL', active: true, color: 'teal' }, { value: 'Non-NABL', active: true, color: 'gray' }] },
  pl('material', 'Material', ['Soil', 'Concrete', 'Cement', 'Steel', 'Aggregate', 'Sand', 'Brick / Block', 'Water', 'Bitumen', 'GSB', 'Rock', 'Service']),
  pl('sample_condition', 'Sample condition', ['Satisfactory', 'Good', 'Damaged', 'Insufficient quantity']),
  pl('sample_source', 'Sample source', ['Sample supplied by the customer', 'Collected by lab from site']),
  { key: 'client_type', label: 'Client type', values: [{ value: 'company', label: 'Company', active: true }, { value: 'government', label: 'Government', active: true }, { value: 'individual', label: 'Individual', active: true }, { value: 'walkin', label: 'Walk-in / cash', active: true }] },
  pl('unit', 'Pricing unit', ['Per sample', 'Per set', 'Per point', 'Per visit', 'Per borehole', 'Per metre', 'Per day', 'Lump sum']),
  pl('payment_mode', 'Payment mode', ['Bank transfer (NEFT/RTGS)', 'UPI', 'Cheque', 'Cash', 'DD']),
  pl('equipment_category', 'Equipment category', ['Proving ring', 'Compression testing machine', 'Universal testing machine', 'Balance', 'Oven', 'Dial gauge', 'Sieve set', 'Other']),
];

/** Per-object layout: field order and visibility in forms, default list columns. */
export interface Layout { object: string; fields: string[]; hidden: string[]; listColumns?: string[] }

// ---------- roles & permissions ----------
export const TABS: { key: string; label: string }[] = [
  { key: 'home', label: 'Home' }, { key: 'clients', label: 'Clients' }, { key: 'quotes', label: 'Quotations' }, { key: 'workorders', label: 'Work orders' },
  { key: 'samples', label: 'Sample register' }, { key: 'tests', label: 'Tests & observations' }, { key: 'prepare', label: 'Prepare report' }, { key: 'reports', label: 'Reports' },
  { key: 'invoices', label: 'Invoices' }, { key: 'payments', label: 'Payments' }, { key: 'ledger', label: 'Ledgers' }, { key: 'registers', label: 'Registers' },
  { key: 'analytics', label: 'Analytics & AI' }, { key: 'company', label: 'Company & branding' }, { key: 'catalog', label: 'Rate card' }, { key: 'equipment', label: 'Equipment' },
  { key: 'templates', label: 'Templates' }, { key: 'users', label: 'Users' }, { key: 'setup', label: 'Setup (customise)' },
];
export const PERM_OBJECTS = ['client', 'quote', 'workorder', 'sample', 'test', 'report', 'invoice', 'payment', 'catalog', 'equipment'] as const;
export type Crud = { read: boolean; create: boolean; edit: boolean; delete: boolean };
export const ACTIONS: { key: string; label: string }[] = [
  { key: 'enterObservations', label: 'Enter observation sheets' }, { key: 'reviewTests', label: 'Review (accept/return) observations' },
  { key: 'prepareReports', label: 'Prepare test reports' }, { key: 'signReports', label: 'Verify, sign and issue reports' },
  { key: 'issueInvoices', label: 'Issue invoices' }, { key: 'recordPayments', label: 'Record payments' },
  { key: 'viewAnalytics', label: 'View analytics & dashboards' }, { key: 'useAI', label: 'Use the AI assistant' },
  { key: 'manageTemplates', label: 'Edit templates' }, { key: 'manageSettings', label: 'Company settings' },
  { key: 'manageUsers', label: 'Manage users' }, { key: 'manageCustomization', label: 'Customise fields, picklists, layouts, roles' },
];
export interface RoleDef {
  key: string; label: string; system?: boolean;
  /** System Administrator: everything, and skips workflow validations. */
  admin?: boolean;
  tabs: string[];
  objects: Record<string, Crud>;
  actions: Record<string, boolean>;
  /** Field-level security, e.g. { 'client.opening_balance': 'hidden', 'catalog.rate': 'read' } */
  fields: Record<string, 'hidden' | 'read'>;
}

const all: Crud = { read: true, create: true, edit: true, delete: true };
const ro: Crud = { read: true, create: false, edit: false, delete: false };
const ce: Crud = { read: true, create: true, edit: true, delete: false };
const none: Crud = { read: false, create: false, edit: false, delete: false };
const objs = (m: Partial<Record<string, Crud>>, d: Crud = none) => Object.fromEntries(PERM_OBJECTS.map((o) => [o, m[o] ?? d]));
const acts = (keys: string[]) => Object.fromEntries(ACTIONS.map((a) => [a.key, keys.includes(a.key)]));

export const BUILTIN_ROLES: RoleDef[] = [
  { key: 'admin', label: 'System Administrator', system: true, admin: true, tabs: TABS.map((t) => t.key), objects: objs({}, all), actions: acts(ACTIONS.map((a) => a.key)), fields: {} },
  { key: 'owner', label: 'Owner / Director', system: true, tabs: TABS.map((t) => t.key), objects: objs({}, all), actions: acts(ACTIONS.map((a) => a.key)), fields: {} },
  { key: 'frontdesk', label: 'Front desk / Sales', system: true, tabs: ['home', 'clients', 'quotes', 'workorders', 'samples', 'tests', 'reports', 'invoices', 'payments'],
    objects: objs({ client: ce, quote: ce, workorder: ce, sample: ce, test: ro, report: ro, invoice: ce, payment: ro, catalog: ro, equipment: none }), actions: acts(['useAI']), fields: {} },
  { key: 'technician', label: 'Technician', system: true, tabs: ['home', 'samples', 'tests'],
    objects: objs({ sample: ro, test: { read: true, create: false, edit: true, delete: false }, catalog: ro, equipment: ro }), actions: acts(['enterObservations']), fields: { 'catalog.rate': 'hidden' } },
  { key: 'reviewer', label: 'Reviewer / Technical manager', system: true, tabs: ['home', 'samples', 'tests', 'prepare', 'reports', 'equipment', 'templates'],
    objects: objs({ sample: ce, test: ce, report: ce, catalog: ro, equipment: ce, client: ro }), actions: acts(['enterObservations', 'reviewTests', 'prepareReports', 'manageTemplates', 'useAI']), fields: {} },
  { key: 'signatory', label: 'Authorised signatory', system: true, tabs: ['home', 'samples', 'tests', 'prepare', 'reports', 'equipment', 'templates', 'analytics'],
    objects: objs({ sample: ce, test: ce, report: ce, catalog: ro, equipment: ce, client: ro }), actions: acts(['enterObservations', 'reviewTests', 'prepareReports', 'signReports', 'manageTemplates', 'viewAnalytics', 'useAI']), fields: {} },
  { key: 'accountant', label: 'Accountant', system: true, tabs: ['home', 'clients', 'quotes', 'invoices', 'payments', 'ledger', 'registers', 'analytics'],
    objects: objs({ client: ce, quote: ro, workorder: ro, invoice: ce, payment: ce, catalog: ro, report: ro }), actions: acts(['issueInvoices', 'recordPayments', 'viewAnalytics', 'useAI']), fields: {} },
];

/** Does a role allow an action or object operation, e.g. "reviewTests" or "invoice.edit"? */
export function roleAllows(role: RoleDef | undefined, perm: string): boolean {
  if (!role) return false;
  if (role.admin) return true;
  if (perm.includes('.')) {
    const [o, op] = perm.split('.') as [string, keyof Crud];
    return Boolean(role.objects[o]?.[op]);
  }
  return Boolean(role.actions[perm]);
}
export const fieldAccess = (role: RoleDef | undefined, object: string, field: string): 'edit' | 'read' | 'hidden' =>
  role?.admin ? 'edit' : (role?.fields[`${object}.${field}`] ?? 'edit');
