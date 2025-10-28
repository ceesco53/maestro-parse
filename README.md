# Maestro Certificate Rotation Dashboard

A lightweight, zero-dependency operational dashboard for visualizing and planning
certificate rotations in **VMware Tanzu Application Service (TAS / PAS)** environments.

This tool reads **Tanzu Maestro Topology** YAML export data and provides:
- 🔥 Expiration timeline visualization (SLA-coded)
- ⚙️ Dependency-aware certificate chain view (roots → intermediates → leaves)
- 📊 Insights heatmap of rotation workload over the next 12 months
- ✅ Auto-refresh when YAML files change on disk
- 📄 CSV + JSON exports
- 📝 Automated rotation **Runbook.md** generation

> Designed to support Operations Manager 3.x / TAS 6.x certificate rotation workflows.

---

## ✨ Features

| Area | What you get |
|------|--------------|
| **Timeline** | SLA-coded expiration bars sorted by urgency |
| **Table** | Full metadata including deployments and issuer relationships |
| **Chains** | Scrollable card-style chain graphs with: <br/>▪ Depth tiers ▪ Transitional CA grouping ▪ Violation highlighting |
| **Insights** | Rotation splash analysis: <br/>▪ Monthly small multiples ▪ Weekly histogram ▪ Calendar strip |
| **Exports** | CSV plan, JSON raw data, Markdown runbook |
| **Watch Folder** | Auto-reload every 30s + fast change detection |

---

## 📦 Install & Run

### Requirements
- Python 3.8+
- macOS, Linux, or WSL2

### Install
```bash
git clone <your-repo-url>
cd maestro_dashboard
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt