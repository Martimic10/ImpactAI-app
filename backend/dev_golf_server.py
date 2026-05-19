"""
Golf-only dev server (no frame extraction). Prefer main.py for full backend.

  cd backend
  .venv/bin/pip install -r requirements.txt
  .venv/bin/python dev_golf_server.py
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from golf_api import register_golf_routes

load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI(title="ImpactAI Golf Course Proxy (dev)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

register_golf_routes(app)


@app.get("/health")
def health():
    return {"status": "ok", "mode": "golf-dev"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    print(f"Golf dev server → http://127.0.0.1:{port}")
    print(f"Status → http://127.0.0.1:{port}/golf-courses/status")
    uvicorn.run(app, host="0.0.0.0", port=port)
