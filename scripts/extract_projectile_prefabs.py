"""Extract launcher resource prefabs without regenerating the media inventory.

Reuses the original prefab normalizer and hash-verified sprite metadata. Source
game files are read only. The compact runtime bundle is tracked in src/generated;
individual normalized resources and extraction diagnostics remain local.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from extract_all_assets import AllExtractor, json_ready, safe_name
from extract_game_assets import digest, save


class ProjectileExtractor(AllExtractor):
    def sprite(self, pointer, source):
        obj = self.resolve(pointer, source)
        if obj is None:
            return None
        key = (obj.assets_file.name, obj.path_id)
        if key not in self.sprites:
            raise RuntimeError(f"Missing existing sprite export {key}; run complete asset extraction first")
        sprite = self.sprites[key]
        path = self.output / sprite['url'].removeprefix('/local-assets/')
        if not path.is_file() or digest(path) != sprite['sha256']:
            raise RuntimeError(f"Existing sprite export failed hash verification: {path}")
        return sprite


def extract(root: Path, output: Path, research: Path, embedded: Path):
    ex = ProjectileExtractor(root, output, research)
    inventory = json.loads((output / 'asset-inventory.json').read_text(encoding='utf-8'))
    for row in inventory['objects']:
        if row.get('sprite'):
            ex.sprites[(row['file'], int(row['pathId']))] = row['sprite']
    files = {o.assets_file.name: o.assets_file for o in ex.env.objects}
    requests, launchers, errors = {}, [], []

    def request(obj):
        if obj.type.name != 'GameObject':
            raise ValueError(f"Expected projectile GameObject, received {obj.type.name}")
        key = f'{obj.assets_file.name}:{obj.path_id}'
        requests[key] = obj
        return key

    # Native TankBarrel reference is a resource prefab, outside catalogue items.
    resource = files.get('sharedassets0.assets')
    if resource is None or 3281 not in resource.objects:
        raise RuntimeError('Source Tank projectile sharedassets0.assets:3281 not found')
    request(resource.objects[3281])
    for path in sorted((output / 'prefabs').glob('*.json')):
        prefab = json.loads(path.read_text(encoding='utf-8'))
        for node in prefab.get('nodes', []):
            for component in node.get('components', []):
                fields = {'TankBarrelBehaviour': ['Projectile'], 'RocketLauncherBehaviour': ['Projectile'],
                          'ProjectileLauncherBehaviour': ['projectilePrefab', 'projectileAsset']}.get(component.get('className'), [])
                for field in fields:
                    pointer = component.get('data', {}).get(field)
                    if not pointer or not pointer.get('m_PathID'):
                        continue
                    context = {'catalogId': prefab['catalogId'], 'nodeId': node['id'], 'componentId': component['pathId'],
                               'file': component['file'], 'className': component['className'], 'field': field, 'pointer': pointer}
                    try:
                        obj = ex.resolve(pointer, files[component['file']])
                        if field == 'projectileAsset':
                            obj = ex.resolve(ex.decode(obj)['Prefab'], obj.assets_file)
                        context['projectileKey'] = request(obj)
                        context['status'] = 'resolved'
                    except Exception as exc:
                        context.update(status='unavailable', error=str(exc)); errors.append(dict(context))
                    launchers.append(context)

    entries, prefabs, sources = {}, {}, {}
    for key, obj in sorted(requests.items()):
        entry = {'key': key, 'file': obj.assets_file.name, 'pathId': str(obj.path_id),
                 'runtimeId': f'resource:{key}', 'name': obj.parse_as_dict()['m_Name']}
        try:
            ex.source_file = obj.assets_file
            prefab = ex.prefab({'id': entry['runtimeId'], 'name': entry['name'], 'prefab': {'m_FileID': 0, 'm_PathID': obj.path_id}})
            prefab['source'] = {'file': obj.assets_file.name, 'pathId': str(obj.path_id)}
            body_ids = {p['id'] for p in prefab['parts']}
            if len(body_ids) != len(prefab['parts']):
                raise RuntimeError(f'Duplicate source Rigidbody2D IDs in {key}')
            node_ids = {n['id'] for n in prefab['nodes']}
            if str(obj.path_id) not in node_ids:
                raise RuntimeError(f'Projectile root missing from normalized nodes: {key}')
            for renderer in prefab['renderers']:
                if renderer['bodyId'] is not None and renderer['bodyId'] not in body_ids:
                    raise RuntimeError(f'Unresolved renderer body: {renderer}')
            if any(c.get('status') != 'decoded' for n in prefab['nodes'] for c in n['components']):
                raise RuntimeError(f'Projectile contains undecoded components: {key}')
            if any(u.startswith('sprite:') for u in prefab['unsupported']):
                raise RuntimeError(f'Projectile contains missing sprite exports: {key}')
            # Sprite renderer material references remain in raw components; add
            # exact resolved identities for resource-file external references.
            for node in prefab['nodes']:
                for c in node['components']:
                    if c['type'] != 'SpriteRenderer':
                        continue
                    c['materials'] = []
                    for p in c['data'].get('m_Materials', []):
                        mat = ex.resolve(p, files[c['file']])
                        if mat:
                            c['materials'].append({'file': mat.assets_file.name, 'pathId': str(mat.path_id), 'data': ex.decode(mat)})
            target = output / 'projectiles' / f'{safe_name(key)}.json'
            save(target, json_ready(prefab))
            entry.update(url='/local-assets/' + target.relative_to(output).as_posix(), status='extracted', sha256=digest(target),
                         parts=len(prefab['parts']), renderers=len(prefab['renderers']), nodes=len(prefab['nodes']), unsupported=prefab['unsupported'])
            prefabs[entry['runtimeId']] = prefab
            for node in prefab['nodes']:
                for c in node['components']:
                    sources[c['file']] = files[c['file']]
        except Exception as exc:
            entry.update(status='unavailable', error=str(exc)); errors.append(dict(entry))
        entries[key] = entry
    for name, serialized in list(sources.items()):
        candidates = [p for p in ex.data.rglob(name) if p.is_file()]
        if len(candidates) != 1:
            raise RuntimeError(f'Ambiguous source provenance {name}: {candidates}')
        path = candidates[0]
        sources[name] = {'path': path.relative_to(ex.data).as_posix(), 'sha256': digest(path), 'bytes': path.stat().st_size}
    assembly = ex.data / 'Managed/Assembly-CSharp.dll'
    sources['Assembly-CSharp.dll'] = {'path': assembly.relative_to(ex.data).as_posix(), 'sha256': digest(assembly), 'bytes': assembly.stat().st_size}
    bundle = json_ready({'schemaVersion': 1, 'unityVersion': ex.version, 'byId': entries, 'launchers': launchers,
                         'prefabs': prefabs, 'sources': sources,
                         'provider': 'UnityPy static extraction; not REA runtime evidence', 'errors': errors + ex.errors, 'warnings': ex.warnings})
    save(output / 'projectiles.json', bundle)
    save(embedded, bundle)
    print(f"Projectile resources: {len(prefabs)}/{len(entries)}; launcher references: {len(launchers)}; errors: {len(bundle['errors'])}")
    if bundle['errors']:
        raise RuntimeError('Projectile extraction has errors; see projectiles.json')
    return bundle


def main():
    workspace = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=workspace / 'public/local-assets')
    parser.add_argument('--research', type=Path, default=workspace / 'research/local')
    parser.add_argument('--embedded', type=Path, default=workspace / 'src/generated/projectiles.json')
    args = parser.parse_args()
    root = args.game_root.resolve()
    for target in (args.output, args.research, args.embedded):
        if target.resolve() == root or root in target.resolve().parents:
            parser.error('Outputs must be outside the source installation')
    extract(root, args.output.resolve(), args.research.resolve(), args.embedded.resolve())


if __name__ == '__main__':
    main()
