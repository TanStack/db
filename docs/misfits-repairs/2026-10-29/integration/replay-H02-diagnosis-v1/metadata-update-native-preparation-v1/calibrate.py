"""Pure launcher/gate controls. Synthetic receipts stay in temporary roots.

No native list, registration, receiving driver, process probe or process signal
is allowed. The unchanged supervisor's existing 17 containment controls remain
the authority for its implementation; these controls exercise only new glue.
"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import signal
import shlex
import subprocess
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def forbidden(*args, **kwargs):
    raise AssertionError('native process, probe or signal forbidden in pure controls')


def run():
    gate = load('pure_metadata_update_gate', HERE / 'verify.py')
    launch = load('pure_metadata_update_launch', HERE / 'launch.py')
    supervisor = gate.supervisor()  # Frozen Python definitions only.
    results = {'status': 'PURE SYNTHETIC CONTROLS ONLY; zero native/product/reach credit',
               'accepted': [], 'rejected': [], 'nativeLaunches': 0, 'nativeProcessProbes': 0}
    receiving = gate.read(HERE / 'recipes.json')['receiving']
    lines = (HERE / 'launcher-scope-default-q2.zsh').read_text().splitlines()
    tokens = ['exec', 'env']
    for key in receiving['envUnset']:
        tokens += ['-u', key]
    tokens += [f'{key}={value}' for key, value in receiving['envSet'].items()]
    tokens += [receiving['executable']] + receiving['argv']
    tokens += ['>', str(Path(receiving['freshOutputDirectory']) / 'outer-vitest.log'), '2>&1']
    assert shlex.split(lines[-1]) == tokens, 'receiving shell differs from exact structured recipe'
    assert lines.index(next(line for line in lines if '--gate receiving' in line)) < lines.index(
        next(line for line in lines if line.startswith('/bin/ps '))) < len(lines) - 1
    results['accepted'].append('receiving shell exact argv/environment and preflight ordering, parsed only')
    guards = [('Popen', subprocess), ('run', subprocess), ('call', subprocess),
              ('check_call', subprocess), ('check_output', subprocess),
              ('getpgid', os), ('kill', os), ('killpg', os), ('system', os), ('fork', os)]
    from contextlib import ExitStack
    with tempfile.TemporaryDirectory(prefix='metadata-update-prep-pure-', dir='/private/tmp') as temporary:
        root = Path(temporary)
        with ExitStack() as stack:
            for name, owner in guards:
                stack.enter_context(patch.object(owner, name, forbidden))
            # Qualifier calibration uses real file reads, never collection.
            case = root / 'qualification'
            case.mkdir()
            recipe = {'expectedOutput': {'path': str(case / 'names.json'), 'count': 1,
                       'names': ["suite > source followup 'scope' 'default' quarter 2"], 'module': '/synthetic/source.ts'},
                      'stdoutPath': str(case / 'stdout.log'), 'stderrPath': str(case / 'stderr.log')}
            rows = [{'file': '/synthetic/source.ts', 'name': recipe['expectedOutput']['names'][0]}]
            write(case / 'names.json', rows)
            (case / 'stdout.log').write_text('')
            (case / 'stderr.log').write_text('')
            supervisor.qualify_output(recipe)
            results['accepted'].append('synthetic exact display name qualifies')
            write(case / 'names.json', [dict(rows[0], name=rows[0]['name'].replace(' > ', ' '))])
            try:
                supervisor.qualify_output(recipe)
            except ValueError:
                results['rejected'].append('space-joined filter cannot stand in for display name')
            else:
                raise AssertionError('display/filter control accepted')

            # Exercise one-shot wrapper ordering with no real process API.
            for name in ['success', 'child-failure', 'postflight-failure', 'both-fail', 'preflight-failure', 'identity-change']:
                out = root / name
                calls = []
                selected = {'id': 'synthetic-only', 'envUnset': list(supervisor.UNSET),
                            'expectedOutput': {'path': str(out / 'names.json')}}
                def preflight(binding, stage):
                    calls.append('verify')
                    if (name == 'preflight-failure' and calls.count('verify') == 1) or (
                            name in ['postflight-failure', 'both-fail'] and calls.count('verify') == 2):
                        raise ValueError('synthetic source gate failure')
                    return {'identity': {'epoch': 2 if name == 'identity-change' and calls.count('verify') == 2 else 1}}
                def one(*args):
                    calls.append('one')
                    return {'primaryFailure': {'phase': 'synthetic-child', 'error': 'preserve first'}
                            if name in ['child-failure', 'both-fail'] else None, 'secondaryFailures': []}
                fake_supervisor = SimpleNamespace(UNSET=supervisor.UNSET, sync_directory=lambda p: None,
                    durable_json=supervisor.durable_json, fail=supervisor.fail, interrupted=supervisor.interrupted,
                    run_one=one)
                fake_gate = SimpleNamespace(verify=preflight, read=lambda p: {'universe': selected},
                                            supervisor=lambda: fake_supervisor, require=gate.require)
                with patch.object(launch, 'load_gate', return_value=fake_gate), \
                     patch.object(os, 'getpid', return_value=1001), patch.object(os, 'getpgrp', return_value=1001), \
                     patch.object(signal, 'signal', return_value=None), patch.object(signal, 'setitimer', return_value=None):
                    if name == 'preflight-failure':
                        try:
                            launch.execute('universe', 'synthetic-binding')
                        except ValueError:
                            assert calls == ['verify'] and not out.exists()
                            results['rejected'].append('preflight failure occurs before output or child')
                        else:
                            raise AssertionError('preflight failure launched')
                        continue
                    status = launch.execute('universe', 'synthetic-binding')
                assert calls == ['verify', 'one', 'verify'], calls
                final = gate.read(out / 'outer-final.receipt.json')
                assert len(final['completedRecipes']) == 1
                if name == 'success':
                    assert status == 0 and final['status'] == 'qualified'
                    results['accepted'].append('one command, postflight after return, no chain')
                else:
                    assert status == 1 and final['status'] == 'stopped'
                    if name == 'both-fail':
                        assert final['primaryFailure']['phase'] == 'synthetic-only'
                        assert len(final['secondaryFailures']) == 1
                    results['rejected'].append(name)

            # Gate grammar is exercised on synthetic data under a temporary H.
            with patch.object(gate, 'H', root / 'synthetic-H'):
                gate.H.mkdir()
                paths = gate.classification_paths('universe')
                paths['review'].parent.mkdir()
                paths['review'].write_text('SYNTHETIC accepted fixture; no actual result review\n')
                out = root / 'synthetic-native-output'
                out.mkdir()
                native_recipe = copy.deepcopy(recipe)
                native_recipe.update(id='synthetic-only', stdoutPath=str(out / 'stdout.log'), stderrPath=str(out / 'stderr.log'))
                native_recipe['expectedOutput']['path'] = str(out / 'names.json')
                write(out / 'names.json', rows)
                (out / 'stdout.log').write_text('')
                (out / 'stderr.log').write_text('')
                qualified = supervisor.qualify_output(native_recipe)
                child = {'recipeId': 'synthetic-only', 'primaryFailure': None, 'secondaryFailures': [],
                         'pid': 2002, 'pgid': 2002, 'pgidVerified': True, 'remainingGroupRows': [],
                         'killAttempts': [], 'exitCode': 0, 'qualification': qualified, 'elapsedMs': 10}
                outer = {'status': 'qualified', 'stage': 'universe', 'bindingSha256': 'synthetic-binding',
                         'outerPid': 1001, 'outerPgid': 1001, 'primaryFailure': None, 'secondaryFailures': [],
                         'completedRecipes': [child], 'identityBefore': {'synthetic': True}, 'identityAfter': {'synthetic': True}}
                actual = {'actualOuterExitCode': 0, 'completionToolReturn': {'exit_code': 0}, 'outerPid': 1001, 'outerPgid': 1001}
                absence = {'probes': [dict(zip(['participant', 'kind', 'identity', 'status'], values)) for values in
                           [('outer', 'pid', 1001, 'empty-ESRCH'), ('outer', 'pgid', 1001, 'empty-ESRCH'),
                            ('child', 'pid', 2002, 'empty-ESRCH'), ('child', 'pgid', 2002, 'empty-ESRCH')]]}
                classified = {'classifiedBy': '/root', 'boundedAccepted': True, 'newRuntimeAdmitted': False,
                              'stage': 'universe', 'bindingSha256': 'synthetic-binding', 'sourceFreezeSha256': gate.SOURCE_SHA,
                              'independentActualResultAccepted': True, 'productPassCredit': False, 'receivingReachCredit': False}
                base = copy.deepcopy((child, outer, actual, absence, classified))
                def prepare(mutate=lambda c, o, a, ab, cl: None):
                    c, o, a, ab, cl = copy.deepcopy(base)
                    mutate(c, o, a, ab, cl)
                    # Keep nested state consistent so controls reach the intended rule.
                    o['completedRecipes'] = [c]
                    write(out / '00-final.receipt.json', dict(c, phase='final', bindingSha256='synthetic-binding', elapsedMs=11))
                    write(out / 'outer-final.receipt.json', o)
                    write(paths['return'], a)
                    write(paths['absence'], ab)
                    freeze = {'bindingSha256': 'synthetic-binding', 'sourceFreezeSha256': gate.SOURCE_SHA,
                              'outputDirectory': str(out), 'assets': {p.name: gate.digest(p) for p in out.iterdir()}}
                    write(paths['freeze'], freeze)
                    for key, field in [('freeze', 'resultFreezeSha256'), ('return', 'actualOuterReturnSha256'),
                                       ('absence', 'rootAbsenceSha256'), ('review', 'independentReviewSha256')]:
                        cl[field] = gate.digest(paths[key])
                    write(paths['classification'], cl)
                prepare()
                gate.verify_classification('universe', 'synthetic-binding', {'universe': native_recipe})
                results['accepted'].append('synthetic complete classified actual-result grammar')
                mutants = {
                    'wrong root classifier': lambda c,o,a,ab,cl: cl.update(classifiedBy='/other'),
                    'unaccepted root result': lambda c,o,a,ab,cl: cl.update(boundedAccepted=False),
                    'classification cannot admit runtime': lambda c,o,a,ab,cl: cl.update(newRuntimeAdmitted=True),
                    'wrong binding epoch': lambda c,o,a,ab,cl: cl.update(bindingSha256='stale'),
                    'wrong source epoch': lambda c,o,a,ab,cl: cl.update(sourceFreezeSha256='stale'),
                    'missing independent acceptance': lambda c,o,a,ab,cl: cl.update(independentActualResultAccepted=False),
                    'no product pass credit': lambda c,o,a,ab,cl: cl.update(productPassCredit=True),
                    'no receiving reach credit': lambda c,o,a,ab,cl: cl.update(receivingReachCredit=True),
                    'actual outer nonzero': lambda c,o,a,ab,cl: a.update(actualOuterExitCode=1),
                    'actual completion nonzero': lambda c,o,a,ab,cl: a['completionToolReturn'].update(exit_code=1),
                    'wrong original outer ID': lambda c,o,a,ab,cl: a.update(outerPid=1002),
                    'outer stopped': lambda c,o,a,ab,cl: o.update(status='stopped'),
                    'postflight identity absent': lambda c,o,a,ab,cl: o.update(identityAfter=None),
                    'returned clock exceeds final receipt clock': lambda c,o,a,ab,cl: c.update(elapsedMs=12),
                    'child nonzero': lambda c,o,a,ab,cl: c.update(exitCode=1),
                    'unverified original group': lambda c,o,a,ab,cl: c.update(pgidVerified=False),
                    'child cleanup uncertain': lambda c,o,a,ab,cl: c.update(remainingGroupRows=[{'pid':2002}]),
                    'child killed': lambda c,o,a,ab,cl: c.update(killAttempts=[{'targetPgid':2002}]),
                    'child secondary failure': lambda c,o,a,ab,cl: c.update(secondaryFailures=[{'error':'synthetic'}]),
                    'absent original ID evidence': lambda c,o,a,ab,cl: ab['probes'].pop(),
                    'wrong original child ID evidence': lambda c,o,a,ab,cl: ab['probes'][2].update(identity=2003),
                    'uncertain original absence': lambda c,o,a,ab,cl: ab['probes'][3].update(status='unknown'),
                }
                for name, mutate in mutants.items():
                    prepare(mutate)
                    try:
                        gate.verify_classification('universe', 'synthetic-binding', {'universe': native_recipe})
                    except (ValueError, KeyError):
                        results['rejected'].append(name)
                    else:
                        raise AssertionError(f'gate accepted hostile synthetic receipt: {name}')
                prepare()
                (out / 'stdout.log').write_text('changed after freeze')
                try:
                    gate.verify_classification('universe', 'synthetic-binding', {'universe': native_recipe})
                except ValueError:
                    results['rejected'].append('preserved raw output changed after freeze')
                else:
                    raise AssertionError('changed raw output accepted')

            sequence = []
            with patch.object(gate, 'verify_inputs', return_value=({}, {'synthetic': True})), \
                 patch.object(gate, 'verify_classification', side_effect=lambda stage,*a: sequence.append(stage) or {'stage':stage}):
                gate.verify('synthetic-binding', 'universe')
                assert sequence == []
                gate.verify('synthetic-binding', 'selector')
                assert sequence == ['universe']
                sequence.clear()
                gate.verify('synthetic-binding', 'receiving')
                assert sequence == ['universe', 'selector']
                results['accepted'].append('separate gate dependency order; universe has no inferred results')
    results['acceptedCount'] = len(results['accepted'])
    results['rejectedCount'] = len(results['rejected'])
    return results


if __name__ == '__main__':
    print(json.dumps(run(), indent=2, sort_keys=True))
