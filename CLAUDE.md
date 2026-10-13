# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication Rules

Be extremely concise and keep responses to the absolute minimum required.

- Do not explain obvious things.
- Do not repeat the user's requirements.
- Do not provide lengthy summaries unless explicitly requested.
- Do not describe every implementation step.
- Do not produce large amounts of commentary while working.
- Prefer short bullet points over paragraphs.

When the work is complete, report only:

- what changed
- important issues/blockers
- anything that requires user attention

## Architectural changes

1. Inspect the current implementation.
2. Identify the actual problem.
3. Consider the smallest robust solution.
4. Check whether an existing abstraction can solve it.
5. Implement only what is necessary.

If a substantially better design exists, explain it briefly and recommend it before making the change.
Do not introduce architectural changes merely because they are theoretically cleaner.

## Project

Internal, non-production tool: creates a Salesforce scratch org, installs a "Partner Messaging" (BYOC / BYOOTT) managed package, configures the org for it, and proves the chat round trip with the external messaging system. Forked from `azanatta/sf-voice-starter` (git remote `upstream`).

## Commands

```bash
npm install                  # also installs Playwright's Chromium
npm run configure            # config UI on 127.0.0.1:4747 — the normal way to run everything
npm run setup                # stage 1 from the terminal (needs the env loaded, see below)
npm run connect -- --org=<alias>   # stage 2: configuration record + connection test
npm run setup -- --list      # phases
npm run setup -- --org=<alias> --only=<phase>[,<phase>]   # re-run phases against an existing org
npm run setup -- --delete    # delete the scratch org behind the configured alias
npm run typecheck
```

The CLI reads `process.env` only. From a terminal use `npx tsx --env-file=.env src/cli.ts …`; the config UI passes its form values itself. `--headed` shows the browser.

`npm test` and `--only=verify` are upstream Voice checks and do not apply here.

## Architecture

Two stages, never run together, because the second needs values a person supplies in between:

1. **Setup** (`npm run setup`): `preflight` → `byoc-create-org` → `install-package` → `certificate` → `byoc-org-prep` → `byoc-client-apps` → `byoc-channel` → `byoc-handoff`. Reaching `byoc-handoff` is "install success"; it records four values (org domain, channel address identifier, consumer key, consumer secret) for the external system.
2. **Connect** (`--connect`): `byoc-config-record` → `byoc-e2e`. Writes the package configuration record from the external-system values, then Playwright sends a message from the chat widget, accepts the work item in Omni-Channel and asserts the message is shown in Enhanced Conversation.

Where things live:

- `src/cli.ts` — phase runner (upstream) with the phase list above. Upstream Voice phases stay in `src/phases/NN-*.ts`, imported but not in the pipeline.
- `src/phases/byoc-*.ts` — one file per messaging phase. Each is idempotent and verifies by reading back.
- `src/byoc/` — org helpers (`org.ts`), channel-definition lookup, and `state.ts`.
- `config/settings-schema.ts` (upstream) + `config/byoc-settings.ts` — every setting, defined once; the config UI form, `.env` writer and typed config (`config/byoc.config.ts`, `config/scv-setup.config.ts`) all derive from it. Never add a bare `process.env` read in `src/`.
- `tools/config-server.ts` + `tools/config-ui.html` — local guided UI in four steps (set up the org, configure the external system, enter its details, run the connection test), with the widget editor and run streaming. Step state comes from `generated/byoc/state.json`.
- `byoc-app/` — static metadata deployed as-is (presence statuses, permission sets, console app, Messaging Session record page, remote sites). Org-specific metadata is rendered into `generated/byoc/` at run time.
- `generated/byoc/state.json` — per-org state keyed by org id, including the generated consumer key/secret. The secret can only be set when the app is created and can never be read back, so losing this file means starting from a new org.
- `vendor/` (gitignored) — the chat widget embed code and anything else vendor- or tenant-specific.

Upstream merge hygiene: keep upstream names (`SCV_` env prefix, file names) and put new work in new files; `git merge upstream/main` should only ever conflict in `cli.ts`, `settings-schema.ts`, `tools/`.

## Hard rules for this repo

- The org configuration follows the package vendor's guide step for step (URLs in the gitignored `docs/vendor-notes.local.md`); `docs/01-analysis.md` maps every guide step to how it is done and what was proven. One missing permission or app setting breaks the connection with no useful error.
- Never guess an API name, metadata shape, permission or field. Read it from a live org (query, describe, retrieve) or ask. Record what you learn in `docs/01-analysis.md`.
- Must work with any vendor's BYOC package. No company or customer name anywhere in tracked files (code, UI text, docs, metadata labels, defaults) — vendor-specific values are settings kept in gitignored files (`.env`, `config/profiles.json`, `vendor/`, `docs/*.local.md`). Check with `git grep` before committing.
- The two external client apps differ on purpose (client credentials + Run As user vs. JWT bearer + certificate + pre-authorized profile/permission set). Never merge or cross their settings.
- Messaging channel: insert without a platform key and without `RoutingType`/`TargetQueueId`; route with `SessionHandlerId` only. The other fields are accepted and silently break the channel (see the analysis).
- Setup always creates a new scratch org and never deletes or replaces one: if the alias is in use it stops and asks for another name. A stage or phase is re-run against an existing org only with `--org=`.
- Secrets may live only in `.env` and `generated/`.
