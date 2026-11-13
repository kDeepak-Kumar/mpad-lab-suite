import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ActionIcon, Badge, Group, Paper, ScrollArea, Text, Textarea, Tooltip, UnstyledButton, CopyButton, Loader } from '@mantine/core';
import { IconArrowUp, IconCheck, IconCopy, IconMinus, IconRefresh, IconSparkles, IconX } from '@tabler/icons-react';
import { api } from '../api';
import { useCan, useMe, hasTab } from '../ctx';
import { Markdown } from './Markdown';

type Msg = { role: 'user' | 'assistant'; content: string; mode?: string };
const KEY = 'assistant-chat';
const load = (): Msg[] => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]'); } catch { return []; } };

/** The assistant panel: opened from "Ask AI" in the top bar or Ctrl+J; the conversation stays while moving between pages. Escape minimises it. */
export function Assistant() {
  const me = useMe();
  const can = useCan();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(load);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch { /* ignore */ } setTimeout(() => view.current?.scrollTo({ top: 1e6, behavior: 'smooth' }), 30); }, [msgs, open]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setOpen((o) => !o); } }; const t = () => setOpen((o) => !o); window.addEventListener('keydown', k); window.addEventListener('assistant:toggle', t); return () => { window.removeEventListener('keydown', k); window.removeEventListener('assistant:toggle', t); }; }, []);

  const send = async (text: string) => {
    const t = text.trim(); if (!t || busy) return;
    const next = [...msgs, { role: 'user' as const, content: t }];
    setMsgs(next); setQ(''); setBusy(true);
    try {
      const r = await api<{ answer: string; mode: string }>('/assistant/chat', { body: { messages: next.slice(-10).map(({ role, content }) => ({ role, content })), page: loc.pathname }, quiet: true });
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, mode: r.mode }]);
    } catch (e) { setMsgs((m) => [...m, { role: 'assistant', content: `Sorry, that did not work: ${(e as Error).message}` }]); }
    finally { setBusy(false); }
  };
  const ideas = [
    hasTab(me, 'tests') && 'What is pending for me?',
    can('invoice.read') && 'Which invoices are unpaid?',
    can('viewAnalytics') && 'Revenue by client this year',
    can('equipment.read') && 'Which calibrations are due?',
    'How do I register a sample?',
  ].filter(Boolean) as string[];

  if (!open) return null; // opened from the top bar (Ask AI) or with Ctrl+J
  return (
    <Paper className="asst-panel no-print" shadow="xl" radius="lg" role="dialog" aria-label="Assistant" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
      <Group className="asst-head" justify="space-between" wrap="nowrap">
        <Group gap={8} wrap="nowrap"><span className="asst-badge"><IconSparkles size={16} /></span><div><Text fw={650} size="sm">Assistant</Text><Text size="xs" c="dimmed">Sees only what your role can see</Text></div></Group>
        <Group gap={2} wrap="nowrap">
          {msgs.length > 0 && <Tooltip label="New conversation"><ActionIcon variant="subtle" color="gray" aria-label="New conversation" onClick={() => setMsgs([])}><IconRefresh size={16} /></ActionIcon></Tooltip>}
          <Tooltip label="Minimise (Esc)"><ActionIcon variant="subtle" color="gray" aria-label="Minimise" onClick={() => setOpen(false)}><IconMinus size={16} /></ActionIcon></Tooltip>
          <Tooltip label="Close and clear"><ActionIcon variant="subtle" color="gray" aria-label="Close and clear" onClick={() => { setOpen(false); setMsgs([]); }}><IconX size={16} /></ActionIcon></Tooltip>
        </Group>
      </Group>
      <ScrollArea className="asst-body" viewportRef={view}>
        {!msgs.length && (
          <div className="asst-empty">
            <Text fw={650}>Hi {me.user.name.split(' ')[0]}, how can I help?</Text>
            <Text size="xs" c="dimmed" mb="sm">Ask about clients, samples, quotations, invoices, reports, equipment, your pending work, business figures or how to do something in the app.</Text>
            {ideas.map((i) => <UnstyledButton key={i} className="asst-idea" onClick={() => send(i)}>{i}</UnstyledButton>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`asst-msg ${m.role}`}>
            {m.role === 'user' ? <Text size="sm">{m.content}</Text> : <>
              <Markdown text={m.content} onLink={() => window.innerWidth < 700 && setOpen(false)} />
              <Group gap={6} mt={4}>
                <CopyButton value={m.content}>{({ copied, copy }) => <Tooltip label={copied ? 'Copied' : 'Copy'}><ActionIcon size="xs" variant="subtle" color="gray" onClick={copy}>{copied ? <IconCheck size={12} /> : <IconCopy size={12} />}</ActionIcon></Tooltip>}</CopyButton>
                {m.mode === 'builtin' && <Badge size="xs" variant="light" color="gray" style={{ textTransform: 'none' }}>built-in search</Badge>}
              </Group>
            </>}
          </div>
        ))}
        {busy && <div className="asst-msg assistant"><Group gap={6}><Loader size="xs" type="dots" /><Text size="xs" c="dimmed">Looking it up…</Text></Group></div>}
      </ScrollArea>
      <div className="asst-input">
        <Textarea autosize minRows={1} maxRows={4} placeholder="Ask anything…" value={q} onChange={(e) => setQ(e.currentTarget.value)} data-autofocus autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(q); } }} style={{ flex: 1 }} />
        <ActionIcon size="lg" radius="xl" onClick={() => send(q)} disabled={!q.trim() || busy} aria-label="Send"><IconArrowUp size={18} /></ActionIcon>
      </div>
    </Paper>
  );
}
