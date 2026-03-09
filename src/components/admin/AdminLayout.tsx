import { ReactNode } from 'react';
import { AdminSidebar } from './AdminSidebar';

interface AdminLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

export function AdminLayout({ children, title, subtitle }: AdminLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar />
      {/* Main content - full width on mobile with bottom nav space, offset on desktop */}
      <main className="min-h-screen md:ml-64">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="px-4 py-3 md:px-8 md:py-6">
            <h1 className="text-lg md:text-2xl font-bold text-foreground">{title}</h1>
            {subtitle && (
              <p className="mt-0.5 text-xs md:text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </header>
        <div className="p-3 pb-20 md:p-8 md:pb-8">{children}</div>
      </main>
    </div>
  );
}