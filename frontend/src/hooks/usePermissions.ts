import { useAuth } from '@/contexts/AuthContext';

/**
 * Hook to check user permissions
 * Returns functions to check if user has specific permissions
 */
export function usePermissions() {
  const { user } = useAuth();

  const hasPermission = (permission: string): boolean => {
    if (!user || !user.permissions) return false;
    return user.permissions.includes(permission);
  };

  const hasAnyPermission = (permissions: string[]): boolean => {
    if (!user || !user.permissions) return false;
    return permissions.some((permission) => user.permissions?.includes(permission));
  };

  const hasAllPermissions = (permissions: string[]): boolean => {
    if (!user || !user.permissions) return false;
    return permissions.every((permission) => user.permissions?.includes(permission));
  };

  const isAdmin = (): boolean => {
    return user?.role === 'Admin';
  };

  return {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    isAdmin,
    permissions: user?.permissions || [],
  };
}

/**
 * Permission constants matching backend role-management page
 */
export const PERMISSIONS = {
  VIEW_DASHBOARD: 'view-dashboard',
  VIEW_AMAZON: 'view-amazon',
  VIEW_BLINKIT: 'view-blinkit',
  VIEW_SALES: 'view-sales',
  VIEW_ANALYTICS: 'view-analytics',
  MANAGE_PRODUCTS: 'manage-products',
  MANAGE_INVENTORY: 'manage-inventory',
  MANAGE_USERS: 'manage-users',
  MANAGE_ROLES: 'manage-roles',
  VIEW_REPORTS: 'view-reports',
} as const;
