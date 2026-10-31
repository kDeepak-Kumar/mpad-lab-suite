import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Autocomplete } from '@mantine/core';
import { useDebouncedValue, useHotkeys } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { api } from '../api';

type Hit = { value: string; label: string; to: string };

/** Search clients, documents and samples from anywhere (Ctrl+K). */
export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [deb] = useDebouncedValue(q, 250);
  const [hits, setHits] = useState<Hit[]>([]);
  const nav = useNavigate();
  useHotkeys([['mod+K', () => document.getElementById('global-search')?.focus()]]);
  useEffect(() => {
    if (deb.trim().length < 2) { setHits([]); return; }
    Promise.all([
      api<any[]>(`/clients?q=${encodeURIComponent(deb)}`, { quiet: true }),
      api<any[]>(`/documents?q=${encodeURIComponent(deb)}`, { quiet: true }),
      api<any[]>(`/samples?q=${encodeURIComponent(deb)}`, { quiet: true }),
    ]).then(([c, d, s]) => setHits([
      ...c.slice(0, 5).map((x) => ({ value: `c${x.id}`, label: `Client · ${x.name}`, to: `/clients/${x.id}` })),
      ...d.filter((x) => x.status !== 'cancelled').slice(0, 6).map((x) => ({ value: `d${x.id}`, label: `${x.kind === 'quote' ? 'Quotation' : x.kind === 'invoice' ? 'Invoice' : 'Report'} · ${x.number || 'draft'} · ${x.client_name ?? ''}`, to: `/documents/${x.id}` })),
      ...s.slice(0, 5).map((x) => ({ value: `s${x.id}`, label: `Sample · ${x.code} · ${x.client_name}`, to: `/samples?open=${x.id}` })),
    ])).catch(() => setHits([]));
  }, [deb]);
  return (
    <Autocomplete id="global-search" placeholder="Search (Ctrl+K)" leftSection={<IconSearch size={16} />} w={{ base: 140, sm: 300 }} visibleFrom="xs"
      value={q} onChange={setQ} data={hits.map((h) => h.label)} filter={({ options }) => options}
      onOptionSubmit={(v) => { const h = hits.find((x) => x.label === v); setQ(''); if (h) nav(h.to); }} />
  );
}
