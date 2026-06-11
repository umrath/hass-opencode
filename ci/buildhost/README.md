# Build-host CI pipeline

A small, self-contained CI/CD runner for the build host — **no GitHub Actions,
no third-party CI service**. It polls the tracked branch and runs the in-repo
quality gates ([`../run.sh`](../run.sh)) whenever a new commit appears.

## Design / safety

- **Fully isolated.** Everything lives under `/opt/ci/hass-opencode/`:
  - `repo/`   — its own dedicated git clone (never the image-build checkout at
    `/opt/hass-opencode`)
  - `bin/run-ci.sh` — the runner
  - `logs/`   — one log per run + `latest.log` symlink
  - `state/`  — `last-sha`, `last-result`
- **Never touches** `/opt/hass-opencode` or the `buildx` builder.
- **Polite:** runs `Nice=10`, `IOSchedulingClass=idle`, single-flighted with
  `flock` — it cannot starve the image builds.
- **Graceful before merge:** if a revision has no `ci/run.sh` yet, the runner
  records `SKIP` and exits 0, so the timer can be enabled ahead of the merge.

## Install

On the build host, from a checkout of this repo:

```sh
sudo ci/buildhost/install.sh            # install + enable the 5-minute timer
sudo ci/buildhost/install.sh --no-timer # install files only
```

Trigger a run immediately:

```sh
systemctl start hass-opencode-ci.service
journalctl -u hass-opencode-ci.service -n 50 --no-pager
cat /opt/ci/hass-opencode/state/last-result
tail -n 40 /opt/ci/hass-opencode/logs/latest.log
```

Run by hand (no systemd):

```sh
/opt/ci/hass-opencode/bin/run-ci.sh --force
```

## Configure

Edit `/etc/default/hass-opencode-ci`:

```sh
CI_REMOTE=https://github.com/umrath/hass-opencode.git   # any git remote
CI_BRANCH=main
CI_LOG_KEEP=50                                           # run logs to retain
```

`CI_REMOTE` is just a git remote to poll — point it at GitHub, Codeberg, a
mirror, or a local bare repo. The runner only ever **reads** from it.
`CI_LOG_KEEP` caps `logs/` to the most recent N run logs (default 50); older
ones are pruned after each run.

## Uninstall (clean, leaves nothing behind)

```sh
systemctl disable --now hass-opencode-ci.timer
rm -f /etc/systemd/system/hass-opencode-ci.service \
      /etc/systemd/system/hass-opencode-ci.timer \
      /etc/default/hass-opencode-ci
systemctl daemon-reload
rm -rf /opt/ci/hass-opencode      # logs, state, and the CI clone
```
