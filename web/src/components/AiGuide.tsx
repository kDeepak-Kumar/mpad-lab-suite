import { useState } from 'react';
import { Accordion, Alert, Anchor, Badge, Button, Code, CopyButton, Group, List, Modal, ScrollArea, SimpleGrid, Stack, Tabs, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconBook2, IconCheck, IconCopy, IconLock, IconStethoscope } from '@tabler/icons-react';

export interface AiProvider {
  value: string; label: string; baseUrl: string; model: string; key: boolean; cost: 'Free' | 'Free tier' | 'Paid' | 'Local'; note: string;
  keyUrl?: string; modelsUrl?: string; steps: string[]; good: string; limits?: string;
}

/** Provider catalogue. Model names change often, so the guide points to "List models" rather than hard-coding them. */
export const AI_PROVIDERS: AiProvider[] = [
  { value: 'gemini', label: 'Google Gemini', cost: 'Free tier', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', key: true,
    keyUrl: 'https://aistudio.google.com/apikey', modelsUrl: 'https://ai.google.dev/gemini-api/docs/models', good: 'Best free starting point: strong, fast, large free daily quota.',
    limits: 'Free quota per minute and per day; see your limits in Google AI Studio. On the free tier Google may use prompts to improve its products.',
    note: 'Free key from Google AI Studio (aistudio.google.com/apikey). Uses Google\'s own Gemini API.',
    steps: ['Sign in at aistudio.google.com with a Google account.', 'Open **Get API key → Create API key**; copy it.', 'Here: Provider = Google Gemini; the base URL fills in.', 'Paste the key, click **List models** and pick a “flash” model (e.g. gemini-2.5-flash).', 'Click **Test connection**, then **Save changes**.'] },
  { value: 'groq', label: 'Groq', cost: 'Free tier', baseUrl: 'https://api.groq.com/openai/v1', model: '', key: true,
    keyUrl: 'https://console.groq.com/keys', modelsUrl: 'https://console.groq.com/docs/models', good: 'Very fast open models; no card needed.', limits: 'Free tier has requests-per-minute and tokens-per-day caps.',
    note: 'Free key at console.groq.com; pick a model with “List models”.',
    steps: ['Sign up at console.groq.com (email, Google or GitHub).', 'Open **API Keys → Create API key**; copy it.', 'Here: Provider = Groq, paste the key.', 'Click **List models** and choose a large chat model (e.g. a 70B or gpt-oss model).', 'Test, then Save.'] },
  { value: 'openrouter', label: 'OpenRouter', cost: 'Free tier', baseUrl: 'https://openrouter.ai/api/v1', model: '', key: true,
    keyUrl: 'https://openrouter.ai/keys', modelsUrl: 'https://openrouter.ai/models?max_price=0', good: 'One key for hundreds of models; several free ones.', limits: 'Free models (ending in “:free”) have small daily limits and change often.',
    note: 'Key at openrouter.ai; free models end in “:free”.',
    steps: ['Create an account at openrouter.ai.', 'Open **Keys → Create key**; copy it.', 'Here: Provider = OpenRouter, paste the key.', 'Click **List models** and pick one ending in “:free” (or a paid one with credits).', 'Test, then Save.'] },
  { value: 'mistral', label: 'Mistral AI', cost: 'Free tier', baseUrl: 'https://api.mistral.ai/v1', model: '', key: true,
    keyUrl: 'https://console.mistral.ai/api-keys', modelsUrl: 'https://docs.mistral.ai/getting-started/models/', good: 'European provider with a free experiment plan.', limits: 'Free plan is rate-limited; prompts may be used for training on the free plan.',
    note: 'Key at console.mistral.ai (choose the free Experiment plan).',
    steps: ['Sign up at console.mistral.ai and choose the free plan.', 'Create an API key under **API keys**.', 'Here: Provider = Mistral AI, paste the key, **List models**.', 'Test, then Save.'] },
  { value: 'ollama', label: 'Ollama (your own computer)', cost: 'Local', baseUrl: 'http://localhost:11434/v1', model: '', key: false,
    modelsUrl: 'https://ollama.com/library', good: 'Completely private and free – nothing leaves your network.', limits: 'Needs a computer with enough memory (a GPU helps); the server must be able to reach it.',
    note: 'Install Ollama, download a model, then point the base URL at that computer.',
    steps: ['Install Ollama from ollama.com on a computer that stays on.', 'In a terminal run **ollama pull** followed by a model name from the Ollama library.', 'If Ollama is not on the app server, set the base URL to http://<that-computer-address>:11434/v1 and allow it through the firewall.', 'Click **List models**, pick the model, Test, then Save.'] },
  { value: 'anthropic', label: 'Anthropic Claude', cost: 'Paid', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5', key: true,
    keyUrl: 'https://console.anthropic.com/settings/keys', modelsUrl: 'https://docs.claude.com/en/docs/about-claude/models/overview', good: 'High quality, careful answers and long documents (contract review).', limits: 'Pay per use; set a monthly spend limit in the console.',
    note: 'Paid API key from console.anthropic.com.',
    steps: ['Create an account at console.anthropic.com and add billing.', 'Open **API keys → Create key**; copy it.', 'Here: Provider = Anthropic Claude, paste the key, **List models** (a Haiku model is cheapest).', 'Test, then Save.'] },
  { value: 'openai', label: 'OpenAI', cost: 'Paid', baseUrl: 'https://api.openai.com/v1', model: '', key: true,
    keyUrl: 'https://platform.openai.com/api-keys', modelsUrl: 'https://platform.openai.com/docs/models', good: 'Widely used models; pay per use.', limits: 'Needs prepaid credit; set usage limits in the dashboard.',
    note: 'Paid API key from platform.openai.com.',
    steps: ['Sign in at platform.openai.com and add credit under Billing.', 'Create a key under **API keys**.', 'Here: Provider = OpenAI, paste the key, **List models** (a “mini” model keeps costs low).', 'Test, then Save.'] },
  { value: 'custom', label: 'Other (OpenAI-compatible)', cost: 'Paid', baseUrl: '', model: '', key: true, good: 'Any service with an OpenAI-compatible /chat/completions endpoint (DeepSeek, Together, Azure-compatible gateways…).',
    note: 'Any service with an OpenAI-compatible /chat/completions endpoint.',
    steps: ['Get the base URL (it usually ends in /v1) and an API key from the provider.', 'Paste both here, **List models**, Test, then Save.'] },
];

const COST_COLOR: Record<string, string> = { Free: 'teal', 'Free tier': 'teal', Local: 'grape', Paid: 'blue' };
const md = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));

const PROBLEMS = [
  ['“The provider rejected the API key” (401 / 403)', ['Paste the key again without spaces.', 'Make sure the provider selected matches where the key came from.', 'Some providers need billing or accepted terms before keys work.']],
  ['“Model not recognised” (404)', ['Click List models and choose from the list – names change often.', 'Check the base URL matches the guide exactly.']],
  ['“Quota or rate limit used up” (429)', ['Wait a minute; free tiers allow a few requests per minute.', 'Check daily limits on the provider\'s usage page, or use a smaller model.']],
  ['“Could not reach the API address”', ['The URL must start with https:// (http:// only for local Ollama).', 'The app server needs outbound internet access to the provider.']],
  ['Answers are slow or time out', ['Free tiers can be busy – try a smaller / faster model.', 'Local Ollama needs a reasonably powerful computer.']],
  ['Answers look wrong', ['The assistant only uses records it looked up; open the linked records to check.', 'Try a stronger model. Figures in reports are always calculated by the app, not by the AI.']],
] as const;

/** Knowledge Centre: how to connect free or paid AI providers, safely. */
export function AiGuide({ opened, onClose, onUse }: { opened: boolean; onClose: () => void; onUse: (p: AiProvider) => void }) {
  const [tab, setTab] = useState<string | null>('choose');
  return (
    <Modal opened={opened} onClose={onClose} size="xl" title={<Group gap={8}><ThemeIcon variant="light" radius="md"><IconBook2 size={16} /></ThemeIcon><Text fw={650}>AI setup guide</Text></Group>} scrollAreaComponent={ScrollArea.Autosize}>
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List mb="md"><Tabs.Tab value="choose">Choose a provider</Tabs.Tab><Tabs.Tab value="steps">Step by step</Tabs.Tab><Tabs.Tab value="trouble" leftSection={<IconStethoscope size={14} />}>Troubleshooting</Tabs.Tab><Tabs.Tab value="privacy" leftSection={<IconLock size={14} />}>Privacy & keys</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="choose">
          <Text size="sm" c="dimmed" mb="sm">The assistant, AI report questions, contract review and remark drafting work with any of these. Without one, the built-in assistant still searches records and answers common questions.</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {AI_PROVIDERS.map((p) => (
              <UnstyledButton key={p.value} className="ai-card" onClick={() => { onUse(p); setTab('steps'); }}>
                <Group justify="space-between" mb={4}><Text fw={650} size="sm">{p.label}</Text><Badge size="sm" variant="light" color={COST_COLOR[p.cost]}>{p.cost}</Badge></Group>
                <Text size="xs">{p.good}</Text>
                {p.limits && <Text size="xs" c="dimmed" mt={4}>{p.limits}</Text>}
                <Text size="xs" c="var(--brand)" fw={600} mt={6}>Use this provider →</Text>
              </UnstyledButton>
            ))}
          </SimpleGrid>
        </Tabs.Panel>
        <Tabs.Panel value="steps">
          <Accordion variant="separated" radius="md">
            {AI_PROVIDERS.map((p) => (
              <Accordion.Item key={p.value} value={p.value}>
                <Accordion.Control><Group gap={8}><Text fw={600} size="sm">{p.label}</Text><Badge size="xs" variant="light" color={COST_COLOR[p.cost]}>{p.cost}</Badge></Group></Accordion.Control>
                <Accordion.Panel>
                  <List type="ordered" size="sm" spacing={4} mb="sm">{p.steps.map((s, i) => <List.Item key={i}>{md(s)}</List.Item>)}</List>
                  {p.baseUrl && <Group gap={6} mb={6}><Text size="xs" c="dimmed">Base URL</Text><Code>{p.baseUrl}</Code><CopyButton value={p.baseUrl}>{({ copied, copy }) => <Button size="compact-xs" variant="subtle" onClick={copy} leftSection={copied ? <IconCheck size={12} /> : <IconCopy size={12} />}>{copied ? 'Copied' : 'Copy'}</Button>}</CopyButton></Group>}
                  <Group gap="md">
                    {p.keyUrl && <Anchor size="xs" href={p.keyUrl} target="_blank" rel="noreferrer">Get an API key ↗</Anchor>}
                    {p.modelsUrl && <Anchor size="xs" href={p.modelsUrl} target="_blank" rel="noreferrer">Current models ↗</Anchor>}
                    <Button size="compact-xs" variant="light" onClick={() => { onUse(p); onClose(); }}>Fill in these settings</Button>
                  </Group>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </Tabs.Panel>
        <Tabs.Panel value="trouble">
          <Text size="sm" c="dimmed" mb="sm"><b>Test connection</b> explains the cause and the fix when something is wrong. Common cases:</Text>
          <Stack gap="xs">{PROBLEMS.map(([t, fixes]) => <Alert key={t} variant="light" color="gray" title={t}><List size="sm">{fixes.map((f) => <List.Item key={f}>{f}</List.Item>)}</List></Alert>)}</Stack>
        </Tabs.Panel>
        <Tabs.Panel value="privacy">
          <List size="sm" spacing={6}>
            <List.Item>The API key is stored only on your server. After saving it is never sent back to any browser – the field shows “Saved”.</List.Item>
            <List.Item>Only System Administrators / users with Settings permission can change AI settings.</List.Item>
            <List.Item>The AI never queries the database directly. It only chooses from fixed, read-only lookups, and each lookup respects the user’s role and record sharing.</List.Item>
            <List.Item>Business figures (totals, trends) are always calculated by the app’s report engine; the AI only describes them.</List.Item>
            <List.Item>Question text and the looked-up records are sent to the provider you choose. Free tiers may use data to improve their models – choose a paid plan or local Ollama for confidential work.</List.Item>
            <List.Item>Turning “Use an AI model” off stops all sending immediately; the built-in assistant keeps working.</List.Item>
          </List>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
