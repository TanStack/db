/** @jsxImportSource solid-js */
import { render } from "solid-js/web"
import { createSignal } from "solid-js"
import { initializeDevtoolsRegistry } from "./registry"
import { FloatingTanStackDbDevtools } from "./FloatingTanStackDbDevtools"
import type { DbDevtoolsConfig, DbDevtoolsRegistry } from "./types"
import type { Signal } from "solid-js"

export interface TanstackDbDevtoolsConfig extends DbDevtoolsConfig {
  styleNonce?: string
  shadowDOMTarget?: ShadowRoot
}

class TanstackDbDevtools {
  #registry: DbDevtoolsRegistry
  #isMounted = false
  #shadowDOMTarget?: ShadowRoot
  #initialIsOpen: Signal<boolean | undefined>
  #position: Signal<DbDevtoolsConfig[`position`] | undefined>
  #panelProps: Signal<Record<string, any> | undefined>
  #toggleButtonProps: Signal<Record<string, any> | undefined>
  #closeButtonProps: Signal<Record<string, any> | undefined>
  #storageKey: Signal<string | undefined>
  #panelState: Signal<DbDevtoolsConfig[`panelState`] | undefined>
  #onPanelStateChange: Signal<((isOpen: boolean) => void) | undefined>
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
      styleNonce: _styleNonce,
      shadowDOMTarget,
    } = config

    // Only initialize on the client side
    if (typeof window === `undefined`) {
      throw new Error(`TanstackDbDevtools cannot be instantiated during SSR`)
    }

    this.#registry = initializeDevtoolsRegistry()
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

  setPosition(position: DbDevtoolsConfig[`position`]) {
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

  setPanelState(state: DbDevtoolsConfig[`panelState`]) {
    this.#panelState[1](state)
  }

  setOnPanelStateChange(callback: (isOpen: boolean) => void) {
    this.#onPanelStateChange[1](() => callback)
  }

  mount<T extends HTMLElement>(el: T) {
    if (this.#isMounted) {
      throw new Error(`DB Devtools is already mounted`)
    }

    const getValidPosition = (pos: DbDevtoolsConfig[`position`]) => {
      if (pos === `relative` || pos === undefined) {
        return `bottom-left` as const
      }
      return pos
    }

    const dispose = render(
      () => (
        <FloatingTanStackDbDevtools
          initialIsOpen={this.#initialIsOpen[0]()}
          position={getValidPosition(this.#position[0]())}
          panelProps={this.#panelProps[0]()}
          toggleButtonProps={this.#toggleButtonProps[0]()}
          closeButtonProps={this.#closeButtonProps[0]()}
          registry={() => this.#registry}
          shadowDOMTarget={this.#shadowDOMTarget}
        />
      ),
      el
    )

    this.#isMounted = true
    this.#dispose = dispose
  }

  unmount() {
    if (!this.#isMounted) {
      throw new Error(`DB Devtools is not mounted`)
    }
    this.#dispose?.()
    this.#isMounted = false
  }
}

export { TanstackDbDevtools }
