#!/usr/bin/env bash
# Run golf course search locally (lightweight; no mediapipe).
# Usage: cd backend && ./start.sh
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

echo "Installing golf dev dependencies..."
.venv/bin/pip install -q fastapi uvicorn python-dotenv

echo ""
echo "Starting golf dev server at http://127.0.0.1:8000"
echo "Check key: curl http://127.0.0.1:8000/golf-courses/status"
echo ""
exec .venv/bin/python dev_golf_server.py
