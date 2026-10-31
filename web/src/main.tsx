import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import { App } from './App';

const theme = createTheme({
  primaryColor: 'navy',
  colors: {
    navy: ['#eef2f9', '#d9e1ef', '#b0c1de', '#849fcc', '#6082bd', '#4a70b4', '#3d66b0', '#2f559b', '#274b8b', '#1f3a68'],
  },
  fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  defaultRadius: 'md',
  components: { Button: { defaultProps: { size: 'sm' } }, TextInput: { defaultProps: { size: 'sm' } } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <Notifications position="top-right" />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MantineProvider>
  </React.StrictMode>,
);
