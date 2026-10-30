'use client';

import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Header } from '@/components/Header';
import { FilterProvider } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Toaster } from 'sonner';
import { SessionWarningDialog } from '@/components/SessionWarningDialog';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <SidebarProvider>
        <FilterProvider>
          <div className="flex h-screen w-full overflow-hidden">
            <AppSidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <Header />
              <main className="flex-1 overflow-y-auto scrollbar-hide bg-muted/30">
                {children}
              </main>
            </div>
            <Toaster position="top-right" richColors />
            <SessionWarningDialog />
          </div>
        </FilterProvider>
      </SidebarProvider>
    </ProtectedRoute>
  );
}
