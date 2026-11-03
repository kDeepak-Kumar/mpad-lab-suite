import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Group, Modal, Paper, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Tooltip, type ButtonProps } from '@mantine/core';
import { IconBrandWhatsapp, IconCopy, IconShare, IconExternalLink } from '@tabler/icons-react';
import { fillWa, waLink, waNumber, waTemplates, WA_GREEN, type WaContext } from '@suite/shared';
import { api, ok, useApi, money } from '../api';
import { useMe } from '../ctx';

export interface WaRecipient { name: string; phone?: string | null; role?: string | null }

/** Green WhatsApp button used across the app. */
export function WhatsAppButton({ onClick, label = 'WhatsApp', variant = 'filled', ...p }: { onClick: () => void; label?: string } & ButtonProps) {
  const filled = variant === 'filled';
  return <Button variant={variant} color={filled ? '#25D366' : '#128C7E'} styles={{ root: filled ? { color: '#fff' } : { background: '#e7f8ee', color: '#0b6b4f' } }}
    leftSection={<IconBrandWhatsapp size={17} color={filled ? '#fff' : WA_GREEN} />} onClick={onClick} {...p}>{label}</Button>;
}
/** Small round icon for tables and contact rows. */
export function WhatsAppIcon({ onClick, title = 'Send on WhatsApp' }: { onClick: () => void; title?: string }) {
  return <Tooltip label={title}><ActionIcon variant="light" color="#25D366" radius="xl" aria-label={title} onClick={(e) => { e.stopPropagation(); onClick(); }}><IconBrandWhatsapp size={17} color={WA_GREEN} /></ActionIcon></Tooltip>;
}

/** Placeholders every message can use, from Settings → Company. */
export function companyWaVars(company: any, sender?: string) {
  const b = company?.bank ?? {};
  const bank = [b.name && `A/c name: ${b.name}`, b.bank && `Bank: ${b.bank}${b.branch ? `, ${b.branch}` : ''}`, b.account && `A/c no: ${b.account}`, b.ifsc && `IFSC: ${b.ifsc}`].filter(Boolean).join('\n');
  return { company: company?.name ?? '', phone: company?.phone ?? '', website: company?.website ?? '', upi: b.upi ?? '', bank, sender: sender ?? '' };
}

/** Renders WhatsApp formatting (*bold*, _italic_, ~strike~) the way the recipient will see it. */
function WaText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/\S+)/g);
  return <>{parts.map((p, i) => p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <b key={i}>{p.slice(1, -1)}</b>
    : p.startsWith('_') && p.endsWith('_') && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i>
      : p.startsWith('~') && p.endsWith('~') && p.length > 2 ? <s key={i}>{p.slice(1, -1)}</s>
        : /^https?:\/\//.test(p) ? <span key={i} style={{ color: '#027eb5', wordBreak: 'break-all' }}>{p}</span> : <span key={i}>{p}</span>)}</>;
}

export interface WhatsAppModalProps {
  context: WaContext;
  /** Values for {{placeholders}} specific to this record (number, amount, link…). */
  vars: Record<string, string | number | null | undefined>;
  /** Client whose contacts are offered; the activity is logged against it. */
  clientId?: number | null;
  recipients?: WaRecipient[];
  /** Preselect this person (name match) or number. */
  preferred?: { name?: string | null; phone?: string | null };
  link?: { kind: string; id: number };
  /** Produces the PDF to share as a file (phones and Windows/Mac share sheets). */
  getFile?: () => Promise<File>;
  title?: string;
  onClose: (sent: boolean) => void;
}

export function WhatsAppModal({ context, vars, clientId, recipients, preferred, link, getFile, title, onClose }: WhatsAppModalProps) {
  const me = useMe();
  const { data: company } = useApi<any>('/company', []);
  const { data: client } = useApi<any>(clientId && !recipients ? `/clients/${clientId}` : null, [clientId]);
  const people: WaRecipient[] = useMemo(() => {
    const list = recipients ?? [...(client?.contacts ?? []).map((c: any) => ({ name: c.name, phone: c.phone, role: c.role })), ...(client?.phone ? [{ name: client.name, phone: client.phone, role: 'Office' }] : [])];
    return list.filter((p, i) => p.phone && list.findIndex((q) => q.phone === p.phone) === i);
  }, [recipients, client]);
  const templates = useMemo(() => waTemplates(company?.whatsapp?.templates).filter((t) => t.for.includes(context)), [company, context]);
  const cc = company?.whatsapp?.countryCode || '91';

  const [who, setWho] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [tpl, setTpl] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (who !== null || !people.length) return;
    const pick = people.find((p) => preferred?.phone && waNumber(p.phone, cc) === waNumber(preferred.phone, cc)) ?? people.find((p) => preferred?.name && p.name === preferred.name) ?? people[0];
    setWho(pick.phone!); setPhone(pick.phone!);
  }, [people]);
  useEffect(() => { if (!tpl && templates.length) setTpl(templates[0].key); }, [templates]);
  useEffect(() => { if (!people.length && preferred?.phone && !phone) setPhone(preferred.phone); }, [people, preferred]);

  const person = people.find((p) => p.phone === who);
  const allVars = useMemo(() => ({ ...companyWaVars(company, me?.user?.name), ...vars, contact: person?.name && who === phone ? person.name : vars.contact || 'Sir/Madam' }), [company, vars, person, who, phone, me]);
  useEffect(() => {
    const t = templates.find((x) => x.key === tpl);
    if (t && !edited) setText(fillWa(t.text, allVars));
  }, [tpl, allVars, templates]);

  const number = waNumber(phone, cc);
  const canShareFile = typeof navigator !== 'undefined' && 'canShare' in navigator && !!getFile;
  const log = async () => {
    await api('/whatsapp/log', { body: { client_id: clientId ?? null, phone: number, contact: person?.name ?? null, template: templates.find((t) => t.key === tpl)?.label ?? 'Message', message: text, link_kind: link?.kind ?? null, link_id: link?.id ?? null }, quiet: true }).catch(() => undefined);
  };
  const openChat = async () => {
    window.open(waLink(number, text), '_blank', 'noopener');
    setBusy('open'); await log(); setBusy(null);
    ok('WhatsApp opened – press Send there. Logged under Follow-ups.'); onClose(true);
  };
  const shareFile = async () => {
    if (!getFile) return;
    setBusy('share');
    try {
      const file = await getFile();
      const payload = { files: [file], text, title: file.name };
      if (!(navigator as any).canShare?.(payload)) { ok('This browser cannot share files – use “Open WhatsApp”, the message has a download link.'); return; }
      await navigator.share(payload);
      await log(); ok('Shared. Logged under Follow-ups.'); onClose(true);
    } catch (e) { if ((e as Error).name !== 'AbortError') throw e; } finally { setBusy(null); }
  };

  if (!company) return null;
  return (
    <Modal opened onClose={() => onClose(false)} size="xl" fullScreen={typeof window !== 'undefined' && window.innerWidth < 640}
      title={<Group gap={8}><IconBrandWhatsapp size={22} color={WA_GREEN} /><Text fw={600}>{title ?? 'Send on WhatsApp'}</Text></Group>}>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Stack gap="sm">
          {people.length > 0 && <Select label="Send to" data={[...people.map((p) => ({ value: p.phone!, label: `${p.name}${p.role ? ` (${p.role})` : ''} · ${p.phone}` })), { value: '__other', label: 'Another number…' }]}
            value={who} onChange={(x) => { setWho(x); setPhone(x && x !== '__other' ? x : ''); }} allowDeselect={false} />}
          {(who === '__other' || !people.length) && <TextInput label="WhatsApp number" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.currentTarget.value)}
            description={`10-digit numbers get +${cc} added. Leave empty to pick the chat inside WhatsApp.`} />}
          {phone && !number && <Text size="xs" c="orange">This does not look like a mobile number – WhatsApp will ask whom to send it to.</Text>}
          <Select label="Message template" data={templates.map((t) => ({ value: t.key, label: t.label }))} value={tpl} onChange={(x) => { setTpl(x); setEdited(false); }} allowDeselect={false} />
          <Textarea label={<Group gap={6}>Message {edited && <Badge size="xs" variant="light">edited</Badge>}</Group>} autosize minRows={10} maxRows={18} value={text}
            onChange={(e) => { setText(e.currentTarget.value); setEdited(true); }} description="*bold*  _italic_  – formatting works like in WhatsApp" />
          {edited && <Button size="compact-xs" variant="subtle" w="fit-content" onClick={() => setEdited(false)}>Reset to template</Button>}
        </Stack>
        <Stack gap="xs">
          <Text size="sm" fw={500}>Preview</Text>
          <Paper radius="md" p="md" style={{ background: '#efeae2', backgroundImage: 'radial-gradient(#d9d2c5 1px, transparent 1px)', backgroundSize: '14px 14px', minHeight: 260 }}>
            <div style={{ background: '#d9fdd3', borderRadius: '10px 0 10px 10px', padding: '8px 10px 18px', marginLeft: 'auto', maxWidth: '92%', boxShadow: '0 1px 1px rgba(0,0,0,.12)', position: 'relative', whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.4, color: '#111b21' }}>
              <WaText text={text} />
              <span style={{ position: 'absolute', right: 8, bottom: 3, fontSize: 10.5, color: '#667781' }}>{new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} ✓✓</span>
            </div>
          </Paper>
          {vars.link ? <Text size="xs" c="dimmed">The link opens a secure page where the client can view and download the PDF – no sign-in needed. Openings are recorded in the document history.</Text>
            : link && ['quote', 'invoice', 'report'].includes(link.kind) ? <Alert variant="light" color="gray" p="xs"><Text size="xs">A download link becomes available once this is {link.kind === 'quote' ? 'numbered' : 'issued'}. You can still share the PDF file.</Text></Alert> : null}
        </Stack>
      </SimpleGrid>
      <Group justify="space-between" mt="lg" wrap="wrap">
        <Button variant="subtle" leftSection={<IconCopy size={15} />} onClick={async () => { await navigator.clipboard.writeText(text); ok('Message copied'); }}>Copy message</Button>
        <Group gap="xs">
          {getFile && canShareFile && <Button variant="default" leftSection={<IconShare size={16} />} loading={busy === 'share'} onClick={shareFile}>Share PDF file…</Button>}
          <WhatsAppButton label="Open WhatsApp" rightSection={<IconExternalLink size={14} />} loading={busy === 'open'} disabled={!text.trim()} onClick={openChat} />
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mt="xs">Opens WhatsApp {typeof window !== 'undefined' && window.innerWidth < 640 ? 'app' : 'Web / Desktop'} with this message ready – you press Send. Sent messages are saved as WhatsApp activities under the client’s Follow-ups.</Text>
    </Modal>
  );
}

/** Values shared by quotation / invoice / report messages. */
export function docWaVars(doc: any, data: any, origin = window.location.origin) {
  const total = doc.kind === 'report' ? undefined : doc.totals?.total ?? doc.total;
  const balance = doc.kind === 'invoice' && doc.paid !== undefined ? Math.max(0, (doc.total ?? total ?? 0) - (doc.paid ?? 0)) : total;
  const terms = Number(data.client?.paymentTermsDays ?? data.client?.payment_terms_days ?? doc.company?.defaults?.paymentTermsDays ?? 30);
  const due = doc.kind === 'invoice' && doc.date ? new Date(new Date(doc.date).getTime() + terms * 86400000).toISOString().slice(0, 10) : '';
  const fmt = (d?: string) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '');
  const tests = doc.kind === 'report' ? [...new Set(((data.rows ?? []) as any[]).map((r) => r.group || r.test || r.name).filter(Boolean))].slice(0, 6).join(', ') : '';
  return {
    contact: data.contact?.name, client: data.client?.name, site: data.site?.project || data.site?.name, number: doc.number, date: fmt(doc.date),
    amount: total !== undefined ? money(total, 2) : '', balance: balance !== undefined ? money(balance, 2) : '', due_date: fmt(due), tests,
    link: doc.share ? `${origin}/d/${doc.share}` : '',
  };
}
