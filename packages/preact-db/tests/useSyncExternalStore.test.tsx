import { render } from 'preact'
import { act } from 'preact/test-utils'
import { describe, expect, it } from 'vitest'
import {
  useSyncExternalStore,
  useSyncExternalStoreWithSelector,
} from '../src/useSyncExternalStore'

type Snapshot = {
  count: number
}

class NumberStore {
  private snapshot: Snapshot
  private listeners = new Set<() => void>()

  constructor(initialCount: number) {
    this.snapshot = { count: initialCount }
  }

  subscribe = (onStoreChange: () => void) => {
    this.listeners.add(onStoreChange)
    return () => {
      this.listeners.delete(onStoreChange)
    }
  }

  getSnapshot = () => this.snapshot

  setCount(nextCount: number) {
    this.snapshot = { count: nextCount }
    for (const listener of this.listeners) {
      listener()
    }
  }
}

describe(`useSyncExternalStore`, () => {
  it(`updates when the external store changes`, () => {
    const store = new NumberStore(1)
    const root = document.createElement(`div`)
    document.body.append(root)

    function Counter() {
      const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
      return <div>{snapshot.count}</div>
    }

    act(() => {
      render(<Counter />, root)
    })

    expect(root.textContent).toBe(`1`)

    act(() => {
      store.setCount(2)
    })

    expect(root.textContent).toBe(`2`)

    act(() => {
      render(null, root)
    })
  })

  it(`avoids re-render when selected value is equal`, () => {
    const store = new NumberStore(1)
    const root = document.createElement(`div`)
    document.body.append(root)
    let renderCount = 0

    function ParityCounter() {
      renderCount += 1

      const parity = useSyncExternalStoreWithSelector(
        store.subscribe,
        store.getSnapshot,
        (snapshot) => snapshot.count % 2,
      )

      return <div>{parity}</div>
    }

    act(() => {
      render(<ParityCounter />, root)
    })

    expect(root.textContent).toBe(`1`)
    expect(renderCount).toBe(1)

    act(() => {
      store.setCount(3)
    })

    expect(root.textContent).toBe(`1`)
    expect(renderCount).toBe(1)

    act(() => {
      store.setCount(4)
    })

    expect(root.textContent).toBe(`0`)
    expect(renderCount).toBe(2)

    act(() => {
      render(null, root)
    })
  })
})
