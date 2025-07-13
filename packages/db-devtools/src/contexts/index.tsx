import { createContext, useContext, createSignal, onMount, onCleanup } from 'solid-js'
import { createStore } from '@solid-primitives/storage'
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

// Theme Context
export type Theme = 'light' | 'dark'

const ThemeContext = createContext<{
  theme: Accessor<Theme>
  setTheme: (theme: Theme) => void
}>({
  theme: () => 'dark',
  setTheme: () => {},
})

export const useTheme = () => useContext(ThemeContext).theme
export const useSetTheme = () => useContext(ThemeContext).setTheme

export const ThemeProvider = (props: { children: JSX.Element }) => {
  const [theme, setTheme] = createSignal<Theme>('dark')

  onMount(() => {
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

// PiP Context
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
    if (typeof window !== 'undefined' && 'documentPictureInPicture' in window) {
      // @ts-ignore documentPictureInPicture API is not yet in TypeScript DOM types
      window.documentPictureInPicture.requestWindow({
        width: 800,
        height: 600,
      }).then((win: Window) => {
        setPiPWindow(win)
        win.addEventListener('pagehide', () => {
          setPiPWindow(null)
        })
      })
    }
  }

  const closePiP = () => {
    const win = pipWindow()
    if (win) {
      win.close()
      setPiPWindow(null)
    }
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

// Storage hook for devtools state
export const useDevtoolsStorage = () => {
  const [store, setStore] = createStore('tsdb-devtools', {
    open: 'false',
    position: 'bottom-right',
    height: '500',
    width: '500',
    pip_open: 'false',
  })

  return [store, setStore] as const
}