import { UserRole } from '@/types/auth';
import { ROUTE_PERMISSIONS } from '@/types/route-permissions';
import {
  Package,
  BarChart3,
  Users,
  FileText,
  Truck,
  Store,
  LucideIcon,
  AlertTriangle,
  Shield,
  Upload,
  Warehouse,
  LayoutDashboard,
  TrendingUp,
  ClipboardList,
  Database,
  Building2,
  History,
} from 'lucide-react';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
  badge?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

// Navigation items configuration
// Roles are automatically synced from ROUTE_PERMISSIONS
export const navigationItems: NavItem[] = [
  {
    title: 'Inventory',
    href: '/inventory',
    icon: Package,
    roles: ROUTE_PERMISSIONS['/inventory'],
  },
  {
    title: 'Amazon PO',
    href: '/amazon-po',
    icon: FileText,
    roles: ROUTE_PERMISSIONS['/amazon-po'],
  },
  {
    title: 'Blinkit PO',
    href: '/blinkit-po',
    icon: FileText,
    roles: ROUTE_PERMISSIONS['/blinkit-po'],
  },
  {
    title: 'Amazon PO Overview',
    href: '/amazon-po-overview',
    icon: FileText,
    roles: ROUTE_PERMISSIONS['/amazon-po-overview'],
  },
  {
    title: 'Blinkit PO Overview',
    href: '/blinkit-po-overview',
    icon: FileText,
    roles: ROUTE_PERMISSIONS['/blinkit-po-overview'],
  },
  {
    title: 'PO Lifecycle',
    href: '/po-lifecycle',
    icon: FileText,
    roles: ROUTE_PERMISSIONS['/po-lifecycle'],
  },
  {
    title: 'Sales Overview',
    href: '/sales-overview',
    icon: BarChart3,
    roles: ROUTE_PERMISSIONS['/sales-overview'],
  },
  {
    title: 'Amazon Sales',
    href: '/amazon-sales',
    icon: Truck,
    roles: ROUTE_PERMISSIONS['/amazon-sales'],
  },
  {
    title: 'Blinkit Sales',
    href: '/blinkit-sales',
    icon: Store,
    roles: ROUTE_PERMISSIONS['/blinkit-sales'],
  },
  {
    title: 'Blinkit Inventory',
    href: '/blinkit-inventory',
    icon: Store,
    roles: ROUTE_PERMISSIONS['/blinkit-inventory'],
  },
  {
    title: 'Low Inventory Alerts',
    href: '/low-stock-alerts',
    icon: AlertTriangle,
    roles: ROUTE_PERMISSIONS['/low-stock-alerts'],
  },
  {
    title: 'Amazon Upload',
    href: '/amazon-upload',
    icon: Truck,
    roles: ROUTE_PERMISSIONS['/amazon-upload'],
  },
  {
    title: 'Blinkit Upload',
    href: '/blinkit-upload',
    icon: Store,
    roles: ROUTE_PERMISSIONS['/blinkit-upload'],
  },
  {
    title: 'Inventory Upload',
    href: '/stock-upload',
    icon: Package,
    roles: ROUTE_PERMISSIONS['/stock-upload'],
  },
  {
    title: 'Product Master',
    href: '/product-master',
    icon: Package,
    roles: ROUTE_PERMISSIONS['/product-master'],
  },
  {
    title: 'Amazon Warehouse',
    href: '/amazon-warehouse',
    icon: Truck,
    roles: ROUTE_PERMISSIONS['/amazon-warehouse'],
  },
  {
    title: 'Blinkit Warehouse',
    href: '/blinkit-warehouse',
    icon: Store,
    roles: ROUTE_PERMISSIONS['/blinkit-warehouse'],
  },
  {
    title: 'User Management',
    href: '/user-management',
    icon: Users,
    roles: ROUTE_PERMISSIONS['/user-management'],
  },
  {
    title: 'Role Management',
    href: '/role-management',
    icon: Shield,
    roles: ROUTE_PERMISSIONS['/role-management'],
  },
];

// Grouped navigation for sidebar
export const navigationGroups: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      {
        title: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
        roles: ROUTE_PERMISSIONS['/dashboard'],
      },
      {
        title: 'Sales Overview',
        href: '/sales-overview',
        icon: TrendingUp,
        roles: ROUTE_PERMISSIONS['/sales-overview'],
      },
    ],
  },
  {
    title: 'Inventory',
    items: [
      {
        title: 'Inventory',
        href: '/inventory',
        icon: Package,
        roles: ROUTE_PERMISSIONS['/inventory'],
      },
      {
        title: 'Low Inventory Alerts',
        href: '/low-stock-alerts',
        icon: AlertTriangle,
        roles: ROUTE_PERMISSIONS['/low-stock-alerts'],
      },
    ],
  },
  {
    title: 'Distributors',
    items: [
      {
        title: 'Distributor Stock',
        href: '/distributor',
        icon: Building2,
        roles: ROUTE_PERMISSIONS['/distributor'],
      },
    ],
  },
  {
    title: 'Purchase Orders',
    items: [
      {
        title: 'PO Lifecycle',
        href: '/po-lifecycle',
        icon: ClipboardList,
        roles: ROUTE_PERMISSIONS['/po-lifecycle'],
      },
      {
        title: 'Amazon PO',
        href: '/amazon-po',
        icon: Truck,
        roles: ROUTE_PERMISSIONS['/amazon-po'],
      },
      {
        title: 'Amazon PO Overview',
        href: '/amazon-po-overview',
        icon: Truck,
        roles: ROUTE_PERMISSIONS['/amazon-po-overview'],
      },
      {
        title: 'Blinkit PO',
        href: '/blinkit-po',
        icon: Store,
        roles: ROUTE_PERMISSIONS['/blinkit-po'],
      },
      {
        title: 'Blinkit PO Overview',
        href: '/blinkit-po-overview',
        icon: Store,
        roles: ROUTE_PERMISSIONS['/blinkit-po-overview'],
      },
    ],
  },
  {
    title: 'Sales',
    items: [
      {
        title: 'Amazon Sales',
        href: '/amazon-sales',
        icon: Truck,
        roles: ROUTE_PERMISSIONS['/amazon-sales'],
      },
      {
        title: 'Blinkit Sales',
        href: '/blinkit-sales',
        icon: Store,
        roles: ROUTE_PERMISSIONS['/blinkit-sales'],
      },
    ],
  },
  {
    title: 'Data Upload',
    items: [
      {
        title: 'Inventory Upload',
        href: '/stock-upload',
        icon: Upload,
        roles: ROUTE_PERMISSIONS['/stock-upload'],
      },
      {
        title: 'Amazon Upload',
        href: '/amazon-upload',
        icon: Upload,
        roles: ROUTE_PERMISSIONS['/amazon-upload'],
      },
      {
        title: 'Blinkit Upload',
        href: '/blinkit-upload',
        icon: Upload,
        roles: ROUTE_PERMISSIONS['/blinkit-upload'],
      },
    ],
  },
  {
    title: 'Master Data',
    items: [
      {
        title: 'Product Master',
        href: '/product-master',
        icon: Database,
        roles: ROUTE_PERMISSIONS['/product-master'],
      },
      {
        title: 'ASG Warehouses',
        href: '/asg-warehouses',
        icon: Warehouse,
        roles: ROUTE_PERMISSIONS['/asg-warehouses'],
      },
      {
        title: 'Amazon Warehouse',
        href: '/amazon-warehouse',
        icon: Truck,
        roles: ROUTE_PERMISSIONS['/amazon-warehouse'],
      },
      {
        title: 'Blinkit Warehouse',
        href: '/blinkit-warehouse',
        icon: Store,
        roles: ROUTE_PERMISSIONS['/blinkit-warehouse'],
      },
      {
        title: 'Distributor Master',
        href: '/distributor-master',
        icon: Building2,
        roles: ROUTE_PERMISSIONS['/distributor-master'],
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        title: 'User Management',
        href: '/user-management',
        icon: Users,
        roles: ROUTE_PERMISSIONS['/user-management'],
      },
      {
        title: 'Role Management',
        href: '/role-management',
        icon: Shield,
        roles: ROUTE_PERMISSIONS['/role-management'],
      },
      {
        title: 'Activity Log',
        href: '/activity-log',
        icon: History,
        roles: ROUTE_PERMISSIONS['/activity-log'],
      },
    ],
  },
];

export function getNavigationForRole(role: UserRole): NavItem[] {
  return navigationItems.filter(item => item.roles.includes(role));
}

export function getGroupedNavigationForRole(role: UserRole): NavGroup[] {
  return navigationGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => item.roles.includes(role)),
    }))
    .filter(group => group.items.length > 0);
}
