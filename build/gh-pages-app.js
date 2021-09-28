/**
 * @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const rollup = require('rollup');
const rollupPlugins = require('./rollup-plugins.js');
const cpy = require('cpy');
const ghPages = require('gh-pages');
const glob = require('glob');
const lighthousePackage = require('../package.json');
const terser = require('terser');
const {LH_ROOT} = require('../root.js');

const ghPagesDistDir = `${LH_ROOT}/dist/gh-pages`;

const license = `/*
* @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
* or implied. See the License for the specific language governing
* permissions and limitations under the License.
*/`;

/**
 * Literal string (representing JS, CSS, etc...), or an object with a path, which would
 * be interpreted relative to opts.appDir and be glob-able.
 * @typedef {{path: string, rollup?: boolean} | string} Source
 */

/**
 * @typedef BuildOptions
 * @property {string} name Name of app, used for hosted path (`googlechrome.github.io/lighthouse/{name}/`) and output directory (`dist/gh-pages/{name}`).
 * @property {string} appDir Path to directory where source lives, used as a base for other paths in options.
 * @property {Source} html
 * @property {Record<string, string>=} htmlReplacements Needle -> Replacement mapping, used on html source.
 * @property {Source[]} stylesheets
 * @property {Source[]} javascripts
 * @property {Array<{path: string}>} assets List of paths to copy. Glob-able, maintains directory structure.
 */

/**
 * Evaluates path glob and loads all identified files as an array of strings.
 * @param {string} pattern
 * @return {string[]}
 */
function loadFiles(pattern) {
  const filePaths = glob.sync(pattern, {nodir: true});
  return filePaths.map(path => fs.readFileSync(path, {encoding: 'utf8'}));
}

/**
 * Write a file to filePath, creating parent directories if needed.
 * @param {string} filePath
 * @param {string} data
 */
function safeWriteFile(filePath, data) {
  const fileDir = path.dirname(filePath);
  fs.mkdirSync(fileDir, {recursive: true});
  fs.writeFileSync(filePath, data);
}

class GhPagesApp {
  /**
   * @param {BuildOptions} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.distDir = `${ghPagesDistDir}/${opts.name}`;
  }

  async build() {
    fs.mkdirSync(this.distDir, {recursive: true}); // Ensure dist is present, else rmdir will throw. COMPAT: when dropping Node 12, replace with fs.rm(p, {force: true})
    fs.rmdirSync(this.distDir, {recursive: true});

    const html = await this._compileHtml();
    safeWriteFile(`${this.distDir}/index.html`, html);

    const css = await this._compileCss();
    safeWriteFile(`${this.distDir}/styles/bundled.css`, css);

    const bundledJs = await this._compileJs();
    safeWriteFile(`${this.distDir}/src/bundled.js`, bundledJs);

    await cpy(this.opts.assets.map(asset => asset.path), this.distDir, {
      cwd: this.opts.appDir,
      parents: true,
    });
  }

  /**
   * @return {Promise<void>}
   */
  deploy() {
    return new Promise((resolve, reject) => {
      ghPages.publish(this.distDir, {
        add: true, // keep existing files
        dest: this.opts.name,
        message: `Update ${this.opts.name} to lighthouse@${lighthousePackage.version}`,
      }, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * @param {Source[]} sources
   * @return {Promise<string[]>}
   */
  async _resolveSourcesList(sources) {
    const result = [];

    for (const source of sources) {
      if (typeof source === 'string') {
        result.push(source);
      } else if (source.rollup) {
        result.push(await this._rollupSource(path.resolve(this.opts.appDir, source.path)));
      } else {
        result.push(...loadFiles(path.resolve(this.opts.appDir, source.path)));
      }
    }

    return result;
  }

  /**
   * @param {string} input
   * @return {Promise<string>}
   */
  async _rollupSource(input) {
    const plugins = [
      rollupPlugins.nodeResolve(),
      rollupPlugins.commonjs(),
    ];
    if (!process.env.DEBUG) plugins.push(rollupPlugins.terser());
    const bundle = await rollup.rollup({
      input,
      plugins,
    });
    const {output} = await bundle.generate({format: 'iife'});
    return output[0].code;
  }

  async _compileHtml() {
    const resolvedSources = await this._resolveSourcesList([this.opts.html]);
    let htmlSrc = resolvedSources[0];

    if (this.opts.htmlReplacements) {
      for (const [key, value] of Object.entries(this.opts.htmlReplacements)) {
        htmlSrc = htmlSrc.replace(key, value);
      }
    }

    return htmlSrc;
  }

  async _compileCss() {
    const resolvedSources = await this._resolveSourcesList(this.opts.stylesheets);
    return resolvedSources.join('\n');
  }

  async _compileJs() {
    // Current Lighthouse version as a global variable.
    const versionJs = `window.LH_CURRENT_VERSION = '${lighthousePackage.version}';`;

    const contents = [
      `"use strict";`,
      versionJs,
      ...await this._resolveSourcesList(this.opts.javascripts),
    ];
    if (process.env.DEBUG) return contents.join('\n');

    const options = {
      output: {preamble: license}, // Insert license at top.
    };
    const uglified = await terser.minify(contents, options);
    if (!uglified.code) {
      throw new Error('terser returned no result');
    }

    return uglified.code;
  }
}

module.exports = GhPagesApp;
