import { ErrorBoundary } from './components/ErrorBoundary';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider, createTheme, rem } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import './design/tokens.css';
import './styles.css';
import './design/system.css';
import { App } from './App';
import { watchVersion } from './version';
import { applyBrand, shades, storedBrand, useBrand } from './brand';

watchVersion();

// The shared theme: every Mantine component takes its look from here and from design/system.css (tokens in design/tokens.css).
const pop = { transition: 'pop' as const, duration: 140 };
const combobox = {
  defaultProps: {
    comboboxProps: { shadow: 'lg', transitionProps: pop, offset: 4 },
    checkIconPosition: 'right' as const, maxDropdownHeight: 300,
  },
  classNames: { dropdown: 'cbx-dropdown', option: 'cbx-option' },
};
/** Warm stone greys: borders, muted text and quiet surfaces all come from this one scale. */
const stone = ['#faf9f7', '#f3f1ec', '#e7e3db', '#d8d3c9', '#a8a29a', '#857f77', '#6b655e', '#44403c', '#292524', '#1c1917'] as const;

const base = {
  primaryColor: 'brand',
  autoContrast: true,
  primaryShade: 6 as const,
  black: '#1c1917',
  fontFamily: '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  headings: { fontFamily: '"Outfit Variable", Outfit, "Inter Variable", Inter, system-ui, sans-serif', fontWeight: '500' },
  defaultRadius: 'md',
  radius: { sm: rem(8), md: rem(10), lg: rem(16), xl: rem(20) },
  shadows: { md: '0 6px 18px rgba(28,25,23,.08)', lg: '0 16px 40px rgba(28,25,23,.14), 0 2px 6px rgba(28,25,23,.06)', xl: '0 16px 40px rgba(28,25,23,.14), 0 2px 6px rgba(28,25,23,.06)' },
  components: {
    Button: { defaultProps: { size: 'sm', radius: 'md' } },
    Select: combobox, MultiSelect: combobox, Autocomplete: combobox, TagsInput: combobox,
    TextInput: { classNames: { input: 'inp' } }, NumberInput: { classNames: { input: 'inp' } }, Textarea: { classNames: { input: 'inp' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Modal: { defaultProps: { radius: 'lg', centered: true, overlayProps: { backgroundOpacity: 0.28, blur: 1.5, color: '#1c1917' }, transitionProps: { transition: 'pop' as const, duration: 160 } } },
    Drawer: { defaultProps: { position: 'right' as const, overlayProps: { backgroundOpacity: 0.28, blur: 1.5, color: '#1c1917' }, transitionProps: { transition: 'slide-left' as const, duration: 220, timingFunction: 'cubic-bezier(.2,.7,.2,1)' } } },
    Menu: { defaultProps: { radius: 'md', shadow: 'lg', transitionProps: pop } },
    Popover: { defaultProps: { radius: 'md', shadow: 'lg', transitionProps: pop } },
    Badge: { defaultProps: { radius: 'xl' } },
    Tooltip: { defaultProps: { openDelay: 300, transitionProps: { transition: 'fade' as const, duration: 120 } } },
    SegmentedControl: { defaultProps: { radius: 'md' } },
    Checkbox: { defaultProps: { radius: 5 } },
  },
};
applyBrand(storedBrand(), false); // last known company colours, before the first paint

/** Company colours can change at runtime (Settings → Company → Branding colours). */
function Root() {
  const b = useBrand();
  const theme = React.useMemo(() => createTheme({ ...base, colors: { brand: shades(b.primary), accent: shades(b.accent), gray: stone as any } }), [b.primary, b.accent]);
  return (
    <MantineProvider theme={theme}>
      <Notifications position="top-right" limit={4} />
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </MantineProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
