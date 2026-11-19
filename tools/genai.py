#!/usr/bin/env python3
"""Small command-line client for the public Gemini API, used by the asset scripts.

    genai.py image  --out f.png  [--model M] [--aspect 16:9] [--ref in.png ...]  "prompt"
    genai.py tts    --out f.wav  [--model M] [--voice Charon] [--style "..."]   "transcript"
    genai.py music  --out f.mp3  [--model M]                                     "prompt"
    genai.py video  --out f.mp4  [--model M] [--image first_frame.png] [--aspect 16:9] "prompt"
    genai.py text   [--model M]                                                  "prompt"   (prints to stdout)

Set GEMINI_API_KEY. Models can be overridden per call (--model) or per mode with
GENAI_<MODE>_MODEL. Audio is re-encoded with ffmpeg when the output extension differs from
what the API returns. Successful runs print "Successfully wrote <path>"; failures print
"Error: ..." to stderr and exit non-zero, so shell callers can grep either.

TTS transcripts may carry inline vocal tags such as <cough>, <sigh> or <laugh>; the
--style text describes the sustained delivery (accent, pace, emotion).
"""
import argparse
import base64
import json
import mimetypes
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave

BASE = os.environ.get("GENAI_GEMINI_BASE", "https://generativelanguage.googleapis.com/v1beta")
DEFAULTS = {
    "image": os.environ.get("GENAI_IMAGE_MODEL", "gemini-3.1-flash-lite-image"),
    "tts": os.environ.get("GENAI_TTS_MODEL", "gemini-3.8-flash-tts"),
    "music": os.environ.get("GENAI_MUSIC_MODEL", "lyria-3.5"),
    "video": os.environ.get("GENAI_VIDEO_MODEL", "gemini-omni-1.1-flash"),
    "text": os.environ.get("GENAI_TEXT_MODEL", "gemini-3.8-flash"),
}


def die(msg):
    print(f"Error: {msg}", file=sys.stderr)
    sys.exit(1)


def api_key():
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        die("set GEMINI_API_KEY")
    return key


def http(url, body=None, timeout=300, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-goog-api-key", api_key())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read()
    except urllib.error.HTTPError as e:
        die(f"HTTP {e.code}: {e.read().decode(errors='replace')[:500]}")
    except urllib.error.URLError as e:
        die(f"request failed: {e.reason}")
    return payload if raw else json.loads(payload)


# ---------------------------------------------------------------- generateContent

def generate_content(model, body, timeout):
    return http(f"{BASE}/models/{model}:generateContent", body, timeout)


def inline_parts(resp):
    for cand in resp.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            if "inlineData" in part:
                yield part["inlineData"]


# ---------------------------------------------------------------- interactions

def interact(body, timeout):
    return http(f"{BASE}/interactions", body, timeout)


def output_blocks(resp, kind):
    for step in resp.get("steps", []):
        if step.get("type") == "model_output":
            for block in step.get("content", []):
                if block.get("type") == kind:
                    yield block


def image_item(path):
    mime = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as fh:
        return {"type": "image", "mime_type": mime, "data": base64.b64encode(fh.read()).decode()}


def fetch_file(uri, timeout):
    """Waits for a Files API upload to become ACTIVE, then downloads its bytes."""
    name = uri.split("/v1beta/")[-1].split("?")[0] if "/v1beta/" in uri else uri
    deadline = time.time() + timeout
    while True:
        info = http(f"{BASE}/{name}", timeout=60)
        state = info.get("state")
        if state == "ACTIVE":
            break
        if state == "FAILED" or time.time() > deadline:
            die(f"file {name} is {state or 'not ready'}")
        time.sleep(5)
    return http(info.get("downloadUri") or f"{BASE}/{name}:download?alt=media", timeout=timeout, raw=True)


def block_bytes(block, timeout):
    if block.get("data"):
        return base64.b64decode(block["data"])
    if block.get("uri"):
        return fetch_file(block["uri"], timeout)
    die("output block has no data")


# ---------------------------------------------------------------- helpers

def convert(src, dst):
    """Moves src to dst, re-encoding with ffmpeg when the extensions differ."""
    if os.path.splitext(src)[1].lower() == os.path.splitext(dst)[1].lower():
        os.replace(src, dst)
        return
    res = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, dst], capture_output=True, text=True)
    os.unlink(src)
    if res.returncode != 0:
        die(f"ffmpeg: {res.stderr.strip()}")


def write_tmp(data, ext):
    fd, path = tempfile.mkstemp(suffix=ext)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    return path


# ---------------------------------------------------------------- modes

def cmd_image(a):
    items = [image_item(p) for p in a.ref]
    fmt = {"type": "image", "mime_type": "image/png"}
    if a.aspect:
        fmt["aspect_ratio"] = a.aspect
    body = {"model": a.model, "input": items + [{"type": "text", "text": a.prompt}] if items else a.prompt,
            "response_format": fmt}
    for block in output_blocks(interact(body, a.timeout), "image"):
        ext = mimetypes.guess_extension(block.get("mime_type", "image/png")) or ".png"
        convert(write_tmp(block_bytes(block, a.timeout), ext), a.out)
        return
    die("no image in response")


def cmd_tts(a):
    part = {"text": " ".join(a.prompt.split())}
    if a.style.strip():
        part["speech_metadata"] = {"style": a.style.strip()}
    body = {
        "contents": [{"role": "user", "parts": [part]}],
        "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"voice": a.voice}}},
    }
    for blob in inline_parts(generate_content(a.model, body, a.timeout)):
        data = base64.b64decode(blob["data"])
        if data[:4] != b"RIFF":  # raw 16-bit mono PCM: add a WAV header
            fd, tmp = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            with wave.open(tmp, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(24000)
                w.writeframes(data)
        else:
            tmp = write_tmp(data, ".wav")
        convert(tmp, a.out)
        return
    die("no audio in response")


def cmd_music(a):
    body = {"contents": [{"role": "user", "parts": [{"text": a.prompt}]}],
            "generationConfig": {"responseModalities": ["AUDIO", "TEXT"]}}
    for blob in inline_parts(generate_content(a.model, body, a.timeout)):
        mime = blob.get("mimeType", "audio/mpeg")
        if mime.startswith("audio/"):
            ext = ".wav" if "wav" in mime else ".mp3"
            convert(write_tmp(base64.b64decode(blob["data"]), ext), a.out)
            return
    die("no audio in response")


def cmd_video(a):
    fmt = {"type": "video"}
    if a.aspect:
        fmt["aspect_ratio"] = a.aspect
    body = {"model": a.model, "response_format": fmt}
    if a.image:
        body["input"] = [image_item(a.image), {"type": "text", "text": a.prompt}]
        body["generation_config"] = {"video_config": {"task": "image_to_video"}}
    else:
        body["input"] = a.prompt
    for block in output_blocks(interact(body, a.timeout), "video"):
        with open(a.out, "wb") as fh:
            fh.write(block_bytes(block, a.timeout))
        return
    die("no video in response")


def cmd_text(a):
    resp = generate_content(a.model, {"contents": [{"role": "user", "parts": [{"text": a.prompt}]}]}, a.timeout)
    out = "".join(p.get("text", "") for c in resp.get("candidates", []) for p in c.get("content", {}).get("parts", []))
    if not out:
        die("no text in response")
    sys.stdout.write(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)
    for mode in ("image", "tts", "music", "video", "text"):
        p = sub.add_parser(mode)
        p.add_argument("prompt", nargs="?", help="prompt text (read from stdin when omitted)")
        p.add_argument("--model", default=DEFAULTS[mode])
        p.add_argument("--timeout", type=int, default=600)
        if mode != "text":
            p.add_argument("--out", required=True)
    sub.choices["image"].add_argument("--aspect")
    sub.choices["image"].add_argument("--ref", action="append", default=[], help="reference image (repeatable)")
    sub.choices["tts"].add_argument("--voice", default="Charon")
    sub.choices["tts"].add_argument("--style", default="")
    sub.choices["video"].add_argument("--image", help="first frame for image-to-video")
    sub.choices["video"].add_argument("--aspect", choices=["16:9", "9:16"])
    a = ap.parse_args()
    if a.prompt is None:
        a.prompt = sys.stdin.read()
    if not a.prompt.strip():
        die("empty prompt")
    if getattr(a, "out", None):
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    {"image": cmd_image, "tts": cmd_tts, "music": cmd_music, "video": cmd_video, "text": cmd_text}[a.mode](a)
    if getattr(a, "out", None):
        print(f"Successfully wrote {a.out}")


if __name__ == "__main__":
    main()
