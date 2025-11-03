import { useState } from 'react'
import { useUser } from '@/lib/user-context'
import { cn } from '@/lib/utils'

export function WelcomeModal() {
  const { setUsername, showWelcome } = useUser()
  const [name, setName] = useState('')

  if (!showWelcome) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      setUsername(name.trim())
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold mb-2">Welcome to LinearLarge!</h2>
        <p className="text-gray-600 mb-6">
          This is a demo issue tracker powered by TanStack DB. What should we call you?
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            autoFocus
            className={cn(
              'w-full px-4 py-3 border border-gray-300 rounded-lg mb-4',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
            )}
          />

          <button
            type="submit"
            disabled={!name.trim()}
            className={cn(
              'w-full px-4 py-3 bg-blue-500 text-white rounded-lg font-medium',
              'hover:bg-blue-600 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            Get Started
          </button>
        </form>

        <p className="text-xs text-gray-500 mt-4 text-center">
          Your identity is stored locally in your browser
        </p>
      </div>
    </div>
  )
}
