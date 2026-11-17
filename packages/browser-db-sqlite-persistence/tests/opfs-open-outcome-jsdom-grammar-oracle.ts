// Owns nothing: this module holds the grammar input for the jsdom driver in
// opfs-open-outcome-oracle.test.ts, the steps that driver controls. Its open
// histories come from this reach, and opfs-open-outcome-jsdom-grammar.test.ts
// checks that they reach every outcome.
import type { OpenDriverReach } from './opfs-open-outcome-oracle'

export const jsdomReach: OpenDriverReach = {
  lookup: [`not needed`],
  workerStart: [`starts`, `throws`, `fails to load`],
  wasm: [`loads`, `fails`],
  init: [`answers`, `silent`],
  interrupt: [`none`, `deadline`, `abort`],
}
