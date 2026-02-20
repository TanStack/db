import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

type InternalStore<TSnapshot> = {
  _value: TSnapshot
  _getSnapshot: () => TSnapshot
}

type StoreRef<TSnapshot> = {
  _instance: InternalStore<TSnapshot>
}

/**
 * Lightweight Preact-native useSyncExternalStore implementation.
 * Avoids importing preact/compat and keeps behavior close to React's shim.
 */
export function useSyncExternalStore<TSnapshot>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => TSnapshot,
): TSnapshot {
  const value = getSnapshot()

  const [{ _instance }, forceUpdate] = useState<StoreRef<TSnapshot>>({
    _instance: { _value: value, _getSnapshot: getSnapshot },
  })

  useLayoutEffect(() => {
    _instance._value = value
    _instance._getSnapshot = getSnapshot

    if (didSnapshotChange(_instance)) {
      forceUpdate({ _instance })
    }
  }, [subscribe, value, getSnapshot])

  useEffect(() => {
    if (didSnapshotChange(_instance)) {
      forceUpdate({ _instance })
    }

    return subscribe(() => {
      if (didSnapshotChange(_instance)) {
        forceUpdate({ _instance })
      }
    })
  }, [subscribe])

  return value
}

function didSnapshotChange<TSnapshot>(inst: {
  _getSnapshot: () => TSnapshot
  _value: TSnapshot
}): boolean {
  const latestGetSnapshot = inst._getSnapshot
  const prevValue = inst._value

  try {
    const nextValue = latestGetSnapshot()
    return !Object.is(prevValue, nextValue)
  } catch {
    return true
  }
}

export function useSyncExternalStoreWithSelector<TSnapshot, TSelected>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => TSnapshot,
  selector: (snapshot: TSnapshot) => TSelected,
  isEqual: (a: TSelected, b: TSelected) => boolean = Object.is,
): TSelected {
  const selectedSnapshotRef = useRef<TSelected>()

  const getSelectedSnapshot = () => {
    const snapshot = getSnapshot()
    const selected = selector(snapshot)

    if (
      selectedSnapshotRef.current === undefined ||
      !isEqual(selectedSnapshotRef.current, selected)
    ) {
      selectedSnapshotRef.current = selected
    }

    return selectedSnapshotRef.current
  }

  return useSyncExternalStore(subscribe, getSelectedSnapshot)
}
