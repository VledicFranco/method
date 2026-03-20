import { type HTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const cardVariants = cva(
  'rounded-card border border-bdr bg-abyss transition-all duration-200',
  {
    variants: {
      variant: {
        default: '',
        interactive:
          'cursor-pointer hover:border-bdr-hover hover:bg-abyss-light hover:-translate-y-0.5 hover:shadow-lg',
        active: 'border-bio/30 bg-abyss-light',
      },
      padding: {
        none: '',
        sm: 'p-sp-3',
        md: 'p-sp-4',
        lg: 'p-sp-6',
      },
    },
    defaultVariants: {
      variant: 'default',
      padding: 'md',
    },
  },
);

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  /** Optional left border accent color */
  accent?: 'bio' | 'solar' | 'error' | 'nebular' | 'cyan';
  selected?: boolean;
  children: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, accent, selected, children, ...props }, ref) => {
    const accentClass = accent
      ? `border-l-2 border-l-${accent}`
      : '';

    return (
      <div
        ref={ref}
        className={cn(
          cardVariants({ variant: selected ? 'active' : variant, padding }),
          accentClass,
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Card.displayName = 'Card';
