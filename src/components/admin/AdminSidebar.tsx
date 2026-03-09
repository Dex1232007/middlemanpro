import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  ArrowLeftRight, 
  Users, 
  Wallet, 
  Settings, 
  AlertTriangle,
  LogOut,
  Bot,
  PiggyBank,
  BarChart3,
  Megaphone,
  Gift,
  MoreHorizontal
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const menuItems = [
  { icon: LayoutDashboard, label: 'Dashboard', shortLabel: 'Home', path: '/admin' },
  { icon: ArrowLeftRight, label: 'ရောင်းဝယ်မှုများ', shortLabel: 'Trade', path: '/admin/transactions' },
  { icon: Users, label: 'အသုံးပြုသူများ', shortLabel: 'Users', path: '/admin/users' },
  { icon: PiggyBank, label: 'ငွေသွင်းမှုများ', shortLabel: 'Deposit', path: '/admin/deposits' },
  { icon: Wallet, label: 'ငွေထုတ်ယူမှုများ', shortLabel: 'Withdraw', path: '/admin/withdrawals' },
];

const moreMenuItems = [
  { icon: BarChart3, label: 'Analytics', path: '/admin/analytics' },
  { icon: Gift, label: 'Referral Leaderboard', path: '/admin/referrals' },
  { icon: AlertTriangle, label: 'အငြင်းပွားမှုများ', path: '/admin/disputes' },
  { icon: Megaphone, label: 'ကြေညာချက်', path: '/admin/broadcast' },
  { icon: Settings, label: 'ဆက်တင်များ', path: '/admin/settings' },
];

const allMenuItems = [...menuItems, ...moreMenuItems];

function DesktopSidebar() {
  const location = useLocation();
  const { signOut } = useAuth();

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 border-r border-border bg-card md:block">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <Bot className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-foreground">Middleman Bot</h1>
            <p className="text-xs text-muted-foreground">Admin Panel</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3">
          {allMenuItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-muted'
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="border-t border-border p-3">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => signOut()}
          >
            <LogOut className="h-5 w-5" />
            ထွက်မည်
          </Button>
        </div>
      </div>
    </aside>
  );
}

function MobileBottomNav() {
  const location = useLocation();
  const { signOut } = useAuth();
  const isMoreActive = moreMenuItems.some(item => item.path === location.pathname);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card md:hidden safe-area-bottom">
      <div className="flex items-center justify-around px-1 py-1">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-[10px] font-medium transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground'
              )}
            >
              <item.icon className={cn('h-5 w-5', isActive && 'text-primary')} />
              <span>{item.shortLabel}</span>
            </Link>
          );
        })}

        {/* More dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-[10px] font-medium transition-colors',
                isMoreActive
                  ? 'text-primary'
                  : 'text-muted-foreground'
              )}
            >
              <MoreHorizontal className={cn('h-5 w-5', isMoreActive && 'text-primary')} />
              <span>More</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56 mb-2">
            {moreMenuItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <DropdownMenuItem key={item.path} asChild>
                  <Link
                    to={item.path}
                    className={cn(
                      'flex items-center gap-3 cursor-pointer',
                      isActive && 'text-primary font-semibold'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="flex items-center gap-3 text-destructive cursor-pointer"
              onClick={() => signOut()}
            >
              <LogOut className="h-4 w-4" />
              ထွက်မည်
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}

export function AdminSidebar() {
  return (
    <>
      <MobileBottomNav />
      <DesktopSidebar />
    </>
  );
}
