import { createMultibyteDecoder } from '@exodus/bytes/multi-byte.js' // eslint-disable-line @exodus/import/no-unresolved
import { setMultibyteDecoder } from './fallback/encoding.js'

setMultibyteDecoder(createMultibyteDecoder)

export {
  TextDecoder,
  TextEncoder,
  TextDecoderStream,
  TextEncoderStream,
  normalizeEncoding,
  getBOMEncoding,
  labelToName,
  legacyHookDecode,
} from './fallback/encoding.js'
