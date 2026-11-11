import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import { queryCache } from './services/query-cache.ts';
import { RuntimeProvider } from './services/runtime.tsx';
import '../../../../packages/ui/src/tokens.css';
import './style.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryCache}>
      <RuntimeProvider>
        <App />
      </RuntimeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
