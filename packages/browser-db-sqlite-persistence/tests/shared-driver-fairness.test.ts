import { describe, expect, it } from 'vitest'
import {
  FIXED_SEED,
  createFairnessPropertyModes,
  readFairnessCalibration,
  readFairnessReplayConfig,
} from './shared-driver-fairness-config'

// Configuration tests for the shared BrowserWASQLiteDriver fairness oracle in
// `shared-driver-fairness-oracle.test.ts`, which owns the law. These pin the replay
// and calibration environment parsing.
describe(`shared BrowserWASQLiteDriver fairness oracle`, () => {
  it(`selects fixed and seedless lanes by default and only replay when requested`, () => {
    expect(createFairnessPropertyModes(readFairnessReplayConfig({}))).toEqual([
      { label: `fixed-seed`, seed: FIXED_SEED },
      { label: `seedless-random` },
    ])
    expect(
      createFairnessPropertyModes(
        readFairnessReplayConfig({
          TANSTACK_DB_DRIVER_FAIRNESS_SEED: `42`,
          TANSTACK_DB_DRIVER_FAIRNESS_PATH: `0:1`,
        }),
      ),
    ).toEqual([{ label: `checked-replay`, seed: 42, path: `0:1` }])
    expect(readFairnessCalibration({})).toEqual({})
    expect(
      readFairnessCalibration({
        TANSTACK_DB_DRIVER_FAIRNESS_CALIBRATION: `persist-first-fifo`,
      }),
    ).toEqual({ schedulingFault: `persist-first-fifo` })
  })

  it.each([
    {
      name: `seed without path`,
      environment: { TANSTACK_DB_DRIVER_FAIRNESS_SEED: `42` },
      message: `must be supplied together`,
    },
    {
      name: `path without seed`,
      environment: { TANSTACK_DB_DRIVER_FAIRNESS_PATH: `0` },
      message: `must be supplied together`,
    },
    {
      name: `non-integer seed`,
      environment: {
        TANSTACK_DB_DRIVER_FAIRNESS_SEED: `4.2`,
        TANSTACK_DB_DRIVER_FAIRNESS_PATH: `0`,
      },
      message: `must be an integer`,
    },
    {
      name: `invalid shrink path`,
      environment: {
        TANSTACK_DB_DRIVER_FAIRNESS_SEED: `42`,
        TANSTACK_DB_DRIVER_FAIRNESS_PATH: `0:-1`,
      },
      message: `colon-separated nonnegative integers`,
    },
  ])(`rejects incomplete or invalid replay coordinates: $name`, (probe) => {
    expect(() => readFairnessReplayConfig(probe.environment)).toThrow(
      probe.message,
    )
  })
})
