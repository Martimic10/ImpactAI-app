"""
Minimal local server for GolfCourseAPI (course search / tees).
Use when full main.py won't start (e.g. Python 3.14 + mediapipe issues).

  cd backend
  python3 -m venv .venv
  .venv/bin/pip install fastapi uvicorn python-dotenv
  .venv/bin/python dev_golf_server.py

Then set EXPO_PUBLIC_BACKEND_URL=http://YOUR_MAC_IP:8000 in .env.local
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI(title="ImpactAI Golf Course Proxy (dev)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GOLF_COURSE_API_BASE = "https://api.golfcourseapi.com"


def _normalize_golf_api_key(raw: str) -> str:
    key = (raw or "").strip()
    if key.lower().startswith("key "):
        key = key[4:].strip()
    return key


GOLF_COURSE_API_KEY = _normalize_golf_api_key(os.environ.get("GOLF_COURSE_API_KEY", ""))


def _headers() -> Dict[str, str]:
    return {"Authorization": f"Key {GOLF_COURSE_API_KEY}"}


def _request(path: str, query: Optional[Dict[str, str]] = None) -> dict:
    if not GOLF_COURSE_API_KEY:
        raise HTTPException(status_code=503, detail="GOLF_COURSE_API_KEY missing in backend/.env")
    qs = f"?{urllib.parse.urlencode(query)}" if query else ""
    url = f"{GOLF_COURSE_API_BASE}{path}{qs}"
    req = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        print(f"[golf-dev] upstream {e.code}: {body}")
        if e.code == 401:
            raise HTTPException(status_code=503, detail="Golf course API key invalid")
        raise HTTPException(status_code=502, detail="Golf course API error")
    except Exception as e:
        print(f"[golf-dev] failed: {e}")
        raise HTTPException(status_code=502, detail="Golf course API unreachable")


@app.get("/health")
def health():
    return {"status": "ok", "mode": "golf-dev"}


@app.get("/golf-courses/status")
def golf_course_status():
    return {"configured": bool(GOLF_COURSE_API_KEY), "key_length": len(GOLF_COURSE_API_KEY)}


@app.get("/golf-courses/search")
def golf_course_search(search_query: str = Query(..., min_length=2)):
    data = _request("/v1/search", {"search_query": search_query})
    return {"courses": data.get("courses", [])}


@app.get("/golf-courses/{course_id}")
def golf_course_detail(course_id: int):
    return _request(f"/v1/courses/{course_id}")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    print(f"Golf dev server → http://127.0.0.1:{port}")
    print(f"Status → http://127.0.0.1:{port}/golf-courses/status")
    uvicorn.run(app, host="0.0.0.0", port=port)
