import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'

interface User {
  id: string
  username: string
}

interface UserContextValue {
  user: User | null
  setUsername: (username: string) => void
  showWelcome: boolean
}

const UserContext = createContext<UserContextValue | null>(null)

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [showWelcome, setShowWelcome] = useState(false)
  const navigate = useNavigate()
  const search = useSearch({ from: '__root__' })

  useEffect(() => {
    const userId = (search as any)?.userId as string | undefined
    const username = (search as any)?.username as string | undefined

    if (!userId) {
      // Generate new user ID and show welcome modal
      const newUserId = crypto.randomUUID()
      setUser({ id: newUserId, username: '' })
      setShowWelcome(true)
    } else if (!username) {
      // Has userId but no username, show welcome modal
      setUser({ id: userId, username: '' })
      setShowWelcome(true)
    } else {
      // Has both, all good
      setUser({ id: userId, username })
      setShowWelcome(false)
    }
  }, [search])

  const setUsername = useCallback(
    (newUsername: string) => {
      if (!user) return
      const trimmed = newUsername.trim()
      if (!trimmed) return

      setUser({ ...user, username: trimmed })
      setShowWelcome(false)

      // Update URL with both userId and username
      navigate({
        search: (prev) => ({
          ...prev,
          userId: user.id,
          username: trimmed,
        }),
        replace: true,
      })
    },
    [user, navigate]
  )

  return (
    <UserContext.Provider value={{ user, setUsername, showWelcome }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const context = useContext(UserContext)
  if (!context) {
    throw new Error('useUser must be used within UserProvider')
  }
  return context
}
