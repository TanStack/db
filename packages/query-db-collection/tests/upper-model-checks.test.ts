import { expect, it } from 'vitest'
import {
  createRefetchCallSettlementModel,
  observeHandlerRefetchBoundary,
  observeRefetchCallSettlement,
  reduceHandlerRefetchBoundary,
  reduceRefetchCallSettlement,
} from './ownership-model-oracle'

// These are the model-only checks formerly embedded in production runs.
// Production law comparisons remain in the framework properties.
it('keeps a rejected refetch rejected while its independent sibling applies', () => {
  let model = createRefetchCallSettlementModel(['detail', 'list'], true)
  model = reduceRefetchCallSettlement(model, {
    type: 'accept-application',
    queryId: 'detail',
    applicationId: 'detail-result',
  })
  model = reduceRefetchCallSettlement(model, {
    type: 'accept-application',
    queryId: 'list',
    applicationId: 'list-result',
  })
  for (const queryId of ['detail', 'list'])
    model = reduceRefetchCallSettlement(model, {
      type: 'settle-fetch',
      queryId,
      outcome: 'fulfilled',
    })
  model = reduceRefetchCallSettlement(model, {
    type: 'settle-application',
    applicationId: 'detail-result',
    outcome: 'rejected',
  })
  expect(observeRefetchCallSettlement(model)).toEqual({ refetch: 'rejected' })
  expect(model.applications.get('list-result')?.outcome).toBe('pending')
  model = reduceRefetchCallSettlement(model, {
    type: 'settle-application',
    applicationId: 'list-result',
    outcome: 'fulfilled',
  })
  expect(observeRefetchCallSettlement(model)).toEqual({ refetch: 'rejected' })
})
it('retains successful handler refetch after its publication applies', () => {
  let model = reduceHandlerRefetchBoundary(
    { fetch: 'pending', application: 'unaccepted', throwOnError: true },
    { type: 'accept-application' },
  )
  model = reduceHandlerRefetchBoundary(model, {
    type: 'settle-fetch',
    outcome: 'fulfilled',
  })
  model = reduceHandlerRefetchBoundary(model, {
    type: 'settle-application',
    outcome: 'fulfilled',
  })
  expect(observeHandlerRefetchBoundary(model)).toEqual({
    refetch: 'resolved',
    applicationErrorRecorded: false,
  })
})
