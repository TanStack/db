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

// Follow TanStack Query devtools pattern exactly
export const TanStackReactDbDevtools: React.ComponentType<any> =
  typeof window === 'undefined' || process.env.NODE_ENV !== 'development'
    ? () => null
    : DevtoolsWrapper

export type { TanStackReactDbDevtoolsProps } from './ReactDbDevtools'

// SSR-safe initialization function - just call the core devtools
export function initializeDbDevtools(): void {
  // SSR safety check
  if (typeof window === 'undefined') {
    return
  }

  // Just import and call the core devtools initialization
  import('@tanstack/db-devtools').then((module) => {
    module.initializeDbDevtools()
  }).catch((error) => {
    // Silently fail if core devtools module can't be loaded
  })
}
