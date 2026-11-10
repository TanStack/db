"""Pure receiving invocation and prerequisite controls; never executes the shell."""
import copy
from contextlib import ExitStack
import importlib.util
import json
import os
from pathlib import Path
import shlex
import signal
import stat
import subprocess
import sys
import tempfile
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def forbidden(*args, **kwargs):
    raise AssertionError('native/process API forbidden during receiving source preparation')


def run(binding_sha):
    gate = load('pure_metadata_receiving_gate', HERE / 'verify.py')
    accepted = []
    rejected = []
    with tempfile.TemporaryDirectory(prefix='metadata-receiving-prep-pure-', dir='/private/tmp') as temporary:
        fixture = Path(temporary)
        with ExitStack() as stack:
            for owner, names in [(subprocess, ['Popen', 'run', 'call', 'check_call', 'check_output']),
                                 (os, ['getpid', 'getpgrp', 'getpgid', 'kill', 'killpg', 'system', 'fork']),
                                 (signal, ['signal', 'setitimer'])]:
                for name in names:
                    stack.enter_context(patch.object(owner, name, forbidden))
            checked = gate.verify(binding_sha, 'receiving')
            assert [c['nativeNames'] for c in checked['priorClassifications']] == [20, 1]
            accepted.append('full original source gate and both accepted clean actual epochs rechecked')
            recipe = gate.read(HERE / 'recipes.json')['receiving']
            original = gate.read(gate.ORIGINAL / 'recipes.json')['receiving']
            program = gate.read(gate.ORIGINAL / 'program.json')
            shell = (HERE / 'launcher-scope-default-q2.zsh').read_text()
            original_shell = (gate.ORIGINAL / 'launcher-scope-default-q2.zsh').read_text()
            expected_shell = original_shell.replace(str(gate.ORIGINAL / 'verify.py'), str(HERE / 'verify.py')).replace(
                str(gate.H / 'metadata-update-native-scope-default-q2-v1'), str(gate.OUTPUT))
            assert shell == expected_shell
            accepted.append('original direct shell differs only by preflight and fresh output paths')
            lines = shell.splitlines()
            tokens = ['exec', 'env']
            for key in recipe['envUnset']:
                tokens += ['-u', key]
            tokens += [f'{key}={value}' for key, value in recipe['envSet'].items()]
            tokens += [recipe['executable']] + recipe['argv'] + ['>', str(gate.OUTPUT / 'outer-vitest.log'), '2>&1']
            assert shlex.split(lines[-1]) == tokens
            assert lines.index(next(line for line in lines if '--gate receiving' in line)) < lines.index(
                next(line for line in lines if line.startswith('/bin/ps '))) < len(lines) - 1
            accepted.append('exact argv/environment/filter and full preflight before probe/native exec, parsed only')
            _, checker = gate.accepted_selector()
            previous = gate.previous_gate()
            assert Path(checker.verify_classification.__code__.co_filename) == previous.previous_gate().PREVIOUS / 'verify.py'
            accepted.append('unchanged original clean-result checker with fixed selector paths')
            assert len(program['requiredReachStates']) == 31
            assert program['history'] == recipe['receivingHistory'] == checked['canonicalProgram']['history']
            assert program['canonicalProgramSha256'] == 'bb837d81114314f37f2d8383f471aedbd3d2a3350c84db4075a5d3b79247b213'
            accepted.append('exact positive program, finalizer identity and 31 required future reach states')
            cases = [
                ('wrong source-freeze environment', lambda r: r['envSet'].update(H02_PROGRESS_SOURCE_FREEZE='/other/freeze.json')),
                ('nonexact filter', lambda r: r['argv'].__setitem__(-1, '.*')),
                ('changed cache lane', lambda r: r['receivingHistory'].update(cacheIdentity='subscription')),
                ('changed metadata keys', lambda r: r['receivingHistory'].update(metadataKeys='authored')),
                ('no-op instead of positive program', lambda r: r['receivingHistory'].update(metadataFollowupQuarter=0)),
                ('raised outer test timeout', lambda r: r.update(testTimeoutMs=120000)),
                ('raised inner wall limit', lambda r: r['innerReceivingBudget'].update(wallMs=40000)),
                ('raised group RSS limit', lambda r: r['innerReceivingBudget'].update(groupRssBytes=2147483648)),
                ('raised post-enqueue window', lambda r: r['innerReceivingBudget'].update(postEnqueueWindowMs=2000)),
                ('old output reused', lambda r: r.update(freshOutputDirectory=original['freshOutputDirectory'])),
            ]
            for name, mutate in cases:
                wrong = copy.deepcopy(recipe); mutate(wrong)
                try:
                    gate.check_recipe(wrong, original, program)
                except ValueError:
                    rejected.append(name)
                else:
                    raise AssertionError(f'wrong receiving recipe accepted: {name}')
            for stage in ['universe', 'selector', 'retry']:
                try:
                    gate.verify(binding_sha, stage)
                except ValueError as error:
                    assert str(error).startswith('only exact receiving')
                    rejected.append(f'{stage} not prepared')
                else:
                    raise AssertionError('another stage admitted')
            try:
                gate.verify('wrong-binding')
            except ValueError:
                rejected.append('wrong receiving binding')
            else:
                raise AssertionError('wrong binding accepted')
            original_read = checker.read
            for name, path in [('old stopped epoch', gate.H/'metadata-update-native-discovery-root-stopped-classification-v1.json'),
                               ('universe substituted for selector', gate.H/'metadata-update-native-discovery-root-classification-v2.json')]:
                paths = dict(gate.selector_paths('selector'), classification=path)
                checker.classification_paths = lambda stage: paths
                try:
                    checker.verify_classification('selector', gate.PREVIOUS_BINDING, gate.read(gate.PREVIOUS/'recipes.json'))
                except ValueError as error:
                    assert str(error) == 'missing exact bounded root classification'
                    rejected.append(name)
                else:
                    raise AssertionError('wrong prior epoch accepted')
            checker.classification_paths = gate.selector_paths
            false_admission = dict(original_read(gate.CLASSIFICATION), newRuntimeAdmitted=True)
            with patch.object(checker, 'read', side_effect=lambda path: false_admission if Path(path)==gate.CLASSIFICATION else original_read(path)):
                try:
                    checker.verify_classification('selector', gate.PREVIOUS_BINDING, gate.read(gate.PREVIOUS/'recipes.json'))
                except ValueError:
                    rejected.append('prior classification cannot admit receiving runtime')
                else:
                    raise AssertionError('prior classification admission accepted')
            try:
                gate.selector_paths('receiving')
            except ValueError:
                rejected.append('unconfigured prior-result stage')
            else:
                raise AssertionError('unconfigured prior-result path accepted')
            (fixture/'h02-progress-old').mkdir()
            (fixture/'unrelated').write_text('fixture')
            (fixture/'h02-progress-link').symlink_to(fixture/'h02-progress-old', target_is_directory=True)
            before = gate.receipt_baseline(fixture)
            (fixture/'h02-progress-new').mkdir()
            after = gate.receipt_baseline(fixture)
            assert set(before['members']) == {'h02-progress-old', 'h02-progress-link'}
            assert set(after['members']) - set(before['members']) == {'h02-progress-new'}
            assert stat.S_ISLNK(before['members']['h02-progress-link']['mode'])
            assert 'selected' not in before and 'artifact' not in before
            accepted.append('passive synthetic baseline records candidate identities without following links or selecting an artifact')
            try:
                gate.receipt_baseline(fixture/'missing-root')
            except ValueError:
                rejected.append('unavailable passive baseline root')
            else:
                raise AssertionError('missing baseline root accepted')
            assert not gate.OUTPUT.exists()
            accepted.append('fresh receiving output remains absent')
    return {'status':'PURE SOURCE/PRIOR-EVIDENCE/SHELL CHECKS ONLY; no receiving execution or result',
            'accepted':accepted, 'rejected':rejected, 'acceptedCount':len(accepted), 'rejectedCount':len(rejected),
            'sourceAndPriorResultPreflight':checked, 'nativeLaunches':0, 'nativeProcessProbes':0,
            'originalStoppedResultAcceptedAsSuccess':False, 'productPassCredit':False, 'receivingReachCredit':False}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise ValueError('Expected exact receiving preparation binding SHA256')
    print(json.dumps(run(sys.argv[1]), indent=2, sort_keys=True))
