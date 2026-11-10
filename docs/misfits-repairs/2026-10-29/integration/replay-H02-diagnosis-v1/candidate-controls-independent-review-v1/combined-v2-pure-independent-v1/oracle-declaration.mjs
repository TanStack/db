// declareOracle has no imports, so a module that runs in a browser or a
// native app can declare its parts without loading the Node-only replay
// machinery in oracle-config.ts.
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
export function declareOracle(_parts) { }
