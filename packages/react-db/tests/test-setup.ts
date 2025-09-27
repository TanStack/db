import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

global.IS_REACT_ACT_ENVIRONMENT = true
// https://testing-library.com/docs/react-testing-library/api#cleanup
afterEach(() => cleanup())
