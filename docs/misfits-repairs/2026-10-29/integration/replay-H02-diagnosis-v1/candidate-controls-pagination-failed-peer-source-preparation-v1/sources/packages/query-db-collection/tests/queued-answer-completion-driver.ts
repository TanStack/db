export { driveCompletionBaselineProgram } from './queued-answer-completion-baseline-driver.js'

/** Future controls remain unavailable until their exact source binding exists. */
export function refuseUnboundCompletionCandidate(): never {
  throw new Error(
    `candidate-program binding is not prepared: exact future completion incarnation and registration observations are required before receiving admission`,
  )
}
