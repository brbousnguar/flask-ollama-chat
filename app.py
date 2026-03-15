"""
Flask AI assistant using local Ollama.
"""
import json
import os
import sqlite3
import urllib.request
from datetime import datetime
from functools import wraps

from flask import (
    Flask,
    Response,
    jsonify,
    render_template,
    request,
    send_from_directory,
    session,
    stream_with_context,
)
from openai import OpenAI
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__, static_folder="static")
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "change-me-in-production")

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

# Ollama OpenAI-compatible client
client = OpenAI(
    base_url=f"{OLLAMA_BASE}/v1",
    api_key=os.environ.get("OLLAMA_API_KEY", "ollama"),
)

DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "gpt-oss:latest")

# Optional system prompt loaded from an untracked local file
_SYSTEM_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
_SYSTEM_PROMPT = None
if os.path.exists(_SYSTEM_PROMPT_PATH):
    with open(_SYSTEM_PROMPT_PATH, encoding="utf-8") as _f:
        _SYSTEM_PROMPT = _f.read().strip() or None

# Directory for storing chat threads: data/YYYY-MM-DD.json
DATA_ROOT = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_ROOT, exist_ok=True)

DB_PATH = os.path.join(DATA_ROOT, "app.db")


def _db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db():
    with _db_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )


_init_db()


def _current_user_id():
    return session.get("user_id")


def _auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user_id = _current_user_id()
        if not user_id:
            return jsonify({"error": "Authentication required"}), 401
        return fn(*args, **kwargs)

    return wrapper


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
        return {"date": date_str, "threads": []}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh) or {"date": date_str, "threads": []}
    except Exception:
        return {"date": date_str, "threads": []}


def _write_day_file(date_str, payload):
    path = _day_file_path(date_str)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def _list_threads(user_id):
    days = []
    user_id = str(user_id)
    for fn in sorted(os.listdir(DATA_ROOT), reverse=True):
        if not fn.endswith(".json"):
            continue
        date_str = fn.replace(".json", "")
        try:
            data = _read_day_file(date_str)
            items = []
            for t in data.get("threads", []):
                if str(t.get("user_id")) != user_id:
                    continue
                preview = ""
                msgs = t.get("messages") or []
                if msgs:
                    last = msgs[-1]
                    preview = (last.get("content") if isinstance(last, dict) else str(last)) or ""
                items.append(
                    {
                        "id": t.get("id"),
                        "title": t.get("title") or "Chat",
                        "created_at": t.get("created_at"),
                        "preview": preview[:240],
                    }
                )
            if items:
                days.append({"date": date_str, "threads": items})
        except Exception:
            continue
    return days


@app.route("/")
def index():
    """Serve the single-page application."""
    return render_template("index.html")


@app.route("/auth/me", methods=["GET"])
def auth_me():
    user_id = _current_user_id()
    if not user_id:
        return jsonify({"authenticated": False, "user": None})

    with _db_conn() as conn:
        user = conn.execute(
            "SELECT id, name, email, created_at FROM users WHERE id = ?", (user_id,)
        ).fetchone()

    if not user:
        session.clear()
        return jsonify({"authenticated": False, "user": None})

    return jsonify(
        {
            "authenticated": True,
            "user": {
                "id": user["id"],
                "name": user["name"],
                "email": user["email"],
                "created_at": user["created_at"],
            },
        }
    )


@app.route("/auth/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not name:
        return jsonify({"error": "Name is required"}), 400
    if not email or "@" not in email:
        return jsonify({"error": "A valid email is required"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    try:
        with _db_conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO users (name, email, password_hash, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (name, email, generate_password_hash(password), datetime.utcnow().isoformat()),
            )
            user_id = cur.lastrowid
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email already exists"}), 409

    session["user_id"] = user_id
    return jsonify({"ok": True, "user": {"id": user_id, "name": name, "email": email}})


@app.route("/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    with _db_conn() as conn:
        user = conn.execute(
            "SELECT id, name, email, password_hash FROM users WHERE email = ?", (email,)
        ).fetchone()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password"}), 401

    session["user_id"] = user["id"]
    return jsonify(
        {
            "ok": True,
            "user": {"id": user["id"], "name": user["name"], "email": user["email"]},
        }
    )


@app.route("/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/models", methods=["GET"])
@_auth_required
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
@_auth_required
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


def _stream_chat(messages, model):
    """Generator that streams Ollama chat completion chunks as SSE."""
    app.logger.debug("Sending %d messages to model %s; first role: %s",
                     len(messages), model, messages[0]["role"] if messages else "none")
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
@_auth_required
def chat():
    """Backend chat endpoint: streams assistant reply from Ollama as Server-Sent Events."""
    data = request.get_json()
    if not data or "messages" not in data:
        return jsonify({"error": "Missing 'messages' in request body"}), 400

    messages = data["messages"]
    if not isinstance(messages, list):
        return jsonify({"error": "'messages' must be a list"}), 400

    if _SYSTEM_PROMPT:
        messages = [{"role": "system", "content": _SYSTEM_PROMPT}] + messages

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


@app.route("/threads", methods=["GET"])
@_auth_required
def list_threads_endpoint():
    """Return a list of saved threads organized by date for the current user."""
    try:
        days = _list_threads(_current_user_id())
        return jsonify({"days": days})
    except Exception as e:
        return jsonify({"error": str(e), "days": []}), 500


@app.route("/service-worker.js")
def service_worker_root():
    # Serve the service worker at the site root so its scope can be '/'
    return send_from_directory(app.static_folder, "service-worker.js")


@app.route("/threads/<date>/<thread_id>", methods=["GET"])
@_auth_required
def get_thread(date, thread_id):
    try:
        user_id = str(_current_user_id())
        day = _read_day_file(date)
        for t in day.get("threads", []):
            if t.get("id") == thread_id and str(t.get("user_id")) == user_id:
                return jsonify(t)
        return jsonify({"error": "Not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/threads", methods=["POST"])
@_auth_required
def save_thread():
    """Save or update a thread for the current user."""
    try:
        data = request.get_json()
        if not data or "id" not in data:
            return jsonify({"error": "Missing 'id' in body"}), 400

        user_id = _current_user_id()
        tid = data["id"]
        created_at = data.get("created_at") or datetime.utcnow().isoformat()
        date_str = _safe_date_str(created_at)

        day = _read_day_file(date_str)
        threads = day.get("threads", [])
        updated = False

        for i, t in enumerate(threads):
            if t.get("id") == tid and str(t.get("user_id")) == str(user_id):
                threads[i] = {
                    "id": tid,
                    "user_id": user_id,
                    "title": data.get("title") or t.get("title") or "Chat",
                    "created_at": created_at,
                    "messages": data.get("messages") or [],
                }
                updated = True
                break

        if not updated:
            threads.append(
                {
                    "id": tid,
                    "user_id": user_id,
                    "title": data.get("title") or "Chat",
                    "created_at": created_at,
                    "messages": data.get("messages") or [],
                }
            )

        day["threads"] = threads
        _write_day_file(date_str, day)
        return jsonify({"ok": True, "date": date_str, "id": tid})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5000)
