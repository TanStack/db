import { MultiSet } from '@tanstack/db-ivm'
import { BucketFacadeAdapter } from './bucket-facade-adapter.js'
import type { MaterializedCompilation } from './materialized-pipeline.js'
import type { FacadePublication } from './bucket-facade-adapter.js'
import type { ID2 } from '@tanstack/db-ivm'
import type { ResultStream } from '../../types.js'

const stages = new WeakMap<ID2, Array<FacadeProjection>>()

export function facadeProjections(graph: ID2): Array<FacadeProjection> {
  return stages.get(graph) ?? []
}

export function stageFacadeProjection(
  id: string,
  input: MaterializedCompilation,
) {
  const stage = new FacadeProjection(id, input)
  const graph = input.pipeline.graph
  const existing = stages.get(graph) ?? []
  existing.push(stage)
  stages.set(graph, existing)
  return stage.pipeline
}

class FacadeProjection {
  readonly pipeline: ResultStream
  private readonly reader
  private readonly adapter: BucketFacadeAdapter
  private publication: FacadePublication | undefined
  messages = 0

  constructor(id: string, input: MaterializedCompilation) {
    this.reader = input.pipeline.connectReader()
    this.pipeline =
      input.pipeline.graph.newInput<[unknown, [unknown, string | undefined]]>()
    this.adapter = new BucketFacadeAdapter(id, input.facades, (count) => {
      this.messages += count
    })
  }

  hasWork(): boolean {
    return !this.reader.isEmpty()
  }
  hasPublication(): boolean {
    return this.adapter.hasPendingChanges()
  }

  advance(): void {
    const combined = new MultiSet(
      this.reader.drain().flatMap((batch) => batch.getInner()),
    ).consolidate()
    this.pipeline.writer.sendData(
      combined.map(([key, [value, order]]) => [
        key,
        [this.adapter.resolveDraft(value), order],
      ]),
    )
  }

  prepare(): void {
    this.publication = this.adapter.flush()
    this.publication.prepare()
  }

  reveal(): void {
    this.adapter.publishDrafts()
  }
  publish(): void {
    this.publication?.publish()
    this.publication = undefined
  }
  rollback(): void {
    this.publication?.rollback()
    this.publication = undefined
    this.adapter.publishDrafts()
  }
  cleanup(): void {
    this.rollback()
    this.adapter.cleanup()
  }
}
