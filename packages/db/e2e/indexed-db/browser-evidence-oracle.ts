import { OracleMismatch } from '../../tests/indexed-db/cross-tab-oracle'
import type { BrowserEvidence } from './browser'

/** A page acknowledgement names every observation that must already exist in
 * runner-owned memory. Page replacement cannot turn missing evidence into an
 * empty valid trace. Sequence checks preserve duplicate production events.
 */
export function retainedDocument(
  events: Array<BrowserEvidence>,
  receipt: { document: string; sequence: number },
) {
  const retained = events.filter((event) => event.document === receipt.document)
  const sequences = retained.map((event) => event.sequence)
  const expected = Array.from({ length: receipt.sequence }, (_, index) => index)
  if (JSON.stringify(sequences) !== JSON.stringify(expected))
    throw new OracleMismatch(
      'evidence capture',
      'page destruction',
      expected,
      sequences,
    )
  return retained
}
