// declareOracle has no imports, so a module that runs in a browser or a
// native app can declare its parts without loading the Node-only replay
// machinery in oracle-config.ts.

/** A function or class that an oracle declares as one of its parts. */
type OraclePart =
  ((...args: never) => unknown) | (abstract new (...args: never) => unknown)

/**
 * Names the parts of an oracle that this module defines: its check, which
 * compares production observations with the model or with a second
 * formulation; its model; and its history grammar, the generators that
 * produce legal histories. A type-level oracle names its model types in
 * `typeModel`. Each is optional: a differential or metamorphic
 * oracle has no model, and a companion module can hold only one part.
 *
 * Every test in an oracle file must use a declared part, directly or through
 * a driver. A test that uses none compares production with a hand-written
 * value: it is a unit test, and belongs in an ordinary test file. The
 * `oracle/no-unit-test` lint rule reads this call. It does nothing at run
 * time.
 */
export function declareOracle(_parts: {
  check?: ReadonlyArray<OraclePart>
  model?: ReadonlyArray<OraclePart>
  // A grammar part is often a fast-check arbitrary, not a function.
  grammar?: ReadonlyArray<object>
  // A type-level oracle's model is a type, which has no value to pass, so it
  // is named: each name is a type alias or interface in the same file.
  typeModel?: ReadonlyArray<string>
}): void {}
