# 03 — Open questions

All answered.

## Q1 — How to bring in the base project

Recommendation: **real fork with an `upstream` remote.** Clone sf-voice-starter with history into this repo, keep the shared files at their original paths and unmodified, add BYOC work as new files. Standalone (no runtime dependency on the base), and a base fix arrives with `git merge upstream/main`. Shared-file bugs get fixed in the base first, then merged.

Alternatives: plain copy (simplest, fixes must be ported by hand); extract the shared core into its own package consumed by both repos (cleanest, but means restructuring the base repo now).

**A:** Decided (delegated): fork with `upstream` remote. Done locally 2026-10-13 — `main` starts at upstream `025185f`. No GitHub repo created yet.

## Q2 — What "company-agnostic" means here

The guide is specific to one package: permission set names, the platform event, the configuration object, and the external-system fields. Proposal: all of these are settings (one profile per vendor package), the flow and the hand-off form stay Webex Connect–shaped, and no vendor name appears in code or UI text.

- Is a Webex Connect–shaped flow acceptable, or must the Webex side be pluggable too?
- May the the tested vendor's values ship as the default profile, or must defaults be empty?

**A:** Any vendor's BYOC package must work. No company/customer name anywhere in the repo — generic names only, no vendor defaults shipped. Vendor-specific values live in settings (local, gitignored profile).

## Q3 — Phase 0 inputs

- Package version id (`04t…`) or install URL, and installation key if any
- Dev Hub alias to use
- The exact channel-vendor match string to test with

**A:** Package id supplied (kept in local settings). Dev Hub: the one used for the spike is correct; it must be a setting in the config UI.

## Q4 — Scratch definition

- The file is `config/project-scratch-def-scv.json`; you referred to `project-scratch-def.json`. Rename, or keep both names?
- It includes `ServiceCloudVoicePartnerTelephony:2`. Is Voice setup out of scope here (BYOC only)?
- It has no `LightningServiceConsole`, which the base def has. Add it (needed for a console app with the Omni-Channel utility), or must the file stay exactly as supplied?

**A:** Renamed to `config/project-scratch-def.json`. Voice feature stays (needed later for CCaaS). `LightningServiceConsole` added.

## Q5 — chatWidget page

- `data-bind`, `data-guid` and the `attachuk.imi.chat` host are fixed to one Webex tenant/widget. Deploy as-is, or make them hand-off inputs?
- The page label carries a customer name — keep or neutralise?
- The file sits in `force-app/pages/`; the base layout is `force-app/main/default/pages/`. OK to move?
- Opened as the logged-in admin at `/apex/chatWidget`, or does it need to be public (Site)?
- Does the widget show a pre-chat form? If so, which fields and test values?

**A:** Widget markup = textarea in the config UI (content inside `<apex:page>`), supplied widget as the local default. No pre-chat form. Page label to be made generic.

## Q6 — Who drives the end-to-end test

Option A: Playwright does everything — sends the widget message, goes Online in Omni-Channel, accepts the work item, asserts the conversation content.
Option B: the script opens both pages and waits; you chat and accept; the script asserts through the API (`AgentWork` accepted, `MessagingSession` active) plus one check that the Enhanced Conversation component rendered the message.

A is fully hands-off but depends on third-party widget selectors. Which one?

**A:** Option A — Playwright drives everything; must be CI-capable.

## Q7 — Users

- Run As user for the Webex Connect ECA: the org's admin user (the one the CLI is authenticated as)?
- Is that same user also the test agent (queue member, presence, agent permission sets)?

**A:** Org admin user (System Administrator) is the Run As user and also the test agent.

## Q8 — Routing values

The guide leaves routing configuration "according to needs". Values to use: routing priority, routing model (Least Active / Most Available), capacity type and units?

**A:** Priority 1, Most Available, Units of Capacity 1; everything else default.

## Q9 — Existing org

Per the guide, if a messaging channel already exists on the same Conversation Channel Definition, a new channel inherits that definition's External Client App. When reusing an org in that state: stop with an error, or reuse the existing ECA link and continue with a warning?

**A:** Dropped — always create a new org.

## Q10 — Secrets

The consumer secret and the Webex Service Secret will be shown in / typed into the local config UI. Keep them in memory only for the run (re-read from the org on restart), or is writing them to the gitignored `.env` acceptable?

**A:** May go in the gitignored `.env`; must never be pushed.

## Q11 — Consumer key/secret hand-off (confirm my reading)

Your answer, as I understand it: the script clicks **Consumer Key and Secret** on the Webex Connect ECA (which sends the verification email); the hand-off screen then shows the org domain and channel address identifier filled in, and the consumer key and secret fields **empty**; you complete the verification in Salesforce and copy the two values yourself.

- Should those two fields be inputs (you paste the values back so the script can test the token request), or display-only placeholders?
- The configuration record also needs the **Interaction API** ECA's consumer key. If Phase 0 finds no API path for it, it gets the same treatment (an extra input on the hand-off form). OK?
- Phase 0 still checks for an API path first; if one exists the fields are simply pre-filled.
- CI: an emailed code cannot be automated, so a CI run needs the API path or pre-supplied values.

**A:** Confirmed. Script clicks **Consumer Key and Secret** on the client-credentials ECA to trigger the email (goes to the Dev Hub user's address); the hand-off shows key/secret fields empty; the user fetches them. Interaction API ECA: deploy it with a consumer key we specify, so nothing has to be retrieved — the config record needs only that client id + the name of the certificate uploaded to it. CI is out of scope.

## Q12 — Automated Process permission set is missing from this package

The tested package contains two permission sets (Agent, Configuration Admin). The guide (doc version 6.0) requires a third, "Automated Process", selected on the Interaction API ECA and assigned to the `autoproc` user by Apex. Is this the intended package version? If yes: skip both steps when the permission set is not configured, or use a different permission set?

**A:** Create our own permission set; assign it on the Interaction API ECA and to the `autoproc` user. Its purpose is to give `autoproc` access to that ECA.

## Q13 — Configuration record timing

Webex Tenant, Service Id and Service Secret are required fields on the configuration object, so the record cannot be created before the hand-off. Proposal: create it once, complete, right after you submit the Webex values. OK?

**A:** Yes — create once, complete, after the hand-off.

## Q14 — Vendor name in docs

"No company names": does that include `docs/` and `CLAUDE.md`, which cite the vendor's guide URLs and the names read from the spike org?

**A:** Yes — no vendor name in any tracked file. Vendor specifics live in `docs/vendor-notes.local.md` and local settings (both gitignored).

## Q15 — Platform key vs. channel address identifier

On a channel created through the API the two values differ (the guide says they are identical when created in Setup). On your working org: are `MessagingPlatformKey` and `ChannelAddressIdentifier` the same on the channel, and which value is in the configuration record and in the external system's request body?

**A:** Same value, as shown in Messaging Settings. Resolved: insert the channel without a platform key and the platform makes the two equal.

## Q16 — Your working External Client App metadata

You have already deployed the Interaction API ECA with a chosen consumer key. Can you drop the metadata files for both ECAs (all `eca*` files, secrets removed) into `vendor/` (gitignored)? Templating from a known-good set is safer than deriving them. If not, I build both in the spike org's Setup with Playwright, retrieve, and compare against the guide line by line.

**A:** Build from scratch. Done in the spike org — see "External Client Apps — proven as metadata" in `01-analysis.md`.

## Q17 — "Messaging" switch in Messaging Settings

In the spike org the switch at the top of Setup → Messaging Settings is Off (channels were created through the API). On your working org is it On? The guide does not mention it.

**A:** Off is correct — that switch is a separate feature. Leave it alone.

## Q18 — Consumer key/secret: generated instead of emailed

The script can choose both values and set them when the app is created (token request proven). The hand-off would then show all four values filled, with no email step. Use this instead of the email-trigger flow agreed in Q11?

**A:** Yes — generate key and secret, show all four values filled, no email step.

## Decisions, 2026-10-13 (after the first clean run)

- The discovery org was deleted.
- A setup run never deletes or replaces an org: if the alias is in use it stops and asks for a different name.
- Agent → customer check in the connection test: later.
- The Enhanced Conversation record page is the org-wide default for Messaging Session.
- The external-system fields are Webex-shaped by design, one set per configuration record.
- The config UI is a guided, four-step page: set up the org → configure the external system → enter its details → run the connection test.
- README rewritten; nothing committed until the repository exists.
