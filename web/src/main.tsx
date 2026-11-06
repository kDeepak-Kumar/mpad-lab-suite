import { ErrorBoundary } from './components/ErrorBoundary';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider, createTheme, rem } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@fontsource-variable/inter';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import './styles.css';
import { App } from './App';
import { watchVersion } from './version';
import { applyBrand, shades, storedBrand, useBrand } from './brand';

watchVersion();

// Dropdowns float clearly above the form: shadow, border, tinted hover and a check on the chosen value.
const combobox = {
  defaultProps: {
    comboboxProps: { shadow: 'lg', transitionProps: { transition: 'pop', duration: 80 }, offset: 4 },
    checkIconPosition: 'right' as const, maxDropdownHeight: 300,
  },
  classNames: { dropdown: 'cbx-dropdown', option: 'cbx-option' },
};

const base = {
  primaryColor: 'brand',
  autoContrast: true,
  primaryShade: 6 as const,
  fontFamily: '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  headings: { fontFamily: '"Inter Variable", Inter, system-ui, sans-serif', fontWeight: '650' },
  defaultRadius: 'md',
  radius: { md: rem(8), lg: rem(12) },
  shadows: { lg: '0 10px 30px rgba(16,24,40,.14), 0 2px 6px rgba(16,24,40,.06)' },
  components: {
    Button: { defaultProps: { size: 'sm', radius: 'md' } },
    Select: combobox, MultiSelect: combobox, Autocomplete: combobox, TagsInput: combobox,
    TextInput: { classNames: { input: 'inp' } }, NumberInput: { classNames: { input: 'inp' } }, Textarea: { classNames: { input: 'inp' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Modal: { defaultProps: { radius: 'lg', centered: true, overlayProps: { backgroundOpacity: 0.35, blur: 2 } } },
    Badge: { defaultProps: { radius: 'sm' } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 250 } },
  },
};
applyBrand(storedBrand(), false); // last known company colours, before the first paint

/** Company colours can change at runtime (Settings → Company → Branding colours). */
function Root() {
  const b = useBrand();
  const theme = React.useMemo(() => createTheme({ ...base, colors: { brand: shades(b.primary) } }), [b.primary]);
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
