"""GolfCourseAPI proxy routes — registered on the main FastAPI app."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Optional

from fastapi import APIRouter, FastAPI, HTTPException, Query

GOLF_COURSE_API_BASE = "https://api.golfcourseapi.com"

router = APIRouter(prefix="/golf-courses", tags=["golf-courses"])


def _normalize_golf_api_key(raw: str) -> str:
    key = (raw or "").strip()
    if key.lower().startswith("key "):
        key = key[4:].strip()
    return key


def _api_key() -> str:
    return _normalize_golf_api_key(os.environ.get("GOLF_COURSE_API_KEY", ""))


def _headers() -> Dict[str, str]:
    return {"Authorization": f"Key {_api_key()}"}


def _request(path: str, query: Optional[Dict[str, str]] = None) -> dict:
    api_key = _api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="Golf course API key not configured")
    qs = f"?{urllib.parse.urlencode(query)}" if query else ""
    url = f"{GOLF_COURSE_API_BASE}{path}{qs}"
    req = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        print(f"[golf-course] upstream {e.code}: {body}")
        if e.code == 401:
            raise HTTPException(status_code=503, detail="Golf course API key invalid")
        if e.code == 404:
            raise HTTPException(status_code=404, detail="Course not found")
        raise HTTPException(status_code=502, detail="Golf course API error")
    except Exception as e:
        print(f"[golf-course] request failed: {e}")
        raise HTTPException(status_code=502, detail="Golf course API unreachable")


@router.get("/status")
def golf_course_status():
    key = _api_key()
    return {"configured": bool(key), "key_length": len(key)}


@router.get("/search")
def golf_course_search(search_query: str = Query(..., min_length=2)):
    data = _request("/v1/search", {"search_query": search_query})
    return {"courses": data.get("courses", [])}


@router.get("/{course_id}")
def golf_course_detail(course_id: int):
    return _request(f"/v1/courses/{course_id}")


def register_golf_routes(app: FastAPI) -> None:
    app.include_router(router)
