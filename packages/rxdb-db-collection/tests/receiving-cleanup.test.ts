// @vitest-environment node
/** Harness tests preserve the primary shared-law verdict across real teardown. */
import { expect, it } from 'vitest'
import { initialReceiptViolations } from '../../powersync-direct-collection/tests/initial-receipt-oracle'
import { observeRxdbInitialReceipt } from './initial-receipt-driver'
import { observeRxdbInitialReceiptNode } from './initial-receipt-node-driver'
import { observeRxdbMutation } from './mutation-driver'
import { checkRxdbMutationSourceBatch } from './mutation-source-batch-oracle'
import { observeRxdbSharedClient } from './shared-client-driver'
import { rxdbSharedClientViolations } from './shared-client-oracle'
import type { InitialReceiptHistory } from '../../powersync-direct-collection/tests/initial-receipt-oracle'
import type { RxdbMutationHistory } from './mutation-driver'
import type { RxdbSharedHistory } from './shared-client-oracle'

it(`keeps a mutation mismatch when real Collection cleanup then fails`, async () => {
  const h: RxdbMutationHistory = {
    operation: `update`,
    outcome: `fulfilled`,
    sourceOrder: `before-settlement`,
    peer: true,
    coordinate: 1,
  }
  const raw = await observeRxdbMutation(
    h,
    `paired-mutation-failure`,
    true,
    (value) => {
      for (const entry of value.trace)
        if (entry.checkpoint.includes(`settle`) && `rows` in entry.value)
          entry.value.rows = []
      return value
    },
  )
  const verdict = checkRxdbMutationSourceBatch(h, raw)
  expect(verdict.kind).toBe(`violation`)
  if (verdict.kind === `violation`) {
    expect(verdict.law).toBe(`rows`)
    expect(verdict.checkpoint).toBe(`step 2 (settle)`)
    expect(verdict.difference).toContain(`Secondary receiving diagnostics`)
    expect(verdict.difference).toContain(
      `Injected RxDB mutation cleanup failure`,
    )
  }
  expect(raw.cleanupErrors?.join(`; `)).toContain(
    `Injected RxDB mutation cleanup failure`,
  )
})

it(`captures native detached errors emitted after real database teardown`, async () => {
  const h: InitialReceiptHistory = {
    rows: 1,
    cleanupAt: `held-receipt`,
    reason: 2,
  }
  const raw = await observeRxdbInitialReceiptNode(h, `detached`)
  expect(initialReceiptViolations(h, raw)).toContain(`detachedErrors`)
  expect(raw.detachedErrors.join(`; `)).toContain(
    `Injected detached error after RxDB removal`,
  )
})

it(`keeps a receipt mismatch and a subsequent real removal failure`, async () => {
  const h: InitialReceiptHistory = {
    rows: 3,
    cleanupAt: `after-application`,
    reason: 1,
  }
  const raw = await observeRxdbInitialReceipt(
    h,
    [`primary detached receipt rejection`],
    true,
  )
  expect(initialReceiptViolations(h, raw)).toContain(`detachedErrors`)
  expect(raw.cleanupErrors?.join(`; `)).toContain(
    `Injected RxDB receipt removal failure`,
  )
})
it(`keeps a shared-provider mismatch and a subsequent real removal failure`, async () => {
  const h: RxdbSharedHistory = {
    initial: 3,
    next: 2,
    join: `while-loading`,
    retire: 0,
    batchSize: 1,
  }
  const raw = await observeRxdbSharedClient(
    h,
    `paired-shared-failure`,
    true,
    (observed) => ({ ...observed, both: { ...observed.both, rows: [[], []] } }),
  )
  expect(rxdbSharedClientViolations(h, raw)).toContain(
    `both public source refinement`,
  )
  expect(raw.cleanupErrors?.join(`; `)).toContain(
    `Injected RxDB shared removal failure`,
  )
})
