"use client"
import * as React from "react"
import { initializeDbDevtools } from "@tanstack/db-devtools"
import type { DbDevtoolsConfig } from "@tanstack/db-devtools"

export interface ReactDbDevtoolsProps extends DbDevtoolsConfig {
  // React-specific props can be added here
}

export function ReactDbDevtools(
  props: ReactDbDevtoolsProps = {}
): React.ReactElement | null {
  const ref = React.useRef<HTMLDivElement>(null)

  // Initialize devtools registry on mount
  React.useEffect(() => {
    initializeDbDevtools()
  }, [])

  // Create a simple container that will be replaced by the Solid.js component
  React.useEffect(() => {
    if (ref.current) {
      // Import the core devtools dynamically to avoid SSR issues
      import(`@tanstack/db-devtools`).then(({ DbDevtools }) => {
        import(`solid-js/web`).then(({ render }) => {
          render(() => DbDevtools(props), ref.current!)
        })
      })
    }
  }, [props])

  return <div ref={ref} className="tanstack-db-devtools-container" />
}

export function ReactDbDevtoolsPanel(
  props: ReactDbDevtoolsProps = {}
): React.ReactElement | null {
  const ref = React.useRef<HTMLDivElement>(null)

  // Initialize devtools registry on mount
  React.useEffect(() => {
    initializeDbDevtools()
  }, [])

  // Create a simple container that will be replaced by the Solid.js component
  React.useEffect(() => {
    if (ref.current) {
      // Import the core devtools dynamically to avoid SSR issues
      import(`@tanstack/db-devtools`).then(({ DbDevtoolsPanel }) => {
        import(`solid-js/web`).then(({ render }) => {
          import(`@tanstack/db-devtools`).then(
            ({ initializeDevtoolsRegistry }) => {
              const registry = initializeDevtoolsRegistry()
              render(
                () =>
                  DbDevtoolsPanel({
                    ...props,
                    collections: registry.getAllCollectionMetadata(),
                    registry,
                    onClose: () => {
                      if (ref.current) {
                        ref.current.style.display = `none`
                      }
                    },
                  }),
                ref.current!
              )
            }
          )
        })
      })
    }
  }, [props])

  return <div ref={ref} className="tanstack-db-devtools-panel-container" />
}
