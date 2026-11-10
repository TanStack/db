"""Pure path-rebind controls; no gate execution, processes or native imports."""
import copy
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('rebind_definitions_only', HERE / 'verify.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
original = json.loads((gate.PREVIOUS / 'recipes.json').read_text())['receiving']
recipe = json.loads((HERE / 'recipes.json').read_text())['receiving']
gate.check_recipe(recipe, original)
controls = []
for name, mutate in [
    ('wrong source root', lambda x: x.update(cwd=original['cwd'])),
    ('wrong source freeze', lambda x: x['envSet'].update(H02_PROGRESS_SOURCE_FREEZE=original['envSet']['H02_PROGRESS_SOURCE_FREEZE'])),
    ('reused output', lambda x: x.update(freshOutputDirectory=original['freshOutputDirectory'])),
    ('different program quarter', lambda x: x['receivingHistory'].update(metadataFollowupQuarter=0)),
    ('different selected name', lambda x: x['argv'].__setitem__(-1, '.*')),
    ('changed test timeout', lambda x: x.update(testTimeoutMs=120000)),
    ('changed inner wall budget', lambda x: x['innerReceivingBudget'].update(wallMs=40000)),
    ('changed inner RSS budget', lambda x: x['innerReceivingBudget'].update(groupRssBytes=2147483648)),
]:
    changed = copy.deepcopy(recipe)
    mutate(changed)
    try:
        gate.check_recipe(changed, original)
    except ValueError as error:
        controls.append({'name': name, 'rejected': True, 'error': str(error)})
    else:
        raise AssertionError(name)
print(json.dumps({'status': 'pure recipe rebind only', 'accepted': 1, 'rejected': len(controls), 'controls': controls,
                  'nativeLaunches': 0, 'nativeProcessProbes': 0}, indent=2, sort_keys=True))
