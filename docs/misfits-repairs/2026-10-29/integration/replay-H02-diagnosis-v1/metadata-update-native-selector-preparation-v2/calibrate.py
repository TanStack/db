"""Pure exact-selector namespace and accepted-clean-universe controls."""
import copy
from contextlib import ExitStack
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def forbidden(*args, **kwargs):
    raise AssertionError('native/process API forbidden during selector source preparation')


def run(binding_sha):
    gate = load('pure_exact_metadata_selector_gate', HERE / 'verify.py')
    entry = load('pure_exact_metadata_selector_entry', HERE / 'run.py')
    accepted = []
    rejected = []
    with ExitStack() as stack:
        for owner, names in [(subprocess, ['Popen', 'run', 'call', 'check_call', 'check_output']),
                             (os, ['getpid', 'getpgrp', 'getpgid', 'kill', 'killpg', 'system', 'fork']),
                             (signal, ['signal', 'setitimer'])]:
            for name in names:
                stack.enter_context(patch.object(owner, name, forbidden))
        checked = gate.verify(binding_sha, 'selector')
        assert checked['priorClassifications'][0]['nativeNames'] == 20
        accepted.append('full existing source gate and accepted clean actual universe rechecked')
        wrapper = entry.load_wrapper()
        imported = wrapper.load_gate(binding_sha)
        prior, checker = gate.accepted_universe()
        assert wrapper.HERE == imported.HERE == HERE
        p2 = gate.previous_gate()
        assert Path(wrapper.execute.__code__.co_filename) == p2.PREVIOUS / 'launch.py'
        assert Path(checker.verify_classification.__code__.co_filename) == p2.PREVIOUS / 'verify.py'
        accepted.append('original wrapper and clean-result judgment reused; fixed epoch paths only')
        calls = []
        with patch.object(entry, 'load_wrapper', return_value=SimpleNamespace(
                execute=lambda stage, binding: calls.append((stage, binding)) or 17)):
            assert entry.execute(binding_sha) == 17
        assert calls == [('selector', binding_sha)]
        accepted.append('exact selector-only one-command dispatch')
        universe = gate.read(gate.PREVIOUS / 'recipes.json')['universe']
        program = gate.read(p2.PREVIOUS / 'program.json')
        recipe = gate.read(HERE / 'recipes.json')['selector']
        gate.check_recipe(recipe, universe, program)
        assert recipe['expectedOutput']['count'] == 1 and recipe['expectedOutput']['names'] == [program['displayName']]
        assert program['filterName'] != program['displayName'] and recipe['argv'][-1].startswith('^') and recipe['argv'][-1].endswith('$')
        accepted.append('one intended positive-quarter display and distinct anchored match filter')
        cases = [
            ('unanchored filter', lambda r: r['argv'].__setitem__(-1, r['argv'][-1][1:-1])),
            ('display name used as filter', lambda r: r['argv'].__setitem__(-1, '^'+program['displayName']+'$')),
            ('wrong singleton count', lambda r: r['expectedOutput'].update(count=2)),
            ('wrong selected name', lambda r: r['expectedOutput'].update(names=[program['displayName'].replace('quarter 2','quarter +0')])),
            ('wrong module', lambda r: r['expectedOutput'].update(module='/other.ts')),
            ('old output reused', lambda r: r['expectedOutput'].update(path=universe['expectedOutput']['path'])),
            ('changed source cwd', lambda r: r.update(cwd='/other/source')),
            ('raised wall budget', lambda r: r.update(outerWallContainmentMs=60000)),
            ('changed environment', lambda r: r.update(envUnset=[])),
            ('raised heap', lambda r: r.update(workerNodeHeapMiB=768)),
        ]
        for name, mutate in cases:
            wrong = copy.deepcopy(recipe); mutate(wrong)
            try:
                gate.check_recipe(wrong, universe, program)
            except ValueError:
                rejected.append(name)
            else:
                raise AssertionError(f'wrong selector recipe accepted: {name}')
        for stage in ['universe', 'receiving']:
            try:
                gate.verify(binding_sha, stage)
            except ValueError as error:
                assert str(error).startswith('only singleton discovery')
                rejected.append(f'{stage} not prepared')
            else:
                raise AssertionError('wrong native stage allowed')
        try:
            wrapper.load_gate('wrong-binding')
        except ValueError:
            rejected.append('wrong binding before import')
        else:
            raise AssertionError('wrong selector binding accepted')
        # Original failed epoch must still fail the unchanged clean checker.
        actual_paths = gate.universe_paths('universe')
        failed_paths = dict(actual_paths, classification=gate.H/'metadata-update-native-discovery-root-stopped-classification-v1.json')
        checker.classification_paths = lambda stage: failed_paths
        try:
            checker.verify_classification('universe', gate.PREVIOUS_BINDING, {'universe': universe})
        except ValueError as error:
            assert str(error) == 'missing exact bounded root classification'
            rejected.append('original stopped epoch cannot substitute for clean fresh universe')
        else:
            raise AssertionError('old stopped epoch accepted')
        checker.classification_paths = gate.universe_paths
        original_read = checker.read
        actual_classification = original_read(gate.CLASSIFICATION)
        false_admission = dict(actual_classification, newRuntimeAdmitted=True)
        with patch.object(checker, 'read', side_effect=lambda path: false_admission if Path(path)==gate.CLASSIFICATION else original_read(path)):
            try:
                checker.verify_classification('universe', gate.PREVIOUS_BINDING, {'universe': universe})
            except ValueError:
                rejected.append('prior classification cannot itself admit new runtime')
            else:
                raise AssertionError('classification admission accepted')
        try:
            gate.universe_paths('selector')
        except ValueError:
            rejected.append('prior result path provider cannot select another stage')
        else:
            raise AssertionError('unconfigured prior epoch accepted')
        assert not gate.OUTPUT.exists()
        accepted.append('fresh singleton native output remains absent')
    return {'status':'PURE SOURCE/PRIOR-RESULT CHECKS ONLY; no selector execution or result',
            'accepted':accepted, 'rejected':rejected, 'acceptedCount':len(accepted), 'rejectedCount':len(rejected),
            'sourceAndPriorResultPreflight':checked, 'nativeLaunches':0, 'nativeProcessProbes':0,
            'originalStoppedResultAcceptedAsSuccess':False, 'productPassCredit':False, 'receivingReachCredit':False}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise ValueError('Expected exact selector binding SHA256')
    print(json.dumps(run(sys.argv[1]), indent=2, sort_keys=True))
