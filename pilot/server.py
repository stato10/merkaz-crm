import argparse
import hashlib
import json
import os
import secrets
import socket
import sqlite3
import uuid
from contextlib import closing
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB = os.environ.get("CRM_DB", str(ROOT / "pilot.sqlite3"))
DEMO = "demo"


def connect():
    db = sqlite3.connect(DB, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize():
    with closing(connect()) as db, db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS organizations (
            id TEXT PRIMARY KEY, secret TEXT NOT NULL,
            name TEXT NOT NULL, welcome TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS appointments (
            org TEXT REFERENCES organizations(id), id TEXT, customer TEXT NOT NULL,
            slot TEXT NOT NULL, PRIMARY KEY(org,id), UNIQUE(org,slot)
        );
        CREATE TABLE IF NOT EXISTS cases (
            org TEXT REFERENCES organizations(id), id TEXT, customer TEXT NOT NULL,
            summary TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting',
            created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(org,id)
        );
        CREATE TABLE IF NOT EXISTS operations (
            org TEXT REFERENCES organizations(id), id TEXT, input TEXT NOT NULL,
            result TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(org,id)
        );
        CREATE TABLE IF NOT EXISTS access_keys (
            org TEXT NOT NULL REFERENCES organizations(id),
            actor TEXT NOT NULL, role TEXT NOT NULL,
            digest TEXT NOT NULL UNIQUE, PRIMARY KEY(org,actor)
        );
        CREATE TABLE IF NOT EXISTS audit (
            org TEXT NOT NULL REFERENCES organizations(id),
            actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
            created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """)
        db.execute("INSERT OR IGNORE INTO organizations VALUES (?,?,?,?)",
                   (DEMO, "", "מוקד הדגמה", "שלום, איך אפשר לעזור?"))
        db.execute("INSERT OR IGNORE INTO appointments VALUES (?,?,?,?)",
                   (DEMO, "A100", "נועה לוי", (date.today() + timedelta(days=3)).isoformat() + "T10:00"))
        for row in db.execute("SELECT id,secret FROM organizations WHERE secret<>'' AND secret NOT LIKE 'retired:%'").fetchall():
            db.execute("INSERT INTO access_keys VALUES (?,?,?,?)",
                       (row["id"], "owner", "manager", key_digest(row["secret"])))
            db.execute("UPDATE organizations SET secret=? WHERE id=?", (retired_secret(), row["id"]))


def key_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def retired_secret():
    return "retired:" + secrets.token_urlsafe(32)


def audit(db, org, actor, action, target):
    db.execute("INSERT INTO audit (org,actor,action,target) VALUES (?,?,?,?)",
               (org, actor, action, target))


ROLES = {
    ("GET", "/api/v1/dashboard"): {"manager", "agent"},
    ("GET", "/api/v1/audit"): {"manager"},
    ("POST", "/api/v1/operations"): {"manager", "agent", "integration"},
    ("POST", "/api/v1/settings"): {"manager"},
    ("POST", "/api/v1/appointments"): {"manager", "integration"},
    ("POST", "/api/v1/cases/close"): {"manager", "agent"},
}


class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def field(data, name, limit=200):
    value = data.get(name)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ApiError(400, f"שדה לא תקין: {name}")
    return value.strip()


def slot_field(data):
    from datetime import datetime
    value = field(data, "slot", 16)
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M")
        if parsed.isoformat(timespec="minutes") != value:
            raise ValueError
    except ValueError:
        raise ApiError(400, "יש לבחור תאריך ושעה תקינים")
    return value


def appointment(db, org, appointment_id):
    row = db.execute("SELECT id,customer,slot FROM appointments WHERE org=? AND id=?",
                     (org, appointment_id)).fetchone()
    if not row:
        raise ApiError(404, "התור לא נמצא")
    return dict(row)


def operation(db, org, actor, data):
    request_id = field(data, "requestId", 80)
    action = field(data, "action", 30)
    appointment_id = field(data, "appointmentId", 80)
    request = {"action": action, "appointmentId": appointment_id}
    if action == "reschedule":
        request["slot"] = slot_field(data)
        request["previousSlot"] = field(data, "previousSlot", 16)
    elif action == "handoff":
        request["summary"] = field(data, "summary", 1000)
    elif action != "status":
        raise ApiError(400, "פעולה לא מוכרת")
    serialized = json.dumps(request, sort_keys=True, ensure_ascii=False)
    existing = db.execute("SELECT input,result FROM operations WHERE org=? AND id=?",
                          (org, request_id)).fetchone()
    if existing:
        if existing["input"] != serialized:
            raise ApiError(409, "מזהה הפעולה כבר שויך לבקשה אחרת")
        return json.loads(existing["result"])

    current = appointment(db, org, appointment_id)
    result = {"appointment": current}
    if action == "reschedule":
        if current["slot"] != request["previousSlot"]:
            raise ApiError(409, "מועד התור השתנה. יש לרענן את הנתונים")
        db.execute("UPDATE appointments SET slot=? WHERE org=? AND id=?",
                   (request["slot"], org, appointment_id))
        current["slot"] = request["slot"]
    elif action == "handoff":
        case_id = uuid.uuid4().hex[:12]
        summary = f'{request["summary"]} | תור {appointment_id} · {current["slot"]}'
        db.execute("INSERT INTO cases (org,id,customer,summary) VALUES (?,?,?,?)",
                   (org, case_id, current["customer"], summary))
        result["caseId"] = case_id
    db.execute("INSERT INTO operations (org,id,input,result) VALUES (?,?,?,?)",
               (org, request_id, serialized, json.dumps(result, ensure_ascii=False)))
    audit(db, org, actor, action, result.get("caseId", appointment_id))
    return result


class PilotServer(ThreadingHTTPServer):
    def server_bind(self):
        if os.name == "nt":
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(BaseHTTPRequestHandler):
    def send_body(self, status, content, mime):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(content)

    def reply(self, status, payload):
        self.send_body(status, json.dumps(payload, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        assets = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
                  "/style.css": ("style.css", "text/css"),
                  "/Rubik.ttf": ("Rubik.ttf", "font/ttf"),
                  "/openapi.json": ("openapi.json", "application/json")}
        if self.path in assets:
            filename, mime = assets[self.path]
            self.send_body(200, (ROOT / filename).read_bytes(), mime + "; charset=utf-8")
        else:
            self.api()

    def do_POST(self):
        self.api()

    def api(self):
        try:
            org = self.headers.get("X-Organization", DEMO)
            authorization = self.headers.get("Authorization", "")
            token = authorization[7:] if authorization.startswith("Bearer ") else ""
            data = {}
            if self.command == "POST":
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16384:
                    raise ApiError(400, "גוף הבקשה חסר או ארוך מדי")
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ApiError(400, "נדרש אובייקט JSON")
            with closing(connect()) as db, db:
                profile = db.execute("SELECT name,welcome FROM organizations WHERE id=?", (org,)).fetchone()
                identity = None
                if org == DEMO and not authorization:
                    identity = {"actor": "demo", "role": "manager"}
                elif token:
                    identity = db.execute("SELECT actor,role FROM access_keys WHERE org=? AND digest=?",
                                          (org, key_digest(token))).fetchone()
                if not profile or not identity:
                    raise ApiError(401, "פרטי החיבור לארגון אינם תקינים")
                roles = ROLES.get((self.command, self.path))
                if roles is None:
                    raise ApiError(404, "הממשק לא נמצא")
                if identity["role"] not in roles:
                    raise ApiError(403, "אין הרשאה לפעולה הזאת")
                if self.command == "POST":
                    db.execute("BEGIN IMMEDIATE")
                result = self.route(db, org, profile, identity, data)
            self.reply(200, result)
        except ApiError as error:
            self.reply(error.status, {"error": error.message})
        except (ValueError, UnicodeError):
            self.reply(400, {"error": "בקשה לא תקינה"})
        except sqlite3.IntegrityError:
            self.reply(409, {"error": "המועד כבר תפוס או שהרשומה מתנגשת עם נתון קיים"})
        except sqlite3.OperationalError:
            self.reply(503, {"error": "מסד הנתונים אינו זמין כרגע"})

    def route(self, db, org, profile, identity, data):
        actor = identity["actor"]
        if self.command == "GET" and self.path == "/api/v1/audit":
            events = db.execute("SELECT actor,action,target,created FROM audit WHERE org=? ORDER BY rowid DESC LIMIT 100",
                                (org,))
            return {"events": [dict(event) for event in events]}
        if self.command == "GET" and self.path == "/api/v1/dashboard":
            tables = {
                "appointments": "SELECT id,customer,slot FROM appointments WHERE org=? ORDER BY slot",
                "cases": "SELECT id,customer,summary,status,created FROM cases WHERE org=? ORDER BY rowid DESC",
                "activity": "SELECT id,input,result,created FROM operations WHERE org=? ORDER BY rowid DESC LIMIT 20",
            }
            return {"profile": {"name": profile["name"], "welcome": profile["welcome"]},
                    "identity": dict(identity),
                    **{key: [dict(row) for row in db.execute(query, (org,))]
                       for key, query in tables.items()}}
        if self.command == "POST" and self.path == "/api/v1/operations":
            return operation(db, org, actor, data)
        if self.command == "POST" and self.path == "/api/v1/settings":
            db.execute("UPDATE organizations SET name=?,welcome=? WHERE id=?",
                       (field(data, "name", 80), field(data, "welcome", 250), org))
            audit(db, org, actor, "settings", org)
            return {"saved": True}
        if self.command == "POST" and self.path == "/api/v1/appointments":
            appointment_id = field(data, "id", 80)
            db.execute("""
                INSERT INTO appointments (org,id,customer,slot) VALUES (?,?,?,?)
                ON CONFLICT(org,id) DO UPDATE SET customer=excluded.customer,slot=excluded.slot
                """, (org, appointment_id, field(data, "customer", 100), slot_field(data)))
            audit(db, org, actor, "appointment_upsert", appointment_id)
            return appointment(db, org, appointment_id)
        if self.command == "POST" and self.path == "/api/v1/cases/close":
            case_id = field(data, "id", 80)
            case = db.execute("SELECT status FROM cases WHERE org=? AND id=?", (org, case_id)).fetchone()
            if not case:
                raise ApiError(404, "הפנייה לא נמצאה")
            if case["status"] != "closed":
                db.execute("UPDATE cases SET status='closed' WHERE org=? AND id=?", (org, case_id))
                audit(db, org, actor, "case_close", case_id)
            return {"closed": True}
        raise ApiError(404, "הממשק לא נמצא")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8877)
    commands = parser.add_mutually_exclusive_group()
    commands.add_argument("--create-org", nargs=2, metavar=("ID", "NAME"))
    commands.add_argument("--issue-key", nargs=3, metavar=("ORG", "ACTOR", "ROLE"))
    args = parser.parse_args()
    initialize()
    if args.create_org:
        org, name = args.create_org
        if not org.isascii() or not org.replace("-", "").isalnum() or len(org) > 40:
            parser.error("Organization ID must contain ASCII letters, digits or hyphens.")
        token = secrets.token_urlsafe(32)
        with closing(connect()) as db, db:
            db.execute("INSERT INTO organizations VALUES (?,?,?,?)",
                       (org, retired_secret(), name, f"שלום, הגעתם ל{name}. איך אפשר לעזור?"))
            db.execute("INSERT INTO access_keys VALUES (?,?,?,?)", (org, "owner", "manager", key_digest(token)))
        print(token)
    elif args.issue_key:
        org, actor, role = args.issue_key
        if org == DEMO or role not in {"manager", "agent", "integration"} or not actor.strip() or len(actor) > 80:
            parser.error("Enter a non-demo organization, an actor, and manager, agent or integration.")
        token = secrets.token_urlsafe(32)
        with closing(connect()) as db, db:
            if not db.execute("SELECT 1 FROM organizations WHERE id=?", (org,)).fetchone():
                parser.error("Organization not found.")
            db.execute("""
                INSERT INTO access_keys VALUES (?,?,?,?)
                ON CONFLICT(org,actor) DO UPDATE SET role=excluded.role,digest=excluded.digest
                """, (org, actor, role, key_digest(token)))
        print(token)
    else:
        try:
            http = PilotServer(("127.0.0.1", args.port), Handler)
        except OSError as error:
            parser.exit(1, f"Cannot start CRM on port {args.port}: {error}\n"
                           "Run python server.py --port 0 to select a free port.\n")
        with http:
            print(f"CRM pilot: http://127.0.0.1:{http.server_port}", flush=True)
            http.serve_forever()
