/**
 * End of the first stage. Reaching this phase means nothing before it failed, which is the
 * definition of a successful install. It records the four values the external system needs.
 */

import { orgIdOf, readState, updateState } from '../byoc/state.js';
import { requireOrg, type Phase, type PhaseContext } from '../types.js';

/** `https://x.scratch.my.salesforce.com` becomes `x.scratch`. */
export function orgDomain(instanceUrl: string): string {
  const host = new URL(instanceUrl).hostname;
  const suffix = '.my.salesforce.com';
  if (!host.endsWith(suffix)) {
    throw new Error(`"${instanceUrl}" is not a My Domain URL, so the org domain cannot be derived.`);
  }
  return host.slice(0, -suffix.length);
}

export const byocHandoffPhase: Phase = {
  id: 'byoc-handoff',
  title: 'Install complete — values for the external system',

  async run(ctx: PhaseContext) {
    const org = requireOrg(ctx);
    const orgId = orgIdOf(org);
    const state = readState(orgId);
    if (!state.channelAddressIdentifier || !state.inboundConsumerKey || !state.inboundConsumerSecret) {
      throw new Error('The client apps and channel phases must complete before the hand-off.');
    }

    const handoff = {
      orgAlias: ctx.config.scratchOrg.alias,
      orgUsername: org.username,
      orgDomain: orgDomain(org.instanceUrl),
      channelAddressIdentifier: state.channelAddressIdentifier,
      consumerKey: state.inboundConsumerKey,
      consumerSecret: state.inboundConsumerSecret,
      completedAt: new Date().toISOString(),
    };
    updateState(orgId, { handoff });

    ctx.log.success('INSTALL SUCCESS — the org is ready for the external system');
    ctx.facts['Org domain'] = handoff.orgDomain;
    ctx.facts['Channel address identifier'] = handoff.channelAddressIdentifier;
    ctx.facts['Consumer key'] = handoff.consumerKey;
    ctx.facts['Consumer secret'] = '(shown in the configuration UI; stored in generated/byoc/state.json)';
    ctx.manualSteps.push(
      'Configure the external system with the four hand-off values, then enter its details in the ' +
        'configuration UI and run the connection test (or: npm run connect).',
    );
  },
};
