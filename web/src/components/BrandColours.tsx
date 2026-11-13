import { useEffect, useState } from 'react';
import { Badge, Button, ColorInput, Group, Paper, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconCheck, IconColorSwatch, IconWand } from '@tabler/icons-react';
import { applyBrand, BRAND_PRESETS, DEFAULT_BRAND, isLight, logoColours, storedBrand, valid, type BrandTheme } from '../brand';

/** Settings → Company → Branding: pick the app's colours (presets, colours from the logo, or any colour). Previews live. */
export function BrandColours({ value, logo, onChange }: { value?: Partial<BrandTheme> | null; logo?: string | null; onChange: (t: BrandTheme) => void }) {
  const t = valid(value);
  const [fromLogo, setFromLogo] = useState<string[]>([]);
  useEffect(() => { if (logo) logoColours(logo).then(setFromLogo).catch(() => setFromLogo([])); }, [logo]);
  useEffect(() => { applyBrand(t, false); }, [t.primary, t.sidebar, t.accent]);
  useEffect(() => () => applyBrand(storedBrand(), false), []); // leaving without saving restores the saved colours
  const swatches = [...new Set([...fromLogo, '#1c1917', '#f3f1ec', '#c2410c', '#14171e', '#1f2a3a', '#1b2a6b', '#2a5bd7', '#2a78d6', '#0e8577', '#9b2c2c', '#e9c33b', '#ffc53d', '#f8fafc'])];
  const same = (a: BrandTheme) => a.primary === t.primary && a.sidebar === t.sidebar && a.accent === t.accent;
  const field = (k: keyof BrandTheme, label: string, hint: string) => (
    <ColorInput label={label} description={hint} format="hex" swatches={swatches} swatchesPerRow={7} value={t[k]} onChange={(c) => /^#[0-9a-f]{6}$/i.test(c) && onChange({ ...t, [k]: c.toLowerCase() })} />
  );
  return (
    <Paper withBorder p="sm" mt="md">
      <Group gap={6} mb={4}><IconColorSwatch size={16} /><Text size="sm" fw={600}>App colours</Text><Badge size="xs" variant="light">applies to everyone</Badge></Group>
      <Text size="xs" c="dimmed" mb="sm">Colours of the left menu, buttons and highlights. Changes preview immediately; press Save changes to keep them.</Text>
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="xs" mb="sm">
        {BRAND_PRESETS.map((p) => (
          <UnstyledButton key={p.key} onClick={() => onChange(p.theme)} className="brand-preset" data-active={same(p.theme) || undefined}>
            <div className="brand-preset-demo" style={{ background: p.theme.sidebar }}>
              <span style={{ background: p.theme.accent }} /><span style={{ background: isLight(p.theme.sidebar) ? '#d0d5dd' : 'rgba(255,255,255,.35)' }} /><span style={{ background: isLight(p.theme.sidebar) ? '#d0d5dd' : 'rgba(255,255,255,.35)' }} />
              <i style={{ background: p.theme.primary }} />
            </div>
            <Group gap={4} wrap="nowrap" mt={6}>{same(p.theme) && <IconCheck size={13} />}<Text size="xs" fw={600} lineClamp={2}>{p.label}</Text></Group>
          </UnstyledButton>
        ))}
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        {field('sidebar', 'Left menu', 'Background of the navigation')}
        {field('accent', 'Highlight', 'Selected menu item, key figures')}
        {field('primary', 'Buttons & links', 'Main buttons, links, selected tabs')}
      </SimpleGrid>
      <Stack gap={4} mt="sm">
        {fromLogo.length > 0 && <Group gap={6}><IconWand size={14} /><Text size="xs" c="dimmed">From your logo:</Text>{fromLogo.map((c) => <span key={c} title={c} style={{ width: 18, height: 18, borderRadius: 5, background: c, border: '1px solid #d0d5dd', display: 'inline-block' }} />)}<Text size="xs" c="dimmed">(click a colour field to use them)</Text></Group>}
        <Group><Button size="xs" variant="subtle" color="gray" onClick={() => onChange(DEFAULT_BRAND)}>Reset to the standard colours</Button></Group>
      </Stack>
    </Paper>
  );
}
