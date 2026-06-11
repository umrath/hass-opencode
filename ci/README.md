# CI quality gates

Portable, dependency-light quality checks for the hass-opencode add-on. They run
**anywhere** — a developer laptop, the build host, or any future CI — with no
GitHub Actions dependency. The build host runs them automatically (see
[`buildhost/`](buildhost/)).

## Run locally

```sh
ci/run.sh              # everything
ci/run.sh --quick      # fast: skip vitest + Docker-based linters
ci/run.sh --no-js      # skip the Node vitest suites
ci/run.sh --no-docker  # skip checks that pull Docker images
ci/run.sh 10 40        # run only checks 10-* and 40-*
```

Exit code `0` = all blocking checks passed (advisory warnings are allowed),
`1` = a blocking check failed.

## Checks

| # | Check | Type | What it verifies |
|---|-------|------|------------------|
| 10 | `yaml` | **blocking** | Every tracked `*.yaml`/`*.yml` parses with PyYAML. |
| 20 | `config-sync` | **blocking** | `options` keys ↔ `schema` keys match in each `config.yaml`. |
| 30 | `changelog` | advisory | The `version:` in each `config.yaml` has a `## <version>` CHANGELOG heading. |
| 40 | `shell-syntax` | **blocking** | `bash -n` on all shell scripts (s6 run/finish, profile.d, bin, hooks). |
| 50 | `shellcheck` | advisory | shellcheck lint of the boot-path scripts (local binary or Docker). |
| 60 | `hadolint` | advisory | hadolint lint of `ha_opencode/Dockerfile` (local binary or Docker). |
| 70 | `js-tests` | **blocking** | `vitest` suites for the bundled MCP and LSP Node servers. |

Advisory checks **never fail the build**; they surface warnings only. This keeps
the gate green while still reporting drift (e.g. a not-yet-released version with
no CHANGELOG entry) without blocking a parallel release workflow.

## Requirements

- **Always needed:** `bash`, `python3` + PyYAML (for YAML/config/changelog checks).
- **For JS tests:** `node` + `npm` (dev deps are installed on demand).
- **For advisory linters:** a local `shellcheck` / `hadolint`, or `docker`
  (the images `koalaman/shellcheck` and `hadolint/hadolint` are used as a
  fallback). Missing all of these → the check skips, it does not fail.

## Adding a check

Drop a `NN-name.sh` into `checks/`, source `../lib.sh`, use `pass`/`fail`/`warn`/
`skip`, and end with `finish_check; exit $?` (blocking) or `exit 0` (advisory).
`run.sh` picks it up automatically in numeric order.
