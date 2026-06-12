# Defect analysis & fix guide (as of 2.2.19)

Scope: defects found reviewing the post-fork code, focused on the mobile/desktop
terminal switch and the image/release flow. Each item: **what** is broken,
**why**, and **how to fix**. The arm64 build is intentionally kept **decoupled**
from amd64 (amd64 must stay available earlier) — the build section honors that.

Severity: 🔴 high · 🟠 medium · ⚪ meta.

---

## 🔴 W1 — No terminal via ingress when `mobile_proxy_enabled: false`

**What.** With the proxy disabled, the add-on serves no reachable terminal.

**Why.** `rootfs/.../ha-opencode-desktop/run` always launches ttyd with
`-i 127.0.0.1`. In the non-proxy path it uses `PORT=8099` (the ingress port) but
still binds **loopback only**. HA ingress connects to the container's network IP,
not `127.0.0.1`, so nothing answers on the ingress port.

**Fix.** In the non-proxy path the ingress-facing ttyd must bind all interfaces:
drop `-i 127.0.0.1` (ttyd defaults to `0.0.0.0`) or pass `-i 0.0.0.0` when
`PORT == 8099`. Keep `-i 127.0.0.1` only for the proxy-backend ports (8098/8097).

---

## 🟠 W2 — s6 start order is inverted (proxy before its backends)

**What.** On boot the proxy can start before the ttyd backends exist; the first
connection can fail.

**Why.** `ha-opencode-desktop` and `ha-opencode-mobile` declare
`dependencies.d/ha-opencode-proxy`, so s6 starts the **proxy first** and the
backends after. The proxy only papers over this with a 2.5 s retry loop
(5 × 0.5 s); if ttyd needs longer, the connection is dropped.

**Fix.** Invert the dependency: make `ha-opencode-proxy` depend on
`ha-opencode-desktop` + `ha-opencode-mobile` (remove the reverse deps). Note that
s6 “started” ≠ “listening”, so **keep** the retry loop as a safety net regardless.

---

## 🟠 W3 — Profile switch relies on a fragile probe round-trip behind ingress

**What.** In proxy mode the ports line up (8099 → 8098/8097), but the actual
desktop/mobile selection often fails to take effect at runtime (stuck on one
profile).

**Why.** Selection depends on a chain that is brittle inside HA's ingress
**iframe**: the proxy only serves the JS touch-probe page when the request has
`Accept: …text/html`; the probe sets a `SameSite=Lax` `oc_profile` cookie and
reloads with `?mobile`/`?desktop`. If any link in that chain doesn't round-trip
(probe not served, cookie/query not carried on the ttyd WebSocket), the request
falls through to the `desktop` default — so the switch never happens.

**Confirm first.** This one needs a runtime log to pin exactly where it breaks:
the proxy's stdout (Supervisor add-on log) plus the browser Network tab (is the
probe served? is `oc_profile` set and sent on the WS upgrade? does `?mobile`
survive the ingress path rewrite?).

**Fix (once confirmed).** Remove the dependence on a separate probe round-trip:
either (a) carry the profile in the **path** the proxy routes on (e.g. the index
page links the ttyd WS through a `/m/`/`/d/` prefix the proxy maps to a backend),
or (b) decide server-side by UA for the unambiguous cases and expose an explicit
in-page toggle for the iPad/Mac ambiguity — instead of relying on a cookie that
must survive the iframe + ingress rewrite.

---

## 🟠 A1 — Dead, duplicate supervisor implementation

**What.** `rootfs/usr/share/oc-proxy/supervisor.py` is a second, complete
terminal supervisor (starts proxy + both ttyd as subprocesses, monitors, exits
on child death).

**Why.** It is referenced by nothing — the active model is the s6 bundle
(`ha-opencode-proxy` / `-desktop` / `-mobile`). Two competing implementations of
the same thing invite confusion and drift.

**Fix.** Pick one. The s6 bundle is the idiomatic, supervised choice → **delete
`supervisor.py`** (and any other leftover of the abandoned approach).

---

## 🔴 A2 — App image builds `FROM ghcr.io/umrath/ha_opencode-base:latest`, built outside the release flow

**What.** `ha_opencode/Dockerfile:16` bases the app on a prebuilt
`ha_opencode-base:latest`. `ci/buildhost/build-image.sh` builds only the app
Dockerfile — it never builds or pushes the base.

**Why it's a problem.**
- **Floating `:latest`** → non-reproducible builds; the app silently changes when
  the base moves, and there is no pin/digest.
- **Out-of-band base** → the base must be built/pushed manually; nothing in CI or
  the release flow guarantees it exists (and exists **for both arches**) before
  an app build. A missing/stale base breaks every app build (incl. the arm64
  builds that were observed cancelling).

**Fix.**
- Pin the base by **digest** (or an explicit version tag), not `:latest`.
- Build + push the base as part of the pipeline: a `build-base.sh` triggered when
  `Dockerfile.base` (or its pinned inputs) change, producing a **multi-arch**
  base (amd64 + arm64).
- Add a CI guard that the referenced base tag/digest exists for all target arches
  before the app build starts.

---

## 🔴 R1 / T2 — arm64 image missing for a released version (e.g. 2.2.19), unmonitored, racy

**What.** `ghcr.io/umrath/ha_opencode:2.2.19` (and `:latest`) is **amd64-only**;
the arm64 build was `Canceled`. arm64 hosts can't install/update → the version
doesn't appear for them in the store.

**Why.** `build-image.sh` builds amd64, publishes the manifest, then fires the
arm64 build **detached** (`nohup … &`):
- it **escapes** the runner's `flock`, so rapid releases (2.2.17/18/19 minutes
  apart) launch overlapping arm64 builds that cancel each other (“context
  canceled”);
- failures are **never recorded** — `last-image-result=IMAGE_OK` reflects only
  amd64;
- the background `imagetools create … :latest` on shared tags can **clobber**
  `:latest`/`:VERSION` (last-writer-wins across overlapping versions).

**Fix.** See the next section — keep amd64 fast, make arm64 decoupled **but
reliable**.

---

## Build redesign — decoupled arm64, kept correct

Requirement: **amd64 stays available earlier; arm64 follows asynchronously.** The
goal is to keep that property while removing the race, the silent failures, and
the manifest clobber.

**Phase 1 — amd64 (synchronous, inside the runner's flock).**
1. Build amd64, push `REF/amd64:VERSION`.
2. Publish `REF:VERSION` (and `REF:latest`, guarded — see below) as an amd64-only
   manifest. → amd64 users get the release immediately.
3. Record `last-built-version=VERSION`; enqueue arm64 by writing a marker
   `state/arm64-pending/VERSION`. **Do not** detach a build here.

**Phase 2 — arm64 (separate single-flighted worker).**
- A dedicated unit (e.g. `hass-opencode-arm64.{service,timer}`) with **its own
  flock** processes pending versions **one at a time** — so builds never overlap
  or cancel each other.
- For each pending VERSION: build arm64 → push `REF/aarch64:VERSION` → merge into
  the existing manifest: `imagetools create REF:VERSION REF/amd64:VERSION
  REF/aarch64:VERSION` (now multi-arch for that version).
- **`:latest` clobber guard:** only retag `:latest` to this VERSION if
  `VERSION == last-built-version` (the newest); otherwise update only
  `REF:VERSION`. Prevents an old, late-finishing arm64 build from pointing
  `:latest` back to a stale release.
- Record the result: `state/arm64-<VERSION> = OK|FAIL`. On failure, **keep** the
  pending marker for retry (with an attempt cap/backoff) and surface it (log /
  status), so arm64 gaps are never silent. The “retry in a few minutes” promise
  in the README only holds if this worker actually completes.

**Result.** amd64 is published first (unchanged user-visible speed); arm64 is
built exactly once per version, serialized, monitored, retried, and merged into
the same manifest without clobbering newer releases.

**Minimal alternative** (if a second unit is too much): build arm64 **after** the
amd64 publish but **still inside the runner's flock** (not detached). This
serializes and monitors arm64 correctly, at the cost of blocking the *next*
release's gates until arm64 finishes (~15-20 min) — acceptable only at a low
release cadence.

---

## ⚪ R2 / T3 — Auto-release process instability (root cause amplifier)

**What.** Many of the above defects were introduced and patched within the same
day (duplicate proxy startup, HEALTHCHECK removed→restored, duplicate CHANGELOG
headings, the base split), driven by frequent auto-releases (2.2.7→2.2.19).

**Why.** The auto-activate loop releases on essentially every change and the
CHANGELOG manipulation is fragile, so regressions ship and are hot-fixed in a
tight loop instead of being caught before release.

**Fix.**
- Decouple “build/validate” from “publish a user-facing version”: don't bump
  `config.yaml` on every commit; release deliberately (advance `RELEASE_TARGET`
  for a real release only).
- Make the CHANGELOG handling robust/idempotent (it caused repeated fixups).
- Optionally gate auto-activate behind a manual confirmation for stable releases.

---

## Priority

1. **A2** + **R1/build redesign** — fixes the registry/arm64 availability that
   makes releases (e.g. 2.2.19) unusable on arm64.
2. **W1** — non-proxy terminal reachability.
3. **W3** (confirm via logs, then fix) — the actual mobile/desktop switch.
4. **W2**, **A1**, **R2** — robustness and hygiene.
