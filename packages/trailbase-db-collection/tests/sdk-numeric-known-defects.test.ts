/**
 * The maintainer accepts this installed-SDK defect pending its upstream fix
 * (2026-11-24). Keep its complete wire input and the primary oracle's judgment.
 * A parser change that makes these pass must remove the temporary exclusion.
 * These tests assert the known defect's signature, not corrected row behavior.
 */
import { expect, it } from 'vitest'
import { observeTrailBaseEagerHistory } from './eager-live-source-framework-oracle'
import { trailBaseSdkConformanceDriver } from './sdk-conformance-driver'
import { TrailBaseSdkService } from './sdk-service'
import type { EagerLiveSourceHistory } from '../../db-adapter-conformance/src'

it(`records the installed SDK's refused exponent-form integer`, async () => {
  const service = new TrailBaseSdkService<{ id: number; value: number }>()
  service.rows = [{ id: 1, value: Number.MAX_VALUE }]
  try {
    await expect(service.api.list()).rejects.toMatchObject({
      name: `SyntaxError`,
      message: expect.stringContaining(`BigInt`),
    })
  } finally {
    await service.dispose()
  }
})

const failures: Array<{
  path: string
  history: EagerLiveSourceHistory
  law: string
  step: number
}> = [
  {
    path: `snapshot`,
    history: [
      {
        kind: `snapshot`,
        rows: [{ id: 1, title: `a`, value: Number.MAX_VALUE }],
      },
    ],
    law: `READY-3 (status)`,
    step: 0,
  },
  {
    path: `SSE update`,
    history: [
      { kind: `snapshot`, rows: [{ id: 1, title: `a`, value: 0.5 }] },
      {
        kind: `changes`,
        changes: [
          {
            type: `upsert`,
            row: { id: 1, title: `a`, value: Number.MAX_VALUE },
          },
        ],
      },
    ],
    law: `FID-1 (values)`,
    step: 1,
  },
]
it.each(failures)(
  `retains the shared $path counterexample for the known SDK defect`,
  async ({ history, law, step }) => {
    const observed = await observeTrailBaseEagerHistory(
      trailBaseSdkConformanceDriver(true),
      history,
    )
    expect(observed.failure).toMatchObject({ law, step, cleanup: [] })
  },
)
