"""One list per explicit invocation; no automatic selector/receiving chain.

Reuse the frozen, calibrated run_one supervisor unchanged. The successor adds
the accepted source-v2 input gate and durable one-command outer receipts.
Importing this module does not inspect or launch a native process.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys

HERE = Path(__file__).resolve().parent


def load_gate(binding_sha):
    def digest(path):
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    if digest(HERE / 'binding.json') != binding_sha:
        raise ValueError('preparation binding changed before import')
    binding = json.loads((HERE / 'binding.json').read_text())
    for name, expected in binding['files'].items():
        if Path(name).name != name or digest(HERE / name) != expected:
            raise ValueError(f'preparation file changed before import: {name}')
    spec = importlib.util.spec_from_file_location('metadata_update_input_gate', HERE / 'verify.py')
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    return gate


def execute(stage, binding_sha):
    if stage not in ['universe', 'selector']:
        raise ValueError('only a separately admitted universe or selector list may run')
    gate = load_gate(binding_sha)
    preflight = gate.verify(binding_sha, stage)  # Read/hash before mkdir, spawn or process inventory.
    recipes = gate.read(HERE / 'recipes.json')
    recipe = recipes[stage]
    supervisor = gate.supervisor()
    gate.require(set(supervisor.UNSET) == set(recipe['envUnset']), 'inherited environment clearing changed')
    out = Path(recipe['expectedOutput']['path']).parent
    out.mkdir(mode=0o700)  # Fixed, exclusive one-shot output root; never resume or retry in place.
    supervisor.sync_directory(out.parent)
    outer = {'bindingSha256': binding_sha, 'stage': stage, 'outerPid': os.getpid(),
             'outerPgid': os.getpgrp(), 'identityBefore': preflight['identity'],
             'identityAfter': None, 'completedRecipes': [], 'primaryFailure': None,
             'secondaryFailures': [], 'status': 'running', 'productPassCredit': False,
             'receivingReachCredit': False}
    try:
        supervisor.durable_json(out / 'outer-pre.receipt.json', outer)
        for sig in [signal.SIGALRM, signal.SIGTERM, signal.SIGINT]:
            signal.signal(sig, supervisor.interrupted)
        state = supervisor.run_one(recipe, out, binding_sha)  # Exactly one unchanged supervised list.
        outer['completedRecipes'].append(state)
        if state['primaryFailure'] is not None:
            supervisor.fail(outer, recipe['id'], state['primaryFailure'])
        # run_one has completed its reap and original-group absence check first.
        outer['identityAfter'] = gate.verify(binding_sha, stage)['identity']
        gate.require(outer['identityAfter'] == outer['identityBefore'], 'runtime input identity changed')
        outer['status'] = 'qualified' if outer['primaryFailure'] is None else 'stopped'
    except BaseException as error:
        supervisor.fail(outer, 'outer', error)
        outer['status'] = 'stopped'
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        try:
            supervisor.durable_json(out / 'outer-final.receipt.json', outer)
        except BaseException as error:
            supervisor.fail(outer, 'outer-final-receipt', error)
            outer['status'] = 'stopped'
            print(json.dumps(outer), file=sys.stderr)
    return 0 if outer['status'] == 'qualified' else 1


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[1] != '--execute-exact-one':
        raise ValueError('Separate root admission required: --execute-exact-one universe|selector <binding-sha256>')
    sys.exit(execute(sys.argv[2], sys.argv[3]))
