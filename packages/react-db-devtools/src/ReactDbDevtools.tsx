"use client"
import { useEffect, useRef, useState } from "react"
import { TanstackDbDevtools } from "@tanstack/db-devtools"
import type { TanstackDbDevtoolsConfig } from "@tanstack/db-devtools"

export interface TanStackReactDbDevtoolsProps extends TanstackDbDevtoolsConfig {
  // Additional React-specific props if needed
}

export function TanStackReactDbDevtools(props: TanStackReactDbDevtoolsProps = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const [devtools, setDevtools] = useState<TanstackDbDevtools | null>(null)
  const initializingRef = useRef(false)

  console.log('ReactDbDevtools: Component rendered with props:', props)

  // Initialize devtools only on client side
  useEffect(() => {
    console.log('ReactDbDevtools: useEffect triggered')
    console.log('ReactDbDevtools: window exists:', typeof window !== 'undefined')
    console.log('ReactDbDevtools: ref.current exists:', !!ref.current)
    console.log('ReactDbDevtools: already initializing:', initializingRef.current)
    
    if (typeof window === 'undefined' || !ref.current || initializingRef.current) {
      console.log('ReactDbDevtools: Early return - no window, ref, or already initializing')
      return
    }
    
    // Set flag to prevent multiple initializations
    initializingRef.current = true
    
    // Note: Devtools registry is now initialized in main.tsx before collections are created
    console.log('ReactDbDevtools: Skipping devtools initialization (done in main.tsx)')
    
    console.log('ReactDbDevtools: Creating TanstackDbDevtools instance')
    const devtoolsInstance = new TanstackDbDevtools(props)
    
    try {
      console.log('ReactDbDevtools: Attempting to mount devtools')
      // Mount the devtools to the DOM element
      devtoolsInstance.mount(ref.current)
      console.log('ReactDbDevtools: Devtools mounted successfully')
      setDevtools(devtoolsInstance)
    } catch (error) {
      console.error('ReactDbDevtools: Failed to mount DB devtools:', error)
      initializingRef.current = false // Reset flag on error
    }
    
    return () => {
      console.log('ReactDbDevtools: Cleanup - unmounting devtools')
      try {
        // Only unmount if the devtools were successfully mounted
        if (devtoolsInstance) {
          devtoolsInstance.unmount()
          console.log('ReactDbDevtools: Devtools unmounted successfully')
        }
      } catch (error) {
        // Ignore unmount errors if devtools weren't mounted
        console.warn('ReactDbDevtools: Error unmounting DB devtools:', error)
      }
      initializingRef.current = false
    }
  }, []) // Empty dependency array to prevent remounting

  // Update devtools when props change
  useEffect(() => {
    if (!devtools) return
    
    if (props.initialIsOpen !== undefined) {
      devtools.setInitialIsOpen(props.initialIsOpen)
    }
    
    if (props.position !== undefined) {
      devtools.setPosition(props.position)
    }
    
    if (props.panelProps !== undefined) {
      devtools.setPanelProps(props.panelProps)
    }
    
    if (props.toggleButtonProps !== undefined) {
      devtools.setToggleButtonProps(props.toggleButtonProps)
    }
    
    if (props.closeButtonProps !== undefined) {
      devtools.setCloseButtonProps(props.closeButtonProps)
    }
    
    if (props.storageKey !== undefined) {
      devtools.setStorageKey(props.storageKey)
    }
    
    if (props.panelState !== undefined) {
      devtools.setPanelState(props.panelState)
    }
    
    if (props.onPanelStateChange !== undefined) {
      devtools.setOnPanelStateChange(props.onPanelStateChange)
    }
  }, [
    devtools,
    props.initialIsOpen,
    props.position,
    props.panelProps,
    props.toggleButtonProps,
    props.closeButtonProps,
    props.storageKey,
    props.panelState,
    props.onPanelStateChange,
  ])

  // Render a container div for the devtools
  return <div ref={ref} />
}

export function TanStackReactDbDevtoolsPanel(props: TanStackReactDbDevtoolsProps = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const [devtools, setDevtools] = useState<TanstackDbDevtools | null>(null)

  // Initialize devtools only on client side
  useEffect(() => {
    if (typeof window === 'undefined' || !ref.current) return
    
    const devtoolsInstance = new TanstackDbDevtools(props)
    
    try {
      // Mount the devtools to the DOM element
      devtoolsInstance.mount(ref.current)
      setDevtools(devtoolsInstance)
    } catch (error) {
      console.error('Failed to mount DB devtools panel:', error)
    }
    
    return () => {
      try {
        // Only unmount if the devtools were successfully mounted
        devtoolsInstance.unmount()
      } catch (error) {
        // Ignore unmount errors if devtools weren't mounted
        console.warn('Error unmounting DB devtools panel:', error)
      }
    }
  }, [])

  // Update devtools when props change
  useEffect(() => {
    if (!devtools) return
    
    if (props.initialIsOpen !== undefined) {
      devtools.setInitialIsOpen(props.initialIsOpen)
    }
    
    if (props.position !== undefined) {
      devtools.setPosition(props.position)
    }
    
    if (props.panelProps !== undefined) {
      devtools.setPanelProps(props.panelProps)
    }
    
    if (props.toggleButtonProps !== undefined) {
      devtools.setToggleButtonProps(props.toggleButtonProps)
    }
    
    if (props.closeButtonProps !== undefined) {
      devtools.setCloseButtonProps(props.closeButtonProps)
    }
    
    if (props.storageKey !== undefined) {
      devtools.setStorageKey(props.storageKey)
    }
    
    if (props.panelState !== undefined) {
      devtools.setPanelState(props.panelState)
    }
    
    if (props.onPanelStateChange !== undefined) {
      devtools.setOnPanelStateChange(props.onPanelStateChange)
    }
  }, [
    devtools,
    props.initialIsOpen,
    props.position,
    props.panelProps,
    props.toggleButtonProps,
    props.closeButtonProps,
    props.storageKey,
    props.panelState,
    props.onPanelStateChange,
  ])

  // Render a container div for the devtools panel
  return <div ref={ref} />
}
