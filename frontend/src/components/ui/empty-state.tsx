import * as React from 'react';
import { cn } from '@/lib/utils';
import { LucideIcon, FileQuestion, SearchX, AlertCircle, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  variant?: 'default' | 'no-results' | 'error' | 'no-data';
  className?: string;
}

const variantIcons: Record<string, LucideIcon> = {
  default: Inbox,
  'no-results': SearchX,
  error: AlertCircle,
  'no-data': FileQuestion,
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
  className,
}: EmptyStateProps) {
  const Icon = icon || variantIcons[variant];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 px-4 text-center',
        className
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4">{description}</p>
      )}
      {action && (
        <Button onClick={action.onClick} variant="outline">
          {action.label}
        </Button>
      )}
    </div>
  );
}

// Convenience components for common use cases
export function NoDataState({
  title = 'No data available',
  description = 'There is no data to display at the moment.',
  ...props
}: Partial<EmptyStateProps>) {
  return <EmptyState variant="no-data" title={title} description={description} {...props} />;
}

export function NoResultsState({
  title = 'No results found',
  description = 'Try adjusting your search or filter criteria.',
  ...props
}: Partial<EmptyStateProps>) {
  return <EmptyState variant="no-results" title={title} description={description} {...props} />;
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'An error occurred while loading the data. Please try again.',
  ...props
}: Partial<EmptyStateProps>) {
  return <EmptyState variant="error" title={title} description={description} {...props} />;
}
