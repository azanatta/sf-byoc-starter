/**
 * The two OAuth external client apps from the vendor guide. They differ on purpose — do not merge
 * or "align" their settings:
 *
 *   Inbound app          the external system calls Salesforce with it.
 *                        Scope api, client credentials flow, Run As = the admin user.
 *   Interaction API app  the package calls the Interaction API with it.
 *                        Scopes interaction_api + refresh_token/offline_access, JWT bearer flow with
 *                        the org certificate, admin-approved users, pre-authorized for the Run As
 *                        user's profile and for the automated-process permission set.
 *
 * Both are created as metadata with a consumer key chosen here, and the inbound app with a chosen
 * consumer secret too. That only works at creation: the platform ignores a secret sent for an app
 * that already exists, and never returns one. Hence the state file.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { byocConfig } from '../../config/byoc.config.js';
import { createRecord, deployDir, escapeXml, freshDir, queryFirst, runApex, soqlString } from '../byoc/org.js';
import { orgIdOf, readState, updateState } from '../byoc/state.js';
import { sf } from '../sf.js';
import { requireOrg, type Phase, type PhaseContext } from '../types.js';
import { AUTOMATED_PROCESS_PERMISSION_SET } from './byoc-20-org-prep.js';

const SOURCE = 'generated/byoc/client-apps';
const CERT_RETRIEVE_DIR = 'generated/byoc/certificate';
const CALLBACK_URL = 'https://salesforce.com';

export const byocClientAppsPhase: Phase = {
  id: 'byoc-client-apps',
  title: 'Create the two OAuth external client apps',

  async run(ctx: PhaseContext) {
    const org = requireOrg(ctx);
    const orgId = orgIdOf(org);
    const config = byocConfig();
    const inbound = config.inboundApp.developerName;
    const interaction = config.interactionApp.developerName;

    const inboundExists = await appId(ctx, inbound);
    const interactionExists = await appId(ctx, interaction);
    let state = readState(orgId);

    if (inboundExists && !state.inboundConsumerSecret) {
      throw new Error(
        `External client app "${inbound}" exists in the org but its consumer secret is not in ` +
          `generated/byoc/state.json (it cannot be read back from Salesforce). Start from a new org.`,
      );
    }
    if (interactionExists && !state.interactionConsumerKey) {
      throw new Error(
        `External client app "${interaction}" exists in the org but its consumer key is not in ` +
          `generated/byoc/state.json. Start from a new org.`,
      );
    }

    // Saved BEFORE the deploy: a secret lost after a successful deploy is unrecoverable.
    state = updateState(orgId, {
      inboundConsumerKey: state.inboundConsumerKey ?? newConsumerKey(),
      inboundConsumerSecret: state.inboundConsumerSecret ?? newConsumerSecret(),
      interactionConsumerKey: state.interactionConsumerKey ?? newConsumerKey(),
    });

    const admin = await queryFirst<{ Email: string; ProfileId: string }>(
      ctx,
      `SELECT Email, ProfileId FROM User WHERE Username = ${soqlString(org.username)}`,
    );
    if (!admin) throw new Error(`Could not find the running user ${org.username}.`);
    const certificate = await certificatePem(ctx);

    const write = freshDir(SOURCE);
    renderApp(write, {
      developerName: inbound,
      label: config.inboundApp.label,
      contactEmail: admin.Email,
      scopes: 'Api',
      globalSettings:
        `    <consumerKey>${state.inboundConsumerKey}</consumerKey>\n` +
        `    <consumerSecret>${state.inboundConsumerSecret}</consumerSecret>\n` +
        `    <isClientCredentialsFlowEnabled>true</isClientCredentialsFlowEnabled>\n`,
      policies:
        `    <clientCredentialsFlowUser>${escapeXml(org.username)}</clientCredentialsFlowUser>\n` +
        `    <isClientCredentialsFlowEnabled>true</isClientCredentialsFlowEnabled>\n`,
    });
    renderApp(write, {
      developerName: interaction,
      label: config.interactionApp.label,
      contactEmail: admin.Email,
      scopes: 'Interaction, RefreshToken',
      globalSettings:
        `    <certificate>${certificate}</certificate>\n` +
        `    <consumerKey>${state.interactionConsumerKey}</consumerKey>\n`,
      policies: `    <permittedUsersPolicyType>AdminApprovedPreAuthorized</permittedUsersPolicyType>\n`,
    });

    await deployDir(ctx, SOURCE, 'the external client apps');
    ctx.log.success(`External client apps "${inbound}" and "${interaction}" deployed`);

    await preAuthorize(ctx, interaction, admin.ProfileId);
    await verifyClientCredentials(ctx, state.inboundConsumerKey!, state.inboundConsumerSecret!);
    await verifyJwtBearer(ctx, state.interactionConsumerKey!);

    ctx.facts['Inbound app'] = inbound;
    ctx.facts['Interaction API app'] = interaction;
  },
};

/** Shaped like a platform-issued key so nothing downstream treats it as unusual. */
function newConsumerKey(): string {
  return `3MVG9${randomBytes(60).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 80)}`;
}

function newConsumerSecret(): string {
  return randomBytes(32).toString('hex').toUpperCase();
}

async function appId(ctx: PhaseContext, developerName: string): Promise<string | undefined> {
  const app = await queryFirst<{ Id: string }>(
    ctx,
    `SELECT Id FROM ExternalClientApplication WHERE DeveloperName = ${soqlString(developerName)}`,
    true,
  );
  return app?.Id;
}

/** Retrieves the org certificate's public PEM; the Interaction API app carries it for JWT bearer. */
async function certificatePem(ctx: PhaseContext): Promise<string> {
  const name = ctx.config.certificate.developerName;
  freshDir(CERT_RETRIEVE_DIR);
  await sf(
    [
      'project',
      'retrieve',
      'start',
      '--target-org',
      requireOrg(ctx).username,
      '--metadata',
      `Certificate:${name}`,
      '--output-dir',
      CERT_RETRIEVE_DIR,
      '--ignore-conflicts',
    ],
    { onCommand: (c) => ctx.log.command(c) },
  );
  const pem = readFileSync(resolve(process.cwd(), CERT_RETRIEVE_DIR, 'certs', `${name}.crt`), 'utf8').trim();
  if (!pem.includes('BEGIN CERTIFICATE')) {
    throw new Error(`Certificate "${name}" has no public PEM in the org. Did the certificate phase run?`);
  }
  return pem;
}

interface AppFiles {
  developerName: string;
  label: string;
  contactEmail: string;
  scopes: string;
  globalSettings: string;
  policies: string;
}

function renderApp(write: (path: string, content: string) => void, app: AppFiles): void {
  const header = '<?xml version="1.0" encoding="UTF-8"?>';
  const ns = 'xmlns="http://soap.sforce.com/2006/04/metadata"';
  const name = app.developerName;

  write(
    `externalClientApps/${name}.eca-meta.xml`,
    `${header}
<ExternalClientApplication ${ns}>
    <contactEmail>${escapeXml(app.contactEmail)}</contactEmail>
    <distributionState>Local</distributionState>
    <isProtected>false</isProtected>
    <label>${escapeXml(app.label)}</label>
</ExternalClientApplication>
`,
  );
  write(
    `extlClntAppOauthSettings/${name}_oauth.ecaOauth-meta.xml`,
    `${header}
<ExtlClntAppOauthSettings ${ns}>
    <commaSeparatedOauthScopes>${app.scopes}</commaSeparatedOauthScopes>
    <externalClientApplication>${name}</externalClientApplication>
    <label>${name}_oauth</label>
</ExtlClntAppOauthSettings>
`,
  );
  write(
    `extlClntAppGlobalOauthSets/${name}_glbloauth.ecaGlblOauth-meta.xml`,
    `${header}
<ExtlClntAppGlobalOauthSettings ${ns}>
    <callbackUrl>${CALLBACK_URL}</callbackUrl>
${app.globalSettings}    <externalClientApplication>${name}</externalClientApplication>
    <label>${name}_glbloauth</label>
    <shouldRotateConsumerKey>false</shouldRotateConsumerKey>
    <shouldRotateConsumerSecret>false</shouldRotateConsumerSecret>
</ExtlClntAppGlobalOauthSettings>
`,
  );
  write(
    `extlClntAppOauthPolicies/${name}_oauthPlcy.ecaOauthPlcy-meta.xml`,
    `${header}
<ExtlClntAppOauthConfigurablePolicies ${ns}>
${app.policies}    <externalClientApplication>${name}</externalClientApplication>
    <label>${name}_oauthPlcy</label>
</ExtlClntAppOauthConfigurablePolicies>
`,
  );
}

/**
 * "Select Profiles" and "Select Permission Sets" on the app's Policies tab. Setup stores these as
 * SetupEntityAccess rows on the profile's own permission set and on the permission set.
 */
async function preAuthorize(ctx: PhaseContext, developerName: string, profileId: string): Promise<void> {
  const id = await appId(ctx, developerName);
  if (!id) throw new Error(`External client app "${developerName}" was deployed but cannot be found.`);

  const profileSet = await queryFirst<{ Id: string }>(
    ctx,
    `SELECT Id FROM PermissionSet WHERE IsOwnedByProfile = true AND ProfileId = '${profileId}'`,
  );
  const automatedSet = await queryFirst<{ Id: string }>(
    ctx,
    `SELECT Id FROM PermissionSet WHERE Name = '${AUTOMATED_PROCESS_PERMISSION_SET}'`,
  );
  if (!profileSet || !automatedSet) {
    throw new Error('Could not resolve the profile or the automated-process permission set to pre-authorize.');
  }

  for (const [what, parentId] of [
    ['the Run As user profile', profileSet.Id],
    [`permission set "${AUTOMATED_PROCESS_PERMISSION_SET}"`, automatedSet.Id],
  ] as const) {
    const existing = await queryFirst(
      ctx,
      `SELECT Id FROM SetupEntityAccess WHERE ParentId = '${parentId}' AND SetupEntityId = '${id}'`,
    );
    if (existing) {
      ctx.log.skip(`"${developerName}" pre-authorized for ${what}`);
      continue;
    }
    await createRecord(ctx, 'SetupEntityAccess', { ParentId: parentId, SetupEntityId: id });
    ctx.log.success(`Pre-authorized "${developerName}" for ${what}`);
  }
}

/** The request the external system will make. A new app can take a little while to become usable. */
async function verifyClientCredentials(ctx: PhaseContext, key: string, secret: string): Promise<void> {
  const url = `${requireOrg(ctx).instanceUrl}/services/oauth2/token`;
  const deadline = Date.now() + 3 * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: key, client_secret: secret }),
    });
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
    if (response.ok && body.access_token) {
      ctx.log.success('Inbound app verified: client credentials token issued');
      return;
    }
    last = `${response.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim();
    await new Promise((done) => setTimeout(done, 15_000));
  }
  throw new Error(`The inbound app does not issue a client credentials token: ${last}`);
}

/** Proves the certificate, scopes and pre-authorization of the Interaction API app together. */
async function verifyJwtBearer(ctx: PhaseContext, key: string): Promise<void> {
  const certificate = ctx.config.certificate.developerName;
  const apex = `String aud = [SELECT IsSandbox FROM Organization].IsSandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
Auth.JWT jwt = new Auth.JWT();
jwt.setIss('${key}'); jwt.setSub(UserInfo.getUserName()); jwt.setAud(aud);
Auth.JWS jws = new Auth.JWS(jwt, '${certificate}');
HttpRequest req = new HttpRequest();
req.setEndpoint(aud + '/services/oauth2/token'); req.setMethod('POST');
req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
req.setBody('grant_type=' + EncodingUtil.urlEncode('urn:ietf:params:oauth:grant-type:jwt-bearer', 'UTF-8') + '&assertion=' + jws.getCompactSerialization());
HttpResponse res = new Http().send(req);
Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
System.debug(LoggingLevel.ERROR, 'BYOC_JWT ' + res.getStatusCode() + ' scope=' + body.get('scope') + ' error=' + body.get('error') + ' ' + body.get('error_description'));`;

  const deadline = Date.now() + 3 * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    const logs = await runApex(ctx, apex, 'verify the Interaction API app');
    last = logs.split('\n').find((line) => line.includes('|BYOC_JWT '))?.split('|BYOC_JWT ')[1] ?? 'no result';
    if (last.startsWith('200 ') && last.includes('interaction_api')) {
      ctx.log.success('Interaction API app verified: JWT bearer token issued with scope interaction_api');
      return;
    }
    await new Promise((done) => setTimeout(done, 15_000));
  }
  throw new Error(`The Interaction API app does not issue a JWT bearer token: ${last}`);
}
