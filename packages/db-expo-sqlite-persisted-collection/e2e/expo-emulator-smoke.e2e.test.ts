import { expect, it } from 'vitest'
import { ensureExpoEmulatorRuntime } from '../tests/helpers/expo-emulator-runtime'

const runtimePlatform = process.env.TANSTACK_DB_EXPO_RUNTIME_PLATFORM?.trim()
const shouldRun =
  runtimePlatform === `ios` || runtimePlatform === `android`

it.runIf(shouldRun)(
  `runs a persistence smoke test inside a real Expo runtime`,
  async () => {
    const runtime = await ensureExpoEmulatorRuntime(
      runtimePlatform === `android` ? `android` : `ios`,
    )
    const smokeResult = await runtime.runPersistenceSmokeTest(
      `expo-runtime-smoke.sqlite`,
    )

    expect(smokeResult.insertedTitle).toBe(`Persisted from Expo runtime`)
    expect(smokeResult.reloadedCount).toBe(1)
  },
)
