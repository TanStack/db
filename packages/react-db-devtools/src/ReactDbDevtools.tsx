"use client"
import { useEffect, useRef, useState } from "react"
import { TanstackDbDevtools } from "@tanstack/db-devtools"
import type { TanstackDbDevtoolsConfig } from "@tanstack/db-devtools"
import { initializeDbDevtools } from "./index"

export interface TanStackReactDbDevtoolsProps extends TanstackDbDevtoolsConfig {
  // Additional React-specific props if needed
}

export function TanStackReactDbDevtools(props: TanStackReactDbDevtoolsProps = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const [devtools, setDevtools] = useState<TanstackDbDevtools | null>(null)
  const initializingRef = useRef(false)

  // Initialize devtools only on client side
  useEffect(() => {
    if (typeof window === 'undefined' || !ref.current || initializingRef.current) {
      return
    }
    
    // Set flag to prevent multiple initializations
    initializingRef.current = true
    
    // Note: Devtools registry is now initialized in collections.ts before collections are created
    initializeDbDevtools()
    const devtoolsInstance = new TanstackDbDevtools(props)
    
    try {
      // Mount the devtools to the DOM element
      devtoolsInstance.mount(ref.current)
      setDevtools(devtoolsInstance)
    } catch (error) {
      initializingRef.current = false // Reset flag on error
    }
    
    return () => {
      try {
        // Only unmount if the devtools were successfully mounted
        if (devtoolsInstance) {
          devtoolsInstance.unmount()
        }
      } catch (error) {
        // Ignore unmount errors if devtools weren't mounted
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
