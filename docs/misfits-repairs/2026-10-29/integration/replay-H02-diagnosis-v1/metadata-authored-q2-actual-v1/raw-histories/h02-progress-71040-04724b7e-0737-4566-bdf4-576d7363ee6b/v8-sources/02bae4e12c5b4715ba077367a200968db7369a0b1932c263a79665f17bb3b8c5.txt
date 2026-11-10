import { assertTypedArray } from './assert.js'

const { Buffer } = globalThis // Buffer is optional

export function typedView(arr, format) {
  assertTypedArray(arr)
  switch (format) {
    case 'uint8':
      if (arr.constructor === Uint8Array) return arr // fast path
      return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
    case 'buffer':
      if (arr.constructor === Buffer && Buffer.isBuffer(arr)) return arr
      return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
  }

  throw new TypeError('Unexpected format')
}
