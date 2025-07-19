import "@testing-library/jest-dom/vitest"
import { cleanup } from "@solidjs/testing-library"
import { afterEach } from "vitest"

// https://testing-library.com/docs/solid-testing-library/api/#cleanup
afterEach(() => cleanup())
