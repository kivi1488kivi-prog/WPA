import { lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { queryClient } from './queryClient';
import { TenantRoot } from './TenantRoot';
import { ClientLayout } from './ClientLayout';
import { RootIndex, NotFoundPage } from './StaticPages';
import { ShopPage } from '@/features/shop/ShopPage';
import { BookingPage } from '@/features/booking/BookingPage';
import { MyBookingPage } from '@/features/my-booking/MyBookingPage';
import { MyBookingsPage } from '@/features/my-booking/MyBookingsPage';
import { FullscreenSpinner } from '@/components/States';
import { ImpressumPage, PrivacyPage } from '@/features/legal/LegalPages';

// Owner cabinet is a separate chunk: clients never download it.
const OwnerApp = lazy(() => import('@/features/owner/OwnerApp'));
const AssistantPage = lazy(() => import('@/features/assistant/AssistantPage'));

const router = createBrowserRouter([
  { path: '/', element: <RootIndex /> },
  {
    path: '/s/:slug',
    element: <TenantRoot />,
    children: [
      {
        element: <ClientLayout />,
        children: [
          { index: true, element: <ShopPage /> },
          { path: 'book', element: <BookingPage /> },
          { path: 'booking', element: <MyBookingPage /> },
          { path: 'my', element: <MyBookingsPage /> },
          { path: 'impressum', element: <ImpressumPage /> },
          { path: 'datenschutz', element: <PrivacyPage /> },
          { path: 'privacy', element: <PrivacyPage /> },
          {
            path: 'assistant',
            element: (
              <Suspense fallback={<FullscreenSpinner />}>
                <AssistantPage />
              </Suspense>
            ),
          },
        ],
      },
      {
        path: 'owner/*',
        element: (
          <Suspense fallback={<FullscreenSpinner />}>
            <OwnerApp />
          </Suspense>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
