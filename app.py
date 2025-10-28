#!/usr/bin/env python3
import io, os, hashlib, datetime as dt
from typing import Any, Dict, List, Optional
from flask import Flask, request, jsonify, render_template, Response
import yaml

app = Flask(__name__, static_folder="static", template_folder="templates")

ROWS: List[Dict[str, Any]] = []
SIG: str = ""

def _parse_dt(s: Optional[str]):
    if not s: return None
    s = str(s).strip().replace(' ', 'T')
    if s.endswith('Z'):
        s = s[:-1] + '+00:00'
    try:
        return dt.datetime.fromisoformat(s)
    except Exception:
        return None

def _days_left(d):
    if not d:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    now = dt.datetime.now(dt.timezone.utc)
    return (d - now).days

def _short(s: Optional[str]) -> str:
    if not s: return ""
    return (s[:8] + "...") if len(s) > 9 else s

def flatten(doc, foundation):
    topo = (doc or {}).get("output", {}).get("topology", [])
    name_by_vid = {}
    for c in topo:
        for v in (c.get("versions") or []):
            vid = v.get("version_id")
            if vid:
                name_by_vid[vid] = c.get("name") or "UNKNOWN_CERT"
    rows = []
    for c in topo:
        cname = c.get("name") or "UNKNOWN_CERT"
        for v in (c.get("versions") or []):
            vu = _parse_dt(v.get("valid_until"))
            issuer_vid = v.get("signed_by_version") or ""
            issuer = f"{name_by_vid.get(issuer_vid, issuer_vid)}({_short(issuer_vid)})" if issuer_vid else ""
            deployments = v.get("deployment_names")
            if isinstance(deployments, list):
                dep_list = deployments
                dep_str = ", ".join(deployments)
            else:
                dep_str = deployments or ""
                dep_list = [x.strip() for x in dep_str.split(",") if x.strip()]
            rows.append({
                "foundation": foundation,
                "cert_name": cname,
                "version_id": v.get("version_id") or "",
                "version_id_short": _short(v.get("version_id") or ""),
                "issuer_version": issuer_vid,
                "issuer": issuer,
                "issuer_version_short": _short(issuer_vid) if issuer_vid else "",
                "active": bool(v.get("active")),
                "certificate_authority": bool(v.get("certificate_authority")),
                "transitional": bool(v.get("transitional")),
                "deployments": dep_str,
                "deployments_list": dep_list,
                "valid_until": vu.isoformat() if vu else (v.get("valid_until") or ""),
                "valid_until_raw": v.get("valid_until") or "",
                "days_remaining": _days_left(vu),
            })
    return rows

def _sig(files):
    h = hashlib.sha256()
    for n, data in files:
        h.update(n.encode() + b"\x00" + data)
    return h.hexdigest()

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/upload", methods=["POST"])
def upload():
    global ROWS, SIG
    fobjs = request.files.getlist("files")
    if not fobjs:
        return jsonify({"ok": False, "error": "no files"}), 400
    rows = []
    pairs = []
    for f in fobjs:
        raw = f.read()
        pairs.append((f.filename, raw))
        try:
            doc = yaml.safe_load(raw.decode("utf-8", errors="replace"))
        except Exception as e:
            return jsonify({"ok": False, "error": f"parse error {f.filename}: {e}"}), 400
        foundation = os.path.splitext(os.path.basename(f.filename))[0]
        rows.extend(flatten(doc, foundation))
    ROWS = rows
    SIG = _sig(pairs)
    return jsonify({"ok": True, "rows": len(ROWS), "sig": SIG})

@app.route("/api/rows")
def rows():
    return jsonify(ROWS or [])

@app.route("/api/export/csv")
def export_csv():
    out = io.StringIO()
    out.write("foundation,cert_name,version_id_short,issuer,active,certificate_authority,transitional,deployments,valid_until,days_remaining\n")
    for r in ROWS:
        out.write(",".join([
            r["foundation"],
            r["cert_name"],
            r["version_id_short"],
            (r.get("issuer") or "").replace(",", ";"),
            "true" if r["active"] else "false",
            "true" if r["certificate_authority"] else "false",
            "true" if r["transitional"] else "false",
            (r.get("deployments") or "").replace(",", ";"),
            r.get("valid_until") or "",
            str(r.get("days_remaining") or ""),
        ]) + "\n")
    return Response(out.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=cert_rotation_plan.csv"})

@app.route("/api/export/json")
def export_json():
    return jsonify(ROWS or [])

@app.route("/api/runbook")
def runbook():
    def md(s): return (s or "").replace("|", "\\|")
    out = io.StringIO()
    out.write("# Certificate Rotation Runbook\n\n")
    cas = [r for r in ROWS if r["certificate_authority"]]
    leaves = [r for r in ROWS if not r["certificate_authority"]]
    cas.sort(key=lambda r: (r["days_remaining"] if r["days_remaining"] is not None else 9_000_000))
    leaves.sort(key=lambda r: (r["days_remaining"] if r["days_remaining"] is not None else 9_000_000))
    out.write("## Phase 1 — CAs\n")
    for r in cas:
        out.write(f"- **{md(r['foundation'])}** / **{md(r['cert_name'])}** `{r['version_id_short']}` — {r['days_remaining']}d (issuer: {md(r.get('issuer',''))})\n")
    out.write("\n## Phase 2 — Leaves\n")
    for r in leaves:
        out.write(f"- {md(r['foundation'])} / {md(r['cert_name'])} `{r['version_id_short']}` — {r['days_remaining']}d (issuer: {md(r.get('issuer',''))})\n")
    return Response(out.getvalue(), mimetype="text/markdown",
                    headers={"Content-Disposition": "attachment; filename=Runbook.md"})

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=True)
