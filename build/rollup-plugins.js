/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/**
 * Rollup plugins don't export types that work with commonjs.
 * @template T
 * @param {T} module
 * @return {T['default']}
 */
function rollupPluginTypeCoerce(module) {
  // @ts-expect-error
  return module;
}

const commonjs = rollupPluginTypeCoerce(require('@rollup/plugin-commonjs'));
const {nodeResolve} = require('@rollup/plugin-node-resolve');
// @ts-expect-error: no published types.
const shim = require('rollup-plugin-shim');
const {terser} = require('rollup-plugin-terser');
const typescript = rollupPluginTypeCoerce(require('@rollup/plugin-typescript'));

module.exports = {
  commonjs,
  nodeResolve,
  shim,
  terser,
  typescript,
};
