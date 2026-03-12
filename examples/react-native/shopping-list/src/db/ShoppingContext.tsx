import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import NetInfo from '@react-native-community/netinfo'
import {
  createOfflineExecutor,
  createListActions,
  createItemActions,
} from './collections'

type OfflineExecutor = ReturnType<typeof createOfflineExecutor>

interface ShoppingContextValue {
  offline: OfflineExecutor | null
  listActions: ReturnType<typeof createListActions>
  itemActions: ReturnType<typeof createItemActions>
  isOnline: boolean
  pendingCount: number
  isInitialized: boolean
  initError: string | null
}

const ShoppingContext = createContext<ShoppingContextValue | null>(null)

export function ShoppingProvider({ children }: { children: React.ReactNode }) {
  const [offline, setOffline] = useState<OfflineExecutor | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [isInitialized, setIsInitialized] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  // Initialize offline executor
  useEffect(() => {
    try {
      const executor = createOfflineExecutor()
      setOffline(executor)
      setIsInitialized(true)
      return () => {
        executor.dispose()
      }
    } catch (err) {
      console.error(`[Shopping] Failed to create executor:`, err)
      setInitError(err instanceof Error ? err.message : `Failed to initialize`)
      setIsInitialized(true)
    }
  }, [])

  // Monitor network status (for UI display only —
  // ReactNativeOnlineDetector in the executor handles retry automatically)
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected =
        state.isConnected === true && state.isInternetReachable !== false
      setIsOnline(connected)
    })
    return () => unsubscribe()
  }, [])

  // Monitor pending transactions
  useEffect(() => {
    if (!offline) return
    const interval = setInterval(() => {
      setPendingCount(offline.getPendingCount())
    }, 100)
    return () => clearInterval(interval)
  }, [offline])

  const listActions = useMemo(() => createListActions(offline), [offline])
  const itemActions = useMemo(() => createItemActions(offline), [offline])

  const value = useMemo(
    () => ({
      offline,
      listActions,
      itemActions,
      isOnline,
      pendingCount,
      isInitialized,
      initError,
    }),
    [
      offline,
      listActions,
      itemActions,
      isOnline,
      pendingCount,
      isInitialized,
      initError,
    ],
  )

  return (
    <ShoppingContext.Provider value={value}>
      {children}
    </ShoppingContext.Provider>
  )
}

export function useShopping(): ShoppingContextValue {
  const ctx = useContext(ShoppingContext)
  if (!ctx) {
    throw new Error(`useShopping must be used within ShoppingProvider`)
  }
  return ctx
}
