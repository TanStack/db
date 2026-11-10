"""Read/hash audit for the final authored strict cell; no runtime or probes."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
WT = Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-metadata-receiving-v1')
template = HERE / 'subscription-default-actual-read-audit-v3.py'
assert hashlib.sha256(template.read_bytes()).hexdigest() == '08bf85db960a292784a26aea91c59e19a849753d343b1906c3c07aff78eabaf7'
source = template.read_text()
changes = {
    'subscription-default': 'subscription-authored',
    '4186b8fda8a73a6432b1b50b9bf0a2ff86d472432f1b5c37c24f6268c84c902c': '8d87fc3ebe34d78ae718bc331ab6126b0a9572c251c31f25ce0703ef02d384fe',
    '445abcdf4e75996785ecfcbc1352fa5bddde2c372a66884b6efdda76d1defa0b': '56b2f62d9075beda7bf9907d46b79c0c84e1520395a0508327e5773f03dad55b',
    'docs/misfits-metadata-scope-authored-root-classification-v3.json': 'docs/misfits-metadata-subscription-default-root-classification-v3.json',
    '0c941598074238637f54d5e3907b973c3295f6a21a896bc473ceaeeca77e2820': 'a7a9d7a0c50c780cf1dac66a22f24873df0075d942d2d8bea0b75f896721f7f9',
    '59552': '72072',
    '59553': '72073',
    '51447': '59777',
    '51466': '59795',
    '51467': '59797',
    '51470': '59802',
    '699596800': '703381504',
    '3413': '3427',
    '5947': '7199',
    '5939': '7191',
    '29785': '36045',
    '62993': '35786',
    'f6ef5f': '24a978',
    '3fa9e1': '55289c',
    "['cells'][2]": "['cells'][3]",
}
for old, new in changes.items():
    assert old in source, old
    source = source.replace(old,new)

native = WT / 'docs/misfits-metadata-receiving-runtime-v3/subscription-authored/receiving-artifacts'
raw = [json.loads(line) for line in (native/'receipts.jsonl').read_text().splitlines()]
by_sequence = {r['sequence']:r for r in raw}
history = json.loads((native/'history.json').read_text())
assert history == {'kind':'query','scheduler':'microtask','cacheIdentity':'subscription','includes':True,'window':True,'nonemptyPrior':True,'keyShift':0,'rankScale':10,'metadataKeys':'authored'}
identity = by_sequence[4]
assert identity['keyLane'] == 'authored'
assert len({identity['sourceId'],identity['rootId'],identity['downstreamId']}) == 3
root = {'id':4,'rank':40,'markers':[],'$hasPendingWrites':False,'$origin':'remote','$key':'metadata-root-4','$collectionId':identity['rootId']}
downstream = {'id':4,'rank':40,'markers':[],'observedKey':'metadata-root-4','observedCollectionId':identity['rootId'],'observedOrigin':'remote','observedPending':False,'$hasPendingWrites':False,'$origin':'remote','$key':'metadata-downstream-4','$collectionId':identity['downstreamId']}
for sequence in [109,165]:
    event = by_sequence[sequence]
    assert event['rows'] == [root] and event['entries'] == [['metadata-root-4',root]]
    assert event['downstream'] == [downstream] and event['downstreamEntries'] == [['metadata-downstream-4',downstream]]
assert by_sequence[184]['rows'] == [root] and by_sequence[184]['entries'] == [['metadata-root-4',root]]

# Only observed run identities/counts and cell index differ. The frozen strict
# premise, completed enqueue, full-drain, resource/instrument, source and
# cleanup checks remain unchanged; no native campaign is invoked.
exec(compile(source,str(template),'exec'),{'__file__':str(Path(__file__).resolve())})
