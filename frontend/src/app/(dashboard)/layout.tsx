'use client';

import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Header } from '@/components/Header';
import { FilterProvider } from '@/contexts/FilterContext';
import { Toaster } from 'sonner';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <FilterProvider>
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            <Header />
            <main className="flex-1 overflow-auto scrollbar-hide bg-muted/30">
              {children}
            </main>
          </div>
          <Toaster position="top-right" richColors />
        </div>
      </FilterProvider>
    </SidebarProvider>
  );
}
