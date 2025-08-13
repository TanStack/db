import { createContext, useContext } from "solid-js"

// Devtools On Close Context - matches Router devtools pattern
export const DevtoolsOnCloseContext = createContext<{
  onCloseClick: (e: any) => void
}>({
  onCloseClick: () => {},
})

export const useDevtoolsOnClose = () => useContext(DevtoolsOnCloseContext)

// Shadow DOM Target Context - matches Router devtools pattern
export const ShadowDomTargetContext = createContext<ShadowRoot | undefined>(
  undefined
)

// Navigation Context
export * from "./NavigationContext"
