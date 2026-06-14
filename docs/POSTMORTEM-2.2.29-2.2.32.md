# Postmortem — OpenCode Add-on Reparatur (2.2.29 – 2.2.32)

_Zeitraum: 13.–14. Juni 2026_

## Ausgangslage

Das Add-on war über alle Versionen hinweg unbenutzbar: Es zeigte `[exited]` und
startete nicht. Nach dem Start-Fix folgten ein opencode-Crash und ein
Mobile-Problem. Insgesamt **fünf eigenständige Defekte** — jeder einzeln
diagnostiziert und **vor** dem Release verifiziert (kein Blind-Release).

---

## Die fünf gefundenen & behobenen Defekte

### 1. Add-on `[exited]` — Terminal-Reconnect-Loop  → 2.2.29

- **Symptom:** Container lief, aber das Terminal beendete sich bei jedem
  WS-Connect nach ~0,07 s, ttyd respawnte endlos → `[exited]`.
- **Ursache:** `opencode-session.sh` war **nicht ausführbar** (Modus 0644). tmux
  startete das Script → „Permission denied" → der einzige Window-Prozess stirbt →
  tmux-Session endet → ttyd-Loop. Betraf **alle** Vorgängerversionen.
- **Fix:** Executable-Bit gesetzt (in git **und** defensiv im Dockerfile-chmod).
  Zusätzlich den fehleranfälligen Mobile/Desktop-Proxy + Dual-ttyd-Layer durch
  **einen** ttyd auf `0.0.0.0:8099` (opencode in tmux) ersetzt.
- **Verifiziert:** Auf dem buildhost gebaut + gebootet → tmux-Session überlebt
  WS-Disconnect, 0 Respawn-Churn. Im Produktiv-Log bestätigt (Prozess lief 33 s
  statt 0,07 s).

### 2. arm64-Builds schlugen fehl  → ab 2.2.29

- **Ursache:** Die Dockerfile-Zeile für den `opencode.exe`-Symlink war auf
  `opencode-linux-x64` hartkodiert → auf arm64 (`opencode-linux-arm64`) brach
  jeder Build mit „No such file" ab.
- **Fix:** Paketname arch-abhängig aus `BUILD_ARCH` abgeleitet, Schritt
  nicht-fatal (das Runtime-`init` wählt das Binary ohnehin maßgeblich).
- **Verifiziert:** amd64 **und** arm64 bauen durch; Multi-Arch-Manifest komplett.

### 3. opencode crasht — Legacy-Projekt-Config  → 2.2.30

- **Symptom:** `An error occurred in Effect.tryPromise`, opencode fällt in die
  Shell.
- **Ursache (Zwischenbefund):** Eine **veraltete**
  `/homeassistant/.opencode/opencode.json` aus einer alten Add-on-Version
  (MCP-Pfad `python3 /usr/share/ha-mcp/server.py`) lag im persistenten
  Config-Verzeichnis. Das aktuelle Add-on schreibt sie nicht mehr.
- **Fix:** `init-opencode` erkennt den Legacy-Marker, archiviert die Datei nach
  `.bak` (nie destruktiv) und lässt die verwaltete Config übernehmen. Valide
  eigene Configs bleiben unangetastet.
- **Hinweis:** Stellte sich danach als **nicht** die eigentliche Crash-Ursache
  heraus (siehe #4) — die Bereinigung ist aber sinnvoll und bleibt drin.

### 4. opencode-TUI crasht — `/tmp` ist `noexec`  → 2.2.31  _(die eigentliche Crash-Ursache)_

- **Diagnose-Weg:** Bisektion zeigte: `opencode run`/`serve` laufen, nur das
  **interaktive TUI** crasht — und zwar **vor** dem App-Init (kein Log). cwd,
  Config und `TERM`/terminfo wurden sauber **ausgeschlossen**.
- **Ursache:** `/tmp` ist `noexec` gemountet (wegen `tmpfs: true`). opencode/bun
  extrahiert den nativen **opentui-Renderer** (~10 MB `.so`) nach `/tmp` und
  mappt ihn **ausführbar** — der Kernel verweigert das → TUI stirbt.
  `run`/`serve` brauchen den Renderer nicht.
- **Beweis on-device:** `/tmp` = `noexec` bestätigt, „EXEC /tmp: FAILED", und
  `TMPDIR=/data/tmp opencode` **öffnet das TUI**.
- **Fix:** Bun auf ein ausführbares `TMPDIR=/data/tmp` zeigen — in
  `opencode-session.sh`, einem profile.d-Snippet (jede Shell/jedes tmux-Fenster)
  und `/data/tmp` wird pro Boot angelegt + gesäubert.

### 5. Mobile: kein Scrollen  → 2.2.32

- **Ursache:** opencode ist ein Vollbild-TUI mit Maus-Reporting → auf
  Touch-Geräten tat Wischen nichts (xterm.js leitet Touch als Maus-Events
  weiter, scrollt nicht). Die alte Mobile-Weiche hatte das nicht echt gelöst
  (nur „kein tmux + größere Schrift").
- **Fix:** `touch-scroll.js` (gleiches Injektions-Muster wie `clipboard.js`)
  übersetzt Ein-Finger-Wischen in **Wheel-Events** am Touch-Punkt — nutzt exakt
  den Pfad, der beim Desktop-Mausrad schon opencode scrollt. No-op auf Desktop,
  tmux-Persistenz bleibt, kein Proxy zurück.
- **Verifiziert:** Auf dem Gerät bestätigt (Touch-Scroll funktioniert).

---

## Infrastruktur / Sonstiges

- **CI/CD-Pipeline auf dem buildhost** (kein GitHub Actions): Commit →
  Quality-Gates → amd64-Build+Publish → **Aktivierung erst nach existierendem
  Image** (eine Version wird nie vor ihrem Image beworben) → arm64 entkoppelt
  nach. Lief über alle vier Releases durchgehend automatisch und korrekt.
- **CHANGELOG korrigiert:** Die Labels **2.2.30/2.2.31 waren durch die
  Aktivierungs-Reihenfolge vertauscht** — Inhalte jetzt richtig zugeordnet.
- **Arbeitsweise:** Jede Ursache wurde **vor** dem Fix verifiziert; Zwischen-
  verdachte (Proxy, Legacy-Config, `TERM`, AppArmor, inotify) wurden explizit
  aus- bzw. eingegrenzt statt geraten.

---

## Endstand

Alle fünf Defekte behoben, **2.2.32** vollständig veröffentlicht (amd64 **+**
arm64). Add-on startet stabil, opencode-Agent läuft, Terminal auf **Desktop und
Mobile** benutzbar.

| Problem | Fix | Version |
|---|---|---|
| Add-on `[exited]` (Reconnect-Loop) | `opencode-session.sh` ausführbar + einzelner ttyd | 2.2.29 |
| arm64-Builds schlugen fehl | arch-abhängiger Binary-Symlink | 2.2.29 ff. |
| Legacy-Projekt-Config crasht opencode | Startup-Migration (archiviert nach `.bak`) | 2.2.30 |
| opencode-TUI-Crash (`Effect.tryPromise`) | `TMPDIR=/data/tmp` (umgeht `noexec`-`/tmp`) | 2.2.31 |
| Mobile: kein Scrollen | Touch-Drag → Wheel-Events (`touch-scroll.js`) | 2.2.32 |
