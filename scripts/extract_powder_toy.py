"""Extract static element definitions from a The Powder Toy checkout.

Usage: python scripts/extract_powder_toy.py <powder-toy-checkout> [out.json]

Reads src/simulation/elements/meson.build for element ids (index in
simulation_elem_names) and each element's Element_XXX() initialiser for its
static fields. Nothing is executed; right-hand sides are evaluated with a
restricted arithmetic evaluator over the constants defined below. Any field
whose expression cannot be evaluated is reported and aborts extraction, so the
output never silently contains guesses.
"""
import ast, json, operator, re, subprocess, sys
from pathlib import Path

root = Path(sys.argv[1])
out = Path(sys.argv[2] if len(sys.argv) > 2 else 'src/generated/powder-elements.json')
sim = root / 'src/simulation'

MAX_TEMP, MIN_TEMP, R_TEMP, CELL = 9999.0, 0.0, 22.0, 4
MAX_P, MIN_P = 256.0, -256.0
consts = {
    'CFDS': 4.0 / CELL, 'R_TEMP': R_TEMP, 'MAX_TEMP': MAX_TEMP, 'MIN_TEMP': MIN_TEMP,
    'IPL': MIN_P - 1, 'IPH': MAX_P + 1, 'ITL': MIN_TEMP - 1, 'ITH': MAX_TEMP + 1,
    'NT': -1, 'ST': 1 << 9, 'true': 1, 'false': 0, 'nullptr': 0,
}
# ElementDefs.h flags
text = (sim / 'ElementDefs.h').read_text()
for m in re.finditer(r'constexpr auto (\w+)\s*=\s*UINT32_C\((0x[0-9A-Fa-f]+)\)', text):
    consts[m.group(1)] = int(m.group(2), 16)
for m in re.finditer(r'constexpr int (SC_\w+)\s*=\s*(\d+)', (sim / 'MenuSection.h').read_text()):
    consts[m.group(1)] = int(m.group(2))
for m in re.finditer(r'constexpr unsigned int (FIELD_\w+)\s*=\s*(\d+)', (sim / 'Particle.h').read_text()):
    consts[m.group(1)] = int(m.group(2))

names = re.findall(r"^\s*'(\w+)',", (sim / 'elements/meson.build').read_text().split(']')[0], re.M)
for i, n in enumerate(names):
    consts['PT_' + n] = i
consts['PT_NUM'] = 1 << 9

ops = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
       ast.BitOr: operator.or_, ast.BitAnd: operator.and_, ast.LShift: operator.lshift, ast.RShift: operator.rshift}

def ev(node):
    if isinstance(node, ast.Expression): return ev(node.body)
    if isinstance(node, ast.Constant): return node.value
    if isinstance(node, ast.Name):
        if node.id in consts: return consts[node.id]
        raise KeyError(node.id)
    if isinstance(node, ast.BinOp): return ops[type(node.op)](ev(node.left), ev(node.right))
    if isinstance(node, ast.UnaryOp):
        v = ev(node.operand)
        return -v if isinstance(node.op, ast.USub) else ~v if isinstance(node.op, ast.Invert) else v
    if isinstance(node, ast.Call) and getattr(node.func, 'id', '') == 'U':  # 1U
        return ev(node.args[0])
    raise ValueError(ast.dump(node))

def expr(s):
    s = s.strip()
    s = re.sub(r'(\d+\.?\d*(?:e[+-]?\d+)?)[fF]\b', r'\1', s)       # 1.0f
    s = re.sub(r'\b(0x[0-9A-Fa-f]+)_rgb\b', r'\1', s)               # 0xFFE0A0_rgb
    s = re.sub(r'\b(\d+)U\b', r'\1', s)
    s = re.sub(r'UINT32_C\(([^)]+)\)', r'\1', s)
    s = s.replace('&&', ' and ')
    return ev(ast.parse(s.replace('1U <<', '1 <<'), mode='eval'))

FIELDS = ['Advection', 'AirDrag', 'AirLoss', 'Loss', 'Collision', 'Gravity', 'NewtonianGravity', 'Diffusion', 'HotAir',
          'Falldown', 'Flammable', 'Explosive', 'Meltable', 'Hardness', 'PhotonReflectWavelengths', 'Weight',
          'HeatConduct', 'HeatCapacity', 'Properties', 'CarriesTypeIn', 'LowPressure', 'LowPressureTransition',
          'HighPressure', 'HighPressureTransition', 'LowTemperature', 'LowTemperatureTransition', 'HighTemperature',
          'HighTemperatureTransition', 'MenuVisible', 'MenuSection', 'MenuSort', 'Enabled']
defaults = dict(Advection=0, AirDrag=0, AirLoss=1, Loss=1, Collision=0, Gravity=0, NewtonianGravity=1, Diffusion=0,
                HotAir=0, Falldown=0, Flammable=0, Explosive=0, Meltable=0, Hardness=30,
                PhotonReflectWavelengths=0x3FFFFFFF, Weight=50, HeatConduct=128, HeatCapacity=1.0,
                Properties=consts['TYPE_SOLID'], CarriesTypeIn=0, LowPressure=consts['IPL'], LowPressureTransition=-1,
                HighPressure=consts['IPH'], HighPressureTransition=-1, LowTemperature=consts['ITL'],
                LowTemperatureTransition=-1, HighTemperature=consts['ITH'], HighTemperatureTransition=-1,
                MenuVisible=0, MenuSection=0, MenuSort=0, Enabled=0)

elements, errors = [], []
for pid, name in enumerate(names):
    path = sim / 'elements' / f'{name}.cpp'
    rec = dict(id=pid, key=name, **defaults, name='', description='', colour=0xFF00FF,
               default={'temp': R_TEMP + 273.15}, hasUpdate=False, hasCreate=False, hasGraphics=False)
    if not path.exists() or name == 'NONE':
        rec['Enabled'] = 0 if name != 'NONE' else 0
        elements.append(rec); continue
    src = path.read_text()
    m = re.search(r'void Element::Element_\w+\(\)\s*\{(.*?)\n\}', src, re.S)
    body = m.group(1)
    for line in body.split('\n'):
        line = line.split('//')[0].strip()
        mm = re.match(r'^(\w+(?:\.\w+)?)\s*=\s*(.+?);$', line)
        if not mm: continue
        k, v = mm.groups()
        try:
            if k == 'Name': rec['name'] = json.loads(re.match(r'^(?:ByteString|String)?\(?("(?:[^"\\]|\\.)*")\)?$', v).group(1))
            elif k == 'Description': rec['description'] = ast.literal_eval(re.sub(r'^(?:String)?\((.*)\)$', r'\1', v))
            elif k == 'Colour': rec['colour'] = expr(v)
            elif k == 'Identifier': pass
            elif k == 'Update': rec['hasUpdate'] = v != 'nullptr'
            elif k == 'Create': rec['hasCreate'] = True
            elif k == 'Graphics': rec['hasGraphics'] = v != 'nullptr'
            elif k.startswith('DefaultProperties.'): rec['default'][k.split('.')[1]] = expr(v)
            elif k in FIELDS: rec[k] = expr(v)
        except Exception as e:
            errors.append((name, k, v, repr(e)))
    # DefaultProperties.temp like "R_TEMP + 400.0f + 273.15f" already handled by expr.
    elements.append(rec)

if errors:
    for e in errors: print('UNEVALUATED', e, file=sys.stderr)
    sys.exit(1)

commit = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(dict(source='https://github.com/The-Powder-Toy/The-Powder-Toy', commit=commit, license='GPL-3.0',
                               constants={k: v for k, v in consts.items() if k.startswith(('TYPE_', 'PROP_', 'FLAG_'))},
                               elements=elements), indent=None, separators=(',', ':')))
print(f'{len(elements)} elements, {sum(1 for e in elements if e["Enabled"])} enabled -> {out}')
