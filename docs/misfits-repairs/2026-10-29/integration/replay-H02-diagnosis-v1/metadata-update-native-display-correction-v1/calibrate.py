"""Pure captured-name controls; no native process or result rewriting."""
import copy
from contextlib import ExitStack
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def forbidden(*args, **kwargs):
    raise AssertionError('native API forbidden during captured display calibration')


def run(binding_sha):
    spec = importlib.util.spec_from_file_location('captured_metadata_display_check', HERE / 'check.py')
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    with ExitStack() as stack:
        for owner, names in [(subprocess, ['Popen', 'run', 'call', 'check_call', 'check_output']),
                             (os, ['getpgid', 'kill', 'killpg', 'system', 'fork'])]:
            for name in names:
                stack.enter_context(patch.object(owner, name, forbidden))
        result = checker.verify(binding_sha)
        gate = checker.gate()
        supervisor = gate.supervisor()
        recipe = gate.read(HERE / 'corrected-universe-recipe.json')
        reordered = copy.deepcopy(recipe)
        reordered['expectedOutput']['names'].reverse()
        supervisor.qualify_output(reordered)
        accepted = ['captured corrected exact20 DISPLAY names', 'exact name set independent of order']
        rejected = ['captured old quarter0 expected-name check: wrong native list names']
        cases = {}
        one = copy.deepcopy(recipe)
        index = next(i for i, name in enumerate(one['expectedOutput']['names']) if name.endswith('quarter +0'))
        one['expectedOutput']['names'][index] = one['expectedOutput']['names'][index].replace('quarter +0', 'quarter 0')
        cases['one uncorrected no-op display'] = one
        one = copy.deepcopy(recipe)
        one['expectedOutput']['names'][index] = one['expectedOutput']['names'][index].replace('quarter +0', 'quarter .*')
        cases['pattern text cannot weaken exact display comparison'] = one
        one = copy.deepcopy(recipe); one['expectedOutput']['module'] = '/wrong/module.ts'
        cases['wrong module'] = one
        one = copy.deepcopy(recipe); one['expectedOutput']['count'] = 19
        cases['lowered count'] = one
        one = copy.deepcopy(recipe); one['expectedOutput']['names'][0] = one['expectedOutput']['names'][1]
        cases['duplicate expected name'] = one
        one = copy.deepcopy(recipe); one['expectedOutput']['names'].append('invented name'); one['expectedOutput']['count'] = 21
        cases['invented extra case'] = one
        one = copy.deepcopy(recipe)
        index = next(i for i, name in enumerate(one['expectedOutput']['names']) if name.endswith('quarter 2'))
        one['expectedOutput']['names'][index] = one['expectedOutput']['names'][index].replace('quarter 2', 'quarter +2')
        cases['positive quarter display must stay unchanged'] = one
        for name, wrong in cases.items():
            try:
                supervisor.qualify_output(wrong)
            except ValueError:
                rejected.append(name)
            else:
                raise AssertionError(f'wrong expected-name recipe accepted: {name}')
        return {'status': 'PURE CHECKER CALIBRATION ON PRESERVED CAPTURED BYTES; no new native execution',
                'accepted': accepted, 'rejected': rejected, 'acceptedCount': len(accepted),
                'rejectedCount': len(rejected), 'capturedRequalification': result,
                'nativeLaunches': 0, 'nativeProcessProbes': 0, 'productRedGreenCredit': False}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise ValueError('Expected exact correction binding SHA256')
    print(json.dumps(run(sys.argv[1]), indent=2, sort_keys=True))
