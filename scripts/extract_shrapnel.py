"""Resolve the installed GlobalShrapnelEmitter and its exact cartridge pointer."""
import argparse
from pathlib import Path

from extract_all_assets import AllExtractor, json_ready
from extract_game_assets import digest, save


def main():
    workspace = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-root', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=workspace / 'src/generated/shrapnel.json')
    args = parser.parse_args()
    root, output = args.game_root.resolve(), args.output.resolve()
    if output == root or root in output.parents:
        parser.error('Output must be outside source installation')
    ex = AllExtractor(root, workspace / 'public/local-assets', workspace / 'research/local')
    matches = {}
    for obj in ex.env.objects:
        if obj.type.name != 'MonoBehaviour':
            continue
        script = obj.parse_monobehaviour_head().m_Script.deref_parse_as_object()
        if script.m_ClassName == 'GlobalShrapnelEmitter':
            matches[(obj.assets_file.name, obj.path_id)] = obj
    if len(matches) != 1:
        raise RuntimeError(f'Expected exactly one installed GlobalShrapnelEmitter, found {list(matches)}')
    obj = next(iter(matches.values()))
    data = ex.decode(obj)
    cartridge = ex.resolve(data['Cartridge'], obj.assets_file)
    dependencies = [ex.data / obj.assets_file.name, ex.data / cartridge.assets_file.name, ex.data / 'Managed/Assembly-CSharp.dll']
    result = {'schemaVersion': 1, 'unityVersion': ex.version,
              'provider': 'UnityPy static extraction; not REA runtime evidence',
              'source': {'file': obj.assets_file.name, 'pathId': str(obj.path_id), 'className': 'GlobalShrapnelEmitter'},
              'data': data,
              'cartridge': {'file': cartridge.assets_file.name, 'pathId': str(cartridge.path_id), 'data': ex.decode(cartridge)},
              'sources': [{'path': p.relative_to(ex.data).as_posix(), 'sha256': digest(p), 'bytes': p.stat().st_size} for p in dependencies]}
    assert result['cartridge']['data']['m_Name'], 'Missing cartridge name'
    assert data['LayersToHit']['m_Bits'] >= 0 and data['WaterLayer']['m_Bits'] >= 0
    save(output, json_ready(result))
    print(f"Resolved {obj.assets_file.name}:{obj.path_id} -> {cartridge.assets_file.name}:{cartridge.path_id} ({result['cartridge']['data']['m_Name']})")


if __name__ == '__main__':
    main()
