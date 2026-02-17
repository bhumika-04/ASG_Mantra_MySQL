'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center', className)}>
      <ol className="flex items-center gap-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-center gap-2">
            {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground/50" />}
            {item.href && index !== items.length - 1 ? (
              <Link
                href={item.href}
                className="text-base text-muted-foreground hover:text-foreground transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span className="font-semibold text-foreground text-xl">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// Utility to generate breadcrumbs from pathname
export function generateBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);

  const labelMap: Record<string, string> = {
    'dashboard': 'Dashboard',
    'inventory': 'Inventory',
    'amazon-po': 'Amazon PO',
    'amazon-po-overview': 'Amazon PO Overview',
    'amazon-sales': 'Amazon Sales',
    'amazon-upload': 'Amazon Upload',
    'amazon-warehouse': 'Amazon Warehouse',
    'blinkit-po': 'Blinkit PO',
    'blinkit-po-overview': 'Blinkit PO Overview',
    'blinkit-sales': 'Blinkit Sales',
    'blinkit-upload': 'Blinkit Upload',
    'blinkit-warehouse': 'Blinkit Warehouse',
    'po-lifecycle': 'PO Lifecycle',
    'sales-overview': 'Sales Overview',
    'low-stock-alerts': 'Low Inventory Alerts',
    'stock-upload': 'Inventory Upload (ASG)',
    'product-master': 'Product Master',
    'user-management': 'User Management',
    'role-management': 'Role Management',
    'settings': 'Settings',
  };

  return segments.map((segment, index) => ({
    label: labelMap[segment] || segment.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    href: index < segments.length - 1 ? '/' + segments.slice(0, index + 1).join('/') : undefined,
  }));
}
