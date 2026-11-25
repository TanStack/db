/** Native Chromium supplies SDK routing and SSE delivery to the same driver. */
import { observeMutationEvent } from '../../trailbase-db-collection/tests/mutation-events-sdk-driver'

Object.assign(window, { runTrailBaseMutationEvent: observeMutationEvent })
