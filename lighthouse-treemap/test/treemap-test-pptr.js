/**
 * @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

/* global document, window */

const fs = require('fs');
const puppeteer = require('puppeteer');
const {server} = require('../../lighthouse-cli/test/fixtures/static-server.js');
const portNumber = 20202;
const treemapUrl = `http://localhost:${portNumber}/dist/gh-pages/treemap/index.html`;
const debugOptions = require('../app/debug.json');

// These tests run in Chromium and have their own timeouts.
// Make sure we get the more helpful test-specific timeout error instead of jest's generic one.
jest.setTimeout(35_000);

function getTextEncodingCode() {
  const code = fs.readFileSync(require.resolve('../../report/renderer/text-encoding.js'), 'utf-8');
  return code.replace('export ', '');
}

describe('Lighthouse Treemap', () => {
  // eslint-disable-next-line no-console
  console.log('\n✨ Be sure to have recently run this: yarn build-treemap');

  /** @type {import('puppeteer').Browser} */
  let browser;
  /** @type {import('puppeteer').Page} */
  let page;
  /** @type {Error[]} */
  let pageErrors = [];

  beforeAll(async function() {
    await server.listen(portNumber, 'localhost');
  });

  afterAll(async function() {
    await Promise.all([
      server.close(),
      browser && browser.close(),
    ]);
  });

  beforeEach(async () => {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
      });
    }
    page = await browser.newPage();
    page.on('pageerror', pageError => pageErrors.push(pageError));
  });

  afterEach(async () => {
    await page.close();

    // Fails if any unexpected errors ocurred.
    // If a test expects an error, it will clear this array.
    expect(pageErrors).toMatchObject([]);
    pageErrors = [];
  });

  describe('Recieves options', () => {
    it('from debug data', async () => {
      await page.goto(`${treemapUrl}?debug`, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });
      const options = await page.evaluate(() => window.__treemapOptions);
      expect(options.lhr.requestedUrl).toBe(debugOptions.lhr.requestedUrl);
    });

    // TODO: remove for v8
    async function loadFromPostMessage(options) {
      const openerPage = await browser.newPage();
      await openerPage.evaluate((treemapUrl, options) => {
        const popup = window.open(treemapUrl);
        window.addEventListener('message', () => {
          popup.postMessage(options, new URL(treemapUrl).origin);
        });
      }, treemapUrl, options);
      await new Promise(resolve => browser.on('targetcreated', resolve));
      const target = (await browser.targets()).find(target => target.url() === treemapUrl);
      page = await target.page();
      await page.waitForFunction(() => {
        if (window.__treemapOptions) return true;

        const el = document.querySelector('#lh-log');
        if (el && el.textContent.startsWith('Error')) return true;
      });
    }

    it('from window postMessage', async () => {
      await loadFromPostMessage(debugOptions);
      const optionsInPage = await page.evaluate(() => window.__treemapOptions);
      expect(optionsInPage.lhr.requestedUrl).toBe(debugOptions.lhr.requestedUrl);
    });

    it('handles errors', async () => {
      await loadFromPostMessage({});
      const optionsInPage = await page.evaluate(() => window.__treemapOptions);
      expect(optionsInPage).toBeUndefined();
      const error = await page.evaluate(() => document.querySelector('#lh-log').textContent);
      expect(error).toBe('Error: Invalid options');
    });

    it('from encoded fragment (gzip)', async () => {
      const options = JSON.parse(JSON.stringify(debugOptions));
      options.lhr.requestedUrl += '😃😃😃';
      const json = JSON.stringify(options);
      const encoded = await page.evaluate(`
        ${getTextEncodingCode()}
        TextEncoding.toBase64(${JSON.stringify(json)}, {gzip: true});
      `);

      await page.goto(`${treemapUrl}?gzip=1#${encoded}`);
      await page.waitForFunction(
        () => window.__treemapOptions || document.body.textContent.startsWith('Error'));

      const optionsInPage = await page.evaluate(() => window.__treemapOptions);
      expect(optionsInPage.lhr.requestedUrl).toBe(options.lhr.requestedUrl);
    });

    it('from encoded fragment (no gzip)', async () => {
      const options = JSON.parse(JSON.stringify(debugOptions));
      options.lhr.requestedUrl += '😃😃😃';
      const json = JSON.stringify(options);
      const encoded = await page.evaluate(`
        ${getTextEncodingCode()}
        TextEncoding.toBase64(${JSON.stringify(json)}, {gzip: false});
      `);

      await page.goto(`${treemapUrl}#${encoded}`);
      await page.waitForFunction(
        () => window.__treemapOptions || document.body.textContent.startsWith('Error'));

      const optionsInPage = await page.evaluate(() => window.__treemapOptions);
      expect(optionsInPage.lhr.requestedUrl).toBe(options.lhr.requestedUrl);
    });
  });

  describe('renders correctly', () => {
    it('correctly shades coverage of gtm node', async () => {
      await page.goto(`${treemapUrl}?debug`, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      await page.click('#view-mode--unused-bytes');
      await page.waitForSelector('.lh-treemap--view-mode--unused-bytes');

      // Identify the JS data.
      const gtmNode = await page.evaluate(() => {
        const d1Nodes = window.__treemapOptions.lhr.audits['script-treemap-data'].details.nodes;
        const gtmNode = d1Nodes.find(n => n.name.includes('gtm.js'));
        return gtmNode;
      });

      expect(gtmNode.unusedBytes).toBeGreaterThan(20_000);
      expect(gtmNode.resourceBytes).toBeGreaterThan(20_000);

      // Identify the DOM node.
      const gtmElemHandle = await page.evaluateHandle(() => {
        const captionEls = Array.from(document.querySelectorAll('.webtreemap-caption'));
        return captionEls.find(el => el.textContent.includes('gtm.js')).parentElement;
      });

      expect(await gtmElemHandle.isIntersectingViewport()).toBeTruthy();

      // Determine visual red shading percentage.
      const percentRed = await gtmElemHandle.evaluate(node => {
        const redWidthPx = parseInt(window.getComputedStyle(node, ':before').width);
        const completeWidthPx = node.getBoundingClientRect().width;
        return redWidthPx / completeWidthPx;
      });

      // Reminder! UNUSED == RED
      const percentDataUnused = gtmNode.unusedBytes / gtmNode.resourceBytes;
      expect(percentDataUnused).toBeGreaterThan(0);

      // Assert 0.2520 ~= 0.2602 w/ 1 decimal place of precision.
      // CSS pixels won't let us go to 2 decimal places.
      expect(percentRed).toBeApproximately(percentDataUnused, 1);
    });
  });
});
