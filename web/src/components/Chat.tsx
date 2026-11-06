import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionIcon, Avatar, Badge, Group, Indicator, Loader, Paper, Popover, ScrollArea, Text, TextInput, Textarea, Tooltip, UnstyledButton, CopyButton, Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBold, IconBrandWhatsapp, IconCheck, IconChecks, IconCopy, IconList, IconMessageCircle, IconMinus, IconSearch, IconSend, IconTable, IconX } from '@tabler/icons-react';
import { waLink, waNumber } from '@suite/shared';
import { api } from '../api';
import { Markdown } from './Markdown';

type Contact = { id: number; name: string; designation?: string; role: string; photo?: string | null; online: boolean; last_seen: string | null; unread: number; hasPhone: boolean; last: { body: string; at: string; mine: boolean } | null };
type Msg = { id: number; from_user: number; to_user: number; body: string; created_at: string; read_at?: string | null; pending?: boolean };
interface ChatState { open: (id: number) => void; unread: number; presence: Record<number, { online: boolean; last_seen: string | null }>; tick: number; latest: Msg[] }
const Ctx = createContext<ChatState | null>(null);
const KEY = 'chat-open';

export const ago = (iso?: string | null) => {
  if (!iso) return 'not seen yet';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'a minute ago'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const initials = (n: string) => n.replace(/[^\p{L} ]/gu, ' ').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/** Internal chat: polls for new messages and presence; one floating conversation that stays open across pages. */
export function ChatProvider({ meId, children }: { meId: number; children: ReactNode }) {
  const [openId, setOpenId] = useState<number | null>(() => { try { return Number(sessionStorage.getItem(KEY)) || null; } catch { return null; } });
  const [min, setMin] = useState(false);
  const [unread, setUnread] = useState(0);
  const [presence, setPresence] = useState<ChatState['presence']>({});
  const [latest, setLatest] = useState<Msg[]>([]);
  const [tick, setTick] = useState(0);
  const since = useRef<number | null>(null);
  const openRef = useRef(openId); openRef.current = min ? null : openId;
  const open = useCallback((id: number) => { setOpenId(id); setMin(false); try { sessionStorage.setItem(KEY, String(id)); } catch { /* ignore */ } }, []);
  const close = () => { setOpenId(null); try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };
  useEffect(() => {
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await api<any>(`/chat/poll${since.current === null ? '' : `?since=${since.current}`}`, { quiet: true });
        if (since.current !== null && r.messages.length) {
          setLatest(r.messages);
          for (const m of r.messages as (Msg & { from_name: string })[]) if (openRef.current !== m.from_user) notifications.show({ id: `chat-${m.id}`, title: `💬 ${m.from_name}`, message: m.body.replace(/\|?\s*:?-{3,}:?\s*\|?/g, ' ').replace(/[*#`|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120), autoClose: 6000, onClick: () => open(m.from_user), style: { cursor: 'pointer' } });
        }
        since.current = Math.max(since.current ?? 0, r.latestId); setUnread(r.unread); setPresence(r.presence); setTick((t) => t + 1);
      } catch { /* offline – try again */ }
      if (!stop) timer = setTimeout(poll, document.hidden ? 30000 : 6000);
    };
    poll();
    const vis = () => { if (!document.hidden) { clearTimeout(timer); poll(); } };
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return (
    <Ctx.Provider value={{ open, unread, presence, tick, latest }}>
      {children}
      {openId && <ChatWindow meId={meId} userId={openId} minimised={min} onMin={() => setMin(!min)} onClose={close} />}
    </Ctx.Provider>
  );
}
export const useChat = () => useContext(Ctx);

/** Top-bar chat icon: colleagues with online status; click one to chat. */
export function ChatButton() {
  const c = useChat();
  const [opened, setOpened] = useState(false);
  const [list, setList] = useState<Contact[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { if (opened) api<Contact[]>('/chat/contacts', { quiet: true }).then(setList).catch(() => setList([])); }, [opened, c?.tick]);
  if (!c) return null;
  const shown = (list ?? []).filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));
  const online = (list ?? []).filter((x) => x.online).length;
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={340} shadow="lg">
      <Popover.Target>
        <Tooltip label="Team chat" disabled={opened}>
          <Indicator label={c.unread > 9 ? '9+' : c.unread} size={16} disabled={!c.unread} color="red" offset={4}>
            <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => setOpened((o) => !o)} aria-label="Team chat"><IconMessageCircle size={21} /></ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <div style={{ padding: '10px 12px 6px' }}>
          <Group justify="space-between"><Text fw={650} size="sm">Team chat</Text><Text size="xs" c="dimmed">{online} online</Text></Group>
          <TextInput mt={6} size="xs" placeholder="Find a colleague" leftSection={<IconSearch size={14} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        </div>
        <ScrollArea.Autosize mah={420}>
          {!list ? <Group p="md" justify="center"><Loader size="sm" /></Group> : !shown.length ? <Text size="sm" c="dimmed" p="md">No colleagues found.</Text> : shown.map((x) => (
            <UnstyledButton key={x.id} className="chat-contact" onClick={() => { c.open(x.id); setOpened(false); }}>
              <Indicator color={x.online ? 'teal' : 'gray'} size={10} offset={4} position="bottom-end" withBorder disabled={!x.online}><Avatar src={x.photo || null} radius="xl" size={36}>{initials(x.name)}</Avatar></Indicator>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Group justify="space-between" wrap="nowrap" gap={4}><Text size="sm" fw={x.unread ? 700 : 550} truncate>{x.name}</Text><Text size="xs" c={x.online ? 'teal' : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>{x.online ? 'online' : ago(x.last_seen)}</Text></Group>
                <Group justify="space-between" wrap="nowrap" gap={4}>
                  <Text size="xs" c="dimmed" truncate>{x.last ? `${x.last.mine ? 'You: ' : ''}${x.last.body.replace(/[*|#`]/g, '')}` : x.designation || x.role}</Text>
                  {x.unread > 0 && <Badge size="xs" circle color="red">{x.unread}</Badge>}
                </Group>
              </div>
            </UnstyledButton>
          ))}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}

function ChatWindow({ meId, userId, minimised, onMin, onClose }: { meId: number; userId: number; minimised: boolean; onMin: () => void; onClose: () => void }) {
  const c = useChat()!;
  const [who, setWho] = useState<any>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [more, setMore] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const bottom = () => setTimeout(() => view.current?.scrollTo({ top: 1e7 }), 30);
  const load = useCallback(async () => {
    const r = await api<any>(`/chat/with/${userId}`, { quiet: true });
    setWho(r.colleague); setMsgs(r.messages); setMore(r.more); bottom();
  }, [userId]);
  useEffect(() => { setMsgs(null); setWho(null); load().catch(() => setErr('Could not open the conversation')); }, [userId]);
  // new messages from this colleague arrive through the shared poll
  useEffect(() => {
    const mine = c.latest.filter((m) => m.from_user === userId);
    if (mine.length && msgs) { setMsgs((x) => [...(x ?? []), ...mine.filter((m) => !(x ?? []).some((y) => y.id === m.id))]); if (!minimised) api(`/chat/read/${userId}`, { method: 'POST', quiet: true }).catch(() => undefined); bottom(); }
  }, [c.latest]);
  useEffect(() => { if (msgs && c.tick % 3 === 0) load().catch(() => undefined); }, [c.tick]); // refresh read ticks now and then
  const status = c.presence[userId] ?? who;
  const send = async () => {
    const body = text.trim(); if (!body) return;
    const temp: Msg = { id: -Date.now(), from_user: meId, to_user: userId, body, created_at: new Date().toISOString(), pending: true };
    setMsgs((x) => [...(x ?? []), temp]); setText(''); setErr(null); bottom();
    try { const r = await api<any>('/chat/send', { body: { to: userId, body }, quiet: true }); setMsgs((x) => (x ?? []).map((m) => (m.id === temp.id ? { ...m, id: r.id, pending: false } : m))); }
    catch (e) { setMsgs((x) => (x ?? []).filter((m) => m.id !== temp.id)); setText(body); setErr((e as Error).message); }
  };
  const wrap = (before: string, after = before, placeholder = 'text') => {
    const el = box.current; if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd, sel = text.slice(a, b) || placeholder;
    const next = text.slice(0, a) + before + sel + after + text.slice(b);
    setText(next); setTimeout(() => { el.focus(); el.setSelectionRange(a + before.length, a + before.length + sel.length); }, 0);
  };
  const shareFile = async (file: File | null) => {
    if (!file) return;
    const note = `Sending you "${file.name}" on WhatsApp.`;
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: note }); }
      else if (who?.phone) { window.open(waLink(waNumber(who.phone), note), '_blank', 'noopener'); notifications.show({ message: `WhatsApp opened for ${who.name} – attach “${file.name}” there.`, autoClose: 7000 }); }
      else { notifications.show({ color: 'orange', message: `${who?.name ?? 'This colleague'} has no phone number in Users. Add it to share files on WhatsApp.` }); return; }
      await api('/chat/send', { body: { to: userId, body: `📎 Shared *${file.name}* on WhatsApp` }, quiet: true }); load();
    } catch { /* share cancelled */ }
  };
  const loadOlder = async () => { const first = msgs?.find((m) => m.id > 0); if (!first) return; const r = await api<any>(`/chat/with/${userId}?before=${first.id}`, { quiet: true }); setMsgs((x) => [...r.messages, ...(x ?? [])]); setMore(r.more); };
  let lastDay = '';
  return (
    <Paper className={`chat-win no-print${minimised ? ' min' : ''}`} shadow="xl" radius="lg">
      <Group className="chat-head" justify="space-between" wrap="nowrap" onClick={minimised ? onMin : undefined}>
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <Indicator color={status?.online ? 'teal' : 'gray'} size={9} offset={3} position="bottom-end" withBorder disabled={!status?.online}><Avatar radius="xl" size={30}>{who ? initials(who.name) : ''}</Avatar></Indicator>
          <div style={{ minWidth: 0 }}><Text size="sm" fw={650} truncate className="chat-name">{who?.name ?? '…'}</Text><Text size="xs" className={`chat-status${status?.online ? ' on' : ''}`}>{status?.online ? 'online' : `last seen ${ago(status?.last_seen)}`}</Text></div>
        </Group>
        <Group gap={2} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
          {!minimised && <Tooltip label="Share a file on WhatsApp (not stored in the app)"><span><label className="chat-wa"><IconBrandWhatsapp size={18} /><input type="file" hidden onChange={(e) => { shareFile(e.currentTarget.files?.[0] ?? null); e.currentTarget.value = ''; }} /></label></span></Tooltip>}
          <Tooltip label={minimised ? 'Open' : 'Minimise'}><ActionIcon variant="subtle" color="gray" onClick={onMin}><IconMinus size={16} /></ActionIcon></Tooltip>
          <Tooltip label="Close"><ActionIcon variant="subtle" color="gray" onClick={onClose}><IconX size={16} /></ActionIcon></Tooltip>
        </Group>
      </Group>
      {!minimised && <>
        <ScrollArea className="chat-body" viewportRef={view}>
          {more && <Group justify="center" mb="xs"><Button size="compact-xs" variant="subtle" onClick={loadOlder}>Earlier messages</Button></Group>}
          {!msgs ? <Group justify="center" p="md"><Loader size="sm" /></Group> : !msgs.length ? <Text size="sm" c="dimmed" ta="center" p="md">Say hello to {who?.name?.split(' ')[0]}. Messages support **bold**, lists and tables.</Text> : msgs.map((m) => {
            const day = new Date(m.created_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
            const sep = day !== lastDay ? (lastDay = day) : null;
            const mine = m.from_user === meId;
            return (
              <div key={m.id}>
                {sep && <Text size="xs" c="dimmed" ta="center" my={6}>{sep}</Text>}
                <div className={`chat-msg ${mine ? 'mine' : ''}`}>
                  <Markdown text={m.body} />
                  <Group gap={4} justify="flex-end" className="chat-meta">
                    <CopyButton value={m.body}>{({ copied, copy }) => <ActionIcon size={16} variant="transparent" className="chat-copy" onClick={copy} aria-label="Copy">{copied ? <IconCheck size={11} /> : <IconCopy size={11} />}</ActionIcon>}</CopyButton>
                    <Text size="10px" c="dimmed">{time(m.created_at)}</Text>
                    {mine && (m.pending ? <Loader size={9} /> : m.read_at ? <Tooltip label={`Read ${ago(m.read_at)}`}><IconChecks size={13} color="#2a78d6" /></Tooltip> : <IconCheck size={12} color="#98a2b3" />)}
                  </Group>
                </div>
              </div>
            );
          })}
        </ScrollArea>
        {err && <Text size="xs" c="red" px="sm">{err}</Text>}
        <div className="chat-compose">
          <Group gap={2} mb={4}>
            <Tooltip label="Bold"><ActionIcon size="sm" variant="subtle" color="gray" onClick={() => wrap('**')}><IconBold size={14} /></ActionIcon></Tooltip>
            <Tooltip label="List"><ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setText((t) => `${t}${t && !t.endsWith('\n') ? '\n' : ''}- `)}><IconList size={14} /></ActionIcon></Tooltip>
            <Tooltip label="Insert a table"><ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setText((t) => `${t}${t ? '\n' : ''}| Item | Value |\n|---|---|\n|  |  |\n`)}><IconTable size={14} /></ActionIcon></Tooltip>
            <Text size="10px" c="dimmed" ml="auto">Enter to send · Shift+Enter new line</Text>
          </Group>
          <Group gap={6} wrap="nowrap" align="flex-end">
            <Textarea ref={box} style={{ flex: 1 }} autosize minRows={1} maxRows={6} placeholder="Message" value={text} onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <ActionIcon size="lg" radius="xl" onClick={send} disabled={!text.trim()} aria-label="Send"><IconSend size={17} /></ActionIcon>
          </Group>
        </div>
      </>}
    </Paper>
  );
}
