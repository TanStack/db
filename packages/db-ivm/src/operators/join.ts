import { BinaryOperator, DifferenceStreamWriter } from "../graph.js"
import { StreamBuilder } from "../d2.js"
import { MultiSet } from "../multiset.js"
import { Index } from "../indexes.js"
import { negate } from "./negate.js"
import { map } from "./map.js"
import { concat } from "./concat.js"
import type { DifferenceStreamReader } from "../graph.js"
import type { IStreamBuilder, KeyValue, PipedOperator } from "../types.js"

/**
 * Type of join to perform
 */
export type JoinType = `inner` | `left` | `right` | `full` | `anti`

/**
 * Operator that joins two input streams
 */
export class JoinOperator<K, V1, V2> extends BinaryOperator<
  [K, V1] | [K, V2] | [K, [V1, V2]]
> {
  #indexA = new Index<K, V1>()
  #indexB = new Index<K, V2>()

  constructor(
    id: number,
    inputA: DifferenceStreamReader<[K, V1]>,
    inputB: DifferenceStreamReader<[K, V2]>,
    output: DifferenceStreamWriter<[K, [V1, V2]]>
  ) {
    super(id, inputA, inputB, output)
  }

  run(): void {
    const deltaA = new Index<K, V1>()
    const deltaB = new Index<K, V2>()

    // Process input A - process ALL messages, not just the first one
    const messagesA = this.inputAMessages()
    for (const message of messagesA) {
      const multiSetMessage = message as unknown as MultiSet<[K, V1]>
      for (const [item, multiplicity] of multiSetMessage.getInner()) {
        const [key, value] = item
        deltaA.addValue(key, [value, multiplicity])
      }
    }

    // Process input B - process ALL messages, not just the first one
    const messagesB = this.inputBMessages()
    for (const message of messagesB) {
      const multiSetMessage = message as unknown as MultiSet<[K, V2]>
      for (const [item, multiplicity] of multiSetMessage.getInner()) {
        const [key, value] = item
        deltaB.addValue(key, [value, multiplicity])
      }
    }

    // Process results
    const results = new MultiSet<[K, [V1, V2]]>()

    // Join deltaA with existing indexB
    results.extend(deltaA.join(this.#indexB))

    // Append deltaA to indexA
    this.#indexA.append(deltaA)

    // Join existing indexA with deltaB
    results.extend(this.#indexA.join(deltaB))

    // Send results
    if (results.getInner().length > 0) {
      this.output.sendData(results)
    }

    // Append deltaB to indexB
    this.#indexB.append(deltaB)
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
  switch (type) {
    case `inner`:
      return innerJoin(other) as unknown as PipedOperator<
        T,
        KeyValue<K, [V1, V2]>
      >
    case `anti`:
      return antiJoin(other) as unknown as PipedOperator<
        T,
        KeyValue<K, [V1, null]>
      >
    case `left`:
      return leftJoin(other) as unknown as PipedOperator<
        T,
        KeyValue<K, [V1, V2 | null]>
      >
    case `right`:
      return rightJoin(other) as unknown as PipedOperator<
        T,
        KeyValue<K, [V1 | null, V2]>
      >
    case `full`:
      return fullJoin(other) as unknown as PipedOperator<
        T,
        KeyValue<K, [V1 | null, V2 | null]>
      >
    default:
      throw new Error(`Join type ${type} is invalid`)
  }
}

/**
 * Joins two input streams
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
  return (stream: IStreamBuilder<T>): IStreamBuilder<KeyValue<K, [V1, V2]>> => {
    if (stream.graph !== other.graph) {
      throw new Error(`Cannot join streams from different graphs`)
    }
    const output = new StreamBuilder<KeyValue<K, [V1, V2]>>(
      stream.graph,
      new DifferenceStreamWriter<KeyValue<K, [V1, V2]>>()
    )
    const operator = new JoinOperator<K, V1, V2>(
      stream.graph.getNextOperatorId(),
      stream.connectReader() as DifferenceStreamReader<KeyValue<K, V1>>,
      other.connectReader(),
      output.writer
    )
    stream.graph.addOperator(operator)
    stream.graph.addStream(output.connectReader())
    return output
  }
}

/**
 * Joins two input streams
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
  return (
    stream: IStreamBuilder<T>
  ): IStreamBuilder<KeyValue<K, [V1, null]>> => {
    const matchedLeft = stream.pipe(
      innerJoin(other),
      map(([key, [valueLeft, _valueRight]]) => [key, valueLeft])
    )
    const anti = stream.pipe(
      concat(matchedLeft.pipe(negate())),
      // @ts-ignore TODO: fix this
      map(([key, value]) => [key, [value, null]])
    )
    return anti as IStreamBuilder<KeyValue<K, [V1, null]>>
  }
}

/**
 * Joins two input streams
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
  return (
    stream: IStreamBuilder<T>
  ): IStreamBuilder<KeyValue<K, [V1, V2 | null]>> => {
    const left = stream
    const right = other
    const inner = left.pipe(innerJoin(right))
    const anti = left.pipe(antiJoin(right))
    return inner.pipe(concat(anti)) as IStreamBuilder<
      KeyValue<K, [V1, V2 | null]>
    >
  }
}

/**
 * Joins two input streams
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
  return (
    stream: IStreamBuilder<T>
  ): IStreamBuilder<KeyValue<K, [V1 | null, V2]>> => {
    const left = stream as IStreamBuilder<KeyValue<K, V1>>
    const right = other
    const inner = left.pipe(innerJoin(right))
    const anti = right.pipe(
      antiJoin(left),
      map(([key, [a, b]]) => [key, [b, a]])
    )
    return inner.pipe(concat(anti)) as IStreamBuilder<
      KeyValue<K, [V1 | null, V2]>
    >
  }
}

/**
 * Joins two input streams
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
  return (
    stream: IStreamBuilder<T>
  ): IStreamBuilder<KeyValue<K, [V1 | null, V2 | null]>> => {
    const left = stream as IStreamBuilder<KeyValue<K, V1>>
    const right = other
    const inner = left.pipe(innerJoin(right))
    const antiLeft = left.pipe(antiJoin(right))
    const antiRight = right.pipe(
      antiJoin(left),
      map(([key, [a, b]]) => [key, [b, a]])
    )
    return inner.pipe(concat(antiLeft), concat(antiRight)) as IStreamBuilder<
      KeyValue<K, [V1 | null, V2 | null]>
    >
  }
}
