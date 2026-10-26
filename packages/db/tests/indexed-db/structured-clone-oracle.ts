/**
 * Value fidelity is independent of lifecycle ordering. IndexedDB persists
 * structured-clone values; changing a scalar sibling must preserve an untouched
 * rich field through persistence, notification, export and restore.
 *
 * The reference is an authored description, never a copy of observed storage.
 * Construction and observation are separate formulations: construction uses
 * native constructors; observation checks tags and contents. Byte offset and
 * backing bytes matter, while object identity and custom prototypes do not.
 * The bounded corpus excludes mutation after submission, cycles, Map/Set,
 * detached/shared/resizable buffers, custom classes and schema transforms.
 */
export const valueKinds = [
  'date',
  'buffer',
  'uint8',
  'data-view',
  'bigint64',
  'blob',
  'nested',
] as const
export type ValueKind = (typeof valueKinds)[number]
export type ValueDescription =
  | { type: 'Date'; timestamp: number }
  | { type: 'ArrayBuffer'; bytes: Array<number> }
  | {
      type: 'Uint8Array' | 'DataView' | 'BigInt64Array'
      offset: number
      length: number
      bytes: Array<number>
    }
  | { type: 'Blob'; mime: string; bytes: Array<number> }
  | { type: 'Array'; values: Array<ValueDescription> }

// Odd buffers and nonzero offsets distinguish preserved native views from
// flattening to an array or copying only the viewed slice. BigInt bytes are
// endian-independent: construct from bytes instead of encoding a machine word.
export function expectedValue(kind: ValueKind): ValueDescription {
  const bytes = [3, 17, 0, 255, 8]
  switch (kind) {
    case 'date':
      return { type: 'Date', timestamp: 1735689600123 }
    case 'buffer':
      return { type: 'ArrayBuffer', bytes }
    case 'uint8':
      return { type: 'Uint8Array', offset: 1, length: 3, bytes }
    case 'data-view':
      return { type: 'DataView', offset: 2, length: 2, bytes }
    case 'bigint64':
      return {
        type: 'BigInt64Array',
        offset: 8,
        length: 8,
        bytes: Array.from({ length: 24 }, (_, index) => index),
      }
    case 'blob':
      return { type: 'Blob', mime: 'application/octet-stream', bytes }
    case 'nested':
      return {
        type: 'Array',
        values: [
          expectedValue('date'),
          expectedValue('uint8'),
          expectedValue('blob'),
        ],
      }
  }
}

// Production inputs are freshly constructed, with no mutable object shared
// with the reference descriptions. The row wraps this value at a nested path.
export function createValue(kind: ValueKind): unknown {
  const buffer = new Uint8Array([3, 17, 0, 255, 8]).buffer
  switch (kind) {
    case 'date':
      return new Date('2025-01-01T00:00:00.123Z')
    case 'buffer':
      return buffer
    case 'uint8':
      return new Uint8Array(buffer, 1, 3)
    case 'data-view':
      return new DataView(buffer, 2, 2)
    case 'bigint64':
      return new BigInt64Array(
        new Uint8Array(Array.from({ length: 24 }, (_, index) => index)).buffer,
        8,
        1,
      )
    case 'blob':
      return new Blob([buffer], { type: 'application/octet-stream' })
    case 'nested':
      return [createValue('date'), createValue('uint8'), createValue('blob')]
  }
}

// Execute inside the receiving realm before browser/worker serialization can
// flatten the value. Unknown shapes remain observable and cannot pass as an
// empty object. No production comparator or serializer computes this judgment.
export async function observeValue(value: unknown): Promise<unknown> {
  const type = Object.prototype.toString.call(value).slice(8, -1)
  if (value instanceof Date) return { type, timestamp: value.getTime() }
  if (value instanceof ArrayBuffer)
    return { type, bytes: [...new Uint8Array(value)] }
  if (ArrayBuffer.isView(value))
    return {
      type,
      offset: value.byteOffset,
      length: value.byteLength,
      bytes: [...new Uint8Array(value.buffer)],
    }
  if (value instanceof Blob)
    return {
      type,
      mime: value.type,
      bytes: [...new Uint8Array(await value.arrayBuffer())],
    }
  if (Array.isArray(value))
    return { type, values: await Promise.all(value.map(observeValue)) }
  return { type, unexpected: String(value) }
}

export type ValueRow = { id: number; name: string; nested: { value: unknown } }
export async function observeValueRows(rows: Iterable<ValueRow>) {
  return Promise.all(
    [...rows]
      .sort((a, b) => a.id - b.id)
      .map(async (row) => ({
        id: row.id,
        name: row.name,
        nested: { value: await observeValue(row.nested.value) },
      })),
  )
}
export function expectedValueRows(kind: ValueKind, name: string, id = 1) {
  return [{ id, name, nested: { value: expectedValue(kind) } }]
}
