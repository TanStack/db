import { spawn } from "node:child_process"
import { afterAll, beforeAll } from "vitest"
import type { ChildProcess } from "node:child_process"

let emulatorProcess: ChildProcess | null = null

beforeAll(async () => {
  // Start Firebase emulator
  emulatorProcess = spawn(
    `firebase`,
    [`emulators:start`, `--only`, `firestore`],
    {
      stdio: `pipe`,
      detached: false,
      shell: true,
    }
  )

  // Wait a bit for the emulator to start
  await new Promise((resolve) => {
    let output = ``

    const checkReady = (data: Buffer) => {
      output += data.toString()
      if (output.includes(`All emulators ready`)) {
        emulatorProcess?.stdout?.off(`data`, checkReady)
        console.log(`it's ready`)
        resolve(void 0)
      }
    }

    emulatorProcess?.stdout?.on(`data`, checkReady)

    // Fallback timeout
    setTimeout(() => {
      emulatorProcess?.stdout?.off(`data`, checkReady)
      resolve(void 0)
    }, 15000)
  })
}, 30000) // 30 second timeout for setup

afterAll(async () => {
  // Clean up emulator process
  if (emulatorProcess) {
    emulatorProcess.kill(`SIGTERM`)

    // Wait for process to exit
    await new Promise((resolve) => {
      emulatorProcess?.on(`exit`, resolve)
      setTimeout(resolve, 5000) // Fallback timeout
    })
  }
})
