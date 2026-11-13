import { useState, type ReactNode } from 'react';
import { ActionIcon, Drawer, Tooltip, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronRight, IconX } from '@tabler/icons-react';

/**
 * Side sheet: forms and focused tasks open over the page they belong to, so the user keeps their place.
 * The title stays on top and the action buttons stay pinned at the bottom while the content scrolls.
 */
export function Sheet({ title, subtitle, onClose, footer, size = 680, children, tools }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; footer?: ReactNode; size?: number; children: ReactNode; tools?: ReactNode }) {
  const phone = useMediaQuery('(max-width: 767px)');
  return (
    <Drawer opened onClose={onClose} withCloseButton={false} size={phone ? '100%' : size} padding={0} trapFocus returnFocus>
      <div className="sheet">
        <header className="sheet-head">
          <div style={{ minWidth: 0, outline: 'none' }} tabIndex={-1} data-autofocus><div className="sheet-title">{title}</div>{subtitle && <div className="sheet-sub">{subtitle}</div>}</div>
          <div className="sheet-tools">{tools}<Tooltip label="Close (Esc)"><ActionIcon variant="subtle" color="gray" size={34} radius={9} aria-label="Close" onClick={onClose}><IconX size={17} /></ActionIcon></Tooltip></div>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </Drawer>
  );
}

/** A numbered step of a form. Rarely needed steps start folded and open on click. */
export function FormSection({ n, title, hint, children, defaultOpen = true, collapsible = false }: { n?: number; title: ReactNode; hint?: ReactNode; children: ReactNode; defaultOpen?: boolean; collapsible?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const head = <><span className={`fs-n${open ? ' on' : ''}`}>{n ?? ''}</span><b>{title}</b>{hint && <span className="fs-hint">{hint}</span>}{collapsible && <IconChevronRight size={15} className="fs-chev" style={{ transform: open ? 'rotate(90deg)' : 'none' }} />}</>;
  return (
    <section className="fs">
      {collapsible ? <UnstyledButton className="fs-head" onClick={() => setOpen(!open)} aria-expanded={open}>{head}</UnstyledButton> : <div className="fs-head">{head}</div>}
      {open && <div className="fs-body">{children}</div>}
    </section>
  );
}

/** Quick view of one record, docked beside its list: status on top, the facts, then the next action pinned at the bottom. */
export function QuickView({ badges, title, subtitle, onClose, tools, footer, children }: { badges?: ReactNode; title: ReactNode; subtitle?: ReactNode; onClose: () => void; tools?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="qv">
      <div className="qv-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>{badges}</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>{tools}<Tooltip label="Close"><ActionIcon variant="subtle" color="gray" size={32} radius={9} aria-label="Close quick view" onClick={onClose}><IconX size={16} /></ActionIcon></Tooltip></div>
        </div>
        <div className="qv-title">{title}</div>
        {subtitle && <div style={{ color: 'var(--ink-2)', fontSize: 13.5 }}>{subtitle}</div>}
      </div>
      <div className="qv-body">{children}</div>
      {footer && <div className="qv-foot">{footer}</div>}
    </div>
  );
}

/** Label / value pairs; empty values are left out. */
export function Facts({ items }: { items: [ReactNode, ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false);
  return <dl className="kv">{shown.map(([k, v], i) => <div key={i} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

/**
 * Drop-in for a form pop-up: the same props as a Modal, shown as a side sheet over the page.
 * The form's action row (className "form-actions") stays pinned at the bottom while the fields scroll.
 */
export function FormSheet({ opened = true, onClose, title, size, children }: { opened?: boolean; onClose: () => void; title: ReactNode; size?: string | number; children: ReactNode }) {
  const phone = useMediaQuery('(max-width: 767px)');
  const w = typeof size === 'number' ? size : size === 'xl' ? 720 : size === 'lg' ? 600 : 520;
  return (
    <Drawer opened={opened} onClose={onClose} withCloseButton={false} size={phone ? '100%' : w} padding={0} trapFocus returnFocus>
      <div className="sheet fsheet">
        <header className="sheet-head">
          <div style={{ minWidth: 0, outline: 'none' }} tabIndex={-1} data-autofocus><div className="sheet-title">{title}</div></div>
          <div className="sheet-tools"><Tooltip label="Close (Esc)"><ActionIcon variant="subtle" color="gray" size={34} radius={9} aria-label="Close" onClick={onClose}><IconX size={17} /></ActionIcon></Tooltip></div>
        </header>
        <div className="sheet-body" style={{ paddingTop: 18 }}>{children}</div>
      </div>
    </Drawer>
  );
}
