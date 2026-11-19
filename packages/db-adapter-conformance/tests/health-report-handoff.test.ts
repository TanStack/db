import { expect, it } from 'vitest'
import { createHealthReportHandoff } from './health-report-handoff'

it('rejects a missing delivery acknowledgment even when forwarding returned', async () => {
  const health = createHealthReportHandoff(10)
  let forwarded = false
  health.issue(`healthy`, new Error(`retired owner`), () => {
    forwarded = true
  })
  expect(forwarded).toBe(true)
  await expect(health.receive()).rejects.toThrow(
    `target 1, issued 1, delivered 0, pending 1`,
  )
})

it('receives the captured calls without waiting for a later report', async () => {
  const health = createHealthReportHandoff()
  const earlier = new Error(`earlier`)
  const later = new Error(`later`)
  health.issue(`healthy`, earlier, () => {})
  const captured = health.receive()
  health.issue(`error`, later, () => {})
  health.deliver(`healthy`, earlier, () => {})
  await expect(captured).resolves.toEqual({
    issued: 2,
    delivered: 1,
    pending: 1,
  })
  health.deliver(`error`, later, () => {})
  await expect(health.receive()).resolves.toEqual({
    issued: 2,
    delivered: 2,
    pending: 0,
  })
})

it('keeps a same-method report for another Error from acknowledging the target', async () => {
  const health = createHealthReportHandoff(10)
  health.issue(`healthy`, new Error(`target`), () => {})
  health.deliver(`healthy`, new Error(`other`), () => {})
  await expect(health.receive()).rejects.toThrow(
    `target 1, issued 1, delivered 0, pending 1`,
  )
})
