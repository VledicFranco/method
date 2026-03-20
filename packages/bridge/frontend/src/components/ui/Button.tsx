import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { Loader2 } from 'lucide-react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-body font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bio focus-visible:ring-offset-2 focus-visible:ring-offset-void disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-bio text-void hover:bg-bio/90 active:bg-bio/80',
        secondary:
          'border border-bdr text-txt hover:border-bdr-hover hover:bg-abyss-light active:bg-abyss',
        danger: 'bg-error text-white hover:bg-error/90 active:bg-error/80',
        ghost: 'text-txt-dim hover:text-txt hover:bg-abyss-light active:bg-abyss',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-sm',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
        {children}
        {rightIcon}
      </button>
    );
  },
);

Button.displayName = 'Button';
