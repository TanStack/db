import { isDeno, isLE } from './fallback/_utils.js'
import { E_STRICT, E_STRICT_UNICODE } from './fallback/utf16.js'

if (Buffer.TYPED_ARRAY_SUPPORT) throw new Error('Unexpected Buffer polyfill')

const { isWellFormed, toWellFormed } = String.prototype
const to8 = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)

// Unlike utf8, operates on Uint16Arrays by default

function encode(str, loose = false, format = 'uint16') {
  if (typeof str !== 'string') throw new TypeError('Input is not a string')
  if (format !== 'uint16' && format !== 'uint8-le' && format !== 'uint8-be') {
    throw new TypeError('Unknown format')
  }

  if (loose) {
    str = toWellFormed.call(str) // Buffer doesn't do this with utf16 encoding
  } else if (!isWellFormed.call(str)) {
    throw new TypeError(E_STRICT_UNICODE)
  }

  const ble = Buffer.from(str, 'utf-16le')

  if (format === 'uint8-le') return to8(ble)
  if (format === 'uint8-be') return to8(ble.swap16())
  if (format === 'uint16') {
    const b = ble.byteOffset % 2 === 0 ? ble : Buffer.from(ble) // it should be already aligned, but just in case
    if (!isLE) b.swap16()
    return new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2)
  }

  throw new Error('Unreachable')
}

const swapped = (x, swap) =>
  swap ? Buffer.from(x).swap16() : Buffer.from(x.buffer, x.byteOffset, x.byteLength)

// We skip TextDecoder on Node.js, as it's is somewhy significantly slower than Buffer for utf16
// Also, it incorrectly misses replacements with Node.js is built without ICU, we fix that
function decodeNode(input, loose = false, format = 'uint16') {
  let ble
  if (format === 'uint16') {
    if (!(input instanceof Uint16Array)) throw new TypeError('Expected an Uint16Array')
    ble = swapped(input, !isLE)
  } else if (format === 'uint8-le' || format === 'uint8-be') {
    if (!(input instanceof Uint8Array)) throw new TypeError('Expected an Uint8Array')
    if (input.byteLength % 2 !== 0) throw new TypeError('Expected even number of bytes')
    ble = swapped(input, format === 'uint8-be')
  } else {
    throw new TypeError('Unknown format')
  }

  const str = ble.ucs2Slice(0, ble.byteLength)
  if (loose) return toWellFormed.call(str)
  if (isWellFormed.call(str)) return str
  throw new TypeError(E_STRICT)
}

function decodeDecoder(input, loose = false, format = 'uint16') {
  let encoding
  if (format === 'uint16') {
    if (!(input instanceof Uint16Array)) throw new TypeError('Expected an Uint16Array')
    encoding = isLE ? 'utf-16le' : 'utf-16be'
  } else if (format === 'uint8-le' || format === 'uint8-be') {
    if (!(input instanceof Uint8Array)) throw new TypeError('Expected an Uint8Array')
    if (input.byteLength % 2 !== 0) throw new TypeError('Expected even number of bytes')
    encoding = format === 'uint8-le' ? 'utf-16le' : 'utf-16be'
  } else {
    throw new TypeError('Unknown format')
  }

  return new TextDecoder(encoding, { ignoreBOM: true, fatal: !loose }).decode(input) // TODO: cache decoder?
}

const decode = isDeno ? decodeDecoder : decodeNode

export const utf16fromString = (str, format = 'uint16') => encode(str, false, format)
export const utf16fromStringLoose = (str, format = 'uint16') => encode(str, true, format)
export const utf16toString = (arr, format = 'uint16') => decode(arr, false, format)
export const utf16toStringLoose = (arr, format = 'uint16') => decode(arr, true, format)
