/**
 * Second stage: the package configuration record. It needs values that only exist after the
 * external system is set up, and the record's external fields are required, so it is created here
 * in one go rather than earlier.
 *
 * Certificate NAME is filled and the private key field is left alone: the vendor guide says to use
 * exactly one of the two.
 */

import { byocConfig, type ConfigField } from '../../config/byoc.config.js';
import { validateExternalValues } from '../../config/byoc-settings.js';
import { createRecord, fieldNames, queryFirst, soqlString, updateRecord } from '../byoc/org.js';
import { orgIdOf, readState } from '../byoc/state.js';
import { requireOrg, type Phase, type PhaseContext } from '../types.js';

const REQUIRED_FIELDS: ConfigField[] = ['platformKey', 'clientId', 'certificateName', 'tenant', 'serviceId', 'serviceSecret'];

export const byocConfigRecordPhase: Phase = {
  id: 'byoc-config-record',
  title: 'Write the package configuration record',

  async run(ctx: PhaseContext) {
    const config = byocConfig();
    const state = readState(orgIdOf(requireOrg(ctx)));

    const problems = Object.entries(validateExternalValues(process.env as Record<string, string>));
    if (problems.length > 0) {
      throw new Error(`External system values are incomplete:\n${problems.map(([name, message]) => `  ${name}: ${message}`).join('\n')}`);
    }
    if (!state.channelAddressIdentifier || !state.interactionConsumerKey) {
      throw new Error('No install state for this org. Run the setup first.');
    }
    if (config.configRecord.object === '') throw new Error('No configuration object configured. Set BYOC_CONFIG_OBJECT.');
    const unmapped = REQUIRED_FIELDS.filter((field) => config.configRecord.fields[field] === '');
    if (unmapped.length > 0) {
      throw new Error(`These configuration record fields have no API name configured: ${unmapped.join(', ')}. Set BYOC_NAMESPACE.`);
    }

    const external = config.external;
    const inputs: Record<ConfigField, string | boolean> = {
      platformKey: state.channelAddressIdentifier,
      label: config.configRecord.label,
      clientId: state.interactionConsumerKey,
      certificateName: ctx.config.certificate.developerName,
      tenant: external.tenant,
      serviceId: external.serviceId,
      serviceSecret: external.serviceSecret,
      endChatEventId: external.endChatEventId,
      participantChangedEventId: external.participantChangedEventId,
      mtlsEnabled: external.mtlsEnabled,
      mtlsSubdomain: external.mtlsEnabled ? external.mtlsSubdomain : '',
      mtlsCertificateName: external.mtlsEnabled ? external.mtlsCertificateName : '',
      receiptsAuthId: external.receiptsAuthId,
      receiptsRequested: external.receiptsRequested,
    };

    const keyField = config.configRecord.fields.platformKey;
    // Some variants of the package lack some fields (e.g. no mTLS support): those values are skipped.
    const present = await fieldNames(ctx, config.configRecord.object);
    if (!present.has(keyField.toLowerCase())) {
      throw new Error(`Field "${keyField}" does not exist on ${config.configRecord.object}; the record cannot be found without it.`);
    }

    const values: Record<string, string | boolean> = {};
    for (const [field, value] of Object.entries(inputs) as Array<[ConfigField, string | boolean]>) {
      const apiName = config.configRecord.fields[field];
      if (apiName === '') {
        if (value !== '' && value !== false) ctx.log.warn(`No field configured for "${field}"; its value is not stored`);
        continue;
      }
      if (!present.has(apiName.toLowerCase())) {
        ctx.log.skip(`Field "${apiName}" does not exist on ${config.configRecord.object}; "${field}" is not stored`);
        continue;
      }
      // Empty optional values are skipped on create rather than sent as blanks.
      if (value === '') continue;
      values[apiName] = value;
    }

    const existing = await queryFirst<{ Id: string }>(
      ctx,
      `SELECT Id FROM ${config.configRecord.object} WHERE ${keyField} = ${soqlString(state.channelAddressIdentifier)}`,
    );
    if (existing) {
      const { [keyField]: _key, ...rest } = values;
      await updateRecord(ctx, config.configRecord.object, existing.Id, rest);
      ctx.log.success('Configuration record updated');
    } else {
      await createRecord(ctx, config.configRecord.object, values);
      ctx.log.success('Configuration record created');
    }
  },
};
