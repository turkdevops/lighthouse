/**
 * @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

// TODO(esmodules): Node 14, 16 crash with `--experimental-vm-modules` if require and import
// are used in the same test file.
// See https://github.com/GoogleChrome/lighthouse/pull/12702#issuecomment-876832620
// Use normal import when present file is esm.

/** @type {import('path')} */
let path;
/** @type {import('../../fraggle-rock/api.js')} */
let lighthouse;
/** @type {import('puppeteer')} */
let puppeteer;

jest.setTimeout(90_000);

/**
 * Some audits can be notApplicable based on machine timing information.
 * Exclude these audits from applicability comparisons. */
const FLAKY_AUDIT_IDS_APPLICABILITY = new Set([
  'long-tasks', // Depends on whether the longest task takes <50ms.
  'screenshot-thumbnails', // Depends on OS whether frames happen to be generated on non-visual timespan changes.
  'layout-shift-elements', // Depends on if the JS takes too long after input to be ignored for layout shift.
]);

/**
 * @param {LH.Result} lhr
 */
function getAuditsBreakdown(lhr) {
  const auditResults = Object.values(lhr.audits);
  const irrelevantDisplayModes = new Set(['notApplicable', 'manual']);
  const applicableAudits = auditResults.filter(
    audit => !irrelevantDisplayModes.has(audit.scoreDisplayMode)
  );

  const notApplicableAudits = auditResults.filter(
    audit => (
      audit.scoreDisplayMode === 'notApplicable' &&
      !FLAKY_AUDIT_IDS_APPLICABILITY.has(audit.id)
    )
  );

  const informativeAudits = applicableAudits.filter(
    audit => audit.scoreDisplayMode === 'informative'
  );

  const erroredAudits = applicableAudits.filter(
    audit => audit.score === null && audit && !informativeAudits.includes(audit)
  );

  const failedAudits = applicableAudits.filter(audit => audit.score !== null && audit.score < 1);

  return {auditResults, erroredAudits, failedAudits, notApplicableAudits};
}

describe('Fraggle Rock API', () => {
  /** @type {InstanceType<typeof import('../../../lighthouse-cli/test/fixtures/static-server.js').Server>} */
  let server;
  /** @type {import('puppeteer').Browser} */
  let browser;
  /** @type {import('puppeteer').Page} */
  let page;
  /** @type {string} */
  let serverBaseUrl;

  beforeAll(async () => {
    // TODO(esmodules): use normal import when present file is esm.
    const {Server} = await import('../../../lighthouse-cli/test/fixtures/static-server.js');
    path = await import('path');
    lighthouse = await import('../../fraggle-rock/api.js');
    puppeteer = (await import('puppeteer')).default;

    server = new Server();
    await server.listen(0, '127.0.0.1');
    serverBaseUrl = `http://localhost:${server.getPort()}`;
    browser = await puppeteer.launch({
      headless: true,
    });
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page.close();
  });

  afterAll(async () => {
    await browser.close();
    await server.close();
  });

  async function setupTestPage() {
    await page.goto(`${serverBaseUrl}/onclick.html`);
    // Wait for the javascript to run.
    await page.waitForSelector('button');
    await page.click('button');
    // Wait for the violations to appear (and console to be populated).
    await page.waitForSelector('input');
  }

  describe('snapshot', () => {
    beforeEach(() => {
      server.baseDir = path.join(__dirname, '../fixtures/fraggle-rock/snapshot-basic');
    });

    it('should compute accessibility results on the page as-is', async () => {
      await setupTestPage();

      const result = await lighthouse.snapshot({page});
      if (!result) throw new Error('Lighthouse failed to produce a result');

      const {lhr} = result;
      const accessibility = lhr.categories.accessibility;
      expect(accessibility.score).toBeLessThan(1);

      const {auditResults, erroredAudits, failedAudits} = getAuditsBreakdown(lhr);
      // TODO(FR-COMPAT): This assertion can be removed when full compatibility is reached.
      expect(auditResults.length).toMatchInlineSnapshot(`80`);

      expect(erroredAudits).toHaveLength(0);
      expect(failedAudits.map(audit => audit.id)).toContain('label');
    });
  });

  describe('startTimespan', () => {
    beforeEach(() => {
      server.baseDir = path.join(__dirname, '../fixtures/fraggle-rock/snapshot-basic');
    });

    it('should compute ConsoleMessage results across a span of time', async () => {
      const run = await lighthouse.startTimespan({page});

      await setupTestPage();

      const result = await run.endTimespan();
      if (!result) throw new Error('Lighthouse failed to produce a result');

      const {lhr} = result;
      const bestPractices = lhr.categories['best-practices'];
      expect(bestPractices.score).toBeLessThan(1);

      const {
        auditResults,
        erroredAudits,
        failedAudits,
        notApplicableAudits,
      } = getAuditsBreakdown(lhr);
      // TODO(FR-COMPAT): This assertion can be removed when full compatibility is reached.
      expect(auditResults.length).toMatchInlineSnapshot(`48`);

      expect(notApplicableAudits.length).toMatchInlineSnapshot(`5`);
      expect(notApplicableAudits.map(audit => audit.id)).not.toContain('server-response-time');
      expect(notApplicableAudits.map(audit => audit.id)).not.toContain('total-blocking-time');

      expect(erroredAudits).toHaveLength(0);
      expect(failedAudits.map(audit => audit.id)).toContain('errors-in-console');

      const errorsInConsole = lhr.audits['errors-in-console'];
      if (!errorsInConsole.details) throw new Error('Error in consoles audit missing details');
      if (errorsInConsole.details.type !== 'table') throw new Error('Unexpected details');
      const errorLogs = errorsInConsole.details.items;
      const matchingLog = errorLogs.find(
        log =>
          log.source === 'console.error' &&
          String(log.description || '').includes('violations added')
      );
      // If we couldn't find it, assert something similar on the object that we know will fail
      // for a better debug message.
      if (!matchingLog) expect(errorLogs).toContain({description: /violations added/});

      // Check that network request information was computed.
      expect(lhr.audits).toHaveProperty('total-byte-weight');
      const details = lhr.audits['total-byte-weight'].details;
      if (!details || details.type !== 'table') throw new Error('Unexpected byte weight details');
      expect(details.items).toMatchObject([{url: `${serverBaseUrl}/onclick.html`}]);
    });

    it('should compute results from timespan after page load', async () => {
      await page.goto(`${serverBaseUrl}/onclick.html`);
      await page.waitForSelector('button');

      const run = await lighthouse.startTimespan({page});

      await page.click('button');
      await page.waitForSelector('input');

      const result = await run.endTimespan();

      if (!result) throw new Error('Lighthouse failed to produce a result');

      const {auditResults, erroredAudits, notApplicableAudits} = getAuditsBreakdown(result.lhr);
      expect(auditResults.length).toMatchInlineSnapshot(`48`);

      expect(notApplicableAudits.length).toMatchInlineSnapshot(`19`);
      expect(notApplicableAudits.map(audit => audit.id)).toContain('server-response-time');
      expect(notApplicableAudits.map(audit => audit.id)).not.toContain('total-blocking-time');

      expect(erroredAudits).toHaveLength(0);
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      server.baseDir = path.join(__dirname, '../fixtures/fraggle-rock/navigation-basic');
    });

    it('should compute both snapshot & timespan results', async () => {
      const result = await lighthouse.navigation({page, url: `${serverBaseUrl}/index.html`});
      if (!result) throw new Error('Lighthouse failed to produce a result');

      const {lhr} = result;
      const {auditResults, failedAudits, erroredAudits} = getAuditsBreakdown(lhr);
      // TODO(FR-COMPAT): This assertion can be removed when full compatibility is reached.
      expect(auditResults.length).toMatchInlineSnapshot(`154`);
      expect(erroredAudits).toHaveLength(0);

      const failedAuditIds = failedAudits.map(audit => audit.id);
      expect(failedAuditIds).toContain('label');
      expect(failedAuditIds).toContain('errors-in-console');

      // Check that network request information was computed.
      expect(lhr.audits).toHaveProperty('total-byte-weight');
      const details = lhr.audits['total-byte-weight'].details;
      if (!details || details.type !== 'table') throw new Error('Unexpected byte weight details');
      expect(details.items).toMatchObject([{url: `${serverBaseUrl}/index.html`}]);

      // Check that performance metrics were computed.
      expect(lhr.audits).toHaveProperty('first-contentful-paint');
      expect(Number.isFinite(lhr.audits['first-contentful-paint'].numericValue)).toBe(true);
    });
  });
});
