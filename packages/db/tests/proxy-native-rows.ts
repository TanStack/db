/**
 * Row fixtures shared by proxy-oracle.test.ts and proxy.test.ts. A stored
 * function row keeps functions as data in several places. A frozen row is a
 * small nested object for freeze and seal histories.
 */
export type StoredRow = {
  handler: () => number
  fns: Array<() => number>
  obj: { g: () => number; count: number; bump: () => unknown }
  m: Map<string, () => number>
  s: Set<() => number>
}

export function makeStoredRow(f: () => number, f2: () => number): StoredRow {
  return {
    handler: f,
    fns: [f, f2],
    obj: {
      g: f,
      count: 0,
      bump() {
        this.count++
        return this
      },
    },
    m: new Map([[`k`, f]]),
    s: new Set([f]),
  }
}

export type FrozenRow = { n: { x: number }; m: number }

export function makeFrozenRow(): FrozenRow {
  return { n: { x: 1 }, m: 1 }
}
