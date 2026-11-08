#!/usr/bin/env python3
"""Runtime smoke test for Monkemon 2.5D:
Loads Title, all 5 Organic Curved Archipelago Islands, Walkable Cutaway House Interior,
Overworld Timing-Ring Monkeball Throw, Turn-Based Wild & Trainer Battles + GLSL Battle Shaders,
Apex Boss #20 King Monkezilla, 5-Tab Tamer Menu Hub (Squad, MonkeDex Grid & 20-Board, Bag & Catching Guide,
Illustrated World Map, TRELLIS.2 Sanctuary Forge), and Champion Ending in headless Chrome (SwiftShader WebGL),
failing on any uncaught JS error, WebGL shader error, or empty screenshot."""

import os
import subprocess
import sys
import tempfile
import time

PORT = os.environ.get("PORT", "8731")
BASE = f"http://127.0.0.1:{PORT}/?touch=0&"

SCENES = [
    ("title", "screen=title"),
    ("zone1-alex-house", "screen=play&zone=sunpalm&house=1"),
    ("interior-alex-house", "screen=play&zone=sunpalm&interior=alex_house"),
    ("interior-north-cave", "screen=play&zone=sunpalm&interior=north_cave"),
    ("zone2-pb-house", "screen=play&zone=canopy&house=1"),
    ("zone3-giants-realm", "screen=play&zone=giants_realm&house=1"),
    ("interior-giants-manor", "screen=play&zone=giants_realm&interior=giants_manor"),
    ("zone4-fish-house", "screen=play&zone=sparkstone&house=1"),
    ("interior-race-course", "screen=play&zone=race_realm&interior=race_course"),
    ("zone8-pork-house", "screen=play&zone=frostpeak&house=1"),
    ("interior-shogun-roof", "screen=play&zone=frostpeak&interior=shogun_rooftop"),
    ("zone9-cloud-isles", "screen=play&zone=cloud_realm&house=1"),
    ("zone10-beef-house", "screen=play&zone=cinderpeak&house=1"),
    ("interior-central-shrine", "screen=play&zone=cinderpeak&interior=central_shrine"),
    ("monkeball-aim", "screen=play&zone=sunpalm&aim=1"),
    ("wild-battle-menu", "screen=battle&zone=sunpalm&mode=wild&ready=1"),
    ("battle-shader-cast", "screen=battle&zone=sunpalm&action=cast"),
    ("boss20-monkezilla", "screen=boss20&ready=1"),
    ("menu-party-squad", "screen=party&dex=sample"),
    ("menu-encyclo-dex", "screen=dex&dex=sample"),
    ("board-20-dex", "screen=dex&dex=all&view=board"),
    ("menu-bag-guide", "screen=bag"),
    ("world-map", "screen=map&dex=sample"),
    ("trellis-forge", "screen=forge"),
    ("ending", "screen=ending&dex=all"),
]


def shoot(query: str):
    """Deterministic canvas capture via tools/capture_canvas.mjs (Chrome DevTools Protocol).

    The previous `--screenshot` + `--virtual-time-budget` approach raced the compositor on slow
    SwiftShader frames and intermittently produced black canvases; the CDP helper instead waits
    for asset loading to go idle plus a few rendered frames and reads the finished drawing buffer.
    """
    with tempfile.TemporaryDirectory() as udir:
        out = os.path.join(udir, "shot.png")
        cmd = [
            "node",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "capture_canvas.mjs"),
            query,
            out,
            "3",
            "960x600",
            "150",
        ]
        try:
            res = subprocess.run(
                cmd, capture_output=True, text=True, timeout=170, env={**os.environ, "PORT": PORT}
            )
            err = (res.stdout or "") + "\n" + (res.stderr or "")
            if res.returncode == 2:
                err += "\nTIMEOUT"
        except subprocess.TimeoutExpired:
            err = "TIMEOUT"

        errs = [
            line
            for line in err.splitlines()
            if (
                "Uncaught" in line
                or "Monkemon frame error" in line
                or "TIMEOUT" in line
                or "Shader Error" in line
                or "THREE.WebGLProgram" in line
            )
            and "chrome-extension" not in line
            and "extensions::" not in line
        ]
        size = os.path.getsize(out) if os.path.exists(out) else 0
        return size, errs


def main():
    fails = 0
    for name, q in SCENES:
        size, errs = shoot(q)
        # Empty captures are almost always transient (another headless Chrome saturating the box) — retry twice
        for _ in range(2):
            if errs or size > 0:
                break
            time.sleep(4)
            size, errs = shoot(q)
        ok = (not errs) and size > 25000
        if not ok:
            fails += 1
        print(("OK  " if ok else "FAIL"), name.ljust(22), f"{size}B", (errs[0][:160] if errs else ""))
    print("SMOKE_OK" if fails == 0 else f"SMOKE_FAILED ({fails})")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
