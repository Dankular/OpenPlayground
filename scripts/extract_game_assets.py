"""Extract local People Playground reference data without executing game code.

Usage: .venv/Scripts/python scripts/extract_game_assets.py --game-root "D:/.../People Playground"
Generated game data lives in gitignored public/local-assets and research/local.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import struct

import UnityPy
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator


def rgba_half_preview(image_data, width, height):
    """Preview RGBA16F with the correct four-half pixel stride.

    UnityPy 1.25.4 routes RGBAHalf through a three-channel decoder and does
    not clamp HDR values. Preserve raw half-float bytes separately; this PNG
    is an explicitly bounded [0,1] preview for sprite/UI use.
    """
    from PIL import Image
    pixels = bytearray(width * height * 4)
    for index, rgba in enumerate(struct.iter_unpack("<4e", image_data[:width * height * 8])):
        for channel, value in enumerate(rgba):
            pixels[index * 4 + channel] = round(min(1., max(0., value if math.isfinite(value) else 0.)) * 255)
    return Image.frombytes("RGBA", (width, height), bytes(pixels))


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def finite_json(value):
    """JSON cannot represent Unity's infinite joint break thresholds."""
    if isinstance(value, float) and not math.isfinite(value):
        return "Infinity" if value > 0 else "-Infinity" if value < 0 else "NaN"
    if isinstance(value, dict):
        return {str(k): finite_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [finite_json(v) for v in value]
    return value


def save(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(finite_json(value), indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def xy(value, scale=None):
    scale = scale or {"x": 1, "y": 1}
    return {axis: value.get(axis, 0) * scale[axis] for axis in ("x", "y")}


class Extractor:
    def __init__(self, root: Path, output: Path, research: Path):
        self.root, self.output, self.research = root, output, research
        self.data = root / "People Playground_Data"
        self.env = UnityPy.load(str(self.data / "sharedassets0.assets"))
        first = next(iter(self.env.objects))
        self.version = first.assets_file.unity_version
        generator = TypeTreeGenerator(self.version)
        generator.load_local_game(str(root))
        self.env.typetree_generator = generator
        self.source_file = first.assets_file
        self.warnings: list[str] = []
        self.sprites: dict[tuple[str, int], dict] = {}
        self.output.mkdir(parents=True, exist_ok=True)
        from UnityPy.export.Texture2DConverter import CONV_TABLE
        from UnityPy.enums import TextureFormat
        CONV_TABLE[TextureFormat.RGBAHalf] = (rgba_half_preview, ())

    def decode(self, obj):
        if obj.type.name != "MonoBehaviour":
            return obj.parse_as_dict()
        # TypeTreeGeneratorAPI 0.0.10 emits a scalar 'string' node for
        # string[] fields and omits base enabled-byte alignment. Correct the
        # generated schema using the actual array child shape and Unity's
        # canonical MonoBehaviour header. Keep every serialized field intact.
        from UnityPy.helpers.TypeTreeNode import TypeTreeNode
        from UnityPy.helpers.Tpk import get_typetree_node
        from UnityPy.enums import ClassIDType
        node = obj._get_typetree_node()
        canonical = {n.m_Name: n for n in get_typetree_node(ClassIDType.MonoBehaviour, obj.version).m_Children}
        rows = []
        skip_level = None
        for n in node.traverse():
            if skip_level is not None and n.m_Level > skip_level:
                continue
            skip_level = None
            if n.m_Level == 1 and n.m_Name == "FireChunks" and "FireLoopChunk" in n.m_Type:
                # FireLoopSoundControllerBehaviour.FireChunks is a runtime
                # multidimensional array; Unity omits it. The shipped object
                # has only its header plus ChunkSize (36 bytes total).
                skip_level = n.m_Level
                continue
            row = {k: v for k, v in n.to_dict().items() if k != "m_Children"}
            if n.m_Level == 1 and n.m_Name in canonical:
                row["m_MetaFlag"] = canonical[n.m_Name].m_MetaFlag
            if (n.m_Type == "string" and n.m_Children and n.m_Children[0].m_Type == "Array"
                    and len(n.m_Children[0].m_Children) > 1
                    and n.m_Children[0].m_Children[1].m_Type == "string"):
                row["m_Type"] = "vector"
            # Linefy.DotsAtlas.Rect is a 48-byte custom struct, not Unity's
            # built-in 16-byte Rect. Its short emitted name otherwise selects
            # UnityPy's primitive Rect decoder and loses 32 bytes per entry.
            if n.m_Type == "Rect" and n.m_Children and (n.m_Children[0].m_Type == "Array" or n.m_Children[0].m_Name == "v0"):
                row["m_Type"] = "Linefy.DotsAtlas.Rect"
            rows.append(row)
        for index in range(len(rows) - 1, -1, -1):
            row = rows[index]
            if row["m_Type"] != "Linefy.DotsAtlas.Rect" or row["m_Name"] != "data":
                continue
            level = row["m_Level"]
            end = index + 1
            while end < len(rows) and rows[end]["m_Level"] > level:
                end += 1
            # Generator also omits UnityEngine.RectInt bounds on this custom
            # struct. ILSpy establishes the public bounds field; Unity stores
            # RectInt as four Int32 values. Restoring it consumes the exact
            # source size and preserves per-glyph pixel bounds.
            if not any(r["m_Name"] == "bounds" for r in rows[index + 1:end]):
                extra = [{"m_Level": level + 1, "m_Type": "RectInt", "m_Name": "bounds", "m_ByteSize": 16, "m_Version": 0, "m_MetaFlag": 0}]
                extra += [{"m_Level": level + 2, "m_Type": "int", "m_Name": name, "m_ByteSize": 4, "m_Version": 0, "m_MetaFlag": 0} for name in ("x", "y", "width", "height")]
                rows[end:end] = extra
        return obj.parse_as_dict(node=TypeTreeNode.from_list(rows))

    def resolve(self, pointer, source=None, required=True):
        source = source or self.source_file
        path_id = pointer.get("m_PathID", 0)
        file_id = pointer.get("m_FileID", 0)
        if not path_id:
            return None
        try:
            if file_id:
                # Let UnityPy resolve the serialized external file identifier;
                # never conflate matching path IDs from different asset files.
                from UnityPy.classes import PPtr
                return PPtr(m_FileID=file_id, m_PathID=path_id, assetsfile=source).deref()
            return source.objects[path_id]
        except Exception as exc:
            message = f"Unresolved {source.name}:{file_id}:{path_id}: {exc}"
            self.warnings.append(message)
            if required:
                raise RuntimeError(message) from exc
            return None

    def components(self, game_object):
        tree = game_object.parse_as_dict()
        return [(o, self.decode(o)) for c in tree["m_Component"]
                if (o := self.resolve(c["component"], game_object.assets_file)) is not None]

    def sprite(self, pointer, source):
        obj = self.resolve(pointer, source)
        if obj is None:
            return None
        key = (obj.assets_file.name, obj.path_id)
        if key in self.sprites:
            return self.sprites[key]
        tree = self.decode(obj)
        name = re.sub(r"[^A-Za-z0-9_-]", "_", tree["m_Name"])
        source_name = re.sub(r"[^A-Za-z0-9_.-]", "_", obj.assets_file.name)
        filename = f"{source_name}-{name}-{obj.path_id}.png"
        target = self.output / "sprites" / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        parsed = obj.parse_as_object()
        extraction = "UnityPy sprite mesh"
        try:
            image = parsed.image
        except (ValueError, ZeroDivisionError) as exc:
            # Some packed icons contain degenerate triangles. UnityPy's tight
            # mesh affine transform then yields NaN. Decode the same serialized
            # texture rectangle, alpha and packing rotation, skipping only the
            # broken tight-mesh mask. Never substitute an unrelated thumbnail.
            from UnityPy.export.SpriteHelper import get_image_from_sprite
            atlas = parsed.m_SpriteAtlas.deref_parse_as_object() if parsed.m_SpriteAtlas else None
            render_data = (next(v for k, v in atlas.m_RenderDataMap if k == parsed.m_RenderDataKey)
                           if atlas else parsed.m_RD)
            previous = render_data.settingsRaw
            render_data.settingsRaw = previous | 2
            try:
                image = get_image_from_sprite(parsed)
            finally:
                render_data.settingsRaw = previous
            extraction = "serialized texture rectangle (tight mesh fallback)"
            self.warnings.append(f"Sprite {tree['m_Name']}: used exact texture rectangle; mesh mask unavailable ({exc})")
        image.save(target)
        ppu = tree["m_PixelsToUnits"]
        render_data = (next(v for k, v in parsed.m_SpriteAtlas.deref_parse_as_object().m_RenderDataMap if k == parsed.m_RenderDataKey)
                       if parsed.m_SpriteAtlas else parsed.m_RD)
        texture_object = render_data.texture.deref()
        texture = texture_object.parse_as_object()
        source_stem = "-".join((re.sub(r"[^A-Za-z0-9_.-]", "_", texture_object.assets_file.name)[:100], str(texture_object.path_id),
                                re.sub(r"[^A-Za-z0-9_.-]", "_", texture.m_Name)[:100] or "unnamed"))
        texture_rect = render_data.textureRect
        result = {
            "url": f"/local-assets/sprites/{filename}", "name": tree["m_Name"],
            "width": tree["m_Rect"]["width"] / ppu,
            "height": tree["m_Rect"]["height"] / ppu,
            "pivot": tree["m_Pivot"], "pixelsPerUnit": ppu,
            "source": {"file": obj.assets_file.name, "pathId": str(obj.path_id)},
            "sha256": digest(target),
            "extraction": extraction,
            "sourceTexture": {"url": f"/local-assets/objects/Texture2D/{source_stem}.png", "width": texture.m_Width, "height": texture.m_Height,
                              "file": texture_object.assets_file.name, "pathId": str(texture_object.path_id), "format": int(texture.m_TextureFormat)},
            "uvRect": {"x": texture_rect.x / texture.m_Width, "y": texture_rect.y / texture.m_Height,
                       "width": texture_rect.width / texture.m_Width, "height": texture_rect.height / texture.m_Height},
            "packingRotation": (render_data.settingsRaw >> 2) & 15,
            "packed": bool(render_data.settingsRaw & 1),
            "textureRectOffset": {"x": render_data.textureRectOffset.x, "y": render_data.textureRectOffset.y},
        }
        self.sprites[key] = result
        return result

    def catalog(self):
        obj = next(o for o in self.env.objects if o.type.name == "MonoBehaviour" and o.peek_name() == "DefaultCatalog")
        tree = self.decode(obj)
        categories = []
        for pointer in tree["Categories"]:
            category = self.resolve(pointer, obj.assets_file)
            categories.append({"id": str(category.path_id), "name": category.peek_name()})
        rows = []
        human = None
        for pointer in tree["Items"]:
            item = self.resolve(pointer, obj.assets_file)
            data = self.decode(item)
            sprite = None
            try:
                sprite = self.sprite(data["ViewSprite"], item.assets_file)
            except Exception as exc:
                self.warnings.append(f"Catalogue sprite {data['m_Name']}: {exc}")
            rows.append({
                "id": str(item.path_id), "name": data["m_Name"], "description": data["Description"],
                "categoryId": str(data["Category"]["m_PathID"]),
                "visible": bool(data["VisibleInCatalog"]), "locked": bool(data["Locked"]),
                "order": data["NameToOrderBy"], "prefab": data["Prefab"], "sprite": sprite,
                "behaviorPorted": False,
            })
            if data["m_Name"] == "Human":
                human = self.resolve(data["Prefab"], item.assets_file)
        save(self.output / "catalog.json", {"schemaVersion": 1, "categories": categories, "items": rows})
        if human is None:
            raise RuntimeError("DefaultCatalog does not contain Human")
        return human, rows

    def human(self, root):
        root_components = self.components(root)
        root_transform = next(d for o, d in root_components if o.type.name == "Transform")
        children = [(self.resolve(p, root.assets_file), {"x": 0., "y": 0.}, 0., {"x": 1., "y": 1.}) for p in root_transform["m_Children"]]
        parts, joint_data, raw_nodes = [], [], []
        visited = set()
        while children:
            obj, parent_pos, parent_angle, parent_scale = children.pop(0)
            key = (obj.assets_file.name, obj.path_id)
            if key in visited:
                raise RuntimeError(f"Transform cycle or repeated child: {key}")
            visited.add(key)
            t = obj.parse_as_dict()
            local = xy(t["m_LocalPosition"], parent_scale)
            c, s = math.cos(parent_angle), math.sin(parent_angle)
            position = {"x": parent_pos["x"] + local["x"] * c - local["y"] * s,
                        "y": parent_pos["y"] + local["x"] * s + local["y"] * c}
            q = t["m_LocalRotation"]
            if abs(q["x"]) > .00001 or abs(q["y"]) > .00001:
                raise RuntimeError("Human prefab contains out-of-plane quaternion rotation")
            angle = parent_angle + 2 * math.atan2(q["z"], q["w"])
            scale = {a: parent_scale[a] * t["m_LocalScale"][a] for a in ("x", "y")}
            children.extend((self.resolve(p, obj.assets_file), position, angle, scale) for p in t["m_Children"])
            go = self.resolve(t["m_GameObject"], obj.assets_file)
            components = self.components(go)
            rigidbody = next(((o, d) for o, d in components if o.type.name == "Rigidbody2D"), None)
            raw_nodes.append({"gameObjectId": str(go.path_id), "name": go.peek_name(), "components": [
                {"pathId": str(o.path_id), "type": o.type.name,
                 "className": (o.parse_monobehaviour_head().m_Script.deref_parse_as_object().m_ClassName if o.type.name == "MonoBehaviour" else o.type.name),
                 "data": d} for o, d in components]})
            if rigidbody is None:
                continue
            rb_obj, rb = rigidbody
            colliders = []
            for collider_obj, d in components:
                kind = collider_obj.type.name
                if not kind.endswith("Collider2D") or not d.get("m_Enabled", True):
                    continue
                shape = {"type": kind.removesuffix("Collider2D").lower(), "offset": xy(d["m_Offset"], scale), "isTrigger": bool(d["m_IsTrigger"])}
                if kind == "BoxCollider2D":
                    shape["size"] = xy(d["m_Size"], {a: abs(scale[a]) for a in ("x", "y")})
                elif kind == "CircleCollider2D":
                    shape["radius"] = d["m_Radius"] * max(abs(scale[a]) for a in ("x", "y"))
                elif kind == "PolygonCollider2D":
                    shape["paths"] = [[xy(p, scale) for p in path] for path in d["m_Points"]["m_Paths"]]
                else:
                    raise RuntimeError(f"Unsupported human collider {kind}")
                colliders.append(shape)
            render = next(((o, d) for o, d in components if o.type.name == "SpriteRenderer"), None)
            sprite = None
            if render:
                render_obj, d = render
                sprite = dict(self.sprite(d["m_Sprite"], render_obj.assets_file))
                sprite.update({"width": sprite["width"] * abs(scale["x"]), "height": sprite["height"] * abs(scale["y"]),
                               "sortingOrder": d["m_SortingOrder"], "sortingLayer": d["m_SortingLayer"],
                               "flipX": bool(d["m_FlipX"]) != (scale["x"] < 0), "flipY": bool(d["m_FlipY"]) != (scale["y"] < 0),
                               "color": d["m_Color"]})
            part = {"id": str(rb_obj.path_id), "name": go.peek_name(), "position": position, "angle": angle, "scale": scale,
                    "mass": rb["m_Mass"], "linearDamping": rb["m_LinearDrag"], "angularDamping": rb["m_AngularDrag"],
                    "gravityScale": rb["m_GravityScale"], "colliders": colliders, "sprite": sprite}
            parts.append(part)
            for joint_obj, d in components:
                if joint_obj.type.name == "HingeJoint2D":
                    joint_data.append((part, joint_obj, d))
        by_id = {p["id"]: p for p in parts}
        joints = []
        for part, obj, d in joint_data:
            connected = self.resolve(d["m_ConnectedRigidBody"], obj.assets_file)
            if connected is None or str(connected.path_id) not in by_id:
                raise RuntimeError(f"Joint {obj.path_id} connects outside extracted human rig")
            other = by_id[str(connected.path_id)]
            joints.append({"bodyA": part["id"], "bodyB": other["id"],
                           "anchorA": xy(d["m_Anchor"], part["scale"]), "anchorB": xy(d["m_ConnectedAnchor"], other["scale"]),
                           "lowerAngle": math.radians(d["m_AngleLimits"]["m_LowerAngle"]),
                           "upperAngle": math.radians(d["m_AngleLimits"]["m_UpperAngle"]),
                           "enableLimit": bool(d["m_UseLimits"]), "enableMotor": bool(d["m_UseMotor"]),
                           "motorSpeed": math.radians(d["m_Motor"]["m_MotorSpeed"]), "maxMotorTorque": d["m_Motor"]["m_MaximumMotorForce"],
                           "collideConnected": bool(d["m_EnableCollision"])})
        # Normalize spawn origin to the lowest unrotated collider bottom. Human
        # has only axis-aligned boxes in this build; do not silently assume it.
        if any(abs(p["angle"]) > 1e-5 for p in parts):
            raise RuntimeError("Cannot normalize rotated prefab colliders to ground")
        bottom = min(p["position"]["y"] + c["offset"]["y"] - c["size"]["y"] / 2
                     for p in parts for c in p["colliders"] if c["type"] == "box")
        for part in parts:
            part["position"]["y"] -= bottom
        rig = {"schemaVersion": 1, "name": "Human", "sourcePrefabPathId": str(root.path_id),
               "coordinateSystem": "Unity XY, radians, root-relative X; lowest collider Y shifted to zero",
               "originYOffset": -bottom, "parts": parts, "joints": joints,
               "limitations": ["Static serialized prefab baseline; runtime pose controllers, physiology, damage, random sizing, skin shaders and collision-ignore setup are not reconstructed.",
                               "Unity hinge limit/motor convention must be adapted to the browser physics engine."]}
        save(self.output / "human-rig.json", rig)
        save(self.research / "human-prefab.json", {"root": root.parse_as_dict(), "rootComponents": [
            {"pathId": str(o.path_id), "type": o.type.name,
             "className": (o.parse_monobehaviour_head().m_Script.deref_parse_as_object().m_ClassName if o.type.name == "MonoBehaviour" else o.type.name),
             "data": d} for o, d in root_components], "nodes": raw_nodes})
        return rig

    def run(self):
        root, catalog = self.catalog()
        rig = self.human(root)
        settings_env = UnityPy.load(str(self.data / "globalgamemanagers"))
        settings = {o.type.name: o.parse_as_dict() for o in settings_env.objects if o.type.name in ("TimeManager", "Physics2DSettings")}
        save(self.output / "settings.json", settings)
        names = ["sharedassets0.assets", "sharedassets0.assets.resS", "globalgamemanagers", "Managed/Assembly-CSharp.dll"]
        manifest = {"schemaVersion": 1, "extractor": "scripts/extract_game_assets.py", "provider": "UnityPy 1.25.4 + TypeTreeGeneratorAPI 0.0.10 (not REA Evidence)",
                    "unityVersion": self.version, "sources": [{"path": name, "bytes": (self.data / name).stat().st_size, "sha256": digest(self.data / name)} for name in names],
                    "counts": {"catalogItems": len(catalog), "humanParts": len(rig["parts"]), "humanJoints": len(rig["joints"]), "sprites": len(self.sprites)},
                    "warnings": self.warnings, "limitations": rig["limitations"]}
        save(self.output / "manifest.json", manifest)
        print(json.dumps({"output": str(self.output), "unityVersion": self.version, **manifest["counts"], "warnings": self.warnings}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-root", type=Path, required=True)
    workspace = Path(__file__).resolve().parents[1]
    parser.add_argument("--output", type=Path, default=workspace / "public" / "local-assets")
    parser.add_argument("--research", type=Path, default=workspace / "research" / "local")
    args = parser.parse_args()
    if not (args.game_root / "People Playground_Data" / "sharedassets0.assets").is_file():
        parser.error("game-root must contain People Playground_Data/sharedassets0.assets")
    for target in (args.output, args.research):
        if target.resolve() == args.game_root.resolve() or args.game_root.resolve() in target.resolve().parents:
            parser.error("Output directories must be outside the source game installation")
    Extractor(args.game_root.resolve(), args.output.resolve(), args.research.resolve()).run()


if __name__ == "__main__":
    main()
