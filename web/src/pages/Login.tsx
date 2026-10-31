import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title, Alert } from '@mantine/core';
import { api } from '../api';

export function Login({ onLogin }: { onLogin: () => Promise<unknown> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/auth/login', { body: { email, password }, quiet: true }); await onLogin(); nav('/'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Center h="100vh" bg="#eef2f9">
      <Paper p="xl" radius="lg" shadow="md" w={380}>
        <form onSubmit={submit}>
          <Stack>
            <div>
              <Title order={3}>Sign in</Title>
              <Text size="sm" c="dimmed">Clients, quotations, tests, reports and invoices in one place</Text>
            </div>
            {error && <Alert color="red" variant="light">{error}</Alert>}
            <TextInput label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoComplete="username" required />
            <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" required />
            <Button type="submit" loading={busy} fullWidth>Sign in</Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
