import { Checkbox, MultiSelect, NumberInput, Select, SimpleGrid, Textarea, TextInput } from '@mantine/core';
import { useState } from 'react';
import { INDIAN_STATES, fieldIssue, type FieldDef } from '@suite/shared';
import { useFields, usePicklist } from '../ctx';

type F = FieldDef & { access: 'edit' | 'read' | 'hidden' };

export function FieldInput({ f, value, onChange, disabled, error }: { f: FieldDef & { access?: string }; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; error?: string }) {
  const options = usePicklist(f.picklist);
  const ro = disabled || f.access === 'read';
  // Format problems (email, phone, GSTIN, PAN, PIN…) show once the user leaves the field, so typing isn't interrupted.
  const [touched, setTouched] = useState(false);
  const live = touched && !ro ? fieldIssue(f, value) : null;
  const common = { label: f.label, description: f.help, required: f.required, disabled: ro, error: error || live || undefined, onBlur: () => setTouched(true) };
  switch (f.type) {
    case 'textarea': return <Textarea {...common} autosize minRows={2} value={(value as string) ?? ''} onChange={(e) => onChange(e.currentTarget.value)} />;
    case 'number': case 'integer': case 'currency':
      return <NumberInput {...common} value={(value as number) ?? ''} allowDecimal={f.type !== 'integer'} thousandSeparator={f.type === 'currency' ? ',' : undefined}
        leftSection={f.type === 'currency' ? '₹' : undefined} hideControls onChange={(v) => onChange(v === '' ? null : Number(v))} />;
    case 'date': return <TextInput {...common} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.currentTarget.value || null)} />;
    case 'checkbox': return <Checkbox mt={26} label={f.label} disabled={ro} checked={Boolean(value)} onChange={(e) => onChange(e.currentTarget.checked)} />;
    case 'picklist': {
      const data = options.some((o) => o.value === value) || !value ? options : [...options, { value: String(value), label: String(value) }];
      return <Select {...common} data={data} value={(value as string) ?? null} onChange={(v) => onChange(v)} searchable clearable={!f.required} />;
    }
    case 'multipicklist': return <MultiSelect {...common} data={options} value={(value as string[]) ?? []} onChange={(v) => onChange(v)} searchable />;
    case 'state': return <Select {...common} searchable data={INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} – ${s.name}` }))} value={(value as string) ?? null} onChange={(v) => onChange(v)} />;
    default: return <TextInput {...common} type={f.type === 'email' ? 'email' : 'text'} value={(value as string) ?? ''} onChange={(e) => onChange(e.currentTarget.value)} />;
  }
}

/**
 * Metadata-driven form: standard + custom fields, in the admin's layout order,
 * respecting field-level security. Custom values live under `value.custom`.
 */
export function RecordForm({ object, value, onChange, cols = 2, exclude = [], disabled, errors }: {
  object: string; value: Record<string, any>; onChange: (v: Record<string, any>) => void; cols?: number; exclude?: string[]; disabled?: boolean; errors?: Record<string, string>;
}) {
  const fields = useFields(object).filter((f) => !exclude.includes(f.key)) as F[];
  const get = (f: F) => (f.custom ? value.custom?.[f.key] : value[f.key]);
  const set = (f: F, v: unknown) => onChange(f.custom ? { ...value, custom: { ...(value.custom ?? {}), [f.key]: v } } : { ...value, [f.key]: v });
  const wide = (f: F) => f.type === 'textarea';
  return (
    <SimpleGrid cols={{ base: 1, sm: cols }} spacing="sm" verticalSpacing="sm">
      {fields.map((f) => (
        <div key={f.key} style={wide(f) ? { gridColumn: '1 / -1' } : undefined}>
          <FieldInput f={f} value={get(f)} onChange={(v) => set(f, v)} disabled={disabled} error={errors?.[f.key]} />
        </div>
      ))}
    </SimpleGrid>
  );
}

/** Required standard/custom fields that are empty. */
export function missingRequired(fields: F[], value: Record<string, any>) {
  return fields.filter((f) => f.required && f.access === 'edit' && f.type !== 'checkbox' && [undefined, null, ''].includes((f.custom ? value.custom?.[f.key] : value[f.key]) as never)).map((f) => f.label);
}
