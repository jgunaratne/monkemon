#!/usr/bin/env bash
# Generates all 63 high-quality Monkemon 3D PBR .glb assets via the TRELLIS.2-4B pipeline
# (`preset: "hero"`, 2048x2048 PBR textures, 16 sparse/shape/tex diffusion steps, 20k-45k tris):
# - 20 distinct Monkey-like creatures (#01 through #20, including Bosses #19 & #20)
# - Monkeball (smiling monkey-face capture ball) + Capture Capsule
# - All Overworld Houses, Castles, Caves, Pyramids, Mirage Towers, Stadiums & Landmarks
# - All Overworld Scenery Props (Palm/Oak/Pine/Sky-Crystal Trees, Desert Cacti, Streetlamps, Boulders, Sky-Vine Pillars)
# - All Interior 3D Props & Stations (Healing Station, PC, Mart Counter, Jukebox, Lore Lectern, Bed, Bookcase, Potted Plant, Temple Pillar, Rock Boulder)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRELLIS_BIN="${TRELLIS_BIN:-/usr/local/google/home/junius/git/trellis2-pipeline/bin/trellis2}"
CONCURRENCY="${CONCURRENCY:-8}"
EXTRA_ARGS=()
if [[ "${FORCE:-0}" == "1" ]]; then
  EXTRA_ARGS+=("--force")
fi

echo "Running TRELLIS.2 high-quality hero batch asset pipeline (concurrency=${CONCURRENCY}, force=${FORCE:-0})..."
"${TRELLIS_BIN}" batch "${ROOT}/tools/monkemon_props_interiors_manifest.json" -j "${CONCURRENCY}" --retries 2 "${EXTRA_ARGS[@]}"
"${TRELLIS_BIN}" batch "${ROOT}/tools/monkemon_assets_manifest.json" -j "${CONCURRENCY}" --retries 2 "${EXTRA_ARGS[@]}"
"${TRELLIS_BIN}" batch "${ROOT}/tools/monkemon_sticky_spec_manifest.json" -j "${CONCURRENCY}" --retries 2 "${EXTRA_ARGS[@]}"
"${TRELLIS_BIN}" batch "${ROOT}/tools/monkemon_environment_manifest.json" -j "${CONCURRENCY}" --retries 2 "${EXTRA_ARGS[@]}"

python3 - "${ROOT}" << 'EOF'
import glob, json, os, sys, time
root = sys.argv[1]
models_dir = os.path.join(root, "assets", "models")
assets = []
for mf in sorted(glob.glob(os.path.join(models_dir, "*.meta.json"))):
    with open(mf) as f:
        m = json.load(f)
    aid = os.path.basename(mf).replace(".meta.json", "")
    concept_rel = f"concepts/{aid}.concept.png"
    has_concept = os.path.exists(os.path.join(models_dir, concept_rel))
    assets.append({
        "id": aid,
        "status": "completed",
        "preset": m.get("preset", "hero"),
        "texture_size": m.get("postprocessing", {}).get("texture_size", 2048),
        "glb": f"{aid}.glb",
        "concept": concept_rel if has_concept else None,
        "triangles": m.get("glb", {}).get("triangle_count", 0),
        "vertices": m.get("glb", {}).get("vertex_count", 0),
        "file_size_bytes": m.get("glb", {}).get("file_size_bytes", 0),
        "elapsed_seconds": m.get("elapsed_seconds", 0),
        "error": None,
    })
cat_path = os.path.join(models_dir, "asset_catalog.json")
with open(cat_path, "w") as f:
    json.dump({
        "generated_at_epoch": int(time.time()),
        "model": "microsoft/TRELLIS.2-4B",
        "preset": "hero",
        "texture_size": 2048,
        "output_dir": models_dir,
        "counts": {"total": len(assets), "completed": len(assets), "skipped": 0, "failed": 0},
        "assets": assets,
    }, f, indent=2)
print(f"Unified catalog written ({len(assets)} hero 3D assets): {cat_path}")
EOF
