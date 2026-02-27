# AI Chat Assistant (Flask + Ollama)

A lightweight Flask web app that provides a chat UI backed by a local Ollama server via the OpenAI-compatible API.

## Features
- Streaming chat responses (SSE).
- Model discovery from Ollama.
- Account creation and login (name, email, password).
- Session-aware thread history (each user only sees their own chats).
- Persistent chat threads stored as JSON.
- Simple single-page UI with PWA assets.

## Requirements
- Python 3.11+
- An Ollama server running locally (default `http://localhost:11434`).

## Setup (Local)
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```
Open `http://localhost:5000`.

## Setup (Docker)
```bash
docker build -t ai-chat-assistant .
docker run --rm -p 5001:5000 \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  -e OLLAMA_MODEL=gpt-oss:latest \
  -v "$(pwd)/data:/app/data" \
  ai-chat-assistant
```
Open `http://localhost:5001`.

## Configuration
Environment variables (all optional):
- `OLLAMA_BASE_URL` (default `http://localhost:11434`)
- `OLLAMA_MODEL` (default `gpt-oss:latest`)
- `OLLAMA_API_KEY` (default `ollama`)
- `FLASK_SECRET_KEY` (recommended in production; secures login sessions)

## Data Storage
Chat threads are stored under `data/` as `YYYY-MM-DD.json`.
Users are stored in `data/app.db` (SQLite).
With Docker, mount `./data` into the container to persist history and users.
