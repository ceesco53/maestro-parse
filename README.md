
# Maestro Certificate Rotation (JSON) — v1.5 (Dark)

A lightweight, JSON-first dashboard to analyze **Tanzu Application Service** certificate rotations.

## Features
- Drag/drop **JSON** (nested `signs[]`) — C1 expansion (every node → row)
- Tabs: **Table**, **Timeline**, **Chains**, **Insights** (Monthly/Calendar), **Deployments**, **Foundations**
- **SLA filter** (All, ≤30, ≤60, ≤90) applies globally
- **Calendar Strip** (Insights): Month + Foundation (first `p-bosh-*`), small squares (5 per row), hover tooltips, click → cross-tab highlight
- **Cross-tab highlight**: select anywhere → glow & scroll in Table/Chains/Calendar; ESC clears
- **Foundations**: exact-match mapping for raw `p-bosh-*` IDs; **Auto-suggest** (`bosh-<last6>`); LocalStorage; Export/Import JSON

## Run
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
# open http://127.0.0.1:5000
```

## JSON expectations
Each certificate object may include:
- `name`, `is_ca`, `issuer`, `location`, `product_guid`
- `valid_from`, `valid_until` (ISO 8601)
- `deployments` (array of strings; foundation derived from first `p-bosh-*`)
- `rotation_status`, `rotation_procedure_name`, `rotation_procedure_url`
- `signs` (array) — nested certificates signed by this certificate

**C1 Expansion:** Every object (root, intermediate, leaf) becomes a normalized row with `depth` and `root_name`.

## Notes
- Calendar strip hides empty foundations (your choice B).
- Dark theme everywhere.
- No external dependencies beyond Flask + python-dateutil.
