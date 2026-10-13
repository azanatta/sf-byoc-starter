/**
 * Second stage, step two: prove the round trip.
 *
 *   customer types in the chat widget → external system → package REST endpoint → Interaction API
 *   → messaging session → Omni-Channel → agent accepts → Enhanced Conversation shows the message
 *
 * Both sides run in one browser: the agent in the console app, the customer on the widget page.
 * Success is the customer's exact message being visible inside the Enhanced Conversation component.
 */

import type { Frame, Locator, Page } from '@playwright/test';
import { byocConfig } from '../../config/byoc.config.js';
import { findChannelDefinition } from '../byoc/channel-definition.js';
import { queryAll } from '../byoc/org.js';
import { orgIdOf, readState, updateState } from '../byoc/state.js';
import { requireOrg, type Phase, type PhaseContext } from '../types.js';
import { CHAT_WIDGET_PAGE } from './byoc-20-org-prep.js';

const CONSOLE_APP = 'Messaging_Console';
const AVAILABLE_STATUS = 'Messaging Available';
const ENHANCED_CONVERSATION = 'scrt-conversation-body';
const AFTER_VERIFY_MS = 10_000;

export const byocE2ePhase: Phase = {
  id: 'byoc-e2e',
  title: 'Connection test: chat widget → Omni-Channel → Enhanced Conversation',
  usesBrowser: true,

  async run(ctx: PhaseContext) {
    const org = requireOrg(ctx);
    const { widget } = byocConfig();
    if (widget.inputSelector === '') throw new Error('No message input selector configured. Set BYOC_WIDGET_INPUT.');

    const startedAt = new Date(Date.now() - 5_000).toISOString().replace(/\.\d+Z$/, 'Z');
    const message = `connection test ${Date.now()}`;

    const agent = await ctx.ui();
    await goOnline(ctx, agent, org.instanceUrl);

    const customer = await agent.context().newPage();
    try {
      await sendFromWidget(ctx, customer, `${org.instanceUrl}/apex/${CHAT_WIDGET_PAGE}`, message);

      ctx.log.step(`Waiting up to ${widget.timeoutSeconds}s for the chat to arrive in Omni-Channel`);
      const outcome = await acceptUntilShown(ctx, agent, message, widget.timeoutSeconds * 1000);
      if (outcome === 'no-work') throw new Error(await diagnoseNoWork(ctx, startedAt, widget.timeoutSeconds));
      if (outcome === 'not-shown') {
        throw new Error(
          'A work item was routed and accepted, but no Enhanced Conversation component shows the ' +
            `message sent from the widget ("${message}"). Check that the Messaging Session record page ` +
            'is the one this project deploys.',
        );
      }
      ctx.log.success('SETUP SUCCESS — the chat from the widget was routed, accepted and shown in Enhanced Conversation');
      ctx.facts['Connection test'] = 'passed';
      const handoff = readState(orgIdOf(org)).handoff;
      if (handoff) updateState(orgIdOf(org), { handoff: { ...handoff, connectedAt: new Date().toISOString() } });
    } finally {
      await screenshot(ctx, customer, 'byoc-e2e-customer');
      await customer.close().catch(() => undefined);
    }
  },
};

/**
 * Accepts offered work until an Enhanced Conversation shows `message`, and ends every conversation
 * it accepts.
 *
 * More than one offer can be pending (an earlier run that failed before accepting), so the first
 * Accept button is not necessarily this conversation. A conversation left open stays with the agent
 * or goes back to waiting, uses up capacity and is offered again on the next run.
 */
export async function acceptUntilShown(
  ctx: PhaseContext,
  agent: Page,
  message: string,
  timeoutMs: number,
): Promise<'shown' | 'no-work' | 'not-shown'> {
  const deadline = Date.now() + timeoutMs;
  const shown = agent.locator(ENHANCED_CONVERSATION).filter({ hasText: message }).first();
  let accepted = 0;
  let found = false;

  // Once the test conversation is found, the remaining offers are only drained, so wait briefly.
  while (found || Date.now() < deadline) {
    const accept = agent.getByRole('button', { name: 'Accept', exact: true }).first();
    try {
      await accept.waitFor({ state: 'visible', timeout: found ? 5_000 : Math.max(1_000, deadline - Date.now()) });
    } catch {
      break;
    }
    accepted += 1;
    ctx.log.success(`Work item ${accepted} routed to the agent in Omni-Channel; accepting`);
    await accept.click();
    if (!found) {
      try {
        await shown.waitFor({ state: 'visible', timeout: 30_000 });
        found = true;
        ctx.log.success('The message from the widget is shown in Enhanced Conversation');
        await screenshot(ctx, agent, 'byoc-e2e-conversation');
        // Left open briefly so the external system sees an answered conversation before the end.
        await agent.waitForTimeout(AFTER_VERIFY_MS);
      } catch {
        ctx.log.step('That conversation is not the one just started; ending it and looking for another offer');
      }
    }
    await endConversation(ctx, agent);
  }
  if (found) return 'shown';
  return accepted === 0 ? 'no-work' : 'not-shown';
}

/**
 * Ends the conversation in the focused workspace tab and closes the tab.
 *
 * The session status cannot be written through the API, and End Chat is enabled only while the
 * agent has the work open, so this has to happen here, right after accepting.
 */
async function endConversation(ctx: PhaseContext, agent: Page): Promise<void> {
  const end = agent.getByRole('button', { name: 'End Chat', exact: true }).filter({ visible: true }).first();
  try {
    await end.waitFor({ state: 'visible', timeout: 30_000 });
    await end.click({ timeout: 15_000 });
    await agent.waitForFunction((button) => (button as HTMLButtonElement).disabled, await end.elementHandle(), {
      timeout: 15_000,
    });
    ctx.log.success('Conversation ended');
  } catch {
    ctx.log.warn('Could not end the conversation; end it in the console app (End Chat).');
  }
  const close = agent.getByRole('button', { name: /^Close MS-/ }).filter({ visible: true }).first();
  await close.click({ timeout: 10_000 }).catch(() => undefined);
  await close.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
}

async function screenshot(ctx: PhaseContext, page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${ctx.config.runtime.artifactDir}/${name}.png` }).catch(() => undefined);
}

/** Opens the console app and sets the Omni-Channel status that carries the Messaging channel. */
export async function goOnline(ctx: PhaseContext, page: Page, instanceUrl: string): Promise<void> {
  const lightning = instanceUrl.replace('.my.salesforce.com', '.lightning.force.com');
  ctx.log.step('Opening the console app and going online in Omni-Channel');
  await page.goto(`${lightning}/lightning/app/c__${CONSOLE_APP}`, { waitUntil: 'domcontentloaded' });

  const utility = page.getByRole('button', { name: /Omni-Channel/i }).first();
  await utility.waitFor({ state: 'visible', timeout: ctx.config.runtime.navigationTimeoutMs });
  const status = page.getByRole('button', { name: /Change your Omni-Channel status/i }).first();
  if (!(await status.isVisible().catch(() => false))) await utility.click();
  await status.waitFor({ state: 'visible' });
  await status.click();
  await page.getByRole('menuitem', { name: AVAILABLE_STATUS }).first().click();
  await page
    .getByRole('button', { name: /Omni-Channel \(Online\)/i })
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 })
    .catch(() => {
      throw new Error(
        `Could not go online with the "${AVAILABLE_STATUS}" status. Check the presence permission set ` +
          'and that the user is a Service Cloud user.',
      );
    });
  ctx.log.success(`Agent is online (${AVAILABLE_STATUS})`);
}

/** Widgets live in iframes, some of them about:blank, so every frame is searched. */
async function findInFrames(page: Page, selector: string, timeoutMs: number): Promise<Locator | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames() as Frame[]) {
      const candidate = frame.locator(selector).first();
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
    await page.waitForTimeout(500);
  }
  return undefined;
}

/** A send control can be a link with `aria-disabled`, so both that and the native state are checked. */
async function waitUntilEnabled(page: Page, control: Locator, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ariaDisabled = await control.getAttribute('aria-disabled').catch(() => null);
    if (ariaDisabled !== 'true' && (await control.isEnabled().catch(() => false))) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function sendFromWidget(ctx: PhaseContext, page: Page, url: string, message: string): Promise<void> {
  const { widget } = byocConfig();
  ctx.log.step('Opening the chat widget page');
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  if (widget.launcherSelector !== '') {
    const launcher = await findInFrames(page, widget.launcherSelector, 60_000);
    if (!launcher) {
      await screenshot(ctx, page, 'byoc-e2e-widget-missing');
      throw new Error(
        `The chat widget did not appear (no "${widget.launcherSelector}"). Check the widget markup, and ` +
          'that the external system allows this org domain to load the widget.',
      );
    }
    await launcher.click();
  }

  if (widget.startSelector !== '') {
    const start = await findInFrames(page, widget.startSelector, 8_000);
    if (start) await start.click();
  }

  const input = await findInFrames(page, widget.inputSelector, 30_000);
  if (!input) {
    await screenshot(ctx, page, 'byoc-e2e-widget-no-input');
    throw new Error(`The chat opened but the message box "${widget.inputSelector}" was not found.`);
  }
  // The text is set in one step and never typed at the page: the widget moves focus while the chat
  // starts, and keys typed then land on its other controls (one of them ends the chat). A send
  // control that enables on key events is woken with a key pressed on the input itself.
  const send = widget.sendSelector === '' ? undefined : await findInFrames(page, widget.sendSelector, 5_000);
  let typed = '';
  let enabled = false;
  // The widget can redraw the box while the chat starts and drop the text, so it is set again.
  for (let attempt = 0; attempt < 5 && typed.trim() !== message; attempt++) {
    if (attempt > 0) await page.waitForTimeout(1_500);
    await input.fill(message);
    enabled = send !== undefined && (await waitUntilEnabled(page, send, 2_000));
    if (send && !enabled) {
      await input.press('End');
      enabled = await waitUntilEnabled(page, send, 3_000);
    }
    typed = await input.inputValue().catch(() => input.innerText());
  }
  if (typed.trim() !== message) {
    await screenshot(ctx, page, 'byoc-e2e-widget-input');
    throw new Error(`The widget message box holds "${typed}" instead of "${message}"; nothing was sent.`);
  }
  if (send && enabled) await send.click();
  else await input.press('Enter');

  const bubble = await findInFrames(page, `text=${message}`, 15_000);
  if (!bubble) {
    await screenshot(ctx, page, 'byoc-e2e-widget-not-sent');
    throw new Error(`The widget did not show "${message}" as sent. Check BYOC_WIDGET_INPUT and BYOC_WIDGET_SEND.`);
  }
  ctx.log.success(`Customer message sent from the widget: "${message}"`);
}

/** Turns "nothing arrived" into the most specific statement the org can support. */
async function diagnoseNoWork(ctx: PhaseContext, startedAt: string, timeoutSeconds: number): Promise<string> {
  const sessions = await queryAll<{ Id: string; Status: string; Owner: { Name: string } | null }>(
    ctx,
    `SELECT Id, Status, Owner.Name FROM MessagingSession WHERE CreatedDate >= ${startedAt}`,
  ).catch(() => []);
  const head = `No chat arrived in Omni-Channel within ${timeoutSeconds}s.`;
  if (sessions.length === 0) return `${head} No messaging session was created. ${await diagnoseNoSession(ctx, startedAt)}`;
  const list = sessions.map((s) => `${s.Id} ${s.Status} owner=${s.Owner?.Name ?? '?'}`).join('; ');
  const open = await queryAll(ctx, "SELECT Id FROM AgentWork WHERE Status = 'Opened'").catch(() => []);
  if (open.length > 0) {
    return (
      `${head} A messaging session WAS created (${list}), so the connection works. The agent already ` +
      `has ${open.length} open conversation(s), probably from earlier test runs, which can use up the ` +
      'agent capacity: end them in the console app and run the test again.'
    );
  }
  return (
    `${head} A messaging session WAS created (${list}), so the connection works and routing does ` +
    'not: check the channel routing, the queue membership and the agent presence status.'
  );
}

/**
 * Nothing in the org records a request that never reached the package (a wrong endpoint path is a
 * 404 before any package code runs), so the one usable signal is whether the external system
 * obtained a token during the test.
 */
async function diagnoseNoSession(ctx: PhaseContext, startedAt: string): Promise<string> {
  const { inboundApp } = byocConfig();
  // `Application` cannot be filtered in SOQL, so it is filtered here.
  const logins = await queryAll<{ LoginTime: string; Status: string; SourceIp: string; Application: string }>(
    ctx,
    `SELECT LoginTime, Status, SourceIp, Application FROM LoginHistory WHERE LoginTime >= ${startedAt} ` +
      'ORDER BY LoginTime DESC',
  ).then(
    (rows) => rows.filter((row) => row.Application === inboundApp.label),
    () => undefined,
  );
  if (logins === undefined) {
    return (
      'The login history could not be read. Check the external system flow: org domain, channel ' +
      'address identifier, consumer key and secret, and the endpoint it calls.'
    );
  }
  if (logins.length === 0) {
    return (
      `The external system did not request a token for "${inboundApp.label}" during the test, so ` +
      'its flow did not run or could not reach the org. Check that the flow is published and ' +
      'triggered by the widget, and the org domain it uses.'
    );
  }
  const failed = logins.filter((login) => login.Status !== 'Success');
  if (failed.length === logins.length) {
    return (
      `The external system requested a token for "${inboundApp.label}" and was refused ` +
      `(${failed[0]?.Status}). Check the consumer key and secret it uses.`
    );
  }
  const namespace = await findChannelDefinition(ctx).then((definition) => definition.NamespacePrefix, () => null);
  return (
    `The external system DID get a token for "${inboundApp.label}" (${logins[0]?.LoginTime} from ` +
    `${logins[0]?.SourceIp}), so the org domain, consumer key and secret are right, and its next ` +
    'request did not create a session. Check, in this order: (1) the endpoint path that request ' +
    `calls, including the package namespace${namespace ? ` — this org's is "${namespace}"` : ''}; a wrong path is ` +
    'answered 404 and leaves no trace in the org; (2) the package log records in the org: none ' +
    'means the request never reached the package, an error row explains a rejection (for example ' +
    'a wrong channel address identifier).'
  );
}
