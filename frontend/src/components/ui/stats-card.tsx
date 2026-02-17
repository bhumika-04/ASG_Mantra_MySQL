import * as React from 'react';
import { cn } from '@/lib/utils';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label?: string;
    isPositive?: boolean;
  };
  description?: string;
  className?: string;
  variant?: 'default' | 'blue' | 'yellow' | 'purple' | 'green' | 'orange' | 'red';
}

export function StatsCard({
  title,
  value,
  icon: Icon,
  trend,
  description,
  className,
  variant = 'default',
}: StatsCardProps) {
  const getTrendIcon = () => {
    if (!trend) return null;
    const isPositive = trend.isPositive !== undefined ? trend.isPositive : trend.value > 0;
    if (isPositive) return TrendingUp;
    return TrendingDown;
  };

  const getTrendColor = () => {
    if (!trend) return '';
    const isPositive = trend.isPositive !== undefined ? trend.isPositive : trend.value > 0;
    if (isPositive) return 'text-emerald-600';
    return 'text-red-500';
  };

  const getIconColors = () => {
    if (variant === 'blue') {
      return 'bg-blue-50 text-blue-600';
    }
    if (variant === 'yellow') {
      return 'bg-amber-50 text-amber-600';
    }
    if (variant === 'purple') {
      return 'bg-purple-50 text-purple-600';
    }
    if (variant === 'green') {
      return 'bg-emerald-50 text-emerald-600';
    }
    if (variant === 'orange') {
      return 'bg-orange-50 text-orange-600';
    }
    if (variant === 'red') {
      return 'bg-red-50 text-red-600';
    }
    return 'bg-muted text-muted-foreground';
  };

  const TrendIcon = getTrendIcon();

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-5 transition-all duration-200',
        'hover:shadow-lg hover:border-primary/30',
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {title}
          </p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {trend && (
            <div className={cn('flex items-center gap-1 text-xs', getTrendColor())}>
              {TrendIcon && <TrendIcon className="h-3 w-3" />}
              <span className="font-medium">
                {trend.value > 0 ? '+' : ''}
                {trend.value}%
              </span>
              {trend.label && (
                <span className="text-muted-foreground">{trend.label}</span>
              )}
            </div>
          )}
          {description && !trend && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {Icon && (
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', getIconColors())}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </div>
  );
}

// Grid of stats cards
interface StatsGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6 | 7;
  className?: string;
}

export function StatsGrid({ children, columns = 4, className }: StatsGridProps) {
  const gridCols = {
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-2 lg:grid-cols-4',
    5: 'md:grid-cols-3 lg:grid-cols-5',
    6: 'md:grid-cols-3 lg:grid-cols-6',
    7: 'md:grid-cols-4 lg:grid-cols-7',
  };

  return (
    <div className={cn('grid gap-4 grid-cols-1 sm:grid-cols-2', gridCols[columns], className)}>
      {children}
    </div>
  );
}
