"""
Flask AI assistant using local Ollama.
"""
import json
import os
import urllib.request
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from openai import OpenAI

app = Flask(__name__, static_folder="static")

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

# Ollama OpenAI-compatible client
client = OpenAI(
    base_url=f"{OLLAMA_BASE}/v1",
    api_key=os.environ.get("OLLAMA_API_KEY", "ollama"),
)

DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "gpt-oss:latest")


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
        names = [m.get("name", "") for m in data.get("models", []) if m.get("name")]
        return jsonify({"models": names})
    except Exception as e:
        return jsonify({"error": str(e), "models": []}), 500


def _stream_chat(messages, model):
    """Generator that streams Ollama chat completion chunks as SSE."""
    try:
        stream = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and getattr(delta, "content", None):
                yield f"data: {json.dumps({'content': delta.content})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


@app.route("/chat", methods=["POST"])
def chat():
    """Backend chat endpoint: streams assistant reply from Ollama as Server-Sent Events."""
    data = request.get_json()
    if not data or "messages" not in data:
        return jsonify({"error": "Missing 'messages' in request body"}), 400

    messages = data["messages"]
    if not isinstance(messages, list):
        return jsonify({"error": "'messages' must be a list"}), 400

    model = (data.get("model") or "").strip() or DEFAULT_MODEL

    return Response(
        stream_with_context(_stream_chat(messages, model=model)),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5000)
