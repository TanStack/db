import { expect, it } from 'vitest'
import { createRecoveryRecorder } from './sync-metadata-recovery-recorder'

const input = () => ({
  type: `unknown-storage-observation` as const,
  fromRowVersion: 0,
  latestRowVersion: 2,
})

it(`withholds a response until storage reading and application both finish`, async () => {
  const recorder = createRecoveryRecorder()
  const response = input()
  recorder.delivered(response)
  expect(() => recorder.take()).toThrow(`was not applied`)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const hydration = recorder.hydrate(async (read) => {
    read()
    await gate
  })
  expect(() => recorder.take()).toThrow(`was not applied`)
  release()
  await hydration
  expect(recorder.take()).toEqual([response])
  expect(recorder.take()).toEqual([])
})

it(`rejects a completed task that never read storage`, async () => {
  const recorder = createRecoveryRecorder()
  recorder.delivered(input())
  await expect(recorder.hydrate(() => Promise.resolve())).rejects.toThrow(
    `no storage observation`,
  )
  expect(() => recorder.take()).toThrow(`was not applied`)
})

it(`preserves failed and later responses instead of crediting an unrelated task`, async () => {
  const recorder = createRecoveryRecorder()
  recorder.delivered(input())
  await expect(
    recorder.hydrate((read) => {
      read()
      return Promise.reject(new Error(`application failed`))
    }),
  ).rejects.toThrow(`application failed`)
  expect(() => recorder.take()).toThrow(`was not applied`)
  recorder.discard()
  const later = input()
  await recorder.hydrate((read) => {
    read()
    recorder.delivered(later)
    return Promise.resolve()
  })
  expect(() => recorder.take()).toThrow(`was not applied`)
  await recorder.hydrate((read) => {
    read()
    return Promise.resolve()
  })
  expect(recorder.take()).toEqual([later])
})

it(`discards an invalidated sync run's response without a model input`, () => {
  const recorder = createRecoveryRecorder()
  recorder.delivered(input())
  recorder.discard()
  expect(recorder.take()).toEqual([])
})

it(`does not credit a hydration that finishes after cleanup`, async () => {
  const recorder = createRecoveryRecorder()
  recorder.delivered(input())
  await recorder.hydrate((read) => {
    read()
    recorder.discard()
    return Promise.resolve()
  })
  expect(recorder.take()).toEqual([])
})
