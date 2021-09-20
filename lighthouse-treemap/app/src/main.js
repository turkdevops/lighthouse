/**
 * @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env browser */

/* globals webtreemap strings Tabulator Cell Row */

import {TreemapUtil} from './util.js';
import {DragAndDrop} from '../../../lighthouse-viewer/app/src/drag-and-drop.js';
import {GithubApi} from '../../../lighthouse-viewer/app/src/github-api.js';
import {I18n} from '../../../report/renderer/i18n.js';
import {TextEncoding} from '../../../report/renderer/text-encoding.js';
import {Logger} from '../../../report/renderer/logger.js';

const DUPLICATED_MODULES_IGNORE_THRESHOLD = 1024;
const DUPLICATED_MODULES_IGNORE_ROOT_RATIO = 0.01;

const logEl = document.querySelector('#lh-log');
if (!logEl) {
  throw new Error('logger element not found');
}
const logger = new Logger(logEl);

/** @type {TreemapViewer} */
let treemapViewer;

// Make scrolling in Tabulator more performant.
// @ts-expect-error
Cell.prototype.clearHeight = () => {};
// @ts-expect-error
Row.prototype.calcHeight = function() {
  this.height = 24;
  this.outerHeight = 24;
  this.heightStyled = '24px';
};

class TreemapViewer {
  /**
   * @param {LH.Treemap.Options} options
   * @param {HTMLElement} el
   */
  constructor(options, el) {
    this.abortController = new AbortController();

    const scriptTreemapData = options.lhr.audits['script-treemap-data'].details;
    if (!scriptTreemapData || scriptTreemapData.type !== 'treemap-data') {
      throw new Error('missing script-treemap-data');
    }

    /** @type {{[group: string]: LH.Treemap.Node[]}} */
    this.depthOneNodesByGroup = {
      scripts: scriptTreemapData.nodes,
    };

    /**
     * Used to associate every node with a particular depth one node,
     * so that all nodes from the same depth one node can be colored
     * the same.
     * @type {WeakMap<LH.Treemap.Node, LH.Treemap.Node>}
     */
    this.nodeToDepthOneNodeMap = new WeakMap();
    for (const depthOneNodes of Object.values(this.depthOneNodesByGroup)) {
      for (const depthOneNode of depthOneNodes) {
        TreemapUtil.walk(depthOneNode, node => this.nodeToDepthOneNodeMap.set(node, depthOneNode));
      }
    }

    /** @type {WeakMap<LH.Treemap.Node, LH.Treemap.NodePath>} */
    this.nodeToPathMap = new WeakMap();

    this.documentUrl = new URL(options.lhr.requestedUrl);
    this.el = el;
    this.getHueForD1NodeName = TreemapUtil.stableHasher(TreemapUtil.COLOR_HUES);

    // These depth one node uses the network URL for the name, but we want
    // to elide common parts of the URL so text fits better in the UI.
    for (const node of this.depthOneNodesByGroup.scripts) {
      try {
        const url = new URL(node.name);
        node.name = TreemapUtil.elideSameOrigin(url, this.documentUrl);
        if (url.href === this.documentUrl.href) {
          node.name += ' (inline)';
        }
      } catch {}
    }

    /* eslint-disable no-unused-expressions */
    /** @type {LH.Treemap.Node} */
    this.currentTreemapRoot;
    /** @type {LH.Treemap.ViewMode} */
    this.currentViewMode;
    /** @type {LH.Treemap.Selector} */
    this.selector;
    /** @type {LH.Treemap.ViewMode[]} */
    this.viewModes;
    /** @type {RenderState=} */
    this.previousRenderState;
    /** @type {WeakMap<HTMLElement, NodeWithElement>} */
    this.tableRowToNodeMap = new WeakMap();
    /** @type {WebTreeMap} */
    this.treemap;
    /*  eslint-enable no-unused-expressions */

    this.createHeader();
    this.toggleTable(window.innerWidth >= 600);
    this.initListeners();
    this.setSelector({type: 'group', value: 'scripts'});
    this.render();
  }

  createHeader() {
    const urlEl = TreemapUtil.find('a.lh-header--url');
    urlEl.textContent = this.documentUrl.toString();
    urlEl.href = this.documentUrl.toString();

    this.createBundleSelector();
  }

  createBundleSelector() {
    const bundleSelectorEl = TreemapUtil.find('select.bundle-selector');
    bundleSelectorEl.innerHTML = ''; // Clear just in case document was saved with Ctrl+S.

    /** @type {LH.Treemap.Selector[]} */
    const selectors = [];

    /**
     * @param {LH.Treemap.Selector} selector
     * @param {string} text
     */
    function makeOption(selector, text) {
      const optionEl = TreemapUtil.createChildOf(bundleSelectorEl, 'option');
      optionEl.value = String(selectors.length);
      selectors.push(selector);
      optionEl.textContent = text;
    }

    for (const [group, depthOneNodes] of Object.entries(this.depthOneNodesByGroup)) {
      const allLabel = {
        scripts: TreemapUtil.i18n.strings.allScriptsDropdownLabel,
      }[group] || `All ${group}`;
      makeOption({type: 'group', value: group}, allLabel);
      for (const depthOneNode of depthOneNodes) {
        // Only add bundles.
        if (!depthOneNode.children) continue;

        makeOption({type: 'depthOneNode', value: depthOneNode.name}, depthOneNode.name);
      }
    }

    const currentSelectorIndex = selectors.findIndex(s => {
      return this.selector &&
        s.type === this.selector.type &&
        s.value === this.selector.value;
    });
    bundleSelectorEl.value = String(currentSelectorIndex !== -1 ? currentSelectorIndex : 0);
    bundleSelectorEl.addEventListener('change', () => {
      const index = Number(bundleSelectorEl.value);
      const selector = selectors[index];
      this.setSelector(selector);
      this.render();
    });
  }

  initListeners() {
    const options = {signal: this.abortController.signal};
    const treemapEl = TreemapUtil.find('.lh-treemap');

    const resizeObserver = new ResizeObserver(() => this.resize());
    resizeObserver.observe(treemapEl);

    treemapEl.addEventListener('click', (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      const nodeEl = e.target.closest('.webtreemap-node');
      if (!nodeEl) return;

      this.updateColors();
    }, options);

    treemapEl.addEventListener('keyup', (e) => {
      if (!(e instanceof KeyboardEvent)) return;

      if (e.key === 'Enter') this.updateColors();

      if (e.key === 'Escape' && this.treemap) {
        this.treemap.zoom([]); // zoom out to root
      }
    }, options);

    treemapEl.addEventListener('mouseover', (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      const nodeEl = e.target.closest('.webtreemap-node');
      if (!nodeEl) return;

      nodeEl.classList.add('webtreemap-node--hover');
    }, options);

    treemapEl.addEventListener('mouseout', (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      const nodeEl = e.target.closest('.webtreemap-node');
      if (!nodeEl) return;

      nodeEl.classList.remove('webtreemap-node--hover');
    }, options);

    TreemapUtil.find('.lh-table').addEventListener('mouseover', e => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      const el = target.closest('.tabulator-row');
      if (!(el instanceof HTMLElement)) return;

      const node = this.tableRowToNodeMap.get(el);
      if (!node || !node.dom) return;

      node.dom.classList.add('webtreemap-node--hover');
      el.addEventListener('mouseout', () => {
        for (const hoverEl of treemapEl.querySelectorAll('.webtreemap-node--hover')) {
          hoverEl.classList.remove('webtreemap-node--hover');
        }
      }, {once: true});
    }, options);

    const toggleTableBtn = TreemapUtil.find('.lh-button--toggle-table');
    toggleTableBtn.addEventListener('click', () => treemapViewer.toggleTable(), options);
  }

  /**
   * @param {LH.Treemap.Node[]} nodes
   * @return {LH.Treemap.Node}
   */
  wrapNodesInNewRootNode(nodes) {
    const children = [...nodes];
    return {
      name: this.documentUrl.toString(),
      resourceBytes: children.reduce((acc, cur) => cur.resourceBytes + acc, 0),
      unusedBytes: children.reduce((acc, cur) => (cur.unusedBytes || 0) + acc, 0),
      children,
    };
  }

  createViewModes() {
    /**
     * @param {LH.Treemap.Node} root
     * @return {LH.Treemap.ViewMode|undefined}
     */
    function createUnusedBytesViewMode(root) {
      if (root.unusedBytes === undefined) return;

      return {
        id: 'unused-bytes',
        label: TreemapUtil.i18n.strings.unusedBytesLabel,
        subLabel: TreemapUtil.i18n.formatBytesWithBestUnit(root.unusedBytes),
        enabled: true,
      };
    }

    /**
     * @param {LH.Treemap.Node} root
     * @return {LH.Treemap.ViewMode|undefined}
     */
    const createDuplicateModulesViewMode = (root) => {
      /** @type {Map<string, Array<{node: LH.Treemap.Node, path: LH.Treemap.NodePath}>>} */
      const moduleNameToNodes = new Map();
      for (const d1Node of root.children || []) {
        TreemapUtil.walk(d1Node, (node, path) => {
          if (node.children) return;
          if (!node.duplicatedNormalizedModuleName) return;

          const nodes = moduleNameToNodes.get(node.duplicatedNormalizedModuleName) || [];
          nodes.push({node, path});
          moduleNameToNodes.set(node.duplicatedNormalizedModuleName, nodes);
        });
      }

      const getHueForModuleNodeName = TreemapUtil.stableHasher(TreemapUtil.COLOR_HUES);
      let potentialByteSavings = 0;

      /** @type {LH.Treemap.Highlight[]} */
      const highlights = [];
      for (const [moduleName, nodesWithSameModuleName] of moduleNameToNodes.entries()) {
        if (nodesWithSameModuleName.length === 1) continue;

        const bytes = [];
        for (const {node} of nodesWithSameModuleName) {
          bytes.push(node.resourceBytes);
        }

        // Sum all but the largest copy.
        bytes.sort((a, b) => b - a);
        let duplicatedBytes = 0;
        for (let i = 1; i < bytes.length; i++) duplicatedBytes += bytes[i];
        if (duplicatedBytes < DUPLICATED_MODULES_IGNORE_THRESHOLD) continue;

        for (const {path} of nodesWithSameModuleName) {
          highlights.push({
            path: [root.name, ...path],
            color: this.getColorFromHue(getHueForModuleNodeName(moduleName)),
          });
        }
        potentialByteSavings += duplicatedBytes;
      }

      let enabled = true;
      if (highlights.length === 0) enabled = false;
      if (potentialByteSavings / root.resourceBytes < DUPLICATED_MODULES_IGNORE_ROOT_RATIO) {
        enabled = false;
      }

      return {
        id: 'duplicate-modules',
        label: TreemapUtil.i18n.strings.duplicateModulesLabel,
        subLabel: enabled ? TreemapUtil.i18n.formatBytesWithBestUnit(potentialByteSavings) : 'N/A',
        highlights,
        enabled,
      };
    };

    /** @type {LH.Treemap.ViewMode[]} */
    const viewModes = [];

    viewModes.push({
      id: 'all',
      label: TreemapUtil.i18n.strings.allLabel,
      subLabel: TreemapUtil.i18n.formatBytesWithBestUnit(this.currentTreemapRoot.resourceBytes),
      enabled: true,
    });

    const unusedBytesViewMode = createUnusedBytesViewMode(this.currentTreemapRoot);
    if (unusedBytesViewMode) viewModes.push(unusedBytesViewMode);

    const duplicateModulesViewMode = createDuplicateModulesViewMode(this.currentTreemapRoot);
    if (duplicateModulesViewMode) viewModes.push(duplicateModulesViewMode);

    return viewModes;
  }

  /**
   * @param {LH.Treemap.Selector} selector
   */
  setSelector(selector) {
    this.selector = selector;

    if (selector.type === 'group') {
      this.currentTreemapRoot =
        this.wrapNodesInNewRootNode(this.depthOneNodesByGroup[selector.value]);
    } else if (selector.type === 'depthOneNode') {
      let node;
      outer: for (const depthOneNodes of Object.values(this.depthOneNodesByGroup)) {
        for (const depthOneNode of depthOneNodes) {
          if (depthOneNode.name === selector.value) {
            node = depthOneNode;
            break outer;
          }
        }
      }

      if (!node) {
        throw new Error('unknown depthOneNode: ' + selector.value);
      }

      this.currentTreemapRoot = node;
    } else {
      throw new Error('unknown selector: ' + JSON.stringify(selector));
    }

    this.viewModes = this.createViewModes();
    const currentViewModeIsDisabled = this.currentViewMode &&
      this.viewModes.find(v => v.id === this.currentViewMode.id && !v.enabled);
    if (!this.currentViewMode || currentViewModeIsDisabled) {
      this.currentViewMode = this.viewModes[0];
    }
  }

  /**
   * @param {LH.Treemap.ViewMode} viewMode
   */
  setViewMode(viewMode) {
    this.currentViewMode = viewMode;
  }

  render() {
    const rootChanged =
      !this.previousRenderState || this.previousRenderState.root !== this.currentTreemapRoot;
    const viewChanged =
      !this.previousRenderState || this.previousRenderState.viewMode !== this.currentViewMode;

    if (rootChanged) {
      this.nodeToPathMap = new Map();
      TreemapUtil.walk(this.currentTreemapRoot, (node, path) => this.nodeToPathMap.set(node, path));
      renderViewModeButtons(this.viewModes);

      TreemapUtil.walk(this.currentTreemapRoot, node => {
        // webtreemap will store `dom` on the data to speed up operations.
        // However, when we change the underlying data representation, we need to delete
        // all the cached DOM elements. Otherwise, the rendering will be incorrect when,
        // for example, switching between "All JavaScript" and a specific bundle.
        delete node.dom;

        // @ts-ignore: webtreemap uses `size` to partition the treemap.
        node.size = node[this.currentViewMode.partitionBy || 'resourceBytes'] || 0;
      });
      webtreemap.sort(this.currentTreemapRoot);

      this.treemap = new webtreemap.TreeMap(this.currentTreemapRoot, {
        padding: [16, 3, 3, 3],
        spacing: 10,
        caption: node => this.makeCaption(node),
      });
      this.el.innerHTML = '';
      this.treemap.render(this.el);
      TreemapUtil.find('.webtreemap-node').classList.add('webtreemap-node--root');

      this.createTable();
    }

    if (rootChanged || viewChanged) {
      this.updateColors();
      applyActiveClass(this.currentViewMode.id, this.el);
    }

    this.previousRenderState = {
      root: this.currentTreemapRoot,
      viewMode: this.currentViewMode,
    };
  }

  createTable() {
    const tableEl = TreemapUtil.find('.lh-table');
    tableEl.innerHTML = '';

    /** @type {Array<{node: NodeWithElement, name: string, bundleNode?: LH.Treemap.Node, resourceBytes: number, unusedBytes?: number}>} */
    const data = [];
    TreemapUtil.walk(this.currentTreemapRoot, (node, path) => {
      if (node.children) return;

      const depthOneNode = this.nodeToDepthOneNodeMap.get(node);
      const bundleNode = depthOneNode && depthOneNode.children ? depthOneNode : undefined;

      let name;
      if (bundleNode) {
        const bundleNodePath = this.nodeToPathMap.get(bundleNode);
        const amountToTrim = bundleNodePath ? bundleNodePath.length : 0; // should never be 0.
        name = `(bundle) ${path.slice(amountToTrim).join('/')}`;
      } else {
        // Elide the first path component, which is common to all nodes.
        if (path[0] === this.currentTreemapRoot.name) {
          name = path.slice(1).join('/');
        } else {
          name = path.join('/');
        }
      }

      data.push({
        node,
        name,
        bundleNode,
        resourceBytes: node.resourceBytes,
        unusedBytes: node.unusedBytes,
      });
    });

    /** @param {'resourceBytes'|'unusedBytes'} field */
    const makeBytesTooltip = (field) => {
      /** @param {Tabulator.CellComponent} cell */
      const fn = (cell) => {
        /** @type {typeof data[number]} */
        const dataRow = cell.getRow().getData();
        const value = dataRow[field];
        if (value === undefined) return '';

        return TreemapUtil.i18n.formatBytes(value);
      };
      return fn;
    };

    /** @param {Tabulator.CellComponent} cell */
    const makeNameTooltip = (cell) => {
      /** @type {typeof data[number]} */
      const dataRow = cell.getRow().getData();
      if (!dataRow.bundleNode) return '';

      return `${dataRow.bundleNode.name} ${dataRow.name}`;
    };

    /** @param {Tabulator.CellComponent} cell */
    const makeCoverageTooltip = (cell) => {
      /** @type {typeof data[number]} */
      const dataRow = cell.getRow().getData();
      if (!dataRow.unusedBytes) return '';

      const percent = dataRow.unusedBytes / dataRow.resourceBytes;
      return `${TreemapUtil.i18n.formatPercent(percent)} bytes unused`;
    };

    const gridEl = document.createElement('div');
    tableEl.append(gridEl);

    const children = this.currentTreemapRoot.children || [];
    const maxSize = Math.max(...children.map(node => node.resourceBytes));

    this.tableRowToNodeMap = new WeakMap();
    this.table = new Tabulator(gridEl, {
      data,
      height: '100%',
      layout: 'fitColumns',
      tooltips: true,
      addRowPos: 'top',
      resizableColumns: true,
      initialSort: [
        {column: 'resourceBytes', dir: 'desc'},
      ],
      columns: [
        // eslint-disable-next-line max-len
        {title: TreemapUtil.i18n.strings.tableColumnName, field: 'name', widthGrow: 5, tooltip: makeNameTooltip},
        // eslint-disable-next-line max-len
        {title: TreemapUtil.i18n.strings.resourceBytesLabel, field: 'resourceBytes', headerSortStartingDir: 'desc', tooltip: makeBytesTooltip('resourceBytes'), formatter: cell => {
          const value = cell.getValue();
          return TreemapUtil.i18n.formatBytesWithBestUnit(value);
        }},
        // eslint-disable-next-line max-len
        {title: TreemapUtil.i18n.strings.unusedBytesLabel, field: 'unusedBytes', widthGrow: 1, sorterParams: {alignEmptyValues: 'bottom'}, headerSortStartingDir: 'desc', tooltip: makeBytesTooltip('unusedBytes'), formatter: cell => {
          const value = cell.getValue();
          if (value === undefined) return '';
          return TreemapUtil.i18n.formatBytesWithBestUnit(value);
        }},
        // eslint-disable-next-line max-len
        {title: TreemapUtil.i18n.strings.coverageColumnName, widthGrow: 3, headerSort: false, tooltip: makeCoverageTooltip, formatter: cell => {
          /** @type {typeof data[number]} */
          const dataRow = cell.getRow().getData();

          const el = TreemapUtil.createElement('div', 'lh-coverage-bar');
          if (dataRow.unusedBytes === undefined) return el;

          el.style.setProperty('--max', String(maxSize));
          el.style.setProperty('--used', String(dataRow.resourceBytes - dataRow.unusedBytes));
          el.style.setProperty('--unused', String(dataRow.unusedBytes));

          TreemapUtil.createChildOf(el, 'div', 'lh-coverage-bar--used');
          TreemapUtil.createChildOf(el, 'div', 'lh-coverage-bar--unused');

          return el;
        }},
      ],
      rowFormatter: (row) => {
        this.tableRowToNodeMap.set(row.getElement(), row.getData().node);
      },
    });
  }

  /**
   * @param {boolean=} show
   */
  toggleTable(show) {
    const mainEl = TreemapUtil.find('main');
    mainEl.classList.toggle('lh-main--show-table', show);
    const buttonEl = TreemapUtil.find('.lh-button--toggle-table');
    buttonEl.classList.toggle('lh-button--active', show);
  }

  resize() {
    if (!this.treemap) throw new Error('must call .render() first');

    this.treemap.layout(this.currentTreemapRoot, this.el);
    this.updateColors();
    if (this.table) this.table.redraw();
  }

  /**
   * Creates the header text for each node in webtreemap.
   * @param {LH.Treemap.Node} node
   */
  makeCaption(node) {
    const partitionBy = this.currentViewMode.partitionBy || 'resourceBytes';
    const partitionByStr = {
      resourceBytes: TreemapUtil.i18n.strings.resourceBytesLabel,
      unusedBytes: TreemapUtil.i18n.strings.unusedBytesLabel,
    }[partitionBy];
    const bytes = node[partitionBy];
    const total = this.currentTreemapRoot[partitionBy];

    const parts = [
      TreemapUtil.elide(node.name || '', 60),
    ];

    if (bytes !== undefined && total !== undefined) {
      const percentStr = TreemapUtil.i18n.formatPercent(bytes / total);
      let str = `${TreemapUtil.i18n.formatBytesWithBestUnit(bytes)} (${percentStr})`;
      // Only add label for bytes on the root node.
      if (node === this.currentTreemapRoot) {
        str = `${partitionByStr}: ${str}`;
      }
      parts.push(str);
    }

    return parts.join(' · ');
  }

  /**
   * @param {number} hue
   */
  getColorFromHue(hue) {
    return TreemapUtil.hsl(hue, 60, 90);
  }

  updateColors() {
    TreemapUtil.walk(this.currentTreemapRoot, node => {
      // Color a depth one node and all children the same color.
      const depthOneNode = this.nodeToDepthOneNodeMap.get(node);
      const hue = depthOneNode &&
        this.getHueForD1NodeName(depthOneNode ? depthOneNode.name : node.name);
      const depthOneNodeColor = hue !== undefined ? this.getColorFromHue(hue) : 'white';

      if (!node.dom) return;

      let backgroundColor;
      if (this.currentViewMode.highlights) {
        // A view can set nodes to highlight. If so, don't color anything else.
        const path = this.nodeToPathMap.get(node);
        const highlight = path && this.currentViewMode.highlights
          .find(highlight => TreemapUtil.pathsAreEqual(path, highlight.path));
        if (highlight) {
          backgroundColor = highlight.color || depthOneNodeColor;
        } else {
          backgroundColor = 'white';
        }
        node.dom.style.backgroundColor = backgroundColor;
        return;
      }

      node.dom.style.backgroundColor = depthOneNodeColor;

      // Shade the element to communicate coverage.
      if (this.currentViewMode.id === 'unused-bytes') {
        const pctUnused = (node.unusedBytes || 0) / node.resourceBytes * 100;
        node.dom.style.setProperty('--pctUnused', `${pctUnused}%`);
      }
    });
  }
}

/**
 * @param {LH.Treemap.ViewMode[]} viewModes
 */
function renderViewModeButtons(viewModes) {
  /**
   * @param {LH.Treemap.ViewMode} viewMode
   */
  function render(viewMode) {
    const viewModeEl = TreemapUtil.createChildOf(viewModesEl, 'div', 'view-mode');
    if (!viewMode.enabled) viewModeEl.classList.add('view-mode--disabled');
    viewModeEl.id = `view-mode--${viewMode.id}`;

    const inputEl = TreemapUtil.createChildOf(viewModeEl, 'input', 'view-mode__button');
    inputEl.id = `view-mode--${viewMode.id}__label`;
    inputEl.type = 'radio';
    inputEl.name = 'view-mode';
    inputEl.disabled = !viewMode.enabled;

    const labelEl = TreemapUtil.createChildOf(viewModeEl, 'label');
    labelEl.htmlFor = inputEl.id;
    TreemapUtil.createChildOf(labelEl, 'span', 'view-mode__label').textContent = viewMode.label;
    TreemapUtil.createChildOf(labelEl, 'span', 'view-mode__sublabel lh-text-dim').textContent =
      ` (${viewMode.subLabel})`;

    inputEl.addEventListener('click', () => {
      treemapViewer.setViewMode(viewMode);
      treemapViewer.render();
    });
  }

  const viewModesEl = TreemapUtil.find('.lh-modes');
  viewModesEl.innerHTML = '';
  viewModes.forEach(render);
}

/**
 * @param {string} currentViewModeId
 * @param {HTMLElement} el
 */
function applyActiveClass(currentViewModeId, el) {
  const viewModesEl = TreemapUtil.find('.lh-modes');
  for (const viewModeEl of viewModesEl.querySelectorAll('.view-mode')) {
    if (!(viewModeEl instanceof HTMLElement)) continue;

    const isMatch = viewModeEl.id === `view-mode--${currentViewModeId}`;
    viewModeEl.classList.toggle('view-mode--active', isMatch);
    el.classList.toggle(`lh-treemap--${viewModeEl.id}`, isMatch);
  }
}

/**
 * Allows for saving the document and loading with data intact.
 * @param {LH.Treemap.Options} options
 */
function injectOptions(options) {
  let scriptEl = document.querySelector('.lh-injectedoptions');
  if (scriptEl) {
    scriptEl.remove();
  }

  scriptEl = TreemapUtil.createChildOf(document.head, 'script', 'lh-injectedoptions');
  scriptEl.textContent = `
    window.__treemapOptions = ${JSON.stringify(options)};
  `;
}

class LighthouseTreemap {
  static get APP_URL() {
    return `${location.origin}${location.pathname}`;
  }

  constructor() {
    this._onPaste = this._onPaste.bind(this);
    this._onFileLoad = this._onFileLoad.bind(this);

    this._dragAndDrop = new DragAndDrop(this._onFileLoad);
    this._github = new GithubApi();

    document.addEventListener('paste', this._onPaste);

    // Hidden file input to trigger manual file selector.
    const fileInput = TreemapUtil.find('input#hidden-file-input', document);
    fileInput.addEventListener('change', e => {
      if (!e.target) {
        return;
      }

      const inputTarget = /** @type {HTMLInputElement} */ (e.target);
      if (inputTarget.files) {
        this._dragAndDrop.readFile(inputTarget.files[0]).then(str => {
          this._onFileLoad(str);
        });
      }
      inputTarget.value = '';
    });

    // A click on the visual placeholder will trigger the hidden file input.
    const placeholderTarget = TreemapUtil.find('.treemap-placeholder-inner', document);
    placeholderTarget.addEventListener('click', e => {
      const target = /** @type {?Element} */ (e.target);

      if (target && target.localName !== 'input' && target.localName !== 'a') {
        fileInput.click();
      }
    });
  }

  /**
   * @param {LH.Treemap.Options} options
   */
  init(options) {
    TreemapUtil.find('.treemap-placeholder').classList.add('hidden');
    TreemapUtil.find('main').classList.remove('hidden');

    const i18n = new I18n(options.lhr.configSettings.locale, {
      // Set missing renderer strings to default (english) values.
      ...TreemapUtil.UIStrings,
      // `strings` is generated in build/build-treemap.js
      ...strings[options.lhr.configSettings.locale],
    });
    TreemapUtil.i18n = i18n;

    // Fill in all i18n data.
    for (const node of document.querySelectorAll('[data-i18n]')) {
      // These strings are guaranteed to (at least) have a default English string in TreemapUtil.UIStrings,
      // so this cannot be undefined as long as `report-ui-features.data-i18n` test passes.
      const i18nAttr = /** @type {keyof typeof TreemapUtil['UIStrings']} */ (
        node.getAttribute('data-i18n'));
      node.textContent = TreemapUtil.i18n.strings[i18nAttr];
    }

    if (treemapViewer) {
      TreemapUtil.find('.lh-treemap').innerHTML = '';
      TreemapUtil.find('.lh-table').innerHTML = '';
      treemapViewer.abortController.abort();
    }
    treemapViewer = new TreemapViewer(options, TreemapUtil.find('div.lh-treemap'));

    injectOptions(options);

    // eslint-disable-next-line no-console
    console.log('window.__treemapOptions', window.__treemapOptions);
  }

  /**
   * @param {any} json
   * @return {LH.Treemap.Options}
   */
  convertToOptions(json) {
    if (json && typeof json === 'object') {
      if (json.audits) json = {lhr: json};
      if (json.lhr && json.lhr.audits && typeof json.lhr.audits === 'object') return json;
    }

    throw new Error('unknown json');
  }

  /**
   * Loads report json from gist URL, if valid. Updates page URL with gist id
   * and loads from GitHub.
   * @param {string} urlStr gist URL
   */
  async loadFromGistUrl(urlStr) {
    try {
      const url = new URL(urlStr);

      if (url.origin !== 'https://gist.github.com') {
        logger.error('URL was not a gist');
        return;
      }

      const match = url.pathname.match(/[a-f0-9]{5,}/);
      if (match) {
        const gistId = match[0];
        history.pushState({}, '', `${LighthouseTreemap.APP_URL}?gist=${gistId}`);
        const json = await this._github.getGistFileContentAsJson(gistId);
        const options = this.convertToOptions(json);
        this.init(options);
      }
    } catch (err) {
      logger.error(err);
    }
  }

  /**
   * @param {string} str
   */
  _onFileLoad(str) {
    let json;
    let options;
    try {
      json = JSON.parse(str);
      options = this.convertToOptions(json);
    } catch (e) {
      logger.error('Could not parse JSON file.');
    }

    if (options) this.init(options);
  }

  /**
   * Enables pasting a JSON report or gist URL on the page.
   * @param {ClipboardEvent} e
   */
  _onPaste(e) {
    if (!e.clipboardData) return;
    e.preventDefault();

    // Try paste as gist URL.
    try {
      const url = new URL(e.clipboardData.getData('text'));
      this.loadFromGistUrl(url.href);

      if (window.ga) {
        window.ga('send', 'event', 'report', 'paste-link');
      }

      return;
    } catch (err) {
      // noop
    }

    // Try paste as json content.
    try {
      const json = JSON.parse(e.clipboardData.getData('text'));
      const options = this.convertToOptions(json);
      this.init(options);

      if (window.ga) {
        window.ga('send', 'event', 'report', 'paste');
      }

      return;
    } catch (err) {
      // noop
    }

    logger.error('Pasted content did not have JSON or gist URL');
  }
}

async function main() {
  const app = new LighthouseTreemap();
  const queryParams = new URLSearchParams(window.location.search);
  const gzip = queryParams.get('gzip') === '1';
  const hashParams = location.hash ?
    JSON.parse(TextEncoding.fromBase64(location.hash.substr(1), {gzip})) :
    {};
  /** @type {Record<string, any>} */
  const params = {
    ...Object.fromEntries(queryParams.entries()),
    ...hashParams,
  };

  if (window.__treemapOptions) {
    // Prefer the hardcoded options from a saved HTML file above all.
    app.init(window.__treemapOptions);
  } else if ('debug' in params) {
    const response = await fetch('debug.json');
    app.init(await response.json());
  } else if (params.lhr) {
    const options = {
      lhr: params.lhr,
    };
    app.init(options);
  } else if (params.gist) {
    let json;
    let options;
    try {
      json = await app._github.getGistFileContentAsJson(params.gist || '');
      options = app.convertToOptions(json);
    } catch (err) {
      logger.log(err);
    }
    if (options) app.init(options);
  } else {
    // TODO: remove for v8.
    window.addEventListener('message', e => {
      if (e.source !== self.opener) return;

      /** @type {LH.Treemap.Options} */
      const options = e.data;
      const {lhr} = options;
      if (!lhr) return logger.error('Error: Invalid options');

      const documentUrl = lhr.requestedUrl;
      if (!documentUrl) return logger.error('Error: Invalid options');

      app.init(options);
    });
  }

  // TODO: remove for v8.
  // If the page was opened as a popup, tell the opening window we're ready.
  if (self.opener && !self.opener.closed) {
    self.opener.postMessage({opened: true}, '*');
  }
}

document.addEventListener('DOMContentLoaded', main);
