#!/usr/bin/env bash
# Run local backend (golf API + frame extraction).
# Usage: cd backend && ./start.sh
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

echo "Installing dependencies..."
.venv/bin/pip install -q -r requirements.txt

echo ""
echo "Starting backend at http://127.0.0.1:8000"
echo "Health: curl http://127.0.0.1:8000/health"
echo "Golf:   curl http://127.0.0.1:8000/golf-courses/status"
echo ""
exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --reload
