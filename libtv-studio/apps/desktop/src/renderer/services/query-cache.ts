import { QueryClient } from '@tanstack/react-query';
export const queryCache = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 500, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
export const scopeKey = (libraryId: string, epoch: string) => [libraryId, epoch] as const;
