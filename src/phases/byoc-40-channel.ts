/**
 * Messaging channel, in the order the vendor guide gives: create it against the vendor's channel
 * definition, point that definition at the Interaction API app, route to the queue, activate.
 *
 * Three things here were learned the hard way against a live org:
 *   - Send NO platform key on insert. The platform then makes it equal to the channel address
 *     identifier, as Setup does. A key you supply stays different forever (it is not updateable).
 *   - Queue routing on an enhanced channel is SessionHandlerId and nothing else. RoutingType and
 *     TargetQueueId are accepted on insert and leave a channel that never routes and cannot be fixed.
 *   - Without the definition → app link the Interaction API answers 401 to the package.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { byocConfig } from '../../config/byoc.config.js';
import { findChannelDefinition } from '../byoc/channel-definition.js';
import { createRecord, freshDir, queryFirst, soqlString, updateRecord } from '../byoc/org.js';
import { orgIdOf, updateState } from '../byoc/state.js';
import { sf } from '../sf.js';
import { requireOrg, type Phase, type PhaseContext } from '../types.js';

const OAUTH_RETRIEVE_DIR = 'generated/byoc/interaction-app';

interface Channel {
  Id: string;
  ChannelAddressIdentifier: string;
  MessagingPlatformKey: string;
  IsActive: boolean;
  SessionHandlerId: string | null;
  RoutingType: string | null;
  TargetQueueId: string | null;
}

export const byocChannelPhase: Phase = {
  id: 'byoc-channel',
  title: 'Create, link, route and activate the messaging channel',

  async run(ctx: PhaseContext) {
    const config = byocConfig();
    const definition = await findChannelDefinition(ctx);
    ctx.log.step(`Channel vendor: "${definition.MasterLabel}"`);

    let channel = await readChannel(ctx);
    if (channel) {
      ctx.log.skip(`Messaging channel "${config.channel.label}" exists`);
    } else {
      await createRecord(ctx, 'MessagingChannel', {
        MasterLabel: config.channel.label,
        DeveloperName: config.channel.developerName,
        MessageType: 'Custom',
        PlatformType: 'Enhanced',
        ChannelDefinitionId: definition.Id,
      });
      channel = await readChannel(ctx);
      if (!channel) throw new Error('The messaging channel was created but cannot be read back.');
      ctx.log.success(`Messaging channel "${config.channel.label}" created`);
    }

    if (channel.MessagingPlatformKey !== channel.ChannelAddressIdentifier) {
      throw new Error(
        'The channel platform key differs from its channel address identifier; the package and the ' +
          'external system expect one value. The channel must be recreated (start from a new org).',
      );
    }
    if (channel.RoutingType || channel.TargetQueueId) {
      throw new Error(
        'The channel carries legacy routing fields (RoutingType/TargetQueueId) and will not route. ' +
          'It must be recreated (start from a new org).',
      );
    }

    await linkDefinitionToApp(ctx, definition.Id, definition.CustomerConnectedAppOauthLink);

    const queue = await queryFirst<{ Id: string }>(
      ctx,
      `SELECT Id FROM Group WHERE Type = 'Queue' AND DeveloperName = ${soqlString(config.queue.developerName)}`,
    );
    if (!queue) throw new Error(`Queue "${config.queue.label}" not found. Run the byoc-org-prep phase first.`);
    if (channel.SessionHandlerId === queue.Id) {
      ctx.log.skip('Channel routes to the queue');
    } else {
      await updateRecord(ctx, 'MessagingChannel', channel.Id, { SessionHandlerId: queue.Id });
      ctx.log.success(`Channel routing set to queue "${config.queue.label}"`);
    }

    if (channel.IsActive) {
      ctx.log.skip('Channel is active');
    } else {
      await updateRecord(ctx, 'MessagingChannel', channel.Id, { IsActive: true });
      ctx.log.success('Channel activated');
    }

    const final = await readChannel(ctx);
    if (!final?.IsActive || final.SessionHandlerId !== queue.Id) {
      throw new Error('The channel did not keep its routing or activation. Check it in Messaging Settings.');
    }
    updateState(orgIdOf(requireOrg(ctx)), { channelAddressIdentifier: final.ChannelAddressIdentifier });
    ctx.facts['Channel address identifier'] = final.ChannelAddressIdentifier;
  },
};

async function readChannel(ctx: PhaseContext): Promise<Channel | undefined> {
  return queryFirst<Channel>(
    ctx,
    'SELECT Id, ChannelAddressIdentifier, MessagingPlatformKey, IsActive, SessionHandlerId, RoutingType, ' +
      `TargetQueueId FROM MessagingChannel WHERE DeveloperName = ${soqlString(byocConfig().channel.developerName)}`,
  );
}

/**
 * "Modify Conversation Channel Definition" in Setup. It stores the app's OAuth link
 * (`<org id>:<oauth settings id>`, 15-character ids) with both 3-character key prefixes and the
 * colon removed.
 */
async function linkDefinitionToApp(ctx: PhaseContext, definitionId: string, current: string | null): Promise<void> {
  const app = byocConfig().interactionApp.developerName;
  freshDir(OAUTH_RETRIEVE_DIR);
  await sf(
    [
      'project',
      'retrieve',
      'start',
      '--target-org',
      requireOrg(ctx).username,
      '--metadata',
      `ExtlClntAppOauthSettings:${app}_oauth`,
      '--output-dir',
      OAUTH_RETRIEVE_DIR,
      '--ignore-conflicts',
    ],
    { onCommand: (c) => ctx.log.command(c) },
  );
  const xml = readFileSync(
    resolve(process.cwd(), OAUTH_RETRIEVE_DIR, 'extlClntAppOauthSettings', `${app}_oauth.ecaOauth-meta.xml`),
    'utf8',
  );
  const oauthLink = xml.match(/<oauthLink>([^<]+)<\/oauthLink>/)?.[1];
  const parts = oauthLink?.split(':') ?? [];
  if (parts.length !== 2 || parts.some((part) => part.length !== 15)) {
    throw new Error(`Unexpected OAuth link "${oauthLink}" on external client app "${app}".`);
  }
  const link = parts.map((part) => part.slice(3)).join('');

  if (current === link) {
    ctx.log.skip(`Channel definition is linked to "${app}"`);
    return;
  }
  await updateRecord(ctx, 'ConversationChannelDefinition', definitionId, {
    CustomerConnectedAppOauthLink: link,
  });
  ctx.log.success(`Channel definition linked to "${app}"`);
}
