# Gap-Analyse: `hass-opencode-github` als neue Basis

**Stand:** 2026-06-11 · **Basis-Version:** 2.1.1 (zum Analysezeitpunkt; inzwischen 2.2.0 im Working-Tree)

Diese Analyse betrachtet `hass-opencode-github` (im Folgenden „Basis") als die führende
Code-Basis und vergleicht sie mit den drei Schwester-Repositorien unter `../hass-*`.
Ziel: feststellen, was die anderen Repos haben, das der Basis fehlt — gewichtet nach
Relevanz.

## Ausgangslage – die vier Repos

| Repo | Upstream | Version | Agent | Architektur | Rolle |
|------|----------|---------|-------|-------------|-------|
| **hass-opencode-github** *(BASIS)* | `github.com/umrath` | **2.1.1** | OpenCode | Debian + nodesource Node 22, `npm install opencode-ai` (Prebuilt-Binary), **s6-overlay** | Neue Basis – feature-reich |
| hass-opencode-compare | `github.com/magnusoverli` | 2.1.0 | OpenCode | identisch zur Basis | **Upstream der Basis** (Fork-Ursprung) |
| hass-opencode *(Codeberg)* | `codeberg.org/umrath` | **3.9.0** | OpenCode | Alpine + **Source-Build aus Bun**, Python-MCP/Proxy, `init: true` (tini) | Eigene „lean"-Parallelversion |
| hass-claude | `github.com/sproft` | 1.2.72 | Claude Code | Debian, Claude-CLI | Schwesterprojekt (anderer Agent) |

**Relevanz-Gewichtung der Vergleichsquellen:**

- `hass-opencode-compare` ist der **Ursprung** der Basis → enthält nichts, was die Basis
  nicht schon hat (Basis ist 2.1.1 > 2.1.0). **Nur als Upstream zu beobachten, keine echten Gaps.**
- Das **Codeberg-`hass-opencode` (3.9.0)** ist die mit Abstand wichtigste Vergleichsquelle:
  gleicher Autor, gleicher Agent, aber **deutlich reifere Engineering-Disziplin** und mehr
  UX-Optionen. → **Hohe Relevanz.**
- `hass-claude` liefert v. a. „Parity-Patterns" (anderer Agent) → **mittlere Relevanz.**

Die Basis ist funktional am reichsten (Custom-JS-MCP mit 33 Tools, JS-LSP, `hab`-CLI,
zigporter, Chromium-Screenshots, PPQ-Proxy, ttyd-Clipboard, 10 Themes). Die Lücken liegen
fast ausschließlich bei **Qualitätssicherung, Härtung und UX-Optionen**, nicht bei Features.

---

## Findings nach Relevanz

### 🔴 Hoch – sofort angehen (Quelle: Codeberg 3.9.0)

| # | Finding | Basis hat | Andere haben | Beschreibung |
|---|---------|-----------|--------------|--------------|
| **H1** | **Qualitäts-CI fehlt komplett** | nur `build`/`release`/`check-hab-update` | Codeberg: hadolint, YAML-Parse, **options↔schema-Sync**, **version↔CHANGELOG-Sync**, Unit-Tests, shellcheck, `bash -n`, Docker-Build-Smoke, **Boot-Smoke**, **dlopen-Check** | Die Basis hat **kein einziges Test-/Lint-/Validierungs-Gate** – ein kaputtes `config.yaml` oder Boot-Skript erreicht ungeprüft das Release. Größter Hebel. |
| **H2** | **Automatisierte Test-Suite** | nur ad-hoc JS-Unit-Tests (MCP/LSP), **nicht in CI** | Codeberg: 13 pytest-Dateien (`test_config_yaml`, `test_dockerfile`, `test_apparmor`, `test_changelog`, `test_translations`, `test_mcp_server`, `test_mobile_proxy`, …) | Strukturierte Tests, die Konfig, Dockerfile, Assets und Übersetzungen gegen Regressionen absichern. |
| **H3** | **Explizites AppArmor-Profil** | `apparmor: true`, **aber keine `apparmor.txt`** → HA-Default | Codeberg **und** Claude liefern gehärtetes, reviewtes `apparmor.txt` (Codeberg testet es zusätzlich) | Sicherheits-Härtung. Ein Add-on mit `hassio_role: manager` + Schreibzugriff auf die HA-Config sollte ein bewusstes Profil mitliefern. |

### 🟠 Mittel – mittelfristig (überwiegend Codeberg, teils Claude)

| # | Finding | Basis hat | Andere haben | Beschreibung |
|---|---------|-----------|--------------|--------------|
| **M1** | **UX-Optionen** | – | Codeberg: `llm_model` (Modellwahl!), `default_agent` (build/plan), `auto_approve`, `terminal_password`, `working_directory`, `session_persistence`-Toggle, `reset_data`, `enable_telemetry` | Basis bietet keine UI-Modellauswahl und kein Terminal-Passwort. Besonders `llm_model` und `terminal_password` sind sichtbare Lücken. |
| **M2** | **Breitere Mounts** | nur `homeassistant_config`, `addons`, `addon_configs` | Codeberg/Claude: zusätzlich `ssl:ro`, `share:rw`, `media:rw`, `backup:ro` | Der Agent kann derzeit nicht auf `share`/`media`/`ssl`/`backup` zugreifen (z. B. für Backups oder Medien-Pfade). |
| **M3** | **Mehrsprachigkeit** | nur `en.yaml` | Codeberg + Claude: zusätzlich `es`, `pt-BR` | Übersetzungs-Gap bei der Add-on-Konfig-UI. |
| **M4** | **`env_vars`-Härtung** | `env_vars` vorhanden | Codeberg: Reserved-Name-Blocklist (`HOME/PATH/SUPERVISOR_TOKEN`), Shell-Identifier-Check, `chmod 600` | Validierung der Secrets/Env-Injektion fehlt der Basis möglicherweise. |
| **M5** | **tmpfs-Scratch** | – | Codeberg: `tmpfs: true` (RAM-backed `/tmp`) | Schont Flash (Wear) und räumt Scratch-Files bei Neustart auf. |
| **M6** | **AGENTS.md überschreibt User-Edits** | regeneriert bei jedem Boot | Codeberg-Plan: nur überschreiben, wenn Marker-Kommentar noch vorhanden | User-Anpassungen an `AGENTS.md` gehen beim Neustart verloren. |
| **M7** | **CONTRIBUTING.md + echte LIZENZ** | nur `UNLICENSE` | Codeberg: `CONTRIBUTING.md` + `LICENSE` | Projekt-Hygiene/Onboarding. |
| **M8** | **Node-Heap-Cap** | – | Claude: `NODE_OPTIONS=--max-old-space-size=512` | Verhindert OOM auf RAM-schwachen HA-Geräten. |

### 🟢 Niedrig / bewusst zu dokumentieren (architektonisch)

| # | Finding | Beschreibung |
|---|---------|--------------|
| **N1** | **Source-Build vs. Prebuilt-Binary** | Codeberg baut OpenCode **aus dem Source interpretiert**, um den Bun-`$bunfs`-FFI-Bug (#30717, `libopentui.so` dlopen) zu umgehen. Die Basis nutzt das Prebuilt-Binary auf Debian/glibc – einfacher, aber fragil, falls das Binary auf einer Arch regrediert. **Empfehlung:** zumindest den **dlopen-Smoke-Check** aus Codeberg übernehmen. |
| **N2** | **Alpine vs. Debian + Chromium** | Codeberg = Alpine (klein). Basis = Debian + Chromium (~200 MB größer) für Screenshots. Bewusster Trade-off, **kein Gap**. |
| **N3** | **`auto_update` mit Timeout** | Claude hat `auto_update_claude` + `claude_update_timeout`. Basis hat `opencode_update_policy` (latest/bundled), aber kein User-Timeout. Geringfügig. |
| **N4** | **Upstream-Tracking** | `hass-opencode-compare` (magnus) als Fork-Ursprung weiter beobachten für künftige Fixes/Features. |

---

## Empfehlung – Reihenfolge

1. **H1 + H2 + N1** zusammen: Qualitäts-Gates portieren (Lint, options↔schema-/
   version↔CHANGELOG-Sync, Test-Suite, Boot- und dlopen-Smoke). → schützt sofort vor
   kaputten Releases, **höchster Hebel, kein Funktionsrisiko**.
2. **H3**: gehärtetes `apparmor.txt` von Codeberg adaptieren (Pfade an s6/Debian-Layout anpassen).
3. **M1/M2**: schrittweise UX-Optionen (`llm_model`, `terminal_password`, `working_directory`)
   + Mounts (`share`/`media`/`ssl`/`backup`) ergänzen.
4. **M3–M8**: Übersetzungen, env_vars-Härtung, tmpfs, AGENTS.md-Schutz, CONTRIBUTING/LICENSE,
   Node-Cap.

## Umsetzungsstand

- **H1 — umgesetzt.** Portable Qualitäts-Gates unter [`ci/`](../ci/) (YAML-Parse,
  options↔schema-Sync, version↔CHANGELOG (advisory), `bash -n`, shellcheck/hadolint
  (advisory, Docker-Fallback), vitest für MCP/LSP). Ausführung über `ci/run.sh`.
  Auf dem Build-Host läuft eine isolierte Poll-and-Run-Pipeline
  (siehe [`ci/buildhost/`](../ci/buildhost/)) — **kein GitHub Actions**, eigener Clone,
  systemd-Timer, vollständig entfernbar. End-to-End auf dem Build-Host grün verifiziert
  (7/7 Check-Gruppen).

## Hinweis zu vorhandenen Codeberg-Docs

Die Codeberg-Version enthält bereits `docs/gap-analysis-2.1.6.md`,
`docs/plan-consolidated-adoption.md` und `docs/proposal-magnus-adoption.md` – allerdings aus
der **umgekehrten** Perspektive (lean → magnus). Da jetzt die magnus-artige Basis führt,
kehren sich die meisten dortigen „Not adopting"-Entscheidungen um: LSP/MCP/s6/Chromium **sind**
in der Basis bereits vorhanden – die offenen Punkte sind genau die oben gelisteten
Qualitäts-, Härtungs- und UX-Lücken.
