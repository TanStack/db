import { asciiPrefix, decodeAscii, decodeLatin1, decodeUCS2 } from './latin1.js'
import { getTable } from './multi-byte.table.js'

export const E_STRICT = 'Input is not well-formed for this encoding'

// TODO: optimize

// If the decoder is not cleared properly, state can be preserved between non-streaming calls!
// See comment about fatal stream

// Common between euc-kr and big5
function bigDecoder(err, pair) {
  let lead = 0
  let oi = 0
  let o16

  const decodeLead = (b) => {
    const p = pair(lead, b)
    lead = 0
    if (typeof p === 'number') {
      o16[oi++] = p
    } else if (p) {
      // This is still faster than string concatenation. Can we optimize strings though?
      for (let i = 0; i < p.length; i++) o16[oi++] = p.charCodeAt(i)
    } else {
      o16[oi++] = err()
      if (b < 128) o16[oi++] = b
    }
  }

  const decode = (arr, start, end, stream) => {
    let i = start
    o16 = new Uint16Array(end - start + (lead ? 1 : 0)) // there are pairs but they consume more than one byte
    oi = 0

    if (lead && i < end) decodeLead(arr[i++])
    while (i < end) {
      const b = arr[i++]
      if (b < 128) {
        o16[oi++] = b
      } else if (b === 0x80 || b === 0xff) {
        o16[oi++] = err()
      } else {
        lead = b
        if (i < end) decodeLead(arr[i++])
      }
    }

    if (lead && !stream) {
      lead = 0
      o16[oi++] = err()
    }

    const res = decodeUCS2(o16, oi)
    o16 = null
    return res
  }

  return { decode, isAscii: () => lead === 0 }
}

// All except iso-2022-jp are ASCII supersets
// When adding something that is not an ASCII superset, ajust the ASCII fast path
const REP = 0xff_fd
const mappers = {
  // https://encoding.spec.whatwg.org/#euc-kr-decoder
  'euc-kr': (err) => {
    const euc = getTable('euc-kr')
    return bigDecoder(err, (l, b) => {
      if (b < 0x41 || b > 0xfe) return
      const cp = euc[(l - 0x81) * 190 + b - 0x41]
      return cp !== undefined && cp !== REP ? cp : undefined
    })
  },
  // https://encoding.spec.whatwg.org/#euc-jp-decoder
  'euc-jp': (err) => {
    const jis0208 = getTable('jis0208')
    const jis0212 = getTable('jis0212')
    let j12 = false
    let lead = 0
    let oi = 0
    let o16

    const decodeLead = (b) => {
      if (lead === 0x8e && b >= 0xa1 && b <= 0xdf) {
        lead = 0
        o16[oi++] = 0xfe_c0 + b
      } else if (lead === 0x8f && b >= 0xa1 && b <= 0xfe) {
        j12 = true
        lead = b
      } else {
        let cp
        if (lead >= 0xa1 && lead <= 0xfe && b >= 0xa1 && b <= 0xfe) {
          cp = (j12 ? jis0212 : jis0208)[(lead - 0xa1) * 94 + b - 0xa1]
        }

        lead = 0
        j12 = false
        if (cp !== undefined && cp !== REP) {
          o16[oi++] = cp
        } else {
          o16[oi++] = err()
          if (b < 128) o16[oi++] = b
        }
      }
    }

    const decode = (arr, start, end, stream) => {
      let i = start
      o16 = new Uint16Array(end - start + (lead ? 1 : 0))
      oi = 0

      if (lead && i < end) decodeLead(arr[i++])
      if (lead && i < end) decodeLead(arr[i++]) // could be two leads, but no more
      while (i < end) {
        const b = arr[i++]
        if (b < 128) {
          o16[oi++] = b
        } else if ((b < 0xa1 && b !== 0x8e && b !== 0x8f) || b === 0xff) {
          o16[oi++] = err()
        } else {
          lead = b
          if (i < end) decodeLead(arr[i++])
          if (lead && i < end) decodeLead(arr[i++]) // could be two leads
        }
      }

      if (lead && !stream) {
        lead = 0
        j12 = false // can be true only when lead is non-zero
        o16[oi++] = err()
      }

      const res = decodeUCS2(o16, oi)
      o16 = null
      return res
    }

    return { decode, isAscii: () => lead === 0 } // j12 can be true only when lead is non-zero
  },
  // https://encoding.spec.whatwg.org/#iso-2022-jp-decoder
  'iso-2022-jp': (err) => {
    const jis0208 = getTable('jis0208')
    let dState = 1
    let oState = 1
    let lead = 0 // 0 or 0x21-0x7e
    let out = false

    const bytes = (pushback, b) => {
      if (dState < 5 && b === 0x1b) {
        dState = 6 // escape start
        return
      }

      switch (dState) {
        case 1:
        case 2:
          // ASCII, Roman (common)
          out = false
          if (dState === 2) {
            if (b === 0x5c) return 0xa5
            if (b === 0x7e) return 0x20_3e
          }

          if (b <= 0x7f && b !== 0x0e && b !== 0x0f) return b
          return err()
        case 3:
          // Katakana
          out = false
          if (b >= 0x21 && b <= 0x5f) return 0xff_40 + b
          return err()
        case 4:
          // Leading byte
          out = false
          if (b < 0x21 || b > 0x7e) return err()
          lead = b
          dState = 5
          return
        case 5:
          // Trailing byte
          out = false
          if (b === 0x1b) {
            dState = 6 // escape start
            return err()
          }

          dState = 4
          if (b >= 0x21 && b <= 0x7e) {
            const cp = jis0208[(lead - 0x21) * 94 + b - 0x21]
            if (cp !== undefined && cp !== REP) return cp
          }

          return err()
        case 6:
          // Escape start
          if (b === 0x24 || b === 0x28) {
            lead = b
            dState = 7
            return
          }

          out = false
          dState = oState
          pushback.push(b)
          return err()
        case 7: {
          // Escape
          const l = lead
          lead = 0
          let s
          if (l === 0x28) {
            // eslint-disable-next-line unicorn/prefer-switch
            if (b === 0x42) {
              s = 1
            } else if (b === 0x4a) {
              s = 2
            } else if (b === 0x49) {
              s = 3
            }
          } else if (l === 0x24 && (b === 0x40 || b === 0x42)) {
            s = 4
          }

          if (s) {
            dState = oState = s
            const output = out
            out = true
            return output ? err() : undefined
          }

          out = false
          dState = oState
          pushback.push(b, l)
          return err()
        }
      }
    }

    const eof = (pushback) => {
      if (dState < 5) return null
      out = false
      switch (dState) {
        case 5:
          dState = 4
          return err()
        case 6:
          dState = oState
          return err()
        case 7: {
          dState = oState
          pushback.push(lead)
          lead = 0
          return err()
        }
      }
    }

    const decode = (arr, start, end, stream) => {
      const o16 = new Uint16Array(end - start + 2) // err in eof + lead from state
      let oi = 0
      let i = start
      const pushback = [] // local and auto-cleared

      // First, dump everything until EOF
      // Same as the full loop, but without EOF handling
      while (i < end || pushback.length > 0) {
        const c = bytes(pushback, pushback.length > 0 ? pushback.pop() : arr[i++])
        if (c !== undefined) o16[oi++] = c // 16-bit
      }

      // Then, dump EOF. This needs the same loop as the characters can be pushed back
      if (!stream) {
        while (i <= end || pushback.length > 0) {
          if (i < end || pushback.length > 0) {
            const c = bytes(pushback, pushback.length > 0 ? pushback.pop() : arr[i++])
            if (c !== undefined) o16[oi++] = c // 16-bit
          } else {
            const c = eof(pushback)
            if (c === null) break // clean exit
            o16[oi++] = c
          }
        }
      }

      // Chrome and WebKit fail on this, we don't: completely destroy the old decoder state when finished streaming
      // > If this’s do not flush is false, then set this’s decoder to a new instance of this’s encoding’s decoder,
      // > Set this’s do not flush to options["stream"]
      if (!stream) {
        dState = oState = 1
        lead = 0
        out = false
      }

      return decodeUCS2(o16, oi)
    }

    return { decode, isAscii: () => false }
  },
  // https://encoding.spec.whatwg.org/#shift_jis-decoder
  shift_jis: (err) => {
    const jis0208 = getTable('jis0208')
    let lead = 0
    let oi = 0
    let o16

    const decodeLead = (b) => {
      const l = lead
      lead = 0
      if (b >= 0x40 && b <= 0xfc && b !== 0x7f) {
        const p = (l - (l < 0xa0 ? 0x81 : 0xc1)) * 188 + b - (b < 0x7f ? 0x40 : 0x41)
        if (p >= 8836 && p <= 10_715) {
          o16[oi++] = 0xe0_00 - 8836 + p
          return
        }

        const cp = jis0208[p]
        if (cp !== undefined && cp !== REP) {
          o16[oi++] = cp
          return
        }
      }

      o16[oi++] = err()
      if (b < 128) o16[oi++] = b
    }

    const decode = (arr, start, end, stream) => {
      o16 = new Uint16Array(end - start + (lead ? 1 : 0))
      oi = 0
      let i = start

      if (lead && i < end) decodeLead(arr[i++])
      while (i < end) {
        const b = arr[i++]
        if (b <= 0x80) {
          o16[oi++] = b // 0x80 is allowed
        } else if (b >= 0xa1 && b <= 0xdf) {
          o16[oi++] = 0xfe_c0 + b
        } else if (b === 0xa0 || b > 0xfc) {
          o16[oi++] = err()
        } else {
          lead = b
          if (i < end) decodeLead(arr[i++])
        }
      }

      if (lead && !stream) {
        lead = 0
        o16[oi++] = err()
      }

      const res = decodeUCS2(o16, oi)
      o16 = null
      return res
    }

    return { decode, isAscii: () => lead === 0 }
  },
  // https://encoding.spec.whatwg.org/#gbk-decoder
  gbk: (err) => mappers.gb18030(err), // 10.1.1. GBK’s decoder is gb18030’s decoder
  // https://encoding.spec.whatwg.org/#gb18030-decoder
  gb18030: (err) => {
    const gb18030 = getTable('gb18030')
    const gb18030r = getTable('gb18030-ranges')
    let g1 = 0, g2 = 0, g3 = 0 // prettier-ignore
    const index = (p) => {
      if ((p > 39_419 && p < 189_000) || p > 1_237_575) return
      if (p === 7457) return 0xe7_c7
      let a = 0, b = 0 // prettier-ignore
      for (const [c, d] of gb18030r) {
        if (c > p) break
        a = c
        b = d
      }

      return b + p - a
    }

    // g1 is 0 or 0x81-0xfe
    // g2 is 0 or 0x30-0x39
    // g3 is 0 or 0x81-0xfe

    const decode = (arr, start, end, stream) => {
      const o16 = new Uint16Array(end - start + (g1 ? 3 : 0)) // even with pushback it's at most 1 char per byte
      let oi = 0
      let i = start
      const pushback = [] // local and auto-cleared

      // First, dump everything until EOF
      // Same as the full loop, but without EOF handling
      while (i < end || pushback.length > 0) {
        const b = pushback.length > 0 ? pushback.pop() : arr[i++]
        if (g1) {
          // g2 can be set only when g1 is set, g3 can be set only when g2 is set
          // hence, 3 checks for g3 is faster than 3 checks for g1
          if (g2) {
            if (g3) {
              if (b < 0x30 || b > 0x39) {
                pushback.push(b, g3, g2)
                g1 = g2 = g3 = 0
                o16[oi++] = err()
              } else {
                const p = index(
                  (g1 - 0x81) * 12_600 + (g2 - 0x30) * 1260 + (g3 - 0x81) * 10 + b - 0x30
                )
                g1 = g2 = g3 = 0
                if (p === undefined) {
                  o16[oi++] = err()
                } else if (p <= 0xff_ff) {
                  o16[oi++] = p // Can validly return replacement
                } else {
                  const d = p - 0x1_00_00
                  o16[oi++] = 0xd8_00 | (d >> 10)
                  o16[oi++] = 0xdc_00 | (d & 0x3_ff)
                }
              }
            } else if (b >= 0x81 && b <= 0xfe) {
              g3 = b
            } else {
              pushback.push(b, g2)
              g1 = g2 = 0
              o16[oi++] = err()
            }
          } else if (b >= 0x30 && b <= 0x39) {
            g2 = b
          } else {
            let cp
            if (b >= 0x40 && b <= 0xfe && b !== 0x7f) {
              cp = gb18030[(g1 - 0x81) * 190 + b - (b < 0x7f ? 0x40 : 0x41)]
            }

            g1 = 0
            if (cp !== undefined && cp !== REP) {
              o16[oi++] = cp // 16-bit
            } else {
              o16[oi++] = err()
              if (b < 128) o16[oi++] = b // can be processed immediately
            }
          }
        } else if (b < 128) {
          o16[oi++] = b
        } else if (b === 0x80) {
          o16[oi++] = 0x20_ac
        } else if (b === 0xff) {
          o16[oi++] = err()
        } else {
          g1 = b
        }
      }

      // if g1 = 0 then g2 = g3 = 0
      if (g1 && !stream) {
        g1 = g2 = g3 = 0
        o16[oi++] = err()
      }

      return decodeUCS2(o16, oi)
    }

    return { decode, isAscii: () => g1 === 0 } // if g1 = 0 then g2 = g3 = 0
  },
  // https://encoding.spec.whatwg.org/#big5
  big5: (err) => {
    // The only decoder which returns multiple codepoints per byte, also has non-charcode codepoints
    // We store that as strings
    const big5 = getTable('big5')
    return bigDecoder(err, (l, b) => {
      if (b < 0x40 || (b > 0x7e && b < 0xa1) || b === 0xff) return
      return big5[(l - 0x81) * 157 + b - (b < 0x7f ? 0x40 : 0x62)] // strings
    })
  },
}

export const isAsciiSuperset = (enc) => enc !== 'iso-2022-jp' // all others are ASCII supersets and can use fast path

export function multibyteDecoder(enc, loose = false) {
  if (typeof loose !== 'boolean') throw new TypeError('loose option should be boolean')
  if (!Object.hasOwn(mappers, enc)) throw new RangeError('Unsupported encoding')

  // Input is assumed to be typechecked already
  let mapper
  const asciiSuperset = isAsciiSuperset(enc)
  let streaming // because onErr is cached in mapper
  const onErr = loose
    ? () => REP
    : () => {
        // The correct way per spec seems to be not destoying the decoder state in stream mode, even when fatal
        // Decoders big5, euc-jp, euc-kr, shift_jis, gb18030 / gbk - all clear state before throwing unless EOF, so not affected
        // iso-2022-jp is the only tricky one one where this !stream check matters in non-stream mode
        if (!streaming) mapper = null // destroy state, effectively the same as 'do not flush' = false, but early
        throw new TypeError(E_STRICT)
      }

  return (arr, stream = false) => {
    let res = ''
    if (asciiSuperset && (!mapper || mapper.isAscii?.())) {
      const prefixLen = asciiPrefix(arr)
      if (prefixLen === arr.length) return decodeAscii(arr) // ascii
      res = decodeLatin1(arr, 0, prefixLen) // TODO: check if decodeAscii with subarray is faster for small prefixes too
    }

    streaming = stream // affects onErr
    if (!mapper) mapper = mappers[enc](onErr)
    return res + mapper.decode(arr, res.length, arr.length, stream)
  }
}
