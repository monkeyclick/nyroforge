import Link from 'next/link'
import AuthLayout from '@/layouts/AuthLayout'

export default function SignupPage() {
  return (
    <AuthLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-center text-2xl font-bold text-gray-900">
            Account Registration
          </h2>
        </div>

        <div className="rounded-md bg-yellow-50 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">
                Self-Registration Disabled
              </h3>
              <div className="mt-2 text-sm text-yellow-700">
                <p>
                  For security reasons, self-registration is not available. Please contact your system administrator to request an account.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-900 mb-2">
            To get access:
          </h3>
          <ol className="list-decimal list-inside text-sm text-gray-600 space-y-1">
            <li>Contact your system administrator</li>
            <li>Provide your name and email address</li>
            <li>Wait for an invitation email with login credentials</li>
            <li>Sign in and change your temporary password</li>
          </ol>
        </div>

        <div className="text-center text-sm">
          <Link href="/login" className="font-medium text-blue-600 hover:text-blue-500">
            Already have an account? Sign in
          </Link>
        </div>

      </div>
    </AuthLayout>
  )
}
