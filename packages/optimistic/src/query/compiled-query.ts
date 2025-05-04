import {
  D2,
  type IStreamBuilder,
  MessageType,
  MultiSet,
  type MultiSetArray,
  output,
  type RootStreamBuilder,
} from "@electric-sql/d2ts"
import { batch, Effect } from "@tanstack/store"
import { compileQuery } from "./compiler.js"
import { ResultCollection } from "./result-collection.js"
import type { BaseQueryBuilder } from "./query-builder.js"
import type { Context, Schema } from "./types.js"
import { ChangeMessage } from "../types.js"
import { Collection } from "../collection.js"

export class CompiledQuery<
  TResults extends object = Record<string, unknown>,
> {
  private graph: D2
  private inputs: Record<string, RootStreamBuilder<any>>
  private inputCollections: Record<string, Collection<any>>
  private resultCollection: ResultCollection<TResults>
  private state: `compiled` | `running` | `stopped` = `compiled`
  private version: number = 0
  private unsubscribeEffect?: () => void

  constructor(queryBuilder: BaseQueryBuilder<Context<Schema>>) {
    const query = queryBuilder._query
    const collections = query.collections

    if (!collections) {
      throw new Error(`No collections provided`)
    }

    this.resultCollection = new ResultCollection<TResults>()
    this.inputCollections = collections
    this.graph = new D2({ initialFrontier: this.version })
    this.inputs = Object.fromEntries(
      Object.entries(collections).map(([key]) => [
        key,
        this.graph.newInput<any>(),
      ])
    )

    compileQuery<IStreamBuilder<[string, unknown]>>(query, this.inputs).pipe(
      output((msg) => {
        if (msg.type === MessageType.DATA) {
          this.resultCollection.applyChanges(msg.data.collection)
        }
      })
    )
  }

  get results() {
    return this.resultCollection
  }

  private sendChangesToInput(inputKey: string, changes: Array<ChangeMessage>) {
    const input = this.inputs[inputKey]!
    const multiSetArray: MultiSetArray<[string, unknown]> = []
    for (const change of changes) {
      if (change.type === `insert`) {
        multiSetArray.push([[change.key, change.value], 1])
      } else if (change.type === `update`) {
        multiSetArray.push([[change.key, change.previousValue], -1])
        multiSetArray.push([[change.key, change.value], 1])
      } else if (change.type === `delete`) {
        multiSetArray.push([[change.key, change.previousValue], -1])
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
    if (this.state === `stopped`) {
      throw new Error(`Query is already stopped`)
    }
    this.unsubscribeEffect?.()
    this.state = `stopped`
  }
}
