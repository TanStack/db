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
    console.log('DbDevtools: SSR environment detected, skipping initialization')
    return
  }

  console.log('DbDevtools: Initializing devtools...')

  // Initialize the registry directly without importing SolidJS code
  if (!(window as any).__TANSTACK_DB_DEVTOOLS__) {
    console.log('DbDevtools: Creating registry...')
    
    const registry = {
      collections: new Map(),
      registerCollection: () => {},
      unregisterCollection: () => {},
      getCollection: () => undefined,
      releaseCollection: () => {},
      getAllCollectionMetadata: () => [],
      getCollectionMetadata: () => undefined,
      getTransactions: () => [],
      getTransaction: () => undefined,
      cleanup: () => {},
      isInitialized: true,
    }

    // Set up the registry on window
    ;(window as any).__TANSTACK_DB_DEVTOOLS__ = registry

    // Set up automatic collection registration
    ;(window as any).__TANSTACK_DB_DEVTOOLS_REGISTER__ = (collection: any) => {
      console.log('DbDevtools: Registering collection:', collection.id)
      console.log('DbDevtools: Collection details:', {
        id: collection.id,
        size: collection.size || 0,
        status: collection.status || 'idle',
        constructor: collection.constructor.name
      })
      
      if (registry && registry.collections) {
        registry.collections.set(collection.id, {
          collection,
          metadata: {
            id: collection.id,
            size: collection.size || 0,
            type: 'unknown',
            status: collection.status || 'idle',
            hasTransactions: false,
            transactionCount: 0,
          }
        })
        console.log('DbDevtools: Collection registered successfully:', collection.id)
        console.log('DbDevtools: Total collections now:', registry.collections.size)
        console.log('DbDevtools: Registry collections:', Array.from(registry.collections.keys()))
      } else {
        console.warn('DbDevtools: Registry or collections not available')
      }
    }

    ;(window as any).__TANSTACK_DB_DEVTOOLS_UNREGISTER__ = (id: string) => {
      console.log('DbDevtools: Unregistering collection:', id)
      if (registry.collections) {
        registry.collections.delete(id)
        console.log('DbDevtools: Collection unregistered successfully:', id)
      }
    }

    console.log('DbDevtools: Registry created successfully')
  } else {
    console.log('DbDevtools: Registry already exists')
  }
  
  console.log('DbDevtools: Initialization complete')
}
