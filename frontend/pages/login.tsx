import { useState, FormEvent } from 'react'
import { useRouter } from 'next/router'
import { useAuthStore, SYSTEM_ROLES } from '@/stores/authStore'
import { signIn, fetchAuthSession, signOut, getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth'
import { apiClient } from '@/services/api'
import { Permission } from '@/types/auth'

// Helper function to get default permissions for a role
function getDefaultPermissionsForRole(roleId: string): Permission[] {
  return SYSTEM_ROLES[roleId] || SYSTEM_ROLES['user'] || []
}

export default function LoginPage() {
  const router = useRouter()
  const { login } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      // Check if there's already a signed-in user and sign them out first
      try {
        await getCurrentUser()
        await signOut()
      } catch (err) {
        // No existing session, continue with sign-in
      }

      // Sign in with AWS Cognito
      const signInResult = await signIn({
        username: email,
        password: password,
      })

      // Check if additional steps are required (MFA, new password, etc.)
      if (signInResult.nextStep) {
        
        // DONE means authentication is complete, proceed with login
        if (signInResult.nextStep.signInStep !== 'DONE') {
          throw new Error(`Additional step required: ${signInResult.nextStep.signInStep}. Please disable MFA in AWS Console: Cognito > User Pools > MediaWorkstationUsers > General Settings > MFA`)
        }
      }

      // Proceed if signed in or if nextStep is DONE
      if (signInResult.isSignedIn || signInResult.nextStep?.signInStep === 'DONE') {
        // Get the authentication session and token
        const session = await fetchAuthSession()
        
        const idToken = session.tokens?.idToken?.toString()

        if (!idToken) {
          throw new Error('Failed to get authentication token')
        }

        // Get current user and attributes
        const cognitoUser = await getCurrentUser()
        const userAttributes = await fetchUserAttributes()
        
        // Check for Cognito groups from the ID token payload
        const idTokenPayload = session.tokens?.idToken?.payload
        const cognitoGroups = (idTokenPayload?.['cognito:groups'] as string[]) || []
        
        // Determine role based on Cognito groups
        let roleIds = ['user']
        if (cognitoGroups.includes('Admins') || cognitoGroups.includes('admins') || cognitoGroups.includes('admin') || cognitoGroups.includes('workstation-admin')) {
          roleIds = ['admin']
        } else if (cognitoGroups.includes('SuperAdmins') || cognitoGroups.includes('super-admin')) {
          roleIds = ['super-admin']
        }
        // Create user object from Cognito attributes
        const userData: any = {
          id: cognitoUser.userId,
          email: userAttributes.email || '',
          name: `${userAttributes.given_name || ''} ${userAttributes.family_name || ''}`.trim() || userAttributes.email || '',
          status: 'active' as const,
          roleIds: roleIds,
          groupIds: cognitoGroups,
          directPermissions: [] as any[],
          attributes: {},
          preferences: {},
          loginHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        
        // Try to fetch backend data, but continue even if it fails
        try {
          const backendUser = await apiClient.getCurrentUser()
          // Merge backend data if available
          Object.assign(userData, backendUser)
        } catch (error: any) {
          console.warn('Could not fetch backend user data, using Cognito attributes:', error.message)
        }
        
        // Try to fetch roles and groups, but use defaults if it fails
        let userRoles: any[] = []
        let userGroups: any[] = []
        
        try {
          const [rolesResponse, groupsResponse] = await Promise.all([
            apiClient.getRoles().catch(() => ({ roles: [] })),
            apiClient.getGroups().catch(() => ({ groups: [] })),
          ])

          userRoles = rolesResponse.roles.filter(role =>
            userData.roleIds?.includes(role.id)
          )
          userGroups = groupsResponse.groups.filter(group =>
            userData.groupIds?.includes(group.id)
          )
          
        } catch (error) {
          console.warn('Could not fetch roles/groups, using defaults')
        }
        
        // If no roles were found from backend, create default role objects
        // This ensures permissions are properly calculated even in local dev
        if (userRoles.length === 0 && userData.roleIds?.length > 0) {
          userRoles = userData.roleIds.map((roleId: string) => ({
            id: roleId,
            name: roleId.charAt(0).toUpperCase() + roleId.slice(1),
            description: `Default ${roleId} role`,
            permissions: getDefaultPermissionsForRole(roleId),
            isSystem: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: 'system',
          }))
        }

        // Update auth store
        login(userData, userRoles, userGroups)

        // Redirect to dashboard (home page)
        router.push('/')
      } else {
        console.error('Sign-in was not successful')
        throw new Error('Sign in was not successful')
      }
    } catch (error: any) {
      console.error('Login error:', error)
      
      // Handle specific Cognito error codes
      if (error.name === 'UserNotFoundException') {
        setError('User not found. Please check your email.')
      } else if (error.name === 'NotAuthorizedException') {
        setError('Incorrect email or password.')
      } else if (error.name === 'UserNotConfirmedException') {
        setError('Please verify your email before signing in.')
      } else if (error.message) {
        setError(error.message)
      } else {
        setError('Failed to sign in. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '1rem' }}>
      <div className="login-card">
        <div className="flex justify-center mb-6">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600">
            <span className="text-3xl">🖥️</span>
          </div>
        </div>
        <h2 className="text-center text-2xl font-bold mb-2 text-gray-900">
          Welcome Back
        </h2>
        <p className="text-center text-gray-600 mb-8">
          Sign in to manage your workstations
        </p>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button 
            type="submit" 
            className="btn-primary w-full flex items-center justify-center"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="loading-spinner mr-2"></span>
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>

          {error && (
            <div className="alert-error mt-4">
              {error}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}