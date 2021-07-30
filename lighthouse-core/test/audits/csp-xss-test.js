/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const CspXss = require('../../audits/csp-xss.js');
const {Type} = require('csp_evaluator/dist/finding.js');
const networkRecordsToDevtoolsLog = require('../network-records-to-devtools-log.js');

/* eslint-env jest */

const SEVERITY = {
  syntax: {
    formattedDefault: 'Syntax',
  },
  high: {
    formattedDefault: 'High',
  },
  medium: {
    formattedDefault: 'Medium',
  },
};

const STATIC_RESULTS = {
  noObjectSrc: {
    severity: SEVERITY.high,
    description: {
      formattedDefault:
        'Elements controlled by object-src are considered legacy features. ' +
        'Consider setting object-src to \'none\' to prevent the injection of ' +
        'plugins that execute unsafe scripts.',
    },
    directive: 'object-src',
  },
  noBaseUri: {
    severity: SEVERITY.high,
    description: {
      formattedDefault:
        'Missing base-uri allows injected <base> tags to set the base URL for all ' +
        'relative URLs (e.g. scripts) to an attacker controlled domain. ' +
        'Consider setting base-uri to \'none\' or \'self\'.',
    },
    directive: 'base-uri',
  },
  noReportingDestination: {
    severity: SEVERITY.medium,
    description: {
      formattedDefault:
        'No CSP configures a reporting destination. ' +
        'This makes it difficult to maintain the CSP over time and monitor for any breakages.',
    },
    directive: 'report-uri',
  },
  metaTag: {
    severity: SEVERITY.medium,
    description: {
      formattedDefault:
        'The page contains a CSP defined in a <meta> tag. ' +
        'Consider defining the CSP in an HTTP header if you can.',
    },
    directive: undefined,
  },
  unsafeInlineFallback: {
    severity: SEVERITY.medium,
    description: {
      formattedDefault:
        'Consider adding \'unsafe-inline\' (ignored by browsers supporting ' +
        'nonces/hashes) to be backward compatible with older browsers.',
    },
    directive: 'script-src',
  },
};

it('audit basic header', async () => {
  const artifacts = {
    URL: 'https://example.com',
    MetaElements: [],
    devtoolsLogs: {
      defaultPass: networkRecordsToDevtoolsLog([
        {
          url: 'https://example.com',
          responseHeaders: [
            {name: 'Content-Security-Policy', value: `script-src 'nonce-12345678'; foo-bar 'none'`},
          ],
        },
      ]),
    },
  };
  const results = await CspXss.audit(artifacts, {computedCache: new Map()});
  expect(results.notApplicable).toBeFalsy();
  expect(results.details.items).toMatchObject(
    [
      {
        severity: SEVERITY.syntax,
        description: {
          value:
            'script-src \'nonce-12345678\'; foo-bar \'none\'',
        },
        subItems: {
          type: 'subitems',
          items: [
            {
              description: {
                formattedDefault: 'Unknown CSP directive.',
              },
              directive: 'foo-bar',
            },
          ],
        },
      },
      STATIC_RESULTS.noObjectSrc,
      STATIC_RESULTS.noBaseUri,
      STATIC_RESULTS.noReportingDestination,
      STATIC_RESULTS.unsafeInlineFallback,
    ]
  );
});

it('marked N/A if no warnings found', async () => {
  const artifacts = {
    URL: 'https://example.com',
    MetaElements: [],
    devtoolsLogs: {
      defaultPass: networkRecordsToDevtoolsLog([
        {
          url: 'https://example.com',
          responseHeaders: [
            {
              name: 'Content-Security-Policy',
              value: `script-src 'none'; object-src 'none'; base-uri 'none'; report-uri https://csp.example.com`},
          ],
        },
      ]),
    },
  };
  const results = await CspXss.audit(artifacts, {computedCache: new Map()});
  expect(results.details.items).toHaveLength(0);
  expect(results.notApplicable).toBeTruthy();
});

describe('getRawCsps', () => {
  it('basic case', async () => {
    const artifacts = {
      URL: 'https://example.com',
      MetaElements: [
        {
          httpEquiv: 'Content-Security-Policy',
          content: `default-src 'none'`,
        },
      ],
      devtoolsLogs: {
        defaultPass: networkRecordsToDevtoolsLog([
          {
            url: 'https://example.com',
            responseHeaders: [
              {
                name: 'Content-Security-Policy',
                value: `script-src 'none'`,
              },
              {
                name: 'Content-Security-Policy',
                value: `object-src 'none'`,
              },
            ],
          },
        ]),
      },
    };
    const {cspHeaders, cspMetaTags}
      = await CspXss.getRawCsps(artifacts, {computedCache: new Map()});
    expect(cspHeaders).toEqual([
      `script-src 'none'`,
      `object-src 'none'`,
    ]);
    expect(cspMetaTags).toEqual([
      `default-src 'none'`,
    ]);
  });

  it('split on comma', async () => {
    const artifacts = {
      URL: 'https://example.com',
      MetaElements: [],
      devtoolsLogs: {
        defaultPass: networkRecordsToDevtoolsLog([
          {
            url: 'https://example.com',
            responseHeaders: [
              {
                name: 'Content-Security-Policy',
                value: `script-src 'none',default-src 'none'`,
              },
              {
                name: 'Content-Security-Policy',
                value: `object-src 'none'`,
              },
            ],
          },
        ]),
      },
    };
    const {cspHeaders, cspMetaTags}
      = await CspXss.getRawCsps(artifacts, {computedCache: new Map()});
    expect(cspHeaders).toEqual([
      `script-src 'none'`,
      `default-src 'none'`,
      `object-src 'none'`,
    ]);
    expect(cspMetaTags).toEqual([]);
  });

  it('ignore if empty', async () => {
    const artifacts = {
      URL: 'https://example.com',
      MetaElements: [],
      devtoolsLogs: {
        defaultPass: networkRecordsToDevtoolsLog([
          {
            url: 'https://example.com',
            responseHeaders: [
              {
                name: 'Content-Security-Policy',
                value: ``,
              },
              {
                name: 'Content-Security-Policy',
                value: `object-src 'none'`,
              },
            ],
          },
        ]),
      },
    };
    const {cspHeaders, cspMetaTags}
      = await CspXss.getRawCsps(artifacts, {computedCache: new Map()});
    expect(cspHeaders).toEqual([
      `object-src 'none'`,
    ]);
    expect(cspMetaTags).toEqual([]);
  });

  it('ignore if only whitespace', async () => {
    const artifacts = {
      URL: 'https://example.com',
      MetaElements: [],
      devtoolsLogs: {
        defaultPass: networkRecordsToDevtoolsLog([
          {
            url: 'https://example.com',
            responseHeaders: [
              {
                name: 'Content-Security-Policy',
                value: '   \t',
              },
              {
                name: 'Content-Security-Policy',
                value: `object-src 'none'`,
              },
            ],
          },
        ]),
      },
    };
    const {cspHeaders, cspMetaTags}
      = await CspXss.getRawCsps(artifacts, {computedCache: new Map()});
    expect(cspHeaders).toEqual([
      `object-src 'none'`,
    ]);
    expect(cspMetaTags).toEqual([]);
  });
});

describe('constructResults', () => {
  it('converts findings to table items', () => {
    const {score, results} = CspXss.constructResults([`script-src 'none'; foo-bar 'none'`], []);
    expect(score).toEqual(0);
    expect(results).toMatchObject([
      {
        severity: SEVERITY.syntax,
        description: {
          value: 'script-src \'none\'; foo-bar \'none\'',
        },
        subItems: {
          type: 'subitems',
          items: [
            {
              description: {
                formattedDefault: 'Unknown CSP directive.',
              },
              directive: 'foo-bar',
            },
          ],
        },
      },
      STATIC_RESULTS.noObjectSrc,
      STATIC_RESULTS.noReportingDestination,
    ]);
  });

  it('passes with no findings', () => {
    const {score, results} = CspXss.constructResults([
      `script-src 'none'; object-src 'none'; report-uri https://example.com`,
    ], []);
    expect(score).toEqual(1);
    expect(results).toEqual([]);
  });

  it('adds item for CSP in meta tag', () => {
    const {score, results} = CspXss.constructResults([], [
      `script-src 'none'; object-src 'none'; report-uri https://example.com`,
    ]);
    expect(score).toEqual(1);
    expect(results).toMatchObject([STATIC_RESULTS.metaTag]);
  });

  it('single item for no CSP', () => {
    const {score, results} = CspXss.constructResults([], []);
    expect(score).toEqual(0);
    expect(results).toMatchObject([
      {
        severity: SEVERITY.high,
        description: {
          formattedDefault: 'No CSP found in enforcement mode',
        },
        directive: undefined,
      },
    ]);
  });
});

describe('constructSyntaxResults', () => {
  it('single syntax error', () => {
    const rawCsps = [`foo-bar 'none'`];
    const syntaxFindings = [
      [{type: Type.UNKNOWN_DIRECTIVE, directive: 'foo-bar'}],
    ];
    const results = CspXss.constructSyntaxResults(syntaxFindings, rawCsps);
    expect(results).toMatchObject([
      {
        severity: SEVERITY.syntax,
        description: {
          value: 'foo-bar \'none\'',
        },
        subItems: {
          type: 'subitems',
          items: [
            {
              description: {
                formattedDefault: 'Unknown CSP directive.',
              },
              directive: 'foo-bar',
            },
          ],
        },
      },
    ]);
  });

  it('no syntax errors', () => {
    const rawCsps = [
      `script-src 'none'`,
      `object-src 'none'`,
    ];
    const syntaxFindings = [[]];
    const results = CspXss.constructSyntaxResults(syntaxFindings, rawCsps);
    expect(results).toEqual([]);
  });

  it('multiple syntax errors', () => {
    const rawCsps = [`foo-bar 'asdf'`];
    const syntaxFindings = [
      [
        {type: Type.UNKNOWN_DIRECTIVE, directive: 'foo-bar'},
        {type: Type.INVALID_KEYWORD, directive: 'foo-bar', value: '\'asdf\''},
      ],
    ];
    const results = CspXss.constructSyntaxResults(syntaxFindings, rawCsps);
    expect(results).toMatchObject([
      {
        severity: SEVERITY.syntax,
        description: {
          value: 'foo-bar \'asdf\'',
        },
        subItems: {
          type: 'subitems',
          items: [
            {
              description: {
                formattedDefault: 'Unknown CSP directive.',
              },
              directive: 'foo-bar',
            },
            {
              description: {
                formattedDefault: '\'asdf\' seems to be an invalid keyword.',
              },
              directive: 'foo-bar',
            },
          ],
        },
      },
    ]);
  });

  it('multiple CSPs', () => {
    const rawCsps = [`foo-bar 'none'`, `object-src 'asdf'`];
    const syntaxFindings = [
      [
        {type: Type.UNKNOWN_DIRECTIVE, directive: 'foo-bar'},
      ],
      [
        {type: Type.INVALID_KEYWORD, directive: 'object-src', value: '\'asdf\''},
      ],
    ];
    const results = CspXss.constructSyntaxResults(syntaxFindings, rawCsps);
    expect(results).toMatchObject([
      {
        severity: SEVERITY.syntax,
        description: {
          value: 'foo-bar \'none\'',
        },
        subItems: {
          type: 'subitems',
          items: [
            {
              description: {
                formattedDefault: 'Unknown CSP directive.',
              },
              directive: 'foo-bar',
            },
          ],
        },
      },
      {
        severity: SEVERITY.syntax,
        description: {
          value: 'object-src \'asdf\'',
        },
        subItems: {
          type: 'subitems',
          items: [
            {
              description: {
                formattedDefault: '\'asdf\' seems to be an invalid keyword.',
              },
              directive: 'object-src',
            },
          ],
        },
      },
    ]);
  });
});
