"""Exact authored-key quarter-2 singleton preflight; future admitted launcher only.

This file is inert during preparation. It imports the accepted read/hash gate
only after all its exact binding/file inputs match. It registers no tests and
starts no native receiving process. No preflight was executed in this packet.
"""
import argparse
import hashlib
import importlib.util
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
H = HERE.parent
PREVIOUS = H / 'metadata-fixed-campaign-preparation-v1'
PREVIOUS_SHA = '26be3cc8983e93699c523f374990043ba077433f7103e3078cda98c6fe7aabe1'
PREVIOUS_VERIFY_SHA = 'dca490c410a8f19681f0b4bb3faa45009f9bf64396a22d7c24a8b57b7003af51'
SOURCE = H / 'metadata-update-source-v3'
SOURCE_SHA = 'd651df85eb08ff46d8e68bd01b6fcc644f18a6a8efbb4b52ef557af0fd6a2fcd'
OUTPUT = H / 'metadata-next-gap-runs-v1/followup-scope-authored-q2'
ACCEPTED_PLAN = H / 'metadata-next-gap-plan-v1/baseline-recipes.json'


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def check_recipe(recipe):
    original = next(x for x in read(ACCEPTED_PLAN)['recipes']
                    if x['id'] == 'followup-scope-authored-q2')
    require(recipe == original, 'singleton differs from the exact reviewed inert recipe')
    require(recipe['cwd'] == str(SOURCE / 'sources'), 'source root changed')
    require(recipe['freshOutputDirectory'] == str(OUTPUT), 'reviewed output changed')
    require(recipe['property'] is None and recipe['testTimeoutMs'] == 60000,
            'singleton became a campaign or changed timeout')
    require(recipe['expectedHistoryCount'] == 1 and recipe['expectedReachStateCount'] == 31,
            'singleton reach/count changed')
    require(recipe['receivingHistory'] == {
        'kind': 'query', 'scheduler': 'microtask', 'cacheIdentity': 'scope',
        'metadataKeys': 'authored', 'includes': True, 'window': True,
        'nonemptyPrior': True, 'keyShift': 0, 'rankScale': 10,
        'metadataFollowupQuarter': 2}, 'authored q2 history changed')
    require(recipe['innerReceivingBudget'] == {
        'wallMs': 20000, 'groupRssBytes': 1073741824,
        'nodeHeapMiB': 384, 'postEnqueueWindowMs': 1000},
        'inner containment changed')
    require(recipe['envSet'] == {
        'H02_PROGRESS_SOURCE_FREEZE': str(SOURCE / 'source-freeze.json'),
        'TANSTACK_DB_ORACLE_RUNS_MULTIPLIER': '1'}, 'environment set changed')
    require(recipe['argv'][-1].startswith('^') and recipe['argv'][-1].endswith('$'),
            'selector lost anchors')
    require(re.fullmatch(recipe['argv'][-1], recipe['expectedFilterName']) is not None,
            'selector does not match its exact filter title')
    require(re.fullmatch(recipe['argv'][-1], recipe['expectedFilterName'] + ' extra') is None,
            'selector accepts a suffix')


def previous_gate():
    require(digest(PREVIOUS / 'binding.json') == PREVIOUS_SHA,
            'accepted predecessor binding changed')
    require(digest(PREVIOUS / 'verify.py') == PREVIOUS_VERIFY_SHA,
            'accepted predecessor gate changed')
    spec = importlib.util.spec_from_file_location(
        'accepted_metadata_fixed_read_hash_gate_for_authored_q2',
        PREVIOUS / 'verify.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify(binding_sha, gate):
    require(gate in ['source', 'receiving'], 'only one exact authored singleton is prepared')
    require(digest(HERE / 'binding.json') == binding_sha, 'packet binding changed')
    binding = read(HERE / 'binding.json')
    for name, expected in binding['files'].items():
        require(digest(HERE / name) == expected, f'packet member changed: {name}')
    for name, expected in binding['externalInputs'].items():
        require(digest(name) == expected, f'bound existing input changed: {name}')
    require(digest(SOURCE / 'source-freeze.json') == SOURCE_SHA,
            'reviewed v3 source freeze changed')
    recipe = read(HERE / 'recipe.json')
    check_recipe(recipe)
    names = read(H / 'metadata-update-native-discovery-v2/names.json')
    require(len(names) == 20 and sum(
        x['name'] == recipe['expectedDisplayName'] for x in names) == 1,
        'preserved selected registration title is not unique')
    require(sum(re.fullmatch(recipe['argv'][-1], x['name'].replace(' > ', ' ')) is not None
                for x in names) == 1, 'preserved selector is not exact')
    prior = previous_gate()
    prior_result = prior.verify(PREVIOUS_SHA, gate)
    result = {
        'status': 'READ/HASH PREFLIGHT ONLY; separate exact root admission required',
        'bindingSha256': binding_sha, 'sourceFreezeSha256': SOURCE_SHA,
        'priorReadHashGate': prior_result, 'history': recipe['receivingHistory'],
        'property': None, 'generatedCampaign': False, 'historyCount': 1,
        'declaredStateCount': 31, 'multiplier': 1,
        'expectedFilterName': recipe['expectedFilterName'],
        'expectedDisplayName': recipe['expectedDisplayName'],
        'titleSuffix': None, 'nativeLaunches': 0, 'nativeProcessProbes': 0,
        'receivingReachCredit': False, 'singletonPassCredit': False}
    if gate == 'receiving':
        result['receivingEvidenceBaseline'] = prior_result.pop('receivingEvidenceBaseline')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--binding', required=True)
    parser.add_argument('--gate', choices=['source', 'receiving'], default='source')
    args = parser.parse_args()
    print(json.dumps(verify(args.binding, args.gate), indent=2, sort_keys=True))
