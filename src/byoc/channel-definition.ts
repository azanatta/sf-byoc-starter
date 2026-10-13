/** Finds the vendor's channel definition by the configured match text. */

import { byocConfig } from '../../config/byoc.config.js';
import type { PhaseContext } from '../types.js';
import { queryAll } from './org.js';

export interface ChannelDefinition {
  Id: string;
  DeveloperName: string;
  MasterLabel: string;
  NamespacePrefix: string | null;
  CustomPlatformEvent: string | null;
  CustomerConnectedAppOauthLink: string | null;
}

export async function findChannelDefinition(ctx: PhaseContext): Promise<ChannelDefinition> {
  const match = byocConfig().channel.vendorMatch.trim();
  if (match === '') throw new Error('No channel vendor match configured. Set BYOC_CHANNEL_MATCH.');

  // Filtered here rather than with LIKE so that %, _ and quotes in the match text stay literal.
  const all = await queryAll<ChannelDefinition>(
    ctx,
    'SELECT Id, DeveloperName, MasterLabel, NamespacePrefix, CustomPlatformEvent, ' +
      'CustomerConnectedAppOauthLink FROM ConversationChannelDefinition',
  );
  const found = all.filter((definition) =>
    definition.MasterLabel.toLowerCase().includes(match.toLowerCase()),
  );
  const available = all.map((definition) => `"${definition.MasterLabel}"`).join(', ') || '(none)';
  if (found.length === 0) {
    throw new Error(
      `No channel vendor matches "${match}". Available: ${available}. ` +
        `Is the package installed, and is BYOC_CHANNEL_MATCH right?`,
    );
  }
  if (found.length > 1) {
    throw new Error(`"${match}" matches more than one channel vendor: ${available}. Make it more specific.`);
  }
  return found[0] as ChannelDefinition;
}
