import { join, map, reduce, unkey } from '@tanstack/db-ivm'
import { codedMessage, devBuild } from '../../error-message.js'
import type { IStreamBuilder, KeyValue } from '@tanstack/db-ivm'

/** A singleton relation whose value changes only when a captured list changes. */
export type MutableListRevision = IStreamBuilder<KeyValue<number, number>>

/**
 * Retain the output of an expression-bearing stage by its input key. A list
 * revision visits every retained input, while an ordinary delta visits only
 * its own key. The reduction owns the exact prior output: a retraction never
 * reevaluates an old input against the newly edited list.
 *
 * A missing projection drops an input, which also makes this a retained filter.
 */
export function refreshMap<K, V, O>(
  input: IStreamBuilder<KeyValue<K, V>>,
  revision: MutableListRevision,
  project: (entry: KeyValue<K, V>) => O | undefined,
): IStreamBuilder<O> {
  const candidates = input.pipe(
    map((entry) => [0, entry] as KeyValue<number, KeyValue<K, V>>),
  )
  return candidates.pipe(
    join(revision, `inner`),
    map(([, [entry]]) => {
      if (entry === null) {
        throw new Error(
          devBuild() && process.env.NODE_ENV !== `production`
            ? `An inner mutable-list revision lost its candidate`
            : codedMessage(243),
        )
      }
      return [entry[0], entry] as KeyValue<K, KeyValue<K, V>>
    }),
    reduce((values) =>
      values.flatMap(([entry, multiplicity]) => {
        if (multiplicity <= 0) return []
        const output = project(entry)
        return output === undefined
          ? []
          : [[output, multiplicity] as [O, number]]
      }),
    ),
    unkey(),
  )
}
