import { ReactNode, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useAuthStore } from '@/stores/authStore'
import { signOut } from 'aws-amplify/auth'
import toast from 'react-hot-toast'
import FeedbackModal from '@/components/FeedbackModal'
import { useAnalytics } from '@/hooks/useAnalytics'

interface MainLayoutProps {
  children: ReactNode
}

export default function MainLayout({ children }: MainLayoutProps) {
  const router = useRouter()
  const { user, isAdmin, logout } = useAuthStore()
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)
  const { trackClick } = useAnalytics()

  const handleLogout = async () => {
    try {
      // Sign out from AWS Cognito
      await signOut()
      
      // Clear local auth state
      logout()
      
      toast.success('Signed out successfully')
      router.push('/login')
    } catch (error) {
      console.error('Error signing out:', error)
      toast.error('Failed to sign out')
    }
  }

  const navigation = [
    { name: 'Dashboard', href: '/', icon: '📊' },
    ...(isAdmin ? [{ name: 'Admin', href: '/admin', icon: '⚙️' }] : []),
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex">
              {/* Logo */}
              <div className="flex flex-shrink-0 items-center">
                <span className="text-xl font-bold text-blue-600">Workstation Manager</span>
              </div>
              {/* Navigation Links */}
              <div className="hidden sm:ml-8 sm:flex sm:space-x-8">
                {navigation.map((item) => {
                  const isActive = router.pathname === item.href ||
                    (item.href === '/admin' && router.pathname.startsWith('/admin'))
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium transition-colors ${
                        isActive
                          ? 'border-blue-500 text-gray-900'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      }`}
                    >
                      <span className="mr-1.5">{item.icon}</span>
                      {item.name}
                    </Link>
                  )
                })}
              </div>
            </div>
            {/* User Menu */}
            <div className="flex items-center">
              <div className="flex items-center space-x-3">
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-900">{user?.name || user?.email}</div>
                  {user?.name && <div className="text-xs text-gray-500">{user.email}</div>}
                </div>
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>

      {/* Floating Feedback Button */}
      <button
        onClick={() => {
          trackClick('feedback', 'open_modal', 'floating_button');
          setShowFeedbackModal(true);
        }}
        className="fixed bottom-6 right-6 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-lg transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 z-40"
        title="Send Feedback"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
        </svg>
      </button>

      {/* Feedback Modal */}
      <FeedbackModal
        isOpen={showFeedbackModal}
        onClose={() => setShowFeedbackModal(false)}
      />
    </div>
  )
}