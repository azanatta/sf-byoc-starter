/**
 * Settings for the Partner Messaging (BYOC) setup.
 *
 * Kept in their own module, and concatenated into SETTINGS by settings-schema.ts, so the shared
 * schema file stays close to the upstream starter and merges from it stay clean.
 *
 * Nothing in here may name a vendor. Everything that differs between vendor packages (permission
 * set names, the channel label, the configuration object and its fields) is a setting with an empty
 * default; real values belong in `.env` or `config/profiles.json`, both gitignored.
 */

import type { Setting } from './settings-schema.js';

const ORG = 'Messaging: org';
const PACKAGE = 'Messaging: vendor package';
const CONFIG_RECORD = 'Messaging: configuration record fields';
const WIDGET = 'Messaging: chat widget';
const EXTERNAL = 'External system (fill in after the hand-off)';

function apiNameOrEmpty(value: string): string | undefined {
  if (value.trim() === '') return undefined;
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(value.trim())
    ? undefined
    : 'Letters, digits and underscores only, and it cannot start with a digit.';
}

function nonEmpty(value: string): string | undefined {
  return value.trim() === '' ? 'Required.' : undefined;
}

/** Delivery receipt statuses the configuration record accepts, per the vendor guide. */
export const RECEIPT_STATUSES = ['SUBMITTED', 'DELIVERED', 'CLICKED', 'FAILED'];

/**
 * Default field API names, without namespace. Every field setting holds a name in this form; the
 * package namespace (BYOC_NAMESPACE) is put in front at run time. Keyed by env var.
 */
export const FIELD_DEFAULT_NAMES: Record<string, string> = {
  BYOC_F_PLATFORM_KEY: 'Messaging_Channel_Platform_Key__c',
  BYOC_F_LABEL: 'Configuration_Label__c',
  BYOC_F_CLIENT_ID: 'Ext_Client_App_Client_Id__c',
  BYOC_F_CERT_NAME: 'Certificate_Name__c',
  BYOC_F_TENANT: 'Webex_Tenant__c',
  BYOC_F_SERVICE_ID: 'Webex_Service_Id__c',
  BYOC_F_SERVICE_SECRET: 'Webex_Service_Secret__c',
  BYOC_F_END_CHAT_EVENT: 'Webex_End_Chat_Event_Id__c',
  BYOC_F_PARTICIPANT_EVENT: 'Webex_Participant_Changed_Event_Id__c',
  BYOC_F_MTLS_ENABLED: 'Webex_mTLS_Enabled__c',
  BYOC_F_MTLS_SUBDOMAIN: 'Webex_mTLS_Api_Subdomain__c',
  BYOC_F_MTLS_CERT: 'Webex_mTLS_Certificate_Name__c',
  BYOC_F_RECEIPTS_AUTH: 'Webex_Receipts_Auth_Id__c',
  BYOC_F_RECEIPTS_REQUESTED: 'Webex_Receipts_Request__c',
};

/** A field API name without namespace: `Field__c`, never `ns__Field__c`. */
function fieldNameWithoutNamespace(value: string): string | undefined {
  const name = value.trim();
  if (name === '') return undefined;
  if (!/^[A-Za-z][A-Za-z0-9_]*__c$/.test(name)) return 'A custom field API name ending in __c.';
  if (name.slice(0, -3).includes('__')) return 'Without the namespace: the package namespace is added automatically.';
  return undefined;
}

/** One configuration-record field: the env var holding its API name, and what feeds it. */
function fieldSetting(env: string, label: string, description: string): Setting {
  const name = FIELD_DEFAULT_NAMES[env]!;
  return {
    env,
    label,
    description: `${description} API name of the field on the configuration object, WITHOUT the namespace: it is used as {{namespace}}__<name>.`,
    type: 'string',
    default: name,
    group: CONFIG_RECORD,
    validate: fieldNameWithoutNamespace,
    placeholder: name,
  };
}

export const BYOC_SETTINGS: Setting[] = [
  /* ------------------------------------------------------------------------------------- Org */
  {
    env: 'BYOC_QUEUE_LABEL',
    label: 'Queue label',
    description: 'Queue that receives messaging sessions. Supports the Messaging Session object only.',
    type: 'string',
    default: 'Messaging Queue',
    group: ORG,
    validate: nonEmpty,
  },
  {
    env: 'BYOC_ROUTING_LABEL',
    label: 'Routing configuration label',
    description: 'Created with priority 1, Most Available, 1 unit of capacity.',
    type: 'string',
    default: 'Messaging Routing',
    group: ORG,
    validate: nonEmpty,
  },
  {
    env: 'BYOC_CHANNEL_LABEL',
    label: 'Messaging channel name',
    description: 'Name of the messaging channel created in Messaging Settings.',
    type: 'string',
    default: 'Partner Messaging Channel',
    group: ORG,
    validate: nonEmpty,
  },
  {
    env: 'BYOC_INBOUND_APP_LABEL',
    label: 'Inbound app label',
    description:
      'External client app the external system authenticates with (client credentials flow, run as the admin user).',
    type: 'string',
    default: 'Messaging Inbound Client',
    group: ORG,
    validate: nonEmpty,
  },
  {
    env: 'BYOC_INTERACTION_APP_LABEL',
    label: 'Interaction API app label',
    description:
      'External client app the package uses to call the Interaction API (JWT bearer flow with the org certificate).',
    type: 'string',
    default: 'Messaging Interaction Client',
    group: ORG,
    validate: nonEmpty,
  },

  /* ------------------------------------------------------------------------- Vendor package */
  {
    env: 'BYOC_NAMESPACE',
    label: 'Package namespace',
    description:
      'Namespace prefix of the package, without the trailing "__". Required. It is put in front of every configuration record field name: {{namespace}}__<field>.',
    type: 'string',
    default: '',
    group: PACKAGE,
    validate: (value) =>
      nonEmpty(value) ??
      (/^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*$/.test(value.trim())
        ? undefined
        : 'Letters, digits and single underscores only, without the trailing "__".'),
    placeholder: 'ns',
  },
  {
    env: 'BYOC_CHANNEL_MATCH',
    label: 'Channel vendor match',
    description:
      'Text contained in the vendor entry shown under "Bring Your Own Channels" in Messaging Settings. Matched as *text* against the channel definition label; must match exactly one.',
    type: 'string',
    default: '',
    group: PACKAGE,
    placeholder: 'Acme Channels',
  },
  {
    env: 'BYOC_PACKAGE_PERMISSION_SETS',
    label: 'Package permission sets',
    description:
      'Permission sets shipped by the package (agent, configuration admin), comma-separated API names without namespace. Assigned to the admin user, who is also the test agent.',
    type: 'list',
    default: '',
    group: PACKAGE,
    placeholder: 'Vendor_Agent,Vendor_Configuration_Admin',
  },
  {
    env: 'BYOC_CONFIG_OBJECT',
    label: 'Configuration object',
    description:
      'API name of the package configuration object. Requires the namespace: {{namespace}}__ObjectApiName. No default, because the object name differs per vendor package.',
    type: 'string',
    default: '',
    group: PACKAGE,
    validate: apiNameOrEmpty,
    placeholder: '{{namespace}}__ObjectApiName__c',
  },
  {
    env: 'BYOC_CONFIG_LABEL',
    label: 'Configuration label',
    description: 'Label given to the configuration record.',
    type: 'string',
    default: 'Default',
    group: PACKAGE,
  },

  /* ------------------------------------------------------------ Configuration record fields */
  fieldSetting('BYOC_F_PLATFORM_KEY', 'Field: platform key', 'Receives the channel address identifier.'),
  fieldSetting('BYOC_F_LABEL', 'Field: configuration label', 'Receives the configuration label.'),
  fieldSetting('BYOC_F_CLIENT_ID', 'Field: client id', 'Receives the Interaction API app consumer key.'),
  fieldSetting('BYOC_F_CERT_NAME', 'Field: certificate name', 'Receives the certificate unique name.'),
  fieldSetting('BYOC_F_TENANT', 'Field: tenant', 'Receives the tenant.'),
  fieldSetting('BYOC_F_SERVICE_ID', 'Field: service id', 'Receives the service id.'),
  fieldSetting('BYOC_F_SERVICE_SECRET', 'Field: service secret', 'Receives the service secret.'),
  fieldSetting('BYOC_F_END_CHAT_EVENT', 'Field: end chat event id', 'Receives the end chat event id.'),
  fieldSetting(
    'BYOC_F_PARTICIPANT_EVENT',
    'Field: participant changed event id',
    'Receives the participant changed event id.',
  ),
  fieldSetting('BYOC_F_MTLS_ENABLED', 'Field: mTLS enabled', 'Receives the mTLS switch.'),
  fieldSetting('BYOC_F_MTLS_SUBDOMAIN', 'Field: mTLS API subdomain', 'Receives the mTLS API subdomain.'),
  fieldSetting('BYOC_F_MTLS_CERT', 'Field: mTLS certificate name', 'Receives the mTLS certificate name.'),
  fieldSetting('BYOC_F_RECEIPTS_AUTH', 'Field: receipts auth id', 'Receives the receipts auth id.'),
  fieldSetting('BYOC_F_RECEIPTS_REQUESTED', 'Field: receipts requested', 'Receives the receipts list.'),
  {
    env: 'BYOC_EXT_API_HOST_PATTERN',
    label: 'External API host pattern',
    description:
      'Remote site the org calls out to. {tenant} and {subdomain} are replaced from the hand-off values; {subdomain} is "api" unless mTLS is on.',
    type: 'string',
    default: '',
    group: PACKAGE,
    placeholder: 'https://{subdomain}.{tenant}.example.com',
  },

  /* ---------------------------------------------------------------------------- Chat widget */
  {
    env: 'BYOC_WIDGET_FILE',
    label: 'Widget markup file',
    description:
      'File holding the chat widget embed code (what goes between the <apex:page> tags). Edit it in the box below or on disk. Keep it under vendor/, which is gitignored.',
    type: 'file',
    default: 'vendor/chat-widget.html',
    group: WIDGET,
  },
  {
    env: 'BYOC_WIDGET_LAUNCHER',
    label: 'Launcher selector',
    description:
      'Selector for the control that opens the chat. Looked up in every frame of the page. Leave empty if the chat opens by itself.',
    type: 'string',
    default: '',
    group: WIDGET,
  },
  {
    env: 'BYOC_WIDGET_START',
    label: 'Start-conversation selector',
    description: 'Optional control to click after the launcher and before typing, e.g. a "new conversation" button. Skipped when not visible.',
    type: 'string',
    default: '',
    group: WIDGET,
  },
  {
    env: 'BYOC_WIDGET_INPUT',
    label: 'Message input selector',
    description: 'Selector for the message box. Looked up in every frame of the page.',
    type: 'string',
    default: '',
    group: WIDGET,
  },
  {
    env: 'BYOC_WIDGET_SEND',
    label: 'Send selector',
    description: 'Selector for the send control. Leave empty to press Enter.',
    type: 'string',
    default: '',
    group: WIDGET,
  },
  {
    env: 'BYOC_E2E_TIMEOUT_SECONDS',
    label: 'Routing timeout (seconds)',
    description: 'How long the test waits for the chat to arrive in Omni-Channel.',
    type: 'number',
    default: '120',
    group: WIDGET,
  },

  /* ------------------------------------------------------------------------ External system */
  {
    env: 'BYOC_EXT_READY',
    label: 'The external system is set up',
    description:
      'Tick once the four hand-off values are configured in the external system. The connection test will not start without it.',
    type: 'boolean',
    default: 'false',
    group: EXTERNAL,
  },
  {
    env: 'BYOC_EXT_SERVICE_ID',
    label: 'Webex Service Id',
    description: 'Required for the connection test.',
    type: 'string',
    default: '',
    group: EXTERNAL,
  },
  {
    env: 'BYOC_EXT_SERVICE_SECRET',
    label: 'Webex Service Secret',
    description: 'Required for the connection test. Stored in the local .env only.',
    type: 'string',
    default: '',
    group: EXTERNAL,
    secret: true,
  },
  {
    env: 'BYOC_EXT_TENANT',
    label: 'Webex Tenant',
    description: 'Required for the connection test.',
    type: 'string',
    default: '',
    group: EXTERNAL,
  },
  {
    env: 'BYOC_EXT_END_CHAT_EVENT',
    label: 'Webex End Chat Event Id',
    description: 'Optional.',
    type: 'string',
    default: '',
    group: EXTERNAL,
  },
  {
    env: 'BYOC_EXT_PARTICIPANT_EVENT',
    label: 'Webex Participant Changed Event Id',
    description: 'Optional.',
    type: 'string',
    default: '',
    group: EXTERNAL,
  },
  {
    env: 'BYOC_EXT_MTLS',
    label: 'Enable Webex mTLS',
    description: 'Optional.',
    type: 'boolean',
    default: 'false',
    group: EXTERNAL,
  },
  {
    env: 'BYOC_EXT_MTLS_SUBDOMAIN',
    label: 'Webex mTLS Api Subdomain',
    description: 'Required when mTLS is enabled.',
    type: 'string',
    default: '',
    group: EXTERNAL,
  },
  {
    env: 'BYOC_EXT_MTLS_CERT',
    label: 'Webex mTLS Certificate Name',
    description: 'Required when mTLS is enabled.',
    type: 'string',
    default: '',
    group: EXTERNAL,
  },
  {
    env: 'BYOC_EXT_RECEIPTS_AUTH',
    label: 'Webex Receipts Auth Id',
    description: 'Optional.',
    type: 'string',
    default: '',
    group: EXTERNAL,
  },
  {
    env: 'BYOC_EXT_RECEIPTS_REQUESTED',
    label: 'Webex Receipts Requested',
    description: `Optional. Comma-separated, any of ${RECEIPT_STATUSES.join(', ')}.`,
    type: 'string',
    default: '',
    group: EXTERNAL,
    validate: (value) => {
      const bad = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '' && !RECEIPT_STATUSES.includes(entry));
      return bad.length > 0
        ? `Not a valid status: ${bad.join(', ')}. Use ${RECEIPT_STATUSES.join(', ')}.`
        : undefined;
    },
  },
];

/**
 * Checks that only matter once the connection test is about to run, so they cannot live in the
 * per-field validators (an empty tenant is fine while preparing the org).
 */
export function validateExternalValues(values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  const get = (name: string): string => (values[name] ?? '').trim();
  const isTrue = (name: string): boolean => ['true', '1', 'yes', 'on'].includes(get(name).toLowerCase());

  if (!isTrue('BYOC_EXT_READY')) errors['BYOC_EXT_READY'] = 'Confirm the external system is set up.';
  for (const name of ['BYOC_EXT_SERVICE_ID', 'BYOC_EXT_SERVICE_SECRET', 'BYOC_EXT_TENANT']) {
    if (get(name) === '') errors[name] = 'Required.';
  }
  if (isTrue('BYOC_EXT_MTLS')) {
    for (const name of ['BYOC_EXT_MTLS_SUBDOMAIN', 'BYOC_EXT_MTLS_CERT']) {
      if (get(name) === '') errors[name] = 'Required when mTLS is enabled.';
    }
  }
  return errors;
}
