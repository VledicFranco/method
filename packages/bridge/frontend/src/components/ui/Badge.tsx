import { type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full font-body font-medium',
  {
    variants: {
      variant: {
        default: 'bg-abyss-light text-txt-dim',
        bio: 'bg-bio-dim text-bio',
        cyan: 'bg-cyan/15 text-cyan',
        solar: 'bg-solar-dim text-solar',
        error: 'bg-error-dim text-error',
        nebular: 'bg-nebular-dim text-nebular',
        muted: 'bg-txt-muted/10 text-txt-dim',
      },
      size: {
        sm: 'px-2 py-0.5 text-[0.7rem]',
        md: 'px-3 py-1 text-[0.8rem]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'sm',
    },
  },
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  icon?: ReactNode;
  label: string;
  className?: string;
}

export function Badge({ icon, label, variant, size, className }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)}>
      {icon && <span className="shrink-0">{icon}</span>}
      {label}
    </span>
  );
}
