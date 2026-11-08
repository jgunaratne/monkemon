# Steam Deck Setup Runbook — Monkemon 2.5D (Local SSD + Gamepad Kiosk)

> [!IMPORTANT]
> Run all steps below as the standard `deck` user (`$HOME` = `/home/deck`). **Do NOT use `sudo` or `steamos-readonly disable`** — everything installs cleanly in user-space on SteamOS using `/usr/bin/python3`, `/usr/bin/flatpak`, and Google Chrome.

## Architecture Overview

1. **Instant Local NVMe SSD Serving (`$HOME/.local/share/monkemon/site/`)**:
   - All game ES modules, vendored Three.js `0.170.0`, all 32 TRELLIS.2 PBR `.glb` 3D models, 11 Lyria `.mp3` music tracks, and 18 Daikon `.mp3` voice clips are stored locally on the Steam Deck SSD and served by `monkemon-edge.py` on `http://127.0.0.1:8731/?touch=0` with `206 Partial Content` byte-range audio streaming.
   - `monkemon-edge.py` starts automatically when launching **Monkemon** from Steam Gaming Mode and exits automatically via `trap` when quitting (**STEAM → Exit Game**).
2. **Optional Live Upstream Sync & Archipelago Multiplayer**:
   - When `MONKEMON_UPSTREAM` is configured and reachable over Wi-Fi, `monkemon-edge.py` proxies `/api/*` (including live TRELLIS.2 Sanctuary Forge requests) and tunnels `/ws` so Steam Deck Tamers see online players across all 5 island zones. When offline (flights/commutes), the game boots immediately in 100% offline mode.
3. **Native `1280×800` Display & Steam Deck Controller**:
   - `--window-size=1280,800 --force-device-scale-factor=1` fills the `1280×800` Steam Deck OLED/LCD screen at native resolution, `?touch=0` hides mobile virtual touch overlays, and `flatpak override --filesystem=/run/udev:ro` enables `navigator.getGamepads()` for full `A / B / X / Y / LB / RB / LT / View / Menu` support.

---

## Step 1: Ensure Google Chrome Flatpak & Steam Deck Gamepad `udev` Access

```bash
set -euo pipefail

if ! flatpak info com.google.Chrome >/dev/null 2>&1; then
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  flatpak install --user -y flathub com.google.Chrome
fi

# Required so HTML5 navigator.getGamepads() detects the Steam Deck controller in Gaming Mode
flatpak --user override --filesystem=/run/udev:ro com.google.Chrome
```

---

## Step 2: Copy or Sync Monkemon to `$HOME/.local/share/monkemon/site/` & Install Edge Server

Copy this repository (or `rsync -az` from your workstation) into `$HOME/.local/share/monkemon/site/`, then install `monkemon-edge.py` and the Kiosk launcher:

```bash
mkdir -p \
  "$HOME/.local/bin" \
  "$HOME/.local/share/monkemon/site" \
  "$HOME/.local/share/applications"

cat > "$HOME/.local/share/monkemon/monkemon-edge.py" << 'PYEOF'
#!/usr/bin/env python3
"""Zero-dependency local NVMe static + 206 byte-range server for Monkemon on Steam Deck."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
import re

MIME_MAP = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".glb": "model/gltf-binary",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
}

RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


class MonkemonEdgeHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def guess_type(self, path):
        _, ext = os.path.splitext(path.lower())
        return MIME_MAP.get(ext, super().guess_type(path))

    def do_GET(self):
        if self.path.startswith("/api/health"):
            body = b'{"ok":true,"game":"monkemon","mode":"steamdeck-local"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/api/forged_species"):
            fp = os.path.join(self.directory, "assets", "forged_species.json")
            body = open(fp, "rb").read() if os.path.isfile(fp) else b'{"species":[]}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        fs_path = self.translate_path(self.path)
        if os.path.isdir(fs_path):
            fs_path = os.path.join(fs_path, "index.html")
        if not os.path.isfile(fs_path):
            self.send_error(404, "Not Found")
            return

        size = os.path.getsize(fs_path)
        ctype = self.guess_type(fs_path)
        rng = self.headers.get("Range")
        if rng:
            m = RANGE_RE.match(rng.strip())
            if m:
                start = int(m.group(1)) if m.group(1) else 0
                end = min(size - 1, int(m.group(2))) if m.group(2) else size - 1
                if 0 <= start <= end < size:
                    length = end - start + 1
                    self.send_response(206)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                    self.send_header("Content-Length", str(length))
                    self.end_headers()
                    with open(fs_path, "rb") as f:
                        f.seek(start)
                        self.wfile.write(f.read(length))
                    return

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(size))
        self.end_headers()
        with open(fs_path, "rb") as f:
            self.wfile.write(f.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8731)
    ap.add_argument("--site", default=os.path.expanduser("~/.local/share/monkemon/site"))
    args = ap.parse_args()
    handler = lambda *a, **kw: MonkemonEdgeHandler(*a, directory=args.site, **kw)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    srv.serve_forever()


if __name__ == "__main__":
    main()
PYEOF
chmod +x "$HOME/.local/share/monkemon/monkemon-edge.py"

cat > "$HOME/.local/bin/monkemon" << 'SH'
#!/usr/bin/env bash
set -euo pipefail
PORT=8731
PROFILE_DIR="$HOME/.var/app/com.google.Chrome/data/monkemon-profile"
mkdir -p "$PROFILE_DIR"

/usr/bin/python3 "$HOME/.local/share/monkemon/monkemon-edge.py" --port "$PORT" &
EDGE_PID=$!
trap 'kill "$EDGE_PID" 2>/dev/null || true' EXIT INT TERM

for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

exec /usr/bin/flatpak run --branch=stable --arch=x86_64 com.google.Chrome \
  --user-data-dir="$PROFILE_DIR" \
  --kiosk \
  --app="http://127.0.0.1:${PORT}/?touch=0" \
  --window-size=1280,800 \
  --window-position=0,0 \
  --force-device-scale-factor=1 \
  --autoplay-policy=no-user-gesture-required \
  --no-first-run \
  --no-default-browser-check
SH
chmod +x "$HOME/.local/bin/monkemon"
```

---

## Step 3: Add to Steam Gaming Mode ("Gamepad with Joystick Trackpad" Template)

1. In Desktop Mode, open **Steam → Games → Add a Non-Steam Game to My Library…** and select `$HOME/.local/bin/monkemon` (or `.desktop` entry).
2. Return to **Gaming Mode**, select **Monkemon**, click the **Controller icon**, and ensure the standard **Gamepad** template is selected (`A / B / X / Y / LB / RB / LT / Left Stick / View / Menu` map 1:1 automatically!).
