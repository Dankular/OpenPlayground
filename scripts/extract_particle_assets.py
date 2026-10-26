"""Index original particle materials and focused projectile effect emitters.

Only JSON is produced. Existing converted texture/sprite payloads are reused.
"""
import argparse
import json
from pathlib import Path

from extract_all_assets import json_ready
from extract_game_assets import digest, save
from extract_projectile_prefabs import ProjectileExtractor


def main():
    workspace = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=workspace / 'src/generated/particle-materials.json')
    args = parser.parse_args()
    root, output = args.game_root.resolve(), args.output.resolve()
    if root == output or root in output.parents:
        parser.error('Output must be outside the game installation')
    directory = workspace / 'public/local-assets'
    ex = ProjectileExtractor(root, directory, workspace / 'research/local')
    rows = json.loads((directory / 'asset-inventory.json').read_text())['objects']
    inventory = {(r['file'], int(r['pathId'])): r for r in rows}
    for r in rows:
        if r.get('sprite'):
            ex.sprites[(r['file'], int(r['pathId']))] = r['sprite']
    objects = {(o.assets_file.name, o.path_id): o for o in ex.env.objects}
    projectile_prefabs = list(json.loads((workspace / 'src/generated/projectiles.json').read_text())['prefabs'].values())
    materials, renderers, effects, errors = {}, {}, {}, []
    for (file, pathid), obj in sorted(objects.items()):
        if obj.type.name not in {'ParticleSystemRenderer', 'SpriteRenderer'}:
            continue
        renderer = obj.parse_as_dict()
        keys = []
        for pointer in renderer['m_Materials']:
            material = ex.resolve(pointer, obj.assets_file)
            if material is None:
                keys.append(None); continue
            key = f'{material.assets_file.name}:{material.path_id}'
            keys.append(key)
            if key in materials:
                continue
            data = material.parse_as_dict()
            shader = ex.resolve(data['m_Shader'], material.assets_file)
            shader_data = shader.parse_as_dict()['m_ParsedForm']
            passes = shader_data['m_SubShaders'][0]['m_Passes']
            state = passes[-1 if shader_data['m_Name'] == 'Particles/Standard Unlit' else 0]['m_State']
            props = data['m_SavedProperties']
            entry = {'file': material.assets_file.name, 'pathId': str(material.path_id), 'name': data['m_Name'],
                     'shader': {'file': shader.assets_file.name, 'pathId': str(shader.path_id), 'name': shader_data['m_Name'],
                                'blend': state['rtBlend0'], 'zWrite': state['zWrite'], 'zTest': state['zTest']},
                     'floats': dict(props['m_Floats']), 'colors': dict(props['m_Colors']),
                     'keywords': data['m_ShaderKeywords'], 'textures': {}}
            for slot, env in props['m_TexEnvs']:
                tex = ex.resolve(env['m_Texture'], material.assets_file)
                if tex is None:
                    continue
                td = tex.parse_as_dict()
                exported = inventory[(tex.assets_file.name, tex.path_id)]
                png = next((p for p in exported.get('payloads', []) if p['url'].endswith('.png')), None)
                texture = {'file': tex.assets_file.name, 'pathId': str(tex.path_id), 'name': td['m_Name'],
                           'width': td['m_Width'], 'height': td['m_Height'], 'colorSpace': td['m_ColorSpace'],
                           'settings': td['m_TextureSettings'], 'scale': env['m_Scale'], 'offset': env['m_Offset']}
                if png:
                    path = directory / png['url'].removeprefix('/local-assets/')
                    if digest(path) != png['sha256']:
                        raise RuntimeError(f'Existing particle texture hash mismatch: {path}')
                    texture.update(png)
                else:
                    texture['unsupported'] = 'Source texture has no converted PNG payload'
                    errors.append({'material': key, 'slot': slot, 'texture': texture['unsupported']})
                entry['textures'][slot] = texture
            materials[key] = entry
        renderers[f'{file}:{pathid}'] = keys

    prefabs = [json.loads(p.read_text()) for p in sorted((directory / 'prefabs').glob('*.json'))]
    prefabs += projectile_prefabs
    selected = {}
    references = {}
    fields = {'muzzleFlashPrefab', 'muzzleFlash', 'ImpactEffect', 'EndOfLifeEffect', 'Particles', 'SparkPrefab', 'ExplosionEffect'}
    for prefab in prefabs:
        for node in prefab['nodes']:
            for component in node['components']:
                if component['className'] not in {'ProjectileLauncherBehaviour', 'TankBarrelBehaviour', 'RocketLauncherBehaviour', 'JavelinMissileBehaviour', 'IonBoltBehaviour', 'StunnerBehaviour'}:
                    continue
                for field in fields:
                    pointer = component.get('data', {}).get(field)
                    if not isinstance(pointer, dict) or not pointer.get('m_PathID'):
                        continue
                    source = objects[(component['file'], int(component['pathId']))].assets_file
                    obj = ex.resolve(pointer, source)
                    if obj.type.name == 'GameObject':
                        selected[(obj.assets_file.name, obj.path_id)] = obj
                        references[f"{component['file']}:{pointer.get('m_FileID', 0)}:{pointer['m_PathID']}"] = f'{obj.assets_file.name}:{obj.path_id}'
    for (file, pathid), obj in sorted(selected.items()):
        ex.source_file = obj.assets_file
        prefab = ex.prefab({'id': f'effect:{file}:{pathid}', 'name': obj.parse_as_dict()['m_Name'], 'prefab': {'m_FileID': 0, 'm_PathID': pathid}})
        nodes = [{**n, 'components': [c for c in n['components'] if c['type'] in {'ParticleSystem', 'ParticleSystemRenderer'}]} for n in prefab['nodes']]
        timers = [{'nodeId': n['id'], 'life': c['data']['Life']} for n in prefab['nodes'] for c in n['components'] if c['className'] == 'DeleteAfterTime']
        effects[f'{file}:{pathid}'] = {'name': prefab['name'], 'rootGameObjectId': str(pathid), 'nodes': nodes, 'timers': timers,
                                     'unsupported': [u for u in prefab['unsupported'] if not u.startswith('script:')]}
    result = {'schemaVersion': 1, 'unityVersion': ex.version, 'materials': materials, 'renderers': renderers, 'effects': effects, 'references': dict(sorted(references.items())),
              'provider': 'UnityPy static material and emitter extraction; no media regeneration', 'errors': errors,
              'sources': [{'path': name, 'sha256': digest(ex.data / name)} for name in sorted({m['file'] for m in materials.values()} | {'sharedassets0.assets', 'Managed/Assembly-CSharp.dll'})]}
    save(output, json_ready(result))
    print(f"Particle materials {len(materials)}, renderer references {len(renderers)}, effect definitions {len(effects)}, unavailable textures {len(errors)}")


if __name__ == '__main__':
    main()
