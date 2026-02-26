# Repository Guidelines

## Project Structure & Module Organization
- `app.py`: Flask backend, Ollama/OpenAI-compatible client, thread storage.
- `templates/`: HTML templates (entrypoint `templates/index.html`).
- `static/`: Frontend assets (`static/app.js`, `static/style.css`, icons, PWA files).
- `data/`: Persisted chat threads as JSON (`data/YYYY-MM-DD.json`).
- `Dockerfile`, `docker-compose.yml`: Containerized runtime and local orchestration.
- `requirements.txt`: Python dependencies.

## Build, Test, and Development Commands
- `python -m venv .venv && source .venv/bin/activate`: Create/activate a virtual env.
- `pip install -r requirements.txt`: Install Python dependencies.
- `python app.py`: Run the Flask app locally (default `http://localhost:5000`).
- `docker build -t ai-chat-assistant .`: Build the container image.
- `docker compose up --build`: Run the app via Docker Compose (maps `5001 -> 5000`).

## Coding Style & Naming Conventions
- Python: 4-space indentation, keep functions small and focused.
- JavaScript/CSS: 2-space indentation (match `static/app.js` and `static/style.css`).
- Use clear, descriptive names for routes and DOM elements (e.g., `threads`, `model-select`).
- No automated formatter or linter is configured; keep diffs tidy and consistent.

## Testing Guidelines
- No automated test suite is present.
- If you add tests, document how to run them and keep names descriptive (e.g., `test_chat_streaming`).

## Commit & Pull Request Guidelines
- Follow `GITFLOW.md`: branch from `main`, rebase on `main` before committing.
- Branch naming: `feat/<short-description>` (e.g., `feat/add-new-chat-button`).
- Commit messages: conventional prefixes like `feat:...`, `fix:...`, `chore:...`, `docs:...` and must describe the actual change.
- PRs: base `main`, include a clear summary and any relevant screenshots. Do not include tool attribution in commit messages or PR descriptions.

## Configuration Tips
- Environment variables:
  - `OLLAMA_BASE_URL` (default `http://localhost:11434`)
  - `OLLAMA_MODEL` (default `gpt-oss:latest`)
  - `OLLAMA_API_KEY` (default `ollama`)
- Thread data persists in `data/`; Docker Compose mounts this for durability.
