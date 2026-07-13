'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

const WARN_BEFORE_MS = 5 * 60 * 1000; // show warning 5 minutes before expiry

function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function fmtCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function SessionWarningDialog() {
  const { user, logout } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [remainingMs, setRemainingMs] = useState(WARN_BEFORE_MS);
  const [tokenVersion, setTokenVersion] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const autoRefreshFiredRef = useRef(false);
  // Stable ref so countdown effect doesn't need logout in its deps (logout recreated each render)
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  // Schedule the warning dialog based on current token expiry
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    const exp = getTokenExpiry(token);
    if (!exp) return;

    const warnAt = exp * 1000 - WARN_BEFORE_MS;
    const delay = warnAt - Date.now();

    if (delay <= 0) {
      setShowWarning(true);
      return;
    }

    setShowWarning(false);
    const timer = setTimeout(() => setShowWarning(true), delay);
    return () => clearTimeout(timer);
  }, [user, tokenVersion]);

  // Run countdown while warning is visible; attempt auto-refresh at 0 before logging out
  useEffect(() => {
    if (!showWarning) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    const exp = getTokenExpiry(token);
    if (!exp) return;

    autoRefreshFiredRef.current = false;

    const update = () => {
      const remaining = Math.max(0, exp * 1000 - Date.now());
      setRemainingMs(remaining);
      if (remaining === 0 && !autoRefreshFiredRef.current) {
        autoRefreshFiredRef.current = true;
        api.auth.refresh()
          .then((data: any) => {
            localStorage.setItem('token', data.access_token);
            setShowWarning(false);
            setTokenVersion(v => v + 1);
          })
          .catch(() => logoutRef.current());
      }
    };
    update();
    const tick = setInterval(update, 1000);
    return () => clearInterval(tick);
  }, [showWarning]);

  const handleStayLoggedIn = async () => {
    setIsRefreshing(true);
    try {
      const data: any = await api.auth.refresh();
      localStorage.setItem('token', data.access_token);
      setShowWarning(false);
      setTokenVersion(v => v + 1);
    } catch {
      logout();
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!showWarning) return null;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-sm"
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <DialogTitle>Session expiring soon</DialogTitle>
              <DialogDescription className="mt-0.5">
                You will be logged out automatically.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col items-center py-4 gap-2">
          <p className="text-6xl font-mono font-bold text-orange-600 tabular-nums tracking-tight">
            {fmtCountdown(remainingMs)}
          </p>
          <p className="text-sm text-muted-foreground text-center">
            Click <strong>Stay Logged In</strong> to continue without interruption.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => { setShowWarning(false); logout(); }}>
            Log Out
          </Button>
          <Button onClick={handleStayLoggedIn} disabled={isRefreshing} className="flex-1">
            {isRefreshing ? 'Refreshing…' : 'Stay Logged In'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
