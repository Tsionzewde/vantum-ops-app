"""VANTUM OPS — Flask backend.

Serves the single-page frontend and a small JSON API backed by Supabase.
If Supabase credentials are not present, it transparently falls back to a
local JSON file so the app runs out of the box for development.
"""
import os
import json
import uuid
from datetime import datetime, timezone

from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

# Use the OS certificate store for TLS (handles machines where antivirus/VPN
# intercepts HTTPS and the default bundle doesn't trust it). No-op if missing.
try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
TABLE = "projects"
LOCAL_STORE = os.path.join(os.path.dirname(__file__), "projects_local.json")

app = Flask(__name__)

# ---- Supabase client (optional) ----
supabase = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        from supabase import create_client
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("[vantum-ops] Storage: Supabase")
    except Exception as exc:  # pragma: no cover
        print(f"[vantum-ops] Supabase init failed ({exc}); using local store")
        supabase = None
else:
    print("[vantum-ops] Storage: local JSON (set SUPABASE_URL/SUPABASE_KEY for cloud)")


# ---------------- storage layer ----------------
def _local_load():
    if not os.path.exists(LOCAL_STORE):
        return []
    try:
        with open(LOCAL_STORE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return []


def _local_save(rows):
    with open(LOCAL_STORE, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, indent=2)


def list_projects():
    if supabase:
        res = supabase.table(TABLE).select("*").order("created_at", desc=True).execute()
        return res.data or []
    return sorted(_local_load(), key=lambda r: r.get("created_at", ""), reverse=True)


def get_project(pid):
    if supabase:
        res = supabase.table(TABLE).select("*").eq("id", pid).limit(1).execute()
        data = res.data or []
        return data[0] if data else None
    for row in _local_load():
        if str(row.get("id")) == str(pid):
            return row
    return None


def create_project(payload):
    record = {
        "name": (payload.get("name") or "Untitled Project").strip(),
        "goal": payload.get("goal", ""),
        "team": payload.get("team", ""),
        "steps": payload.get("steps", []),
        "resources": payload.get("resources", []),
        "map_data": payload.get("map_data", {}),
        "status": payload.get("status", "Approved"),
    }
    if supabase:
        res = supabase.table(TABLE).insert(record).execute()
        data = res.data or []
        return data[0] if data else record
    # local fallback
    record["id"] = str(uuid.uuid4())
    record["created_at"] = datetime.now(timezone.utc).isoformat()
    rows = _local_load()
    rows.append(record)
    _local_save(rows)
    return record


def update_project(pid, payload):
    record = {k: payload[k] for k in
              ("name", "goal", "team", "steps", "resources", "map_data", "status")
              if k in payload}
    if supabase:
        res = supabase.table(TABLE).update(record).eq("id", pid).execute()
        data = res.data or []
        return data[0] if data else None
    rows = _local_load()
    for row in rows:
        if str(row.get("id")) == str(pid):
            row.update(record)
            _local_save(rows)
            return row
    return None


# ---------------- pages ----------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/archive")
def archive():
    return render_template("archive.html")


# ---------------- API ----------------
@app.route("/api/config")
def api_config():
    return jsonify({"storage": "supabase" if supabase else "local"})


@app.route("/api/projects", methods=["GET"])
def api_list():
    return jsonify(list_projects())


@app.route("/api/projects/<pid>", methods=["GET"])
def api_get(pid):
    project = get_project(pid)
    if not project:
        return jsonify({"error": "not found"}), 404
    return jsonify(project)


@app.route("/api/projects", methods=["POST"])
def api_create():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        created = create_project(payload)
        return jsonify(created), 201
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/projects/<pid>", methods=["PUT"])
def api_update(pid):
    payload = request.get_json(force=True, silent=True) or {}
    try:
        updated = update_project(pid, payload)
        if not updated:
            return jsonify({"error": "not found"}), 404
        return jsonify(updated)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
