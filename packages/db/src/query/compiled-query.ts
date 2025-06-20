import { D2, MultiSet, output } from "@electric-sql/d2mini"
import { createCollection } from "../collection.js"
import { compileQueryPipeline } from "./pipeline-compiler.js"
import type { Collection } from "../collection.js"
import type { ChangeMessage, SyncConfig } from "../types.js"
import type {
  IStreamBuilder,
  MultiSetArray,
  RootStreamBuilder,
} from "@electric-sql/d2mini"
import type { QueryBuilder, ResultsFromContext } from "./query-builder.js"
import type { Context, Schema } from "./types.js"

export function compileQuery<TContext extends Context<Schema>>(
  queryBuilder: QueryBuilder<TContext>
) {
  return new CompiledQuery<
    ResultsFromContext<TContext> & { _key?: string | number }
  >(queryBuilder)
}

export class CompiledQuery<TResults extends object = Record<string, unknown>> {
  private graph: D2
  private inputs: Record<string, RootStreamBuilder<any>>
  private inputCollections: Record<string, Collection<any>>
  private resultCollection: Collection<TResults>
  public state: `compiled` | `running` | `stopped` = `compiled`
  private unsubscribeCallbacks: Array<() => void> = []

  constructor(queryBuilder: QueryBuilder<Context<Schema>>) {
    const query = queryBuilder._query
    const collections = query.collections

    if (!collections) {
      throw new Error(`No collections provided`)
    }

    this.inputCollections = collections

    const graph = new D2()
    const inputs = Object.fromEntries(
      Object.entries(collections).map(([key]) => [key, graph.newInput<any>()])
    )

    const sync: SyncConfig<TResults>[`sync`] = ({ begin, write, commit }) => {
      compileQueryPipeline<IStreamBuilder<[unknown, TResults]>>(
        query,
        inputs
      ).pipe(
        output((data) => {
          begin()
          data
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
              const { deletes, inserts, value } = changes
              const valueWithKey = { ...value, _key: rawKey }
              if (inserts && !deletes) {
                write({
                  value: valueWithKey,
                  type: `insert`,
                })
              } else if (inserts >= deletes) {
                write({
                  value: valueWithKey,
                  type: `update`,
                })
              } else if (deletes > 0) {
                write({
                  value: valueWithKey,
                  type: `delete`,
                })
              }
            })
          commit()
        })
      )
      graph.finalize()
    }

    this.graph = graph
    this.inputs = inputs
    this.resultCollection = createCollection<TResults>({
      id: crypto.randomUUID(), // TODO: remove when we don't require any more
      getKey: (val: unknown) => {
        return (val as any)._key
      },
      sync: {
        sync,
      },
    })
  }

  get results() {
    return this.resultCollection
  }

  private sendChangesToInput(
    inputKey: string,
    changes: Array<ChangeMessage>,
    getKey: (item: ChangeMessage[`value`]) => any
  ) {
    const input = this.inputs[inputKey]!
    const multiSetArray: MultiSetArray<unknown> = []
    for (const change of changes) {
      const key = getKey(change.value)
      if (change.type === `insert`) {
        multiSetArray.push([[key, change.value], 1])
      } else if (change.type === `update`) {
        multiSetArray.push([[key, change.previousValue], -1])
        multiSetArray.push([[key, change.value], 1])
      } else {
        // change.type === `delete`
        multiSetArray.push([[key, change.value], -1])
      }
    }
    input.sendData(new MultiSet(multiSetArray))
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

    // Send initial state
    Object.entries(this.inputCollections).forEach(([key, collection]) => {
      this.sendChangesToInput(
        key,
        collection.currentStateAsChanges(),
        collection.config.getKey
      )
    })
    this.runGraph()

    // Subscribe to changes
    Object.entries(this.inputCollections).forEach(([key, collection]) => {
      const unsubscribe = collection.subscribeChanges((changes) => {
        this.sendChangesToInput(key, changes, collection.config.getKey)
        this.runGraph()
      })

      this.unsubscribeCallbacks.push(unsubscribe)
    })

    this.state = `running`
    return () => {
      this.stop()
    }
  }

  stop() {
    this.unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe())
    this.unsubscribeCallbacks = []
    this.state = `stopped`
  }
}
