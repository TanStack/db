// Supplemental calibrations for the unchanged reusable release comparisons.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  checkPublishObservation,
  httpPublishHistories as histories,
  packageNames,
} from './release-history-oracle.js'
import { checkHttpUploadFailures } from './publish-observation-oracle.js'

test('finite HTTP grammar keeps every history independently selectable', () => {
  assert.equal(
    new Set(histories.map((history) => JSON.stringify(history))).size,
    histories.length,
    'complete JSON test titles identify exactly one history',
  )
})

test.each(['duplicate', 'omission', 'tag', 'version', 'registry', 'access'])(
  'release publish judgment rejects wrong %s observation',
  (fault) => {
    const expected = [
      { name: packageNames.db, version: '1.0.0-rc.1.10', tag: 'latest' },
    ]
    const correct = [
      {
        type: 'publish',
        ...expected[0],
        success: true,
        registry: 'http://127.0.0.1:4873',
        access: 'public',
      },
    ]
    checkPublishObservation(correct, expected, 'legal calibration')
    const wrong = structuredClone(correct)
    if (fault === 'duplicate') wrong.push({ ...wrong[0] })
    else if (fault === 'omission') wrong.length = 0
    else
      wrong[0][fault] =
        fault === 'tag'
          ? 'rc'
          : fault === 'version'
            ? '1.0.0-rc.1.9'
            : fault === 'registry'
              ? 'https://example.invalid'
              : 'restricted'
    assert.throws(() =>
      checkPublishObservation(wrong, expected, 'wrong calibration'),
    )
  },
)

test.each(['already-current', 'retained-success'])(
  'rejects duplicate HTTP attempts for %s',
  (shape) => {
    const fault = {
      name: packageNames.query,
      success: false,
      controlledFailure: true,
      duplicate: false,
    }
    const duplicate = {
      name: packageNames.db,
      success: false,
      controlledFailure: false,
      duplicate: true,
    }
    const actual =
      shape === 'already-current' ? [duplicate] : [fault, duplicate]
    assert.throws(
      () =>
        checkHttpUploadFailures(
          actual,
          shape === 'already-current' ? undefined : fault,
        ),
      /HTTP retry does not republish/,
    )
  },
)

test.each(['default', 'variable-origin', 'foreign-origin'])(
  'retains registry-origin judgment %s',
  (shape) => {
    const expected = [
      { name: packageNames.db, version: '1.0.0-rc.1.10', tag: 'rc' },
    ]
    const registry =
      shape === 'default' ? 'http://127.0.0.1:4873' : 'http://127.0.0.1:61234'
    const observation = [
      {
        ...expected[0],
        type: 'publish',
        success: true,
        access: 'public',
        registry,
      },
    ]
    if (shape === 'default')
      checkPublishObservation(observation, expected, 'default origin')
    else {
      checkPublishObservation(
        observation,
        expected,
        'variable loopback origin',
        registry,
      )
      if (shape === 'foreign-origin')
        assert.throws(() =>
          checkPublishObservation(
            [{ ...observation[0], registry: 'https://example.invalid' }],
            expected,
            'foreign observation',
            registry,
          ),
        )
    }
  },
)
