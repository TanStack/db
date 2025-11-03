import { createStart } from '@tanstack/react-start'
import './lib/fetch-with-user' // Patch fetch to add user headers

export const startInstance = createStart(() => {
  return {
    defaultSsr: false,
  }
})
