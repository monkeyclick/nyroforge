import { ReactNode, useState } from 'react'
import { useRouter } from 'next/router'
import { BellIcon, FilmIcon, HomeIcon, UserCircleIcon } from '@heroicons/react/24/outline'
import ThemeToggle from '@/components/ThemeToggle'
import { ActivityCenter } from '@/components/activity'
import { useActivityStore } from '@/stores/activityStore'

interface AppShellProps {
  children: ReactNode
  title?: string
  isAdmin?: boolean
  showStudioNav?: boolean
  onSignOut?: () => void | Promise<void>
}

export default function AppShell({ children, title, isAdmin = false, showStudioNav = true, onSignOut }: AppShellProps) {
  const router = useRouter()
  const isStudio = router.pathname === '/'
  const [isActivityOpen, setIsActivityOpen] = useState(false)
  const { activities, markAllRead, clearCompleted, dismissActivity } = useActivityStore()
  const unreadCount = activities.filter(activity => !activity.read).length

  const openActivityCenter = () => {
    setIsActivityOpen(true)
    markAllRead()
  }

  return (
    <div className="studio-shell min-h-screen">
      <nav className="studio-nav" aria-label="Primary navigation">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between sm:h-[4.5rem]">
            <button onClick={() => router.push('/')} className="flex items-center gap-3 text-left" aria-label="Go to studio">
              <span className="brand-mark"><FilmIcon className="h-5 w-5" /></span>
              <span>
                <span className="block text-base font-bold tracking-tight text-gray-900">NyroForge</span>
                <span className="hidden text-[10px] font-semibold uppercase tracking-[.2em] text-gray-500 sm:block">{title || 'Creative Compute'}</span>
              </span>
            </button>

            <div className="flex items-center gap-2 sm:gap-3">
              {showStudioNav && (
                <button onClick={() => router.push('/')} className={`nav-pill ${isStudio ? 'nav-pill-active' : ''}`} aria-current={isStudio ? 'page' : undefined}>
                  <HomeIcon className="h-4 w-4" /><span className="hidden md:inline">Studio</span>
                </button>
              )}
              {isAdmin && (
                <button onClick={() => router.push('/admin')} className={`nav-pill ${router.pathname === '/admin' ? 'nav-pill-active' : ''}`}>Operations</button>
              )}
              <button onClick={openActivityCenter} className="icon-button relative" aria-label={`Open activity center${unreadCount ? `, ${unreadCount} unread` : ''}`}>
                <BellIcon className="h-5 w-5" />
                {unreadCount > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-violet-600 px-1 text-[9px] font-bold text-white">{Math.min(unreadCount, 9)}{unreadCount > 9 ? '+' : ''}</span>}
              </button>
              <ThemeToggle />
              <button onClick={() => router.push('/profile')} className="icon-button" aria-label="Open profile"><UserCircleIcon className="h-5 w-5" /></button>
              {onSignOut && <button onClick={onSignOut} className="hidden px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 sm:block">Sign out</button>}
            </div>
          </div>
        </div>
      </nav>
      {children}
      <ActivityCenter
        isOpen={isActivityOpen}
        activities={activities}
        onClose={() => setIsActivityOpen(false)}
        onDismiss={(activity) => dismissActivity(activity.id)}
        onClearCompleted={clearCompleted}
      />
    </div>
  )
}
