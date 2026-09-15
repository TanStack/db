"""Replay frozen process models, not application code or evidence admission."""

import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def enabled(action, state):
    if action.get('unresolved'):
        return False
    return any(
        all(state.get(key) == value for key, value in clause.items())
        for clause in action['requires_any']
    )


def replay(model, sequence, initial=None):
    state = copy.deepcopy(model['initial'])
    state.update(initial or {})
    accomplished = {}
    trace = []
    for index, event in enumerate(sequence):
        action = model['actions'][event['action']]
        ready = [name for name, item in model['actions'].items() if enabled(item, state)]
        frame = {
            'index': index, 'event': event, 'before': copy.deepcopy(state),
            'enabled': ready, 'occurring': [],
            'accomplished_but_not_depleted': copy.deepcopy(accomplished),
        }
        if not enabled(action, state):
            frame['violation'] = 'unprimed'
            frame['requires_any'] = action['requires_any']
            frame['unresolved'] = action.get('unresolved', [])
            trace.append(frame)
            return {'valid': False, 'violation': 'unprimed', 'at': index, 'trace': trace}
        if event['action'] in accomplished and not action['repeatable']:
            frame['violation'] = 'unused'
            trace.append(frame)
            return {'valid': False, 'violation': 'unused', 'at': index, 'trace': trace}
        frame['occurring'] = [event['action']]
        effects = action['outcomes'][event['outcome']]
        state.update(effects)
        for old in action.get('depletes', []):
            accomplished.pop(old, None)
        accomplished[event['action']] = event['id']
        frame['after'] = copy.deepcopy(state)
        frame['accomplished_after'] = copy.deepcopy(accomplished)
        trace.append(frame)
    return {'valid': True, 'state': state, 'trace': trace}


def alternate_sequences(model, limit=3, max_depth=6):
    """Bounded enumeration: no new events, guards, or judgments are invented."""
    frontier = [([], copy.deepcopy(model['initial']))]
    seen = {json.dumps(model['initial'], sort_keys=True)}
    results = []
    while frontier and len(results) < limit:
        sequence, state = frontier.pop(0)
        if sequence and all(state.get(k) == v for k, v in model['alternate_goal'].items()):
            results.append(sequence)
            continue
        if len(sequence) == max_depth:
            continue
        for name, action in model['actions'].items():
            if not enabled(action, state):
                continue
            for outcome in action['outcomes']:
                event = {'id': f'alt-{len(sequence)}', 'action': name, 'outcome': outcome}
                candidate = sequence + [event]
                result = replay(model, candidate)
                if not result['valid']:
                    continue
                key = json.dumps(result['state'], sort_keys=True)
                if key in seen:
                    continue
                seen.add(key)
                frontier.append((candidate, result['state']))
    return results


def main():
    results = []
    for path in sorted(ROOT.glob('*/model.json')):
        model = json.loads(path.read_text())
        episodes = []
        for episode in model['episodes']:
            result = replay(model, episode['events'], episode.get('initial'))
            assert result['valid'], (model['id'], episode['id'], result)
            episodes.append({'id': episode['id'], 'kind': episode['kind'], **result})
        negatives = []
        for case in model['negative_sequences']:
            result = replay(model, case['events'])
            assert not result['valid'], (model['id'], case['id'])
            assert result['violation'] == case['expected'], (model['id'], case['id'])
            negatives.append({'id': case['id'], 'kind': 'constructed exclusion', **result})
        # Named countermodels are analyst-proposed rules, not historical software revisions.
        repairs = []
        for repair in model['repairs']:
            countermodel = copy.deepcopy(model)
            countermodel['actions'][repair['action']]['requires_any'] = repair['old_requires_any']
            before = replay(countermodel, repair['witness'])
            after = replay(model, repair['witness'])
            assert before['valid'] == repair['old_valid']
            assert after['valid'] == repair['new_valid']
            regression = [replay(model, ep['events'], ep.get('initial'))['valid'] for ep in model['episodes']]
            assert all(regression)
            repairs.append({'id': repair['id'], 'before': before, 'after': after,
                            'full_episode_regressions': regression})
        output = {'model': model['id'], 'episodes': episodes, 'negative_sequences': negatives,
                  'countermodel_repairs': repairs,
                  'alternates': alternate_sequences(model),
                  'limit': 'Model replay only. Does not rerun the application or establish real-world validity.'}
        commutations = []
        for item in model.get('commutation_checks', []):
            original = model['episodes'][item['episode']]['events']
            swapped = copy.deepcopy(original)
            left, right = item['swap']
            swapped[left], swapped[right] = swapped[right], swapped[left]
            first, second = replay(model, original), replay(model, swapped)
            assert first['valid'] and second['valid']
            assert first['state'] == second['state']
            commutations.append({'id': item['id'], 'events': swapped,
                                 'same_final_state': True, 'basis': item['basis']})
        output['commutation_checks'] = commutations
        (path.parent / 'replay.json').write_text(json.dumps(output, indent=2) + '\n')
        results.append({'model': model['id'], 'episodes': len(episodes),
                        'negative_sequences': len(negatives), 'repairs': len(repairs),
                        'alternates': len(output['alternates']),
                        'status': model['status']})
    (ROOT / 'replay-summary.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
