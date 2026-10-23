# 01 — Analysis

## Sources

- The package vendor's install / configure / troubleshooting guide (URLs in the gitignored `docs/vendor-notes.local.md`)
- Base project: `azanatta/sf-voice-starter` @ `025185f`
- Reference only: `salesforce-misc/byo-demo-connector`

Vendor-specific names never appear in tracked files. Below, `<ns>` is the package namespace and every "package …" name is a setting.

## Flow

```
Stage A (automatic)          Hand-off (config UI)             Stage B (automatic)
org → package → org setup →  show 4 values / collect Webex →  write config record → remote site
→ ECAs → channel → record    values                           → chat widget → Omni accept → assert
```

"Install success" = Stage A finished with no failed step.
"Setup success" = a work item is routed in Omni-Channel and, once accepted, the Enhanced Conversation component shows the chat started in the widget.

## Step inventory

Mechanism: **CLI** `sf` command · **MD** metadata deploy · **API** REST/SOQL/DML · **Apex** anonymous Apex · **UI** Playwright · **?** not yet known, resolved in Phase 0.
"Base" = already implemented in sf-voice-starter.

### Install page

| # | Doc step | Mechanism | Stage | Notes |
|---|---|---|---|---|
| I1 | Install the package | CLI (base) | A | `04t` id is a setting |
| I2 | Enable Omni-Channel | scratch def + MD (base) | A | |
| I3 | Presence statuses for messaging | MD | A | Base ships Online/Busy; which service channel they carry must be checked — messaging needs the Messaging channel |
| I4 | Give agents access to presence statuses | MD (base perm set) | A | |
| I5 | Routing configuration | ? (MD or API) | A | Priority 1, Most Available, Units of Capacity 1, everything else default |
| I6 | Queue, supported object **only** Messaging Session, agent as member | MD `Queue` | A | |
| I7 | Messaging Session record page with Enhanced Conversation, "Limit conversation history" checked, activated | ? MD `FlexiPage` | A | Component name + property name unknown |
| I8 | ECA "Webex Connect": Local, OAuth on, callback `https://salesforce.com`, scope `api`, Client Credentials Flow on | ? MD `ExternalClientApplication` + `ExtlClntApp*` | A | |
| I9 | ECA "Webex Connect" policy: Run As user | ? MD policy type | A | The org's admin user (System Administrator); same user is the test agent |
| I10 | Consumer Key + Consumer Secret | MD | A | Chosen by the script and set at creation — proven. No email step |
| I11 | Certificate (self-signed, Certificate and Key Management) | MD (base) | A | Unique Name reused in C9 |
| I12 | ECA "Interaction API" (consumer key set at deploy time): Local, OAuth on, callback `https://salesforce.com`, scopes `interaction_api` + `refresh_token, offline_access`, JWT Bearer Flow on with the certificate uploaded | ? MD | A | |
| I13 | ECA "Interaction API" policy: Permitted Users = Admin approved users are pre-authorized | ? MD | A | |
| I14 | Same ECA: select the Run As user's **profile** | ? MD | A | |
| I15 | Same ECA: select the "automated process" permission set | ? MD | A | The project creates this permission set itself (empty, generic name); its only job is to pre-authorize the `autoproc` user on this ECA |
| I16 | Apex: assign that permission set to the `autoproc` user | Apex | A | Idempotent (skip if assigned) |

### Configure page

| # | Doc step | Mechanism | Stage | Notes |
|---|---|---|---|---|
| C1 | Agents: `ContactCenterBringYourOwnChannelUser` (PSL `PartnerMessagingUser`) + the package's agent permission set | CLI | A | API names unknown; a PSL may be needed first |
| C2 | Admin: the package's configuration-admin permission set | CLI | A | API name unknown |
| C3 | `SCRT2 Integration User` permission set: Read + Create on the package's platform event | ? API (`ObjectPermissions`) or MD | A | Standard perm set — may refuse metadata edits |
| C4 | Messaging Settings → New Channel → pick vendor under "Bring Your Own Channels" → name → save | API (`MessagingChannel`) — proven | A | Vendor = `ConversationChannelDefinition` matched by `MasterLabel LIKE '%setting%'` |
| C5 | Modify Conversation Channel Definition → select the Interaction API ECA | ? API | A | `ConversationChannelDefinition.CustomerConnectedAppOauthLink` / `ConnectedAppOauthLink` are updateable; value format to be read from a working example |
| C6 | Read Messaging Platform Key = Channel Address Identifier | API | A | Shown at hand-off |
| C7 | Channel routing: Omni-Queue + the queue from I6 | API: `SessionHandlerId` only | A | See findings — the obvious fields break the channel |
| C8 | Activate the channel | API: `IsActive` | A | |
| C9 | Configuration record: platform key, label, Interaction API ECA consumer key, **Certificate Name** (Private Key left empty) | API | **B** | Created once, complete, after the hand-off — the external-system fields are required at insert |
| C10 | Same record: Webex Tenant, Service Id, Service Secret, End Chat Event Id, Participant Changed Event Id, mTLS (enable, subdomain, cert name), Receipts Auth Id, Receipts Requested | API | B | From the hand-off form |
| C11 | Remote site `https://[MY-DOMAIN].my.salesforce-scrt.com` | MD (base) | A | |
| C12 | Remote site `https://login.salesforce.com` (`test.` for sandboxes) | MD (base) | A | Scratch orgs are sandboxes (`IsSandbox=true`) and need `test.`; deploy both |
| C13 | Remote site `https://api.[TENANT].webexconnect.io`, or `https://[mTLS Subdomain].[TENANT].webexconnect.io` when mTLS is on | MD (base) | B | Depends on hand-off input |

### Not in the docs, needed by the task

| # | Step | Mechanism | Stage | Notes |
|---|---|---|---|---|
| X1 | Create the org — always new; Dev Hub is a UI setting | CLI (base) | A | Existing-org reuse dropped |
| X2 | Deploy `chatWidget` page | MD | A | Body comes from a config-UI textarea (content inside `<apex:page>`); supplied widget is the default |
| X3 | Console app with Omni-Channel utility for the agent | MD (base phase 70, adapted) | A | `LightningServiceConsole` added to the scratch def |
| X4 | Hand-off screen: 4 read-only copy fields + Webex form | config UI (base, extended) | — | |
| X5 | Open widget, send a message | UI | B | Playwright. Widget DOM is per-user → selectors/steps for the widget must be configurable; default written against the supplied widget |
| X6 | Agent Online in Omni, accept the work item, assert Enhanced Conversation shows the message | UI + API (`AgentWork`, `MessagingSession`) | B | Playwright, headless-capable for CI |

## Hand-off values

| Shown to user | Source |
|---|---|
| Org domain (`https://x.scratch.my.salesforce.com` → `x.scratch`) | `sf org display` instance URL. This is the `SalesforceDomain` parameter of the Webex custom nodes |
| Channel Address Identifier | C6 |
| Consumer Secret — Webex Connect ECA (client credentials) | I10 — generated by the script |
| Consumer Key — same ECA | I10 — generated by the script |

| Collected | Required |
|---|---|
| Webex is set up (checkbox) | yes |
| Webex Service Id, Service Secret, Tenant | yes |
| End Chat Event Id, Participant Changed Event Id | no |
| Enable Webex mTLS (default false) | no |
| mTLS Api Subdomain, mTLS Certificate Name | when mTLS is on |
| Receipts Auth Id, Receipts Requested | no |

`Receipts Requested` accepts only `SUBMITTED`, `DELIVERED`, `CLICKED`, `FAILED`, comma-separated — validated in the form.

## Reuse of the base project

Reusable unchanged: `src/sf.ts`, `session.ts`, `logger.ts`, `urls.ts`, the phase runner (`cli.ts`, `types.ts`), preflight, create-org, remote sites, certificate, install-package, the config server and UI, the schema → config/.env/form arrangement.

Not applicable: enable-voice, render-contact-center, contact-center, contact-center-users, Voice settings and permission sets.

Needs extension: the config UI has no mid-run pause — the hand-off (show values, wait for input, resume) is new.

## Risks

1. **I10** — without an API path the user fetches key/secret by hand (agreed fallback), The Interaction API ECA avoids this: it is deployed with a consumer key chosen by the script (C9 needs only that key + the certificate name).
2. **I8–I15, C5** — ECA and channel-definition metadata shapes are not documented well enough to write blind; templates must come from a retrieve of hand-built examples.
3. **C3** — standard permission set may only be editable through `ObjectPermissions` DML or the UI.
4. **X5** — the widget is third-party and tenant-configured (pre-chat form, iframe); selectors can only be written against the real thing.
5. Any vendor's package must work: every package-specific name is a setting, and steps I15, I16, C1–C3, C9, C10 are driven by those settings. A vendor whose package needs steps the guide does not have is out of reach without new code.

## Phase 0 findings

Read from a spike org (alias `byoc-spike`, expires 2026-10-20). Actual names: `docs/vendor-notes.local.md`.

- The scratch def creates cleanly and provides the `PartnerMessagingUser` PSL, the `sfdc_scrt2` permission set and the `sfdc_livemessage` (Messaging) service channel.
- A package brings: an agent permission set, a configuration-admin permission set, one `ConversationChannelDefinition`, one platform event, one configuration object. All are settings.
- No presence statuses exist in a fresh org.
- `sfdc_scrt2` has no object permission on the package platform event after install, so C3 is required.
- `MessagingChannel` is createable and updateable through the API including routing and `IsActive`; `ChannelAddressIdentifier` is read-only (platform-generated).
- The tested package has no "automated process" permission set and no permission set granting Apex class access → the project creates its own (I15/I16).
- Secrets may be written to the gitignored `.env`; never to tracked files or profiles.

### Proven in the spike org through the API (no browser)

| Step | How |
|---|---|
| I5 | `QueueRoutingConfig` insert: `RoutingPriority=1`, `RoutingModel=MostAvailable`, `CapacityWeight=1` |
| I6 | `Group` (`Type=Queue`, `QueueRoutingConfigId`) + one `QueueSobject` (`MessagingSession`) |
| C3 | `ObjectPermissions` insert on the `sfdc_scrt2` permission set (Read + Create on the platform event) — accepted |
| C4, C7 | `MessagingChannel` insert — see "Messaging channel" below for the fields that are safe |
| C8 | `MessagingChannel.IsActive=true` update — accepted |

### External Client Apps — proven as metadata

Both apps deploy with `sf project deploy start`; shapes below were deployed, retrieved back, and exercised.

Four files per app: `ExternalClientApplication` (`distributionState=Local`), `ExtlClntAppOauthSettings` (scopes), `ExtlClntAppGlobalOauthSettings` (callback, key, secret, certificate, flow switches), `ExtlClntAppOauthConfigurablePolicies` (policies). The platform adds an `ExtlClntAppConfigurablePolicies` default policy by itself.

| | Inbound app (client credentials) | Interaction API app (JWT bearer) |
|---|---|---|
| Scopes (`commaSeparatedOauthScopes`) | `Api` | `Interaction, RefreshToken` |
| Global: `callbackUrl` | `https://salesforce.com` | `https://salesforce.com` |
| Global: `isClientCredentialsFlowEnabled` | `true` | — |
| Global: `certificate` | — | PEM of the org certificate (retrieved `.crt`) |
| Global: `consumerKey` | chosen by the script | chosen by the script |
| Global: `consumerSecret` | chosen by the script | — |
| Policy: `isClientCredentialsFlowEnabled` + `clientCredentialsFlowUser` | `true` + admin username | — |
| Policy: `permittedUsersPolicyType` | default (`AllSelfAuthorized`) | `AdminApprovedPreAuthorized` |
| Pre-authorization | — | `SetupEntityAccess` rows (`SetupEntityId` = app id) for the admin profile's permission set and for the project permission set |

Results:

- **Consumer key and secret can both be set when the app is created.** A client-credentials token request with the chosen pair returned a token (scope `api`). No emailed verification code is needed, so the hand-off can show both values filled in. Setting the secret on an app that already exists is silently ignored — it only works at creation.
- JWT bearer exchange signed in Apex with the org certificate returned a token for the admin user, audience `https://test.salesforce.com` (scratch orgs are not on `login`). → the remote site must be `test.salesforce.com` for scratch orgs.
- The same exchange for the `autoproc` user returned `unknown_error`; irrelevant, see the inbound test below.
- Scope API names differ from the UI labels and from the OAuth names: `Interaction` (not `interaction_api`), `RefreshToken`.
- In Setup, the "Modify Conversation Channel Definition" picker listed only the Interaction API app — the platform filters for eligible apps, which supports the shape above.

### Channel definition link (C5) — observed in Setup

Saving the picker wrote `ConversationChannelDefinition.CustomerConnectedAppOauthLink` (`ConnectedAppOauthLink` stayed empty). The value is the app's `oauthLink` (`<orgId15>:<888 id15>`) with the two 3-character prefixes and the colon removed. Writing that value through the API is still to be tried on a clean org; fallback is the Playwright path used here (works headless).

### Messaging channel (C4, C7, C8) — resolved

- Insert with `MessageType=Custom`, `PlatformType=Enhanced`, `ChannelDefinitionId`, label and developer name **only**. No `MessagingPlatformKey` (the platform then sets it equal to `ChannelAddressIdentifier`, as in Setup; it cannot be changed later).
- Routing = update `SessionHandlerId` to the queue id. Nothing else.
- **Do not set `RoutingType` / `TargetQueueId`.** The insert accepts them, but Setup then shows "Routing Type: None", sessions are created owned by the Automated Process user and never routed, and the channel can no longer be fixed (every later routing edit fails validation). This was the first attempt in the spike.
- Activate with `IsActive=true`.

### Salesforce half proven end to end, without the external system

With everything above in place (both apps, pre-authorization, channel definition link, clean channel, configuration record with placeholder external values): a client-credentials token → `POST /services/apexrest/<ns>/interactions/v1/message` returned `202 queued`, and the platform created a `MessagingSession` owned by the queue plus a `PendingServiceRouting` on `sfdc_livemessage`. So the app settings, certificate, permission set and link are sufficient for the inbound path. The earlier `unknown_error` for a direct `autoproc` JWT exchange does not matter.

Setup → External Client App Manager → Policies shows the admin profile and the project permission set as selected, i.e. the `SetupEntityAccess` rows are what the UI itself writes.

### Record page, presence and console app — proven

- Enhanced Conversation is `scrt:conversationBody` (read from the Lightning App Builder palette). The default page uses `runtime_service_livemessage:chatBody`, which stays empty for these sessions, exactly as the vendor troubleshooting page says.
- The record page is the org-wide default for Messaging Session (`actionOverrides` on the object, `View` / `Large` / `Flexipage`). Deploy accepted on a live org; rendering through the org default (rather than the earlier app-level assignment) is not yet re-checked with a chat.
- "Limit conversation history" is the component property `hideConversationHistory` (confirmed: deployed as `true`, the checkbox shows ticked in the Lightning App Builder). The page sets it.
- Presence status on the `sfdc_livemessage` service channel + a permission set granting it.
- The console app needs Messaging Session in its navigation, otherwise an accepted work item does not open a tab.
- Chat widget on the Visualforce page: launcher, "new conversation", message box and send controls are each in a different iframe; selectors are settings.

With all of it in place in the spike org: test message → Omni-Channel offer → accept → Enhanced Conversation showed the message text.

### Clean run of the first stage (2026-10-13)

`npm run setup` against a brand-new org (`byoc-dev`): all eight phases passed first time in 246 s, including both token checks. Then, with a placeholder configuration record: synthetic inbound message → `202 queued` → session owned by the queue with a pending routing record → the connection test's agent half (go online, accept, find the message in Enhanced Conversation) passed. The widget half was dry-run up to the send click.

Note for the connection test: on the tested widget, the "new conversation" control sends a preset first message by itself. The test's own message follows in the same conversation, so the assertion is unaffected.

### Open

1. The second stage against the real external system (needs the hand-off by a person).
2. Scratch org capacity: the Dev Hub allows 3 active orgs and every setup run creates one. A run refuses an alias that is already in use.
4. The connection test covers customer → agent only. The agent → customer direction, which is what uses the external service id and secret, is not asserted.
5. Each connection test leaves its accepted session open.
6. Re-running against an existing org (`--org=`, `--from=`, `--only=`): written to be idempotent, exercised for the second stage (`byoc-remote-site`, `byoc-config-record`, `byoc-e2e`); a full first-stage re-run in an existing org is not yet exercised.

## Connection test: "no session" diagnosis (2026-10-13, first run against the external system)

Symptom: agent online, widget message sent, no messaging session, no package log row. Cause: the
external system called the package REST endpoint under the wrong namespace.

- A request to `/services/apexrest/<wrong namespace>/…` is answered 404 before any package code
  runs. Nothing in a scratch org records it: no debug log, no package log row, and `EventLogFile`
  holds sample data only.
- `LoginHistory` does record the external system's token request: `Application` = the inbound app's
  label, `LoginType` = `Remote Access 2.0`. `Application` cannot be filtered in SOQL (filter by
  `LoginTime`, then in code).
- So `byoc-e2e` distinguishes: no token request (flow not running / wrong org domain) · token
  refused (key or secret) · token issued but no session (endpoint path or namespace, or a package
  rejection). For the last case it prints the namespace read from the channel definition
  (`ConversationChannelDefinition.NamespacePrefix`).

## First passing connection test (2026-10-13)

- `byoc-e2e` passed against the real external system: widget message → session → work offered →
  accepted → message shown in Enhanced Conversation.
- `.env` values that contain `#` (CSS id selectors) must be quoted: Node's `--env-file` reads an
  unquoted `#` as a comment and the setting arrives empty. The config UI now writes such values in
  single quotes. Runs started from the UI were never affected (it passes the values itself).
- Starting a chat in the tested widget sends an automatic greeting, which already creates the
  session and the work item before the test message is typed.
- The tested widget enables its send control on key events only: `fill` leaves it disabled
  (`aria-disabled="true"`), intermittently. The test types key by key, waits for the control to
  enable, and falls back to Enter.
- Open test conversations: every run leaves its conversation open, earlier ones are re-offered on
  the next run (30 s each) and count against capacity (5). `MessagingSession.Status` cannot be
  updated through the API ("Unable to create/update fields: Status"), so ending them needs the UI.
- Ending a conversation: **End Chat** in the Enhanced Conversation header sets the session to
  `Ended` with no confirmation. It is enabled only while the agent has the work open; on a session
  opened by record URL (status `Inactive`) it is disabled. No standard invocable action ends a
  session. So `byoc-e2e` ends each conversation right after accepting it, closes the workspace tab,
  and drains any other pending offers the same way. Proven: test session and a leftover `Waiting`
  session both `Ended`, no open `AgentWork` afterwards.
- Widget input: never type at the page (`pressSequentially`). The tested widget moves focus while the
  chat starts, so keys land on other controls (seen: a one-letter message sent, and the chat ended
  from the customer side). The test sets the text with `fill`, re-sets it if the widget redraws the
  box, checks the box content before sending and checks the sent bubble afterwards.
- The external system requests a token for every conversation (two `LoginHistory` rows each), so
  "no token request during the test" reliably means it did not call the org at all.

## Second package variant (2026-10-23)

- Package variants differ in their configuration object and fields. One tested variant has a
  different configuration object name and **no mTLS fields** at all (inserting
  `<ns>__Webex_mTLS_Enabled__c` failed with "No such column"). So `byoc-config-record` describes
  the object first and skips any configured field the org does not have; only the platform key
  field is required, because the record is looked up by it.
- The namespace differs per variant. Object and field settings are entered without it and
  `BYOC_NAMESPACE` is put in front, so one setting changes all of them.
- The external system's flow must call the package REST endpoint under the same namespace. A wrong
  one gives 404 and nothing in the org (see the "no session" diagnosis above); it was the cause
  here too.
- The remote site is now its own phase (`byoc-remote-site`) ahead of the record, so a record
  failure does not leave the org without it.
- With these, the connection test passed against this variant (`--org=… --only=byoc-e2e` on the
  existing org).
