import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActionIcon, Anchor, Badge, Button, FileButton, Group, Modal, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { IconDownload, IconEye, IconFileTypePdf, IconPaperclip, IconPhoto, IconTrash, IconArrowRight, IconFile } from '@tabler/icons-react';
import { api, ok, useApi } from '../api';
import { compressFile, blobToBase64, pdfPageImages, type Packed } from '../lib/vendorDocs';
import { LabSpinner } from './LabSpinner';

export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isPdf = (mime: string, name = '') => mime === 'application/pdf' || /\.pdf$/i.test(name);
const isImg = (mime: string) => /^image\//.test(mime);
const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

/** Full-screen viewer for a PDF or image – an uploaded file (url) or one about to be uploaded (blob). */
export function FilePreview({ name, mime, url, blob, onClose, footer, info }: { name: string; mime: string; url?: string; blob?: Blob; onClose: () => void; footer?: ReactNode; info?: ReactNode }) {
  const src = useMemo(() => (blob ? URL.createObjectURL(blob) : url ?? ''), [blob, url]);
  useEffect(() => () => { if (blob) URL.revokeObjectURL(src); }, [src]);
  return (
    <Modal opened onClose={onClose} size="80rem" title={<Group gap={8}>{isPdf(mime, name) ? <IconFileTypePdf size={18} color="#d92d20" /> : <IconPhoto size={18} color="#2a78d6" />}<Text fw={600} truncate maw={600}>{name}</Text>{info}</Group>}>
      <Stack>
        <div className="file-preview">
          {isPdf(mime, name) ? <PdfPages src={src} blob={blob} />
            : isImg(mime) ? <img src={src} alt={name} />
              : <Stack align="center" justify="center" h="100%"><IconFile size={40} color="#98a2b3" /><Text c="dimmed">No preview for this file type.</Text>{url && <Button component="a" href={url.replace('inline=1', '')} variant="light">Download</Button>}</Stack>}
        </div>
        {footer}
      </Stack>
    </Modal>
  );
}

function PdfPages({ src, blob }: { src: string; blob?: Blob }) {
  const [state, setState] = useState<{ pages: string[]; total: number } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true; setState(null); setErr('');
    (async () => {
      const buf = blob ? await blob.arrayBuffer() : await (await fetch(src)).arrayBuffer();
      const r = await pdfPageImages(buf); if (live) setState(r);
    })().catch((e) => live && setErr(e.message || 'Could not open this PDF'));
    return () => { live = false; };
  }, [src]);
  if (err) return <Text c="red" p="lg">{err}</Text>;
  if (!state) return <LabSpinner label="Opening…" />;
  return (
    <div className="pdf-pages">
      {state.pages.map((p, i) => <img key={i} src={p} alt={`Page ${i + 1}`} />)}
      {state.total > state.pages.length && <Text size="sm" c="dimmed" ta="center" pb="md">Showing the first {state.pages.length} of {state.total} pages – download to see all.</Text>}
    </div>
  );
}

/** Pick → compress (under 1 MB) → preview with before/after size → attach. */
export function useCompressedUpload(entity: string, entityId: number | null, kind?: string, onDone?: (packed: Packed) => void) {
  const [packed, setPacked] = useState<Packed | null>(null);
  const [busy, setBusy] = useState('');
  const pick = async (file: File | null) => {
    if (!file) return;
    setBusy('Compressing…');
    try { setPacked(await compressFile(file, setBusy)); } finally { setBusy(''); }
  };
  const attach = async () => {
    if (!packed || entityId === null) return;
    setBusy('Uploading…');
    try {
      await api('/files', { body: { entity, entity_id: entityId, name: packed.name, mime: packed.mime, data: await blobToBase64(packed.blob), kind } });
      ok(`${packed.name} attached · ${kb(packed.after)}`); const p = packed; setPacked(null); onDone?.(p);
    } finally { setBusy(''); }
  };
  const modal = packed ? <UploadPreview packed={packed} busy={Boolean(busy)} onCancel={() => setPacked(null)} onConfirm={attach} confirmLabel="Attach" /> : null;
  const overlay = busy ? <div className="saving-pill"><LabSpinner size={40} /><Text size="sm" fw={600}>{busy}</Text></div> : null;
  return { pick, modal, overlay, busy: Boolean(busy), packed, setPacked };
}

export function UploadPreview({ packed, busy, onCancel, onConfirm, confirmLabel }: { packed: Packed; busy?: boolean; onCancel: () => void; onConfirm: () => void; confirmLabel: string }) {
  const shrunk = packed.after < packed.before;
  return (
    <FilePreview name={packed.name} mime={packed.mime} blob={packed.blob} onClose={onCancel}
      info={<Badge variant="light" color={packed.after <= 1024 * 1024 ? 'teal' : 'orange'}>{shrunk ? <>{kb(packed.before)} → {kb(packed.after)}</> : kb(packed.after)}</Badge>}
      footer={(
        <Group justify="space-between">
          <Text size="sm" c={packed.note ? 'orange' : 'dimmed'}>{packed.note ?? (shrunk ? `Compressed to ${Math.round((packed.after / packed.before) * 100)}% of the original – check that it reads clearly.` : 'Small enough – uploaded as it is.')}</Text>
          <Group gap="xs"><Button variant="default" onClick={onCancel}>Cancel</Button><Button loading={busy} onClick={onConfirm} rightSection={<IconArrowRight size={15} />}>{confirmLabel}</Button></Group>
        </Group>
      )} />
  );
}

/** Attachments of a record: list with preview / download / remove, and compressed upload with preview. */
export function Attachments({ entity, entityId, kind, title, readOnly, emptyText, buttonLabel = 'Upload', onChange, onUploaded, rowAction, accept = ACCEPT, compact }: {
  entity: string; entityId: number; kind?: string; title?: string; readOnly?: boolean; emptyText?: string; buttonLabel?: string; onChange?: () => void; onUploaded?: () => void;
  rowAction?: (f: any) => ReactNode; accept?: string; compact?: boolean;
}) {
  const { data, reload } = useApi<any[]>(`/files?entity=${entity}&entity_id=${entityId}`, [entity, entityId]);
  const [view, setView] = useState<any>(null);
  const up = useCompressedUpload(entity, entityId, kind, () => { reload(); onUploaded?.(); onChange?.(); });
  const files = (data ?? []).filter((f) => !kind || f.kind === kind || (kind === 'evidence' && !f.kind));
  const body = (
    <>
      <Group justify="space-between" mb={files.length || emptyText ? 6 : 0}>
        {title ? <Text size="sm" fw={600}>{title}</Text> : <span />}
        {!readOnly && <FileButton accept={accept} onChange={up.pick}>{(p) => <Button size="xs" variant="light" loading={up.busy} leftSection={<IconPaperclip size={14} />} {...p}>{buttonLabel}</Button>}</FileButton>}
      </Group>
      <Stack gap={4}>
        {files.map((f) => (
          <Group key={f.id} justify="space-between" wrap="nowrap" className="att-row">
            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
              {isPdf(f.mime, f.name) ? <IconFileTypePdf size={18} color="#d92d20" /> : isImg(f.mime) ? <IconPhoto size={18} color="#2a78d6" /> : <IconFile size={18} color="#667085" />}
              <div style={{ minWidth: 0 }}>
                <Anchor size="sm" onClick={() => setView(f)} truncate style={{ display: 'block' }}>{f.name}</Anchor>
                <Text size="xs" c="dimmed">{kb(f.size)} · {f.uploaded_by_name ? `${f.uploaded_by_name} · ` : ''}{new Date(f.created_at).toLocaleDateString('en-IN')}{f.archived_at ? ' · archived' : ''}</Text>
              </div>
            </Group>
            <Group gap={2} wrap="nowrap">
              {rowAction?.(f)}
              <Tooltip label="Preview"><ActionIcon variant="subtle" onClick={() => setView(f)}><IconEye size={16} /></ActionIcon></Tooltip>
              <Tooltip label="Download"><ActionIcon variant="subtle" component="a" href={`/api/files/${f.id}/download`}><IconDownload size={16} /></ActionIcon></Tooltip>
              {!readOnly && <Tooltip label="Remove"><ActionIcon variant="subtle" color="red" onClick={async () => { if (!window.confirm(`Remove ${f.name}?`)) return; await api(`/files/${f.id}`, { method: 'DELETE' }); reload(); onChange?.(); }}><IconTrash size={15} /></ActionIcon></Tooltip>}
            </Group>
          </Group>
        ))}
        {!files.length && emptyText && <Text size="xs" c="dimmed">{emptyText}</Text>}
      </Stack>
      {view && <FilePreview name={view.name} mime={view.mime} url={`/api/files/${view.id}/download?inline=1`} onClose={() => setView(null)} info={<Badge variant="light" color="gray">{kb(view.size)}</Badge>}
        footer={<Group justify="flex-end"><Button variant="default" component="a" href={`/api/files/${view.id}/download`} leftSection={<IconDownload size={15} />}>Download</Button></Group>} />}
      {up.modal}{up.overlay}
    </>
  );
  return compact ? body : <Paper withBorder p="sm" radius="md">{body}</Paper>;
}
