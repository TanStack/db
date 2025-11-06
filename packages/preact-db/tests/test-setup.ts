import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/preact"
import { afterEach } from "vitest"

// https://testing-library.com/docs/preact-testing-library/api/#cleanup
afterEach(() => cleanup())
