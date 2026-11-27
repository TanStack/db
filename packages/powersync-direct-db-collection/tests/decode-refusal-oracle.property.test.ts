/**
 * The real standalone SDK receives shared decoder admission histories through
 * controlled NDJSON. The shared family owns values, refusal, publication,
 * health and cleanup judgments. This registration adds no expected answers.
 */
import { registerDecodeRefusal } from '../../db-adapter-conformance/tests/decode-refusal-oracle-suite'
import { directDecodeAdapter } from './decode-refusal-driver'

registerDecodeRefusal(
  `adapter-conformance.decode-refusal.powersync-direct`,
  directDecodeAdapter,
  {
    owns: [`src/index.ts#powerSyncCollectionOptions`],
  },
)
