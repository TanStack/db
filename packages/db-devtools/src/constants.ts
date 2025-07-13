export const DEFAULT_HEIGHT = 500
export const DEFAULT_WIDTH = 500
export const POSITION = 'bottom-right'
export const BUTTON_POSITION = 'bottom-right'
export const INITIAL_IS_OPEN = false
export const DEFAULT_SORT_ORDER = 1
export const DEFAULT_SORT_FN_NAME = 'Status > Last Updated'
export const DEFAULT_MUTATION_SORT_FN_NAME = 'Status > Last Updated'

export const firstBreakpoint = 1024
export const secondBreakpoint = 796
export const thirdBreakpoint = 700

export type DevtoolsPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom' | 'left' | 'right'
export type DevtoolsButtonPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'relative'

export const isServer = typeof window === 'undefined'