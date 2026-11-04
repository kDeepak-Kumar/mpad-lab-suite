import { Component, type ReactNode } from 'react';
import { Button, Center, Code, Group, Paper, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

/**
 * Catches a crash inside one screen so the rest of the app keeps working (no blank page).
 * The error is sent to the server log so it can be fixed.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    fetch('/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: error.message, stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}`.slice(0, 4000), url: window.location.pathname + window.location.search }) }).catch(() => undefined);
  }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Center mih={360} p="md">
        <Paper withBorder radius="lg" p="xl" maw={560} w="100%">
          <Stack gap="sm" align="center" ta="center">
            <IconAlertTriangle size={40} color="#dc6803" />
            <Text fw={700} size="lg">This screen ran into a problem</Text>
            <Text size="sm" c="dimmed">Your data is safe – nothing was lost. The problem has been reported. Try again, or go back to the previous screen.</Text>
            <Group mt="xs"><Button variant="default" onClick={() => window.history.back()}>Go back</Button><Button onClick={() => this.setState({ error: null })}>Try again</Button><Button variant="subtle" onClick={() => window.location.reload()}>Reload page</Button></Group>
            <Code block w="100%" style={{ textAlign: 'left', fontSize: 11 }}>{this.state.error.message}</Code>
          </Stack>
        </Paper>
      </Center>
    );
  }
}
