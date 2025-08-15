import { createEffect, createSignal } from "solid-js"
import type { Accessor, Setter } from "solid-js"

export function useLocalStorage<T>(
  key: string,
  defaultValue?: T
): [Accessor<T>, Setter<T>] {
  // Initialize with default value or try to get from localStorage
  const getInitialValue = (): T => {
    if (typeof window === `undefined`) {
      return defaultValue as T
    }

    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : (defaultValue as T)
    } catch {
      return defaultValue as T
    }
  }

  const [value, setValue] = createSignal<T>(getInitialValue())

  // Update localStorage when value changes
  createEffect(() => {
    if (typeof window === `undefined`) return

    try {
      const currentValue = value()
      if (currentValue === undefined) {
        window.localStorage.removeItem(key)
      } else {
        window.localStorage.setItem(key, JSON.stringify(currentValue))
      }
    } catch {}
  })

  return [value, setValue]
}

export default useLocalStorage
