import { UserRole } from './auth';

/**
 * Centralized route access control configuration
 * Maps route paths to allowed user roles
 * IMPORTANT: Role names match database exactly (capital letters with spaces)
 */
export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  // Dashboard
  '/dashboard': ['Admin', 'Manager', 'Blinkit Distributor', 'Amazon Distributor'],

  // Inventory & Dispatch
  '/inventory': ['Admin', 'Manager', 'Blinkit Distributor', 'Amazon Distributor'],

  // Purchase Orders
  '/amazon-po': ['Admin', 'Manager', 'Amazon Distributor'],
  '/blinkit-po': ['Admin', 'Manager', 'Blinkit Distributor'],
  '/amazon-po-overview': ['Admin', 'Manager', 'Amazon Distributor'],
  '/blinkit-po-overview': ['Admin', 'Manager', 'Blinkit Distributor'],
  '/po-lifecycle': ['Admin', 'Manager', 'Blinkit Distributor', 'Amazon Distributor'],

  // Sales & Analytics
  '/sales-overview': ['Admin', 'Manager', 'Blinkit Distributor', 'Amazon Distributor'],
  '/amazon-sales': ['Admin', 'Manager', 'Amazon Distributor'],
  '/blinkit-sales': ['Admin', 'Manager', 'Blinkit Distributor'],
  '/analytics': ['Admin', 'Manager'],

  // Blinkit Facility Inventory
  '/blinkit-inventory': ['Admin', 'Manager', 'Blinkit Distributor'],

  // Distributor pages
  '/distributor': ['Admin', 'Manager', 'Blinkit Distributor', 'Amazon Distributor'],
  '/distributor-master': ['Admin'],
  '/asg-warehouses': ['Admin'],

  // Alerts & Monitoring
  '/low-stock-alerts': ['Admin', 'Manager', 'Blinkit Distributor', 'Amazon Distributor'],

  // Upload Pages - Admin Only
  '/amazon-upload': ['Admin'],
  '/blinkit-upload': ['Admin'],
  '/stock-upload': ['Admin'],

  // Master Data - Admin Only
  '/product-master': ['Admin'],
  '/amazon-warehouse': ['Admin'],
  '/blinkit-warehouse': ['Admin'],

  // User & Role Management - Admin Only
  '/user-management': ['Admin'],
  '/role-management': ['Admin'],
  '/activity-log': ['Admin', 'Manager'],

  // User Profile & Notifications - All Authenticated Users
  '/profile': ['Admin', 'Manager', 'Blinkit Distributor', 'Amazon Distributor'],
  '/notifications': ['Admin', 'Manager', 'Blinkit Distributor', 'Amazon Distributor'],

  // Other Pages
  '/orders': ['Admin', 'Manager', 'Blinkit Distributor', 'Amazon Distributor'],
  '/products': ['Admin', 'Manager'],
};

/**
 * Check if a user role has access to a specific route
 */
export function hasRouteAccess(route: string, userRole: UserRole): boolean {
  // Admin has access to all routes by default
  if (userRole === 'Admin') {
    return true;
  }

  const allowedRoles = ROUTE_PERMISSIONS[route];

  if (!allowedRoles) {
    // If route is not defined in permissions, deny access by default for non-admins
    return false;
  }

  return allowedRoles.includes(userRole);
}

/**
 * Get all routes accessible by a specific role
 */
export function getAccessibleRoutes(userRole: UserRole): string[] {
  return Object.entries(ROUTE_PERMISSIONS)
    .filter(([_, roles]) => roles.includes(userRole))
    .map(([route]) => route);
}

/**
 * Get allowed roles for a specific route
 */
export function getAllowedRoles(route: string): UserRole[] {
  return ROUTE_PERMISSIONS[route] || [];
}
