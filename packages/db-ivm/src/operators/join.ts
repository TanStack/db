import { BinaryOperator, DifferenceStreamWriter } from "../graph.js"
import { StreamBuilder } from "../d2.js"
import { MultiSet } from "../multiset.js"
import { Index } from "../indexes.js"
import type { DifferenceStreamReader } from "../graph.js"
import type { IStreamBuilder, KeyValue, PipedOperator } from "../types.js"

/**
 * Type of join to perform
 */
export type JoinType = `inner` | `left` | `right` | `full` | `anti`

/**
 * Helper to build delta index and mass map from messages
 */
function buildDelta<K, V>(messages: Array<unknown>): [Index<K, V>, Map<K, number>] {
  const delta = new Index<K, V>()
  const deltaMass = new Map<K, number>()
  
  for (const message of messages) {
    const multiSetMessage = message as unknown as MultiSet<[K, V]>
    for (const [item, multiplicity] of multiSetMessage.getInner()) {
      const [key, value] = item
      delta.addValue(key, [value, multiplicity])
      deltaMass.set(key, (deltaMass.get(key) || 0) + multiplicity)
    }
  }
  
  return [delta, deltaMass]
}

/**
 * Check if a key has presence (non-zero mass)
 */
function hasPresence<K>(mass: Map<K, number>, key: K): boolean {
  return (mass.get(key) || 0) !== 0
}

/**
 * Operator that joins two input streams using direct join algorithms
 */
export class JoinOperator<K, V1, V2> extends BinaryOperator<
  [K, V1] | [K, V2] | [K, [V1, V2]] | [K, [V1 | null, V2 | null]]
> {
  #indexA = new Index<K, V1>()
  #indexB = new Index<K, V2>()
  #massA = new Map<K, number>() // sum of multiplicities per key on side A
  #massB = new Map<K, number>() // sum of multiplicities per key on side B
  #mode: JoinType

  constructor(
    id: number,
    inputA: DifferenceStreamReader<[K, V1]>,
    inputB: DifferenceStreamReader<[K, V2]>,
    output: DifferenceStreamWriter<any>,
    mode: JoinType = 'inner'
  ) {
    super(id, inputA, inputB, output)
    this.#mode = mode
  }

  run(): void {
    const start = performance.now()
    // 1) Ingest messages and build deltas (no state mutation yet)
    const [deltaA, deltaMassA] = buildDelta<K, V1>(this.inputAMessages())
    const [deltaB, deltaMassB] = buildDelta<K, V2>(this.inputBMessages())

    const results = new MultiSet<any>()

    // 2) INNER part (used by inner/left/right/full, but NOT anti)
    if (this.#mode === 'inner' || this.#mode === 'left' || this.#mode === 'right' || this.#mode === 'full') {
      // Emit deltaA ⋈ indexB
      results.extend(deltaA.join(this.#indexB))

      // Create logical indexA ⊎ deltaA and join with deltaB
      const tempIndexA = new Index<K, V1>()
      tempIndexA.append(this.#indexA)
      tempIndexA.append(deltaA)
      results.extend(tempIndexA.join(deltaB))
    }

    // 3) OUTER/ANTI specifics

    // LEFT side nulls or anti-left (depend only on B's presence)
    if (this.#mode === 'left' || this.#mode === 'full' || this.#mode === 'anti') {
      // 3a) New/deleted left rows that are currently unmatched 
      // For initial state, check final presence after applying deltaB
      for (const [key, valueIterator] of deltaA.entriesIterators()) {
        const finalMassB = (this.#massB.get(key) || 0) + (deltaMassB.get(key) || 0)
        if (finalMassB === 0) {
          for (const [value, multiplicity] of valueIterator) {
            if (multiplicity !== 0) {
              results.extend([[[key, [value, null]], multiplicity]])
            }
          }
        }
      }

      // 3b) Right-side presence transitions flip match status for *current* left rows
      for (const key of deltaMassB.keys()) {
        const wasEmpty = !hasPresence(this.#massB, key)
        const currentMass = this.#massB.get(key) || 0
        const deltaMass = deltaMassB.get(key) || 0
        const willEmpty = (currentMass + deltaMass) === 0

        if (wasEmpty && !willEmpty) {
          // B: 0 -> >0 — retract previously unmatched left-at-k
          for (const [value, multiplicity] of this.#indexA.getIterator(key)) {
            if (multiplicity !== 0) {
              results.extend([[[key, [value, null]], -multiplicity]])
            }
          }
        } else if (!wasEmpty && willEmpty) {
          // B: >0 -> 0 — emit left-at-k as unmatched
          for (const [value, multiplicity] of this.#indexA.getIterator(key)) {
            if (multiplicity !== 0) {
              results.extend([[[key, [value, null]], multiplicity]])
            }
          }
        }
      }
    }

    // RIGHT side nulls (depend only on A's presence)
    if (this.#mode === 'right' || this.#mode === 'full') {
      // 3a) New/deleted right rows that are currently unmatched
      // For initial state, check final presence after applying deltaA
      for (const [key, valueIterator] of deltaB.entriesIterators()) {
        const finalMassA = (this.#massA.get(key) || 0) + (deltaMassA.get(key) || 0)
        if (finalMassA === 0) {
          for (const [value, multiplicity] of valueIterator) {
            if (multiplicity !== 0) {
              results.extend([[[key, [null, value]], multiplicity]])
            }
          }
        }
      }

      // 3b) Left-side presence transitions flip match status for *current* right rows
      for (const key of deltaMassA.keys()) {
        const wasEmpty = !hasPresence(this.#massA, key)
        const currentMass = this.#massA.get(key) || 0
        const deltaMass = deltaMassA.get(key) || 0
        const willEmpty = (currentMass + deltaMass) === 0

        if (wasEmpty && !willEmpty) {
          // A: 0 -> >0 — retract previously unmatched right-at-k
          for (const [value, multiplicity] of this.#indexB.getIterator(key)) {
            if (multiplicity !== 0) {
              results.extend([[[key, [null, value]], -multiplicity]])
            }
          }
        } else if (!wasEmpty && willEmpty) {
          // A: >0 -> 0 — emit right-at-k as unmatched
          for (const [value, multiplicity] of this.#indexB.getIterator(key)) {
            if (multiplicity !== 0) {
              results.extend([[[key, [null, value]], multiplicity]])
            }
          }
        }
      }
    }

    // 4) Commit — update state
    this.#indexA.append(deltaA)
    this.#indexB.append(deltaB)
    
    // Update masses
    for (const [key, deltaMass] of deltaMassA) {
      this.#massA.set(key, (this.#massA.get(key) || 0) + deltaMass)
    }
    for (const [key, deltaMass] of deltaMassB) {
      this.#massB.set(key, (this.#massB.get(key) || 0) + deltaMass)
    }

    // Send results
    if (results.getInner().length > 0) {
      this.output.sendData(results)
    }
    const end = performance.now()
    console.log(`join took ${end - start}ms`)
  }
}

/**
 * Joins two input streams
 * @param other - The other stream to join with
 * @param type - The type of join to perform
 */
export function join<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>,
  type: JoinType = `inner`
): PipedOperator<T, KeyValue<K, [V1 | null, V2 | null]>> {
  return (stream: IStreamBuilder<T>): IStreamBuilder<KeyValue<K, [V1 | null, V2 | null]>> => {
    if (stream.graph !== other.graph) {
      throw new Error(`Cannot join streams from different graphs`)
    }
    const output = new StreamBuilder<KeyValue<K, [V1 | null, V2 | null]>>(
      stream.graph,
      new DifferenceStreamWriter<KeyValue<K, [V1 | null, V2 | null]>>()
    )
    const operator = new JoinOperator<K, V1, V2>(
      stream.graph.getNextOperatorId(),
      stream.connectReader() as DifferenceStreamReader<KeyValue<K, V1>>,
      other.connectReader(),
      output.writer,
      type
    )
    stream.graph.addOperator(operator)
    return output
  }
}

/**
 * Joins two input streams (inner join)
 * @param other - The other stream to join with
 */
export function innerJoin<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>
): PipedOperator<T, KeyValue<K, [V1, V2]>> {
  return join(other, 'inner') as unknown as PipedOperator<T, KeyValue<K, [V1, V2]>>
}

/**
 * Joins two input streams (anti join)
 * @param other - The other stream to join with
 */
export function antiJoin<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>
): PipedOperator<T, KeyValue<K, [V1, null]>> {
  return join(other, 'anti') as unknown as PipedOperator<T, KeyValue<K, [V1, null]>>
}

/**
 * Joins two input streams (left join)
 * @param other - The other stream to join with
 */
export function leftJoin<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>
): PipedOperator<T, KeyValue<K, [V1, V2 | null]>> {
  return join(other, 'left') as unknown as PipedOperator<T, KeyValue<K, [V1, V2 | null]>>
}

/**
 * Joins two input streams (right join)
 * @param other - The other stream to join with
 */
export function rightJoin<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>
): PipedOperator<T, KeyValue<K, [V1 | null, V2]>> {
  return join(other, 'right') as unknown as PipedOperator<T, KeyValue<K, [V1 | null, V2]>>
}

/**
 * Joins two input streams (full join)
 * @param other - The other stream to join with
 */
export function fullJoin<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>
): PipedOperator<T, KeyValue<K, [V1 | null, V2 | null]>> {
  return join(other, 'full') as unknown as PipedOperator<T, KeyValue<K, [V1 | null, V2 | null]>>
}
