/**
 * The debugger records loaded source only before the receiving history. All
 * protocol acknowledgements are required. No active inspector remains while
 * DB runs; later registry captures must bind to this sealed source inventory.
 *
 * @param {{post: (method: string, parameters: object, callback: (error: Error | null) => void) => void, disconnect: () => void}} session
 * @param {(value: Record<string, unknown>) => void} record
 */
export async function prepareStartupInspector(session, record) {
  /** @param {string} method @param {object} [parameters] */
  const command = (method, parameters = {}) =>
    new Promise((resolve, reject) => {
      session.post(method, parameters, (error) => {
        record({
          phase: `inspector-ack`,
          method,
          error: error ? String(error) : undefined,
        })
        if (error) reject(error)
        else resolve(undefined)
      })
    })
  // Set the policy before enabling the domain, including startup script events.
  await command(`Debugger.setSkipAllPauses`, { skip: true })
  await command(`Debugger.enable`)
  let sealed = false
  return {
    /** @param {() => Promise<void>} captureAndCheck */
    async seal(captureAndCheck) {
      if (sealed) throw new Error(`startup binding is already sealed`)
      await captureAndCheck()
      await command(`Debugger.disable`)
      session.disconnect()
      sealed = true
      record({ phase: `inspector-disconnected-before-history` })
    },
  }
}
