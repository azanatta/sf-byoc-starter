# Salesforce Partner Messaging Starter

Creates a Salesforce scratch org, installs a **Partner Messaging** (bring-your-own-channel) managed
package, configures the org for it, and proves the chat round trip with the external messaging
system.

Internal, non-production tool for building test environments. It is vendor-agnostic on the
Salesforce side: everything that differs between vendor packages is a setting. The external-system
form is shaped for Webex Connect.

Forked from [sf-voice-starter](https://github.com/azanatta/sf-voice-starter), which stays reachable
as the `upstream` git remote.

---

## Quick start

```bash
# 1. Authenticate a Dev Hub once (this tool never handles credentials)
sf org login web --set-default-dev-hub --alias myhub

# 2. Install dependencies (also downloads the Chromium build Playwright uses)
npm install

# 3. Open the guided setup
npm run configure            # http://127.0.0.1:4747
```

The page walks through four steps:

| Step | What you do | What happens |
| --- | --- | --- |
| 1. Set up the org | Fill in the Dev Hub, a new org alias and the vendor package details; press **Set up the org** | New scratch org, package install, org configuration. About five minutes |
| 2. Configure the external system | Copy the four values shown into the external system | — |
| 3. Enter the external system details | Type the service id, secret, tenant and optional values; tick the confirmation | — |
| 4. Run the connection test | Press **Run connection test** | Configuration record is written; a browser sends a chat from the widget, accepts it in Omni-Channel and checks it shows in Enhanced Conversation |

Step 1 is a success when nothing in it failed. Step 4 is a success when the message typed in the
chat widget is visible in the agent's Enhanced Conversation component.

Every setup run creates a **new** org. If the alias is already in use the run stops and asks for a
different name; nothing is deleted or replaced.

---

## What you need from the vendor package

All of these go in step 1 of the page (or `.env`). They are empty by default on purpose.

| Setting | What it is |
| --- | --- |
| `SCV_PACKAGE_VERSION_ID` | The `04t…` package version id, or an install URL |
| `BYOC_CHANNEL_MATCH` | Text contained in the vendor entry under "Bring Your Own Channels" in Messaging Settings. Must match exactly one |
| `BYOC_PACKAGE_PERMISSION_SETS` | The package's agent and configuration-admin permission sets |
| `BYOC_CONFIG_OBJECT` and `BYOC_F_*` | The package configuration object and the API names of its fields |
| `BYOC_EXT_API_HOST_PATTERN` | Host the org calls out to; default `https://{subdomain}.{tenant}.webexconnect.io` |
| `BYOC_WIDGET_*` | The chat widget embed code and the selectors of its controls |

Save a set of values as a **profile** (top right of the page) to switch between vendor packages.
Profiles, `.env`, `vendor/` and `generated/` are gitignored: vendor names, tenant ids and secrets
must never reach a tracked file.

---

## From the terminal

```bash
npx tsx --env-file=.env src/cli.ts                    # step 1
npx tsx --env-file=.env src/cli.ts --connect --org=<alias or username>   # step 4
npx tsx --env-file=.env src/cli.ts --list             # phases
npx tsx --env-file=.env src/cli.ts --org=<alias>   # re-run the setup in an existing org (keeps channel and client apps)
npx tsx --env-file=.env src/cli.ts --org=<alias> --only=<phase>   # re-run one phase
npx tsx --env-file=.env src/cli.ts --org=<alias> --from=<phase>   # re-run a failed phase and the rest of its stage
npx tsx --env-file=.env src/cli.ts --headed …         # visible browser
npm run setup -- --delete                             # delete the org behind the configured alias
npm run typecheck
```

The CLI reads `process.env` and nothing else, hence `--env-file`. Screenshots land in `artifacts/`.

---

## What step 1 does

| Phase | What | How |
| --- | --- | --- |
| `preflight` | CLI present, Dev Hub session usable | CLI |
| `byoc-create-org` | New scratch org from `config/project-scratch-def.json` | CLI |
| `install-package` | Installs the vendor package | CLI |
| `certificate` | Self-signed certificate in the org | Metadata |
| `byoc-org-prep` | Presence statuses and access, routing configuration, queue (Messaging Session only), Messaging Session record page with Enhanced Conversation, console app, permission sets, platform-event access for the SCRT2 integration user, remote sites, chat widget page | Metadata + API + Apex |
| `byoc-client-apps` | The two OAuth external client apps, then a real token request against each | Metadata + API |
| `byoc-channel` | Messaging channel on the vendor's channel definition, linked to the Interaction API app, routed to the queue, activated | API |
| `byoc-handoff` | Records the four values for the external system | — |

And step 4:

| Phase | What |
| --- | --- |
| `byoc-remote-site` | Remote site for the external API, from the host pattern and the tenant |
| `byoc-config-record` | Package configuration record |
| `byoc-e2e` | The browser-driven connection test |

No step uses the Setup UI; the browser is only used for the connection test.

### The two external client apps

They differ on purpose:

| | Inbound app | Interaction API app |
| --- | --- | --- |
| Used by | The external system, to call Salesforce | The package, to call the Interaction API |
| Scopes | `api` | `interaction_api`, `refresh_token`/`offline_access` |
| Flow | Client credentials, Run As the admin user | JWT bearer with the org certificate |
| Permitted users | Default | Admin approved; pre-authorized for the admin profile and the `Messaging_Automated_Process` permission set (also assigned to the Automated Process user) |

Their consumer keys, and the inbound app's consumer secret, are generated by this tool and set when
the apps are created. A secret can only be set at creation and can never be read back, so it is kept
in `generated/byoc/state.json`. Lose that file and the org has to be recreated.

---

## Things that fail silently if done differently

Each of these was hit against a live org; the detail is in [`docs/01-analysis.md`](docs/01-analysis.md).

- **Messaging channel fields.** Create the channel without a platform key and without
  `RoutingType`/`TargetQueueId`; route it with `SessionHandlerId` only. The other fields are
  accepted, and leave a channel that never routes and cannot be repaired.
- **Channel definition link.** Without the link from the vendor's channel definition to the
  Interaction API app, the Interaction API answers 401 to the package.
- **Scratch orgs are sandboxes.** The token audience is `test.salesforce.com`; both `login` and
  `test` are added as remote sites.
- **Enhanced Conversation.** The standard Messaging Session page stays empty for these sessions.
  The page deployed here uses `scrt:conversationBody` and is the org default.
- **Console navigation.** Without Messaging Session in the console app's navigation, an accepted
  chat does not open a tab.

---

## Limits

- The connection test checks customer → agent only. An agent reply reaching the widget is not
  asserted yet.
- The connection test ends every conversation it accepts (End Chat) and closes its tab. A session
  left `Inactive` by an interrupted run cannot be ended afterwards: the API refuses, and End Chat is
  enabled only while the agent has the work open.
- A Dev Hub has a small number of active scratch org slots, and every setup run uses one.
- `npm test` and the `verify` phase are upstream Voice checks and do not apply here. The upstream
  Voice phases remain in `src/phases/` but are not part of the pipeline.

---

## Layout

```text
config/settings-schema.ts     every setting, defined once (form, .env and typed config derive from it)
config/byoc-settings.ts       the messaging settings
config/project-scratch-def.json
src/cli.ts                    phase runner
src/phases/byoc-*.ts          one file per messaging phase
src/byoc/                     org helpers and per-org state
byoc-app/                     static metadata deployed as-is
tools/config-server.ts        local UI server (127.0.0.1 only)
tools/config-ui.html          the guided page
docs/                         analysis, phase plan, decisions
```

---

## License

[MIT](LICENSE) © Alberto Zanatta.

Not affiliated with or endorsed by Salesforce or Cisco. Product names belong to their owners.
