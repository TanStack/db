import { createContext, useContext, createSignal, onMount, onCleanup } from 'solid-js'
import { createStorage } from '@solid-primitives/storage'
import type { JSX, Accessor } from 'solid-js'
import type { DevtoolsPosition, DevtoolsButtonPosition } from '../constants'

export type DevtoolsErrorType = 'loading' | 'error'

export interface DbDevtoolsContext {
  initialIsOpen?: boolean
  position?: DevtoolsPosition
  buttonPosition?: DevtoolsButtonPosition
  shadowDOMTarget?: ShadowRoot
  errorTypes?: DevtoolsErrorType[]
  onlineManager?: {
    isOnline: () => boolean
    subscribe: (fn: (online: boolean) => void) => () => void
  }
}

export interface DbDevtoolsProps extends DbDevtoolsContext {
  children?: JSX.Element
}

const DbDevtoolsContext = createContext<DbDevtoolsContext>({})

export const useDbDevtoolsContext = () => useContext(DbDevtoolsContext)

// Shadow DOM Target Context - matches Router devtools pattern
export const ShadowDomTargetContext = createContext<ShadowRoot | undefined>(undefined)

// Devtools On Close Context - matches Router devtools pattern
export const DevtoolsOnCloseContext = createContext<{ onCloseClick: (e: any) => void }>({
  onCloseClick: () => {},
})

export const useDevtoolsOnClose = () => useContext(DevtoolsOnCloseContext)

export const DbDevtoolsProvider = (props: DbDevtoolsProps) => {
  const value = {
    initialIsOpen: props.initialIsOpen,
    position: props.position,
    buttonPosition: props.buttonPosition,
    shadowDOMTarget: props.shadowDOMTarget,
    errorTypes: props.errorTypes,
    onlineManager: props.onlineManager,
  }

  return (
    <DbDevtoolsContext.Provider value={value}>
      {props.children}
    </DbDevtoolsContext.Provider>
  )
}

export type Theme = 'light' | 'dark'

const ThemeContext = createContext<{
  theme: Accessor<Theme>
  setTheme: (theme: Theme) => void
}>({
  theme: () => 'dark' as Theme,
  setTheme: () => {},
})

export const useTheme = () => useContext(ThemeContext).theme
export const useSetTheme = () => useContext(ThemeContext).setTheme

export const ThemeProvider = (props: { children: JSX.Element }) => {
  const [theme, setTheme] = createSignal<Theme>('dark')

  onMount(() => {
    // SSR safety check
    if (typeof window === 'undefined') return

    // Check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')
    setTheme(prefersDark.matches ? 'dark' : 'light')

    // Listen for changes
    const handleChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'dark' : 'light')
    }
    
    prefersDark.addEventListener('change', handleChange)
    onCleanup(() => prefersDark.removeEventListener('change', handleChange))
  })

  const value = {
    theme,
    setTheme,
  }

  return (
    <ThemeContext.Provider value={value}>
      {props.children}
    </ThemeContext.Provider>
  )
}

// Picture-in-Picture Context
const PiPContext = createContext<{
  pipWindow: Accessor<Window | null>
  openPiP: () => void
  closePiP: () => void
}>({
  pipWindow: () => null,
  openPiP: () => {},
  closePiP: () => {},
})

export const usePiPWindow = () => useContext(PiPContext)

export const PiPProvider = (props: { children: JSX.Element }) => {
  const [pipWindow, setPiPWindow] = createSignal<Window | null>(null)

  const openPiP = () => {
    if (typeof window === 'undefined') return
    
    const features = [
      'width=500',
      'height=300',
      'toolbar=no',
      'location=no',
      'directories=no',
      'status=no',
      'menubar=no',
      'scrollbars=no',
      'resizable=yes',
      'copyhistory=no',
    ].join(',')
    
    const pip = window.open('', 'devtools', features)
    setPiPWindow(pip)
  }

  const closePiP = () => {
    pipWindow()?.close()
    setPiPWindow(null)
  }

  const value = {
    pipWindow,
    openPiP,
    closePiP,
  }

  return (
    <PiPContext.Provider value={value}>
      {props.children}
    </PiPContext.Provider>
  )
}

// Storage hooks
export const useDevtoolsStorage = () => {
  const [store, setStore] = createStorage({
    prefix: 'tanstack-db-devtools',
    api: localStorage,
    serializer: {
      read: (value: string) => JSON.parse(value),
      write: (value: any) => JSON.stringify(value),
    },
  })

  return { store, setStore }
}