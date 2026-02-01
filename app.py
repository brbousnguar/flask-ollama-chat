"""
Flask AI assistant using local Ollama (gpt-oss:latest).
"""
import json
import os
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from openai import OpenAI

app = Flask(__name__, static_folder="static")

# Ollama OpenAI-compatible client
client = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key=os.environ.get("OLLAMA_API_KEY", "ollama"),
)

OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gpt-oss:latest")


@app.route("/")
def index():
    """Serve the single-page application."""
    return render_template("index.html")


def _stream_chat(messages):
    """Generator that streams Ollama chat completion chunks as SSE."""
    try:
        stream = client.chat.completions.create(
            model=OLLAMA_MODEL,
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

    return Response(
        stream_with_context(_stream_chat(messages)),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5000)
