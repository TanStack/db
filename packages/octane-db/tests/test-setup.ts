import '@testing-library/jest-dom/vitest'
import { cleanup } from '@octanejs/testing-library'
import { afterEach } from 'vitest'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

global.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => cleanup())
