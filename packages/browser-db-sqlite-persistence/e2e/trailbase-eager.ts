/** A real native-stream browser receiving path for the shared eager laws. */
import { observeTrailBaseEagerHistory } from '../../trailbase-db-collection/tests/eager-live-source-framework-oracle'
import { trailBaseConformanceDriver } from '../../trailbase-db-collection/tests/conformance-driver'
import type { EagerLiveSourceHistory } from '../../db-adapter-conformance/src'

export const runTrailBaseEager = (
  history: EagerLiveSourceHistory,
  corruptValues = false,
) =>
  observeTrailBaseEagerHistory(
    trailBaseConformanceDriver(),
    history,
    corruptValues,
  )
