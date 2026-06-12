# Build & release process

## How it works
- **Quality gates** (`ci/run.sh`) run on **every commit**, via the build-host
  runner (1-min poll + instant trigger). They never build an image.
- **Image build is decoupled** from the version. The trigger is the file
  **`ci/RELEASE_TARGET`** (a version string), **not** `config.yaml`'s `version`.
- After gates pass, the runner builds + pushes a **multi-arch** image
  (`linux/amd64` + `linux/arm64`) **only when `ci/RELEASE_TARGET` names a version
  that hasn't been built yet** (tracked in `state/last-built-version`).
- The version in `config.yaml` is set **last** — so Home Assistant never sees a
  version before its image exists.

## Release a new version `X.Y.Z`
1. (optional) Add notes under `## Unreleased` in `ha_opencode/CHANGELOG.md`.
2. Set `ci/RELEASE_TARGET` to `X.Y.Z`, commit, push to `main`.
   → build host: gates run; if green, builds + pushes
   `ghcr.io/umrath/ha_opencode:X.Y.Z` (+ `:latest`), amd64 + arm64.
3. **After the image exists**, set `version: "X.Y.Z"` in `ha_opencode/config.yaml`,
   commit (`[skip ci]`), push. HA now sees `X.Y.Z` and the image is present.
   - Or set `CI_AUTO_ACTIVATE=1` (needs `CI_PUSH_REMOTE`) to let the runner do
     step 3 automatically right after a successful push.

A commit that does **not** change `ci/RELEASE_TARGET` runs the gates only — no image.

## Triggering
- **Automatic:** systemd timer detects new commits within ~1 min.
- **Instant:** `ssh root@buildhost /opt/ci/hass-opencode/bin/run-ci.sh`

## Check status (on the build host)
```sh
cat  /opt/ci/hass-opencode/state/last-result        # gates
cat  /opt/ci/hass-opencode/state/last-image-result  # IMAGE_OK / IMAGE_FAIL <version>
cat  /opt/ci/hass-opencode/state/last-built-version
tail /opt/ci/hass-opencode/logs/latest.log
```

## Builder
Builds use the dedicated `ci-multiarch` buildx builder (amd64 + arm64 via qemu).
The production `multiarch` builder is never touched. Override via
`/etc/default/hass-opencode-ci`: `CI_BUILDX_BUILDER`, `CI_BUILD_PLATFORMS`, `CI_DOCKER_CONFIG`.
