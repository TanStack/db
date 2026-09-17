import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = `shopping-list:simulate-offline`

let forcedOffline = false
const listeners = new Set<() => void>()

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

export function isSimulatedOffline(): boolean {
  return forcedOffline
}

export async function hydrateSimulatedOffline(): Promise<void> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY)
  forcedOffline = stored === `true`
  notifyListeners()
}

export async function setSimulatedOffline(value: boolean): Promise<void> {
  forcedOffline = value
  await AsyncStorage.setItem(STORAGE_KEY, value ? `true` : `false`)
  notifyListeners()
}

export function subscribeSimulatedOffline(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function createOfflineAwareFetch(baseFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isSimulatedOffline()) {
      throw new TypeError(`Network request blocked by simulated offline mode`)
    }
    return baseFetch(input, init)
  }
}
