import { render } from "solid-js/web"
import { createSignal, lazy } from "solid-js"
import { initializeDevtoolsRegistry } from "./registry"
import type { DbDevtoolsConfig, CollectionMetadata } from "./types"
import type { DbDevtoolsRegistry } from "./types"
import type { Signal } from "solid-js"

export interface TanstackDbDevtoolsConfig extends DbDevtoolsConfig {
  styleNonce?: string
  shadowDOMTarget?: ShadowRoot
}

class TanstackDbDevtools {
  #registry: DbDevtoolsRegistry
  #isMounted = false
  #styleNonce?: string
  #shadowDOMTarget?: ShadowRoot
  #initialIsOpen: Signal<boolean | undefined>
  #position: Signal<DbDevtoolsConfig["position"] | undefined>
  #panelProps: Signal<Record<string, any> | undefined>
  #toggleButtonProps: Signal<Record<string, any> | undefined>
  #closeButtonProps: Signal<Record<string, any> | undefined>
  #storageKey: Signal<string | undefined>
  #panelState: Signal<DbDevtoolsConfig["panelState"] | undefined>
  #onPanelStateChange: Signal<((isOpen: boolean) => void) | undefined>
  #Component: any
  #dispose?: () => void

  constructor(config: TanstackDbDevtoolsConfig) {
    const {
      initialIsOpen,
      position,
      panelProps,
      toggleButtonProps,
      closeButtonProps,
      storageKey,
      panelState,
      onPanelStateChange,
      styleNonce,
      shadowDOMTarget,
    } = config

    this.#registry = initializeDevtoolsRegistry()
    this.#styleNonce = styleNonce
    this.#shadowDOMTarget = shadowDOMTarget
    this.#initialIsOpen = createSignal(initialIsOpen)
    this.#position = createSignal(position)
    this.#panelProps = createSignal(panelProps)
    this.#toggleButtonProps = createSignal(toggleButtonProps)
    this.#closeButtonProps = createSignal(closeButtonProps)
    this.#storageKey = createSignal(storageKey)
    this.#panelState = createSignal(panelState)
    this.#onPanelStateChange = createSignal(onPanelStateChange)
  }

  setInitialIsOpen(isOpen: boolean) {
    this.#initialIsOpen[1](isOpen)
  }

  setPosition(position: DbDevtoolsConfig["position"]) {
    this.#position[1](position)
  }

  setPanelProps(props: Record<string, any>) {
    this.#panelProps[1](props)
  }

  setToggleButtonProps(props: Record<string, any>) {
    this.#toggleButtonProps[1](props)
  }

  setCloseButtonProps(props: Record<string, any>) {
    this.#closeButtonProps[1](props)
  }

  setStorageKey(key: string) {
    this.#storageKey[1](key)
  }

  setPanelState(state: DbDevtoolsConfig["panelState"]) {
    this.#panelState[1](state)
  }

  setOnPanelStateChange(callback: (isOpen: boolean) => void) {
    this.#onPanelStateChange[1](() => callback)
  }

  mount<T extends HTMLElement>(el: T) {
    if (this.#isMounted) {
      throw new Error("DB Devtools is already mounted")
    }

    const dispose = render(() => {
      const [initialIsOpen] = this.#initialIsOpen
      const [position] = this.#position
      const [panelProps] = this.#panelProps
      const [toggleButtonProps] = this.#toggleButtonProps
      const [closeButtonProps] = this.#closeButtonProps
      const [storageKey] = this.#storageKey
      const [panelState] = this.#panelState
      const [onPanelStateChange] = this.#onPanelStateChange

      let DbDevtools: any

      if (this.#Component) {
        DbDevtools = this.#Component
      } else {
        DbDevtools = lazy(() => import("./DbDevtools"))
        this.#Component = DbDevtools
      }

      return (
        <DbDevtools
          registry={this.#registry}
          shadowDOMTarget={this.#shadowDOMTarget}
          {...{
            get initialIsOpen() {
              return initialIsOpen()
            },
            get position() {
              return position()
            },
            get panelProps() {
              return panelProps()
            },
            get toggleButtonProps() {
              return toggleButtonProps()
            },
            get closeButtonProps() {
              return closeButtonProps()
            },
            get storageKey() {
              return storageKey()
            },
            get panelState() {
              return panelState()
            },
            get onPanelStateChange() {
              return onPanelStateChange()
            },
          }}
        />
      )
    }, el)

    this.#isMounted = true
    this.#dispose = dispose
  }

  unmount() {
    if (!this.#isMounted) {
      throw new Error("DB Devtools is not mounted")
    }
    this.#dispose?.()
    this.#isMounted = false
  }
}

export { TanstackDbDevtools }