# AI Chat Assistant (Flask + Ollama)

A lightweight Flask web app that provides a chat UI backed by a local Ollama server via the OpenAI-compatible API.

## Features
- Streaming chat responses (SSE).
- Model discovery from Ollama.
- Optional text-to-speech playback for assistant replies using OpenAI `gpt-4o-mini-tts`.
- Ephemeral conversations that reset when you start a new chat or refresh the page.
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

To enable text-to-speech, set an OpenAI API key before starting the app:
```bash
export OPENAI_TTS_API_KEY=PASTE_OPENAI_API_KEY_HERE
```
Replace the placeholder with your real key when you're ready.

## Setup (Docker)
```bash
# Edit .env and replace OPENAI_TTS_API_KEY with your real key

docker build -t ai-chat-assistant .
docker run --rm -p 5001:5000 \
  --env-file .env \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  -v "$(pwd)/data:/app/data" \
  ai-chat-assistant
```
Open `http://localhost:5001`.

Or with Docker Compose:
```bash
docker compose up --build
```

## Configuration
Environment variables (all optional):
- `OLLAMA_BASE_URL` (default `http://localhost:11434`)
- `OLLAMA_MODEL` (default `gpt-oss:latest`)
- `OLLAMA_API_KEY` (default `ollama`)
- `OPENAI_TTS_API_KEY` (default placeholder `PASTE_OPENAI_API_KEY_HERE`)
- `OPENAI_TTS_MODEL` (default `gpt-4o-mini-tts`)
- `OPENAI_TTS_VOICE` (default `alloy`)
- `OPENAI_TTS_INSTRUCTIONS` (default natural/friendly speaking instructions)

## `.env` Placeholder
A project-level `.env` file is included for Docker use. Update:
- `OPENAI_TTS_API_KEY`

You can also change:
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `OPENAI_TTS_VOICE`
- `OPENAI_TTS_INSTRUCTIONS`
