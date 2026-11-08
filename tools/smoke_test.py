#!/usr/bin/env python3
"""Runtime smoke test for Monkemon 2.5D:
Loads Title, all 5 Toy-Diorama Zones & Houses, Overworld Timing-Ring Monkeball Throw,
Real-Time Trainer Arena Battle, Apex Boss #20 King Monkezilla, 20-Monkemon Board & 3D Turntable,
Archipelago Map, TRELLIS.2 Sanctuary Forge, and Champion Ending in headless Chrome (SwiftShader WebGL),
failing on any uncaught JS error or empty screenshot."""

import os
import subprocess
import sys
import tempfile

PORT = os.environ.get("PORT", "8731")
BASE = f"http://127.0.0.1:{PORT}/?touch=0&"

SCENES = [
    ("title", "screen=title"),
    ("zone1-alex-house", "screen=play&zone=sunpalm&house=1"),
    ("zone2-pb-house", "screen=play&zone=canopy&house=1"),
    ("zone3-fish-house", "screen=play&zone=sparkstone&house=1"),
    ("zone4-pork-house", "screen=play&zone=frostpeak&house=1"),
    ("zone5-beef-house", "screen=play&zone=cinderpeak&house=1"),
    ("monkeball-aim", "screen=play&zone=sunpalm&aim=1"),
    ("trainer-battle", "screen=battle&zone=sunpalm"),
    ("boss20-monkezilla", "screen=boss20"),
    ("board-20-dex", "screen=dex&dex=all"),
    ("world-map", "screen=map"),
    ("trellis-forge", "screen=forge"),
    ("ending", "screen=ending&dex=all"),
]


def shoot(query: str):
    with tempfile.TemporaryDirectory() as udir:
        out = os.path.join(udir, "shot.png")
        cmd = [
            "google-chrome",
            "--headless=new",
            "--disable-extensions",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--hide-scrollbars",
            "--no-first-run",
            f"--user-data-dir={udir}",
            "--proxy-server=direct://",
            "--proxy-bypass-list=*",
            "--window-size=960,600",
            "--virtual-time-budget=4500",
            f"--screenshot={out}",
            BASE + query,
            "--enable-logging=stderr",
            "--v=0",
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=65)
            err = res.stderr or ""
        except subprocess.TimeoutExpired:
            err = "TIMEOUT"

        errs = [
            line
            for line in err.splitlines()
            if ("Uncaught" in line or "TIMEOUT" in line)
            and "chrome-extension" not in line
            and "extensions::" not in line
        ]
        size = os.path.getsize(out) if os.path.exists(out) else 0
        return size, errs


def main():
    fails = 0
    for name, q in SCENES:
        size, errs = shoot(q)
        if not errs and size == 0:
            size, errs = shoot(q)
        ok = (not errs) and size > 25000
        if not ok:
            fails += 1
        print(("OK  " if ok else "FAIL"), name.ljust(20), f"{size}B", (errs[0][:160] if errs else ""))
    print("SMOKE_OK" if fails == 0 else f"SMOKE_FAILED ({fails})")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
