import { QueryClient } from '@tanstack/react-query';
import { isRetryable } from '@/lib/api/errors';

// In-memory only: nothing is persisted to storage, so owner data disappears
// with the tab or on logout (queryClient.clear()).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (count, err) => count < 2 && isRetryable(err),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
