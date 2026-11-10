"""Static input sanity checks, not model stepping or production execution."""
import datetime
import hashlib
import json
import pathlib

R = pathlib.Path(__file__).resolve().parent
I = R.parent / 'candidate-controls-baseline-batch-preparation-v1'
P = I / 'frozen-inputs-v1/programs'
plan = json.loads((I / 'selection-plan-v1.json').read_text())
failures, cells = [], []


def check(ok, message):
    if not ok:
        failures.append(message)


def sem(step):
    if step['kind'] == 'semantic':
        return step['action']['type']
    if step['kind'] == 'control':
        return 'control:' + step['control']
    return 'observe:' + step['boundary']


def signature(gate, facade):
    installs = ['install'] * (7 if facade else 1)
    if gate in ['park-root', 'park-facade', 'cleanup-abandonment']:
        prefix = ['optimistic-overlay', 'control:bind-output-holds', 'source-write',
                  'require', 'stage-output', 'observe:held-output']
        return prefix + (['cleanup', 'restart', 'observe:cleanup-abandoned',
                          'control:establish-replacement'] + installs + ['mark-ready', 'observe:public-state']
                         if gate == 'cleanup-abandonment' else
                         ['settle-optimistic', 'apply-output', 'observe:public-state'])
    if gate == 'held-window':
        return ['require', 'control:begin-replay', 'request-window', 'observe:held-window',
                'source-answer'] + installs + ['observe:completed-window']
    if gate == 'source-failed-peer':
        return ['require', 'require', 'control:hold-demand-sources', 'request-window',
                'observe:held-window', 'source-failure', 'observe:source-failed-peer',
                'source-answer', 'observe:public-state']
    if gate == 'subscriber-tail':
        return ['require', 'control:arm-subscriber-tail', 'source-write'] + installs + [
            'tail-failure', 'observe:installed-tail-exception']
    if gate == 'initial-status-tail':
        return ['require', 'require', 'control:prepare-held-initial',
                'control:arm-initial-status-tail', 'request-initial', 'source-answer'] + installs + [
            'mark-ready', 'tail-failure', 'observe:installed-tail-exception']
    if gate == 'graph-failure':
        return ['require', 'control:hold-demand-sources', 'request-window',
                'control:throw-current-graph', 'graph-failure', 'observe:graph-exception']
    if gate == 'facade-rollback':
        return ['require', 'optimistic-overlay', 'control:bind-output-holds',
                'control:arm-facade-B-commit-fault', 'source-write', 'require', 'stage-output',
                'require', 'stage-output', 'tail-failure', 'observe:facade-rollback',
                'settle-optimistic', 'apply-output', 'apply-output', 'observe:public-state',
                'control:retry-publication'] + installs + ['observe:public-state']
    raise ValueError(gate)


for selected in plan['cells']:
    cell, gate = selected['id'], selected['gate']
    program = json.loads((P / (cell + '.json')).read_text())
    facade = selected['profile'] == 'facade'
    tied = gate not in ['source-failed-peer', 'graph-failure']
    roots = [{'id': key, 'rank': ((key + 1) // 2 if tied else key) * 10}
             for key in range(1, 7)]
    children = [{'id': key * 100 + suffix, 'parent': key}
                for key in range(1, 7) for suffix in [1, 2]]
    prior = {'roots': roots, 'marked': [3, 4, 5, 6], 'children': children}
    answered = {'roots': [{'id': row['id'], 'rank': row['rank'] + 1} for row in roots],
                'marked': [4, 5, 6],
                'children': children + [{'id': 103, 'parent': 1}, {'id': 203, 'parent': 2}]}
    target = 'root' if gate == 'park-root' or not facade else {'bucket': 1}
    root_change = gate in ['park-root', 'subscriber-tail'] or (gate == 'cleanup-abandonment' and target == 'root')
    changed = ({**prior, 'roots': answered['roots']} if root_change else
               {**prior, 'children': answered['children'] if gate == 'facade-rollback' else
                children + [{'id': 103, 'parent': 1}]})
    check(program['setup']['facts'] == prior, cell + ':fixed prior facts')
    check(program['changedFacts'] == changed, cell + ':fixed changed facts')
    check(program['target'] == target, cell + ':target')
    expected_overlay = ({'id': 'baseline-hold', 'kind': 'root',
                         'row': {'id': 1, 'rank': 9.9, 'children': [101, 102]}}
                        if target == 'root' else
                        {'id': 'baseline-hold', 'kind': 'facade', 'bucket': 1,
                         'rows': [101, 102, 199]})
    check(program['overlay'] == expected_overlay, cell + ':authored overlay')
    check(program['selectedKeys'] == {'root': 1, 'facadeA': 1, 'facadeB': 2,
                                     'pivot': 3, 'optimisticChild': 199}, cell + ':selected keys')
    check(program['answerScopes'] == {'failure': {'source': 'marked', 'scope': [3]},
                                     'peer': {'source': 'children', 'scope': [3]}}, cell + ':parent-key answer scope')
    check(program['errors'] == {'source': 'baseline-source', 'tail': 'baseline-tail',
                               'graph': 'baseline-graph', 'facadeB': 'baseline-facade-B'}, cell + ':errors')
    actual_signature = [sem(step) for step in program['steps']]
    check(actual_signature == signature(gate, facade), cell + ':step ordering')
    fact_cuts = []
    for step in program['steps']:
        if step['kind'] != 'semantic':
            continue
        action = step['action']
        kind = action['type']
        if kind == 'source-answer':
            expected = (answered if gate == 'initial-status-tail' else
                        {**prior, 'marked': [4, 5, 6]} if gate == 'held-window' else prior)
            check(action['facts'] == expected, cell + ':source-specific answer facts')
        if kind in ['source-write', 'restart']:
            check(action['facts'] == changed, cell + ':source-write/replacement facts')
        if kind == 'optimistic-overlay':
            check(action['overlay'] == expected_overlay, cell + ':overlay action')
        if kind == 'request-window':
            check(action['options'] == {'limit': 3}, cell + ':window scope')
        if kind == 'tail-failure':
            check(action['affected'] == [], cell + ':tail settled live receipts')
        if 'facts' in action:
            fact_cuts.append({'action': kind, 'requirement': action.get('requirement'),
                              'changedSourcesFromPrior': [k for k in prior if action['facts'][k] != prior[k]]})
    premises = program['sourceAnswerPremises']
    if gate == 'held-window':
        check(premises == {'answer': [
            {'source': 'marked', 'requiredKeys': [3], 'permittedKeys': [1, 2, 3, 4],
             'knowledge': 'complete-domain', 'since': 'answer-release'},
            {'source': 'roots', 'requiredKeys': [3], 'permittedKeys': [1, 2, 3, 4, 5, 6],
             'knowledge': 'rows', 'since': 'fixture-start'},
            {'source': 'children', 'requiredKeys': [3], 'permittedKeys': [1, 2, 3, 4],
             'knowledge': 'complete-domain', 'since': 'fixture-start'}]}, cell + ':window acquisition premises')
    elif gate == 'source-failed-peer':
        check(premises == {'peer': [{'source': 'children', 'requiredKeys': [3], 'permittedKeys': [3],
                                    'knowledge': 'complete-domain', 'since': 'answer-release'}]},
              cell + ':peer acquisition premises')
    elif gate == 'initial-status-tail':
        check(premises == {'answer': [
            {'source': 'roots', 'requiredKeys': [1, 2], 'permittedKeys': [1, 2, 3, 4, 5, 6],
             'knowledge': 'rows', 'since': 'answer-release'},
            *[{'source': source, 'requiredKeys': [1, 2], 'permittedKeys': [1, 2],
               'knowledge': 'complete-domain', 'since': 'answer-release'}
              for source in ['marked', 'children']]]}, cell + ':initial acquisition premises')
    else:
        check(premises == {}, cell + ':no answer acquisition premise')
    cells.append({'id': cell, 'profile': selected['profile'], 'gate': gate,
                  'stepSignature': actual_signature, 'factCuts': fact_cuts,
                  'sourceAnswerPremisesChecked': True})

output = R / 'input-v1-static-facts-review-v1.json'
with output.open('x') as stream:
    json.dump({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'scope': 'Static parse of all 16 frozen JSON programs against the selected fixed fixture facts, step order, target/overlay and source acquisition restrictions; no constructor, oracle model, history or production execution',
               'programs': 16, 'cells': cells, 'failures': failures,
               'candidateRaw20': 'all UNREACHED', 'runtimeAdmission': False}, stream, indent=2)
    stream.write('\n')
print(json.dumps({'output': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                  'programs': len(cells), 'failures': failures}, indent=2))
