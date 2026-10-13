/**
 * Values that must survive between runs and between the two stages.
 *
 * The consumer secret is the reason this exists: it can only be set when an external client app is
 * created and can never be read back, so it is generated once, written here BEFORE the deploy, and
 * reused on every later run against the same org.
 *
 * Lives under generated/ (gitignored). It holds secrets; never copy it into a tracked file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const STATE_PATH = resolve(process.cwd(), 'generated/byoc/state.json');

export interface OrgState {
  inboundConsumerKey?: string;
  inboundConsumerSecret?: string;
  interactionConsumerKey?: string;
  channelAddressIdentifier?: string;
  /** Present once the first stage finished with no failed step. */
  handoff?: {
    orgAlias: string;
    /** Connect targets this, not the alias: a later setup run can re-point the alias. */
    orgUsername: string;
    orgDomain: string;
    channelAddressIdentifier: string;
    consumerKey: string;
    consumerSecret: string;
    completedAt: string;
    /** Set when the connection test last passed for this org. */
    connectedAt?: string;
  };
}

/** `sf org display` returns the org id as `id`; the upstream type calls it `orgId`. */
export function orgIdOf(org: { orgId?: string }): string {
  const id = (org as { id?: string }).id ?? org.orgId;
  if (!id) throw new Error('The org id is missing from `sf org display`.');
  return id;
}

type StateFile = Record<string, OrgState>;

function readAll(): StateFile {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as StateFile;
  } catch {
    return {};
  }
}

/** State is keyed by org id, so a new org under a reused alias never inherits old secrets. */
export function readState(orgId: string): OrgState {
  return readAll()[orgId] ?? {};
}

export function updateState(orgId: string, patch: Partial<OrgState>): OrgState {
  const all = readAll();
  const next = { ...(all[orgId] ?? {}), ...patch };
  all[orgId] = next;
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(all, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return next;
}

/** The most recent hand-off, for the configuration UI. */
export function latestHandoff(): OrgState['handoff'] {
  const handoffs = Object.values(readAll())
    .map((state) => state.handoff)
    .filter((handoff): handoff is NonNullable<OrgState['handoff']> => handoff !== undefined);
  handoffs.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  return handoffs.at(-1);
}
