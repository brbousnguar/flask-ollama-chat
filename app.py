"""
Flask AI assistant using local Ollama.
"""
import json
import os
import threading
import urllib.request
import uuid

from flask import (
    Flask,
    Response,
    jsonify,
    render_template,
    request,
    send_from_directory,
    stream_with_context,
)
from openai import OpenAI

app = Flask(__name__, static_folder="static")

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

# Ollama OpenAI-compatible client
client = OpenAI(
    base_url=f"{OLLAMA_BASE}/v1",
    api_key=os.environ.get("OLLAMA_API_KEY", "ollama"),
)

DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "gpt-oss:latest")
_ACTIVE_STREAMS = {}
_ACTIVE_STREAMS_LOCK = threading.Lock()

# Optional system prompt loaded from an untracked local file
_SYSTEM_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
_SYSTEM_PROMPT = None
if os.path.isfile(_SYSTEM_PROMPT_PATH):
    with open(_SYSTEM_PROMPT_PATH, encoding="utf-8") as _f:
        _SYSTEM_PROMPT = _f.read().strip() or None


def _build_system_prompt(memory_text):
    """Compose the system prompt from the base prompt and optional user memory."""
    parts = []
    if _SYSTEM_PROMPT:
        parts.append(_SYSTEM_PROMPT)

    memory = (memory_text or "").strip()
    if memory:
        parts.append(
            "User memory:\n"
            f"{memory}\n\n"
            "Use this only as helpful background. Do not claim facts you do not know, and do not mention this memory unless it is relevant."
        )

    return "\n\n".join(parts).strip() or None

@app.route("/")
def index():
    """Serve the single-page application."""
    return render_template("index.html")


@app.route("/models", methods=["GET"])
def list_models():
    """Return list of available Ollama models (from ollama list)."""
    try:
        req = urllib.request.Request(f"{OLLAMA_BASE}/api/tags")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        models = []
        for m in data.get("models", []):
            name = m.get("name") or m.get("model") or None
            if not name:
                continue
            models.append(
                {
                    "name": name,
                    "modified_at": m.get("modified_at") or m.get("modified"),
                    "size": m.get("size"),
                    "details": m.get("details", {}),
                }
            )

        return jsonify({"models": models})
    except Exception as e:
        return jsonify({"error": str(e), "models": []}), 500


@app.route("/models/library")
def library_models():
    """Proxy Ollama.com model search to avoid CORS issues."""
    import urllib.parse
    q = request.args.get("q", "")
    try:
        params = {"sort": "featured", "limit": "100"}
        if q:
            params["q"] = q
        url = "https://ollama.com/api/tags?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; AI-Assistant/1.0)",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        return jsonify(data)
    except Exception as e:
        return jsonify({"models": [], "error": str(e)}), 200


def _register_stream(request_id, stream):
    with _ACTIVE_STREAMS_LOCK:
        _ACTIVE_STREAMS[request_id] = stream


def _unregister_stream(request_id):
    with _ACTIVE_STREAMS_LOCK:
        _ACTIVE_STREAMS.pop(request_id, None)


def _stop_stream(request_id):
    with _ACTIVE_STREAMS_LOCK:
        stream = _ACTIVE_STREAMS.pop(request_id, None)
    if stream is None:
        return False
    try:
        stream.close()
    except Exception:
        pass
    return True


def _stream_chat(messages, model, request_id):
    """Generator that streams Ollama chat completion chunks as SSE."""
    app.logger.debug("Sending %d messages to model %s; first role: %s",
                     len(messages), model, messages[0]["role"] if messages else "none")
    stream = None
    try:
        stream = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
        )
        _register_stream(request_id, stream)
        for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and getattr(delta, "content", None):
                yield f"data: {json.dumps({'content': delta.content})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
    finally:
        if stream is not None:
            try:
                stream.close()
            except Exception:
                pass
        _unregister_stream(request_id)


@app.route("/chat", methods=["POST"])
def chat():
    """Backend chat endpoint: streams assistant reply from Ollama as Server-Sent Events."""
    data = request.get_json()
    if not data or "messages" not in data:
        return jsonify({"error": "Missing 'messages' in request body"}), 400

    messages = data["messages"]
    if not isinstance(messages, list):
        return jsonify({"error": "'messages' must be a list"}), 400

    memory = data.get("memory", "")
    if memory is not None and not isinstance(memory, str):
        return jsonify({"error": "'memory' must be a string"}), 400

    system_prompt = _build_system_prompt(memory)
    if system_prompt:
        messages = [{"role": "system", "content": system_prompt}] + messages

    model = (data.get("model") or "").strip() or DEFAULT_MODEL
    request_id = (data.get("request_id") or "").strip() or str(uuid.uuid4())

    return Response(
        stream_with_context(_stream_chat(messages, model=model, request_id=request_id)),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/chat/stop", methods=["POST"])
def stop_chat():
    data = request.get_json(silent=True) or {}
    request_id = (data.get("request_id") or "").strip()
    if not request_id:
        return jsonify({"error": "Missing 'request_id' in request body"}), 400
    stopped = _stop_stream(request_id)
    return jsonify({"ok": True, "stopped": stopped})

@app.route("/service-worker.js")
def service_worker_root():
    # Serve the service worker at the site root so its scope can be '/'
    return send_from_directory(app.static_folder, "service-worker.js")


if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5000)
