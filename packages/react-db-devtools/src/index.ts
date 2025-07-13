'use client'

import * as React from 'react'

function DevtoolsWrapper(props: any) {
  const [isClient, setIsClient] = React.useState(false)
  const [DevtoolsComponent, setDevtoolsComponent] = React.useState<React.ComponentType<any> | null>(null)

  React.useEffect(() => {
    // Only run on client after hydration
    setIsClient(true)
    
    // Dynamically import the devtools component
    import('./ReactDbDevtools').then((module) => {
      setDevtoolsComponent(() => module.TanStackReactDbDevtools)
    })
  }, [])

  // Always render null during SSR and initial client render to prevent hydration mismatch
  if (!isClient || !DevtoolsComponent) {
    return null
  }

  return React.createElement(DevtoolsComponent, props)
}

function DevtoolsPanelWrapper(props: any) {
  const [isClient, setIsClient] = React.useState(false)
  const [DevtoolsComponent, setDevtoolsComponent] = React.useState<React.ComponentType<any> | null>(null)

  React.useEffect(() => {
    setIsClient(true)
    
    import('./ReactDbDevtools').then((module) => {
      setDevtoolsComponent(() => module.TanStackReactDbDevtoolsPanel)
    })
  }, [])

  if (!isClient || !DevtoolsComponent) {
    return null
  }

  return React.createElement(DevtoolsComponent, props)
}

// Follow TanStack Query devtools pattern exactly
export const TanStackReactDbDevtools: React.ComponentType<any> =
  typeof window === 'undefined' || process.env.NODE_ENV !== 'development'
    ? () => null
    : DevtoolsWrapper

export const TanStackReactDbDevtoolsPanel: React.ComponentType<any> =
  typeof window === 'undefined' || process.env.NODE_ENV !== 'development'
    ? () => null
    : DevtoolsPanelWrapper

export type { TanStackReactDbDevtoolsProps } from './ReactDbDevtools'

// SSR-safe initialization function - implement directly to avoid importing from the SolidJS package
export function initializeDbDevtools(): void {
  // SSR safety check
  if (typeof window === 'undefined') {
    return
  }

  // Idempotent check - if already initialized, skip
  if ((window as any).__TANSTACK_DB_DEVTOOLS_REGISTER__) {
    return
  }
  
  // Create the registry directly without importing SolidJS code to avoid SSR issues
  try {
    // Import and call the core initialization asynchronously, but ensure registry exists first
    import('@tanstack/db-devtools').then((module) => {
      module.initializeDbDevtools()
    }).catch((error) => {
      console.warn('DbDevtools: Failed to load core devtools module:', error)
    })
    
    // Create immediate registry that works with the SolidJS UI while core loads
    if (!(window as any).__TANSTACK_DB_DEVTOOLS__) {
      
      const collections = new Map()
      
      const registry = {
        collections,
        registerCollection: (collection: any) => {
          const metadata = {
            id: collection.id,
            type: collection.id.startsWith('live-query-') ? 'live-query' : 'collection',
            status: collection.status || 'idle',
            size: collection.size || 0,
            hasTransactions: collection.transactions?.size > 0 || false,
            transactionCount: collection.transactions?.size || 0,
            createdAt: new Date(),
            lastUpdated: new Date(),
            gcTime: collection.config?.gcTime,
            timings: collection.id.startsWith('live-query-') ? {
              totalIncrementalRuns: 0,
            } : undefined,
          }
          
          const entry = {
            weakRef: new WeakRef(collection),
            metadata,
            isActive: false,
          }
          
          collections.set(collection.id, entry)
        },
        unregisterCollection: (id: string) => {
          collections.delete(id)
        },
        getCollectionMetadata: (id: string) => {
          const entry = collections.get(id)
          if (!entry) return undefined
          
          // Try to get fresh data from the collection if it's still alive
          const collection = entry.weakRef.deref()
          if (collection) {
            entry.metadata.status = collection.status
            entry.metadata.size = collection.size
            entry.metadata.hasTransactions = collection.transactions?.size > 0 || false
            entry.metadata.transactionCount = collection.transactions?.size || 0
            entry.metadata.lastUpdated = new Date()
          }
          
          return { ...entry.metadata }
        },
        getAllCollectionMetadata: () => {
          const results = []
          for (const [, entry] of collections) {
            const collection = entry.weakRef.deref()
            if (collection) {
              // Collection is still alive, update metadata
              entry.metadata.status = collection.status
              entry.metadata.size = collection.size
              entry.metadata.hasTransactions = collection.transactions?.size > 0 || false
              entry.metadata.transactionCount = collection.transactions?.size || 0
              entry.metadata.lastUpdated = new Date()
              results.push({ ...entry.metadata })
            } else {
              // Collection was garbage collected
              entry.metadata.status = 'cleaned-up'
              entry.metadata.lastUpdated = new Date()
              results.push({ ...entry.metadata })
            }
          }
          
          return results
        },
        getCollection: (id: string) => {
          const entry = collections.get(id)
          if (!entry) return undefined
          
          const collection = entry.weakRef.deref()
          if (collection && !entry.isActive) {
            // Create hard reference
            entry.hardRef = collection
            entry.isActive = true
          }
          
          return collection
        },
        releaseCollection: (id: string) => {
          const entry = collections.get(id)
          if (entry && entry.isActive) {
            // Release hard reference
            entry.hardRef = undefined
            entry.isActive = false
          }
        },
        getTransactions: () => [],
        getTransaction: () => undefined,
        cleanup: () => {
          for (const [_id, entry] of collections) {
            if (entry.isActive) {
              entry.hardRef = undefined
              entry.isActive = false
            }
          }
        },
        garbageCollect: () => {
          for (const [id, entry] of collections) {
            const collection = entry.weakRef.deref()
            if (!collection) {
              collections.delete(id)
            }
          }
        },
      }
      
      // Set up the registry on window
      ;(window as any).__TANSTACK_DB_DEVTOOLS__ = registry
    }
    
    // Set up automatic collection registration
    if (!(window as any).__TANSTACK_DB_DEVTOOLS_REGISTER__) {
      ;(window as any).__TANSTACK_DB_DEVTOOLS_REGISTER__ = (collection: any) => {
        const registry = (window as any).__TANSTACK_DB_DEVTOOLS__
        if (registry) {
          registry.registerCollection(collection)
        }
      }
    }
  } catch (error) {
    console.warn('DbDevtools: Failed to initialize devtools:', error)
    
    // Final fallback: set up a basic registration function so collections don't fail
    if (!(window as any).__TANSTACK_DB_DEVTOOLS_REGISTER__) {
      ;(window as any).__TANSTACK_DB_DEVTOOLS_REGISTER__ = (collection: any) => {
        // Silent fallback registration
      }
    }
  }
  
  console.log('DbDevtools: Initialization complete')
}
