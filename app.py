#!/usr/bin/env python3
# Maestro Certificate Rotation Dashboard — Drag & Drop Upload version
import io, os, hashlib, datetime as dt
from typing import Any, Dict, List, Optional, Tuple
from flask import Flask, request, Response, jsonify, render_template

import yaml

app = Flask(__name__, static_folder="static", template_folder="templates")

# In-memory storage per-process
ROWS: List[Dict[str, Any]] = []
LAST_SIG: str = ""

def _parse_dt(s: Optional[str]):
    if not s: return None
    s = str(s).strip().replace(" ", "T")
    if s.endswith("Z"): s = s[:-1] + "+00:00"
    try: return dt.datetime.fromisoformat(s)
    except Exception: return None

def _days_remaining(d):
    if not d: return None
    if d.tzinfo is None: d = d.replace(tzinfo=dt.timezone.utc)
    now = dt.datetime.now(dt.timezone.utc)
    return (d - now).days

def _short(s: Optional[str]) -> str:
    if not s: return ""
    return s[:8] + "..." if len(s) > 9 else s

def _flatten_doc(doc: Dict[str, Any], foundation: str) -> List[Dict[str, Any]]:
    topo = (doc or {}).get("output", {}).get("topology", [])
    index = {}
    for cert in topo:
        for v in (cert.get("versions") or []):
            vid = v.get("version_id")
            if vid:
                index[vid] = cert.get("name") or "UNKNOWN_CERT"
    rows = []
    for cert in topo:
        cname = cert.get("name") or "UNKNOWN_CERT"
        for v in (cert.get("versions") or []):
            vu = _parse_dt(v.get("valid_until"))
            issuer_vid = v.get("signed_by_version") or ""
            issuer = f"{index.get(issuer_vid, issuer_vid)}({_short(issuer_vid)})" if issuer_vid else ""
            rows.append({
                "foundation": foundation,
                "cert_name": cname,
                "version_id": v.get("version_id") or "",
                "version_id_short": _short(v.get("version_id") or ""),
                "issuer_version": issuer_vid,
                "issuer_version_short": _short(issuer_vid) if issuer_vid else "",
                "issuer": issuer,
                "active": bool(v.get("active", False)),
                "certificate_authority": bool(v.get("certificate_authority", False)),
                "transitional": bool(v.get("transitional", False)),
                "deployments": ", ".join(v.get("deployment_names") or []) if isinstance(v.get("deployment_names"), list) else (v.get("deployment_names") or ""),
                "valid_until": (vu.isoformat() if vu else (v.get("valid_until") or "")),
                "valid_until_raw": v.get("valid_until") or "",
                "days_remaining": _days_remaining(vu),
            })
    return rows

def _sig_for_files(files):
    import hashlib
    h = hashlib.sha256()
    for name, data in files:
        h.update(name.encode("utf-8")+b"\x00"+data)
    return h.hexdigest()

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/upload", methods=["POST"])
def api_upload():
    global ROWS, LAST_SIG
    fobjs = request.files.getlist("files")
    if not fobjs:
        return jsonify({"ok": False, "error": "no files"}), 400

    loaded = []
    file_pairs = []
    for f in fobjs:
        try:
            raw = f.read()
            file_pairs.append((f.filename, raw))
            doc = yaml.safe_load(raw.decode("utf-8", errors="replace"))
            foundation = os.path.splitext(os.path.basename(f.filename))[0]
            loaded.extend(_flatten_doc(doc, foundation))
        except Exception as e:
            return jsonify({"ok": False, "error": f"parse failed for {f.filename}: {e}"}), 400

    ROWS = loaded
    LAST_SIG = _sig_for_files(file_pairs)
    return jsonify({"ok": True, "rows": len(ROWS), "sig": LAST_SIG})

@app.route("/api/rows")
def api_rows():
    return jsonify(ROWS or [])

@app.route("/api/version")
def api_version():
    return jsonify({"sig": LAST_SIG})

@app.route("/api/export/json")
def api_export_json():
    return jsonify(ROWS or [])

@app.route("/api/export/csv")
def api_export_csv():
    out = io.StringIO()
    out.write("foundation,cert_name,version_id_short,issuer,active,certificate_authority,transitional,deployments,valid_until,days_remaining\n")
    for r in ROWS:
        out.write(",".join([
            r["foundation"], r["cert_name"], r["version_id_short"],
            (r.get("issuer") or "").replace(",", ";"),
            "true" if r["active"] else "false",
            "true" if r["certificate_authority"] else "false",
            "true" if r["transitional"] else "false",
            (r.get("deployments") or "").replace(",", ";"),
            r.get("valid_until") or "",
            str(r.get("days_remaining") or ""),
        ]) + "\n")
    return Response(out.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition":"attachment; filename=cert_rotation_plan.csv"})

@app.route("/api/runbook")
def api_runbook():
    def md(s): return (s or "").replace("|","\\|")
    out = io.StringIO()
    out.write("# Certificate Rotation Runbook\n\n")
    cas = [r for r in ROWS if r["certificate_authority"]]
    leaves = [r for r in ROWS if not r["certificate_authority"]]
    cas.sort(key=lambda r: (r["days_remaining"] if r["days_remaining"] is not None else 9000000))
    leaves.sort(key=lambda r: (r["days_remaining"] if r["days_remaining"] is not None else 9000000))
    out.write("## Phase 1 — CAs\n")
    for r in cas: out.write(f"- **{md(r['foundation'])}** / **{md(r['cert_name'])}** `{r['version_id_short']}` — {r['days_remaining']}d (issuer: {md(r.get('issuer',''))})\n")
    out.write("\n## Phase 2 — Leaves\n")
    for r in leaves: out.write(f"- {md(r['foundation'])} / {md(r['cert_name'])} `{r['version_id_short']}` — {r['days_remaining']}d (issuer: {md(r.get('issuer',''))})\n")
    return Response(out.getvalue(), mimetype="text/markdown",
                    headers={"Content-Disposition":"attachment; filename=Runbook.md"})

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT","5000")), debug=True)
