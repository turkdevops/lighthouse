/**
 * @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

import {jest} from '@jest/globals';

import * as lighthouse from '../../../fraggle-rock/api.js';
import {createTestState, getAuditsBreakdown} from './pptr-test-utils.js';
import {LH_ROOT} from '../../../../root.js';

/* eslint-env jest */

jest.setTimeout(90_000);

describe('Fraggle Rock API', () => {
  const state = createTestState();

  state.installSetupAndTeardownHooks();

  async function setupTestPage() {
    await state.page.goto(`${state.serverBaseUrl}/onclick.html`);
    // Wait for the javascript to run.
    await state.page.waitForSelector('button');
    await state.page.click('button');
    // Wait for the violations to appear (and console to be populated).
    await state.page.waitForSelector('input');
  }

  describe('snapshot', () => {
    beforeEach(() => {
      const {server} = state;
      server.baseDir = `${LH_ROOT}/lighthouse-core/test/fixtures/fraggle-rock/snapshot-basic`;
    });

    it('should compute accessibility results on the page as-is', async () => {
      await setupTestPage();

      const result = await lighthouse.snapshot({page: state.page});
      if (!result) throw new Error('Lighthouse failed to produce a result');

      const {lhr} = result;
      const accessibility = lhr.categories.accessibility;
      expect(accessibility.score).toBeLessThan(1);

      const {auditResults, erroredAudits, failedAudits} = getAuditsBreakdown(lhr);
      // TODO(FR-COMPAT): This assertion can be removed when full compatibility is reached.
      expect(auditResults.length).toMatchInlineSnapshot(`76`);

      expect(erroredAudits).toHaveLength(0);
      expect(failedAudits.map(audit => audit.id)).toContain('label');
    });
  });

  describe('startTimespan', () => {
    beforeEach(() => {
      const {server} = state;
      server.baseDir = `${LH_ROOT}/lighthouse-core/test/fixtures/fraggle-rock/snapshot-basic`;
    });

    it('should compute ConsoleMessage results across a span of time', async () => {
      const run = await lighthouse.startTimespan({page: state.page});

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
      expect(auditResults.length).toMatchInlineSnapshot(`44`);

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
      expect(details.items).toMatchObject([{url: `${state.serverBaseUrl}/onclick.html`}]);
    });

    it('should compute results from timespan after page load', async () => {
      const {page, serverBaseUrl} = state;
      await page.goto(`${serverBaseUrl}/onclick.html`);
      await page.waitForSelector('button');

      const run = await lighthouse.startTimespan({page});

      await page.click('button');
      await page.waitForSelector('input');

      const result = await run.endTimespan();

      if (!result) throw new Error('Lighthouse failed to produce a result');

      const {auditResults, erroredAudits, notApplicableAudits} = getAuditsBreakdown(result.lhr);
      expect(auditResults.length).toMatchInlineSnapshot(`44`);

      expect(notApplicableAudits.length).toMatchInlineSnapshot(`19`);
      expect(notApplicableAudits.map(audit => audit.id)).toContain('server-response-time');
      expect(notApplicableAudits.map(audit => audit.id)).not.toContain('total-blocking-time');

      expect(erroredAudits).toHaveLength(0);
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      const {server} = state;
      server.baseDir = `${LH_ROOT}/lighthouse-core/test/fixtures/fraggle-rock/navigation-basic`;
    });

    it('should compute both snapshot & timespan results', async () => {
      const {page, serverBaseUrl} = state;
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
