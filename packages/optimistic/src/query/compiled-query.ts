import { D2, MessageType, MultiSet, output } from "@electric-sql/d2ts"
import { Effect, batch } from "@tanstack/store"
import { Collection } from "../collection.js"
import { compileQueryPipeline } from "./pipeline-compiler.js"
import type { ChangeMessage, SyncConfig } from "../types.js"
import type {
  IStreamBuilder,
  MultiSetArray,
  RootStreamBuilder,
} from "@electric-sql/d2ts"
import type { QueryBuilder, ResultsFromContext } from "./query-builder.js"
import type { Context, Schema } from "./types.js"

export function compileQuery<TContext extends Context<Schema>>(
  queryBuilder: QueryBuilder<TContext>
) {
  return new CompiledQuery<ResultsFromContext<TContext>>(queryBuilder)
}

export class CompiledQuery<TResults extends object = Record<string, unknown>> {
  private graph: D2
  private inputs: Record<string, RootStreamBuilder<any>>
  private inputCollections: Record<string, Collection<any>>
  private resultCollection: Collection<TResults>
  public state: `compiled` | `running` | `stopped` = `compiled`
  private version = 0
  private unsubscribeEffect?: () => void

  constructor(queryBuilder: QueryBuilder<Context<Schema>>) {
    const query = queryBuilder._query
    const collections = query.collections
    const hasOrderBy = !!query.orderBy

    if (!collections) {
      throw new Error(`No collections provided`)
    }

    this.inputCollections = collections

    const graph = new D2({ initialFrontier: this.version })
    const inputs = Object.fromEntries(
      Object.entries(collections).map(([key]) => [key, graph.newInput<any>()])
    )

    const sync: SyncConfig<TResults>[`sync`] = ({ begin, write, commit }) => {
      compileQueryPipeline<IStreamBuilder<[unknown, TResults]>>(
        query,
        inputs
      ).pipe(
        output(({ type, data }) => {
          if (type === MessageType.DATA) {
            begin()
            data.collection
              .getInner()
              .reduce((acc, [[key, value], multiplicity]) => {
                const changes = acc.get(key) || {
                  deletes: 0,
                  inserts: 0,
                  value,
                }
                if (multiplicity < 0) {
                  changes.deletes += Math.abs(multiplicity)
                } else if (multiplicity > 0) {
                  changes.inserts += multiplicity
                  changes.value = value
                }
                acc.set(key, changes)
                return acc
              }, new Map<unknown, { deletes: number; inserts: number; value: TResults }>())
              .forEach((changes, rawKey) => {
                const key = (rawKey as any).toString()
                const { deletes, inserts, value } = changes
                if (inserts && !deletes) {
                  write({
                    key,
                    value: value,
                    type: `insert`,
                  })
                } else if (inserts >= deletes) {
                  write({
                    key,
                    value: value,
                    type: `update`,
                  })
                } else if (deletes > 0) {
                  write({
                    key,
                    value: value,
                    type: `delete`,
                  })
                }
              })
            commit()
          }
        })
      )
      graph.finalize()
    }

    this.graph = graph
    this.inputs = inputs
    this.resultCollection = new Collection<TResults>({
      id: crypto.randomUUID(), // TODO: remove when we don't require any more
      sync: {
        sync,
      },
      sortBy: hasOrderBy
        ? (a, b) => {
            const aIndex = (a as { _orderByIndex: number })[`_orderByIndex`]
            const bIndex = (b as { _orderByIndex: number })[`_orderByIndex`]
            return aIndex - bIndex
          }
        : undefined,
    })
  }

  get results() {
    return this.resultCollection
  }

  private sendChangesToInput(inputKey: string, changes: Array<ChangeMessage>) {
    const input = this.inputs[inputKey]!
    const multiSetArray: MultiSetArray<unknown> = []
    for (const change of changes) {
      if (change.type === `insert`) {
        multiSetArray.push([change.value, 1])
      } else if (change.type === `update`) {
        multiSetArray.push([change.previousValue, -1])
        multiSetArray.push([change.value, 1])
      } else {
        // change.type === `delete`
        multiSetArray.push([change.value, -1])
      }
    }
    input.sendData(this.version, new MultiSet(multiSetArray))
  }

  private sendFrontierToInput(inputKey: string) {
    const input = this.inputs[inputKey]!
    input.sendFrontier(this.version)
  }

  private sendFrontierToAllInputs() {
    Object.entries(this.inputs).forEach(([key]) => {
      this.sendFrontierToInput(key)
    })
  }

  private incrementVersion() {
    this.version++
  }

  private runGraph() {
    this.graph.run()
  }

  start() {
    if (this.state === `running`) {
      throw new Error(`Query is already running`)
    } else if (this.state === `stopped`) {
      throw new Error(`Query is stopped`)
    }

    batch(() => {
      Object.entries(this.inputCollections).forEach(([key, collection]) => {
        this.sendChangesToInput(key, collection.currentStateAsChanges())
      })
      this.incrementVersion()
      this.sendFrontierToAllInputs()
      this.runGraph()
    })

    const changeEffect = new Effect({
      fn: () => {
        batch(() => {
          Object.entries(this.inputCollections).forEach(([key, collection]) => {
            this.sendChangesToInput(key, collection.derivedChanges.state)
          })
          this.incrementVersion()
          this.sendFrontierToAllInputs()
          this.runGraph()
        })
      },
      deps: Object.values(this.inputCollections).map(
        (collection) => collection.derivedChanges
      ),
    })
    this.unsubscribeEffect = changeEffect.mount()

    this.state = `running`
    return () => {
      this.stop()
    }
  }

  stop() {
    this.unsubscribeEffect?.()
    this.unsubscribeEffect = undefined
    this.state = `stopped`
  }
}
