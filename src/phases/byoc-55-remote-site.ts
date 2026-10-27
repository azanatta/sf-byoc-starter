/**
 * Second stage, step one: the remote site for the external API, so the org can send agent messages
 * out. The host comes from BYOC_EXT_API_HOST_PATTERN with the tenant (and the mTLS subdomain, when
 * mTLS is on) filled in from the external system values, e.g. https://api.eu.example.com.
 *
 * Its own phase, ahead of the configuration record, so a record problem never leaves the org
 * without it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { byocConfig } from '../../config/byoc.config.js';
import { deployDir, escapeXml, freshDir } from '../byoc/org.js';
import { sf } from '../sf.js';
import { requireOrg, type Phase, type PhaseContext } from '../types.js';

const SOURCE = 'generated/byoc/external-remote-site';
const RETRIEVE_DIR = 'generated/byoc/external-remote-site-check';
const NAME = 'Messaging_External_Api';

/** Where a setting's value came from, for the log: the run's environment or the schema default. */
function source(name: string): string {
  return (process.env[name] ?? '').trim() === '' ? 'default' : 'set';
}

/** The remote site URL for the current external system values. Logs each input when `ctx` is given. */
export function externalApiUrl(ctx?: PhaseContext): string {
  const { external, externalApiHostPattern } = byocConfig();
  const subdomain = external.mtlsEnabled ? external.mtlsSubdomain : 'api';
  ctx?.log.step(`Host pattern (BYOC_EXT_API_HOST_PATTERN, ${source('BYOC_EXT_API_HOST_PATTERN')}): "${externalApiHostPattern}"`);
  ctx?.log.step(`Tenant (BYOC_EXT_TENANT, ${source('BYOC_EXT_TENANT')}): "${external.tenant}"`);
  ctx?.log.step(`Subdomain: "${subdomain}" (mTLS ${external.mtlsEnabled ? 'on, BYOC_EXT_MTLS_SUBDOMAIN' : 'off, fixed'})`);

  if (externalApiHostPattern === '') {
    throw new Error(
      'No external API host pattern configured (BYOC_EXT_API_HOST_PATTERN is empty in this run). Without a ' +
        'remote site for the external API the org cannot send agent messages out. From a terminal, check ' +
        'that .env has it; in the config UI, check step 1 and save.',
    );
  }
  if (!externalApiHostPattern.includes('{tenant}')) {
    ctx?.log.warn('The host pattern has no {tenant} placeholder; the tenant is not used.');
  }
  if (external.tenant === '') throw new Error('No tenant configured (BYOC_EXT_TENANT); the host pattern needs it.');
  if (external.mtlsEnabled && subdomain === '') {
    throw new Error('mTLS is on but no mTLS API subdomain is configured (BYOC_EXT_MTLS_SUBDOMAIN).');
  }
  const url = externalApiHostPattern.replaceAll('{tenant}', external.tenant).replaceAll('{subdomain}', subdomain);
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(url)) {
    throw new Error(
      `The external API URL "${url}" is not a valid https host (no path, port or spaces). ` +
        `Pattern "${externalApiHostPattern}", tenant "${external.tenant}", subdomain "${subdomain}". ` +
        'The tenant is only the tenant part (e.g. "eu"), not a full host or URL.',
    );
  }
  return url;
}

export const byocRemoteSitePhase: Phase = {
  id: 'byoc-remote-site',
  title: 'Trust the external API (remote site)',

  async run(ctx: PhaseContext) {
    const url = externalApiUrl(ctx);
    ctx.log.step(`Remote site URL: ${url}`);
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
    try {
      await deployDir(ctx, SOURCE, 'the external API remote site');
    } catch (error) {
      throw new Error(`Deploying remote site "${NAME}" (${url}) failed: ${error instanceof Error ? error.message : String(error)}`);
    }

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
    const file = resolve(process.cwd(), RETRIEVE_DIR, 'remoteSiteSettings', `${NAME}.remoteSite-meta.xml`);
    if (!existsSync(file)) {
      throw new Error(`Remote site "${NAME}" was deployed but the retrieve returned no file (expected ${file}).`);
    }
    const xml = readFileSync(file, 'utf8');
    const stored = xml.match(/<url>([^<]+)<\/url>/)?.[1];
    if (stored !== url || !xml.includes('<isActive>true</isActive>')) {
      throw new Error(`Remote site "${NAME}" reads back as "${stored}" (expected "${url}", active).`);
    }
    ctx.log.success(`Remote site "${NAME}" active: ${url}`);
    ctx.facts['External API remote site'] = url;
  },
};
