'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Bell, User, LogOut, CalendarDays, ChevronDown, Check } from 'lucide-react';
import { Breadcrumb, generateBreadcrumbs } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFilter, FILTER_OPTIONS, computeDateRange } from '@/contexts/FilterContext';
import api from '@/lib/api';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Pages that should show the period filter in the header
const FILTER_PAGES = [
  '/dashboard',
  '/sales-overview',
  '/amazon-sales',
  '/blinkit-sales',
  '/distributor',
  '/po-lifecycle',
  '/amazon-po',
  '/amazon-po-overview',
  '/blinkit-po',
  '/blinkit-po-overview',
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { filterMode, setFilterMode, customStart, setCustomStart, customEnd, setCustomEnd } = useFilter();
  const breadcrumbs = generateBreadcrumbs(pathname);
  const [mounted, setMounted] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || !user) return;
    const fetchUnread = () => {
      api.notifications.getStats().then((s: any) => {
        setUnreadCount(s?.unreadNotifications ?? 0);
      }).catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, [mounted, user]);

  const showFilter = FILTER_PAGES.includes(pathname);
  const currentLabel = FILTER_OPTIONS.find(o => o.value === filterMode)?.label ?? 'All Time';

  const dateRangeLabel = (() => {
    if (filterMode === 'all' || filterMode === 'custom') return null;
    const { start_date, end_date } = computeDateRange(filterMode, customStart, customEnd);
    if (!start_date && !end_date) return null;
    const fmt = (iso: string) => {
      const [, m, d] = iso.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${parseInt(d)} ${months[parseInt(m) - 1]}`;
    };
    if (start_date && end_date) return `${fmt(start_date)} – ${fmt(end_date)}`;
    if (start_date) return `From ${fmt(start_date)}`;
    return null;
  })();

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 bg-background px-6 border-b z-30">
      {/* Left: Sidebar trigger + Breadcrumbs */}
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <SidebarTrigger className="-ml-2 flex-shrink-0" />
        <Breadcrumb items={breadcrumbs} className="hidden md:flex" />
      </div>

      {/* Right: Period filter (when applicable) + Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">

        {/* Single dropdown filter button */}
        {showFilter && (
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-medium pr-2.5">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  {currentLabel}
                  <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {FILTER_OPTIONS.filter(o => o.value !== 'custom').map(opt => (
                  <DropdownMenuItem
                    key={opt.value}
                    onClick={() => setFilterMode(opt.value)}
                    className="gap-2 cursor-pointer"
                  >
                    <span className="w-4 flex-shrink-0">
                      {filterMode === opt.value && <Check className="h-3.5 w-3.5 text-blue-600" />}
                    </span>
                    {opt.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setFilterMode('custom')}
                  className="gap-2 cursor-pointer"
                >
                  <span className="w-4 flex-shrink-0">
                    {filterMode === 'custom' && <Check className="h-3.5 w-3.5 text-blue-600" />}
                  </span>
                  Custom Range
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Date range label for non-custom modes */}
            {dateRangeLabel && filterMode !== 'custom' && (
              <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">
                {dateRangeLabel}
              </span>
            )}

            {/* Custom date inputs shown inline when custom is selected */}
            {filterMode === 'custom' && (
              <>
                <input
                  type="date"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                  className="h-8 text-xs border border-border rounded-md px-2 bg-background text-foreground w-32"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="h-8 text-xs border border-border rounded-md px-2 bg-background text-foreground w-32"
                />
              </>
            )}
          </div>
        )}

        <div className="h-5 w-px bg-border" />

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="relative h-9 w-9" onClick={() => router.push('/notifications')}>
                <Bell className="h-4 w-4" />
                {mounted && unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
                <span className="sr-only">Notifications</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Notifications</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* User Profile Dropdown — deferred until after hydration to avoid SSR/client ID mismatch */}
        {mounted && user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                <Avatar className="h-9 w-9 ring-2 ring-primary/10 hover:ring-primary/30 transition-all">
                  <AvatarFallback className="text-xs font-semibold">
                    {user.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user.role.replace('_', ' ')}</p>
                {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/profile')}>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
