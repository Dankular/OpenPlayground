"""Create a small browser-facing index from the complete extraction inventory."""
import argparse
import json
from pathlib import Path
from extract_game_assets import save


def build(directory):
    inventory = json.loads((directory / "asset-inventory.json").read_text(encoding="utf-8"))
    kinds = {"AudioClip": "audio", "Texture2D": "textures", "Sprite": "sprites", "Font": "fonts", "Mesh": "meshes", "Material": "materials", "Shader": "shaders", "VideoClip": "videos"}
    result = {"schemaVersion": 1, "byId": {}, **{v: [] for v in kinds.values()}}
    for obj in inventory["objects"]:
        if obj["type"] not in kinds:
            continue
        key = f"{obj['file']}:{obj['pathId']}"
        row = {"key": key, "file": obj["file"], "pathId": obj["pathId"], "name": obj["name"], "status": obj["status"],
               "payloads": obj["payloads"], "metadataUrl": obj.get("metadata"), "raw": obj["raw"]}
        if "sprite" in obj:
            row["sprite"] = obj["sprite"]
        if "conversionError" in obj:
            row["conversionError"] = obj["conversionError"]
        result[kinds[obj["type"]]].append(row)
        result["byId"][key] = row
    save(directory / "media-index.json", result)
    audio = {}
    fonts = {}
    for row in result["audio"]:
        wav = next((p for p in row["payloads"] if p["url"].lower().endswith((".wav", ".ogg", ".m4a"))), None)
        if wav is None:
            continue
        metadata = json.loads((directory / row["metadataUrl"].removeprefix("/local-assets/")).read_text(encoding="utf-8"))
        audio[row["key"]] = {"name": row["name"], "url": wav["url"], "channels": metadata.get("m_Channels"),
                             "frequency": metadata.get("m_Frequency"), "duration": metadata.get("m_Length")}
    for row in result["fonts"]:
        font = next((p for p in row["payloads"] if p["url"].lower().endswith((".ttf", ".otf"))), None)
        fonts[row["key"]] = {"name": row["name"], "url": font["url"] if font else None, "status": row["status"]}
    save(directory / "audio-index.json", {"schemaVersion": 1, "byId": audio})
    save(directory / "font-index.json", {"schemaVersion": 1, "byId": fonts})
    print(json.dumps({kind: len(result[kind]) for kind in kinds.values()}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, nargs="?", default=Path(__file__).resolve().parents[1] / "public/local-assets")
    args = parser.parse_args()
    build(args.directory.resolve())
