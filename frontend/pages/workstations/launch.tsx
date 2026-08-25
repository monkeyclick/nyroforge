import { useRouter } from 'next/router'
import { useQueryClient } from '@tanstack/react-query'
import { signOut } from 'aws-amplify/auth'
import { useAuthStore } from '@/stores/authStore'
import { useActivityStore } from '@/stores/activityStore'
import { analyticsService } from '@/services/analytics'
import AppShell from '@/layouts/AppShell'
import { LaunchWizard } from '@/components/workstation/launch/LaunchWizard'

export default function LaunchWorkstationPage() {
  const router = useRouter()
  const { user, logout, isAdmin } = useAuthStore()
  const queryClient = useQueryClient()
  const { addActivity } = useActivityStore()

  if (!user) {
    router.push('/login')
    return null
  }

  const handleCancel = () => {
    router.push('/')
  }

  const handleLaunched = () => {
    addActivity({
      title: 'Workstation launch accepted',
      description: 'Your new creative workstation is being provisioned.',
      status: 'succeeded',
      category: 'workstation',
    })
    analyticsService.trackWorkstationAction('launch')
    queryClient.invalidateQueries({ queryKey: ['workstations'] })
    router.push('/')
  }

  const handleSignOut = async () => {
    await signOut()
    logout()
    router.push('/login')
  }

  return (
    <AppShell title="Launch Workstation" isAdmin={isAdmin} onSignOut={handleSignOut}>
      <div className="max-w-5xl mx-auto px-6 py-10">
        <LaunchWizard onCancel={handleCancel} onLaunched={handleLaunched} />
      </div>
    </AppShell>
  )
}
