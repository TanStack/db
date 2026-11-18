import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { observeCutoff } from '../../query-db-collection/tests/persisted-rejected-write-cutoff-oracle'
import {
  removeStartupOPFSArtifacts,
  startupOPFSArtifacts,
} from './persisted-startup-opfs-cleanup'
import { recordQueryHistory } from './query-ownership-browser-support'
import { removeClosedArtifacts } from './query-rejected-write-cutoff-cleanup'
import type { History } from '../../query-db-collection/tests/persisted-rejected-write-cutoff-oracle'

export type ReceiverFault =
  | 'cleanup'
  | 'mismatch-cleanup'
  | 'mismatch-only'
  | 'prefix-cleanup'
  | 'transient-busy'
  | 'permanent-busy'
  | 'mismatch-permanent-busy'

async function runCutoffCandidate(
  h: History,
  id: string,
  fault?: ReceiverFault,
) {
  return recordQueryHistory(async (observe) => {
    const name = 'ps-query-cutoff-candidate.sqlite'
    await removeStartupOPFSArtifacts(name)
    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: name,
    })
    await withOracleCleanup(async () => {
      await observeCutoff(
        createBrowserWASQLitePersistence({ database }),
        h,
        id,
        (cut, value) => {
          if (fault === 'prefix-cleanup' && cut === 'stalePremise')
            throw new Error('cutoff interrupted result')
          observe(
            cut,
            fault?.startsWith('mismatch') && cut === 'peerFetches'
              ? 2
              : fault === 'prefix-cleanup' && cut === 'firstFetches'
                ? 2
                : value,
          )
        },
      )
    }, [
      () => database.close?.(),
      async () => {
        let injected = 0
        await removeClosedArtifacts(
          async () => {
            if (
              fault?.includes('permanent-busy') ||
              (fault === 'transient-busy' && injected++ === 0)
            )
              throw new DOMException(
                'cutoff injected busy',
                'NoModificationAllowedError',
              )
            await removeStartupOPFSArtifacts(name)
          },
          observe,
          fault?.includes('permanent-busy') ? 3 : 100,
        )
      },
      () => {
        if (fault?.includes('cleanup')) throw new Error('cutoff cleanup fault')
      },
    ])
    const artifacts = await startupOPFSArtifacts()
    if (artifacts.length)
      throw new Error(
        'Candidate OPFS artifacts remain: ' + artifacts.join(', '),
      )
  })
}
Object.assign(window, { runCutoffCandidate })
