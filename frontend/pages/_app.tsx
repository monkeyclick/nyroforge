import type { AppProps } from 'next/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuthStore } from '@/stores/authStore'
import { Amplify } from 'aws-amplify'
import ErrorBoundary from '@/components/ErrorBoundary'
import '@/styles/globals.css'

// Configure Amplify
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID!,
      userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!,
      loginWith: {
        email: true,
      },
    },
  },
})

// Public routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/signup', '/auth/callback']

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuthStore()
  const [isHydrated, setIsHydrated] = useState(false)
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 5 * 60 * 1000, // 5 minutes
      },
    },
  }))

  // Wait for hydration from localStorage
  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // Handle authentication routing
  useEffect(() => {
    if (!isHydrated || isLoading) return

    const isPublicRoute = PUBLIC_ROUTES.includes(router.pathname)

    if (!isAuthenticated && !isPublicRoute) {
      // Redirect to login if not authenticated
      router.push('/login')
    } else if (isAuthenticated && isPublicRoute) {
      // Redirect to dashboard if already authenticated
      router.push('/')
    }
  }, [isAuthenticated, isLoading, isHydrated, router])

  // Show loading state while hydrating
  if (!isHydrated || isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Component {...pageProps} />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#363636',
              color: '#fff',
            },
            success: {
              duration: 3000,
              iconTheme: {
                primary: '#10b981',
                secondary: '#fff',
              },
            },
            error: {
              duration: 4000,
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}