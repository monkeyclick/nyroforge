import { ReactNode } from 'react'

type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

const toneClasses: Record<NoticeTone, string> = {
  info: 'border-primary/25 bg-primary/10 text-primary',
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/25 bg-warning/10 text-warning',
  danger: 'border-destructive/25 bg-destructive/10 text-destructive',
}

interface InlineNoticeProps {
  tone?: NoticeTone
  title?: string
  children: ReactNode
  className?: string
}

export default function InlineNotice({ tone = 'info', title, children, className = '' }: InlineNoticeProps) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${toneClasses[tone]} ${className}`}>
      {title && <div className="mb-1 font-black text-foreground">{title}</div>}
      <div className="leading-6 text-current/90">{children}</div>
    </div>
  )
}
