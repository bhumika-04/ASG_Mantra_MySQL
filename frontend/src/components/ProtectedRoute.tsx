'use client';

import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types/auth';
import { hasRouteAccess } from '@/types/route-permissions';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[]; // Optional: for backward compatibility
  requiredPermissions?: string[]; // Optional: permission-based access control
  requireAll?: boolean; // If true, user must have ALL permissions; if false, ANY permission
  redirectTo?: string;
}

export function ProtectedRoute({
  children,
  allowedRoles,
  requiredPermissions,
  requireAll = true,
  redirectTo = '/'
}: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const checkPermissionAccess = (): boolean => {
    if (!user || !requiredPermissions || requiredPermissions.length === 0) {
      return true; // No permissions required
    }

    const userPermissions = user.permissions || [];

    if (requireAll) {
      // User must have ALL required permissions
      return requiredPermissions.every((perm) => userPermissions.includes(perm));
    } else {
      // User must have ANY of the required permissions
      return requiredPermissions.some((perm) => userPermissions.includes(perm));
    }
  };

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.push(redirectTo);
      } else {
        // Check access based on priority: permissions > roles > route config
        let hasAccess = true;

        if (requiredPermissions && requiredPermissions.length > 0) {
          hasAccess = checkPermissionAccess();
        } else if (allowedRoles) {
          hasAccess = allowedRoles.includes(user.role);
        } else {
          hasAccess = hasRouteAccess(pathname, user.role);
        }

        if (!hasAccess) {
          router.push('/unauthorized');
        }
      }
    }
  }, [user, isLoading, allowedRoles, requiredPermissions, pathname, router, redirectTo]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Check access based on priority: permissions > roles > route config
  let hasAccess = true;

  if (requiredPermissions && requiredPermissions.length > 0) {
    hasAccess = checkPermissionAccess();
  } else if (allowedRoles) {
    hasAccess = allowedRoles.includes(user.role);
  } else {
    hasAccess = hasRouteAccess(pathname, user.role);
  }

  if (!hasAccess) {
    return null;
  }

  return <>{children}</>;
}
