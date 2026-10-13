/**
 * Creates the scratch org. Always a new one, and never with features stripped.
 *
 * The upstream create-org phase reuses an existing org by default and, on an entitlement error,
 * retries without the conversation features. Both are wrong here: an org without those features has
 * no Partner Messaging licences, and the run would only find out many steps later.
 */

import { orgDisplay, sf, sfOptional, type OrgDisplay } from '../sf.js';
import type { Phase, PhaseContext } from '../types.js';

export const byocCreateOrgPhase: Phase = {
  id: 'byoc-create-org',
  title: 'Create a new scratch org',

  async run(ctx: PhaseContext) {
    const { alias, durationDays, definitionFile } = ctx.config.scratchOrg;
    // Never delete or silently replace an org: the person running this chooses a new name instead.
    const existing = await sfOptional<OrgDisplay>(['org', 'display', '--target-org', alias]);
    if (existing) {
      throw new Error(
        `An org named "${alias}" already exists (${existing.username}). Choose a different scratch org ` +
          `alias, or delete that org first:  sf org delete scratch --target-org ${alias}`,
      );
    }

    ctx.log.step(`Creating "${alias}" on Dev Hub "${ctx.config.devHub.alias}" from ${definitionFile}`);
    await sf(
      [
        'org',
        'create',
        'scratch',
        '--definition-file',
        definitionFile,
        '--alias',
        alias,
        '--target-dev-hub',
        ctx.config.devHub.alias,
        '--duration-days',
        String(durationDays),
        '--set-default',
        '--wait',
        '20',
      ],
      { timeoutMs: 25 * 60_000, onCommand: (c) => ctx.log.command(c) },
    );
    ctx.org = await orgDisplay(alias, { onCommand: (c) => ctx.log.command(c) });
    ctx.log.success(`Scratch org created (${ctx.org.username}, ${durationDays} day(s))`);
    ctx.facts['Scratch org'] = `${ctx.org.username} (created)`;
  },
};
