import { decodeUCS2, encodeCharcodes } from './latin1.js'
import { isLE } from './_utils.js'

export const E_STRICT = 'Input is not well-formed utf16'
export const E_STRICT_UNICODE = 'Input is not well-formed Unicode'

const replacementCodepoint = 0xff_fd
const replacementCodepointSwapped = 0xfd_ff

const to16 = (a) => new Uint16Array(a.buffer, a.byteOffset, a.byteLength / 2) // Requires checked length and alignment!

export function to16input(u8, le) {
  // Assume even number of bytes
  if (le === isLE) return to16(u8.byteOffset % 2 === 0 ? u8 : Uint8Array.from(u8))

  const res = new Uint8Array(u8.length)

  let i = 0
  for (const last3 = u8.length - 3; i < last3; i += 4) {
    const x0 = u8[i]
    const x1 = u8[i + 1]
    const x2 = u8[i + 2]
    const x3 = u8[i + 3]
    res[i] = x1
    res[i + 1] = x0
    res[i + 2] = x3
    res[i + 3] = x2
  }

  for (const last = u8.length - 1; i < last; i += 2) {
    const x0 = u8[i]
    const x1 = u8[i + 1]
    res[i] = x1
    res[i + 1] = x0
  }

  return to16(res)
}

export const decode = (u16, loose = false, checked = false) => {
  if (checked || isWellFormed(u16)) return decodeUCS2(u16)
  if (!loose) throw new TypeError(E_STRICT)
  return decodeUCS2(toWellFormed(Uint16Array.from(u16))) // cloned for replacement
}

export function encode(str, loose = false, checked = false, swapped = false) {
  const arr = new Uint16Array(str.length)
  if (checked) return swapped ? encodeCheckedSwapped(str, arr) : encodeChecked(str, arr)
  return swapped ? encodeUncheckedSwapped(str, arr, loose) : encodeUnchecked(str, arr, loose)
}

// Splitting paths into small functions helps (at least on SpiderMonkey)
/* eslint-disable @exodus/mutable/no-param-reassign-prop-only */

const encodeChecked = (str, arr) => encodeCharcodes(str, arr) // Same as encodeLatin1, but with Uint16Array

function encodeCheckedSwapped(str, arr) {
  // TODO: faster path for Hermes? See encodeCharcodes
  const length = str.length
  for (let i = 0; i < length; i++) {
    const x = str.charCodeAt(i)
    arr[i] = ((x & 0xff) << 8) | (x >> 8)
  }

  return arr
}

// lead: d800 - dbff, trail: dc00 - dfff

function encodeUnchecked(str, arr, loose = false) {
  // TODO: faster path for Hermes? See encodeCharcodes
  const length = str.length
  for (let i = 0; i < length; i++) {
    const code = str.charCodeAt(i)
    arr[i] = code
    if (code >= 0xd8_00 && code < 0xe0_00) {
      // An unexpected trail or a lead at the very end of input
      if (code > 0xdb_ff || i + 1 >= length) {
        if (!loose) throw new TypeError(E_STRICT_UNICODE)
        arr[i] = replacementCodepoint
      } else {
        const next = str.charCodeAt(i + 1) // Process valid pairs immediately
        if (next < 0xdc_00 || next >= 0xe0_00) {
          if (!loose) throw new TypeError(E_STRICT_UNICODE)
          arr[i] = replacementCodepoint
        } else {
          i++ // consume next
          arr[i] = next
        }
      }
    }
  }

  return arr
}

function encodeUncheckedSwapped(str, arr, loose = false) {
  // TODO: faster path for Hermes? See encodeCharcodes
  const length = str.length
  for (let i = 0; i < length; i++) {
    const code = str.charCodeAt(i)
    arr[i] = ((code & 0xff) << 8) | (code >> 8)
    if (code >= 0xd8_00 && code < 0xe0_00) {
      // An unexpected trail or a lead at the very end of input
      if (code > 0xdb_ff || i + 1 >= length) {
        if (!loose) throw new TypeError(E_STRICT_UNICODE)
        arr[i] = replacementCodepointSwapped
      } else {
        const next = str.charCodeAt(i + 1) // Process valid pairs immediately
        if (next < 0xdc_00 || next >= 0xe0_00) {
          if (!loose) throw new TypeError(E_STRICT_UNICODE)
          arr[i] = replacementCodepointSwapped
        } else {
          i++ // consume next
          arr[i] = ((next & 0xff) << 8) | (next >> 8)
        }
      }
    }
  }

  return arr
}

export function toWellFormed(u16) {
  const length = u16.length
  for (let i = 0; i < length; i++) {
    const code = u16[i]
    if (code >= 0xd8_00 && code < 0xe0_00) {
      // An unexpected trail or a lead at the very end of input
      if (code > 0xdb_ff || i + 1 >= length) {
        u16[i] = replacementCodepoint
      } else {
        const next = u16[i + 1] // Process valid pairs immediately
        if (next < 0xdc_00 || next >= 0xe0_00) {
          u16[i] = replacementCodepoint
        } else {
          i++ // consume next
        }
      }
    }
  }

  return u16
}

export function isWellFormed(u16) {
  const length = u16.length
  let i = 0

  // Speedup with u32, by skipping to the first surrogate
  // Only implemented for aligned input for now, but almost all input is aligned (pooled Buffer or 0 offset)
  if (length > 32 && u16.byteOffset % 4 === 0) {
    const u32length = (u16.byteLength / 4) | 0
    const u32 = new Uint32Array(u16.buffer, u16.byteOffset, u32length)
    for (const last3 = u32length - 3; ; i += 4) {
      if (i >= last3) break // loop is fast enough for moving this here to be _very_ useful, likely due to array access checks
      const a = u32[i]
      const b = u32[i + 1]
      const c = u32[i + 2]
      const d = u32[i + 3]
      if (a & 0x80_00_80_00 || b & 0x80_00_80_00 || c & 0x80_00_80_00 || d & 0x80_00_80_00) break
    }

    for (; i < u32length; i++) if (u32[i] & 0x80_00_80_00) break
    i *= 2
  }

  for (; i < length; i++) {
    const code = u16[i]
    if (code >= 0xd8_00 && code < 0xe0_00) {
      // An unexpected trail or a lead at the very end of input
      if (code > 0xdb_ff || i + 1 >= length) return false
      i++ // consume next
      const next = u16[i] // Process valid pairs immediately
      if (next < 0xdc_00 || next >= 0xe0_00) return false
    }
  }

  return true
}
