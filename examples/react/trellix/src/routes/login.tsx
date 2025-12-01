import { useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { authClient } from "@/lib/auth-client"

export const Route = createFileRoute(`/login`)({
  component: LoginPage,
  ssr: false,
})

function LoginPage() {
  const [email, setEmail] = useState(``)
  const [password, setPassword] = useState(``)
  const [isLoading, setIsLoading] = useState(false)
  const [currentError, setError] = useState(``)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(``)

    try {
      let { data, error } = await authClient.signUp.email(
        {
          email,
          password,
          name: email,
        },
        {
          onSuccess: () => {
            window.location.href = `/`
          },
        }
      )

      if (error?.code === `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`) {
        const result = await authClient.signIn.email(
          {
            email,
            password,
          },
          {
            onSuccess: async () => {
              window.location.href = `/`
            },
          }
        )

        data = result.data
        error = result.error
      }

      if (error) {
        setError(JSON.stringify(error, null, 4))
      }
    } catch {
      setError(`An unexpected error occurred`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700">
        <nav className="container mx-auto px-6 py-4">
          <Link to="/" className="text-2xl font-bold text-white">
            Trellix
          </Link>
        </nav>
      </header>

      {/* Login Form */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="text-center text-3xl font-bold text-white">
              Sign in to Trellix
            </h2>
            <div className="mt-4 p-4 bg-blue-900/50 border border-blue-700 rounded-md">
              <p className="text-sm text-blue-200">
                <strong>Development Mode:</strong> Any email/password combination
                will work for testing. New accounts are automatically created.
              </p>
            </div>
          </div>
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="rounded-md shadow-sm space-y-4">
              <div>
                <label htmlFor="email" className="sr-only">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Email address"
                />
              </div>
              <div>
                <label htmlFor="password" className="sr-only">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Password"
                />
              </div>
            </div>

            {currentError && (
              <div className="rounded-md bg-red-900/50 border border-red-700 p-4">
                <div className="text-sm text-red-200">{currentError}</div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? `Signing in...` : `Sign in`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
