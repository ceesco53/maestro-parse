#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Maestro Certificate Rotation Dashboard (multi-file, Option A fix-only)
import os, io, glob, hashlib, datetime as dt
from typing import Any, Dict, List, Optional
from flask import Flask, request, Response, jsonify, render_template

try:
    import yaml  # type: ignore
except Exception:
    raise SystemExit("Please install PyYAML: pip install -r requirements.txt")

app = Flask(__name__, static_folder="static", template_folder="templates")

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

def _load_dir(dirpath: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    ymls = []
    ymls.extend(glob.glob(os.path.join(dirpath, "*.yml")))
    ymls.extend(glob.glob(os.path.join(dirpath, "*.yaml")))
    for path in sorted(ymls):
        foundation = os.path.splitext(os.path.basename(path))[0]
        try:
            with open(path, "r", encoding="utf-8") as f:
                doc = yaml.safe_load(f)
            out.extend(_flatten_doc(doc, foundation))
        except Exception as e:
            print("Failed to parse", path, ":", e)
    return out

def _dir_signature(dirpath: str) -> str:
    files = []
    files.extend(glob.glob(os.path.join(dirpath, "*.yml")))
    files.extend(glob.glob(os.path.join(dirpath, "*.yaml")))
    sig_items = []
    for p in sorted(files):
        try:
            st = os.stat(p)
            sig_items.append(f"{os.path.basename(p)}:{int(st.st_mtime)}:{st.st_size}")
        except Exception:
            continue
    return hashlib.sha256("|".join(sig_items).encode("utf-8")).hexdigest()

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/rows")
def api_rows():
    dirpath = request.args.get("dir", "").strip()
    if not dirpath or not os.path.isdir(dirpath):
        return jsonify([])
    return jsonify(_load_dir(dirpath))

@app.route("/api/version")
def api_version():
    dirpath = request.args.get("dir", "").strip()
    if not dirpath or not os.path.isdir(dirpath):
        return jsonify({"sig": ""})
    return jsonify({"sig": _dir_signature(dirpath)})

@app.route("/api/export/json")
def api_export_json():
    dirpath = request.args.get("dir", "").strip()
    if not dirpath or not os.path.isdir(dirpath):
        return jsonify([])
    return jsonify(_load_dir(dirpath))

@app.route("/api/export/csv")
def api_export_csv():
    dirpath = request.args.get("dir", "").strip()
    if not dirpath or not os.path.isdir(dirpath):
        return Response("", mimetype="text/csv")
    rows = _load_dir(dirpath)
    out = io.StringIO()
    out.write("foundation,cert_name,version_id_short,issuer,active,certificate_authority,transitional,deployments,valid_until,days_remaining\n")
    for r in rows:
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
    dirpath = request.args.get("dir", "").strip()
    if not dirpath or not os.path.isdir(dirpath):
        return Response("# Runbook\n\n_No directory provided._\n", mimetype="text/markdown")
    rows = _load_dir(dirpath)
    def md(s): return (s or "").replace("|","\\|")
    out = io.StringIO()
    out.write("# Certificate Rotation Runbook\n\n")
    cas = [r for r in rows if r["certificate_authority"]]
    leaves = [r for r in rows if not r["certificate_authority"]]
    cas.sort(key=lambda r: (r["days_remaining"] if r["days_remaining"] is not None else 9000000))
    leaves.sort(key=lambda r: (r["days_remaining"] if r["days_remaining"] is not None else 9000000))
    out.write("## Phase 1 — CAs\n")
    for r in cas: out.write(f"- **{md(r['foundation'])}** / **{md(r['cert_name'])}** `{r['version_id_short']}` — {r['days_remaining']}d (issuer: {md(r.get('issuer',''))})\n")
    out.write("\n## Phase 2 — Leaves\n")
    for r in leaves: out.write(f"- {md(r['foundation'])} / {md(r['cert_name'])} `{r['version_id_short']}` — {r['days_remaining']}d (issuer: {md(r.get('issuer',''))})\n")
    return Response(out.getvalue(), mimetype="text/markdown",
                    headers={"Content-Disposition":"attachment; filename=Runbook.md"})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=True)
