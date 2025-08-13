import React, { useEffect, useRef, useState } from 'react'

export interface ReactDbDevtoolsPanelOptions {
  // Additional React-specific props if needed
}

export const TanStackReactDbDevtoolsPanel: React.FC<ReactDbDevtoolsPanelOptions> = (
  props,
): React.ReactElement | null => {
  const { ...rest } = props

  // SSR safety check - return null during SSR
  if (typeof window === `undefined`) {
    return null
  }

  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [registry, setRegistry] = useState<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const solidRootRef = useRef<any>(null)

  useEffect(() => {
    // Only initialize on the client side
    if (typeof window === `undefined`) return

    async function init() {
      try {
        // Dynamically import the devtools to avoid SSR issues
        const { getDevtoolsRegistry } = await import(`@tanstack/db-devtools`)
        
        // Get the existing registry (should already be initialized)
        const existingRegistry = getDevtoolsRegistry()
        
        if (!existingRegistry) {
          throw new Error('DB devtools registry not found. Make sure initializeDbDevtools() was called.')
        }
        
        setRegistry(existingRegistry)
        setIsInitialized(true)
      } catch (error) {
        console.error('Failed to initialize DB devtools:', error)
        setError(error instanceof Error ? error.message : 'Unknown error')
      }
    }

    init()
  }, []) // Empty dependency array to run only once

  useEffect(() => {
    if (!isInitialized || !registry || !containerRef.current) return

    async function mountSolidComponent() {
      try {
        // Import SolidJS render and the base panel component
        const { render } = await import('solid-js/web')
        const { BaseTanStackDbDevtoolsPanel } = await import('@tanstack/db-devtools')
        
        // Clean up any existing component
        if (solidRootRef.current) {
          solidRootRef.current()
          solidRootRef.current = null
        }

        // Create a SolidJS component that renders the base panel
        const SolidComponent = () => {
          return BaseTanStackDbDevtoolsPanel({
            registry: () => registry,
            style: () => ({
              height: '100%',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }),
            ...rest
          })
        }

        // Render the SolidJS component into the container
        const dispose = render(SolidComponent, containerRef.current!)
        solidRootRef.current = dispose
      } catch (error) {
        console.error('Failed to mount SolidJS component:', error)
        setError(error instanceof Error ? error.message : 'Unknown error')
      }
    }

    mountSolidComponent()

    // Cleanup function
    return () => {
      if (solidRootRef.current) {
        try {
          solidRootRef.current()
        } catch (error) {
          console.error('Error disposing SolidJS component:', error)
        }
        solidRootRef.current = null
      }
    }
  }, [isInitialized, registry, rest])

  // Don't render anything until we're on the client
  if (typeof window === `undefined`) {
    return null
  }

  // Show error state if initialization failed
  if (error) {
    return (
      <div style={{ padding: '1rem', color: 'red' }}>
        <h3>Failed to load DB Devtools</h3>
        <p>Error: {error}</p>
      </div>
    )
  }

  // Show loading state while initializing
  if (!isInitialized || !registry) {
    return (
      <div style={{ padding: '1rem' }}>
        <h3>Loading DB Devtools...</h3>
      </div>
    )
  }

  // Render a container div that the SolidJS component will be mounted into
  // Use flexbox to ensure it takes up the full available height
  return (
    <div 
      ref={containerRef} 
      style={{ 
        height: '100%', 
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }} 
    />
  )
}