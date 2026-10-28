// Shared by the hash identity oracle and its ordinary tests: a second module
// copy whose initialization draws are all equal, so every type marker has the
// same hash number. Its top-K batch is loaded right after it, so it binds to
// that copy.
import { captureHashSession } from './hash-session'

// A second module copy whose initialization draws are all equal. Every
// random constant, including every type marker, gets the same number, so a
// design that tells types apart by marker number fails here.
const nativeTape = (await captureHashSession()).tape
export const colliding = await captureHashSession(nativeTape.map(() => 0.5))
// Loaded right after the colliding module, so it binds to that copy.
export const { topKBatch: collidingTopKBatch } = await import(
  `../src/operators/topKState.js`
)
