/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const {isIcuMessage} = require('../../../shared/localization/format.js');
const {getTranslatedDescription, parseCsp} = require('../../lib/csp-evaluator.js');

const {
  evaluateForFailure,
  evaluateForWarnings,
  evaluateForSyntaxErrors,
} = require('csp_evaluator/dist/lighthouse/lighthouse_checks.js');

/**
 * @param {string[]} rawCsps
 */
function evaluateRawCspForFailures(rawCsps) {
  return evaluateForFailure(rawCsps.map(parseCsp));
}

/**
 * @param {string[]} rawCsps
 */
function evaluateRawCspForWarnings(rawCsps) {
  return evaluateForWarnings(rawCsps.map(parseCsp));
}

/**
 * @param {string[]} rawCsps
 */
function evaluateRawCspForSyntax(rawCsps) {
  return evaluateForSyntaxErrors(rawCsps.map(parseCsp));
}

/* eslint-env jest */

describe('getTranslatedDescription', () => {
  it('missing script-src', () => {
    const rawCsp = `object-src 'none'`;
    const findings = evaluateRawCspForFailures([rawCsp]);
    const translated = findings.map(getTranslatedDescription);

    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'script-src directive is missing. This can allow the execution of unsafe scripts.'
    );
  });

  it('missing object-src', () => {
    const rawCsp = `script-src 'none'`;
    const findings = evaluateRawCspForFailures([rawCsp]);
    const translated = findings.map(getTranslatedDescription);

    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'Missing object-src allows the injection of plugins that execute unsafe scripts. ' +
      'Consider setting object-src to \'none\' if you can.'
    );
  });

  it('missing base-uri', () => {
    const rawCsp = `script-src 'nonce-000000000'; object-src 'none'`;
    const findings = evaluateRawCspForFailures([rawCsp]);
    const translated = findings.map(getTranslatedDescription);

    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'Missing base-uri allows injected <base> tags to set the base URL for all ' +
      'relative URLs (e.g. scripts) to an attacker controlled domain. ' +
      'Consider setting base-uri to \'none\' or \'self\'.'
    );
  });

  it('unsafe-inline', () => {
    const rawCsp = `script-src 'unsafe-inline'; object-src 'none'`;
    const findings = evaluateRawCspForFailures([rawCsp]);
    const translated = findings.map(getTranslatedDescription);

    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      '\'unsafe-inline\' allows the execution of unsafe in-page scripts ' +
      'and event handlers. Consider using CSP nonces or hashes to allow scripts individually.'
    );
  });

  it('wildcard', () => {
    const rawCsp = `script-src 'strict-dynamic' *; object-src *`;
    const findings = evaluateRawCspForFailures([rawCsp]);
    const translated = findings.map(getTranslatedDescription);

    expect(translated).toHaveLength(1);
    expect(findings[0].directive).toEqual('object-src');
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'Avoid using plain wildcards (*) in this directive. ' +
      'Plain wildcards allow scripts to be sourced from an unsafe domain.'
    );
  });

  it('plain url scheme', () => {
    const rawCsp = `script-src 'strict-dynamic' https:; object-src https:`;
    const findings = evaluateRawCspForFailures([rawCsp]);
    const translated = findings.map(getTranslatedDescription);

    expect(translated).toHaveLength(1);
    expect(findings[0].directive).toEqual('object-src');
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'Avoid using plain URL schemes (https:) in this directive. ' +
      'Plain URL schemes allow scripts to be sourced from an unsafe domain.'
    );
  });

  it('strict-dynamic', () => {
    const rawCsp = `script-src https://example.com; object-src 'none'`;
    const findings = evaluateRawCspForFailures([rawCsp]);
    const translated = findings.map(getTranslatedDescription);

    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'Host allowlists can frequently be bypassed. Consider using ' +
      'CSP nonces or hashes instead, along with \'strict-dynamic\' if necessary.'
    );
  });

  it('no allowlist fallback', () => {
    const rawCsp = `script-src 'strict-dynamic'; report-uri https://example.com`;
    const findings = evaluateRawCspForWarnings([rawCsp]);
    const translated = findings.map(getTranslatedDescription);

    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'Consider adding https: and http: URL schemes (ignored by browsers ' +
      'supporting \'strict-dynamic\') to be backward compatible with older browsers.'
    );
  });

  it('no unsafe-inline fallback', () => {
    const rawCsp = `script-src 'nonce-00000000'; report-uri https://example.com`;
    const findings = evaluateRawCspForWarnings([rawCsp]);
    const translated = findings.map(getTranslatedDescription);

    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'Consider adding \'unsafe-inline\' (ignored by browsers supporting ' +
      'nonces/hashes) to be backward compatible with older browsers.'
    );
  });

  it('missing semicolon', () => {
    const rawCsp = `script-src 'none' object-src 'none'`;
    const findings = evaluateRawCspForSyntax([rawCsp]);

    expect(findings).toHaveLength(1);

    const translated = findings[0].map(getTranslatedDescription);
    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'Did you forget the semicolon? ' +
      'object-src seems to be a directive, not a keyword.'
    );
  });

  it('unknown directive', () => {
    const rawCsp = `foo-bar 'none'`;
    const findings = evaluateRawCspForSyntax([rawCsp]);

    expect(findings).toHaveLength(1);

    const translated = findings[0].map(getTranslatedDescription);
    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'Unknown CSP directive.'
    );
  });

  it('unknown keyword', () => {
    const rawCsp = `script-src 'asdf'`;
    const findings = evaluateRawCspForSyntax([rawCsp]);

    expect(findings).toHaveLength(1);

    const translated = findings[0].map(getTranslatedDescription);
    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      '\'asdf\' seems to be an invalid keyword.'
    );
  });

  it('nonce length', () => {
    const rawCsp = `script-src 'nonce-0000'`;
    const findings = evaluateRawCspForSyntax([rawCsp]);

    expect(findings).toHaveLength(1);

    const translated = findings[0].map(getTranslatedDescription);
    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'Nonces should be at least 8 characters long.'
    );
  });

  it('nonce charset', () => {
    const rawCsp = `script-src 'nonce-::::::::'`;
    const findings = evaluateRawCspForSyntax([rawCsp]);

    expect(findings).toHaveLength(1);

    const translated = findings[0].map(getTranslatedDescription);
    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'Nonces should use the base64 charset.'
    );
  });

  it('deprecated reflected-xss', () => {
    const rawCsp = `reflected-xss 'none'`;
    const findings = evaluateRawCspForSyntax([rawCsp]);

    expect(findings).toHaveLength(1);

    const translated = findings[0].map(getTranslatedDescription);
    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'reflected-xss is deprecated since CSP2. ' +
      'Please, use the X-XSS-Protection header instead.'
    );
  });

  it('deprecated referrer', () => {
    const rawCsp = `referrer 'none'`;
    const findings = evaluateRawCspForSyntax([rawCsp]);

    expect(findings).toHaveLength(1);

    const translated = findings[0].map(getTranslatedDescription);
    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'referrer is deprecated since CSP2. ' +
      'Please, use the Referrer-Policy header instead.'
    );
  });

  it('deprecated disown-opener', () => {
    const rawCsp = `disown-opener 'none'`;
    const findings = evaluateRawCspForSyntax([rawCsp]);

    expect(findings).toHaveLength(1);

    const translated = findings[0].map(getTranslatedDescription);
    expect(translated).toHaveLength(1);
    expect(isIcuMessage(translated[0])).toBeTruthy();
    expect(translated[0]).toBeDisplayString(
      'disown-opener is deprecated since CSP3. ' +
      'Please, use the Cross-Origin-Opener-Policy header instead.'
    );
  });
});
