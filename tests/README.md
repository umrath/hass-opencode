# Test suite

Dependency-light `unittest` tests for the app metadata, build, assets and
boot wiring. They run with **stdlib `unittest` + PyYAML only** — no pytest, no
pip — so they work anywhere the CI YAML checks already run (including the build
host, which has no pip).

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

The CI orchestrator runs them as check `25-unittests` (see [`../ci/`](../ci/)).

## Coverage

| File | Verifies |
|------|----------|
| `test_config_yaml.py` | config.yaml structure + invariants for stable & beta: required keys, slug/image agreement, `init:false` for s6, ingress port 8099, **options ↔ schema parity**, valid schema type specs, masked secret fields, list-default validity, only the LAN-server port declared. |
| `test_repository_yaml.py` | `repository.yaml` keys and umrath/GitHub URL. |
| `test_build_yaml.py` | `build_from` covers every config arch, HA Debian base, pinned build args, OCI labels. |
| `test_assets.py` | icons/logos exist and are real PNGs; per-add-on DOCS/CHANGELOG; root README + UNLICENSE. |
| `test_changelog.py` | CHANGELOG exists, has headings, and documents the current version **or** an `## Unreleased` section. |
| `test_translations.py` | each translation's `configuration:` keys match config options (parity), every entry has name + description. `en` required; more languages validated automatically when added. |
| `test_dockerfile.py` | multi-stage hab builder, final stage `FROM $BUILD_FROM`, core tooling, ttyd/opencode/prettier, `COPY rootfs /`, WORKDIR, ttyd HEALTHCHECK, `io.hass.*` labels. |
| `test_s6_structure.py` | every s6 service has a valid `type`; longrun→`run`, oneshot→`up`/`run`; `user/contents.d` and dependencies reference existing services. |

## Scope note

Assertions reflect *this* repo's contracts. Tests are intentionally **not**
copied verbatim from `../hass-opencode`: that variant asserts feature choices
this base hasn't adopted (e.g. `llm_model`, `ssl`/`share` maps, `tmpfs`,
`terminal_password`). Those remain open gaps (M1–M3), not regressions, so they
are not encoded here. When such a feature lands, add the matching assertion.
