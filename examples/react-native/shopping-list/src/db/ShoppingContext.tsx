import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import NetInfo from '@react-native-community/netinfo'
import {
  hydrateSimulatedOffline,
  isSimulatedOffline,
  setSimulatedOffline,
  subscribeSimulatedOffline,
} from '../network/simulatedOffline'
import {
  clearLocalState as clearCollectionsLocalState,
  createItemActions,
  createListActions,
  createOfflineExecutor,
} from './collections'

type OfflineExecutor = ReturnType<typeof createOfflineExecutor>

interface ShoppingContextValue {
  offline: OfflineExecutor | null
  listActions: ReturnType<typeof createListActions>
  itemActions: ReturnType<typeof createItemActions>
  isNetworkOnline: boolean
  isSimulatedOffline: boolean
  isOnline: boolean
  setSimulateOffline: (enabled: boolean) => Promise<void>
  clearLocalState: () => Promise<void>
  pendingCount: number
  isInitialized: boolean
  initError: string | null
}

const ShoppingContext = createContext<ShoppingContextValue | null>(null)

export function ShoppingProvider({ children }: { children: React.ReactNode }) {
  const [offline, setOffline] = useState<OfflineExecutor | null>(null)
  const [isNetworkOnline, setIsNetworkOnline] = useState(true)
  const [isSimulatedOfflineState, setIsSimulatedOfflineState] = useState(
    isSimulatedOffline(),
  )
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
    void hydrateSimulatedOffline().catch((err) => {
      console.warn(`[Shopping] Failed to hydrate simulated offline state`, err)
    })
    return subscribeSimulatedOffline(() => {
      setIsSimulatedOfflineState(isSimulatedOffline())
    })
  }, [])

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected =
        state.isConnected === true && state.isInternetReachable !== false
      setIsNetworkOnline(connected)
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
  const setSimulateOffline = useCallback((enabled: boolean) => {
    return setSimulatedOffline(enabled)
  }, [])
  const clearLocalState = useCallback(async () => {
    await setSimulatedOffline(false)
    await clearCollectionsLocalState(offline)
  }, [offline])
  const isOnline = isNetworkOnline && !isSimulatedOfflineState

  const value = useMemo(
    () => ({
      offline,
      listActions,
      itemActions,
      isNetworkOnline,
      isSimulatedOffline: isSimulatedOfflineState,
      isOnline,
      setSimulateOffline,
      clearLocalState,
      pendingCount,
      isInitialized,
      initError,
    }),
    [
      offline,
      listActions,
      itemActions,
      isNetworkOnline,
      isSimulatedOfflineState,
      isOnline,
      setSimulateOffline,
      clearLocalState,
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
