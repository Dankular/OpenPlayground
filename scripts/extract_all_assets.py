"""Extend the reference extraction to every catalogue prefab and serialized object.

Writes only outside the source game directory. Raw objects preserve unsupported
payloads; the manifest distinguishes successful format conversion from raw-only.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter
import math
from pathlib import Path
import re
import shutil

from extract_game_assets import Extractor, digest, finite_json, save, xy


def safe_name(name):
    return re.sub(r"[^A-Za-z0-9_.-]", "_", str(name))[:100] or "unnamed"


def json_ready(value):
    if isinstance(value, bytes):
        return {"encoding": "base64", "bytes": len(value), "data": base64.b64encode(value).decode("ascii")}
    if isinstance(value, dict):
        return {str(k): json_ready(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [json_ready(v) for v in value]
    return finite_json(value)


def rotate(point, angle):
    c, s = math.cos(angle), math.sin(angle)
    return {"x": point["x"] * c - point["y"] * s, "y": point["x"] * s + point["y"] * c}


def local(point, position, angle):
    return rotate({a: point[a] - position[a] for a in ("x", "y")}, -angle)


class AllExtractor(Extractor):
    def __init__(self, *args):
        super().__init__(*args)
        self.errors = []
        self.loaded_paths = []
        # Unity serialized assets and native bundles are identified from names
        # plus file magic. Managed/native executables are hashed separately.
        for path in sorted(self.data.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(self.data).as_posix()
            with path.open("rb") as stream:
                magic = stream.read(12)
            serialized = path.suffix == ".assets" or re.fullmatch(r"level\d+|globalgamemanagers|unity_builtin_extra|unity default resources", path.name)
            bundle = magic.startswith((b"UnityFS", b"UnityRaw", b"UnityWeb"))
            resource = path.suffix in (".resource", ".resS")
            if serialized or bundle or resource:
                try:
                    if path.name != "sharedassets0.assets":
                        self.env.load_file(str(path))
                    self.loaded_paths.append(rel)
                except Exception as exc:
                    self.errors.append({"file": rel, "phase": "load", "error": str(exc)})
        self.components_cache = {}

    def named_components(self, go):
        key = (go.assets_file.name, go.path_id)
        if key in self.components_cache:
            return self.components_cache[key]
        result = []
        for pointer in go.parse_as_dict()["m_Component"]:
            obj = self.resolve(pointer["component"], go.assets_file)
            row = {"pathId": str(obj.path_id), "file": obj.assets_file.name, "type": obj.type.name, "className": obj.type.name}
            try:
                if obj.type.name == "MonoBehaviour":
                    script = obj.parse_monobehaviour_head().m_Script.deref_parse_as_object()
                    row["className"] = ".".join(p for p in (script.m_Namespace, script.m_ClassName) if p)
                row["data"] = self.decode(obj)
                row["status"] = "decoded"
                if row["className"] == "PhysicalBehaviour" and row["data"].get("Properties", {}).get("m_PathID"):
                    properties = self.resolve(row["data"]["Properties"], obj.assets_file)
                    row["properties"] = {"pathId": str(properties.path_id), "data": self.decode(properties)}
                    matptr = row["properties"]["data"].get("PhysicMaterial")
                    if matptr and matptr.get("m_PathID"):
                        mat = self.resolve(matptr, properties.assets_file)
                        row["properties"]["material"] = {"pathId": str(mat.path_id), "data": self.decode(mat)}
                if row["className"] == "FirearmBehaviour" and row["data"].get("Cartridge", {}).get("m_PathID"):
                    cartridge = self.resolve(row["data"]["Cartridge"], obj.assets_file)
                    row["cartridge"] = {"pathId": str(cartridge.path_id), "data": self.decode(cartridge)}
            except Exception as exc:
                row["status"] = "unavailable"
                row["error"] = str(exc)
                self.errors.append({"file": obj.assets_file.name, "pathId": str(obj.path_id), "phase": "component", "error": str(exc)})
            result.append(row)
        self.components_cache[key] = result
        return result

    def material(self, pointer, source):
        if not pointer or not pointer.get("m_PathID"):
            return None
        obj = self.resolve(pointer, source)
        data = obj.parse_as_dict()
        return {"friction": data.get("friction", data.get("m_Friction", .4)),
                "restitution": data.get("bounciness", data.get("m_Bounciness", 0)), "data": data,
                "source": {"file": obj.assets_file.name, "pathId": str(obj.path_id)}}

    def prefab(self, item):
        root = self.resolve(item["prefab"])
        if root is None:
            raise RuntimeError("Null catalogue prefab")
        initial = self.named_components(root)
        root_tr = next(c for c in initial if c["type"] in ("Transform", "RectTransform"))
        queue = [(root, None, {"x": 0., "y": 0.}, 0., {"x": 1., "y": 1.}, None)]
        nodes, parts, renderers, joints, unsupported = [], [], [], [], set()
        node_map, body_map, raw_joints = {}, {}, []
        visited = set()
        while queue:
            go, parent_id, parent_pos, parent_angle, parent_scale, inherited_body = queue.pop(0)
            key = (go.assets_file.name, go.path_id)
            if key in visited:
                raise RuntimeError(f"Repeated transform {key}")
            visited.add(key)
            gd = go.parse_as_dict()
            comps = self.named_components(go)
            t = next(c["data"] for c in comps if c["type"] in ("Transform", "RectTransform"))
            q = t["m_LocalRotation"]
            if abs(q["x"]) + abs(q["y"]) > 1e-4:
                unsupported.add("out-of-plane transform rotation")
            angle = parent_angle + 2 * math.atan2(q["z"], q["w"])
            translated = rotate(xy(t["m_LocalPosition"], parent_scale), parent_angle)
            position = {a: parent_pos[a] + translated[a] for a in ("x", "y")}
            if parent_id is None:
                position, angle = {"x": 0., "y": 0.}, 0.
            scale = {a: parent_scale[a] * t["m_LocalScale"][a] for a in ("x", "y")}
            node = {"id": str(go.path_id), "name": gd["m_Name"], "parentId": parent_id,
                    "position": position, "angle": angle, "scale": scale,
                    "active": bool(gd["m_IsActive"]) and (parent_id is None or node_map[parent_id]["active"]),
                    "localActive": bool(gd["m_IsActive"]), "layer": gd["m_Layer"], "components": comps}
            nodes.append(node)
            node_map[node["id"]] = node
            rb = next((c for c in comps if c["type"] == "Rigidbody2D" and c["status"] == "decoded"), None)
            body_id = rb["pathId"] if rb else inherited_body
            node["bodyId"] = body_id
            if rb:
                d = rb["data"]
                physical = next((c for c in comps if c["className"] == "PhysicalBehaviour"), None)
                mat = self.material(d.get("m_Material"), go.assets_file)
                if physical and physical.get("properties", {}).get("material"):
                    matdata = physical["properties"]["material"]["data"]
                    mat = {"friction": matdata.get("friction", .4), "restitution": matdata.get("bounciness", 0), "data": matdata}
                part = {"id": body_id, "nodeId": node["id"], "name": node["name"], "position": dict(position), "angle": angle, "scale": scale,
                        "mass": d["m_Mass"], "linearDamping": d["m_LinearDrag"], "angularDamping": d["m_AngularDrag"], "gravityScale": d["m_GravityScale"],
                        "bodyType": {0: "dynamic", 1: "kinematic", 2: "static"}.get(d["m_BodyType"], "unknown"),
                        "simulated": bool(d["m_Simulated"]), "fixedRotation": bool(d["m_Constraints"] & 4), "constraints": d["m_Constraints"],
                        "bullet": bool(d["m_CollisionDetection"]), "material": mat, "colliders": [], "sprite": None,
                        "physicalProperties": physical.get("properties") if physical else None,
                        "metadata": {"nodeId": node["id"], "components": comps}}
                parts.append(part)
                body_map[body_id] = part
            for c in comps:
                if c["status"] != "decoded":
                    unsupported.add("unavailable component " + c["className"])
                if c["type"] == "MonoBehaviour":
                    unsupported.add("script:" + c["className"])
                elif c["type"].endswith("Joint2D"):
                    raw_joints.append((node, c))
            for pointer in t["m_Children"]:
                transform = self.resolve(pointer, go.assets_file)
                child = self.resolve(transform.parse_as_dict()["m_GameObject"], transform.assets_file)
                queue.append((child, node["id"], position, angle, scale, body_id))
        # Transform all colliders/renderers into their nearest owning body's
        # coordinate frame, after every body has been enumerated.
        for node in nodes:
            part = body_map.get(node["bodyId"])
            for c in node["components"]:
                if c["status"] != "decoded":
                    continue
                d, kind, scale = c["data"], c["type"], node["scale"]
                if kind.endswith("Collider2D"):
                    offset_world = rotate(xy(d.get("m_Offset", {}), scale), node["angle"])
                    offset_world = {a: node["position"][a] + offset_world[a] for a in ("x", "y")}
                    shape = {"type": kind.removesuffix("Collider2D").lower(), "nodeId": node["id"],
                             "offset": local(offset_world, part["position"], part["angle"]) if part else offset_world,
                             "angle": node["angle"] - part["angle"] if part else node["angle"],
                             "isTrigger": bool(d.get("m_IsTrigger", False)), "enabled": bool(d.get("m_Enabled", True)),
                             "density": d.get("m_Density", 1), "edgeRadius": d.get("m_EdgeRadius", 0) * max(abs(scale[a]) for a in ("x", "y")),
                             "material": self.material(d.get("m_Material"), self.source_file), "data": d}
                    if "m_Size" in d:
                        shape["size"] = xy(d["m_Size"], {a: abs(scale[a]) for a in ("x", "y")})
                    if "m_Radius" in d:
                        shape["radius"] = d["m_Radius"] * max(abs(scale[a]) for a in ("x", "y"))
                    if kind == "CapsuleCollider2D":
                        shape["direction"] = d["m_Direction"]
                    if kind == "PolygonCollider2D":
                        shape["paths"] = [[xy(p, scale) for p in path] for path in d["m_Points"]["m_Paths"]]
                    if kind == "EdgeCollider2D":
                        shape["points"] = [xy(p, scale) for p in d["m_Points"]]
                    if part:
                        part["colliders"].append(shape)
                    else:
                        node.setdefault("staticColliders", []).append(shape)
                if kind == "SpriteRenderer" and d.get("m_Sprite", {}).get("m_PathID"):
                    try:
                        sprite = dict(self.sprite(d["m_Sprite"], self.source_file))
                        sprite.update({"width": sprite["width"] * abs(scale["x"]), "height": sprite["height"] * abs(scale["y"]),
                                       "sortingOrder": d["m_SortingOrder"], "sortingLayer": d["m_SortingLayer"],
                                       "flipX": bool(d["m_FlipX"]) != (scale["x"] < 0), "flipY": bool(d["m_FlipY"]) != (scale["y"] < 0), "color": d["m_Color"]})
                        renderer = {"id": c["pathId"], "nodeId": node["id"], "bodyId": node["bodyId"],
                                    "position": local(node["position"], part["position"], part["angle"]) if part else dict(node["position"]),
                                    "angle": node["angle"] - part["angle"] if part else node["angle"], "sprite": sprite, "enabled": bool(d["m_Enabled"])}
                        renderers.append(renderer)
                        if part and node["id"] == part["nodeId"]:
                            part["sprite"] = sprite
                    except Exception as exc:
                        unsupported.add(f"sprite:{c['pathId']}:{exc}")
        for node, component in raw_joints:
            d = component["data"]
            connected = self.resolve(d.get("m_ConnectedRigidBody", {}), self.source_file)
            a = body_map.get(node["bodyId"])
            b = body_map.get(str(connected.path_id)) if connected else None
            if a is None:
                unsupported.add("joint without body:" + component["pathId"])
                continue
            anchor = rotate(xy(d.get("m_Anchor", {}), node["scale"]), node["angle"])
            anchor = {axis: anchor[axis] + node["position"][axis] for axis in ("x", "y")}
            joint = {"id": component["pathId"], "type": component["type"].removesuffix("Joint2D").lower(),
                     "bodyA": a["id"], "bodyB": b["id"] if b else None,
                     "anchorA": local(anchor, a["position"], a["angle"]),
                     "anchorB": xy(d.get("m_ConnectedAnchor", {}), b["scale"]) if b else xy(d.get("m_ConnectedAnchor", {})),
                     "collideConnected": bool(d["m_EnableCollision"]), "enabled": bool(d["m_Enabled"]), "data": d,
                     "enableLimit": bool(d.get("m_UseLimits", False)), "enableMotor": bool(d.get("m_UseMotor", False))}
            if connected and b is None:
                unsupported.add("joint connected body outside prefab:" + component["pathId"])
            if "m_AngleLimits" in d:
                joint.update({"lowerAngle": math.radians(d["m_AngleLimits"]["m_LowerAngle"]), "upperAngle": math.radians(d["m_AngleLimits"]["m_UpperAngle"])})
            if "m_Motor" in d:
                motor_speed = d["m_Motor"].get("m_MotorSpeed", 0)
                joint.update({"motorSpeed": motor_speed if joint["type"] == "slider" else math.radians(motor_speed), "maxMotorTorque": d["m_Motor"].get("m_MaximumMotorForce", 0)})
            for raw_name, normalized_name in (("m_Frequency", "frequency"), ("m_DampingRatio", "dampingRatio"), ("m_Distance", "distance"),
                                               ("m_BreakForce", "breakForce"), ("m_BreakTorque", "breakTorque"), ("m_MaxForce", "maxForce"),
                                               ("m_MaxTorque", "maxTorque"), ("m_CorrectionScale", "correctionFactor")):
                if raw_name in d:
                    joint[normalized_name] = d[raw_name]
            if "m_Angle" in d:
                joint["axisAngle"] = math.radians(d["m_Angle"])
            if "m_TranslationLimits" in d:
                joint["lowerTranslation"] = d["m_TranslationLimits"]["m_LowerTranslation"]
                joint["upperTranslation"] = d["m_TranslationLimits"]["m_UpperTranslation"]
            if "m_Suspension" in d:
                joint["frequency"] = d["m_Suspension"]["m_Frequency"]
                joint["dampingRatio"] = d["m_Suspension"]["m_DampingRatio"]
                joint["axisAngle"] = math.radians(d["m_Suspension"]["m_Angle"])
            joints.append(joint)
        prefab = {"id": item["id"], "catalogId": item["id"], "name": item["name"], "rootGameObjectId": str(root.path_id),
                  "parts": parts, "joints": joints, "renderers": renderers, "nodes": nodes,
                  "staticColliders": [c for node in nodes for c in node.get("staticColliders", [])],
                  "status": "static-data-extracted", "unsupported": sorted(unsupported),
                  "coordinateSystem": "Unity XY root-relative; radians; collider geometry and joint anchors scaled; renderers body-local or root-relative"}
        return prefab

    def run_prefabs(self):
        _, catalog = self.catalog()
        prefabs = []
        for item in catalog:
            try:
                prefab = self.prefab(item)
                prefabs.append(prefab)
                save(self.output / "prefabs" / f"{item['id']}.json", json_ready(prefab))
            except Exception as exc:
                self.errors.append({"catalogId": item["id"], "name": item["name"], "phase": "prefab", "error": str(exc)})
                prefabs.append({"id": item["id"], "catalogId": item["id"], "name": item["name"], "status": "unavailable", "error": str(exc)})
        save(self.output / "prefabs.json", json_ready({"schemaVersion": 1, "prefabs": prefabs}))
        return prefabs

    def scriptables(self):
        by_id = {}
        unique = {(o.assets_file.name, o.path_id): o for o in self.env.objects if o.type.name == "MonoBehaviour"}
        for (filename, path_id), obj in sorted(unique.items()):
            try:
                head = obj.parse_monobehaviour_head()
                if head.m_GameObject.m_PathID:
                    continue
                script = head.m_Script.deref_parse_as_object()
                by_id[f"{filename}:{path_id}"] = {
                    "file": filename, "pathId": str(path_id), "name": head.m_Name,
                    "className": ".".join(p for p in (script.m_Namespace, script.m_ClassName) if p),
                    "data": self.decode(obj)}
            except Exception as exc:
                self.errors.append({"file": filename, "pathId": str(path_id), "phase": "scriptable", "error": str(exc)})
        save(self.output / "scriptables.json", json_ready({"schemaVersion": 1, "byId": by_id}))
        print(f"Resolved {len(by_id)} scriptable configurations", flush=True)
        return by_id

    def maps(self, scriptables):
        maps = []
        for key, asset in scriptables.items():
            if asset["className"] != "Map":
                continue
            item = {"id": asset["pathId"], "name": asset["name"], "prefab": asset["data"]["Prefab"]}
            try:
                prefab = self.prefab(item)
                prefab["kind"] = "map"
                save(self.output / "maps" / f"{item['id']}.json", json_ready(prefab))
                configs = [{"nodeId": n["id"], "position": n["position"], "scale": n["scale"], "component": c}
                           for n in prefab["nodes"] for c in n["components"]
                           if c["className"] in ("MapConfig", "BoundingBoxBehaviour", "WaterBehaviour", "LavaBehaviour")]
                maps.append({"id": item["id"], "name": item["name"], "identity": asset["data"]["UniqueIdentity"],
                             "description": asset["data"]["Description"], "sourceKey": key,
                             "thumbnail": self.sprite(asset["data"]["Thumbnail"], self.source_file),
                             "preview": self.sprite(asset["data"]["Preview"], self.source_file),
                             "prefabUrl": f"/local-assets/maps/{item['id']}.json", "status": "static-data-extracted",
                             "nodes": len(prefab["nodes"]), "parts": len(prefab["parts"]), "renderers": len(prefab["renderers"]),
                             "staticColliders": sum(len(n.get("staticColliders", [])) for n in prefab["nodes"]), "configs": configs})
            except Exception as exc:
                self.errors.append({"mapId": item["id"], "name": item["name"], "phase": "map", "error": str(exc)})
                maps.append({"id": item["id"], "name": item["name"], "status": "unavailable", "error": str(exc)})
        save(self.output / "maps.json", json_ready({"schemaVersion": 1, "maps": maps}))
        print(f"Extracted {sum(m['status'] != 'unavailable' for m in maps)}/{len(maps)} map prefabs", flush=True)
        return maps

    def graphics_materials(self):
        materials = {}
        unique = {(o.assets_file.name, o.path_id): o for o in self.env.objects if o.type.name == "Material"}
        for (filename, path_id), obj in sorted(unique.items()):
            data = self.decode(obj)
            props = data["m_SavedProperties"]
            textures = {}
            for name, value in props["m_TexEnvs"]:
                pointer = value["m_Texture"]
                texture = self.resolve(pointer, obj.assets_file)
                ref = None
                if texture is not None:
                    td = self.decode(texture)
                    stem = f"{safe_name(texture.assets_file.name)}-{texture.path_id}-{safe_name(td['m_Name'])}"
                    ref = {"file": texture.assets_file.name, "pathId": str(texture.path_id), "type": texture.type.name,
                           "url": f"/local-assets/objects/Texture2D/{stem}.png" if texture.type.name == "Texture2D" else None,
                           "width": td.get("m_Width"), "height": td.get("m_Height"), "format": td.get("m_TextureFormat", td.get("m_ColorFormat"))}
                textures[name] = {"texture": ref, **(ref or {}), "scale": value["m_Scale"], "offset": value["m_Offset"]}
            shader_obj = self.resolve(data["m_Shader"], obj.assets_file)
            shader = None
            if shader_obj is not None:
                shader_stem = f"{safe_name(shader_obj.assets_file.name)}-{shader_obj.path_id}-{safe_name(shader_obj.peek_name() or str(shader_obj.path_id))}"
                shader = {"file": shader_obj.assets_file.name, "pathId": str(shader_obj.path_id), "url": f"/local-assets/objects/Shader/{shader_stem}.shader"}
            materials[f"{filename}:{path_id}"] = {"file": filename, "pathId": str(path_id), "name": data["m_Name"], "shader": shader,
                                                   "textures": textures, "floats": dict(props["m_Floats"]), "colors": dict(props["m_Colors"]), "data": data}
        result = {"schemaVersion": 1, "byId": materials}
        save(self.output / "materials.json", json_ready(result))
        save(self.output / "body-materials.json", json_ready({"schemaVersion": 1, "byId": {k: v for k, v in materials.items() if v["shader"] and v["shader"]["file"] == "sharedassets0.assets" and v["shader"]["pathId"] == "892"}}))
        return result

    def inventory(self, resume=False):
        rows = []
        previous = {}
        inventory_path = self.output / "asset-inventory.json"
        if resume and inventory_path.exists():
            import json
            previous = {(r["file"], int(r["pathId"])): r for r in json.loads(inventory_path.read_text(encoding="utf-8"))["objects"]}
            manifest_path = self.output / "all-assets-manifest.json"
            old_sources = json.loads(manifest_path.read_text(encoding="utf-8")).get("sources", []) if manifest_path.exists() else []
            if not old_sources or any(not (self.data / s["path"]).is_file() or digest(self.data / s["path"]) != s["sha256"] for s in old_sources):
                previous = {}
        # UnityPy can register one serialized file under multiple dependency
        # aliases. Each source-bound object is inventoried exactly once.
        unique = {(o.assets_file.name, o.path_id): o for o in self.env.objects}
        objects = sorted(unique.values(), key=lambda o: (o.assets_file.name, o.path_id))
        for index, obj in enumerate(objects):
            old = previous.get((obj.assets_file.name, obj.path_id))
            convert_types = ("Sprite", "Texture2D", "AudioClip", "Font", "TextAsset", "Mesh", "Shader", "VideoClip")
            if old and "raw" in old and "metadataError" not in old and (old["status"] == "converted" or obj.type.name not in convert_types):
                raw_path = self.output / old["raw"]["url"].removeprefix("/local-assets/")
                valid = raw_path.is_file() and digest(raw_path) == old["raw"]["sha256"]
                for entry in old["payloads"]:
                    path = self.output / entry["url"].removeprefix("/local-assets/")
                    valid = valid and path.is_file() and digest(path) == entry["sha256"]
                if valid:
                    rows.append(old)
                    continue
            name = obj.peek_name() or str(obj.path_id)
            stem = f"{safe_name(obj.assets_file.name)}-{obj.path_id}-{safe_name(name)}"
            directory = self.output / "objects" / obj.type.name
            directory.mkdir(parents=True, exist_ok=True)
            row = {"file": obj.assets_file.name, "pathId": str(obj.path_id), "type": obj.type.name, "name": name,
                   "byteLength": obj.byte_size, "payloads": [], "status": "raw-preserved"}
            try:
                raw_path = directory / (stem + ".bin")
                raw_path.write_bytes(obj.get_raw_data())
                row["raw"] = {"url": "/local-assets/" + raw_path.relative_to(self.output).as_posix(), "sha256": digest(raw_path)}
                # All object types retain exact raw bytes. Metadata errors are
                # explicit and never interpreted as an absent object/field.
                try:
                    tree = self.decode(obj)
                    if obj.type.name == "MonoBehaviour":
                        script = obj.parse_monobehaviour_head().m_Script.deref_parse_as_object()
                        row["className"] = ".".join(p for p in (script.m_Namespace, script.m_ClassName) if p)
                    meta = directory / (stem + ".json")
                    save(meta, json_ready(tree))
                    row["metadata"] = "/local-assets/" + meta.relative_to(self.output).as_posix()
                except Exception as exc:
                    row["metadataError"] = str(exc)
                parsed = None
                def payload(path):
                    row["payloads"].append({"url": "/local-assets/" + path.relative_to(self.output).as_posix(), "bytes": path.stat().st_size, "sha256": digest(path)})
                if obj.type.name == "Sprite":
                    sprite = self.sprite({"m_FileID": 0, "m_PathID": obj.path_id}, obj.assets_file)
                    row["sprite"] = sprite
                    row["status"] = "converted"
                elif obj.type.name in ("Texture2D", "AudioClip", "Font", "TextAsset", "Mesh", "Shader", "VideoClip"):
                    parsed = obj.parse_as_object()
                    if obj.type.name == "Texture2D":
                        if parsed.m_Width == 0 or parsed.m_Height == 0:
                            row["status"] = "runtime-generated-no-payload"
                            row["note"] = "Serialized texture has zero dimensions and zero stored image bytes; generated by Unity at runtime."
                            rows.append(row)
                            continue
                        if int(parsed.m_TextureFormat) == 17:
                            raw_half = directory / (stem + ".rgba16f")
                            raw_half.write_bytes(parsed.get_image_data())
                            payload(raw_half)
                            row["textureEncoding"] = {"format": "RGBA16F", "width": parsed.m_Width, "height": parsed.m_Height,
                                                      "origin": "Unity raw bottom-left", "preview": "PNG clamps linear half values to [0,1]"}
                        path = directory / (stem + ".png")
                        parsed.image.save(path)
                        payload(path)
                    elif obj.type.name == "AudioClip":
                        samples = parsed.samples
                        if not samples:
                            raise RuntimeError("Audio decoder returned no samples")
                        for sample_name, sample in samples.items():
                            path = directory / (stem + "-" + safe_name(sample_name))
                            path.write_bytes(sample)
                            payload(path)
                    elif obj.type.name == "Font":
                        data = bytes(parsed.m_FontData)
                        if not data:
                            row["status"] = "runtime-font-no-embedded-payload"
                            row["note"] = "Unity runtime/system font reference; serialized font contains no embedded TTF/OTF bytes."
                            rows.append(row)
                            continue
                        path = directory / (stem + (".otf" if data[:4] == b"OTTO" else ".ttf"))
                        path.write_bytes(data)
                        payload(path)
                    elif obj.type.name == "TextAsset":
                        path = directory / (stem + ".txt")
                        value = parsed.m_Script
                        path.write_bytes(value if isinstance(value, bytes) else value.encode("utf-8", "surrogateescape"))
                        payload(path)
                    elif obj.type.name == "Mesh":
                        path = directory / (stem + ".obj")
                        path.write_text(parsed.export(), encoding="utf-8")
                        payload(path)
                    elif obj.type.name == "Shader":
                        path = directory / (stem + ".shader")
                        path.write_text(parsed.export(), encoding="utf-8")
                        payload(path)
                    elif obj.type.name == "VideoClip":
                        from UnityPy.helpers.ResourceReader import get_resource_data
                        resource = parsed.m_ExternalResources
                        value = get_resource_data(resource.m_Source, obj.assets_file, resource.m_Offset, resource.m_Size)
                        extension = Path(parsed.m_OriginalPath).suffix or ".video"
                        path = directory / (stem + extension)
                        path.write_bytes(value)
                        payload(path)
                    row["status"] = "converted"
            except Exception as exc:
                row["conversionError"] = str(exc)
                self.errors.append({"file": obj.assets_file.name, "pathId": str(obj.path_id), "type": obj.type.name, "phase": "object", "error": str(exc)})
            rows.append(row)
            if (index + 1) % 1000 == 0:
                print(f"Preserved {index + 1}/{len(objects)} objects", flush=True)
        save(self.output / "asset-inventory.json", {"schemaVersion": 1, "objects": rows})
        return rows

    def run_all(self, metadata_only=False, resume=False):
        prefabs = self.run_prefabs()
        scriptables = self.scriptables()
        maps = self.maps(scriptables)
        self.graphics_materials()
        print(f"Extracted {sum(p['status'] != 'unavailable' for p in prefabs)}/{len(prefabs)} catalogue prefabs", flush=True)
        rows = [] if metadata_only else self.inventory(resume)
        source_hashes = []
        for path in sorted(self.data.rglob("*")):
            if path.is_file():
                source_hashes.append({"path": path.relative_to(self.data).as_posix(), "bytes": path.stat().st_size, "sha256": digest(path)})
        # Preserve loose StreamingAssets resources in their original hierarchy.
        for path in sorted((self.data / "StreamingAssets").rglob("*")):
            if path.is_file():
                target = self.output / "streaming" / path.relative_to(self.data / "StreamingAssets")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
        manifest = {"schemaVersion": 1, "unityVersion": self.version,
                    "provider": "UnityPy 1.25.4 + TypeTreeGeneratorAPI 0.0.10; static extraction, not REA Evidence",
                    "loadedAssets": self.loaded_paths, "sources": source_hashes,
                    "prefabs": {"total": len(prefabs), "extracted": sum(p["status"] != "unavailable" for p in prefabs)},
                    "maps": {"total": len(maps), "extracted": sum(m["status"] != "unavailable" for m in maps)},
                    "objects": {"total": len(rows), "types": dict(sorted(Counter(r["type"] for r in rows).items())),
                                "converted": sum(r["status"] == "converted" for r in rows), "rawPreserved": sum("raw" in r for r in rows)},
                    "warnings": self.warnings, "errors": self.errors,
                    "limitations": ["Static extraction does not implement or verify Unity script behavior, shaders, physics or scene execution.",
                                    "Raw serialized bytes preserve unsupported conversions; conversion status is per-object.",
                                    "Metadata-only mode skips all-object payload inventory."] if metadata_only else
                                   ["Static extraction does not implement or verify Unity script behavior, shaders, physics or scene execution.",
                                    "Raw serialized bytes preserve unsupported conversions; conversion status is per-object."]}
        save(self.output / "all-assets-manifest.json", manifest)
        if not metadata_only:
            from build_asset_index import build
            build(self.output)
        print(f"Sources hashed: {len(source_hashes)}; objects preserved: {manifest['objects']['rawPreserved']}; errors: {len(self.errors)}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-root", type=Path, required=True)
    parser.add_argument("--metadata-only", action="store_true", help="Extract catalogue prefab data without all-object payload exports")
    parser.add_argument("--resume", action="store_true", help="Reuse hash-verified complete object exports from an earlier run")
    workspace = Path(__file__).resolve().parents[1]
    parser.add_argument("--output", type=Path, default=workspace / "public/local-assets")
    parser.add_argument("--research", type=Path, default=workspace / "research/local")
    args = parser.parse_args()
    if not (args.game_root / "People Playground_Data/sharedassets0.assets").is_file():
        parser.error("Missing People Playground_Data/sharedassets0.assets")
    for target in (args.output, args.research):
        if target.resolve() == args.game_root.resolve() or args.game_root.resolve() in target.resolve().parents:
            parser.error("Output must be outside source installation")
    AllExtractor(args.game_root.resolve(), args.output.resolve(), args.research.resolve()).run_all(args.metadata_only, args.resume)


if __name__ == "__main__":
    main()
