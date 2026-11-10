import { assertUint8 } from './assert.js'
import { isDeno, toBuf } from './fallback/_utils.js'
import { isAsciiSuperset, multibyteDecoder } from './fallback/multi-byte.js'
import { isAscii } from 'node:buffer'

export function createMultibyteDecoder(encoding, loose = false) {
  const jsDecoder = multibyteDecoder(encoding, loose) // asserts
  let streaming = false
  const asciiSuperset = isAsciiSuperset(encoding)
  return (arr, stream = false) => {
    assertUint8(arr)
    if (!streaming) {
      if (arr.byteLength === 0) return ''
      if (asciiSuperset && isAscii(arr)) {
        if (isDeno) return toBuf(arr).toString()
        return toBuf(arr).latin1Slice(0, arr.byteLength) // .latin1Slice is faster than .asciiSlice
      }
    }

    streaming = stream
    return jsDecoder(arr, stream)
  }
}
