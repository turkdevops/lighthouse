import _TreemapUtil = require('../app/src/util.js');
import _DragAndDrop = require('../../lighthouse-viewer/app/src/drag-and-drop.js');
import _FirebaseAuth = require('../../lighthouse-viewer/app/src/firebase-auth.js');
import _GithubApi = require('../../lighthouse-viewer/app/src/github-api.js');
import {TextEncoding as _TextEncoding} from '../../report/renderer/text-encoding.js';
import {Logger as _Logger} from '../../report/renderer/logger.js';
import {I18n as _I18n} from '../../report/renderer/i18n.js';
import {getFilenamePrefix as _getFilenamePrefix} from '../../report/renderer/file-namer.js';
import {FirebaseNamespace} from '@firebase/app-types';

declare global {
  class WebTreeMap {
    constructor(data: any, options: WebTreeMapOptions);
    render(el: HTMLElement): void;
    layout(data: any, el: HTMLElement): void;
    zoom(address: number[]): void
  }

  interface WebTreeMapOptions {
    padding: [number, number, number, number];
    spacing: number;
    caption(node: LH.Treemap.Node): string;
    showNode?(node: LH.Treemap.Node): boolean;
  }

  interface RenderState {
    root: LH.Treemap.Node;
    viewMode: LH.Treemap.ViewMode;
  }

  interface NodeWithElement extends LH.Treemap.Node {
    /** webtreemap adds dom to node data. */
    dom?: HTMLElement;
  }

  var webtreemap: {
    TreeMap: typeof WebTreeMap;
    render(el: HTMLElement, data: any, options: WebTreeMapOptions): void;
    sort(data: any): void;
  };
  var TreemapUtil: typeof _TreemapUtil;
  var TextEncoding: typeof _TextEncoding;
  var Logger: typeof _Logger;
  var DragAndDrop: typeof _DragAndDrop;
  var GithubApi: typeof _GithubApi;
  var FirebaseAuth: typeof _FirebaseAuth;
  var firebase: Required<FirebaseNamespace>;
  var idbKeyval: typeof import('idb-keyval');
  var strings: Record<LH.Locale, import('../../lighthouse-core/lib/i18n/locales').LhlMessages>;
  var getFilenamePrefix: typeof _getFilenamePrefix;
  var I18n: typeof _I18n;

  interface Window {
    logger: _Logger;
    __treemapOptions?: LH.Treemap.Options;
  }

  interface AddEventListenerOptions {
    signal?: AbortSignal;
  }
}

export {};
