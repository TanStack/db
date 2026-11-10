"""Prepare pure terminal checks. Imports no project runtime; writes only here."""
from pathlib import Path
import json

review = Path(__file__).resolve().parent
for version in (1, 2):
    prepared = review.parent / f"metadata-update-source-v{version}"
    original = (prepared / "pure-controls.mjs").read_text()
    prefix = original.split("const results = []", 1)[0]
    prefix = prefix.replace(
        "const directory = dirname(fileURLToPath(import.meta.url))",
        "const directory = " + json.dumps(str(prepared)),
    )
    appendix = r'''
// Independent bounded challenge of the actual streamed runner semantics.
// Do not use the v1 pure helper's stronger per-history reach assertion.
// No test registration, production driver, supervisor or Collection is loaded.
function judge(history, input) {
  const receipts = structuredClone(input)
  if (history.cacheIdentity === 'subscription') {
    const at = receipts.findIndex((r) => r.phase === 'answer-queued')
    receipts.splice(at, 0, { phase: 'conflicting-cache-premise' })
  }
  for (let index = 0; index < receipts.length; index++)
    receipts[index].sequence = index + 1
  const meta = metadata.createMetadataReceiptCheck(history)
  const root = progress.createProgressReceiptCheck(history)
  const downstream = progress.createProgressReceiptCheck(history)
  for (const receipt of receipts) {
    root(receipt)
    if (receipt.phase === 'downstream-change')
      downstream({ ...receipt, phase: 'public-change' })
    else if (['reload-start', 'cleanup-start', 'followup-start'].includes(receipt.phase))
      downstream(receipt)
    else if (['final-publication', 'followup-publication'].includes(receipt.phase))
      downstream({ ...receipt, rows: receipt.downstream })
    meta(receipt)
  }
  progress.checkQueuedAnswerProgress(history, {
    reason: 'exited', exitCode: 0, signal: null, receipts,
    keyCallbacks: 1, prefixViolations: 0, warnings: 0, cleanupErrors: [],
    logPath: 'pure-authored-receipts-only', bindingStatus: 'bound',
  })
  if (meta.finish) meta.finish()
}
const observations = []
for (const original of metadata.metadataReceivingHistories) {
  judge(original, lawful(original))
  for (const quarter of [0, 2]) {
    const history = { ...original, metadataFollowupQuarter: quarter }
    const good = lawful(history, true)
    judge(history, good)
    const omittedStage = good.filter((r) => !r.phase.startsWith('followup-') && r.phase !== 'acquisition-accepted')
    const missingFinal = good.filter((r) => r.phase !== 'followup-publication')
    const missingWorker = good.filter((r) => r.phase !== 'worker-cleaned')
    for (const [fault, receipts] of [
      ['entire-optional-stage-omitted', omittedStage],
      ['followup-final-omitted', missingFinal],
      ['worker-cleanup-omitted', missingWorker],
    ]) {
      let error
      try { judge(history, receipts) } catch (caught) { error = String(caught.message) }
      observations.push({ cacheIdentity: history.cacheIdentity, keys: history.metadataKeys,
        quarter, fault, rejected: error !== undefined, error: error ?? null })
    }
  }
}
const version = VERSION_PLACEHOLDER
assert.equal(observations.length, 24)
assert.equal(observations.filter((r) => r.rejected).length, version === 1 ? 0 : 24)
const result = { version, lawfulOriginalAndFollowupControls: 12,
  observations, rejected: observations.filter((r) => r.rejected).length,
  limits: 'Pure authored observations only. No native registration, receiving, production execution or production RED/GREEN.' }
writeFileSync(OUTPUT_PLACEHOLDER, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
'''
    appendix = appendix.replace("VERSION_PLACEHOLDER", str(version)).replace(
        "OUTPUT_PLACEHOLDER",
        json.dumps(str(review / f"metadata-update-terminal-probe-v{version}.json")),
    )
    output = review / f"metadata-update-terminal-probe-v{version}.mjs"
    with output.open("x") as file:
        file.write(prefix + appendix)

audit = (review / "metadata-update-source-read-audit-v1.py").read_text()
audit = audit.replace('"metadata-update-source-v1"', '"metadata-update-source-v2"')
audit = audit.replace(
    "048170249ec3e679d289bf69c9358fc7b0ac1074d9384b06b19caa868b3ec1c0",
    "4ae26549a4edc1565ef08ca7f1b096f7b644b32773fa520d688431335aa5bd8a",
)
audit = audit.replace("metadata-update-source-read-audit-v1.json", "metadata-update-source-read-audit-v2.json")
with (review / "metadata-update-source-read-audit-v2.py").open("x") as file:
    file.write(audit)
