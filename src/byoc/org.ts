/**
 * Small org helpers shared by the messaging phases: record DML, metadata deploys, anonymous Apex.
 *
 * Everything goes through `sf()` so commands are logged and failures surface the CLI's own message.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { query, sf, SfCommandError } from '../sf.js';
import { requireOrg, type PhaseContext } from '../types.js';

export function soqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function queryAll<T = Record<string, unknown>>(
  ctx: PhaseContext,
  soql: string,
  useToolingApi = false,
): Promise<T[]> {
  const result = await query<T>(requireOrg(ctx).username, soql, { useToolingApi });
  return result.records;
}

export async function queryFirst<T = Record<string, unknown>>(
  ctx: PhaseContext,
  soql: string,
  useToolingApi = false,
): Promise<T | undefined> {
  return (await queryAll<T>(ctx, soql, useToolingApi))[0];
}

/** `Field=value` pairs for `sf data create|update record --values`. */
function valuesArg(values: Record<string, string | number | boolean>): string {
  return Object.entries(values)
    .map(([field, value]) =>
      typeof value === 'string' ? `${field}='${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : `${field}=${value}`,
    )
    .join(' ');
}

/** API names of the fields on an object, as the org describes them. */
export async function fieldNames(ctx: PhaseContext, sobject: string): Promise<Set<string>> {
  const result = await sf<{ fields: Array<{ name: string }> }>([
    'sobject',
    'describe',
    '--target-org',
    requireOrg(ctx).username,
    '--sobject',
    sobject,
  ]);
  return new Set(result.fields.map((field) => field.name.toLowerCase()));
}

export async function createRecord(
  ctx: PhaseContext,
  sobject: string,
  values: Record<string, string | number | boolean>,
): Promise<string> {
  const result = await sf<{ id: string }>([
    'data',
    'create',
    'record',
    '--target-org',
    requireOrg(ctx).username,
    '--sobject',
    sobject,
    '--values',
    valuesArg(values),
  ]);
  return result.id;
}

export async function updateRecord(
  ctx: PhaseContext,
  sobject: string,
  id: string,
  values: Record<string, string | number | boolean>,
): Promise<void> {
  await sf([
    'data',
    'update',
    'record',
    '--target-org',
    requireOrg(ctx).username,
    '--sobject',
    sobject,
    '--record-id',
    id,
    '--values',
    valuesArg(values),
  ]);
}

interface DeployFailure {
  fullName?: string;
  componentType?: string;
  problem?: string;
}

/** Deploys a source directory and fails with every component problem spelled out. */
export async function deployDir(ctx: PhaseContext, sourceDir: string, what: string): Promise<void> {
  try {
    await sf(
      [
        'project',
        'deploy',
        'start',
        '--target-org',
        requireOrg(ctx).username,
        '--source-dir',
        sourceDir,
        '--wait',
        '20',
        '--ignore-conflicts',
        '--test-level',
        'NoTestRun',
      ],
      { timeoutMs: 25 * 60_000, onCommand: (c) => ctx.log.command(c) },
    );
  } catch (error) {
    const detail = error instanceof SfCommandError ? error.message : String(error);
    const payload = (error instanceof SfCommandError ? error.payload : undefined) as
      | { result?: { details?: { componentFailures?: DeployFailure[] } } }
      | undefined;
    const problems = (payload?.result?.details?.componentFailures ?? []).map(
      (failure) => `  ${failure.componentType ?? 'Component'} ${failure.fullName ?? ''}: ${failure.problem ?? '?'}`,
    );
    throw new Error(`Deploying ${what} failed: ${detail}${problems.length ? `\n${problems.join('\n')}` : ''}`);
  }
}

/** Empties a directory under generated/ and returns a writer for files inside it. */
export function freshDir(relativeDir: string): (relativePath: string, content: string) => void {
  const root = resolve(process.cwd(), relativeDir);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return (relativePath, content) => {
    const target = resolve(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  };
}

interface ApexRunResult {
  compiled: boolean;
  success: boolean;
  compileProblem?: string;
  exceptionMessage?: string;
  logs?: string;
}

/** Runs anonymous Apex and throws on a compile error or an uncaught exception. */
export async function runApex(ctx: PhaseContext, apex: string, what: string): Promise<string> {
  const write = freshDir('generated/byoc/apex');
  write('run.apex', apex);
  let result: ApexRunResult;
  try {
    result = await sf<ApexRunResult>([
      'apex',
      'run',
      '--target-org',
      requireOrg(ctx).username,
      '--file',
      'generated/byoc/apex/run.apex',
    ]);
  } catch (error) {
    const payload = (error instanceof SfCommandError ? error.payload : undefined) as
      | { data?: ApexRunResult; result?: ApexRunResult }
      | undefined;
    const data = payload?.data ?? payload?.result;
    const reason = data?.compileProblem || data?.exceptionMessage || (error instanceof Error ? error.message : String(error));
    throw new Error(`Apex for "${what}" failed: ${reason}`);
  }
  if (!result.compiled || !result.success) {
    throw new Error(`Apex for "${what}" failed: ${result.compileProblem || result.exceptionMessage || 'unknown'}`);
  }
  return result.logs ?? '';
}

/** Assigns a permission set to the running user, treating "already assigned" as success. */
export async function assignPermissionSet(ctx: PhaseContext, name: string): Promise<void> {
  const org = requireOrg(ctx);
  const existing = await queryFirst(
    ctx,
    `SELECT Id FROM PermissionSetAssignment WHERE PermissionSet.Name = ${soqlString(name)} ` +
      `AND Assignee.Username = ${soqlString(org.username)}`,
  );
  if (existing) {
    ctx.log.skip(`"${name}" assigned`);
    return;
  }
  const result = await sf<{ failures?: Array<{ name: string; message: string }> }>(
    ['org', 'assign', 'permset', '--target-org', org.username, '--name', name],
    { onCommand: (c) => ctx.log.command(c) },
  );
  const failure = result.failures?.[0];
  if (failure) throw new Error(`Could not assign permission set "${name}": ${failure.message}`);
  ctx.log.success(`Assigned "${name}"`);
}
