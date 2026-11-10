"""Rebind the accepted singleton to the reviewed retained-stage correction.

This imports the unchanged prior read/hash gate. It launches no process or
native tests. Root recovery acceptance and one-shot admission remain separate.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
H = HERE.parent
PREVIOUS = H / 'metadata-update-receiving-preparation-v2'
PREVIOUS_BINDING = 'ec925ca31d325cadf8a28e597c1d6ea0185fe79b0e1d4ef8b97b5333e0f5f238'
PREVIOUS_VERIFY = 'e7d4fab7945dfe254f36c24792ddf56b7beef355275f048f725a53bef4c535ab'
SOURCE = H / 'metadata-update-source-v3'
SOURCE_SHA = 'd651df85eb08ff46d8e68bd01b6fcc644f18a6a8efbb4b52ef557af0fd6a2fcd'
INVENTORY_SHA = '3c8ece36701d450758587bd16dbf691b5e700668bc0be32ae2f20af8bc8bfb84'
REVIEW = H / 'metadata-receiving-independent-review-v1/metadata-source-v3-independent-review.md'
REVIEW_SHA = 'a07ed61feca7172165fb6d2489ce9d255fe160d761464152827f2dd584efd9f2'
OUTPUT = H / 'metadata-update-native-scope-default-q2-v3'
SUPERVISOR = 'packages/query-db-collection/tests/queued-answer-progress-supervisor.ts'
HELPER = 'packages/query-db-collection/tests/queued-answer-progress-receipts.ts'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def previous_gate():
    require(digest(PREVIOUS / 'binding.json') == PREVIOUS_BINDING, 'prior receiving binding changed')
    require(digest(PREVIOUS / 'verify.py') == PREVIOUS_VERIFY, 'prior receiving gate changed')
    spec = importlib.util.spec_from_file_location('accepted_metadata_receiving_gate_v2', PREVIOUS / 'verify.py')
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    return gate


def check_recipe(recipe, original):
    expected = copy.deepcopy(original)
    expected['cwd'] = str(SOURCE / 'sources')
    expected['envSet']['H02_PROGRESS_SOURCE_FREEZE'] = str(SOURCE / 'source-freeze.json')
    expected['freshOutputDirectory'] = str(OUTPUT)
    require(recipe == expected, 'singleton differs beyond source root/freeze and fresh output')


def source_equivalence():
    require(digest(SOURCE / 'source-freeze.json') == SOURCE_SHA, 'reviewed successor source freeze changed')
    require(digest(SOURCE / 'source-inventory.json') == INVENTORY_SHA, 'reviewed successor inventory changed')
    require(digest(REVIEW) == REVIEW_SHA, 'independent successor source review changed')
    inventory = read(SOURCE / 'source-inventory.json')
    previous = read(H / 'metadata-update-source-v2/source-inventory.json')
    require(len(inventory) == 589 and len(previous) == 588, 'source epoch cardinality changed')
    for name, sha in inventory.items():
        require(digest(SOURCE / 'sources' / name) == sha, f'successor source member changed: {name}')
    changed = {name for name in previous if inventory.get(name) != previous[name]}
    require(changed == {SUPERVISOR} and set(inventory) - set(previous) == {HELPER}, 'change extends beyond reviewed recorder correction')
    require(all(inventory[name] == sha for name, sha in read(SOURCE / 'source-freeze.json')['productionFiles'].items()), 'production differs')
    # Every registration/name/config/driver/model/finalizer member is among
    # those 587 unchanged members. The selected test source has this exact SHA.
    registration = 'packages/query-db-collection/tests/queued-answer-metadata-oracle.test.ts'
    require(inventory[registration] == '3d47cc699d4ceb04c8d23f0438e4995ea62b9f1ae23c5e6c386cdd47182f669e', 'registration/name changed')
    return {'successorSourceMembers': 589, 'unchangedPredecessorMembers': 587,
            'productionMembers': 511, 'sourceFreezeSha256': SOURCE_SHA,
            'inventorySha256': INVENTORY_SHA, 'sourceReviewSha256': REVIEW_SHA,
            'registrationSha256': inventory[registration],
            'discoveryEquivalence': 'Accepted20-name and exact selected-name evidence retains original limits. No fresh native discovery or execution is inferred.'}


def verify(binding_sha, gate='source'):
    require(gate in ['source', 'receiving'], 'only the exact fixed receiving is prepared')
    require(digest(HERE / 'binding.json') == binding_sha, 'successor receiving binding changed')
    binding = read(HERE / 'binding.json')
    for name, sha in binding['files'].items():
        require(digest(HERE / name) == sha, f'successor preparation changed: {name}')
    prior_gate = previous_gate()
    prior = prior_gate.verify(PREVIOUS_BINDING, 'source')
    recipes = read(HERE / 'recipes.json')
    require(set(recipes) == {'status', 'receiving'}, 'one exact singleton recipe required')
    check_recipe(recipes['receiving'], read(PREVIOUS / 'recipes.json')['receiving'])
    equivalence = source_equivalence()
    return {'status': 'READ/HASH ONLY; root toolchain recovery acceptance and separate one-shot admission required',
            'gate': gate, 'bindingSha256': binding_sha,
            'sourceEquivalence': equivalence,
            'priorAcceptedDiscovery': prior['priorClassifications'],
            'canonicalProgram': prior['canonicalProgram'],
            'receivingRecipeSha256': digest(HERE / 'recipes.json'),
            'nativeLaunches': 0, 'nativeProcessProbes': 0,
            'productPassCredit': False, 'receivingReachCredit': False,
            'toolchainRecoveryAcceptance': 'ROOT-OWNED AND REQUIRED; no changed wrapper is accepted as a baseline',
            'limits': prior['limits']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--binding', required=True)
    parser.add_argument('--gate', choices=['source', 'receiving'], default='source')
    args = parser.parse_args()
    value = verify(args.binding, args.gate)
    if args.gate == 'receiving':
        value['receivingEvidenceBaseline'] = previous_gate().receipt_baseline()
    print(json.dumps(value, indent=2, sort_keys=True))
