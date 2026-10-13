/**
 * Typed view of the Partner Messaging settings.
 *
 * Read lazily (a function, not a constant) because the configuration UI launches the connection
 * test with values that were not in the environment when the first stage ran.
 */

import { SETTINGS_BY_ENV } from './settings-schema.js';

function env(name: string): string {
  const value = process.env[name];
  if (value !== undefined && value.trim() !== '') return value.trim();
  const fallback = SETTINGS_BY_ENV.get(name)?.default;
  if (fallback === undefined) throw new Error(`No default for ${name}. Add it to config/byoc-settings.ts.`);
  return fallback;
}

function envBool(name: string): boolean {
  return ['true', '1', 'yes', 'on'].includes(env(name).toLowerCase());
}

function envList(name: string): string[] {
  return env(name)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** Turns a label into an API name: "Messaging Queue" becomes "Messaging_Queue". */
export function toApiName(label: string): string {
  const name = label.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[A-Za-z]/.test(name) ? name : `X_${name}`;
}

export interface ByocConfig {
  queue: { label: string; developerName: string };
  routing: { label: string; developerName: string };
  channel: { label: string; developerName: string; vendorMatch: string };
  inboundApp: { label: string; developerName: string };
  interactionApp: { label: string; developerName: string };
  packagePermissionSets: string[];
  configRecord: {
    object: string;
    label: string;
    /** Logical name → field API name. Empty means "this package has no such field". */
    fields: Record<ConfigField, string>;
  };
  externalApiHostPattern: string;
  widget: {
    file: string;
    launcherSelector: string;
    startSelector: string;
    inputSelector: string;
    sendSelector: string;
    timeoutSeconds: number;
  };
  external: {
    ready: boolean;
    serviceId: string;
    serviceSecret: string;
    tenant: string;
    endChatEventId: string;
    participantChangedEventId: string;
    mtlsEnabled: boolean;
    mtlsSubdomain: string;
    mtlsCertificateName: string;
    receiptsAuthId: string;
    receiptsRequested: string;
  };
}

export type ConfigField =
  | 'platformKey'
  | 'label'
  | 'clientId'
  | 'certificateName'
  | 'tenant'
  | 'serviceId'
  | 'serviceSecret'
  | 'endChatEventId'
  | 'participantChangedEventId'
  | 'mtlsEnabled'
  | 'mtlsSubdomain'
  | 'mtlsCertificateName'
  | 'receiptsAuthId'
  | 'receiptsRequested';

export function byocConfig(): ByocConfig {
  const labelled = (name: string) => ({ label: env(name), developerName: toApiName(env(name)) });
  return {
    queue: labelled('BYOC_QUEUE_LABEL'),
    routing: labelled('BYOC_ROUTING_LABEL'),
    channel: { ...labelled('BYOC_CHANNEL_LABEL'), vendorMatch: env('BYOC_CHANNEL_MATCH') },
    inboundApp: labelled('BYOC_INBOUND_APP_LABEL'),
    interactionApp: labelled('BYOC_INTERACTION_APP_LABEL'),
    packagePermissionSets: envList('BYOC_PACKAGE_PERMISSION_SETS'),
    configRecord: {
      object: env('BYOC_CONFIG_OBJECT'),
      label: env('BYOC_CONFIG_LABEL'),
      fields: {
        platformKey: env('BYOC_F_PLATFORM_KEY'),
        label: env('BYOC_F_LABEL'),
        clientId: env('BYOC_F_CLIENT_ID'),
        certificateName: env('BYOC_F_CERT_NAME'),
        tenant: env('BYOC_F_TENANT'),
        serviceId: env('BYOC_F_SERVICE_ID'),
        serviceSecret: env('BYOC_F_SERVICE_SECRET'),
        endChatEventId: env('BYOC_F_END_CHAT_EVENT'),
        participantChangedEventId: env('BYOC_F_PARTICIPANT_EVENT'),
        mtlsEnabled: env('BYOC_F_MTLS_ENABLED'),
        mtlsSubdomain: env('BYOC_F_MTLS_SUBDOMAIN'),
        mtlsCertificateName: env('BYOC_F_MTLS_CERT'),
        receiptsAuthId: env('BYOC_F_RECEIPTS_AUTH'),
        receiptsRequested: env('BYOC_F_RECEIPTS_REQUESTED'),
      },
    },
    externalApiHostPattern: env('BYOC_EXT_API_HOST_PATTERN'),
    widget: {
      file: env('BYOC_WIDGET_FILE'),
      launcherSelector: env('BYOC_WIDGET_LAUNCHER'),
      startSelector: env('BYOC_WIDGET_START'),
      inputSelector: env('BYOC_WIDGET_INPUT'),
      sendSelector: env('BYOC_WIDGET_SEND'),
      timeoutSeconds: Number.parseInt(env('BYOC_E2E_TIMEOUT_SECONDS'), 10) || 120,
    },
    external: {
      ready: envBool('BYOC_EXT_READY'),
      serviceId: env('BYOC_EXT_SERVICE_ID'),
      serviceSecret: env('BYOC_EXT_SERVICE_SECRET'),
      tenant: env('BYOC_EXT_TENANT'),
      endChatEventId: env('BYOC_EXT_END_CHAT_EVENT'),
      participantChangedEventId: env('BYOC_EXT_PARTICIPANT_EVENT'),
      mtlsEnabled: envBool('BYOC_EXT_MTLS'),
      mtlsSubdomain: env('BYOC_EXT_MTLS_SUBDOMAIN'),
      mtlsCertificateName: env('BYOC_EXT_MTLS_CERT'),
      receiptsAuthId: env('BYOC_EXT_RECEIPTS_AUTH'),
      receiptsRequested: env('BYOC_EXT_RECEIPTS_REQUESTED'),
    },
  };
}
