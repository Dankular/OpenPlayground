"""Validate reference integrity of an extracted local asset directory."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path


def validate(directory: Path, verify_payload_hashes=False):
    public = directory.parent
    def read(name):
        return json.loads((directory / name).read_text(encoding="utf-8"))
    catalog = read("catalog.json")
    prefabs = read("prefabs.json")["prefabs"]
    maps = read("maps.json")["maps"] if (directory / "maps.json").exists() else []
    map_prefabs = []
    for entry in maps:
        assert entry["status"] != "unavailable", f"Map unavailable {entry['name']}"
        path = public / entry["prefabUrl"].lstrip("/")
        assert path.is_file()
        map_prefabs.append(json.loads(path.read_text(encoding="utf-8")))
    items = {item["id"]: item for item in catalog["items"]}
    assert len(items) == len(catalog["items"]), "Duplicate catalogue IDs"
    assert {prefab["catalogId"] for prefab in prefabs} == set(items), "Catalogue/prefab mismatch"
    assert all(p["status"] != "unavailable" for p in prefabs), "Some prefabs unavailable"
    assert all(item["sprite"] is not None for item in items.values()), "Missing catalogue thumbnail"
    checked_sprites = set()
    for prefab in prefabs + map_prefabs:
        parts = {part["id"]: part for part in prefab["parts"]}
        nodes = {node["id"]: node for node in prefab["nodes"]}
        assert len(nodes) == len(prefab["nodes"]), f"Duplicate nodes in {prefab['name']}"
        assert len(parts) == len(prefab["parts"]), f"Duplicate bodies in {prefab['name']}"
        for node in nodes.values():
            assert node["parentId"] is None or node["parentId"] in nodes
            assert node["bodyId"] is None or node["bodyId"] in parts
            if node["parentId"] is not None and not nodes[node["parentId"]]["active"]:
                assert not node["active"], "Inactive parent has active child"
        for part in parts.values():
            assert part["nodeId"] in nodes
            assert part["mass"] > 0
            assert all(math.isfinite(part["position"][axis]) for axis in ("x", "y"))
            for collider in part["colliders"]:
                assert collider["type"] in ("box", "circle", "polygon", "capsule", "edge", "composite")
                if "size" in collider:
                    assert min(collider["size"].values()) > 0
        for joint in prefab["joints"]:
            assert joint["bodyA"] in parts
            assert joint["bodyB"] is None or joint["bodyB"] in parts
        for renderer in prefab["renderers"]:
            assert renderer["nodeId"] in nodes
            assert renderer["bodyId"] is None or renderer["bodyId"] in parts
            sprite = renderer["sprite"]
            path = public / sprite["url"].lstrip("/")
            assert path.is_file(), f"Missing sprite {path}"
            if sprite["url"] not in checked_sprites:
                assert hashlib.sha256(path.read_bytes()).hexdigest() == sprite["sha256"], f"Sprite hash mismatch {path}"
                checked_sprites.add(sprite["url"])
    inventory_path = directory / "asset-inventory.json"
    inventory = read("asset-inventory.json")["objects"] if inventory_path.exists() else []
    for item in inventory:
        assert "raw" in item, f"Raw object lost {item['file']}:{item['pathId']}"
        path = public / item["raw"]["url"].lstrip("/")
        assert path.is_file()
        assert path.stat().st_size == item["byteLength"]
        if verify_payload_hashes:
            assert hashlib.sha256(path.read_bytes()).hexdigest() == item["raw"]["sha256"]
        for payload in item["payloads"]:
            path = public / payload["url"].lstrip("/")
            assert path.is_file()
            assert path.stat().st_size == payload["bytes"]
            if verify_payload_hashes:
                assert hashlib.sha256(path.read_bytes()).hexdigest() == payload["sha256"]
    result = {"catalogItems": len(items), "prefabs": len(prefabs),
              "maps": len(map_prefabs),
              "bodies": sum(len(p["parts"]) for p in prefabs),
              "renderers": sum(len(p["renderers"]) for p in prefabs),
              "verifiedSprites": len(checked_sprites), "serializedObjects": len(inventory),
              "conversionStatuses": dict(Counter(item["status"] for item in inventory)),
              "allPayloadHashesVerified": verify_payload_hashes}
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, nargs="?", default=Path(__file__).resolve().parents[1] / "public/local-assets")
    parser.add_argument("--verify-payload-hashes", action="store_true")
    args = parser.parse_args()
    print(json.dumps(validate(args.directory.resolve(), args.verify_payload_hashes), indent=2))
