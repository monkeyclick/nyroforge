import { useState, FormEvent } from 'react'
import { useRouter } from 'next/router'
import { useAuthStore, SYSTEM_ROLES } from '@/stores/authStore'
import { signIn, confirmSignIn, fetchAuthSession, signOut, getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth'
import { Permission } from '@/types/auth'
import ThemeToggle from '@/components/ThemeToggle'

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

  // Set when Cognito requires the user to replace their temporary password.
  // given_name/family_name are required pool attributes and are collected here
  // because the challenge response must carry any that are still unset.
  const [needsNewPassword, setNeedsNewPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  // Builds the session user object from Cognito and routes to the dashboard.
  // Everything here comes from the ID token and user attributes — no backend
  // calls, so a regular (non-admin) user logs in without any 403 noise.
  const completeLogin = async () => {
    const session = await fetchAuthSession()
    const idToken = session.tokens?.idToken?.toString()

    if (!idToken) {
      throw new Error('Failed to get authentication token')
    }

    const cognitoUser = await getCurrentUser()
    const userAttributes = await fetchUserAttributes()

    const idTokenPayload = session.tokens?.idToken?.payload
    const cognitoGroups = (idTokenPayload?.['cognito:groups'] as string[]) || []

    // Determine role based on Cognito groups
    let roleIds = ['user']
    if (cognitoGroups.includes('workstation-admin') || cognitoGroups.includes('Admins') || cognitoGroups.includes('admins') || cognitoGroups.includes('admin')) {
      roleIds = ['admin']
    } else if (cognitoGroups.includes('SuperAdmins') || cognitoGroups.includes('super-admin')) {
      roleIds = ['super-admin']
    }

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

    const userRoles = roleIds.map((roleId: string) => ({
      id: roleId,
      name: roleId.charAt(0).toUpperCase() + roleId.slice(1),
      description: `Default ${roleId} role`,
      permissions: getDefaultPermissionsForRole(roleId),
      isSystem: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'system',
    }))

    login(userData, userRoles, [])
    router.push('/')
  }

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

      const step = signInResult.nextStep?.signInStep

      // Admin-created accounts start with a temporary password — Cognito asks
      // the user to set their own before completing sign-in.
      if (step === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setNeedsNewPassword(true)
        return
      }

      if (step && step !== 'DONE') {
        if (step.startsWith('CONFIRM_SIGN_IN_WITH') && step.includes('MFA')) {
          throw new Error('This account has MFA enabled, which is not supported by this app yet. Contact your administrator.')
        }
        if (step === 'RESET_PASSWORD') {
          throw new Error('Your password must be reset. Contact your administrator to set a new password.')
        }
        if (step === 'CONFIRM_SIGN_UP') {
          throw new Error('This account has not been confirmed yet. Contact your administrator.')
        }
        throw new Error(`Sign-in requires an additional step (${step}) that this app does not support. Contact your administrator.`)
      }

      if (signInResult.isSignedIn || step === 'DONE') {
        await completeLogin()
      } else {
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
      } else if (error.name === 'PasswordResetRequiredException') {
        setError('Your password must be reset. Contact your administrator.')
      } else if (error.name === 'LimitExceededException' || error.name === 'TooManyRequestsException') {
        setError('Too many attempts. Please wait a few minutes and try again.')
      } else if (error.message) {
        setError(error.message)
      } else {
        setError('Failed to sign in. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleNewPasswordSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match.')
      return
    }
    // Matches the user pool policy (minLength 12, all four character classes).
    // This used to allow 8, so a compliant-looking password was rejected by
    // Cognito instead of by the form.
    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters long.')
      return
    }
    if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) ||
        !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      setError('Password must include uppercase, lowercase, a number, and a symbol.')
      return
    }

    setIsLoading(true)
    try {
      // given_name and family_name are required attributes on the pool. When an
      // admin-created user is missing them, Cognito rejects the challenge
      // response unless they are supplied here — which left affected users
      // unable to complete first login at all. Sending them is harmless when
      // they are already set.
      const result = await confirmSignIn({
        challengeResponse: newPassword,
        options: {
          userAttributes: {
            given_name: firstName.trim() || email.split('@')[0],
            family_name: lastName.trim() || 'User',
          },
        },
      })

      if (result.isSignedIn) {
        await completeLogin()
      } else {
        throw new Error(`Could not complete sign-in (next step: ${result.nextStep?.signInStep}). Contact your administrator.`)
      }
    } catch (error: any) {
      console.error('New password error:', error)
      if (error.name === 'InvalidPasswordException') {
        setError(`Password does not meet requirements: ${error.message}`)
      } else if (error.name === 'NotAuthorizedException') {
        // Challenge session expired — start over
        setNeedsNewPassword(false)
        setNewPassword('')
        setConfirmNewPassword('')
        setError('Your session expired. Please sign in again with your temporary password.')
      } else {
        setError(error.message || 'Failed to set new password. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  if (needsNewPassword) {
    return (
      <div className="studio-shell auth-stage">
        <div className="absolute right-5 top-5"><ThemeToggle /></div>
        <div className="login-card">
          <div className="flex justify-center mb-6">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600">
              <span className="text-3xl">🔑</span>
            </div>
          </div>
          <h2 className="text-center text-2xl font-bold mb-2 text-gray-900">
            Set Your Password
          </h2>
          <p className="text-center text-gray-600 mb-8">
            Your account was created with a temporary password. Confirm your name
            and choose a new password to continue.
          </p>

          <form onSubmit={handleNewPasswordSubmit}>
            <div className="form-group">
              <label htmlFor="first-name">First Name</label>
              <input
                id="first-name"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="last-name">Last Name</label>
              <input
                id="last-name"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="new-password">New Password</label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirm-new-password">Confirm New Password</label>
              <input
                id="confirm-new-password"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                autoComplete="new-password"
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
                  Setting password...
                </>
              ) : (
                'Set Password & Sign In'
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

  return (
    <div className="studio-shell auth-stage">
      <div className="absolute right-5 top-5"><ThemeToggle /></div>
      <div className="login-card">
        <div className="flex justify-center mb-6">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600">
            <span className="text-2xl font-black text-white">N</span>
          </div>
        </div>
        <h2 className="text-center text-2xl font-bold mb-2 text-gray-900">
          Welcome back to NyroForge
        </h2>
        <p className="text-center text-gray-600 mb-8">
          Your creative workstations are ready when you are.
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
