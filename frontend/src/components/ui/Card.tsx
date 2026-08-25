import { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  padded?: boolean
}

export function Card({ children, padded = true, className = '', ...props }: CardProps) {
  return (
    <div className={`surface-card ${padded ? 'p-4' : ''} ${className}`} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className = '', ...props }: CardProps) {
  return (
    <div className={`border-b border-border px-4 py-3 ${className}`} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className = '', ...props }: CardProps) {
  return (
    <h2 className={`text-sm font-extrabold uppercase tracking-wide text-foreground ${className}`} {...props}>
      {children}
    </h2>
  )
}
