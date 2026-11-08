# Steam Deck Agent Deployment Runbook — Monkemon 2.5D (Auto-Update from GitHub on Startup)

> [!IMPORTANT]
> **Instructions for the Coding Agent on the Steam Deck:**
> Run every step below as the standard `deck` user (`$HOME` = `/home/deck`).
> - **Do NOT use `sudo` or `steamos-readonly disable`**. Everything installs cleanly in user-space (`~/.local/share/monkemon`, `~/.local/bin`, `~/.var/app`, `~/.local/share/Steam`) and survives SteamOS system updates.
> - Execute the steps in order (`Step 1` → `Step 5`). Do not skip `Step 5` verification.

---

## Architecture Overview

1. **Startup GitHub Auto-Update (`~/.local/share/monkemon/bin/bootstrap.sh`)**:
   - Every time you launch **Monkemon** in Steam Gaming Mode (or run `~/.local/bin/monkemon`), `bootstrap.sh` strips Steam Runtime's `LD_LIBRARY_PATH` / `LD_PRELOAD` and runs a bounded `git fetch --depth 1 origin main` against `github.com/jgunaratne/monkemon`:
     - **New commits on GitHub**: Atomically fast-forwards/resets `~/.local/share/monkemon/repo` to `FETCH_HEAD`, purges Chrome's HTTP/JS bytecode cache (`Default/Cache`, `Default/Code Cache`) so updated ES modules, shaders, `.glb` models, and `.mp3` tracks load immediately, **while keeping `Default/Local Storage` save data 100% intact**.
     - **Already up to date**: Boots straight into the game in `~0.4s` on Wi-Fi.
     - **Offline / airplane mode / slow hotel Wi-Fi**: Times out cleanly in `≤8s` and boots the installed build from the local NVMe SSD.
   - Launcher scripts (`bin/`) and the Node.js runtime (`node/`) live **outside** the Git working tree (`repo/`), so `git reset --hard FETCH_HEAD` never collides with running scripts.
2. **Local Zero-Dependency Game Server (`server.mjs` on `127.0.0.1:8731`)**:
   - Runs via a user-space Node.js `v22` LTS binary (`~/.local/share/monkemon/node/bin/node`) to serve ES modules, vendored Three.js `0.170.0`, all PBR `.glb` 3D models, `206 Partial Content` byte-range `.mp3` music/voice/SFX, `/api/health`, `/api/forged_species`, and `/ws` real-time WebSocket multiplayer.
   - Automatically stopped via `trap` as soon as you quit via **STEAM button → Exit Game** (zero idle CPU/RAM drain).
3. **Native `1280×800` Kiosk Display, Hardware WebGL & Steam Input Gamepad**:
   - Launches Google Chrome Flatpak (`com.google.Chrome`) at native `1280×800` (`?touch=0` hides mobile touch controls; Three.js auto-selects the Steam Deck `medium` graphics tier at `60 FPS`, overridable via `MONKEMON_GFX`).
   - `flatpak --user override --filesystem=/run/udev:ro com.google.Chrome` exposes Steam Input's emulated controller to `navigator.getGamepads()` in Gaming Mode.
4. **Steam Gaming Mode Home Screen Integration**:
   - Renders all 5 custom Steam Grid artworks (`920×430`, `600×900`, `1920×620`, `1280×720` logo, `256×256` icon) from Monkemon's own fonts and concept art, and registers the shortcut in binary `shortcuts.vdf` (`LastPlayTime = now`, `"Favorite"`) so **Monkemon** appears immediately in **Slot #1 on the Gaming Mode Home screen**.

---

## Step 1: Configure Passwordless GitHub Access & Shallow-Clone `jgunaratne/monkemon`

`github.com/jgunaratne/monkemon` is a **private** GitHub repository, and Steam Gaming Mode launches have **no interactive terminal** (`GIT_TERMINAL_PROMPT=0`, `BatchMode=yes`). Passwordless read access must work non-interactively so startup auto-updates succeed silently.

### 1A. Probe existing non-interactive GitHub access

Run this check first:

```bash
set -euo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

mkdir -p "$HOME/.local/share/monkemon" "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

DEPLOY_KEY="$HOME/.ssh/monkemon_deploy_key"
AUTH_OK=0
CLONE_URL=""

if [ -f "$DEPLOY_KEY" ] && GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8" git ls-remote git@github.com:jgunaratne/monkemon.git HEAD >/dev/null 2>&1; then
  AUTH_OK=1
  CLONE_URL="git@github.com:jgunaratne/monkemon.git"
  echo "OK: Read-only deploy key ($DEPLOY_KEY) verified."
elif GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8" git ls-remote git@github.com:jgunaratne/monkemon.git HEAD >/dev/null 2>&1; then
  AUTH_OK=1
  CLONE_URL="git@github.com:jgunaratne/monkemon.git"
  echo "OK: Existing SSH key verified for git@github.com:jgunaratne/monkemon.git."
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh auth setup-git
  if GIT_TERMINAL_PROMPT=0 git ls-remote https://github.com/jgunaratne/monkemon.git HEAD >/dev/null 2>&1; then
    AUTH_OK=1
    CLONE_URL="https://github.com/jgunaratne/monkemon.git"
    echo "OK: GitHub CLI (gh) HTTPS credentials verified."
  fi
elif GIT_TERMINAL_PROMPT=0 git ls-remote https://github.com/jgunaratne/monkemon.git HEAD >/dev/null 2>&1; then
  AUTH_OK=1
  CLONE_URL="https://github.com/jgunaratne/monkemon.git"
  echo "OK: Existing HTTPS git credentials verified."
fi

echo "AUTH_OK=$AUTH_OK CLONE_URL=$CLONE_URL"
```

### 1B. If `AUTH_OK=0`: Generate a dedicated read-only GitHub Deploy Key

> [!NOTE]
> **Agent instruction:** Only run `1B` if `1A` printed `AUTH_OK=0`. Generate the passphrase-less deploy key below, show the printed public key to the user, ask them to add it at `https://github.com/jgunaratne/monkemon/settings/keys` (**Title:** `Steam Deck Monkemon`, **Allow write access:** unchecked / read-only), and wait for them to confirm before running `1C`.

```bash
unset LD_LIBRARY_PATH LD_PRELOAD
DEPLOY_KEY="$HOME/.ssh/monkemon_deploy_key"

if [ ! -f "$DEPLOY_KEY" ]; then
  ssh-keygen -t ed25519 -N "" -C "steamdeck-monkemon-readonly" -f "$DEPLOY_KEY"
fi
chmod 600 "$DEPLOY_KEY"
chmod 644 "${DEPLOY_KEY}.pub"

echo ""
echo "========================================================================"
echo "Add this READ-ONLY Deploy Key at:"
echo "  https://github.com/jgunaratne/monkemon/settings/keys"
echo "  (Leave 'Allow write access' UNCHECKED)"
echo "------------------------------------------------------------------------"
cat "${DEPLOY_KEY}.pub"
echo "========================================================================"
```

Once added on GitHub, verify non-interactive access:

```bash
GIT_SSH_COMMAND="ssh -i $HOME/.ssh/monkemon_deploy_key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
  git ls-remote git@github.com:jgunaratne/monkemon.git HEAD
```

### 1C. Shallow-clone (or update) `monkemon` into `~/.local/share/monkemon/repo`

We use `--depth 1 --single-branch` so the Steam Deck downloads only the live head (~780 MB of 3D `.glb` models, PBR textures, music, voices, and ES modules) instead of full binary git history:

```bash
set -euo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

ROOT="$HOME/.local/share/monkemon"
REPO="$ROOT/repo"
DEPLOY_KEY="$HOME/.ssh/monkemon_deploy_key"
mkdir -p "$ROOT"

if [ -f "$DEPLOY_KEY" ]; then
  export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
  REMOTE_URL="git@github.com:jgunaratne/monkemon.git"
elif GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8" git ls-remote git@github.com:jgunaratne/monkemon.git HEAD >/dev/null 2>&1; then
  export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
  REMOTE_URL="git@github.com:jgunaratne/monkemon.git"
else
  export GIT_TERMINAL_PROMPT=0
  REMOTE_URL="https://github.com/jgunaratne/monkemon.git"
fi

if [ -d "$REPO/.git" ]; then
  git -C "$REPO" remote set-url origin "$REMOTE_URL"
  git -C "$REPO" fetch --depth 1 --prune origin main
  git -C "$REPO" reset --hard FETCH_HEAD
else
  rm -rf "$REPO"
  git clone --branch main --single-branch --depth 1 "$REMOTE_URL" "$REPO"
fi

# Keep shallow updates compact over time
git -C "$REPO" config gc.reflogExpire 2.days
git -C "$REPO" config gc.reflogExpireUnreachable 2.days
git -C "$REPO" config gc.auto 256

echo "Checked out Monkemon @ $(git -C "$REPO" rev-parse --short HEAD): $(git -C "$REPO" log -1 --format=%s)"
```

---

## Step 2: Install User-Space Node.js `v22` Runtime & Google Chrome Flatpak (`udev` Gamepad Enabled)

```bash
set -euo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

ROOT="$HOME/.local/share/monkemon"
NODE_DIR="$ROOT/node"
NODE_CHANNEL="latest-v22.x"
mkdir -p "$ROOT"

# 1. User-space Node.js v22 LTS (SHA-256 verified from nodejs.org)
if [ -x "$NODE_DIR/bin/node" ] && "$NODE_DIR/bin/node" --version >/dev/null 2>&1; then
  echo "Node.js already installed: $("$NODE_DIR/bin/node" --version)"
else
  case "$(uname -m)" in
    x86_64) ARCH="x64" ;;
    aarch64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
  esac
  BASE_URL="https://nodejs.org/dist/$NODE_CHANNEL"
  SUMS="$(curl -fsSL --retry 3 "$BASE_URL/SHASUMS256.txt")"
  TARBALL="$(printf '%s\n' "$SUMS" | grep -oE "node-v[0-9.]+-linux-${ARCH}\.tar\.xz" | head -n 1)"
  [ -n "$TARBALL" ] || { echo "Failed to resolve Node.js tarball from $BASE_URL" >&2; exit 1; }

  TMP_DIR="$(mktemp -d)"
  curl -fL --retry 3 -o "$TMP_DIR/$TARBALL" "$BASE_URL/$TARBALL"
  (cd "$TMP_DIR" && printf '%s\n' "$SUMS" | grep " ${TARBALL}\$" | sha256sum -c --quiet -)
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xJf "$TMP_DIR/$TARBALL" -C "$NODE_DIR" --strip-components=1
  rm -rf "$TMP_DIR"
  echo "Installed Node.js $("$NODE_DIR/bin/node" --version) to $NODE_DIR"
fi

# 2. Google Chrome Flatpak (user scope) + Steam Deck controller udev permission
if ! flatpak info com.google.Chrome >/dev/null 2>&1; then
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  flatpak install --user -y --noninteractive flathub com.google.Chrome
fi

# Mandatory so HTML5 navigator.getGamepads() detects Steam Input's controller inside Gaming Mode
flatpak --user override --filesystem=/run/udev:ro com.google.Chrome
echo "Chrome Flatpak + /run/udev:ro gamepad access configured."
```

---

## Step 3: Install Startup GitHub Auto-Updater (`bootstrap.sh`), Kiosk Launcher (`launch.sh`), and `.desktop` Entry

```bash
set -euo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

ROOT="$HOME/.local/share/monkemon"
BIN_DIR="$ROOT/bin"
LOG_DIR="$ROOT/logs"
mkdir -p \
  "$BIN_DIR" \
  "$LOG_DIR" \
  "$HOME/.local/bin" \
  "$HOME/.local/share/applications" \
  "$HOME/.local/share/icons/hicolor/256x256/apps"

cat > "$BIN_DIR/bootstrap.sh" << 'EOF'
#!/usr/bin/env bash
# Monkemon — Steam Deck startup auto-updater + launcher entrypoint.
# Every launch:
#   1. Checks github.com/jgunaratne/monkemon for new commits on $MONKEMON_BRANCH (default: main).
#   2. If new code/assets exist, resets $REPO to FETCH_HEAD and clears Chrome's HTTP/bytecode cache
#      while strictly preserving Local Storage save games.
#   3. If offline or slow Wi-Fi, skips within $MONKEMON_FETCH_TIMEOUT seconds and boots offline.
#   4. Executes launch.sh (local Node server.mjs + 1280x800 Chrome Kiosk).
set -uo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

ROOT="${MONKEMON_HOME:-$HOME/.local/share/monkemon}"
REPO="${MONKEMON_REPO:-$ROOT/repo}"
LOGS="$ROOT/logs"
BRANCH="${MONKEMON_BRANCH:-main}"
SSH_KEY="${MONKEMON_SSH_KEY:-$HOME/.ssh/monkemon_deploy_key}"
FETCH_TIMEOUT="${MONKEMON_FETCH_TIMEOUT:-12}"
PROFILE_DIR="$HOME/.var/app/com.google.Chrome/data/monkemon-profile"

mkdir -p "$LOGS"
LOG="$LOGS/update.log"
log() { printf '%s [monkemon-update] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG" >&2; }

export GIT_TERMINAL_PROMPT=0
GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new"
if [ -f "$SSH_KEY" ]; then
  GIT_SSH_COMMAND="$GIT_SSH_COMMAND -i $SSH_KEY -o IdentitiesOnly=yes"
fi
export GIT_SSH_COMMAND

if [ -n "${MONKEMON_REMOTE:-}" ]; then
  REMOTE="$MONKEMON_REMOTE"
elif [ -f "$SSH_KEY" ]; then
  REMOTE="git@github.com:jgunaratne/monkemon.git"
else
  REMOTE="$(git -C "$REPO" remote get-url origin 2>/dev/null || echo 'https://github.com/jgunaratne/monkemon.git')"
fi

current_sha() { git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo "none"; }

purge_http_cache_keep_saves() {
  # Clear only HTTP & JS bytecode caches so updated modules/assets load immediately;
  # NEVER touch "$PROFILE_DIR/Default/Local Storage" or IndexedDB where game saves live.
  rm -rf \
    "$PROFILE_DIR/Default/Cache" \
    "$PROFILE_DIR/Default/Code Cache" \
    "$PROFILE_DIR/Default/GPUCache" 2>/dev/null || true
}

update_repo() {
  if [ ! -d "$REPO/.git" ]; then
    log "ERROR: $REPO is missing .git — run Step 1C in STEAMDECK_SETUP.md"
    return 1
  fi
  if [ "$(git -C "$REPO" remote get-url origin 2>/dev/null)" != "$REMOTE" ]; then
    git -C "$REPO" remote set-url origin "$REMOTE" 2>/dev/null || git -C "$REPO" remote add origin "$REMOTE"
  fi

  local before after
  before="$(current_sha)"

  if ! timeout "$FETCH_TIMEOUT" git -C "$REPO" \
    -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=5 \
    fetch --depth 1 --prune --quiet origin "$BRANCH" >>"$LOG" 2>&1; then
    log "GitHub unreachable or timed out (${FETCH_TIMEOUT}s) — booting local SSD build $before"
    return 0
  fi

  if [ "$(git -C "$REPO" rev-parse HEAD)" = "$(git -C "$REPO" rev-parse FETCH_HEAD)" ]; then
    log "Up to date ($before)"
    return 0
  fi

  if ! git -C "$REPO" reset --hard --quiet FETCH_HEAD >>"$LOG" 2>&1; then
    log "ERROR: git reset failed — booting previous build $before"
    return 1
  fi

  purge_http_cache_keep_saves
  git -C "$REPO" gc --auto --quiet >>"$LOG" 2>&1 || true
  after="$(current_sha)"
  log "UPDATED $before -> $after: $(git -C "$REPO" log -1 --format=%s)"
}

status() {
  local node_bin="$ROOT/node/bin/node" chrome_ver="not installed" udev="no"
  if flatpak info com.google.Chrome >/dev/null 2>&1; then
    chrome_ver="$(flatpak info com.google.Chrome 2>/dev/null | awk -F': *' '/^ *Version/ {print $2; exit}')"
    flatpak --user override --show com.google.Chrome 2>/dev/null | grep -q '/run/udev' && udev="yes"
  fi
  echo "Monkemon Steam Deck Status"
  echo "  repo:     $REPO @ $(current_sha) ($BRANCH) — $(git -C "$REPO" log -1 --format=%s 2>/dev/null || echo '?')"
  echo "  remote:   $REMOTE"
  echo "  node:     $([ -x "$node_bin" ] && "$node_bin" --version || echo missing) ($node_bin)"
  echo "  chrome:   com.google.Chrome $chrome_ver (udev gamepad access: $udev)"
  echo "  launcher: $HOME/.local/bin/monkemon -> $(readlink -f "$HOME/.local/bin/monkemon" 2>/dev/null || echo missing)"
  echo "  saves:    $PROFILE_DIR/Default/Local Storage"
  echo "  logs:     $LOGS"
  [ -f "$LOG" ] && { echo "  recent updates:"; tail -n 5 "$LOG" | sed 's/^/    /'; }
}

case "${1:-}" in
  --status) status; exit 0 ;;
  --update-only) update_repo; exit $? ;;
  --no-update) shift ;;
  ''|--*) update_repo || true ;;
esac

exec bash "$ROOT/bin/launch.sh" "$@"
EOF

cat > "$BIN_DIR/launch.sh" << 'EOF'
#!/usr/bin/env bash
# Monkemon — Local Node server.mjs + 1280x800 Google Chrome Kiosk launcher.
set -uo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

ROOT="${MONKEMON_HOME:-$HOME/.local/share/monkemon}"
REPO="${MONKEMON_REPO:-$ROOT/repo}"
LOGS="$ROOT/logs"
PORT="${MONKEMON_PORT:-8731}"
BROWSER="${MONKEMON_BROWSER:-chrome}"
PIDFILE="$ROOT/server.pid"
NODE_BIN="$ROOT/node/bin/node"

mkdir -p "$LOGS"
log() { printf '%s [monkemon-launch] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOGS/launcher.log" >&2; }
healthy() { curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; }

if [ ! -x "$NODE_BIN" ]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  else
    log "ERROR: Node.js binary missing at $NODE_BIN"
    exit 1
  fi
fi

# Always stop any leftover server.mjs so newly pulled server/game code takes effect immediately
if [ -f "$PIDFILE" ]; then
  OLD_PID="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    for _ in $(seq 1 15); do kill -0 "$OLD_PID" 2>/dev/null || break; sleep 0.1; done
  fi
  rm -f "$PIDFILE"
fi

SERVER_PID=""
if healthy; then
  log "Reusing active Monkemon server on 127.0.0.1:${PORT}"
else
  ( cd "$REPO" && HOST=127.0.0.1 PORT="$PORT" exec "$NODE_BIN" server.mjs ) >>"$LOGS/server.log" 2>&1 &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PIDFILE"
  for _ in $(seq 1 100); do
    healthy && break
    sleep 0.1
  done
  if ! healthy; then
    log "ERROR: server.mjs failed to start on 127.0.0.1:${PORT} (check $LOGS/server.log)"
    kill "$SERVER_PID" 2>/dev/null || true
    rm -f "$PIDFILE"
    exit 1
  fi
  log "Started server.mjs (PID $SERVER_PID, commit $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo '?')) on 127.0.0.1:${PORT}"
fi

APP="com.google.Chrome"
[ "$BROWSER" = "chromium" ] && APP="org.chromium.Chromium"
PROFILE_DIR="$HOME/.var/app/$APP/data/monkemon-profile"
mkdir -p "$PROFILE_DIR"

# Remove stale singleton locks if the Deck lost power mid-session
rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonCookie" "$PROFILE_DIR/SingletonSocket"

cleanup() {
  pkill -f -- "--user-data-dir=$PROFILE_DIR" 2>/dev/null || true
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
}
trap cleanup EXIT INT TERM HUP

QUERY="touch=0${MONKEMON_GFX:+&gfx=$MONKEMON_GFX}${MONKEMON_QUERY:+&$MONKEMON_QUERY}"
URL="http://127.0.0.1:${PORT}/?${QUERY}"

if [ "$BROWSER" = "none" ]; then
  log "Server-only mode ready at $URL"
  if [ -n "$SERVER_PID" ]; then wait "$SERVER_PID"; else sleep infinity; fi
  exit 0
fi

CHROME_FLAGS=(
  --user-data-dir="$PROFILE_DIR"
  --no-first-run
  --no-default-browser-check
  --password-store=basic
  --disable-session-crashed-bubble
  --hide-crash-restore-bubble
  --disable-infobars
  --disable-background-networking
  --disable-component-update
  --disable-features=TranslateUI
  --enable-gpu-rasterization
  --enable-zero-copy
  --ignore-gpu-blocklist
  --autoplay-policy=no-user-gesture-required
  --window-size=1280,800
  --window-position=0,0
  --force-device-scale-factor=1
  --kiosk
  --app="$URL"
)

log "Launching $APP -> $URL"
/usr/bin/flatpak run --branch=stable --arch=x86_64 "$APP" "${CHROME_FLAGS[@]}" "$@" >>"$LOGS/chrome.log" 2>&1 &
CHROME_PID=$!
wait "$CHROME_PID"
EOF

chmod +x "$BIN_DIR/bootstrap.sh" "$BIN_DIR/launch.sh"
ln -sfn "$BIN_DIR/bootstrap.sh" "$HOME/.local/bin/monkemon"

cat > "$HOME/.local/share/applications/monkemon.desktop" << EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Monkemon
Comment=Monkemon 2.5D Toy-Diorama RPG (Auto-updates from GitHub on startup)
Exec="$HOME/.local/bin/monkemon"
Path=$HOME/.local/bin
Icon=$HOME/.local/share/icons/hicolor/256x256/apps/monkemon.png
Terminal=false
Categories=Game;RolePlaying;
StartupNotify=false
EOF

chmod +x "$HOME/.local/share/applications/monkemon.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
```

---

## Step 4: Render Custom Steam Deck Grid Artwork & Register in `shortcuts.vdf` (Gaming Mode Home Slot #1)

### 4A. Render all 5 Steam Grid artworks (`920×430`, `600×900`, `1920×620`, `1280×720` transparent logo, `256×256` icon)

This spins up `server.mjs` briefly on an ephemeral port (`18739`) and uses Headless Chrome to composite Monkemon's actual local fonts (`LuckiestGuy-Regular.ttf`, `Fredoka-Variable.ttf`) and high-res 3D concept renders:

```bash
set -euo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

ROOT="$HOME/.local/share/monkemon"
REPO="$ROOT/repo"
NODE_BIN="$ROOT/node/bin/node"
ART_DIR="$HOME/.var/app/com.google.Chrome/cache/monkemon-art"
rm -rf "$ART_DIR"
mkdir -p "$ART_DIR"

( cd "$REPO" && HOST=127.0.0.1 PORT=18739 exec "$NODE_BIN" server.mjs ) >/dev/null 2>&1 &
ART_SRV_PID=$!
trap 'kill "$ART_SRV_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  curl -fsS http://127.0.0.1:18739/api/health >/dev/null 2>&1 && break
  sleep 0.1
done

python3 - "$ART_DIR" << 'PYEOF'
import os
import subprocess
import sys

art_dir = sys.argv[1]
base = "http://127.0.0.1:18739"

CSS = f"""
@font-face {{
  font-family: 'LuckiestGuy';
  src: url('{base}/assets/fonts/LuckiestGuy-Regular.ttf') format('truetype');
}}
@font-face {{
  font-family: 'Fredoka';
  src: url('{base}/assets/fonts/Fredoka-Variable.ttf') format('truetype');
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: 100%; height: 100%; overflow: hidden; font-family: 'Fredoka', sans-serif; background: #0c2340; }}
.title {{
  font-family: 'LuckiestGuy', cursive;
  color: #ffd84d;
  letter-spacing: 0.04em;
  line-height: 0.94;
  text-shadow:
    0 4px 0 #8c3b00,
    0 8px 0 #231409,
    0 12px 26px rgba(0,0,0,0.82);
}}
.pill {{
  display: inline-block;
  padding: 6px 16px;
  border-radius: 999px;
  background: rgba(12, 28, 52, 0.84);
  border: 2px solid rgba(255, 216, 77, 0.72);
  color: #fff6d6;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  box-shadow: 0 6px 18px rgba(0,0,0,0.55);
}}
"""

PAGES = {
    "wide": (920, 430, False, f"""<!DOCTYPE html><html><head><style>{CSS}
      body {{
        position: relative;
        background: radial-gradient(circle at 50% 24%, #38b6ff 0%, #1565c0 48%, #091e3a 100%);
        display: flex; align-items: flex-end; justify-content: space-between; padding: 30px 38px;
      }}
      .house {{ position: absolute; right: -20px; top: -24px; width: 470px; height: 470px; background: url('{base}/assets/models/concepts/alex_house.concept.png') center / contain no-repeat; opacity: 0.34; filter: blur(1px); }}
      .cast {{ position: absolute; right: 20px; bottom: -14px; display: flex; align-items: flex-end; gap: 0px; z-index: 2; }}
      .c1 {{ width: 210px; height: 210px; background: url('{base}/assets/models/concepts/duckaque.concept.png') center / contain no-repeat; margin-right: -36px; filter: drop-shadow(0 10px 18px rgba(0,0,0,0.6)); }}
      .c2 {{ width: 270px; height: 270px; background: url('{base}/assets/models/concepts/mugchimp.concept.png') center / contain no-repeat; z-index: 3; filter: drop-shadow(0 14px 24px rgba(0,0,0,0.7)); }}
      .c3 {{ width: 195px; height: 195px; background: url('{base}/assets/models/concepts/mooboon.concept.png') center / contain no-repeat; margin-left: -34px; filter: drop-shadow(0 10px 18px rgba(0,0,0,0.6)); }}
      .shade {{ position: absolute; inset: 0; background: linear-gradient(95deg, rgba(7,20,40,0.92) 0%, rgba(7,20,40,0.62) 48%, rgba(7,20,40,0.12) 100%); z-index: 1; }}
      .copy {{ position: relative; z-index: 4; display: flex; flex-direction: column; align-items: flex-start; gap: 14px; max-width: 500px; }}
      .ball {{ width: 64px; height: 64px; background: url('{base}/assets/models/concepts/monkeball.concept.png') center / contain no-repeat; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.6)); }}
      .title {{ font-size: 76px; }}
      .pill {{ font-size: 12px; }}
    </style></head><body>
      <div class="house"></div><div class="shade"></div>
      <div class="copy">
        <div class="ball"></div>
        <div class="title">MONKEMON</div>
        <div class="pill">2.5D Toy-Diorama Archipelago RPG</div>
      </div>
      <div class="cast"><div class="c1"></div><div class="c2"></div><div class="c3"></div></div>
    </body></html>"""),

    "portrait": (600, 900, False, f"""<!DOCTYPE html><html><head><style>{CSS}
      body {{
        position: relative;
        background: radial-gradient(circle at 50% 35%, #49c6ff 0%, #1769aa 46%, #08182f 100%);
        display: flex; flex-direction: column; align-items: center; justify-content: space-between;
        padding: 48px 28px 42px; border: 3px solid rgba(255,216,77,0.55);
      }}
      .boss {{ position: absolute; top: 120px; left: 50%; transform: translateX(-50%); width: 520px; height: 520px; background: url('{base}/assets/models/concepts/monkezilla.concept.png') center / contain no-repeat; opacity: 0.25; }}
      .hero {{ position: absolute; bottom: 96px; left: 50%; transform: translateX(-50%); width: 430px; height: 430px; background: url('{base}/assets/models/concepts/mugchimp.concept.png') center / contain no-repeat; z-index: 2; filter: drop-shadow(0 18px 28px rgba(0,0,0,0.75)); }}
      .left {{ position: absolute; bottom: 112px; left: -12px; width: 230px; height: 230px; background: url('{base}/assets/models/concepts/duckaque.concept.png') center / contain no-repeat; z-index: 1; filter: drop-shadow(0 12px 20px rgba(0,0,0,0.65)); }}
      .right {{ position: absolute; bottom: 112px; right: -12px; width: 230px; height: 230px; background: url('{base}/assets/models/concepts/chimpark.concept.png') center / contain no-repeat; z-index: 1; filter: drop-shadow(0 12px 20px rgba(0,0,0,0.65)); }}
      .vignette {{ position: absolute; inset: 0; background: linear-gradient(180deg, rgba(6,18,36,0.78) 0%, rgba(6,18,36,0.12) 45%, rgba(6,18,36,0.92) 100%); z-index: 0; }}
      .top, .bot {{ position: relative; z-index: 4; display: flex; flex-direction: column; align-items: center; gap: 12px; }}
      .ball {{ width: 74px; height: 74px; background: url('{base}/assets/models/concepts/monkeball.concept.png') center / contain no-repeat; }}
      .title {{ font-size: 82px; text-align: center; }}
      .pill {{ font-size: 13px; }}
    </style></head><body>
      <div class="vignette"></div><div class="boss"></div>
      <div class="left"></div><div class="right"></div><div class="hero"></div>
      <div class="top">
        <div class="ball"></div>
        <div class="title">MONKEMON</div>
      </div>
      <div class="bot"><div class="pill">Tame · Battle · Explore 5 Islands</div></div>
    </body></html>"""),

    "hero": (1920, 620, False, f"""<!DOCTYPE html><html><head><style>{CSS}
      body {{
        position: relative;
        background: linear-gradient(125deg, #09203f 0%, #1b6ca8 48%, #2ec4b6 100%);
      }}
      .h1 {{ position: absolute; left: 52%; top: -30px; width: 560px; height: 560px; background: url('{base}/assets/models/concepts/alex_house.concept.png') center / contain no-repeat; opacity: 0.45; }}
      .h2 {{ position: absolute; right: 4%; top: 10px; width: 500px; height: 500px; background: url('{base}/assets/models/concepts/peanut_butter_house.concept.png') center / contain no-repeat; opacity: 0.38; }}
      .m1 {{ position: absolute; right: 340px; bottom: -20px; width: 420px; height: 420px; background: url('{base}/assets/models/concepts/mugchimp.concept.png') center / contain no-repeat; z-index: 3; filter: drop-shadow(0 18px 30px rgba(0,0,0,0.72)); }}
      .m2 {{ position: absolute; right: 90px; bottom: -10px; width: 350px; height: 350px; background: url('{base}/assets/models/concepts/puppuchin.concept.png') center / contain no-repeat; z-index: 2; filter: drop-shadow(0 14px 24px rgba(0,0,0,0.65)); }}
      .m3 {{ position: absolute; right: 620px; bottom: -12px; width: 340px; height: 340px; background: url('{base}/assets/models/concepts/duckaque.concept.png') center / contain no-repeat; z-index: 2; filter: drop-shadow(0 14px 24px rgba(0,0,0,0.65)); }}
      .vignette {{ position: absolute; inset: 0; background: linear-gradient(90deg, rgba(6,16,32,0.90) 0%, rgba(6,16,32,0.28) 52%, rgba(6,16,32,0.65) 100%), linear-gradient(180deg, rgba(6,16,32,0.12) 0%, rgba(6,16,32,0.88) 100%); z-index: 1; }}
    </style></head><body>
      <div class="h1"></div><div class="h2"></div><div class="vignette"></div>
      <div class="m3"></div><div class="m1"></div><div class="m2"></div>
    </body></html>"""),

    "logo": (1280, 720, True, f"""<!DOCTYPE html><html><head><style>{CSS}
      html, body {{ background: transparent !important; display: flex; align-items: flex-end; justify-content: flex-start; padding: 0 0 54px 56px; }}
      .wrap {{ display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }}
      .row {{ display: flex; align-items: center; gap: 18px; }}
      .ball {{ width: 92px; height: 92px; background: url('{base}/assets/models/concepts/monkeball.concept.png') center / contain no-repeat; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.75)); }}
      .title {{ font-size: 112px; }}
      .pill {{ font-size: 15px; }}
    </style></head><body>
      <div class="wrap">
        <div class="row"><div class="ball"></div><div class="title">MONKEMON</div></div>
        <div class="pill">2.5D Toy-Diorama Creature-Taming RPG</div>
      </div>
    </body></html>"""),

    "icon": (256, 256, False, f"""<!DOCTYPE html><html><head><style>{CSS}
      body {{
        position: relative;
        border-radius: 36px;
        border: 5px solid #ffd84d;
        background: radial-gradient(circle at 50% 35%, #4cc9f0 0%, #1d4ed8 62%, #0b1930 100%);
        display: flex; align-items: center; justify-content: center;
      }}
      .ball {{ width: 206px; height: 206px; background: url('{base}/assets/models/concepts/monkeball.concept.png') center / contain no-repeat; filter: drop-shadow(0 10px 18px rgba(0,0,0,0.7)); }}
    </style></head><body><div class="ball"></div></body></html>"""),
}

env = {k: v for k, v in os.environ.items() if k not in ("LD_LIBRARY_PATH", "LD_PRELOAD")}

for name, (w, h, transparent, html) in PAGES.items():
    html_path = os.path.join(art_dir, f"{name}.html")
    png_path = os.path.join(art_dir, f"{name}.png")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    cmd = [
        "/usr/bin/flatpak", "run", "--command=/app/bin/chrome", "com.google.Chrome",
        "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1", "--virtual-time-budget=3000",
        f"--window-size={w},{h}",
        f"--screenshot={png_path}",
    ]
    if transparent:
        cmd.append("--default-background-color=00000000")
    cmd.append(f"file://{html_path}")
    subprocess.run(cmd, env=env, check=True)
    print(f"Rendered {png_path} ({os.path.getsize(png_path)} bytes)")
PYEOF

kill "$ART_SRV_PID" 2>/dev/null || true
trap - EXIT
cp "$ART_DIR/icon.png" "$HOME/.local/share/icons/hicolor/256x256/apps/monkemon.png"
```

### 4B. Safely update `shortcuts.vdf`, install `grid/` artwork, and reload Steam

> [!WARNING]
> Steam overwrites `shortcuts.vdf` on shutdown if edited while Steam is running. The script below inspects ancestor PIDs first so that if the coding agent is running inside a terminal nested under `gamescope-session`, it never kills its own parent session.

```bash
python3 - << 'PYEOF'
import os
import shutil
import struct
import subprocess
import time
import zlib

HOME = os.path.expanduser("~")
EXE_RAW = os.path.join(HOME, ".local/bin/monkemon")
EXE_QUOTED = f'"{EXE_RAW}"'
START_DIR_QUOTED = f'"{os.path.dirname(EXE_RAW)}"'
ICON_PATH = os.path.join(HOME, ".local/share/icons/hicolor/256x256/apps/monkemon.png")
DESKTOP_PATH = os.path.join(HOME, ".local/share/applications/monkemon.desktop")
ART_DIR = os.path.join(HOME, ".var/app/com.google.Chrome/cache/monkemon-art")
APP_NAME = "Monkemon"

APPID = (zlib.crc32((EXE_QUOTED + APP_NAME).encode("utf-8")) & 0xFFFFFFFF) | 0x80000000

BIN_MAP = 0x00
BIN_STR = 0x01
BIN_INT32 = 0x02
BIN_FLOAT32 = 0x03
BIN_PTR = 0x04
BIN_WIDESTR = 0x05
BIN_COLOR = 0x06
BIN_UINT64 = 0x07
BIN_END = 0x08
BIN_INT64 = 0x0A


def read_cstr(buf, pos):
    end = buf.index(0, pos)
    return buf[pos:end].decode("utf-8", errors="replace"), end + 1


def parse_binary_vdf(buf, pos=0):
    out = {}
    n = len(buf)
    while pos < n:
        t = buf[pos]
        pos += 1
        if t == BIN_END:
            break
        key, pos = read_cstr(buf, pos)
        if t == BIN_MAP:
            val, pos = parse_binary_vdf(buf, pos)
            out[key] = ("map", val)
        elif t == BIN_STR:
            val, pos = read_cstr(buf, pos)
            out[key] = ("str", val)
        elif t in (BIN_INT32, BIN_PTR, BIN_COLOR):
            val = struct.unpack_from("<I", buf, pos)[0]
            pos += 4
            out[key] = (t, val)
        elif t == BIN_FLOAT32:
            val = struct.unpack_from("<f", buf, pos)[0]
            pos += 4
            out[key] = (t, val)
        elif t in (BIN_UINT64, BIN_INT64):
            val = struct.unpack_from("<Q", buf, pos)[0]
            pos += 8
            out[key] = (t, val)
        elif t == BIN_WIDESTR:
            end = pos
            while end + 1 < n and not (buf[end] == 0 and buf[end + 1] == 0):
                end += 2
            val = buf[pos:end].decode("utf-16-le", errors="replace")
            pos = end + 2
            out[key] = (t, val)
        else:
            raise ValueError(f"Unsupported binary VDF tag 0x{t:02x} at byte {pos - 1}")
    return out, pos


def dump_binary_vdf(mapping):
    chunks = bytearray()
    for key, (t, val) in mapping.items():
        kbytes = key.encode("utf-8") + b"\x00"
        if t == "map":
            chunks.append(BIN_MAP)
            chunks.extend(kbytes)
            chunks.extend(dump_binary_vdf(val))
        elif t == "str":
            chunks.append(BIN_STR)
            chunks.extend(kbytes)
            chunks.extend(str(val).encode("utf-8") + b"\x00")
        elif t in ("int", BIN_INT32, BIN_PTR, BIN_COLOR):
            tag = BIN_INT32 if t == "int" else t
            chunks.append(tag)
            chunks.extend(kbytes)
            chunks.extend(struct.pack("<I", int(val) & 0xFFFFFFFF))
        elif t == BIN_FLOAT32:
            chunks.append(BIN_FLOAT32)
            chunks.extend(kbytes)
            chunks.extend(struct.pack("<f", float(val)))
        elif t in (BIN_UINT64, BIN_INT64):
            chunks.append(t)
            chunks.extend(kbytes)
            chunks.extend(struct.pack("<Q", int(val) & 0xFFFFFFFFFFFFFFFF))
        elif t == BIN_WIDESTR:
            chunks.append(BIN_WIDESTR)
            chunks.extend(kbytes)
            chunks.extend(str(val).encode("utf-16-le") + b"\x00\x00")
    chunks.append(BIN_END)
    return bytes(chunks)


def ancestor_comm_names():
    names = set()
    pid = os.getpid()
    while pid > 1:
        try:
            with open(f"/proc/{pid}/comm", "r", encoding="utf-8") as f:
                names.add(f.read().strip())
            with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as f:
                stat = f.read()
            ppid = int(stat[stat.rfind(")") + 2:].split()[1])
            if ppid == pid:
                break
            pid = ppid
        except Exception:
            break
    return names


def proc_running(name):
    return subprocess.run(["pgrep", "-x", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def wait_steam_exit(timeout=15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not proc_running("steam"):
            return True
        time.sleep(0.5)
    return not proc_running("steam")


ancestors = ancestor_comm_names()
in_gamescope_tree = any("gamescope" in a for a in ancestors)
was_gamescope_active = (
    subprocess.run(["systemctl", "--user", "is-active", "--quiet", "gamescope-session"]).returncode == 0
    or proc_running("gamescope")
)
was_desktop_steam_active = (not was_gamescope_active) and proc_running("steam")

restart_mode = "none"
if was_gamescope_active and not in_gamescope_tree:
    print("Gaming Mode active (agent on SSH/background) -> stopping gamescope-session cleanly before VDF edit...")
    subprocess.run(["systemctl", "--user", "stop", "gamescope-session"], check=False)
    wait_steam_exit(15.0)
    restart_mode = "gamescope"
elif was_desktop_steam_active:
    print("Desktop Steam active -> shutting down Steam cleanly before VDF edit...")
    subprocess.run(["steam", "-shutdown"], check=False)
    wait_steam_exit(15.0)
    restart_mode = "desktop_steam"
elif was_gamescope_active and in_gamescope_tree:
    print("Agent running inside gamescope-session -> will also invoke steamos-add-to-steam live.")
    restart_mode = "live_inside_gamescope"

userdata_roots = set()
for candidate in [
    os.path.join(HOME, ".local/share/Steam/userdata"),
    os.path.join(HOME, ".steam/steam/userdata"),
]:
    if os.path.isdir(candidate):
        userdata_roots.add(os.path.realpath(candidate))

user_dirs = []
for root in sorted(userdata_roots):
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if entry.isdigit() and int(entry) > 0 and os.path.isdir(full):
            user_dirs.append(full)

if not user_dirs:
    raise RuntimeError("No Steam userdata/<STEAM_ID3> directories found! Log into Steam once on the Deck first.")

now_ts = int(time.time())


def build_shortcut_entry(existing_map=None):
    base = dict(existing_map) if existing_map else {}
    base["appid"] = ("int", APPID)
    base["AppName"] = ("str", APP_NAME)
    base["Exe"] = ("str", EXE_QUOTED)
    base["StartDir"] = ("str", START_DIR_QUOTED)
    base["icon"] = ("str", ICON_PATH)
    base["ShortcutPath"] = ("str", "")
    base["LaunchOptions"] = ("str", "")
    base["IsHidden"] = ("int", 0)
    base["AllowDesktopConfig"] = ("int", 1)
    base["AllowOverlay"] = ("int", 1)
    base["OpenVR"] = ("int", 0)
    base["Devkit"] = ("int", 0)
    base["DevkitGameID"] = ("str", "")
    base["DevkitOverrideAppID"] = ("int", 0)
    base["LastPlayTime"] = ("int", now_ts)
    base["FlatpakAppID"] = ("str", "")
    tags = dict(base.get("tags", ("map", {}))[1])
    if not any(v[1] == "Favorite" for v in tags.values() if v[0] == "str"):
        tags[str(len(tags))] = ("str", "Favorite")
    base["tags"] = ("map", tags)
    return ("map", base)


def install_grid_art(grid_dir, target_appid):
    os.makedirs(grid_dir, exist_ok=True)
    mapping = {
        "wide.png": f"{target_appid}.png",
        "portrait.png": f"{target_appid}p.png",
        "hero.png": f"{target_appid}_hero.png",
        "logo.png": f"{target_appid}_logo.png",
        "icon.png": f"{target_appid}_icon.png",
    }
    for src_name, dst_name in mapping.items():
        src = os.path.join(ART_DIR, src_name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(grid_dir, dst_name))


for udir in user_dirs:
    cfg_dir = os.path.join(udir, "config")
    os.makedirs(cfg_dir, exist_ok=True)
    vdf_path = os.path.join(cfg_dir, "shortcuts.vdf")

    root = {}
    if os.path.isfile(vdf_path) and os.path.getsize(vdf_path) > 0:
        shutil.copy2(vdf_path, f"{vdf_path}.bak.{now_ts}")
        with open(vdf_path, "rb") as f:
            root, _ = parse_binary_vdf(f.read())

    sc_key = next((k for k in root if k.lower() == "shortcuts"), "shortcuts")
    shortcuts = dict(root.get(sc_key, ("map", {}))[1])

    matched_idx = None
    existing_appids = {APPID}
    for idx, (t, entry) in shortcuts.items():
        if t != "map":
            continue
        name_val = entry.get("AppName", entry.get("appname", ("str", "")))[1]
        exe_val = entry.get("Exe", entry.get("exe", ("str", "")))[1]
        if name_val == APP_NAME or "monkemon" in str(exe_val):
            matched_idx = idx
            if "appid" in entry:
                existing_appids.add(int(entry["appid"][1]) & 0xFFFFFFFF)
            break

    if matched_idx is not None:
        shortcuts[matched_idx] = build_shortcut_entry(shortcuts[matched_idx][1])
        print(f"[{os.path.basename(udir)}] Updated shortcut #{matched_idx} (AppID={APPID})")
    else:
        next_idx = str(max([int(k) for k in shortcuts if k.isdigit()] + [-1]) + 1)
        shortcuts[next_idx] = build_shortcut_entry()
        print(f"[{os.path.basename(udir)}] Added shortcut #{next_idx} (AppID={APPID})")

    root[sc_key] = ("map", shortcuts)
    encoded = dump_binary_vdf(root)
    _, end_pos = parse_binary_vdf(encoded)
    assert end_pos == len(encoded), "Binary VDF round-trip verification failed"

    tmp_path = f"{vdf_path}.tmp"
    with open(tmp_path, "wb") as f:
        f.write(encoded)
    os.replace(tmp_path, vdf_path)

    grid_dir = os.path.join(cfg_dir, "grid")
    for aid in existing_appids:
        install_grid_art(grid_dir, aid)
    print(f"[{os.path.basename(udir)}] Installed 5 Steam Deck grid artworks for AppID(s): {sorted(existing_appids)}")

if restart_mode == "gamescope":
    print("Restarting Gaming Mode (gamescope-session)...")
    subprocess.run(["systemctl", "--user", "start", "gamescope-session"], check=False)
elif restart_mode == "desktop_steam":
    print("Relaunching Desktop Steam in background...")
    subprocess.Popen(["steam", "-silent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
elif restart_mode == "live_inside_gamescope":
    if os.path.isfile("/usr/bin/steamos-add-to-steam"):
        subprocess.run(["/usr/bin/steamos-add-to-steam", DESKTOP_PATH], check=False)
    print("NOTE: Restart Steam once finished so Gaming Mode reloads shortcuts.vdf & custom grid art.")

print("Steam Gaming Mode registration complete!")
PYEOF
```

---

## Step 5: Post-Install Verification Checklist (Mandatory)

Run this verification block and report the output back to the user:

```bash
set -euo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

# 1. Verify status, Node runtime, Chrome Flatpak, udev gamepad override, and Git checkout
"$HOME/.local/bin/monkemon" --status

# 2. Test startup GitHub auto-update path non-interactively
"$HOME/.local/bin/monkemon" --update-only

# 3. Smoke-test local server.mjs startup, /api/health, and index.html serving
MONKEMON_BROWSER=none "$HOME/.local/bin/monkemon" --no-update >/dev/null 2>&1 &
TEST_PID=$!
sleep 1.2
curl -fsS http://127.0.0.1:8731/api/health
echo ""
curl -fsSI http://127.0.0.1:8731/ | head -n 5
kill "$TEST_PID" 2>/dev/null || true
wait "$TEST_PID" 2>/dev/null || true

# 4. Verify Steam Grid artwork files exist
ls -lh "$HOME"/.local/share/Steam/userdata/*/config/grid/* 2>/dev/null | tail -n 10 || true
```

Expected results:
- `monkemon --status` shows `(udev gamepad access: yes)` and a valid commit SHA on `main`.
- `monkemon --update-only` completes silently without prompting for a username/password/passphrase and logs `Up to date (<sha>)` (or `UPDATED ...`).
- `curl http://127.0.0.1:8731/api/health` returns `{"ok":true,"game":"monkemon",...}`.
- All 5 custom Steam Grid images (`<appid>.png`, `<appid>p.png`, `<appid>_hero.png`, `<appid>_logo.png`, `<appid>_icon.png`) are installed in `userdata/<STEAM_ID3>/config/grid/`.

---

## Steam Deck Controls & Launch Options Reference

### Controller Mapping (Out of the Box with Steam's Standard **Gamepad** Template)

| Action | Steam Deck Control |
| :--- | :--- |
| **Move (Overworld & Holo-Arena)** | **Left Stick** or **D-Pad** |
| **Talk / Heal / `[A]` Monk Run** | **`A`** (Bottom Face) |
| **Sprint / `[B]` Fake Out (Stun) / Close Menu** | **`B`** (Right Face) |
| **Toss Berry / `[X]` Eat (Heal + Attack Buff)** | **`X`** (Left Face) |
| **Aim Monkeball Timing Ring / `[Y]` Jump Slam** | **`Y`** (Top Face) |
| **Engage Battle / `[RB]` Signature Type Special** | **`RB`** or **`RT`** |
| **Quick-Throw Monkeball** | **`LB`** |
| **Switch Active Party Monkemon** | **`LT`** |
| **Tamer Menu (Overview, Save & Settings, Guide)** | **`Menu` (`≡`, Top-Right)** |
| **World Map** | **`View` (`⧉`, Top-Left)** |
| **Toggle Tilt-Shift Miniature Lens** | **`L3`** (Left Stick Click) |
| **Mute / Unmute Audio** | **`R3`** (Right Stick Click) |
| **Quit Game Cleanly (Stops Server + Kiosk)** | Physical **`STEAM`** button → **Exit Game** |

### Optional Steam Launch Options (Steam → Monkemon → Gear Icon → Properties → Launch Options)

- **Default (Auto-detects Steam Deck `medium` 60 FPS tier + GitHub update on boot)**: *(leave blank)*
- **Force higher visual preset (`high` with planar ocean reflections & 3D cloud shadows)**:
  ```text
  MONKEMON_GFX=high %command%
  ```
- **Battery-saver `mobile` preset (long flights)**:
  ```text
  MONKEMON_GFX=mobile %command%
  ```
- **Inspect status / logs from SSH or Konsole**:
  ```bash
  ~/.local/bin/monkemon --status
  tail -n 50 ~/.local/share/monkemon/logs/update.log ~/.local/share/monkemon/logs/server.log
  ```
