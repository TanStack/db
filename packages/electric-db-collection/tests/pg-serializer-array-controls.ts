// Named finite-array controls: each input and the PostgreSQL array text that
// the independent decoder must read back as it. The serializer oracle runs
// each input through the real serializer; pg-serializer-calibration.test.ts
// decodes the hand-written outputs.
import type { FiniteArrayValue } from './pg-serializer-finite-decoder'

export const validArrays: Array<{
  name: string
  input: Array<FiniteArrayValue | undefined>
  output: string
}> = [
  { name: `empty`, input: [], output: `{}` },
  { name: `numbers`, input: [1, 2, -3, 1e21], output: `{1,2,-3,1e+21}` },
  {
    name: `booleans in order`,
    input: [false, true, false],
    output: `{false,true,false}`,
  },
  {
    name: `nullish multiplicity`,
    input: [null, undefined],
    output: `{NULL,NULL}`,
  },
  {
    name: `empty and NULL text`,
    input: [``, `NULL`, `null`],
    output: `{"","NULL","null"}`,
  },
  {
    name: `delimiters and escapes`,
    input: [`a,b`, `{z}`, `a"b`, `c\\d`],
    output: `{"a,b","{z}","a\\"b","c\\\\d"}`,
  },
  {
    name: `whitespace and typed-looking text`,
    input: [` leading `, `line\nbreak`, `0`, `true`],
    output: `{" leading ","line\nbreak","0","true"}`,
  },
]
