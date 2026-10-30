'use client';

import { useState, useEffect } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, BellOff, CheckCheck, Check } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: number;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  is_read: boolean;
  created_at: string;
}

const TYPE_STYLES: Record<string, { dot: string; icon: string }> = {
  success: { dot: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-600' },
  warning: { dot: 'bg-yellow-500', icon: 'bg-yellow-50 text-yellow-600' },
  error:   { dot: 'bg-red-500',     icon: 'bg-red-50 text-red-600' },
  info:    { dot: 'bg-blue-500',    icon: 'bg-blue-50 text-blue-600' },
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchNotifications = async () => {
    try {
      setIsLoading(true);
      const data = await api.notifications.getAll() as any;
      setNotifications(data || []);
    } catch {
      toast.error('Failed to load notifications');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const markAsRead = async (id: number) => {
    try {
      await api.notifications.markAsRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch {
      toast.error('Failed to update notification');
    }
  };

  const markAllAsRead = async () => {
    try {
      await (api.notifications as any).markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      toast.success('All notifications marked as read');
    } catch {
      toast.error('Failed to update notifications');
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-4 sm:p-6 flex items-center justify-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Notifications</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {unreadCount > 0
                ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
                : 'All caught up!'}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button onClick={markAllAsRead} variant="outline" size="sm" className="shrink-0 gap-1.5">
              <CheckCheck className="h-4 w-4" />
              Mark all as read
            </Button>
          )}
        </div>

        {/* List */}
        {notifications.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <BellOff className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium">No notifications yet</p>
              <p className="text-xs text-muted-foreground mt-1">You're all caught up. Check back later.</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="divide-y">
              {notifications.map((n) => {
                const styles = TYPE_STYLES[n.type] ?? TYPE_STYLES.info;
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                      !n.is_read ? 'bg-muted/40' : 'bg-background'
                    }`}
                  >
                    {/* Colored icon */}
                    <div className={`mt-0.5 p-1.5 rounded-full shrink-0 ${styles.icon}`}>
                      <Bell className="h-3.5 w-3.5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium leading-snug">{n.title}</span>
                        {!n.is_read && (
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${styles.dot}`} />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.message}</p>
                      <p className="text-[11px] text-muted-foreground/70 mt-1">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>

                    {/* Mark as read */}
                    {!n.is_read && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 mt-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() => markAsRead(n.id)}
                        title="Mark as read"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </ProtectedRoute>
  );
}
