# AI Chat Assistant (Flask + Ollama)

A lightweight Flask web app that provides a chat UI backed by a local Ollama server via the OpenAI-compatible API.

## Features
- Streaming chat responses (SSE).
- Model discovery from Ollama.
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
docker compose up --build
```
Open `http://localhost:5001`.

## Configuration
Environment variables (all optional):
- `OLLAMA_BASE_URL` (default `http://localhost:11434`)
- `OLLAMA_MODEL` (default `gpt-oss:latest`)
- `OLLAMA_API_KEY` (default `ollama`)

## Data Storage
Chat threads are stored under `data/` as `YYYY-MM-DD.json`.
With Docker Compose, `./data` is mounted into the container.
