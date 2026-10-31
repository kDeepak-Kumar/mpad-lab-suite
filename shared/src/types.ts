export type Role = 'owner' | 'frontdesk' | 'technician' | 'reviewer' | 'signatory' | 'accountant';
export const ROLES: { key: Role; label: string }[] = [
  { key: 'owner', label: 'Owner / Admin' },
  { key: 'frontdesk', label: 'Front desk / Sales' },
  { key: 'technician', label: 'Technician' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'signatory', label: 'Authorised signatory' },
  { key: 'accountant', label: 'Accountant' },
];

export type TestStatus = 'pending' | 'in_progress' | 'submitted' | 'returned' | 'accepted' | 'reported';
export const TEST_STATUS_LABEL: Record<TestStatus, string> = {
  pending: 'Pending', in_progress: 'In progress', submitted: 'Submitted for review', returned: 'Returned', accepted: 'Accepted', reported: 'Reported',
};
export type DocStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'review' | 'verified' | 'issued' | 'cancelled' | 'paid' | 'partly_paid';
