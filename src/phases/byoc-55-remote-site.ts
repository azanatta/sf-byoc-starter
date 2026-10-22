/**
 * Second stage, step one: the remote site for the external API, so the org can send agent messages
 * out. The host comes from BYOC_EXT_API_HOST_PATTERN with the tenant (and the mTLS subdomain, when
 * mTLS is on) filled in from the external system values, e.g. https://api.eu.example.com.
 *
 * Its own phase, ahead of the configuration record, so a record problem never leaves the org
 * without it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { byocConfig } from '../../config/byoc.config.js';
import { deployDir, escapeXml, freshDir } from '../byoc/org.js';
import { sf } from '../sf.js';
import { requireOrg, type Phase, type PhaseContext } from '../types.js';

const SOURCE = 'generated/byoc/external-remote-site';
const RETRIEVE_DIR = 'generated/byoc/external-remote-site-check';
const NAME = 'Messaging_External_Api';

/** The remote site URL for the current external system values. */
export function externalApiUrl(): string {
  const { external, externalApiHostPattern } = byocConfig();
  if (externalApiHostPattern === '') {
    throw new Error(
      'No external API host pattern configured (BYOC_EXT_API_HOST_PATTERN). Without a remote site ' +
        'for the external API the org cannot send agent messages out.',
    );
  }
  if (external.tenant === '') throw new Error('No tenant configured (BYOC_EXT_TENANT); the host pattern needs it.');
  const url = externalApiHostPattern
    .replaceAll('{tenant}', external.tenant)
    .replaceAll('{subdomain}', external.mtlsEnabled ? external.mtlsSubdomain : 'api');
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(url)) {
    throw new Error(`The external API URL "${url}" is not a valid https host. Check the tenant and the host pattern.`);
  }
  return url;
}

export const byocRemoteSitePhase: Phase = {
  id: 'byoc-remote-site',
  title: 'Trust the external API (remote site)',

  async run(ctx: PhaseContext) {
    const url = externalApiUrl();
    const write = freshDir(SOURCE);
    write(
      `remoteSiteSettings/${NAME}.remoteSite-meta.xml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<RemoteSiteSetting xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>External messaging API</description>
    <disableProtocolSecurity>false</disableProtocolSecurity>
    <isActive>true</isActive>
    <url>${escapeXml(url)}</url>
</RemoteSiteSetting>
`,
    );
    await deployDir(ctx, SOURCE, 'the external API remote site');

    // Read back what the org holds, not what was sent.
    freshDir(RETRIEVE_DIR);
    await sf(
      [
        'project',
        'retrieve',
        'start',
        '--target-org',
        requireOrg(ctx).username,
        '--metadata',
        `RemoteSiteSetting:${NAME}`,
        '--output-dir',
        RETRIEVE_DIR,
        '--ignore-conflicts',
      ],
      { onCommand: (c) => ctx.log.command(c) },
    );
    const xml = readFileSync(
      resolve(process.cwd(), RETRIEVE_DIR, 'remoteSiteSettings', `${NAME}.remoteSite-meta.xml`),
      'utf8',
    );
    const stored = xml.match(/<url>([^<]+)<\/url>/)?.[1];
    if (stored !== url || !xml.includes('<isActive>true</isActive>')) {
      throw new Error(`Remote site "${NAME}" reads back as "${stored}" (expected "${url}", active).`);
    }
    ctx.log.success(`Remote site "${NAME}" active: ${url}`);
    ctx.facts['External API remote site'] = url;
  },
};
