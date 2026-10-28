import type { SharedDriverFairnessOptions } from './shared-driver-fairness-oracle'

// Replay and calibration environment for the shared-driver fairness oracle and
// its ordinary configuration tests. The oracle in `shared-driver-fairness-oracle.test.ts` owns the law.

export const FIXED_SEED = 165_905

export type FairnessReplayEnvironment = Record<string, string | undefined>

export type FairnessReplayConfig = {
  seed: number
  path: string
}

export type FairnessPropertyMode = {
  label: `fixed-seed` | `seedless-random` | `checked-replay`
  seed?: number
  path?: string
}

export function readFairnessReplayConfig(
  environment: FairnessReplayEnvironment = process.env,
): FairnessReplayConfig | undefined {
  const seedText = environment.TANSTACK_DB_DRIVER_FAIRNESS_SEED
  const path = environment.TANSTACK_DB_DRIVER_FAIRNESS_PATH
  if (seedText === undefined && path === undefined) return undefined
  if (seedText === undefined || path === undefined) {
    throw new Error(
      `TANSTACK_DB_DRIVER_FAIRNESS_SEED and TANSTACK_DB_DRIVER_FAIRNESS_PATH must be supplied together`,
    )
  }

  const seed = Number(seedText)
  if (seedText.trim() === `` || !Number.isSafeInteger(seed)) {
    throw new Error(`TANSTACK_DB_DRIVER_FAIRNESS_SEED must be an integer`)
  }
  if (!/^\d+(?::\d+)*$/.test(path)) {
    throw new Error(
      `TANSTACK_DB_DRIVER_FAIRNESS_PATH must contain colon-separated nonnegative integers`,
    )
  }
  return { seed, path }
}

export function createFairnessPropertyModes(
  replay: FairnessReplayConfig | undefined,
): ReadonlyArray<FairnessPropertyMode> {
  if (replay) {
    return [{ label: `checked-replay`, ...replay }]
  }
  return [
    { label: `fixed-seed`, seed: FIXED_SEED },
    { label: `seedless-random` },
  ]
}

export function readFairnessCalibration(
  environment: FairnessReplayEnvironment = process.env,
): SharedDriverFairnessOptions {
  const fault = environment.TANSTACK_DB_DRIVER_FAIRNESS_CALIBRATION
  if (fault === undefined) return {}
  if (fault !== `persist-first-fifo`) {
    throw new Error(
      `TANSTACK_DB_DRIVER_FAIRNESS_CALIBRATION must be persist-first-fifo`,
    )
  }
  return { schedulingFault: fault }
}
