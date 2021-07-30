/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/** @fileoverview Expected Lighthouse audit values for various sites with stable(ish) PWA results. */

/**
 * @type {Smokehouse.ExpectedRunnerResult}
 * Expected Lighthouse results a site with mixed-content issues.
 */
const mixedContent = {
  artifacts: {
    InspectorIssues: {
      mixedContent: [
        {
          _minChromiumMilestone: 88, // We went from Warning to AutoUpgrade in https://chromium-review.googlesource.com/c/chromium/src/+/2480817
          resourceType: 'Image',
          resolutionStatus: 'MixedContentAutomaticallyUpgraded',
          insecureURL: 'http://www.mixedcontentexamples.com/Content/Test/steveholt.jpg',
          mainResourceURL: 'https://www.mixedcontentexamples.com/Test/NonSecureImage',
          request: {
            url: 'http://www.mixedcontentexamples.com/Content/Test/steveholt.jpg',
          },
        },
      ],
    },
  },
  lhr: {
    requestedUrl: 'https://www.mixedcontentexamples.com/Test/NonSecureImage',
    finalUrl: 'https://www.mixedcontentexamples.com/Test/NonSecureImage',
    audits: {
      'is-on-https': {
        score: 0,
      },
    },
  },
};

module.exports = mixedContent;
