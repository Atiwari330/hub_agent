'use client';

interface QueueBadgeProps {
  count: number;
  variant?: 'default' | 'warning' | 'danger';
}

export function QueueBadge({ count, variant = 'default' }: QueueBadgeProps) {
  if (count === 0) return null;

  const colorClasses = {
    default: 'bg-slate-600 text-slate-200',
    warning: 'bg-amber-500 text-white',
    danger: 'bg-red-500 text-white',
  };

  return (
    <span
      className={`ml-auto text-xs px-1.5 py-0.5 rounded-full font-medium ${colorClasses[variant]}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
