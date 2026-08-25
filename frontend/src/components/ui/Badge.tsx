import { ReactNode } from 'react'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted'

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-primary/12 text-primary border-primary/25',
  success: 'bg-success/12 text-success border-success/25',
  warning: 'bg-warning/12 text-warning border-warning/25',
  danger: 'bg-destructive/12 text-destructive border-destructive/25',
  info: 'bg-accent/12 text-accent border-accent/25',
  muted: 'bg-muted text-muted-foreground border-border',
}

interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

export default function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  )
}
