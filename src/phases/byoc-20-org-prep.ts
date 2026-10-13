/**
 * Org pre-setup from the vendor guide: presence statuses and access to them, routing configuration,
 * queue, Messaging Session record page with Enhanced Conversation, permission sets, the platform
 * event permission for the SCRT2 integration user, remote sites, and the chat widget page.
 *
 * Runs after the package install because several steps reference what the package ships.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { byocConfig } from '../../config/byoc.config.js';
import {
  assignPermissionSet,
  createRecord,
  deployDir,
  escapeXml,
  freshDir,
  queryFirst,
  runApex,
  soqlString,
} from '../byoc/org.js';
import { findChannelDefinition } from '../byoc/channel-definition.js';
import { requireOrg, type Phase, type PhaseContext } from '../types.js';
import { scrtUrlFor } from '../urls.js';

const STATIC_SOURCE = 'byoc-app';
const RENDERED_SOURCE = 'generated/byoc/org-prep';

/** Deployed by this project (byoc-app/). */
const PRESENCE_PERMISSION_SET = 'Messaging_Presence_Access';
const CONSOLE_PERMISSION_SET = 'Messaging_Console_Access';
export const AUTOMATED_PROCESS_PERMISSION_SET = 'Messaging_Automated_Process';
/** Standard, provisioned by the scratch org features. */
const BYOC_USER_PERMISSION_SET = 'ContactCenterBringYourOwnChannelUser';
const SCRT2_PERMISSION_SET = 'sfdc_scrt2';
export const CHAT_WIDGET_PAGE = 'chatWidget';

export const byocOrgPrepPhase: Phase = {
  id: 'byoc-org-prep',
  title: 'Prepare the org for messaging (presence, routing, queue, page, permissions)',

  async run(ctx: PhaseContext) {
    const config = byocConfig();
    if (config.packagePermissionSets.length === 0) {
      throw new Error('No package permission sets configured. Set BYOC_PACKAGE_PERMISSION_SETS.');
    }

    await deployDir(ctx, STATIC_SOURCE, 'presence statuses, permission sets, record page and console app');
    ctx.log.success('Presence statuses, permission sets, record page and console app deployed');

    renderOrgSpecificMetadata(ctx);
    await deployDir(ctx, RENDERED_SOURCE, 'the SCRT2 remote site and the chat widget page');
    ctx.log.success('SCRT2 remote site and chat widget page deployed');

    const routingId = await ensureRoutingConfiguration(ctx);
    await ensureQueue(ctx, routingId);

    for (const name of [
      BYOC_USER_PERMISSION_SET,
      ...config.packagePermissionSets,
      PRESENCE_PERMISSION_SET,
      CONSOLE_PERMISSION_SET,
    ]) {
      await assignPermissionSet(ctx, name);
    }

    await grantPlatformEventAccess(ctx);
    await assignAutomatedProcessPermissionSet(ctx);
  },
};

function renderOrgSpecificMetadata(ctx: PhaseContext): void {
  const org = requireOrg(ctx);
  const config = byocConfig();
  const write = freshDir(RENDERED_SOURCE);

  const scrtUrl = scrtUrlFor(org.instanceUrl);
  if (!scrtUrl) {
    throw new Error(`Cannot derive the SCRT2 endpoint from "${org.instanceUrl}" (not a My Domain URL).`);
  }
  write(
    'remoteSiteSettings/Salesforce_SCRT2.remoteSite-meta.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<RemoteSiteSetting xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Interaction API endpoint of this org</description>
    <disableProtocolSecurity>false</disableProtocolSecurity>
    <isActive>true</isActive>
    <url>${escapeXml(scrtUrl)}</url>
</RemoteSiteSetting>
`,
  );
  ctx.facts['SCRT2 remote site'] = scrtUrl;

  const widgetPath = resolve(process.cwd(), config.widget.file);
  if (!existsSync(widgetPath)) {
    throw new Error(
      `Chat widget markup not found at ${config.widget.file}. Paste the widget embed code in the ` +
        `configuration UI, or create that file.`,
    );
  }
  const markup = readFileSync(widgetPath, 'utf8').trim();
  if (markup === '') throw new Error(`Chat widget markup file ${config.widget.file} is empty.`);
  write(`pages/${CHAT_WIDGET_PAGE}.page`, `<apex:page>\n${markup}\n</apex:page>\n`);
  write(
    `pages/${CHAT_WIDGET_PAGE}.page-meta.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApexPage xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>60.0</apiVersion>
    <availableInTouch>true</availableInTouch>
    <confirmationTokenRequired>false</confirmationTokenRequired>
    <label>Chat Widget</label>
</ApexPage>
`,
  );
}

async function ensureRoutingConfiguration(ctx: PhaseContext): Promise<string> {
  const { routing } = byocConfig();
  const existing = await queryFirst<{ Id: string }>(
    ctx,
    `SELECT Id FROM QueueRoutingConfig WHERE DeveloperName = ${soqlString(routing.developerName)}`,
  );
  if (existing) {
    ctx.log.skip(`Routing configuration "${routing.label}" exists`);
    return existing.Id;
  }
  const id = await createRecord(ctx, 'QueueRoutingConfig', {
    DeveloperName: routing.developerName,
    MasterLabel: routing.label,
    RoutingPriority: 1,
    RoutingModel: 'MostAvailable',
    CapacityWeight: 1,
  });
  ctx.log.success(`Routing configuration "${routing.label}" created (priority 1, Most Available, 1 unit)`);
  return id;
}

async function ensureQueue(ctx: PhaseContext, routingId: string): Promise<void> {
  const org = requireOrg(ctx);
  const { queue } = byocConfig();
  let queueId = (
    await queryFirst<{ Id: string }>(
      ctx,
      `SELECT Id FROM Group WHERE Type = 'Queue' AND DeveloperName = ${soqlString(queue.developerName)}`,
    )
  )?.Id;

  if (queueId) {
    ctx.log.skip(`Queue "${queue.label}" exists`);
  } else {
    queueId = await createRecord(ctx, 'Group', {
      Type: 'Queue',
      Name: queue.label,
      DeveloperName: queue.developerName,
      QueueRoutingConfigId: routingId,
    });
    ctx.log.success(`Queue "${queue.label}" created`);
  }

  // Messaging Session must be the ONLY supported object (vendor guide).
  const supported = await queryFirst(
    ctx,
    `SELECT Id FROM QueueSobject WHERE QueueId = '${queueId}' AND SobjectType = 'MessagingSession'`,
  );
  if (!supported) {
    await createRecord(ctx, 'QueueSobject', { QueueId: queueId, SobjectType: 'MessagingSession' });
  }

  const user = await queryFirst<{ Id: string }>(
    ctx,
    `SELECT Id FROM User WHERE Username = ${soqlString(org.username)}`,
  );
  if (!user) throw new Error(`Could not find the running user ${org.username}.`);
  const member = await queryFirst(
    ctx,
    `SELECT Id FROM GroupMember WHERE GroupId = '${queueId}' AND UserOrGroupId = '${user.Id}'`,
  );
  if (!member) {
    await createRecord(ctx, 'GroupMember', { GroupId: queueId, UserOrGroupId: user.Id });
    ctx.log.success(`Added ${org.username} to the queue`);
  }
  ctx.facts['Queue'] = queue.label;
}

/** Read + Create on the package platform event for the SCRT2 Integration User permission set. */
async function grantPlatformEventAccess(ctx: PhaseContext): Promise<void> {
  const definition = await findChannelDefinition(ctx);
  const event = definition.CustomPlatformEvent;
  if (!event) {
    throw new Error(`Channel definition "${definition.MasterLabel}" declares no custom platform event.`);
  }
  const permissionSet = await queryFirst<{ Id: string }>(
    ctx,
    `SELECT Id FROM PermissionSet WHERE Name = '${SCRT2_PERMISSION_SET}'`,
  );
  if (!permissionSet) {
    throw new Error(
      'The "SCRT2 Integration User" permission set is missing — the org was created without the ' +
        'conversation features in config/project-scratch-def.json.',
    );
  }
  const existing = await queryFirst<{ Id: string; PermissionsRead: boolean; PermissionsCreate: boolean }>(
    ctx,
    `SELECT Id, PermissionsRead, PermissionsCreate FROM ObjectPermissions ` +
      `WHERE ParentId = '${permissionSet.Id}' AND SobjectType = ${soqlString(event)}`,
  );
  if (existing?.PermissionsRead && existing.PermissionsCreate) {
    ctx.log.skip(`SCRT2 Integration User can read and create ${event}`);
    return;
  }
  if (existing) {
    throw new Error(`SCRT2 Integration User has partial access to ${event}; fix it in Setup and re-run.`);
  }
  await createRecord(ctx, 'ObjectPermissions', {
    ParentId: permissionSet.Id,
    SobjectType: event,
    PermissionsRead: true,
    PermissionsCreate: true,
  });
  ctx.log.success(`Granted SCRT2 Integration User read and create on ${event}`);
}

/** The Apex from the vendor guide, made safe to run twice. */
async function assignAutomatedProcessPermissionSet(ctx: PhaseContext): Promise<void> {
  const logs = await runApex(
    ctx,
    `PermissionSet permSet = [SELECT Id FROM PermissionSet WHERE Name = '${AUTOMATED_PROCESS_PERMISSION_SET}'];
User autoProcessUser = [SELECT Id FROM User WHERE Alias = 'autoproc'];
if ([SELECT COUNT() FROM PermissionSetAssignment WHERE AssigneeId = :autoProcessUser.Id AND PermissionSetId = :permSet.Id] == 0) {
    insert new PermissionSetAssignment(AssigneeId = autoProcessUser.Id, PermissionSetId = permSet.Id);
    System.debug(LoggingLevel.ERROR, 'BYOC_ASSIGNED');
}`,
    'assign the permission set to the Automated Process user',
  );
  if (logs.includes('|BYOC_ASSIGNED')) {
    ctx.log.success(`Assigned "${AUTOMATED_PROCESS_PERMISSION_SET}" to the Automated Process user`);
  } else {
    ctx.log.skip(`"${AUTOMATED_PROCESS_PERMISSION_SET}" assigned to the Automated Process user`);
  }
}
