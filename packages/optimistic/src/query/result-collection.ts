import { Store } from "@tanstack/store"
import type { MultiSet } from "@electric-sql/d2ts"

export class ResultCollection<T extends object = Record<string, unknown>> {
  private resultState = new Store<Map<string, T>>(new Map())

  constructor() {}

  get state() {
    return this.resultState
  }

  applyChanges(changeCollection: MultiSet<[string, unknown]>) {
    const changesByKey = new Map<
      string,
      { deletes: number; inserts: number; value: unknown }
    >()

    for (const [[key, value], multiplicity] of changeCollection.getInner()) {
      let changes = changesByKey.get(key)
      if (!changes) {
        changes = { deletes: 0, inserts: 0, value: value }
        changesByKey.set(key, changes)
      }

      if (multiplicity < 0) {
        changes.deletes += Math.abs(multiplicity)
      } else if (multiplicity > 0) {
        changes.inserts += multiplicity
        changes.value = value
      }
    }

    this.resultState.setState((state) => {
      const newState = new Map(state)
      for (const [key, changes] of changesByKey) {
        const { deletes, inserts, value } = changes
        if (inserts >= deletes) {
          newState.set(key, value as T)
        } else if (deletes > 0) {
          newState.delete(key)
        }
      }
      return newState
    })
  }
}
