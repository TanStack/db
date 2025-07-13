"use client"
import { useEffect, useRef, useState } from "react"
import { TanstackDbDevtools } from "@tanstack/db-devtools"
import type { TanstackDbDevtoolsConfig } from "@tanstack/db-devtools"

export interface ReactDbDevtoolsProps extends TanstackDbDevtoolsConfig {
  // Additional React-specific props if needed
}

export function ReactDbDevtools(props: ReactDbDevtoolsProps = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const [devtools] = useState(() => new TanstackDbDevtools(props))

  // Update devtools when props change
  useEffect(() => {
    if (props.initialIsOpen !== undefined) {
      devtools.setInitialIsOpen(props.initialIsOpen)
    }
  }, [devtools, props.initialIsOpen])

  useEffect(() => {
    if (props.position) {
      devtools.setPosition(props.position)
    }
  }, [devtools, props.position])

  useEffect(() => {
    if (props.panelProps) {
      devtools.setPanelProps(props.panelProps)
    }
  }, [devtools, props.panelProps])

  useEffect(() => {
    if (props.toggleButtonProps) {
      devtools.setToggleButtonProps(props.toggleButtonProps)
    }
  }, [devtools, props.toggleButtonProps])

  useEffect(() => {
    if (props.closeButtonProps) {
      devtools.setCloseButtonProps(props.closeButtonProps)
    }
  }, [devtools, props.closeButtonProps])

  useEffect(() => {
    if (props.storageKey) {
      devtools.setStorageKey(props.storageKey)
    }
  }, [devtools, props.storageKey])

  useEffect(() => {
    if (props.panelState) {
      devtools.setPanelState(props.panelState)
    }
  }, [devtools, props.panelState])

  useEffect(() => {
    if (props.onPanelStateChange) {
      devtools.setOnPanelStateChange(props.onPanelStateChange)
    }
  }, [devtools, props.onPanelStateChange])

  useEffect(() => {
    if (ref.current) {
      devtools.mount(ref.current)
    }

    return () => {
      devtools.unmount()
    }
  }, [devtools])

  return <div dir="ltr" className="tanstack-db-devtools-container" ref={ref} />
}

export function ReactDbDevtoolsPanel(props: ReactDbDevtoolsProps = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const [devtools] = useState(() => new TanstackDbDevtools(props))

  // Similar prop updates...
  useEffect(() => {
    if (props.initialIsOpen !== undefined) {
      devtools.setInitialIsOpen(props.initialIsOpen)
    }
  }, [devtools, props.initialIsOpen])

  useEffect(() => {
    if (ref.current) {
      devtools.mount(ref.current)
    }

    return () => {
      devtools.unmount()
    }
  }, [devtools])

  return <div dir="ltr" className="tanstack-db-devtools-panel-container" ref={ref} />
}
