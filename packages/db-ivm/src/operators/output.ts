// Output and tap both call back once per message and forward that same message.
// Keep both public names while sharing the operator and its graph wiring.
export { TapOperator as OutputOperator, tap as output } from './tap.js'
