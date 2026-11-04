import { useEffect, useRef, useState } from 'react';
import { Button, Group, Modal, RingProgress, Stack, Text } from '@mantine/core';
import { IconClockPause } from '@tabler/icons-react';
import { signOut } from '../api';

const KEY = 'last-activity';
const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
const stamp = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* private mode */ } };
const last = () => { try { return Number(localStorage.getItem(KEY)) || Date.now(); } catch { return Date.now(); } };

/**
 * Signs the user out after `minutes` without keyboard/mouse/touch activity (shared across tabs),
 * warning at `warnAfter` minutes with a countdown. Background refreshes do not count as activity.
 */
export function IdleGuard({ minutes, warnAfter }: { minutes: number; warnAfter: number }) {
  const [left, setLeft] = useState<number | null>(null);
  const warning = useRef(false);
  useEffect(() => {
    if (!minutes) return;
    stamp();
    let lastWrite = 0;
    const onAct = () => { if (warning.current) return; const t = Date.now(); if (t - lastWrite > 5000) { lastWrite = t; stamp(); } };
    EVENTS.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    const tick = () => {
      const idle = (Date.now() - last()) / 60000;
      if (idle >= minutes) { signOut('idle'); return; }
      if (idle >= warnAfter) { warning.current = true; setLeft(Math.max(0, Math.round((minutes - idle) * 60))); }
      else if (warning.current) { warning.current = false; setLeft(null); } // activity in another tab
    };
    const iv = window.setInterval(tick, 1000);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); }; // laptop woke up
    document.addEventListener('visibilitychange', onVis);
    return () => { EVENTS.forEach((e) => window.removeEventListener(e, onAct)); clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [minutes, warnAfter]);
  if (left === null) return null;
  const total = (minutes - warnAfter) * 60;
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <Modal opened onClose={() => undefined} withCloseButton={false} centered size="sm" radius="lg" overlayProps={{ blur: 2 }}>
      <Stack align="center" gap="sm" py="sm">
        <RingProgress size={110} thickness={8} roundCaps sections={[{ value: (left / total) * 100, color: left < 30 ? 'red' : 'blue' }]}
          label={<Stack gap={0} align="center"><IconClockPause size={20} color="#475467" /><Text fw={700} size="lg">{mm}</Text></Stack>} />
        <Text fw={700} size="lg">Are you still there?</Text>
        <Text size="sm" c="dimmed" ta="center">You have been inactive for {warnAfter} minute{warnAfter === 1 ? "" : "s"}. For security you will be signed out in {mm}.</Text>
        <Group grow w="100%" mt="xs">
          <Button variant="default" onClick={() => signOut()}>Sign out</Button>
          <Button data-autofocus onClick={() => { warning.current = false; stamp(); setLeft(null); }}>Stay signed in</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
