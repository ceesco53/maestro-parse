
from flask import Flask, render_template, request, jsonify, send_file
from dateutil import parser as dtp
from datetime import datetime, timezone
import io, csv, json

app = Flask(__name__)

RAW = []  # normalized rows across uploads

def parse_iso(s):
    if not s:
        return None
    try:
        return dtp.isoparse(s)
    except Exception:
        return None

def days_until(dt):
    if not dt:
        return None
    now = datetime.now(timezone.utc)
    return int((dt - now).total_seconds() // 86400)

def sla_bucket(d):
    if d is None:
        return "no-date"
    if d <= 30: return "<=30"
    if d <= 60: return "<=60"
    if d <= 90: return "<=90"
    return ">90"

def walk(node, parent_name=None, root_name=None, depth=0, rows=None):
    # C1: every nested cert becomes its own row
    if rows is None: rows = []
    name = node.get("name") or ""
    is_ca = bool(node.get("is_ca"))
    issuer = node.get("issuer") or ""
    location = node.get("location") or ""
    product_guid = node.get("product_guid") or ""
    valid_from_raw = node.get("valid_from")
    valid_until_raw = node.get("valid_until")
    valid_from = parse_iso(valid_from_raw)
    valid_until = parse_iso(valid_until_raw)
    deployments = list(node.get("deployments") or [])
    rotation_status = node.get("rotation_status") or ""
    rotation_procedure_name = node.get("rotation_procedure_name") or ""
    rotation_procedure_url  = node.get("rotation_procedure_url") or ""

    if root_name is None:
        root_name = name or issuer or "root"

    dleft = days_until(valid_until)
    row = {
        "name": name,
        "is_ca": is_ca,
        "issuer": issuer,
        "location": location,
        "product_guid": product_guid,
        "valid_from": valid_from_raw,
        "valid_until": valid_until_raw,
        "days_until": dleft,
        "sla": sla_bucket(dleft),
        "deployments": deployments,
        "rotation_status": rotation_status,
        "rotation_procedure_name": rotation_procedure_name,
        "rotation_procedure_url": rotation_procedure_url,
        "parent_name": parent_name,
        "root_name": root_name,
        "depth": depth
    }
    rows.append(row)

    for child in node.get("signs") or []:
        walk(child, parent_name=name, root_name=root_name, depth=depth+1, rows=rows)

    return rows

def normalize(json_blob):
    rows = []
    # accept dict or list; accept key 'certificates' or 'roots' or a single root
    if isinstance(json_blob, dict):
        items = json_blob.get("certificates") or json_blob.get("roots") or [json_blob]
    elif isinstance(json_blob, list):
        items = json_blob
    else:
        items = []

    for item in items:
        rows.extend(walk(item))

    # sort by valid_until asc (None at end)
    def key_fn(r):
        vu = parse_iso(r.get("valid_until"))
        return (1, datetime.max.replace(tzinfo=timezone.utc)) if vu is None else (0, vu)
    rows.sort(key=key_fn)
    return rows

@app.route("/")
def index():
    return render_template("index.html")

@app.post("/api/upload")
def api_upload():
    global RAW
    files = request.files.getlist("files")
    new_rows = []
    for f in files:
        try:
            blob = json.load(f.stream)
            new_rows.extend(normalize(blob))
        except Exception as e:
            return jsonify({"ok": False, "error": f"Failed to parse JSON {f.filename}: {e}"}), 400
    RAW = new_rows
    return jsonify({"ok": True, "count": len(RAW)})

@app.get("/api/data")
def api_data():
    return jsonify({"rows": RAW})

@app.get("/api/export/csv")
def api_export_csv():
    si = io.StringIO()
    w = csv.writer(si)
    header = ["name","is_ca","issuer","location","product_guid","valid_from","valid_until","days_until","sla","deployments","rotation_status","rotation_procedure_name","rotation_procedure_url","parent_name","root_name","depth"]
    w.writerow(header)
    for r in RAW:
        w.writerow([
            r.get("name",""),
            r.get("is_ca",False),
            r.get("issuer",""),
            r.get("location",""),
            r.get("product_guid",""),
            r.get("valid_from",""),
            r.get("valid_until",""),
            r.get("days_until",""),
            r.get("sla",""),
            ";".join(r.get("deployments") or []),
            r.get("rotation_status",""),
            r.get("rotation_procedure_name",""),
            r.get("rotation_procedure_url",""),
            r.get("parent_name",""),
            r.get("root_name",""),
            r.get("depth",0),
        ])
    mem = io.BytesIO()
    mem.write(si.getvalue().encode("utf-8"))
    mem.seek(0)
    return send_file(mem, as_attachment=True, download_name="certs.csv", mimetype="text/csv")

@app.get("/api/export/json")
def api_export_json():
    mem = io.BytesIO(json.dumps(RAW, indent=2).encode("utf-8"))
    mem.seek(0)
    return send_file(mem, as_attachment=True, download_name="certs.json", mimetype="application/json")

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
