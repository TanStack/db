"""Pure fresh-namespace checks. The existing wrapper/containment is reused.

No native list, registration, process inventory or signals may execute. The
accepted earlier wrapper calibration owns one-list stopping/containment glue.
"""
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
    raise AssertionError('native/process API forbidden in fresh universe preparation controls')


def run(binding_sha):
    gate = load('fresh_metadata_preflight', HERE / 'verify.py')
    entry = load('fresh_metadata_entry', HERE / 'run.py')
    accepted = []
    rejected = []
    with ExitStack() as stack:
        for owner, names in [(subprocess, ['Popen', 'run', 'call', 'check_call', 'check_output']),
                             (os, ['getpid', 'getpgrp', 'getpgid', 'kill', 'killpg', 'system', 'fork']),
                             (signal, ['signal', 'setitimer'])]:
            for name in names:
                stack.enter_context(patch.object(owner, name, forbidden))
        checked = gate.verify(binding_sha, 'universe')
        accepted.append('full unchanged source gate and preserved stopped epoch; no result substitution')
        wrapper = entry.load_wrapper()
        assert wrapper.HERE == HERE
        assert Path(wrapper.execute.__code__.co_filename) == entry.PREVIOUS / 'launch.py'
        imported_gate = wrapper.load_gate(binding_sha)
        assert imported_gate.HERE == HERE
        accepted.append('original wrapper functions reused; only namespace configured')
        calls = []
        with patch.object(entry, 'load_wrapper', return_value=SimpleNamespace(
                execute=lambda stage, binding: calls.append((stage, binding)) or 17)):
            assert entry.execute(binding_sha) == 17
        assert calls == [('universe', binding_sha)]
        accepted.append('entry dispatches exactly one universe with unchanged binding')
        recipes = gate.read(HERE / 'recipes.json')
        corrected = gate.read(gate.CORRECTION / 'corrected-universe-recipe.json')
        gate.check_recipe(recipes['universe'], corrected)
        accepted.append('exact four-name correction plus fresh identity/output only')
        cases = {}
        original = recipes['universe']
        for name, mutate in [
            ('old zero display', lambda r: r['expectedOutput']['names'].__setitem__(
                next(i for i,n in enumerate(r['expectedOutput']['names']) if n.endswith('quarter +0')),
                next(n for n in r['expectedOutput']['names'] if n.endswith('quarter +0')).replace('quarter +0','quarter 0'))),
            ('lowered count', lambda r: r['expectedOutput'].update(count=19)),
            ('changed module', lambda r: r['expectedOutput'].update(module='/other.ts')),
            ('changed filter/argv', lambda r: r['argv'].extend(['-t','.*'])),
            ('old reused output', lambda r: r['expectedOutput'].update(path=str(gate.H/'metadata-update-native-discovery-v1/names.json'))),
            ('raised wall budget', lambda r: r.update(outerWallContainmentMs=60000)),
            ('raised memory budget', lambda r: r.update(groupRssContainmentBytes=2147483648)),
            ('changed environment', lambda r: r.update(envUnset=[])),
            ('changed working source', lambda r: r.update(cwd='/other/source')),
            ('unbounded workers', lambda r: r.update(maxWorkers=2)),
        ]:
            wrong = copy.deepcopy(original); mutate(wrong); cases[name] = wrong
        for name, wrong in cases.items():
            try:
                gate.check_recipe(wrong, corrected)
            except ValueError:
                rejected.append(name)
            else:
                raise AssertionError(f'wrong fresh universe recipe accepted: {name}')
        for stage in ['selector','receiving']:
            try:
                gate.verify(binding_sha, stage)
            except ValueError as error:
                assert str(error).startswith('only fresh universe')
                rejected.append(f'{stage} is not prepared')
            else:
                raise AssertionError('later stage admitted')
        try:
            wrapper.load_gate('wrong-binding')
        except ValueError:
            rejected.append('wrong binding before namespace import')
        else:
            raise AssertionError('wrong binding accepted')
        assert not gate.OUTPUT.exists()
        accepted.append('fresh native output remains absent')
    return {'status':'PURE SOURCE/NAMESPACE CHECKS ONLY; no native result or admission',
            'accepted':accepted, 'rejected':rejected, 'acceptedCount':len(accepted), 'rejectedCount':len(rejected),
            'sourcePreflight':checked, 'nativeLaunches':0, 'nativeProcessProbes':0,
            'originalStoppedResultAcceptedAsSuccess':False, 'productPassCredit':False, 'receivingReachCredit':False}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise ValueError('Expected exact fresh-universe binding SHA256')
    print(json.dumps(run(sys.argv[1]), indent=2, sort_keys=True))
