const { Buffer, TextEncoder, TextDecoder } = globalThis
const haveNativeBuffer = Buffer && !Buffer.TYPED_ARRAY_SUPPORT
export const nativeBuffer = haveNativeBuffer ? Buffer : null
export const isHermes = Boolean(globalThis.HermesInternal)
export const isDeno = Boolean(globalThis.Deno)
export const isLE = new Uint8Array(Uint16Array.of(258).buffer)[0] === 2

// We consider Node.js TextDecoder/TextEncoder native
let isNative = (x) => x && (haveNativeBuffer || `${x}`.includes('[native code]'))
if (!haveNativeBuffer && isNative(() => {})) isNative = () => false // e.g. XS, we don't want false positives

export const nativeEncoder = isNative(TextEncoder) ? new TextEncoder() : null
export const nativeDecoder = isNative(TextDecoder)
  ? new TextDecoder('utf-8', { ignoreBOM: true })
  : null

// Actually windows-1252, compatible with ascii and latin1 decoding
// Beware that on non-latin1, i.e. on windows-1252, this is broken in ~all Node.js versions released
// in 2025 due to a regression, so we call it Latin1 as it's usable only for that
let nativeDecoderLatin1impl = null
if (nativeDecoder) {
  // Not all barebone engines with TextDecoder support something except utf-8, detect
  try {
    nativeDecoderLatin1impl = new TextDecoder('latin1', { ignoreBOM: true })
  } catch {}
}

export const nativeDecoderLatin1 = nativeDecoderLatin1impl
export const canDecoders = Boolean(nativeDecoderLatin1impl)

// Block Firefox < 146 specifically from using native hex/base64, as it's very slow there
// Refs: https://bugzilla.mozilla.org/show_bug.cgi?id=1994067 (and linked issues), fixed in 146
// Before that, all versions of Firefox >= 133 are slow
// TODO: this could be removed when < 146 usage diminishes (note ESR)
// We do not worry about false-negatives here but worry about false-positives!
function shouldSkipBuiltins() {
  const g = globalThis
  // First, attempt to exclude as many things as we can using trivial checks, just in case, and to not hit ua
  if (haveNativeBuffer || isHermes || !g.window || g.chrome || !g.navigator) return false
  try {
    // This was fixed specifically in Firefox 146. Other engines except Hermes (already returned) get this right
    new WeakSet().add(Symbol()) // eslint-disable-line symbol-description
    return false
  } catch {
    // In catch and not after in case if something too smart optimizes out code in try. False-negative is acceptable in that case
    if (!('onmozfullscreenerror' in g)) return false // Firefox has it (might remove in the future, but we don't care)
    return /firefox/i.test(g.navigator.userAgent || '') // as simple as we can
  }

  return false // eslint-disable-line no-unreachable
}

export const skipWeb = shouldSkipBuiltins()

function decodePartAddition(a, start, end, m) {
  let o = ''
  let i = start
  for (const last3 = end - 3; i < last3; i += 4) {
    const x0 = a[i]
    const x1 = a[i + 1]
    const x2 = a[i + 2]
    const x3 = a[i + 3]
    o += m[x0]
    o += m[x1]
    o += m[x2]
    o += m[x3]
  }

  while (i < end) o += m[a[i++]]
  return o
}

// Decoding with templates is faster on Hermes
function decodePartTemplates(a, start, end, m) {
  let o = ''
  let i = start
  for (const last15 = end - 15; i < last15; i += 16) {
    const x0 = a[i]
    const x1 = a[i + 1]
    const x2 = a[i + 2]
    const x3 = a[i + 3]
    const x4 = a[i + 4]
    const x5 = a[i + 5]
    const x6 = a[i + 6]
    const x7 = a[i + 7]
    const x8 = a[i + 8]
    const x9 = a[i + 9]
    const x10 = a[i + 10]
    const x11 = a[i + 11]
    const x12 = a[i + 12]
    const x13 = a[i + 13]
    const x14 = a[i + 14]
    const x15 = a[i + 15]
    o += `${m[x0]}${m[x1]}${m[x2]}${m[x3]}${m[x4]}${m[x5]}${m[x6]}${m[x7]}${m[x8]}${m[x9]}${m[x10]}${m[x11]}${m[x12]}${m[x13]}${m[x14]}${m[x15]}`
  }

  while (i < end) o += m[a[i++]]
  return o
}

const decodePart = isHermes ? decodePartTemplates : decodePartAddition
export function decode2string(arr, start, end, m) {
  if (end - start > 30_000) {
    // Limit concatenation to avoid excessive GC
    // Thresholds checked on Hermes for toHex
    const concat = []
    for (let i = start; i < end; ) {
      const step = i + 500
      const iNext = step > end ? end : step
      concat.push(decodePart(arr, i, iNext, m))
      i = iNext
    }

    const res = concat.join('')
    concat.length = 0
    return res
  }

  return decodePart(arr, start, end, m)
}

export function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}

// On arrays in heap (<= 64) it's cheaper to copy into a pooled buffer than lazy-create the ArrayBuffer storage
export const toBuf = (x) =>
  x.byteLength <= 64 && x.BYTES_PER_ELEMENT === 1
    ? Buffer.from(x)
    : Buffer.from(x.buffer, x.byteOffset, x.byteLength)
