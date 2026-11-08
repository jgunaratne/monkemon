#!/usr/bin/env python3
"""TRELLIS.2 Sanctuary 3D Forge API for Monkemon.

Allows players to forge custom 3D PBR .glb Monkey-like creatures live from inside
the browser or Steam Deck game using the TRELLIS.2-4B pipeline!
"""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import sys
import threading
import time
import uuid

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TRELLIS_REPO = os.environ.get(
    "TRELLIS2_PIPELINE_DIR",
    os.path.expanduser("~/git/trellis2-pipeline"),
)
if os.path.isdir(DEFAULT_TRELLIS_REPO) and DEFAULT_TRELLIS_REPO not in sys.path:
    sys.path.insert(0, DEFAULT_TRELLIS_REPO)

try:
    from trellis2_pipeline.client import (
        Trellis2Client,
        Trellis2Error,
        Trellis2Request,
        generate_concept_image,
    )
    HAS_TRELLIS = True
except Exception as exc:  # pragma: no cover
    HAS_TRELLIS = False
    TRELLIS_IMPORT_ERROR = str(exc)

FORGED_MODELS_DIR = os.path.join(ROOT_DIR, "assets", "models", "forged")
FORGED_JSON_PATH = os.path.join(ROOT_DIR, "assets", "forged_species.json")
os.makedirs(FORGED_MODELS_DIR, exist_ok=True)

DIORAMA_STYLE = (
    "charming glossy toy-diorama miniature monkey-like creature figurine, "
    "smooth sculpted vinyl and satin glazed ceramic PBR materials, vibrant colors, "
    "chunky rounded chibi proportions, big expressive eyes, crisp toy-set craftsmanship"
)

VALID_ELEMENTS = {"mug", "monster", "dog", "rubber_duck", "stuffie", "bob", "cow"}
ELEMENT_PALETTES = {
    "mug": {"primary": "#d97742", "secondary": "#fef3c7", "accent": "#92400e"},
    "monster": {"primary": "#ef4444", "secondary": "#450a0a", "accent": "#fbbf24"},
    "dog": {"primary": "#f59e0b", "secondary": "#fef08a", "accent": "#dc2626"},
    "rubber_duck": {"primary": "#facc15", "secondary": "#38bdf8", "accent": "#fb923c"},
    "stuffie": {"primary": "#f472b6", "secondary": "#fbcfe8", "accent": "#a855f7"},
    "bob": {"primary": "#60a5fa", "secondary": "#f8fafc", "accent": "#ef4444"},
    "cow": {"primary": "#f8fafc", "secondary": "#1e293b", "accent": "#4ade80"},
}
ELEMENT_MOVES = {
    "mug": ["monk_run", "fake_out", "eat_snack", "sky_jump", "espresso_geyser"],
    "monster": ["monk_run", "fake_out", "eat_snack", "sky_jump", "kaiju_roar"],
    "dog": ["monk_run", "fake_out", "eat_snack", "sky_jump", "zoomie_fetch"],
    "rubber_duck": ["monk_run", "fake_out", "eat_snack", "sky_jump", "squeak_tsunami"],
    "stuffie": ["monk_run", "fake_out", "eat_snack", "sky_jump", "plush_cuddle_nova"],
    "bob": ["monk_run", "fake_out", "eat_snack", "sky_jump", "necktie_beam"],
    "cow": ["monk_run", "fake_out", "eat_snack", "sky_jump", "pasture_stampede"],
}

_lock = threading.Lock()
_jobs: dict[str, dict] = {}


def _slugify(text: str) -> str:
    clean = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return (clean or "forged_monke")[:24]


def _load_forged_species() -> list[dict]:
    if not os.path.exists(FORGED_JSON_PATH):
        return []
    try:
        with open(FORGED_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("species", []) if isinstance(data, dict) else []
    except Exception:
        return []


def _save_forged_species(species_list: list[dict]) -> None:
    with open(FORGED_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump({"species": species_list, "updated_at": int(time.time())}, f, indent=2)


def _run_forge_job(job_id: str, name: str, element: str, prompt: str, zone_id: str) -> None:
    slug = f"forge_{_slugify(name)}_{job_id[:4]}"
    concept_path = os.path.join(FORGED_MODELS_DIR, f"{slug}.concept.png")
    glb_path = os.path.join(FORGED_MODELS_DIR, f"{slug}.glb")

    def update(status: str, msg: str, **extra):
        with _lock:
            j = _jobs[job_id]
            j["status"] = status
            j["message"] = msg
            j["updated_at"] = time.time()
            j.update(extra)

    if not HAS_TRELLIS:
        update("failed", f"TRELLIS.2 client not available: {TRELLIS_IMPORT_ERROR}")
        return

    try:
        update("running", "Step 1/2: Painting 2D diorama concept figurine via Gempix...")
        full_prompt = (
            f"adorable monkey-like creature named {name}, {element} elemental affinity, "
            f"{prompt.strip()}"
        )
        generate_concept_image(
            prompt=full_prompt,
            output_image_path=concept_path,
            style=DIORAMA_STYLE,
        )
        update(
            "running",
            "Step 2/2: Reconstructing O-Voxel 3D PBR .glb mesh on TRELLIS.2-4B H100...",
            concept_url=f"/assets/models/forged/{slug}.concept.png",
        )
        client = Trellis2Client()
        req = Trellis2Request(
            image_paths=[concept_path],
            output_glb_path=glb_path,
            preset="hero",
            decimation_target=30000,
            texture_size=2048,
            seed=int(time.time()) % 10000,
            prompt_metadata={"name": name, "element": element, "prompt": prompt},
        )
        res = client.generate(req, on_progress=lambda m: update("running", f"TRELLIS.2: {m}"))

        with _lock:
            existing = _load_forged_species()
            dex_num = 100 + len(existing) + 1
            species_entry = {
                "id": slug,
                "dexNum": dex_num,
                "name": name,
                "title": f"Forged {element.capitalize()} Simian",
                "element": element,
                "glb": f"assets/models/forged/{slug}.glb",
                "concept": f"assets/models/forged/{slug}.concept.png",
                "palette": ELEMENT_PALETTES.get(element, ELEMENT_PALETTES["mug"]),
                "baseStats": {"hp": 68, "atk": 66, "def": 60, "spd": 64},
                "scale": 1.05,
                "catchRate": 0.55,
                "zoneId": zone_id,
                "moves": ELEMENT_MOVES.get(element, ELEMENT_MOVES["mug"]),
                "bio": f"Custom TRELLIS.2-forged Monkemon: {prompt.strip()[:140]}",
                "triangles": res.glb_report.triangle_count,
            }
            existing.append(species_entry)
            _save_forged_species(existing)

        update(
            "complete",
            f"Forged {name} ({res.glb_report.triangle_count:,} tris)!",
            glb_url=f"/assets/models/forged/{slug}.glb",
            species=species_entry,
        )
    except (Trellis2Error, OSError, ValueError) as e:
        update("failed", str(e))


class ForgeHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return  # quiet HTTP logs

    def _send_json(self, code: int, payload: dict):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.startswith("/api/forge/status"):
            with _lock:
                jobs = list(_jobs.values())
            jobs.sort(key=lambda j: j["created_at"], reverse=True)
            self._send_json(
                200,
                {
                    "ok": True,
                    "trellis_available": HAS_TRELLIS,
                    "jobs": jobs[:12],
                    "species": _load_forged_species(),
                },
            )
            return
        self._send_json(404, {"error": "Unknown endpoint"})

    def do_POST(self):
        if self.path.startswith("/api/forge/create"):
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(min(length, 32768))
            try:
                data = json.loads(body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json(400, {"error": "Invalid JSON"})
                return

            name = str(data.get("name") or "Wafflemonk").strip()[:20]
            element = str(data.get("element") or "mug").strip().lower()
            if element not in VALID_ELEMENTS:
                element = "mug"
            prompt = str(data.get("prompt") or "").strip()[:320]
            zone_id = str(data.get("zoneId") or "sunpalm").strip()[:24]
            if len(prompt) < 4:
                self._send_json(400, {"error": "Please enter a short visual description of your Monkemon."})
                return

            job_id = uuid.uuid4().hex[:10]
            now = time.time()
            job = {
                "job_id": job_id,
                "name": name,
                "element": element,
                "prompt": prompt,
                "status": "running",
                "message": "Queued in TRELLIS.2 Sanctuary Forge...",
                "created_at": now,
                "updated_at": now,
            }
            with _lock:
                _jobs[job_id] = job

            t = threading.Thread(
                target=_run_forge_job,
                args=(job_id, name, element, prompt, zone_id),
                daemon=True,
            )
            t.start()
            self._send_json(202, {"ok": True, "job": job})
            return

        self._send_json(404, {"error": "Unknown POST endpoint"})


def main():
    p = argparse.ArgumentParser(description="TRELLIS.2 Sanctuary Forge Server")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8732)
    args = p.parse_args()
    srv = ThreadingHTTPServer((args.host, args.port), ForgeHandler)
    print(f"TRELLIS.2 Sanctuary Forge API listening on http://{args.host}:{args.port}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
