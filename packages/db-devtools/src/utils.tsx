import { createSignal, onMount } from 'solid-js'
import type { Accessor } from 'solid-js'

export function useIsMounted(): Accessor<boolean> {
  const [isMounted, setIsMounted] = createSignal(false)
  
  onMount(() => {
    setIsMounted(true)
  })
  
  return isMounted
}

export function multiSortBy<T>(
  items: T[],
  sorters: ((item: T) => any)[],
): T[] {
  return [...items].sort((a, b) => {
    for (let i = 0; i < sorters.length; i++) {
      const sorter = sorters[i]
      if (!sorter) continue
      
      const aVal = sorter(a)
      const bVal = sorter(b)
      
      if (aVal < bVal) return -1
      if (aVal > bVal) return 1
  }
    return 0
  })
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'active':
    case 'success':
      return 'green'
    case 'error':
    case 'failed':
      return 'red'
    case 'pending':
    case 'loading':
      return 'yellow'
    case 'idle':
    default:
      return 'gray'
  }
}

export function displayValue(value: any, space?: number): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
}

  if (value === null) {
    return 'null'
  }
  
  if (value === undefined) {
    return 'undefined'
  }
  
  if (typeof value === 'object') {
    return JSON.stringify(value, null, space)
  }
  
  return String(value)
    }

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + '...'
}

export function isObject(value: any): value is object {
  return value !== null && typeof value === 'object'
}

export function isArray(value: any): value is any[] {
  return Array.isArray(value)
}

export function getKeys(obj: any): string[] {
  if (!isObject(obj)) return []
  return Object.keys(obj)
}

export function sortBy<T>(
  items: T[],
  sorter: (item: T) => any,
): T[] {
  return [...items].sort((a, b) => {
    const aVal = sorter(a)
    const bVal = sorter(b)
    
    if (aVal < bVal) return -1
    if (aVal > bVal) return 1
    return 0
  })
}