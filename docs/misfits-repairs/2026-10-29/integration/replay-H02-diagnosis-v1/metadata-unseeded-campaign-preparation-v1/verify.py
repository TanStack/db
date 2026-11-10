"""Exact unseeded-campaign preflight. Future admitted launcher only.

The accepted prior source gate is imported only after its binding/file hashes
match. That gate reads/hashes existing source/tools/maps. This file registers
no tests and starts no receiving process. Source preparation parses it only.
"""
import argparse
import copy
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
OUTPUT = H / 'metadata-unseeded-campaign-scope-default-v1'


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def check_recipe(recipe):
    required = read(H / 'metadata-update-source-v2/required-native-recipes.json')
    original = next(x for x in required['receiving'] if x['id'] == 'generated-scope-default-random')
    expected = copy.deepcopy(original)
    expected['cwd'] = str(SOURCE / 'sources')
    expected['envSet']['H02_PROGRESS_SOURCE_FREEZE'] = str(SOURCE / 'source-freeze.json')
    expected['envSet']['TANSTACK_DB_ORACLE_RUNS_MULTIPLIER'] = '1'
    expected['freshOutputDirectory'] = str(OUTPUT)
    expected['status'] = 'UNADMITTED and UNEXECUTED; independent preparation review and separate exact root one-shot admission required'
    require(recipe == expected, 'unseeded campaign differs beyond the reviewed source/output paths, status and exact default multiplier1')
    require(recipe['property'] == 'query.queued-answer-metadata.scope.default' and recipe['testTimeoutMs'] == 300000, 'campaign identity or timeout changed')
    require(recipe['argv'][-1] == '^' + re.escape(recipe['expectedFilterName']) + '$', 'selector is not exactly anchored')
    require(recipe['innerReceivingBudget'] == {'wallMs': 20000, 'groupRssBytes': 1073741824, 'nodeHeapMiB': 384, 'postEnqueueWindowMs': 1000}, 'inner containment changed')


def previous_gate():
    require(digest(PREVIOUS / 'binding.json') == PREVIOUS_SHA, 'accepted predecessor binding changed')
    require(digest(PREVIOUS / 'verify.py') == PREVIOUS_VERIFY_SHA, 'accepted predecessor gate changed')
    spec = importlib.util.spec_from_file_location('accepted_metadata_fixed_campaign_read_hash_gate', PREVIOUS / 'verify.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify(binding_sha, gate):
    require(gate in ['source', 'receiving'], 'only exact unseeded campaign preflight is prepared')
    require(digest(HERE / 'binding.json') == binding_sha, 'preparation binding changed')
    binding = read(HERE / 'binding.json')
    for name, expected in binding['files'].items():
        require(digest(HERE / name) == expected, f'preparation member changed: {name}')
    for name, expected in binding['externalInputs'].items():
        require(digest(name) == expected, f'bound existing input changed: {name}')
    require(digest(SOURCE / 'source-freeze.json') == SOURCE_SHA, 'reviewed source changed')
    prior = previous_gate()
    prior_result = prior.verify(PREVIOUS_SHA, gate)
    recipe = read(HERE / 'recipe.json')
    check_recipe(recipe)
    names = read(H / 'metadata-update-native-discovery-v2/names.json')
    require(len(names) == 20 and sum(x['name'] == recipe['expectedDisplayName'] for x in names) == 1, 'preserved registration title is not unique')
    result = {'status': 'READ/HASH PREFLIGHT ONLY; requires separate exact root admission',
              'bindingSha256': binding_sha, 'sourceFreezeSha256': SOURCE_SHA,
              'priorReadHashGate': prior_result, 'property': recipe['property'],
              'seed': None, 'seedSource': 'unsupplied; fast-check chooses internally', 'numRuns': 8, 'multiplier': 1,
              'expectedFilterName': recipe['expectedFilterName'],
              'expectedDisplayName': recipe['expectedDisplayName'],
              'titleSuffix': None, 'nativeLaunches': 0, 'nativeProcessProbes': 0,
              'receivingReachCredit': False, 'campaignPassCredit': False}
    if gate == 'receiving':
        result['receivingEvidenceBaseline'] = prior_result.pop('receivingEvidenceBaseline')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--binding', required=True)
    parser.add_argument('--gate', choices=['source', 'receiving'], default='source')
    args = parser.parse_args()
    print(json.dumps(verify(args.binding, args.gate), indent=2, sort_keys=True))
