import { ReactNode } from 'react'
import ThemeToggle from '@/components/ThemeToggle'

interface AuthLayoutProps {
  children: ReactNode
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="studio-shell auth-stage flex-col py-12 sm:px-6 lg:px-8">
      <div className="absolute right-5 top-5"><ThemeToggle /></div>
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-center text-3xl font-bold tracking-tight text-violet-600">
          NyroForge
        </h1>
        <p className="mt-2 text-center text-sm text-gray-500">Creative compute for ambitious teams</p>
      </div>
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="login-card px-4 py-8 sm:px-10">
          {children}
        </div>
      </div>
    </div>
  )
}
