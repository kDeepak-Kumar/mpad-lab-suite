import { describe, expect, it } from 'vitest';
import { fillWa, waLink, waNumber, waTemplates, WA_TEMPLATES } from './whatsapp';

describe('whatsapp', () => {
  it('normalises Indian numbers', () => {
    expect(waNumber('98765 43210')).toBe('919876543210');
    expect(waNumber('+91-98765-43210')).toBe('919876543210');
    expect(waNumber('098765 43210')).toBe('919876543210');
    expect(waNumber('0091 98765 43210')).toBe('919876543210');
    expect(waNumber('+1 415 555 0100')).toBe('14155550100');
    expect(waNumber('98765 43210, 040 1234567')).toBe('919876543210');
    expect(waNumber('12345')).toBeNull();
    expect(waNumber('')).toBeNull();
  });
  it('fills templates and drops empty label lines', () => {
    const t = WA_TEMPLATES.find((x) => x.key === 'invoice')!.text;
    const msg = fillWa(t, { contact: 'Mr Rao', company: 'Test Lab', number: 'INV-1', date: '01-11-2026', amount: '1,180.00', link: 'https://x/d/1', sender: 'Asha', phone: '99999', site: '' });
    expect(msg).toContain('Dear Mr Rao,');
    expect(msg).toContain('*INV-1* dated 01-11-2026.');
    expect(msg).not.toContain('{{');
    expect(msg).not.toContain('UPI:');
    expect(msg).not.toContain('Payment details');
    expect(msg).not.toMatch(/\n\n\n/);
    expect(fillWa(t, { date: '01-11-2026' })).toContain('Please find tax invoice dated 01-11-2026.');
  });
  it('keeps payment details when present and cleans empty due date', () => {
    const t = WA_TEMPLATES.find((x) => x.key === 'reminder')!.text;
    const msg = fillWa(t, { contact: 'Sir', balance: '500.00', number: 'INV-2', bank: 'A/c 123', upi: 'lab@upi' });
    expect(msg).toContain('pending against invoice INV-2.');
    expect(msg).toContain('*Payment details*\nA/c 123\nUPI: lab@upi');
    expect(fillWa(t, { number: 'INV-2', due_date: '10-11-2026' })).toContain('INV-2 (due 10-11-2026).');
  });
  it('builds links and applies custom templates', () => {
    expect(waLink('919876543210', 'Hi & bye')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye');
    expect(waLink(null, 'x')).toBe('https://wa.me/?text=x');
    expect(waTemplates({ quote: 'Custom {{number}}' }).find((t) => t.key === 'quote')!.text).toBe('Custom {{number}}');
    expect(waTemplates({ quote: '  ' }).find((t) => t.key === 'quote')!.text).toContain('quotation');
  });
});
