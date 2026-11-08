// declareOracle lives in @tanstack/oracles/declaration, which loads no Node
// built-ins. Browser and native tests declare their oracle's parts through this
// path, so it does not import the Node-only replay machinery.
export * from '@tanstack/oracles/declaration'
