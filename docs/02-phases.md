# 02 — Implementation phases

Status: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

Step ids (I1, C4, X5…) refer to `01-analysis.md`.

## Phase 0 — Discovery spike `[x]`

Everything in `01-analysis.md` marked proven was exercised in the spike org (`byoc-spike`).

## Phase 1 — Fork `[x]`

- [x] Base brought in with an `upstream` remote; shared files untouched except `cli.ts` (phase list, `--connect`), `settings-schema.ts` (one import + spread), the config server and UI
- [x] Voice phases left in the tree, out of the pipeline
- [x] Upstream names kept (`SCV_` prefix, file names) so merges stay clean; messaging settings use `BYOC_`

## Phase 2 — Stage A: org preparation `[x]`

- [x] `byoc-create-org`, `install-package` (upstream), `certificate` (upstream), `byoc-org-prep`

## Phase 3 — Stage A: apps and channel `[x]`

- [x] `byoc-client-apps` (with token checks for both apps), `byoc-channel`, `byoc-handoff`

## Phase 4 — Hand-off UI `[x]` code · `[ ]` tried by a person

- [x] Four copyable values, external-system form, widget editor, "Run connection test"

## Phase 5 — Stage B `[x]` code · `[~]` verified without the external system

- [x] `byoc-remote-site`, `byoc-config-record`, `byoc-e2e`
- [x] Configuration record + remote site (placeholder values), agent half of the test, widget dry run
- [x] Run against the real external system (passed 2026-10-13, 200 s, from the terminal)

## Phase 6 — Hardening `[ ]`

- [x] Clean first-stage run on a new org (246 s)
- [ ] Re-run of single phases (`--only=`) against the same org is a no-op
- [x] README rewritten
- [x] Guided four-step config UI; existing-alias guard
- [ ] Agent → customer assertion in the connection test (deferred)
