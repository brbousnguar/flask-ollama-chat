"""
Flask AI assistant using local Ollama.
"""
import json
import os
import urllib.request
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response, stream_with_context, send_from_directory
from openai import OpenAI

app = Flask(__name__, static_folder="static")

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

# Ollama OpenAI-compatible client
client = OpenAI(
    base_url=f"{OLLAMA_BASE}/v1",
    api_key=os.environ.get("OLLAMA_API_KEY", "ollama"),
)

DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "gpt-oss:latest")

# Directory for storing chat threads: data/YYYY-MM-DD/<thread-id>.json
DATA_ROOT = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_ROOT, exist_ok=True)

def _safe_date_str(dt_iso=None):
    try:
        if not dt_iso:
            return datetime.utcnow().strftime("%Y-%m-%d")
        return dt_iso[:10]
    except Exception:
        return datetime.utcnow().strftime("%Y-%m-%d")

def _day_file_path(date_str):
    # single JSON file per day
    os.makedirs(DATA_ROOT, exist_ok=True)
    return os.path.join(DATA_ROOT, f"{date_str}.json")


def _read_day_file(date_str):
    path = _day_file_path(date_str)
    if not os.path.exists(path):
        return { 'date': date_str, 'threads': [] }
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            return json.load(fh) or { 'date': date_str, 'threads': [] }
    except Exception:
        return { 'date': date_str, 'threads': [] }


def _write_day_file(date_str, payload):
    path = _day_file_path(date_str)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def _list_threads():
    days = []
    for fn in sorted(os.listdir(DATA_ROOT), reverse=True):
        if not fn.endswith('.json'):
            continue
        date_str = fn.replace('.json', '')
        try:
            data = _read_day_file(date_str)
            items = []
            for t in data.get('threads', []):
                preview = ''
                msgs = t.get('messages') or []
                if msgs:
                    last = msgs[-1]
                    preview = (last.get('content') if isinstance(last, dict) else str(last)) or ''
                items.append({
                    'id': t.get('id'),
                    'title': t.get('title') or 'Chat',
                    'created_at': t.get('created_at'),
                    'preview': preview[:240]
                })
            days.append({ 'date': date_str, 'threads': items })
        except Exception:
            continue
    return days


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
            # include available metadata from Ollama so UI can show modified/updated info
            models.append({
                "name": name,
                "modified_at": m.get("modified_at") or m.get("modified"),
                "size": m.get("size"),
                "details": m.get("details", {}),
            })

        return jsonify({"models": models})
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


@app.route('/threads', methods=['GET'])
def list_threads_endpoint():
    """Return a list of saved threads organized by date."""
    try:
        days = _list_threads()
        return jsonify({ 'days': days })
    except Exception as e:
        return jsonify({'error': str(e), 'days': []}), 500


@app.route('/service-worker.js')
def service_worker_root():
    # Serve the service worker at the site root so its scope can be '/'
    return send_from_directory(app.static_folder, 'service-worker.js')


@app.route('/threads/<date>/<thread_id>', methods=['GET'])
def get_thread(date, thread_id):
    try:
        day = _read_day_file(date)
        for t in day.get('threads', []):
            if t.get('id') == thread_id:
                return jsonify(t)
        return jsonify({'error': 'Not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/threads', methods=['POST'])
def save_thread():
    """Save or update a thread. Body must be a JSON object with id, title, messages, created_at(optional).
    The file will be stored under data/YYYY-MM-DD/<id>.json
    """
    try:
        data = request.get_json()
        if not data or 'id' not in data:
            return jsonify({'error': "Missing 'id' in body"}), 400
        tid = data['id']
        created_at = data.get('created_at') or datetime.utcnow().isoformat()
        date_str = _safe_date_str(created_at)
        # read the day file and upsert the thread
        day = _read_day_file(date_str)
        threads = day.get('threads', [])
        updated = False
        for i, t in enumerate(threads):
            if t.get('id') == tid:
                threads[i] = {
                    'id': tid,
                    'title': data.get('title') or t.get('title') or 'Chat',
                    'created_at': created_at,
                    'messages': data.get('messages') or []
                }
                updated = True
                break
        if not updated:
            threads.append({
                'id': tid,
                'title': data.get('title') or 'Chat',
                'created_at': created_at,
                'messages': data.get('messages') or []
            })
        day['threads'] = threads
        _write_day_file(date_str, day)
        return jsonify({'ok': True, 'date': date_str, 'id': tid})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5000)
