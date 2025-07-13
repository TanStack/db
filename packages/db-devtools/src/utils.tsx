import { tokens } from './theme'

export const convertRemToPixels = (rem: number) => {
  return rem * parseFloat(getComputedStyle(document.documentElement).fontSize)
}

export const displayValue = (value: any, truncate: boolean = false) => {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') {
    return truncate && value.length > 100 ? value.substring(0, 100) + '...' : value
  }
  if (typeof value === 'number') return value.toString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return truncate && value.length > 10 ? `Array(${value.length})` : JSON.stringify(value)
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    return truncate && keys.length > 5 ? `Object(${keys.length})` : JSON.stringify(value)
  }
  return String(value)
}

export const getStatusColor = (status: string): 'green' | 'yellow' | 'red' | 'gray' | 'blue' | 'purple' => {
  switch (status) {
    case 'ready':
      return 'green'
    case 'loading':
      return 'yellow'
    case 'error':
      return 'red'
    case 'idle':
      return 'gray'
    case 'pending':
      return 'blue'
    default:
      return 'gray'
  }
}

export const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'loading':
      return 'Loading'
    case 'error':
      return 'Error'
    case 'idle':
      return 'Idle'
    case 'pending':
      return 'Pending'
    default:
      return 'Unknown'
  }
}

export const getSidedProp = (
  position: 'top' | 'bottom' | 'left' | 'right',
  side: 'top' | 'right' | 'bottom' | 'left',
  value: string | number
): string => {
  return position === side ? String(value) : '0'
}

export const sortFns = {
  'Status > Last Updated': (a: any, b: any) => {
    if (a.status === b.status) {
      return (b.updatedAt || 0) - (a.updatedAt || 0)
    }
    const statusOrder = ['error', 'loading', 'ready', 'idle']
    return statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
  },
  'Last Updated': (a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0),
  'Created': (a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0),
}

export const mutationSortFns = {
  'Status > Last Updated': (a: any, b: any) => {
    if (a.state === b.state) {
      return (b.updatedAt || 0) - (a.updatedAt || 0)
    }
    const stateOrder = ['error', 'loading', 'success', 'idle']
    return stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state)
  },
  'Last Updated': (a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0),
  'Created': (a: any, b: any) => (b.submittedAt || 0) - (a.submittedAt || 0),
}

export const formatTime = (date: Date) => {
  return date.toLocaleTimeString()
}

export const formatDate = (date: Date) => {
  return date.toLocaleDateString()
}

export const formatDateTime = (date: Date) => {
  return date.toLocaleString()
}

export const formatDuration = (ms: number) => {
  if (ms < 1000) {
    return `${ms}ms`
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  return `${(ms / 60000).toFixed(1)}m`
}

export const copyToClipboard = (text: string) => {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
  } else {
    const textArea = document.createElement('textarea')
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
  }
}

export const getCollectionStatusColor = (status: string) => {
  const { colors } = tokens
  switch (status) {
    case 'ready':
      return colors.green[500]
    case 'loading':
      return colors.yellow[500]
    case 'error':
      return colors.red[500]
    case 'cleaned-up':
      return colors.gray[500]
    default:
      return colors.gray[500]
  }
}

export const getTransactionStatusColor = (state: string) => {
  const { colors } = tokens
  switch (state) {
    case 'pending':
      return colors.blue[500]
    case 'success':
      return colors.green[500]
    case 'error':
      return colors.red[500]
    case 'idle':
      return colors.gray[500]
    default:
      return colors.gray[500]
  }
}