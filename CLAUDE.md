# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Local development:**
```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
python app.py                   # Runs on http://localhost:5000
```

**Docker:**
```bash
docker build -t ai-chat-assistant .
docker run --rm -p 5001:5000 \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  -e OLLAMA_MODEL=gpt-oss:latest \
  -v "$(pwd)/data:/app/data" \
  ai-chat-assistant
```

No test suite or linter is configured.

## Architecture

Single-file Flask backend (`app.py`) + vanilla JS SPA frontend.

**Backend (`app.py`):**
- Session-based auth with SQLite (`data/app.db`) for users
- Chat threads stored as JSON files (`data/YYYY-MM-DD.json`, one per date, user-scoped)
- `/chat` streams responses via Server-Sent Events (SSE)
- `/models` discovers available models from Ollama's `/api/tags` endpoint
- `/threads` handles CRUD for chat threads
- `@_auth_required` decorator protects all non-auth routes

**Frontend (`static/app.js`, ~900 lines):**
- No framework — vanilla JS with direct DOM manipulation
- Renders streaming SSE chunks in real-time
- Manages thread list, active thread state, and message history in memory
- Auth modals, model selector dropdown, and accessibility settings (font size, theme) all wired here

**External dependency:** Ollama must be running separately. The backend connects to it via the OpenAI Python client pointed at `OLLAMA_BASE_URL` (default: `http://localhost:11434`).

**Data persistence:**
- `data/app.db` — SQLite, users table only
- `data/YYYY-MM-DD.json` — all threads for that day, each thread contains id, title, user_id, created_at, messages array

**Environment variables (all optional):**
```
OLLAMA_BASE_URL    # default: http://localhost:11434
OLLAMA_MODEL       # default: gpt-oss:latest
OLLAMA_API_KEY     # default: ollama
FLASK_SECRET_KEY   # set in production for session encryption
```

## Git Conventions

- Commit prefix style: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Feature branches: `feat/<short-description>`
- Rebase-based workflow (see `GITFLOW.md`)
