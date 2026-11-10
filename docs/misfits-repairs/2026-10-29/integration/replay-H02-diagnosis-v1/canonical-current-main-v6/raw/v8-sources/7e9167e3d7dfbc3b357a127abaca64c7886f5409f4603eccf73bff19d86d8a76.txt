var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var index_exports = {};
__export(index_exports, {
  DOMSelector: () => DOMSelector
});
module.exports = __toCommonJS(index_exports);
var import_lru_cache = require("lru-cache");

// src/js/parser.js
var cssTree2 = __toESM(require("css-tree"), 1);

// src/js/utility.js
var import_nwsapi = __toESM(require("@asamuzakjp/nwsapi"), 1);
var import_bidi_js = __toESM(require("bidi-js"), 1);
var cssTree = __toESM(require("css-tree"), 1);
var import_is_potential_custom_element_name = __toESM(require("is-potential-custom-element-name"), 1);

// src/js/constant.js
var ATTR_SELECTOR = "AttributeSelector";
var CLASS_SELECTOR = "ClassSelector";
var COMBINATOR = "Combinator";
var IDENT = "Identifier";
var ID_SELECTOR = "IdSelector";
var NOT_SUPPORTED_ERR = "NotSupportedError";
var NTH = "Nth";
var PS_CLASS_SELECTOR = "PseudoClassSelector";
var PS_ELEMENT_SELECTOR = "PseudoElementSelector";
var SELECTOR = "Selector";
var STRING = "String";
var SYNTAX_ERR = "SyntaxError";
var TARGET_ALL = "all";
var TARGET_FIRST = "first";
var TARGET_LINEAL = "lineal";
var TARGET_SELF = "self";
var TYPE_SELECTOR = "TypeSelector";
var BIT_01 = 1;
var BIT_02 = 2;
var BIT_04 = 4;
var BIT_08 = 8;
var BIT_16 = 16;
var BIT_32 = 32;
var BIT_FFFF = 65535;
var DUO = 2;
var HEX = 16;
var TYPE_FROM = 8;
var TYPE_TO = -1;
var ELEMENT_NODE = 1;
var TEXT_NODE = 3;
var DOCUMENT_NODE = 9;
var DOCUMENT_FRAGMENT_NODE = 11;
var DOCUMENT_POSITION_PRECEDING = 2;
var DOCUMENT_POSITION_CONTAINS = 8;
var SHOW_ALL = 4294967295;
var SHOW_CONTAINER = 1281;
var ALPHA_NUM = "[A-Z\\d]+";
var CHILD_IDX = "(?:first|last|only)-(?:child|of-type)";
var DIGIT = "(?:0|[1-9]\\d*)";
var LANG_PART = `(?:-${ALPHA_NUM})*`;
var PSEUDO_CLASS = `(?:any-)?link|${CHILD_IDX}|checked|empty|indeterminate|read-(?:only|write)|target`;
var ANB = `[+-]?(?:${DIGIT}n?|n)|(?:[+-]?${DIGIT})?n\\s*[+-]\\s*${DIGIT}`;
var COMBO = "\\s?[\\s>~+]\\s?";
var DESCEND = "\\s?[\\s>]\\s?";
var SIBLING = "\\s?[+~]\\s?";
var LOGIC_IS = `:is\\(\\s*[^)]+\\s*\\)`;
var N_TH = `nth-(?:last-)?(?:child|of-type)\\(\\s*(?:even|odd|${ANB})\\s*\\)`;
var SUB_TYPE = "\\[[^|\\]]+\\]|[#.:][\\w-]+";
var SUB_TYPE_WO_PSEUDO = "\\[[^|\\]]+\\]|[#.][\\w-]+";
var TAG_TYPE = "\\*|[A-Za-z][\\w-]*";
var TAG_TYPE_I = "\\*|[A-Z][\\w-]*";
var COMPOUND = `(?:${TAG_TYPE}|(?:${TAG_TYPE})?(?:${SUB_TYPE})+)`;
var COMPOUND_L = `(?:${TAG_TYPE}|(?:${TAG_TYPE})?(?:${SUB_TYPE}|${LOGIC_IS})+)`;
var COMPOUND_I = `(?:${TAG_TYPE_I}|(?:${TAG_TYPE_I})?(?:${SUB_TYPE})+)`;
var COMPOUND_WO_PSEUDO = `(?:${TAG_TYPE}|(?:${TAG_TYPE})?(?:${SUB_TYPE_WO_PSEUDO})+)`;
var COMPLEX = `${COMPOUND}(?:${COMBO}${COMPOUND})*`;
var COMPLEX_L = `${COMPOUND_L}(?:${COMBO}${COMPOUND_L})*`;
var HAS_COMPOUND = `has\\([\\s>]?\\s*${COMPOUND_WO_PSEUDO}\\s*\\)`;
var LOGIC_COMPOUND = `(?:is|not)\\(\\s*${COMPOUND_L}(?:\\s*,\\s*${COMPOUND_L})*\\s*\\)`;
var LOGIC_COMPLEX = `(?:is|not)\\(\\s*${COMPLEX_L}(?:\\s*,\\s*${COMPLEX_L})*\\s*\\)`;
var FORM_PARTS = Object.freeze([
  "button",
  "input",
  "select",
  "textarea"
]);
var INPUT_BUTTON = Object.freeze(["button", "reset", "submit"]);
var INPUT_CHECK = Object.freeze(["checkbox", "radio"]);
var INPUT_DATE = Object.freeze([
  "date",
  "datetime-local",
  "month",
  "time",
  "week"
]);
var INPUT_TEXT = Object.freeze([
  "email",
  "password",
  "search",
  "tel",
  "text",
  "url"
]);
var INPUT_EDIT = Object.freeze([
  ...INPUT_DATE,
  ...INPUT_TEXT,
  "number"
]);
var INPUT_LTR = Object.freeze([
  ...INPUT_CHECK,
  "color",
  "date",
  "image",
  "number",
  "range",
  "time"
]);
var KEYS_LOGICAL = /* @__PURE__ */ new Set(["has", "is", "not", "where"]);

// src/js/utility.js
var KEYS_DIR_AUTO = /* @__PURE__ */ new Set([...INPUT_BUTTON, ...INPUT_TEXT, "hidden"]);
var KEYS_DIR_LTR = new Set(INPUT_LTR);
var KEYS_INPUT_EDIT = new Set(INPUT_EDIT);
var KEYS_NODE_DIR_EXCLUDE = /* @__PURE__ */ new Set(["bdi", "script", "style", "textarea"]);
var KEYS_NODE_FOCUSABLE = /* @__PURE__ */ new Set(["button", "select", "textarea"]);
var KEYS_NODE_FOCUSABLE_SVG = /* @__PURE__ */ new Set([
  "clipPath",
  "defs",
  "desc",
  "linearGradient",
  "marker",
  "mask",
  "metadata",
  "pattern",
  "radialGradient",
  "script",
  "style",
  "symbol",
  "title"
]);
var REG_EXCLUDE_BASIC = /[|\\]|::|[^\u0021-\u007F\s]|\[\s*[\w$*=^|~-]+(?:(?:"[\w$*=^|~\s'-]+"|'[\w$*=^|~\s"-]+')?(?:\s+[\w$*=^|~-]+)+|"[^"\]]{1,255}|'[^'\]]{1,255})\s*\]|:(?:is|where)\(\s*\)/;
var REG_COMPLEX = new RegExp(`${COMPOUND_I}${COMBO}${COMPOUND_I}`, "i");
var REG_DESCEND = new RegExp(`${COMPOUND_I}${DESCEND}${COMPOUND_I}`, "i");
var REG_SIBLING = new RegExp(`${COMPOUND_I}${SIBLING}${COMPOUND_I}`, "i");
var REG_LOGIC_COMPLEX = new RegExp(
  `:(?!${PSEUDO_CLASS}|${N_TH}|${LOGIC_COMPLEX})`
);
var REG_LOGIC_COMPOUND = new RegExp(
  `:(?!${PSEUDO_CLASS}|${N_TH}|${LOGIC_COMPOUND})`
);
var REG_LOGIC_HAS_COMPOUND = new RegExp(
  `:(?!${PSEUDO_CLASS}|${N_TH}|${LOGIC_COMPOUND}|${HAS_COMPOUND})`
);
var REG_END_WITH_HAS = new RegExp(`:${HAS_COMPOUND}$`);
var REG_WO_LOGICAL = new RegExp(`:(?!${PSEUDO_CLASS}|${N_TH})`);
var REG_IS_HTML = /^(?:application\/xhtml\+x|text\/ht)ml$/;
var REG_IS_XML = /^(?:application\/(?:[\w\-.]+\+)?|image\/[\w\-.]+\+|text\/)xml$/;
var getType = (o) => Object.prototype.toString.call(o).slice(TYPE_FROM, TYPE_TO);
var generateException = (msg, name, globalObject = globalThis) => {
  return new globalObject.DOMException(msg, name);
};
var findNestedHas = (leaf) => {
  return leaf.name === "has";
};
var findLogicalWithNestedHas = (leaf) => {
  if (KEYS_LOGICAL.has(leaf.name) && cssTree.find(leaf, findNestedHas)) {
    return leaf;
  }
  return null;
};
var filterNodesByAnB = (nodes, anb) => {
  const { a, b, reverse } = anb;
  const processedNodes = reverse ? [...nodes].reverse() : nodes;
  const l = nodes.length;
  const matched = [];
  if (a === 0) {
    if (b > 0 && b <= l) {
      matched.push(processedNodes[b - 1]);
    }
    return matched;
  }
  let startIndex = b - 1;
  if (a > 0) {
    while (startIndex < 0) {
      startIndex += a;
    }
    for (let i = startIndex; i < l; i += a) {
      matched.push(processedNodes[i]);
    }
  } else if (startIndex >= 0) {
    for (let i = startIndex; i >= 0; i += a) {
      matched.push(processedNodes[i]);
    }
    return matched.reverse();
  }
  return matched;
};
var resolveContent = (node) => {
  if (!node?.nodeType) {
    throw new TypeError(`Unexpected type ${getType(node)}`);
  }
  let document;
  let root;
  let shadow;
  switch (node.nodeType) {
    case DOCUMENT_NODE: {
      document = node;
      root = node;
      break;
    }
    case DOCUMENT_FRAGMENT_NODE: {
      const { host, mode, ownerDocument } = node;
      document = ownerDocument;
      root = node;
      shadow = host && (mode === "close" || mode === "open");
      break;
    }
    case ELEMENT_NODE: {
      document = node.ownerDocument;
      let refNode = node;
      while (refNode) {
        const { host, mode, nodeType, parentNode } = refNode;
        if (nodeType === DOCUMENT_FRAGMENT_NODE) {
          shadow = host && (mode === "close" || mode === "open");
          break;
        } else if (parentNode) {
          refNode = parentNode;
        } else {
          break;
        }
      }
      root = refNode;
      break;
    }
    default: {
      throw new TypeError(`Unexpected node ${node.nodeName}`);
    }
  }
  return [document, root, !!shadow];
};
var traverseNode = (node, walker, force = false) => {
  if (!node?.nodeType) {
    throw new TypeError(`Unexpected type ${getType(node)}`);
  }
  if (!walker) {
    return null;
  }
  let refNode = walker.currentNode;
  if (refNode === node) {
    return refNode;
  } else if (force || refNode.contains(node)) {
    refNode = walker.nextNode();
    while (refNode) {
      if (refNode === node) {
        break;
      }
      refNode = walker.nextNode();
    }
    return refNode;
  } else {
    if (refNode !== walker.root) {
      let bool;
      while (refNode) {
        if (refNode === node) {
          bool = true;
          break;
        } else if (refNode === walker.root || refNode.contains(node)) {
          break;
        }
        refNode = walker.parentNode();
      }
      if (bool) {
        return refNode;
      }
    }
    if (node.nodeType === ELEMENT_NODE) {
      let bool;
      while (refNode) {
        if (refNode === node) {
          bool = true;
          break;
        }
        refNode = walker.nextNode();
      }
      if (bool) {
        return refNode;
      }
    }
  }
  return null;
};
var isCustomElement = (node, opt = {}) => {
  if (!node?.nodeType) {
    throw new TypeError(`Unexpected type ${getType(node)}`);
  }
  if (node.nodeType !== ELEMENT_NODE) {
    return false;
  }
  const { localName, ownerDocument } = node;
  const { formAssociated } = opt;
  const window = ownerDocument.defaultView;
  let elmConstructor;
  const attr = node.getAttribute("is");
  if (attr) {
    elmConstructor = (0, import_is_potential_custom_element_name.default)(attr) && window.customElements.get(attr);
  } else {
    elmConstructor = (0, import_is_potential_custom_element_name.default)(localName) && window.customElements.get(localName);
  }
  if (elmConstructor) {
    if (formAssociated) {
      return !!elmConstructor.formAssociated;
    }
    return true;
  }
  return false;
};
var getSlottedTextContent = (node) => {
  if (!node?.nodeType) {
    throw new TypeError(`Unexpected type ${getType(node)}`);
  }
  if (typeof node.assignedNodes !== "function") {
    return null;
  }
  const nodes = node.assignedNodes();
  if (nodes.length) {
    let text = "";
    const l = nodes.length;
    for (let i = 0; i < l; i++) {
      const item = nodes[i];
      text = item.textContent.trim();
      if (text) {
        break;
      }
    }
    return text;
  }
  return node.textContent.trim();
};
var getDirectionality = (node) => {
  if (!node?.nodeType) {
    throw new TypeError(`Unexpected type ${getType(node)}`);
  }
  if (node.nodeType !== ELEMENT_NODE) {
    return null;
  }
  const { dir: dirAttr, localName, parentNode } = node;
  const { getEmbeddingLevels } = (0, import_bidi_js.default)();
  if (dirAttr === "ltr" || dirAttr === "rtl") {
    return dirAttr;
  } else if (dirAttr === "auto") {
    let text = "";
    switch (localName) {
      case "input": {
        if (!node.type || KEYS_DIR_AUTO.has(node.type)) {
          text = node.value;
        } else if (KEYS_DIR_LTR.has(node.type)) {
          return "ltr";
        }
        break;
      }
      case "slot": {
        text = getSlottedTextContent(node);
        break;
      }
      case "textarea": {
        text = node.value;
        break;
      }
      default: {
        const items = [].slice.call(node.childNodes);
        for (const item of items) {
          const {
            dir: itemDir,
            localName: itemLocalName,
            nodeType: itemNodeType,
            textContent: itemTextContent
          } = item;
          if (itemNodeType === TEXT_NODE) {
            text = itemTextContent.trim();
          } else if (itemNodeType === ELEMENT_NODE && !KEYS_NODE_DIR_EXCLUDE.has(itemLocalName) && (!itemDir || itemDir !== "ltr" && itemDir !== "rtl")) {
            if (itemLocalName === "slot") {
              text = getSlottedTextContent(item);
            } else {
              text = itemTextContent.trim();
            }
          }
          if (text) {
            break;
          }
        }
      }
    }
    if (text) {
      const {
        paragraphs: [{ level }]
      } = getEmbeddingLevels(text);
      if (level % 2 === 1) {
        return "rtl";
      }
    } else if (parentNode) {
      const { nodeType: parentNodeType } = parentNode;
      if (parentNodeType === ELEMENT_NODE) {
        return getDirectionality(parentNode);
      }
    }
  } else if (localName === "input" && node.type === "tel") {
    return "ltr";
  } else if (localName === "bdi") {
    const text = node.textContent.trim();
    if (text) {
      const {
        paragraphs: [{ level }]
      } = getEmbeddingLevels(text);
      if (level % 2 === 1) {
        return "rtl";
      }
    }
  } else if (parentNode) {
    if (localName === "slot") {
      const text = getSlottedTextContent(node);
      if (text) {
        const {
          paragraphs: [{ level }]
        } = getEmbeddingLevels(text);
        if (level % 2 === 1) {
          return "rtl";
        }
        return "ltr";
      }
    }
    const { nodeType: parentNodeType } = parentNode;
    if (parentNodeType === ELEMENT_NODE) {
      return getDirectionality(parentNode);
    }
  }
  return "ltr";
};
var getLanguageAttribute = (node) => {
  if (!node?.nodeType) {
    throw new TypeError(`Unexpected type ${getType(node)}`);
  }
  if (node.nodeType !== ELEMENT_NODE) {
    return null;
  }
  const { contentType } = node.ownerDocument;
  const isHtml = REG_IS_HTML.test(contentType);
  const isXml = REG_IS_XML.test(contentType);
  let isShadow = false;
  let current = node;
  while (current) {
    switch (current.nodeType) {
      case ELEMENT_NODE: {
        if (isHtml && current.hasAttribute("lang")) {
          return current.getAttribute("lang");
        } else if (isXml && current.hasAttribute("xml:lang")) {
          return current.getAttribute("xml:lang");
        }
        break;
      }
      case DOCUMENT_FRAGMENT_NODE: {
        if (current.host) {
          isShadow = true;
        }
        break;
      }
      case DOCUMENT_NODE:
      default: {
        return null;
      }
    }
    if (isShadow) {
      current = current.host;
      isShadow = false;
    } else if (current.parentNode) {
      current = current.parentNode;
    } else {
      break;
    }
  }
  return null;
};
var isContentEditable = (node) => {
  if (!node?.nodeType) {
    throw new TypeError(`Unexpected type ${getType(node)}`);
  }
  if (node.nodeType !== ELEMENT_NODE) {
    return false;
  }
  if (typeof node.isContentEditable === "boolean") {
    return node.isContentEditable;
  } else if (node.ownerDocument.designMode === "on") {
    return true;
  } else {
    let attr;
    if (node.hasAttribute("contenteditable")) {
      attr = node.getAttribute("contenteditable");
    } else {
      attr = "inherit";
    }
    switch (attr) {
      case "":
      case "true": {
        return true;
      }
      case "plaintext-only": {
        return true;
      }
      case "false": {
        return false;
      }
      default: {
        if (node?.parentNode?.nodeType === ELEMENT_NODE) {
          return isContentEditable(node.parentNode);
        }
        return false;
      }
    }
  }
};
var isVisible = (node) => {
  if (node?.nodeType !== ELEMENT_NODE) {
    return false;
  }
  const window = node.ownerDocument.defaultView;
  const { display, visibility } = window.getComputedStyle(node);
  if (display !== "none" && visibility === "visible") {
    return true;
  }
  return false;
};
var isFocusVisible = (node) => {
  if (node?.nodeType !== ELEMENT_NODE) {
    return false;
  }
  const { localName, type } = node;
  switch (localName) {
    case "input": {
      if (!type || KEYS_INPUT_EDIT.has(type)) {
        return true;
      }
      return false;
    }
    case "textarea": {
      return true;
    }
    default: {
      return isContentEditable(node);
    }
  }
};
var isFocusableArea = (node) => {
  if (node?.nodeType !== ELEMENT_NODE) {
    return false;
  }
  if (!node.isConnected) {
    return false;
  }
  const window = node.ownerDocument.defaultView;
  if (node instanceof window.HTMLElement) {
    if (Number.isInteger(parseInt(node.getAttribute("tabindex")))) {
      return true;
    }
    if (isContentEditable(node)) {
      return true;
    }
    const { localName, parentNode } = node;
    switch (localName) {
      case "a": {
        if (node.href || node.hasAttribute("href")) {
          return true;
        }
        return false;
      }
      case "iframe": {
        return true;
      }
      case "input": {
        if (node.disabled || node.hasAttribute("disabled") || node.hidden || node.hasAttribute("hidden")) {
          return false;
        }
        return true;
      }
      case "summary": {
        if (parentNode.localName === "details") {
          let child = parentNode.firstElementChild;
          let bool = false;
          while (child) {
            if (child.localName === "summary") {
              bool = child === node;
              break;
            }
            child = child.nextElementSibling;
          }
          return bool;
        }
        return false;
      }
      default: {
        if (KEYS_NODE_FOCUSABLE.has(localName) && !(node.disabled || node.hasAttribute("disabled"))) {
          return true;
        }
      }
    }
  } else if (node instanceof window.SVGElement) {
    if (Number.isInteger(parseInt(node.getAttributeNS(null, "tabindex")))) {
      const ns = "http://www.w3.org/2000/svg";
      let bool;
      let refNode = node;
      while (refNode.namespaceURI === ns) {
        bool = KEYS_NODE_FOCUSABLE_SVG.has(refNode.localName);
        if (bool) {
          break;
        }
        if (refNode?.parentNode?.namespaceURI === ns) {
          refNode = refNode.parentNode;
        } else {
          break;
        }
      }
      if (bool) {
        return false;
      }
      return true;
    }
    if (node.localName === "a" && (node.href || node.hasAttributeNS(null, "href"))) {
      return true;
    }
  }
  return false;
};
var getNamespaceURI = (ns, node) => {
  if (typeof ns !== "string") {
    throw new TypeError(`Unexpected type ${getType(ns)}`);
  } else if (!node?.nodeType) {
    throw new TypeError(`Unexpected type ${getType(node)}`);
  }
  if (!ns || node.nodeType !== ELEMENT_NODE) {
    return null;
  }
  const { attributes } = node;
  let res;
  for (const attr of attributes) {
    const { name, namespaceURI, prefix, value } = attr;
    if (name === `xmlns:${ns}`) {
      res = value;
    } else if (prefix === ns) {
      res = namespaceURI;
    }
    if (res) {
      break;
    }
  }
  return res ?? null;
};
var isNamespaceDeclared = (ns = "", node = {}) => {
  if (!ns || typeof ns !== "string" || node?.nodeType !== ELEMENT_NODE) {
    return false;
  }
  if (node.lookupNamespaceURI(ns)) {
    return true;
  }
  const root = node.ownerDocument.documentElement;
  let parent = node;
  let res;
  while (parent) {
    res = getNamespaceURI(ns, parent);
    if (res || parent === root) {
      break;
    }
    parent = parent.parentNode;
  }
  return !!res;
};
var isPreceding = (nodeA, nodeB) => {
  if (!nodeA?.nodeType) {
    throw new TypeError(`Unexpected type ${getType(nodeA)}`);
  } else if (!nodeB?.nodeType) {
    throw new TypeError(`Unexpected type ${getType(nodeB)}`);
  }
  if (nodeA.nodeType !== ELEMENT_NODE || nodeB.nodeType !== ELEMENT_NODE) {
    return false;
  }
  const posBit = nodeB.compareDocumentPosition(nodeA);
  const res = posBit & DOCUMENT_POSITION_PRECEDING || posBit & DOCUMENT_POSITION_CONTAINS;
  return !!res;
};
var compareNodes = (a, b) => {
  if (isPreceding(b, a)) {
    return 1;
  }
  return -1;
};
var sortNodes = (nodes = []) => {
  const arr = [...nodes];
  if (arr.length > 1) {
    arr.sort(compareNodes);
  }
  return arr;
};
var initNwsapi = (window, document) => {
  if (!window?.DOMException) {
    throw new TypeError(`Unexpected global object ${getType(window)}`);
  }
  if (document?.nodeType !== DOCUMENT_NODE) {
    document = window.document;
  }
  const nw = (0, import_nwsapi.default)({
    document,
    DOMException: window.DOMException
  });
  nw.configure({
    LOGERRORS: false
  });
  return nw;
};
var filterSelector = (selector, target) => {
  const isQuerySelectorType = target === TARGET_FIRST || target === TARGET_ALL;
  if (!selector || typeof selector !== "string" || /null|undefined/.test(selector)) {
    return false;
  }
  if (selector.includes("[")) {
    const index = selector.lastIndexOf("[");
    const sel = selector.substring(index);
    if (sel.indexOf("]") < 0) {
      return false;
    }
  }
  if (selector.includes("/") || REG_EXCLUDE_BASIC.test(selector)) {
    return false;
  }
  if (selector.includes(":")) {
    let complex = false;
    if (target !== isQuerySelectorType) {
      complex = REG_COMPLEX.test(selector);
    }
    if (isQuerySelectorType && REG_DESCEND.test(selector) && !REG_SIBLING.test(selector)) {
      return false;
    } else if (!isQuerySelectorType && /:has\(/.test(selector)) {
      if (!complex || REG_LOGIC_HAS_COMPOUND.test(selector)) {
        return false;
      }
      return REG_END_WITH_HAS.test(selector);
    } else if (/:(?:is|not)\(/.test(selector)) {
      if (complex) {
        return !REG_LOGIC_COMPLEX.test(selector);
      } else {
        return !REG_LOGIC_COMPOUND.test(selector);
      }
    } else {
      return !REG_WO_LOGICAL.test(selector);
    }
  }
  return true;
};

// src/js/parser.js
var import_css_tree = require("css-tree");
var AST_SORT_ORDER = /* @__PURE__ */ new Map([
  [PS_ELEMENT_SELECTOR, BIT_01],
  [ID_SELECTOR, BIT_02],
  [CLASS_SELECTOR, BIT_04],
  [TYPE_SELECTOR, BIT_08],
  [ATTR_SELECTOR, BIT_16],
  [PS_CLASS_SELECTOR, BIT_32]
]);
var KEYS_PS_CLASS_STATE = /* @__PURE__ */ new Set([
  "checked",
  "closed",
  "disabled",
  "empty",
  "enabled",
  "in-range",
  "indeterminate",
  "invalid",
  "open",
  "out-of-range",
  "placeholder-shown",
  "read-only",
  "read-write",
  "valid"
]);
var KEYS_SHADOW_HOST = /* @__PURE__ */ new Set(["host", "host-context"]);
var REG_EMPTY_PS_FUNC = /(?<=:(?:dir|has|host(?:-context)?|is|lang|not|nth-(?:last-)?(?:child|of-type)|where))\(\s+\)/g;
var REG_SHADOW_PS_ELEMENT = /^part|slotted$/;
var U_FFFD = "\uFFFD";
var unescapeSelector = (selector = "") => {
  if (typeof selector === "string" && selector.indexOf("\\", 0) >= 0) {
    const arr = selector.split("\\");
    const selectorItems = [arr[0]];
    const l = arr.length;
    for (let i = 1; i < l; i++) {
      const item = arr[i];
      if (item === "" && i === l - 1) {
        selectorItems.push(U_FFFD);
      } else {
        const hexExists = /^([\da-f]{1,6}\s?)/i.exec(item);
        if (hexExists) {
          const [, hex] = hexExists;
          let str;
          try {
            const low = parseInt("D800", HEX);
            const high = parseInt("DFFF", HEX);
            const deci = parseInt(hex, HEX);
            if (deci === 0 || deci >= low && deci <= high) {
              str = U_FFFD;
            } else {
              str = String.fromCodePoint(deci);
            }
          } catch (e) {
            str = U_FFFD;
          }
          let postStr = "";
          if (item.length > hex.length) {
            postStr = item.substring(hex.length);
          }
          selectorItems.push(`${str}${postStr}`);
        } else if (/^[\n\r\f]/.test(item)) {
          selectorItems.push(`\\${item}`);
        } else {
          selectorItems.push(item);
        }
      }
    }
    return selectorItems.join("");
  }
  return selector;
};
var preprocess = (value) => {
  if (typeof value !== "string") {
    if (value === void 0 || value === null) {
      return getType(value).toLowerCase();
    } else if (Array.isArray(value)) {
      return value.join(",");
    } else if (Object.hasOwn(value, "toString")) {
      return value.toString();
    } else {
      throw new DOMException(`Invalid selector ${value}`, SYNTAX_ERR);
    }
  }
  let selector = value;
  let index = 0;
  while (index >= 0) {
    index = selector.indexOf("#", index);
    if (index < 0) {
      break;
    }
    const preHash = selector.substring(0, index + 1);
    let postHash = selector.substring(index + 1);
    const codePoint = postHash.codePointAt(0);
    if (codePoint > BIT_FFFF) {
      const str = `\\${codePoint.toString(HEX)} `;
      if (postHash.length === DUO) {
        postHash = str;
      } else {
        postHash = `${str}${postHash.substring(DUO)}`;
      }
    }
    selector = `${preHash}${postHash}`;
    index++;
  }
  return selector.replace(/\f|\r\n?/g, "\n").replace(/[\0\uD800-\uDFFF]|\\$/g, U_FFFD).replace(/\x26/g, ":scope");
};
var parseSelector = (sel) => {
  const selector = preprocess(sel);
  if (/^$|^\s*>|,\s*$/.test(selector)) {
    throw new DOMException(`Invalid selector ${selector}`, SYNTAX_ERR);
  }
  try {
    const ast = cssTree2.parse(selector, {
      context: "selectorList",
      parseCustomProperty: true
    });
    return cssTree2.toPlainObject(ast);
  } catch (e) {
    const { message } = e;
    if (/^(?:"\]"|Attribute selector [()\s,=~^$*|]+) is expected$/.test(
      message
    ) && !selector.endsWith("]")) {
      const index = selector.lastIndexOf("[");
      const selPart = selector.substring(index);
      if (selPart.includes('"')) {
        const quotes = selPart.match(/"/g).length;
        if (quotes % 2) {
          return parseSelector(`${selector}"]`);
        }
        return parseSelector(`${selector}]`);
      }
      return parseSelector(`${selector}]`);
    } else if (message === '")" is expected') {
      if (REG_EMPTY_PS_FUNC.test(selector)) {
        return parseSelector(`${selector.replaceAll(REG_EMPTY_PS_FUNC, "()")}`);
      } else if (!selector.endsWith(")")) {
        return parseSelector(`${selector})`);
      } else {
        throw new DOMException(`Invalid selector ${selector}`, SYNTAX_ERR);
      }
    } else {
      throw new DOMException(`Invalid selector ${selector}`, SYNTAX_ERR);
    }
  }
};
var walkAST = (ast = {}) => {
  const branches = /* @__PURE__ */ new Set();
  const info = {
    hasForgivenPseudoFunc: false,
    hasHasPseudoFunc: false,
    hasLogicalPseudoFunc: false,
    hasNotPseudoFunc: false,
    hasNthChildOfSelector: false,
    hasNestedSelector: false,
    hasStatePseudoClass: false
  };
  const opt = {
    enter(node) {
      switch (node.type) {
        case CLASS_SELECTOR: {
          if (/^-?\d/.test(node.name)) {
            throw new DOMException(
              `Invalid selector .${node.name}`,
              SYNTAX_ERR
            );
          }
          break;
        }
        case ID_SELECTOR: {
          if (/^-?\d/.test(node.name)) {
            throw new DOMException(
              `Invalid selector #${node.name}`,
              SYNTAX_ERR
            );
          }
          break;
        }
        case PS_CLASS_SELECTOR: {
          if (KEYS_LOGICAL.has(node.name)) {
            info.hasNestedSelector = true;
            info.hasLogicalPseudoFunc = true;
            if (node.name === "has") {
              info.hasHasPseudoFunc = true;
            } else if (node.name === "not") {
              info.hasNotPseudoFunc = true;
            } else {
              info.hasForgivenPseudoFunc = true;
            }
          } else if (KEYS_PS_CLASS_STATE.has(node.name)) {
            info.hasStatePseudoClass = true;
          } else if (KEYS_SHADOW_HOST.has(node.name) && Array.isArray(node.children) && node.children.length) {
            info.hasNestedSelector = true;
          }
          break;
        }
        case PS_ELEMENT_SELECTOR: {
          if (REG_SHADOW_PS_ELEMENT.test(node.name)) {
            info.hasNestedSelector = true;
          }
          break;
        }
        case NTH: {
          if (node.selector) {
            info.hasNestedSelector = true;
            info.hasNthChildOfSelector = true;
          }
          break;
        }
        case SELECTOR: {
          branches.add(node.children);
          break;
        }
        default:
      }
    }
  };
  cssTree2.walk(ast, opt);
  if (info.hasNestedSelector === true) {
    cssTree2.findAll(ast, (node, item, list) => {
      if (list) {
        if (node.type === PS_CLASS_SELECTOR && KEYS_LOGICAL.has(node.name)) {
          const itemList = list.filter((i) => {
            const { name, type } = i;
            return type === PS_CLASS_SELECTOR && KEYS_LOGICAL.has(name);
          });
          for (const { children } of itemList) {
            for (const { children: grandChildren } of children) {
              for (const { children: greatGrandChildren } of grandChildren) {
                if (branches.has(greatGrandChildren)) {
                  branches.delete(greatGrandChildren);
                }
              }
            }
          }
        } else if (node.type === PS_CLASS_SELECTOR && KEYS_SHADOW_HOST.has(node.name) && Array.isArray(node.children) && node.children.length) {
          const itemList = list.filter((i) => {
            const { children, name, type } = i;
            const res = type === PS_CLASS_SELECTOR && KEYS_SHADOW_HOST.has(name) && Array.isArray(children) && children.length;
            return res;
          });
          for (const { children } of itemList) {
            for (const { children: grandChildren } of children) {
              if (branches.has(grandChildren)) {
                branches.delete(grandChildren);
              }
            }
          }
        } else if (node.type === PS_ELEMENT_SELECTOR && REG_SHADOW_PS_ELEMENT.test(node.name)) {
          const itemList = list.filter((i) => {
            const { name, type } = i;
            const res = type === PS_ELEMENT_SELECTOR && REG_SHADOW_PS_ELEMENT.test(name);
            return res;
          });
          for (const { children } of itemList) {
            for (const { children: grandChildren } of children) {
              if (branches.has(grandChildren)) {
                branches.delete(grandChildren);
              }
            }
          }
        } else if (node.type === NTH && node.selector) {
          const itemList = list.filter((i) => {
            const { selector, type } = i;
            const res = type === NTH && selector;
            return res;
          });
          for (const { selector } of itemList) {
            const { children } = selector;
            for (const { children: grandChildren } of children) {
              if (branches.has(grandChildren)) {
                branches.delete(grandChildren);
              }
            }
          }
        }
      }
    });
  }
  return {
    info,
    branches: [...branches]
  };
};
var compareASTNodes = (a, b) => {
  const bitA = AST_SORT_ORDER.get(a.type);
  const bitB = AST_SORT_ORDER.get(b.type);
  if (bitA === bitB) {
    return 0;
  } else if (bitA > bitB) {
    return 1;
  } else {
    return -1;
  }
};
var sortAST = (asts) => {
  const arr = [...asts];
  if (arr.length > 1) {
    arr.sort(compareASTNodes);
  }
  return arr;
};
var parseAstName = (selector) => {
  let prefix;
  let localName;
  if (selector && typeof selector === "string") {
    if (selector.indexOf("|") > -1) {
      [prefix, localName] = selector.split("|");
    } else {
      prefix = "*";
      localName = selector;
    }
  } else {
    throw new DOMException(`Invalid selector ${selector}`, SYNTAX_ERR);
  }
  return {
    prefix,
    localName
  };
};

// src/js/matcher.js
var KEYS_FORM_PS_DISABLED = /* @__PURE__ */ new Set([
  ...FORM_PARTS,
  "fieldset",
  "optgroup",
  "option"
]);
var KEYS_INPUT_EDIT2 = new Set(INPUT_EDIT);
var REG_LANG_VALID = new RegExp(`^(?:\\*-)?${ALPHA_NUM}${LANG_PART}$`, "i");
var REG_TAG_NAME = /[A-Z][\\w-]*/i;
var matchPseudoElementSelector = (astName, astType, opt = {}) => {
  const { forgive, globalObject, warn } = opt;
  if (astType !== PS_ELEMENT_SELECTOR) {
    throw new TypeError(`Unexpected ast type ${getType(astType)}`);
  }
  switch (astName) {
    case "after":
    case "backdrop":
    case "before":
    case "cue":
    case "cue-region":
    case "first-letter":
    case "first-line":
    case "file-selector-button":
    case "marker":
    case "placeholder":
    case "selection":
    case "target-text": {
      if (warn) {
        throw generateException(
          `Unsupported pseudo-element ::${astName}`,
          NOT_SUPPORTED_ERR,
          globalObject
        );
      }
      break;
    }
    case "part":
    case "slotted": {
      if (warn) {
        throw generateException(
          `Unsupported pseudo-element ::${astName}()`,
          NOT_SUPPORTED_ERR,
          globalObject
        );
      }
      break;
    }
    default: {
      if (astName.startsWith("-webkit-")) {
        if (warn) {
          throw generateException(
            `Unsupported pseudo-element ::${astName}`,
            NOT_SUPPORTED_ERR,
            globalObject
          );
        }
      } else if (!forgive) {
        throw generateException(
          `Unknown pseudo-element ::${astName}`,
          SYNTAX_ERR,
          globalObject
        );
      }
    }
  }
};
var matchDirectionPseudoClass = (ast, node) => {
  const { name } = ast;
  if (!name) {
    const type = name === "" ? "(empty String)" : getType(name);
    throw new TypeError(`Unexpected ast type ${type}`);
  }
  const dir = getDirectionality(node);
  return name === dir;
};
var matchLanguagePseudoClass = (ast, node) => {
  const { name, type, value } = ast;
  let langPattern;
  if (type === STRING && value) {
    langPattern = value;
  } else if (type === IDENT && name) {
    langPattern = unescapeSelector(name);
  }
  if (typeof langPattern !== "string") {
    return false;
  }
  const elementLang = getLanguageAttribute(node);
  if (elementLang === null) {
    return false;
  }
  if (langPattern === "*") {
    return elementLang !== "";
  }
  if (!REG_LANG_VALID.test(langPattern)) {
    return false;
  }
  let matcherRegex;
  if (langPattern.indexOf("-") > -1) {
    const [langMain, langSub, ...langRest] = langPattern.split("-");
    const extendedMain = langMain === "*" ? `${ALPHA_NUM}${LANG_PART}` : `${langMain}${LANG_PART}`;
    const extendedSub = `-${langSub}${LANG_PART}`;
    let extendedRest = "";
    for (let i = 0; i < langRest.length; i++) {
      extendedRest += `-${langRest[i]}${LANG_PART}`;
    }
    matcherRegex = new RegExp(
      `^${extendedMain}${extendedSub}${extendedRest}$`,
      "i"
    );
  } else {
    matcherRegex = new RegExp(`^${langPattern}${LANG_PART}$`, "i");
  }
  return matcherRegex.test(elementLang);
};
var matchDisabledPseudoClass = (astName, node) => {
  const { localName, parentNode } = node;
  if (!KEYS_FORM_PS_DISABLED.has(localName) && !isCustomElement(node, { formAssociated: true })) {
    return false;
  }
  let isDisabled = false;
  if (node.disabled || node.hasAttribute("disabled")) {
    isDisabled = true;
  } else if (localName === "option") {
    if (parentNode && parentNode.localName === "optgroup" && (parentNode.disabled || parentNode.hasAttribute("disabled"))) {
      isDisabled = true;
    }
  } else if (localName !== "optgroup") {
    let current = parentNode;
    while (current) {
      if (current.localName === "fieldset" && (current.disabled || current.hasAttribute("disabled"))) {
        let legend;
        let element = current.firstElementChild;
        while (element) {
          if (element.localName === "legend") {
            legend = element;
            break;
          }
          element = element.nextElementSibling;
        }
        if (!legend || !legend.contains(node)) {
          isDisabled = true;
        }
        break;
      }
      current = current.parentNode;
    }
  }
  if (astName === "disabled") {
    return isDisabled;
  }
  return !isDisabled;
};
var matchReadOnlyPseudoClass = (astName, node) => {
  const { localName } = node;
  let isReadOnly = false;
  switch (localName) {
    case "textarea":
    case "input": {
      const isEditableInput = !node.type || KEYS_INPUT_EDIT2.has(node.type);
      if (localName === "textarea" || isEditableInput) {
        isReadOnly = node.readOnly || node.hasAttribute("readonly") || node.disabled || node.hasAttribute("disabled");
      } else {
        isReadOnly = true;
      }
      break;
    }
    default: {
      isReadOnly = !isContentEditable(node);
    }
  }
  if (astName === "read-only") {
    return isReadOnly;
  }
  return !isReadOnly;
};
var matchAttributeSelector = (ast, node, opt = {}) => {
  const {
    flags: astFlags,
    matcher: astMatcher,
    name: astName,
    value: astValue
  } = ast;
  const { check, forgive, globalObject } = opt;
  if (typeof astFlags === "string" && !/^[is]$/i.test(astFlags) && !forgive) {
    const css = (0, import_css_tree.generate)(ast);
    throw generateException(
      `Invalid selector ${css}`,
      SYNTAX_ERR,
      globalObject
    );
  }
  const { attributes } = node;
  if (!attributes || !attributes.length) {
    return false;
  }
  const contentType = node.ownerDocument.contentType;
  let caseInsensitive;
  if (contentType === "text/html") {
    if (typeof astFlags === "string" && /^s$/i.test(astFlags)) {
      caseInsensitive = false;
    } else {
      caseInsensitive = true;
    }
  } else if (typeof astFlags === "string" && /^i$/i.test(astFlags)) {
    caseInsensitive = true;
  } else {
    caseInsensitive = false;
  }
  let astAttrName = unescapeSelector(astName.name);
  if (caseInsensitive) {
    astAttrName = astAttrName.toLowerCase();
  }
  const attrValues = /* @__PURE__ */ new Set();
  if (astAttrName.indexOf("|") > -1) {
    const { prefix: astPrefix, localName: astLocalName } = parseAstName(astAttrName);
    for (const item of attributes) {
      let { name: itemName, value: itemValue } = item;
      if (caseInsensitive) {
        itemName = itemName.toLowerCase();
        itemValue = itemValue.toLowerCase();
      }
      switch (astPrefix) {
        case "": {
          if (astLocalName === itemName) {
            attrValues.add(itemValue);
          }
          break;
        }
        case "*": {
          if (itemName.indexOf(":") > -1) {
            const [, ...restItemName] = itemName.split(":");
            const itemLocalName = restItemName.join(":").replace(/^:/, "");
            if (itemLocalName === astLocalName) {
              attrValues.add(itemValue);
            }
          } else if (astLocalName === itemName) {
            attrValues.add(itemValue);
          }
          break;
        }
        default: {
          if (!check) {
            if (forgive) {
              return false;
            }
            const css = (0, import_css_tree.generate)(ast);
            throw generateException(
              `Invalid selector ${css}`,
              SYNTAX_ERR,
              globalObject
            );
          }
          if (itemName.indexOf(":") > -1) {
            const [itemPrefix, ...restItemName] = itemName.split(":");
            const itemLocalName = restItemName.join(":").replace(/^:/, "");
            if (itemPrefix === "xml" && itemLocalName === "lang") {
              continue;
            } else if (astPrefix === itemPrefix && astLocalName === itemLocalName) {
              const namespaceDeclared = isNamespaceDeclared(astPrefix, node);
              if (namespaceDeclared) {
                attrValues.add(itemValue);
              }
            }
          }
        }
      }
    }
  } else {
    for (let { name: itemName, value: itemValue } of attributes) {
      if (caseInsensitive) {
        itemName = itemName.toLowerCase();
        itemValue = itemValue.toLowerCase();
      }
      if (itemName.indexOf(":") > -1) {
        const [itemPrefix, ...restItemName] = itemName.split(":");
        const itemLocalName = restItemName.join(":").replace(/^:/, "");
        if (!itemPrefix && astAttrName === `:${itemLocalName}`) {
          attrValues.add(itemValue);
        } else if (itemPrefix === "xml" && itemLocalName === "lang") {
          continue;
        } else if (astAttrName === itemLocalName) {
          attrValues.add(itemValue);
        }
      } else if (astAttrName === itemName) {
        attrValues.add(itemValue);
      }
    }
  }
  if (!attrValues.size) {
    return false;
  }
  const { name: astIdentValue, value: astStringValue } = astValue ?? {};
  let attrValue;
  if (astIdentValue) {
    if (caseInsensitive) {
      attrValue = astIdentValue.toLowerCase();
    } else {
      attrValue = astIdentValue;
    }
  } else if (astStringValue) {
    if (caseInsensitive) {
      attrValue = astStringValue.toLowerCase();
    } else {
      attrValue = astStringValue;
    }
  } else if (astStringValue === "") {
    attrValue = astStringValue;
  }
  switch (astMatcher) {
    case "=": {
      return typeof attrValue === "string" && attrValues.has(attrValue);
    }
    case "~=": {
      if (attrValue && typeof attrValue === "string") {
        for (const value of attrValues) {
          const item = new Set(value.split(/\s+/));
          if (item.has(attrValue)) {
            return true;
          }
        }
      }
      return false;
    }
    case "|=": {
      if (attrValue && typeof attrValue === "string") {
        for (const value of attrValues) {
          if (value === attrValue || value.startsWith(`${attrValue}-`)) {
            return true;
          }
        }
      }
      return false;
    }
    case "^=": {
      if (attrValue && typeof attrValue === "string") {
        for (const value of attrValues) {
          if (value.startsWith(`${attrValue}`)) {
            return true;
          }
        }
      }
      return false;
    }
    case "$=": {
      if (attrValue && typeof attrValue === "string") {
        for (const value of attrValues) {
          if (value.endsWith(`${attrValue}`)) {
            return true;
          }
        }
      }
      return false;
    }
    case "*=": {
      if (attrValue && typeof attrValue === "string") {
        for (const value of attrValues) {
          if (value.includes(`${attrValue}`)) {
            return true;
          }
        }
      }
      return false;
    }
    case null:
    default: {
      return true;
    }
  }
};
var matchTypeSelector = (ast, node, opt = {}) => {
  const astName = unescapeSelector(ast.name);
  const { localName, namespaceURI, prefix } = node;
  const { check, forgive, globalObject } = opt;
  let { prefix: astPrefix, localName: astLocalName } = parseAstName(
    astName,
    node
  );
  if (node.ownerDocument.contentType === "text/html" && (!namespaceURI || namespaceURI === "http://www.w3.org/1999/xhtml") && REG_TAG_NAME.test(localName)) {
    astPrefix = astPrefix.toLowerCase();
    astLocalName = astLocalName.toLowerCase();
  }
  let nodePrefix;
  let nodeLocalName;
  if (localName.indexOf(":") > -1) {
    [nodePrefix, nodeLocalName] = localName.split(":");
  } else {
    nodePrefix = prefix || "";
    nodeLocalName = localName;
  }
  switch (astPrefix) {
    case "": {
      if (!nodePrefix && !namespaceURI && (astLocalName === "*" || astLocalName === nodeLocalName)) {
        return true;
      }
      return false;
    }
    case "*": {
      if (astLocalName === "*" || astLocalName === nodeLocalName) {
        return true;
      }
      return false;
    }
    default: {
      if (!check) {
        if (forgive) {
          return false;
        }
        const css = (0, import_css_tree.generate)(ast);
        throw generateException(
          `Invalid selector ${css}`,
          SYNTAX_ERR,
          globalObject
        );
      }
      const astNS = node.lookupNamespaceURI(astPrefix);
      const nodeNS = node.lookupNamespaceURI(nodePrefix);
      if (astNS === nodeNS && astPrefix === nodePrefix) {
        if (astLocalName === "*" || astLocalName === nodeLocalName) {
          return true;
        }
        return false;
      } else if (!forgive && !astNS) {
        throw generateException(
          `Undeclared namespace ${astPrefix}`,
          SYNTAX_ERR,
          globalObject
        );
      }
      return false;
    }
  }
};

// src/js/finder.js
var DIR_NEXT = "next";
var DIR_PREV = "prev";
var KEYS_FORM = /* @__PURE__ */ new Set([...FORM_PARTS, "fieldset", "form"]);
var KEYS_FORM_PS_VALID = /* @__PURE__ */ new Set([...FORM_PARTS, "form"]);
var KEYS_INPUT_CHECK = new Set(INPUT_CHECK);
var KEYS_INPUT_PLACEHOLDER = /* @__PURE__ */ new Set([...INPUT_TEXT, "number"]);
var KEYS_INPUT_RANGE = /* @__PURE__ */ new Set([...INPUT_DATE, "number", "range"]);
var KEYS_INPUT_REQUIRED = /* @__PURE__ */ new Set([...INPUT_CHECK, ...INPUT_EDIT, "file"]);
var KEYS_INPUT_RESET = /* @__PURE__ */ new Set(["button", "reset"]);
var KEYS_INPUT_SUBMIT = /* @__PURE__ */ new Set(["image", "submit"]);
var KEYS_MODIFIER = /* @__PURE__ */ new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Fn",
  "FnLock",
  "Hyper",
  "Meta",
  "NumLock",
  "ScrollLock",
  "Shift",
  "Super",
  "Symbol",
  "SymbolLock"
]);
var KEYS_PS_UNCACHE = /* @__PURE__ */ new Set([
  "any-link",
  "defined",
  "dir",
  "link",
  "scope"
]);
var KEYS_PS_NTH_OF_TYPE = /* @__PURE__ */ new Set([
  "first-of-type",
  "last-of-type",
  "only-of-type"
]);
var Finder = class {
  /* private fields */
  #ast;
  #astCache;
  #check;
  #descendant;
  #document;
  #documentCache;
  #documentURL;
  #event;
  #eventHandlers;
  #focus;
  #invalidate;
  #invalidateResults;
  #lastFocusVisible;
  #node;
  #nodeWalker;
  #nodes;
  #noexcept;
  #pseudoElement;
  #results;
  #root;
  #rootWalker;
  #selector;
  #shadow;
  #verifyShadowHost;
  #walkers;
  #warn;
  #window;
  /**
   * constructor
   * @param {object} window - The window object.
   */
  constructor(window) {
    this.#window = window;
    this.#astCache = /* @__PURE__ */ new WeakMap();
    this.#documentCache = /* @__PURE__ */ new WeakMap();
    this.#event = null;
    this.#focus = null;
    this.#lastFocusVisible = null;
    this.#eventHandlers = /* @__PURE__ */ new Set([
      {
        keys: ["focus", "focusin"],
        handler: this._handleFocusEvent
      },
      {
        keys: ["keydown", "keyup"],
        handler: this._handleKeyboardEvent
      },
      {
        keys: ["mouseover", "mousedown", "mouseup", "click", "mouseout"],
        handler: this._handleMouseEvent
      }
    ]);
    this._registerEventListeners();
    this.clearResults(true);
  }
  /**
   * Handles errors.
   * @param {Error} e - The error object.
   * @param {object} [opt] - Options.
   * @param {boolean} [opt.noexcept] - If true, exceptions are not thrown.
   * @throws {Error} Throws an error.
   * @returns {void}
   */
  onError = (e, opt = {}) => {
    const noexcept = opt.noexcept ?? this.#noexcept;
    if (noexcept) {
      return;
    }
    const isDOMException = e instanceof DOMException || e instanceof this.#window.DOMException;
    if (isDOMException) {
      if (e.name === NOT_SUPPORTED_ERR) {
        if (this.#warn) {
          console.warn(e.message);
        }
        return;
      }
      throw new this.#window.DOMException(e.message, e.name);
    }
    if (e.name in this.#window) {
      throw new this.#window[e.name](e.message, { cause: e });
    }
    throw e;
  };
  /**
   * Sets up the finder.
   * @param {string} selector - The CSS selector.
   * @param {object} node - Document, DocumentFragment, or Element.
   * @param {object} [opt] - Options.
   * @param {boolean} [opt.check] - Indicates if running in internal check().
   * @param {boolean} [opt.noexcept] - If true, exceptions are not thrown.
   * @param {boolean} [opt.warn] - If true, console warnings are enabled.
   * @returns {object} The finder instance.
   */
  setup = (selector, node, opt = {}) => {
    const { check, noexcept, warn } = opt;
    this.#check = !!check;
    this.#noexcept = !!noexcept;
    this.#warn = !!warn;
    [this.#document, this.#root, this.#shadow] = resolveContent(node);
    this.#documentURL = null;
    this.#node = node;
    this.#selector = selector;
    [this.#ast, this.#nodes] = this._correspond(selector);
    this.#pseudoElement = [];
    this.#walkers = /* @__PURE__ */ new WeakMap();
    this.#nodeWalker = null;
    this.#rootWalker = null;
    this.#verifyShadowHost = null;
    this.clearResults();
    return this;
  };
  /**
   * Clear cached results.
   * @param {boolean} all - clear all results
   * @returns {void}
   */
  clearResults = (all = false) => {
    this.#invalidateResults = /* @__PURE__ */ new WeakMap();
    if (all) {
      this.#results = /* @__PURE__ */ new WeakMap();
    }
  };
  /**
   * Handles focus events.
   * @private
   * @param {Event} evt - The event object.
   * @returns {void}
   */
  _handleFocusEvent = (evt) => {
    this.#focus = evt;
  };
  /**
   * Handles keyboard events.
   * @private
   * @param {Event} evt - The event object.
   * @returns {void}
   */
  _handleKeyboardEvent = (evt) => {
    const { key } = evt;
    if (!KEYS_MODIFIER.has(key)) {
      this.#event = evt;
    }
  };
  /**
   * Handles mouse events.
   * @private
   * @param {Event} evt - The event object.
   * @returns {void}
   */
  _handleMouseEvent = (evt) => {
    this.#event = evt;
  };
  /**
   * Registers event listeners.
   * @private
   * @returns {Array.<void>} An array of return values from addEventListener.
   */
  _registerEventListeners = () => {
    const opt = {
      capture: true,
      passive: true
    };
    const func = [];
    for (const eventHandler of this.#eventHandlers) {
      const { keys, handler } = eventHandler;
      const l = keys.length;
      for (let i = 0; i < l; i++) {
        const key = keys[i];
        func.push(this.#window.addEventListener(key, handler, opt));
      }
    }
    return func;
  };
  /**
   * Processes selector branches into the internal AST structure.
   * @private
   * @param {Array.<Array.<object>>} branches - The branches from walkAST.
   * @param {string} selector - The original selector for error reporting.
   * @returns {{ast: Array, descendant: boolean}}
   * An object with the AST, descendant flag.
   */
  _processSelectorBranches = (branches, selector) => {
    let descendant = false;
    const ast = [];
    const l = branches.length;
    for (let i = 0; i < l; i++) {
      const items = [...branches[i]];
      const branch = [];
      let item = items.shift();
      if (item && item.type !== COMBINATOR) {
        const leaves = /* @__PURE__ */ new Set();
        while (item) {
          if (item.type === COMBINATOR) {
            const [nextItem] = items;
            if (!nextItem || nextItem.type === COMBINATOR) {
              const msg = `Invalid selector ${selector}`;
              this.onError(generateException(msg, SYNTAX_ERR, this.#window));
              return { ast: [], descendant: false, invalidate: false };
            }
            if (item.name === " " || item.name === ">") {
              descendant = true;
            }
            branch.push({ combo: item, leaves: sortAST(leaves) });
            leaves.clear();
          } else {
            if (item.name && typeof item.name === "string") {
              const unescapedName = unescapeSelector(item.name);
              if (unescapedName !== item.name) {
                item.name = unescapedName;
              }
              if (/[|:]/.test(unescapedName)) {
                item.namespace = true;
              }
            }
            leaves.add(item);
          }
          if (items.length) {
            item = items.shift();
          } else {
            branch.push({ combo: null, leaves: sortAST(leaves) });
            leaves.clear();
            break;
          }
        }
      }
      ast.push({ branch, dir: null, filtered: false, find: false });
    }
    return { ast, descendant };
  };
  /**
   * Corresponds AST and nodes.
   * @private
   * @param {string} selector - The CSS selector.
   * @returns {Array.<Array.<object>>} An array with the AST and nodes.
   */
  _correspond = (selector) => {
    const nodes = [];
    this.#descendant = false;
    this.#invalidate = false;
    let ast;
    if (this.#documentCache.has(this.#document)) {
      const cachedItem = this.#documentCache.get(this.#document);
      if (cachedItem && cachedItem.has(`${selector}`)) {
        const item = cachedItem.get(`${selector}`);
        ast = item.ast;
        this.#descendant = item.descendant;
        this.#invalidate = item.invalidate;
      }
    }
    if (ast) {
      const l = ast.length;
      for (let i = 0; i < l; i++) {
        ast[i].dir = null;
        ast[i].filtered = false;
        ast[i].find = false;
        nodes[i] = [];
      }
    } else {
      let cssAst;
      try {
        cssAst = parseSelector(selector);
      } catch (e) {
        return this.onError(e);
      }
      const { branches, info } = walkAST(cssAst);
      const {
        hasHasPseudoFunc,
        hasLogicalPseudoFunc,
        hasNthChildOfSelector,
        hasStatePseudoClass
      } = info;
      this.#invalidate = hasHasPseudoFunc || hasStatePseudoClass || !!(hasLogicalPseudoFunc && hasNthChildOfSelector);
      const processed = this._processSelectorBranches(branches, selector);
      ast = processed.ast;
      this.#descendant = processed.descendant;
      let cachedItem;
      if (this.#documentCache.has(this.#document)) {
        cachedItem = this.#documentCache.get(this.#document);
      } else {
        cachedItem = /* @__PURE__ */ new Map();
      }
      cachedItem.set(`${selector}`, {
        ast,
        descendant: this.#descendant,
        invalidate: this.#invalidate
      });
      this.#documentCache.set(this.#document, cachedItem);
      for (let i = 0; i < ast.length; i++) {
        nodes[i] = [];
      }
    }
    return [ast, nodes];
  };
  /**
   * Creates a TreeWalker.
   * @private
   * @param {object} node - The Document, DocumentFragment, or Element node.
   * @param {object} [opt] - Options.
   * @param {boolean} [opt.force] - Force creation of a new TreeWalker.
   * @param {number} [opt.whatToShow] - The NodeFilter whatToShow value.
   * @returns {object} The TreeWalker object.
   */
  _createTreeWalker = (node, opt = {}) => {
    const { force = false, whatToShow = SHOW_CONTAINER } = opt;
    if (force) {
      return this.#document.createTreeWalker(node, whatToShow);
    } else if (this.#walkers.has(node)) {
      return this.#walkers.get(node);
    }
    const walker = this.#document.createTreeWalker(node, whatToShow);
    this.#walkers.set(node, walker);
    return walker;
  };
  /**
   * Gets selector branches from cache or parses them.
   * @private
   * @param {object} selector - The AST.
   * @returns {Array.<Array.<object>>} The selector branches.
   */
  _getSelectorBranches = (selector) => {
    if (this.#astCache.has(selector)) {
      return this.#astCache.get(selector);
    }
    const { branches } = walkAST(selector);
    this.#astCache.set(selector, branches);
    return branches;
  };
  /**
   * Gets the children of a node, optionally filtered by a selector.
   * @private
   * @param {object} parentNode - The parent element.
   * @param {Array.<Array.<object>>} selectorBranches - The selector branches.
   * @param {object} [opt] - Options.
   * @returns {Array.<object>} An array of child nodes.
   */
  _getFilteredChildren = (parentNode, selectorBranches, opt = {}) => {
    const children = [];
    const walker = this._createTreeWalker(parentNode, { force: true });
    let childNode = walker.firstChild();
    while (childNode) {
      if (selectorBranches) {
        if (isVisible(childNode)) {
          let isMatch = false;
          const l = selectorBranches.length;
          for (let i = 0; i < l; i++) {
            const leaves = selectorBranches[i];
            if (this._matchLeaves(leaves, childNode, opt)) {
              isMatch = true;
              break;
            }
          }
          if (isMatch) {
            children.push(childNode);
          }
        }
      } else {
        children.push(childNode);
      }
      childNode = walker.nextSibling();
    }
    return children;
  };
  /**
   * Collects nth-child nodes.
   * @private
   * @param {object} anb - An+B options.
   * @param {number} anb.a - The 'a' value.
   * @param {number} anb.b - The 'b' value.
   * @param {boolean} [anb.reverse] - If true, reverses the order.
   * @param {object} [anb.selector] - The AST.
   * @param {object} node - The Element node.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _collectNthChild = (anb, node, opt = {}) => {
    const { a, b, selector } = anb;
    const { parentNode } = node;
    if (!parentNode) {
      const matchedNode = /* @__PURE__ */ new Set();
      if (node === this.#root && a * 1 + b * 1 === 1) {
        if (selector) {
          const selectorBranches2 = this._getSelectorBranches(selector);
          const l = selectorBranches2.length;
          for (let i = 0; i < l; i++) {
            const leaves = selectorBranches2[i];
            if (this._matchLeaves(leaves, node, opt)) {
              matchedNode.add(node);
              break;
            }
          }
        } else {
          matchedNode.add(node);
        }
      }
      return matchedNode;
    }
    const selectorBranches = selector ? this._getSelectorBranches(selector) : null;
    const children = this._getFilteredChildren(
      parentNode,
      selectorBranches,
      opt
    );
    const matchedNodes = filterNodesByAnB(children, anb);
    return new Set(matchedNodes);
  };
  /**
   * Collects nth-of-type nodes.
   * @private
   * @param {object} anb - An+B options.
   * @param {number} anb.a - The 'a' value.
   * @param {number} anb.b - The 'b' value.
   * @param {boolean} [anb.reverse] - If true, reverses the order.
   * @param {object} node - The Element node.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _collectNthOfType = (anb, node) => {
    const { parentNode } = node;
    if (!parentNode) {
      if (node === this.#root && anb.a * 1 + anb.b * 1 === 1) {
        return /* @__PURE__ */ new Set([node]);
      }
      return /* @__PURE__ */ new Set();
    }
    const typedSiblings = [];
    const walker = this._createTreeWalker(parentNode, { force: true });
    let sibling = walker.firstChild();
    while (sibling) {
      if (sibling.localName === node.localName && sibling.namespaceURI === node.namespaceURI && sibling.prefix === node.prefix) {
        typedSiblings.push(sibling);
      }
      sibling = walker.nextSibling();
    }
    const matchedNodes = filterNodesByAnB(typedSiblings, anb);
    return new Set(matchedNodes);
  };
  /**
   * Matches An+B.
   * @private
   * @param {object} ast - The AST.
   * @param {object} node - The Element node.
   * @param {string} nthName - The name of the nth pseudo-class.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _matchAnPlusB = (ast, node, nthName, opt = {}) => {
    const {
      nth: { a, b, name: nthIdentName },
      selector
    } = ast;
    const anbMap = /* @__PURE__ */ new Map();
    if (nthIdentName) {
      if (nthIdentName === "even") {
        anbMap.set("a", 2);
        anbMap.set("b", 0);
      } else if (nthIdentName === "odd") {
        anbMap.set("a", 2);
        anbMap.set("b", 1);
      }
      if (nthName.indexOf("last") > -1) {
        anbMap.set("reverse", true);
      }
    } else {
      if (typeof a === "string" && /-?\d+/.test(a)) {
        anbMap.set("a", a * 1);
      } else {
        anbMap.set("a", 0);
      }
      if (typeof b === "string" && /-?\d+/.test(b)) {
        anbMap.set("b", b * 1);
      } else {
        anbMap.set("b", 0);
      }
      if (nthName.indexOf("last") > -1) {
        anbMap.set("reverse", true);
      }
    }
    if (nthName === "nth-child" || nthName === "nth-last-child") {
      if (selector) {
        anbMap.set("selector", selector);
      }
      const anb = Object.fromEntries(anbMap);
      const nodes = this._collectNthChild(anb, node, opt);
      return nodes;
    } else if (nthName === "nth-of-type" || nthName === "nth-last-of-type") {
      const anb = Object.fromEntries(anbMap);
      const nodes = this._collectNthOfType(anb, node);
      return nodes;
    }
    return /* @__PURE__ */ new Set();
  };
  /**
   * Matches the :has() pseudo-class function.
   * @private
   * @param {Array.<object>} astLeaves - The AST leaves.
   * @param {object} node - The Element node.
   * @param {object} [opt] - Options.
   * @returns {boolean} The result.
   */
  _matchHasPseudoFunc = (astLeaves, node, opt = {}) => {
    if (Array.isArray(astLeaves) && astLeaves.length) {
      const leaves = [...astLeaves];
      const [leaf] = leaves;
      const { type: leafType } = leaf;
      let combo;
      if (leafType === COMBINATOR) {
        combo = leaves.shift();
      } else {
        combo = {
          name: " ",
          type: COMBINATOR
        };
      }
      const twigLeaves = [];
      while (leaves.length) {
        const [item] = leaves;
        const { type: itemType } = item;
        if (itemType === COMBINATOR) {
          break;
        } else {
          twigLeaves.push(leaves.shift());
        }
      }
      const twig = {
        combo,
        leaves: twigLeaves
      };
      opt.dir = DIR_NEXT;
      const nodes = this._matchCombinator(twig, node, opt);
      if (nodes.size) {
        if (leaves.length) {
          let bool = false;
          for (const nextNode of nodes) {
            bool = this._matchHasPseudoFunc(leaves, nextNode, opt);
            if (bool) {
              break;
            }
          }
          return bool;
        }
        return true;
      }
    }
    return false;
  };
  /**
   * Evaluates the :has() pseudo-class.
   * @private
   * @param {object} astData - The AST data.
   * @param {object} node - The Element node.
   * @param {object} [opt] - Options.
   * @returns {?object} The matched node.
   */
  _evaluateHasPseudo = (astData, node, opt) => {
    const { branches } = astData;
    let bool = false;
    const l = branches.length;
    for (let i = 0; i < l; i++) {
      const leaves = branches[i];
      bool = this._matchHasPseudoFunc(leaves, node, opt);
      if (bool) {
        break;
      }
    }
    if (!bool) {
      return null;
    }
    if ((opt.isShadowRoot || this.#shadow) && node.nodeType === DOCUMENT_FRAGMENT_NODE) {
      return this.#verifyShadowHost ? node : null;
    }
    return node;
  };
  /**
   * Matches logical pseudo-class functions.
   * @private
   * @param {object} astData - The AST data.
   * @param {object} node - The Element node.
   * @param {object} [opt] - Options.
   * @returns {?object} The matched node.
   */
  _matchLogicalPseudoFunc = (astData, node, opt = {}) => {
    const { astName, branches, twigBranches } = astData;
    if (astName === "has") {
      return this._evaluateHasPseudo(astData, node, opt);
    }
    const isShadowRoot = (opt.isShadowRoot || this.#shadow) && node.nodeType === DOCUMENT_FRAGMENT_NODE;
    if (isShadowRoot) {
      let invalid = false;
      for (const branch of branches) {
        if (branch.length > 1) {
          invalid = true;
          break;
        } else if (astName === "not") {
          const [{ type: childAstType }] = branch;
          if (childAstType !== PS_CLASS_SELECTOR) {
            invalid = true;
            break;
          }
        }
      }
      if (invalid) {
        return null;
      }
    }
    opt.forgive = astName === "is" || astName === "where";
    const l = twigBranches.length;
    let bool;
    for (let i = 0; i < l; i++) {
      const branch = twigBranches[i];
      const lastIndex = branch.length - 1;
      const { leaves } = branch[lastIndex];
      bool = this._matchLeaves(leaves, node, opt);
      if (bool && lastIndex > 0) {
        let nextNodes = /* @__PURE__ */ new Set([node]);
        for (let j = lastIndex - 1; j >= 0; j--) {
          const twig = branch[j];
          const arr = [];
          opt.dir = DIR_PREV;
          for (const nextNode of nextNodes) {
            const m = this._matchCombinator(twig, nextNode, opt);
            if (m.size) {
              arr.push(...m);
            }
          }
          if (arr.length) {
            if (j === 0) {
              bool = true;
            } else {
              nextNodes = new Set(arr);
            }
          } else {
            bool = false;
            break;
          }
        }
      }
      if (bool) {
        break;
      }
    }
    if (astName === "not") {
      if (bool) {
        return null;
      }
      return node;
    } else if (bool) {
      return node;
    }
    return null;
  };
  /**
   * match pseudo-class selector
   * @private
   * @see https://html.spec.whatwg.org/#pseudo-classes
   * @param {object} ast - AST
   * @param {object} node - Element node
   * @param {object} [opt] - options
   * @returns {Set.<object>} - collection of matched nodes
   */
  _matchPseudoClassSelector(ast, node, opt = {}) {
    const { children: astChildren, name: astName } = ast;
    const { localName, parentNode } = node;
    const { forgive, warn = this.#warn } = opt;
    const matched = /* @__PURE__ */ new Set();
    if (Array.isArray(astChildren) && KEYS_LOGICAL.has(astName)) {
      if (!astChildren.length && astName !== "is" && astName !== "where") {
        const css = (0, import_css_tree.generate)(ast);
        const msg = `Invalid selector ${css}`;
        return this.onError(generateException(msg, SYNTAX_ERR, this.#window));
      }
      let astData;
      if (this.#astCache.has(ast)) {
        astData = this.#astCache.get(ast);
      } else {
        const { branches } = walkAST(ast);
        if (astName === "has") {
          let forgiven = false;
          const l = astChildren.length;
          for (let i = 0; i < l; i++) {
            const child = astChildren[i];
            const item = (0, import_css_tree.find)(child, findLogicalWithNestedHas);
            if (item) {
              const itemName = item.name;
              if (itemName === "is" || itemName === "where") {
                forgiven = true;
                break;
              } else {
                const css = (0, import_css_tree.generate)(ast);
                const msg = `Invalid selector ${css}`;
                return this.onError(
                  generateException(msg, SYNTAX_ERR, this.#window)
                );
              }
            }
          }
          if (forgiven) {
            return matched;
          }
          astData = {
            astName,
            branches
          };
        } else {
          const twigBranches = [];
          const l = branches.length;
          for (let i = 0; i < l; i++) {
            const [...leaves] = branches[i];
            const branch = [];
            const leavesSet = /* @__PURE__ */ new Set();
            let item = leaves.shift();
            while (item) {
              if (item.type === COMBINATOR) {
                branch.push({
                  combo: item,
                  leaves: [...leavesSet]
                });
                leavesSet.clear();
              } else if (item) {
                leavesSet.add(item);
              }
              if (leaves.length) {
                item = leaves.shift();
              } else {
                branch.push({
                  combo: null,
                  leaves: [...leavesSet]
                });
                leavesSet.clear();
                break;
              }
            }
            twigBranches.push(branch);
          }
          astData = {
            astName,
            branches,
            twigBranches
          };
          this.#astCache.set(ast, astData);
        }
      }
      const res = this._matchLogicalPseudoFunc(astData, node, opt);
      if (res) {
        matched.add(res);
      }
    } else if (Array.isArray(astChildren)) {
      if (/^nth-(?:last-)?(?:child|of-type)$/.test(astName)) {
        if (astChildren.length !== 1) {
          const css = (0, import_css_tree.generate)(ast);
          return this.onError(
            generateException(
              `Invalid selector ${css}`,
              SYNTAX_ERR,
              this.#window
            )
          );
        }
        const [branch] = astChildren;
        const nodes = this._matchAnPlusB(branch, node, astName, opt);
        return nodes;
      } else {
        switch (astName) {
          // :dir()
          case "dir": {
            if (astChildren.length !== 1) {
              const css = (0, import_css_tree.generate)(ast);
              return this.onError(
                generateException(
                  `Invalid selector ${css}`,
                  SYNTAX_ERR,
                  this.#window
                )
              );
            }
            const [astChild] = astChildren;
            const res = matchDirectionPseudoClass(astChild, node);
            if (res) {
              matched.add(node);
            }
            break;
          }
          // :lang()
          case "lang": {
            if (!astChildren.length) {
              const css = (0, import_css_tree.generate)(ast);
              return this.onError(
                generateException(
                  `Invalid selector ${css}`,
                  SYNTAX_ERR,
                  this.#window
                )
              );
            }
            let bool;
            for (const astChild of astChildren) {
              bool = matchLanguagePseudoClass(astChild, node);
              if (bool) {
                break;
              }
            }
            if (bool) {
              matched.add(node);
            }
            break;
          }
          // :state()
          case "state": {
            if (isCustomElement(node)) {
              const [{ value: stateValue }] = astChildren;
              if (stateValue) {
                if (node[stateValue]) {
                  matched.add(node);
                } else {
                  for (const i in node) {
                    const prop = node[i];
                    if (prop instanceof this.#window.ElementInternals) {
                      if (prop?.states?.has(stateValue)) {
                        matched.add(node);
                      }
                      break;
                    }
                  }
                }
              }
            }
            break;
          }
          case "current":
          case "heading":
          case "nth-col":
          case "nth-last-col": {
            if (warn) {
              this.onError(
                generateException(
                  `Unsupported pseudo-class :${astName}()`,
                  NOT_SUPPORTED_ERR,
                  this.#window
                )
              );
            }
            break;
          }
          // Ignore :host() and :host-context().
          case "host":
          case "host-context": {
            break;
          }
          // Deprecated in CSS Selectors 3.
          case "contains": {
            if (warn) {
              this.onError(
                generateException(
                  `Unknown pseudo-class :${astName}()`,
                  NOT_SUPPORTED_ERR,
                  this.#window
                )
              );
            }
            break;
          }
          default: {
            if (!forgive) {
              this.onError(
                generateException(
                  `Unknown pseudo-class :${astName}()`,
                  SYNTAX_ERR,
                  this.#window
                )
              );
            }
          }
        }
      }
    } else if (KEYS_PS_NTH_OF_TYPE.has(astName)) {
      if (node === this.#root) {
        matched.add(node);
      } else if (parentNode) {
        switch (astName) {
          case "first-of-type": {
            const [node1] = this._collectNthOfType(
              {
                a: 0,
                b: 1
              },
              node
            );
            if (node1) {
              matched.add(node1);
            }
            break;
          }
          case "last-of-type": {
            const [node1] = this._collectNthOfType(
              {
                a: 0,
                b: 1,
                reverse: true
              },
              node
            );
            if (node1) {
              matched.add(node1);
            }
            break;
          }
          // 'only-of-type' is handled by default.
          default: {
            const [node1] = this._collectNthOfType(
              {
                a: 0,
                b: 1
              },
              node
            );
            if (node1 === node) {
              const [node2] = this._collectNthOfType(
                {
                  a: 0,
                  b: 1,
                  reverse: true
                },
                node
              );
              if (node2 === node) {
                matched.add(node);
              }
            }
          }
        }
      }
    } else {
      switch (astName) {
        case "disabled":
        case "enabled": {
          const isMatch = matchDisabledPseudoClass(astName, node);
          if (isMatch) {
            matched.add(node);
          }
          break;
        }
        case "read-only":
        case "read-write": {
          const isMatch = matchReadOnlyPseudoClass(astName, node);
          if (isMatch) {
            matched.add(node);
          }
          break;
        }
        case "any-link":
        case "link": {
          if ((localName === "a" || localName === "area") && node.hasAttribute("href")) {
            matched.add(node);
          }
          break;
        }
        case "local-link": {
          if ((localName === "a" || localName === "area") && node.hasAttribute("href")) {
            if (!this.#documentURL) {
              this.#documentURL = new URL(this.#document.URL);
            }
            const { href, origin, pathname } = this.#documentURL;
            const attrURL = new URL(node.getAttribute("href"), href);
            if (attrURL.origin === origin && attrURL.pathname === pathname) {
              matched.add(node);
            }
          }
          break;
        }
        case "visited": {
          break;
        }
        case "hover": {
          const { target, type } = this.#event ?? {};
          if (/^(?:click|mouse(?:down|over|up))$/.test(type) && node.contains(target)) {
            matched.add(node);
          }
          break;
        }
        case "active": {
          const { buttons, target, type } = this.#event ?? {};
          if (type === "mousedown" && buttons & 1 && node.contains(target)) {
            matched.add(node);
          }
          break;
        }
        case "target": {
          if (!this.#documentURL) {
            this.#documentURL = new URL(this.#document.URL);
          }
          const { hash } = this.#documentURL;
          if (node.id && hash === `#${node.id}` && this.#document.contains(node)) {
            matched.add(node);
          }
          break;
        }
        case "target-within": {
          if (!this.#documentURL) {
            this.#documentURL = new URL(this.#document.URL);
          }
          const { hash } = this.#documentURL;
          if (hash) {
            const id = hash.replace(/^#/, "");
            let current = this.#document.getElementById(id);
            while (current) {
              if (current === node) {
                matched.add(node);
                break;
              }
              current = current.parentNode;
            }
          }
          break;
        }
        case "scope": {
          if (this.#node.nodeType === ELEMENT_NODE) {
            if (!this.#shadow && node === this.#node) {
              matched.add(node);
            }
          } else if (node === this.#document.documentElement) {
            matched.add(node);
          }
          break;
        }
        case "focus": {
          if (node === this.#document.activeElement && isFocusableArea(node)) {
            matched.add(node);
          }
          break;
        }
        case "focus-visible": {
          if (node === this.#document.activeElement && isFocusableArea(node)) {
            let bool;
            if (isFocusVisible(node)) {
              bool = true;
            } else if (this.#focus) {
              const { relatedTarget, target: focusTarget } = this.#focus;
              if (focusTarget === node) {
                if (isFocusVisible(relatedTarget)) {
                  bool = true;
                } else if (this.#event) {
                  const {
                    altKey: eventAltKey,
                    ctrlKey: eventCtrlKey,
                    key: eventKey,
                    metaKey: eventMetaKey,
                    target: eventTarget,
                    type: eventType
                  } = this.#event;
                  if (eventTarget === relatedTarget) {
                    if (this.#lastFocusVisible === null) {
                      bool = true;
                    } else if (focusTarget === this.#lastFocusVisible) {
                      bool = true;
                    }
                  } else if (eventKey === "Tab") {
                    if (eventType === "keydown" && eventTarget !== node || eventType === "keyup" && eventTarget === node) {
                      if (eventTarget === focusTarget) {
                        if (this.#lastFocusVisible === null) {
                          bool = true;
                        } else if (eventTarget === this.#lastFocusVisible && relatedTarget === null) {
                          bool = true;
                        }
                      } else {
                        bool = true;
                      }
                    }
                  } else if (eventKey) {
                    if ((eventType === "keydown" || eventType === "keyup") && !eventAltKey && !eventCtrlKey && !eventMetaKey && eventTarget === node) {
                      bool = true;
                    }
                  }
                } else if (relatedTarget === null || relatedTarget === this.#lastFocusVisible) {
                  bool = true;
                }
              }
            }
            if (bool) {
              this.#lastFocusVisible = node;
              matched.add(node);
            } else if (this.#lastFocusVisible === node) {
              this.#lastFocusVisible = null;
            }
          }
          break;
        }
        case "focus-within": {
          let bool;
          let current = this.#document.activeElement;
          if (isFocusableArea(current)) {
            while (current) {
              if (current === node) {
                bool = true;
                break;
              }
              current = current.parentNode;
            }
          }
          if (bool) {
            matched.add(node);
          }
          break;
        }
        case "open":
        case "closed": {
          if (localName === "details" || localName === "dialog") {
            if (node.hasAttribute("open")) {
              if (astName === "open") {
                matched.add(node);
              }
            } else if (astName === "closed") {
              matched.add(node);
            }
          }
          break;
        }
        case "placeholder-shown": {
          let placeholder;
          if (node.placeholder) {
            placeholder = node.placeholder;
          } else if (node.hasAttribute("placeholder")) {
            placeholder = node.getAttribute("placeholder");
          }
          if (typeof placeholder === "string" && !/[\r\n]/.test(placeholder)) {
            let targetNode;
            if (localName === "textarea") {
              targetNode = node;
            } else if (localName === "input") {
              if (node.hasAttribute("type")) {
                if (KEYS_INPUT_PLACEHOLDER.has(node.getAttribute("type"))) {
                  targetNode = node;
                }
              } else {
                targetNode = node;
              }
            }
            if (targetNode && node.value === "") {
              matched.add(node);
            }
          }
          break;
        }
        case "checked": {
          const attrType = node.getAttribute("type");
          if (node.checked && localName === "input" && (attrType === "checkbox" || attrType === "radio") || node.selected && localName === "option") {
            matched.add(node);
          }
          break;
        }
        case "indeterminate": {
          if (node.indeterminate && localName === "input" && node.type === "checkbox" || localName === "progress" && !node.hasAttribute("value")) {
            matched.add(node);
          } else if (localName === "input" && node.type === "radio" && !node.hasAttribute("checked")) {
            const nodeName = node.name;
            let parent = node.parentNode;
            while (parent) {
              if (parent.localName === "form") {
                break;
              }
              parent = parent.parentNode;
            }
            if (!parent) {
              parent = this.#document.documentElement;
            }
            const walker = this._createTreeWalker(parent);
            let refNode = traverseNode(parent, walker);
            refNode = walker.firstChild();
            let checked;
            while (refNode) {
              if (refNode.localName === "input" && refNode.getAttribute("type") === "radio") {
                if (refNode.hasAttribute("name")) {
                  if (refNode.getAttribute("name") === nodeName) {
                    checked = !!refNode.checked;
                  }
                } else {
                  checked = !!refNode.checked;
                }
                if (checked) {
                  break;
                }
              }
              refNode = walker.nextNode();
            }
            if (!checked) {
              matched.add(node);
            }
          }
          break;
        }
        case "default": {
          const attrType = node.getAttribute("type");
          if (localName === "button" && !(node.hasAttribute("type") && KEYS_INPUT_RESET.has(attrType)) || localName === "input" && node.hasAttribute("type") && KEYS_INPUT_SUBMIT.has(attrType)) {
            let form = node.parentNode;
            while (form) {
              if (form.localName === "form") {
                break;
              }
              form = form.parentNode;
            }
            if (form) {
              const walker = this._createTreeWalker(form);
              let refNode = traverseNode(form, walker);
              refNode = walker.firstChild();
              while (refNode) {
                const nodeName = refNode.localName;
                const nodeAttrType = refNode.getAttribute("type");
                let m;
                if (nodeName === "button") {
                  m = !(refNode.hasAttribute("type") && KEYS_INPUT_RESET.has(nodeAttrType));
                } else if (nodeName === "input") {
                  m = refNode.hasAttribute("type") && KEYS_INPUT_SUBMIT.has(nodeAttrType);
                }
                if (m) {
                  if (refNode === node) {
                    matched.add(node);
                  }
                  break;
                }
                refNode = walker.nextNode();
              }
            }
          } else if (localName === "input" && node.hasAttribute("type") && node.hasAttribute("checked") && KEYS_INPUT_CHECK.has(attrType)) {
            matched.add(node);
          } else if (localName === "option" && node.hasAttribute("selected")) {
            matched.add(node);
          }
          break;
        }
        case "valid":
        case "invalid": {
          if (KEYS_FORM_PS_VALID.has(localName)) {
            let valid;
            if (node.checkValidity()) {
              if (node.maxLength >= 0) {
                if (node.maxLength >= node.value.length) {
                  valid = true;
                }
              } else {
                valid = true;
              }
            }
            if (valid) {
              if (astName === "valid") {
                matched.add(node);
              }
            } else if (astName === "invalid") {
              matched.add(node);
            }
          } else if (localName === "fieldset") {
            const walker = this._createTreeWalker(node);
            let refNode = traverseNode(node, walker);
            refNode = walker.firstChild();
            let valid;
            if (!refNode) {
              valid = true;
            } else {
              while (refNode) {
                if (KEYS_FORM_PS_VALID.has(refNode.localName)) {
                  if (refNode.checkValidity()) {
                    if (refNode.maxLength >= 0) {
                      valid = refNode.maxLength >= refNode.value.length;
                    } else {
                      valid = true;
                    }
                  } else {
                    valid = false;
                  }
                  if (!valid) {
                    break;
                  }
                }
                refNode = walker.nextNode();
              }
            }
            if (valid) {
              if (astName === "valid") {
                matched.add(node);
              }
            } else if (astName === "invalid") {
              matched.add(node);
            }
          }
          break;
        }
        case "in-range":
        case "out-of-range": {
          const attrType = node.getAttribute("type");
          if (localName === "input" && !(node.readonly || node.hasAttribute("readonly")) && !(node.disabled || node.hasAttribute("disabled")) && KEYS_INPUT_RANGE.has(attrType)) {
            const flowed = node.validity.rangeUnderflow || node.validity.rangeOverflow;
            if (astName === "out-of-range" && flowed) {
              matched.add(node);
            } else if (astName === "in-range" && !flowed && (node.hasAttribute("min") || node.hasAttribute("max") || attrType === "range")) {
              matched.add(node);
            }
          }
          break;
        }
        case "required":
        case "optional": {
          let required;
          let optional;
          if (localName === "select" || localName === "textarea") {
            if (node.required || node.hasAttribute("required")) {
              required = true;
            } else {
              optional = true;
            }
          } else if (localName === "input") {
            if (node.hasAttribute("type")) {
              const attrType = node.getAttribute("type");
              if (KEYS_INPUT_REQUIRED.has(attrType)) {
                if (node.required || node.hasAttribute("required")) {
                  required = true;
                } else {
                  optional = true;
                }
              } else {
                optional = true;
              }
            } else if (node.required || node.hasAttribute("required")) {
              required = true;
            } else {
              optional = true;
            }
          }
          if (astName === "required" && required) {
            matched.add(node);
          } else if (astName === "optional" && optional) {
            matched.add(node);
          }
          break;
        }
        case "root": {
          if (node === this.#document.documentElement) {
            matched.add(node);
          }
          break;
        }
        case "empty": {
          if (node.hasChildNodes()) {
            const walker = this._createTreeWalker(node, {
              force: true,
              whatToShow: SHOW_ALL
            });
            let refNode = walker.firstChild();
            let bool;
            while (refNode) {
              bool = refNode.nodeType !== ELEMENT_NODE && refNode.nodeType !== TEXT_NODE;
              if (!bool) {
                break;
              }
              refNode = walker.nextSibling();
            }
            if (bool) {
              matched.add(node);
            }
          } else {
            matched.add(node);
          }
          break;
        }
        case "first-child": {
          if (parentNode && node === parentNode.firstElementChild || node === this.#root) {
            matched.add(node);
          }
          break;
        }
        case "last-child": {
          if (parentNode && node === parentNode.lastElementChild || node === this.#root) {
            matched.add(node);
          }
          break;
        }
        case "only-child": {
          if (parentNode && node === parentNode.firstElementChild && node === parentNode.lastElementChild || node === this.#root) {
            matched.add(node);
          }
          break;
        }
        case "defined": {
          if (node.hasAttribute("is") || localName.includes("-")) {
            if (isCustomElement(node)) {
              matched.add(node);
            }
          } else if (node instanceof this.#window.HTMLElement || node instanceof this.#window.SVGElement) {
            matched.add(node);
          }
          break;
        }
        case "popover-open": {
          if (node.popover && isVisible(node)) {
            matched.add(node);
          }
          break;
        }
        // Ignore :host.
        case "host": {
          break;
        }
        // Legacy pseudo-elements.
        case "after":
        case "before":
        case "first-letter":
        case "first-line": {
          if (warn) {
            this.onError(
              generateException(
                `Unsupported pseudo-element ::${astName}`,
                NOT_SUPPORTED_ERR,
                this.#window
              )
            );
          }
          break;
        }
        // Not supported.
        case "autofill":
        case "blank":
        case "buffering":
        case "current":
        case "fullscreen":
        case "future":
        case "has-slotted":
        case "heading":
        case "modal":
        case "muted":
        case "past":
        case "paused":
        case "picture-in-picture":
        case "playing":
        case "seeking":
        case "stalled":
        case "user-invalid":
        case "user-valid":
        case "volume-locked":
        case "-webkit-autofill": {
          if (warn) {
            this.onError(
              generateException(
                `Unsupported pseudo-class :${astName}`,
                NOT_SUPPORTED_ERR,
                this.#window
              )
            );
          }
          break;
        }
        default: {
          if (astName.startsWith("-webkit-")) {
            if (warn) {
              this.onError(
                generateException(
                  `Unsupported pseudo-class :${astName}`,
                  NOT_SUPPORTED_ERR,
                  this.#window
                )
              );
            }
          } else if (!forgive) {
            this.onError(
              generateException(
                `Unknown pseudo-class :${astName}`,
                SYNTAX_ERR,
                this.#window
              )
            );
          }
        }
      }
    }
    return matched;
  }
  /**
   * Evaluates the :host() pseudo-class.
   * @private
   * @param {Array.<object>} leaves - The AST leaves.
   * @param {object} host - The host element.
   * @param {object} ast - The original AST for error reporting.
   * @returns {boolean} True if matched.
   */
  _evaluateHostPseudo = (leaves, host, ast) => {
    const l = leaves.length;
    for (let i = 0; i < l; i++) {
      const leaf = leaves[i];
      if (leaf.type === COMBINATOR) {
        const css = (0, import_css_tree.generate)(ast);
        const msg = `Invalid selector ${css}`;
        this.onError(generateException(msg, SYNTAX_ERR, this.#window));
        return false;
      }
      if (!this._matchSelector(leaf, host).has(host)) {
        return false;
      }
    }
    return true;
  };
  /**
   * Evaluates the :host-context() pseudo-class.
   * @private
   * @param {Array.<object>} leaves - The AST leaves.
   * @param {object} host - The host element.
   * @param {object} ast - The original AST for error reporting.
   * @returns {boolean} True if matched.
   */
  _evaluateHostContextPseudo = (leaves, host, ast) => {
    let parent = host;
    while (parent) {
      let bool;
      const l = leaves.length;
      for (let i = 0; i < l; i++) {
        const leaf = leaves[i];
        if (leaf.type === COMBINATOR) {
          const css = (0, import_css_tree.generate)(ast);
          const msg = `Invalid selector ${css}`;
          this.onError(generateException(msg, SYNTAX_ERR, this.#window));
          return false;
        }
        bool = this._matchSelector(leaf, parent).has(parent);
        if (!bool) {
          break;
        }
      }
      if (bool) {
        return true;
      }
      parent = parent.parentNode;
    }
    return false;
  };
  /**
   * Matches shadow host pseudo-classes.
   * @private
   * @param {object} ast - The AST.
   * @param {object} node - The DocumentFragment node.
   * @returns {?object} The matched node.
   */
  _matchShadowHostPseudoClass = (ast, node) => {
    const { children: astChildren, name: astName } = ast;
    if (!Array.isArray(astChildren)) {
      if (astName === "host") {
        return node;
      }
      const msg = `Invalid selector :${astName}`;
      return this.onError(generateException(msg, SYNTAX_ERR, this.#window));
    }
    if (astName !== "host" && astName !== "host-context") {
      const msg = `Invalid selector :${astName}()`;
      return this.onError(generateException(msg, SYNTAX_ERR, this.#window));
    }
    if (astChildren.length !== 1) {
      const css = (0, import_css_tree.generate)(ast);
      const msg = `Invalid selector ${css}`;
      return this.onError(generateException(msg, SYNTAX_ERR, this.#window));
    }
    const { host } = node;
    const { branches } = walkAST(astChildren[0]);
    const [branch] = branches;
    const [...leaves] = branch;
    let isMatch = false;
    if (astName === "host") {
      isMatch = this._evaluateHostPseudo(leaves, host, ast);
    } else {
      isMatch = this._evaluateHostContextPseudo(leaves, host, ast);
    }
    return isMatch ? node : null;
  };
  /**
   * Matches a selector for element nodes.
   * @private
   * @param {object} ast - The AST.
   * @param {object} node - The Element node.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _matchSelectorForElement = (ast, node, opt = {}) => {
    const { type: astType } = ast;
    const astName = unescapeSelector(ast.name);
    const matched = /* @__PURE__ */ new Set();
    switch (astType) {
      case ATTR_SELECTOR: {
        if (matchAttributeSelector(ast, node, opt)) {
          matched.add(node);
        }
        break;
      }
      case ID_SELECTOR: {
        if (node.id === astName) {
          matched.add(node);
        }
        break;
      }
      case CLASS_SELECTOR: {
        if (node.classList.contains(astName)) {
          matched.add(node);
        }
        break;
      }
      case PS_CLASS_SELECTOR: {
        return this._matchPseudoClassSelector(ast, node, opt);
      }
      case TYPE_SELECTOR: {
        if (matchTypeSelector(ast, node, opt)) {
          matched.add(node);
        }
        break;
      }
      // PS_ELEMENT_SELECTOR is handled by default.
      default: {
        try {
          if (opt.check) {
            const css = (0, import_css_tree.generate)(ast);
            this.#pseudoElement.push(css);
            matched.add(node);
          } else {
            matchPseudoElementSelector(astName, astType, opt);
          }
        } catch (e) {
          this.onError(e);
        }
      }
    }
    return matched;
  };
  /**
   * Matches a selector for a shadow root.
   * @private
   * @param {object} ast - The AST.
   * @param {object} node - The DocumentFragment node.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _matchSelectorForShadowRoot = (ast, node, opt = {}) => {
    const { name: astName } = ast;
    if (KEYS_LOGICAL.has(astName)) {
      opt.isShadowRoot = true;
      return this._matchPseudoClassSelector(ast, node, opt);
    }
    const matched = /* @__PURE__ */ new Set();
    if (astName === "host" || astName === "host-context") {
      const res = this._matchShadowHostPseudoClass(ast, node, opt);
      if (res) {
        this.#verifyShadowHost = true;
        matched.add(res);
      }
    }
    return matched;
  };
  /**
   * Matches a selector.
   * @private
   * @param {object} ast - The AST.
   * @param {object} node - The Document, DocumentFragment, or Element node.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _matchSelector = (ast, node, opt = {}) => {
    if (node.nodeType === ELEMENT_NODE) {
      return this._matchSelectorForElement(ast, node, opt);
    }
    if (this.#shadow && node.nodeType === DOCUMENT_FRAGMENT_NODE && ast.type === PS_CLASS_SELECTOR) {
      return this._matchSelectorForShadowRoot(ast, node, opt);
    }
    return /* @__PURE__ */ new Set();
  };
  /**
   * Matches leaves.
   * @private
   * @param {Array.<object>} leaves - The AST leaves.
   * @param {object} node - The node.
   * @param {object} [opt] - Options.
   * @returns {boolean} The result.
   */
  _matchLeaves = (leaves, node, opt = {}) => {
    const results = this.#invalidate ? this.#invalidateResults : this.#results;
    let result = results.get(leaves);
    if (result && result.has(node)) {
      const { matched } = result.get(node);
      return matched;
    }
    let cacheable = true;
    if (node.nodeType === ELEMENT_NODE && KEYS_FORM.has(node.localName)) {
      cacheable = false;
    }
    let bool;
    const l = leaves.length;
    for (let i = 0; i < l; i++) {
      const leaf = leaves[i];
      switch (leaf.type) {
        case ATTR_SELECTOR:
        case ID_SELECTOR: {
          cacheable = false;
          break;
        }
        case PS_CLASS_SELECTOR: {
          if (KEYS_PS_UNCACHE.has(leaf.name)) {
            cacheable = false;
          }
          break;
        }
        default: {
        }
      }
      bool = this._matchSelector(leaf, node, opt).has(node);
      if (!bool) {
        break;
      }
    }
    if (cacheable) {
      if (!result) {
        result = /* @__PURE__ */ new WeakMap();
      }
      result.set(node, {
        matched: bool
      });
      results.set(leaves, result);
    }
    return bool;
  };
  /**
   * Traverses all descendant nodes and collects matches.
   * @private
   * @param {object} baseNode - The base Element node or Element.shadowRoot.
   * @param {Array.<object>} leaves - The AST leaves.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _traverseAllDescendants = (baseNode, leaves, opt = {}) => {
    const walker = this._createTreeWalker(baseNode);
    traverseNode(baseNode, walker);
    let currentNode = walker.firstChild();
    const nodes = /* @__PURE__ */ new Set();
    while (currentNode) {
      if (this._matchLeaves(leaves, currentNode, opt)) {
        nodes.add(currentNode);
      }
      currentNode = walker.nextNode();
    }
    return nodes;
  };
  /**
   * Finds descendant nodes.
   * @private
   * @param {Array.<object>} leaves - The AST leaves.
   * @param {object} baseNode - The base Element node or Element.shadowRoot.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _findDescendantNodes = (leaves, baseNode, opt = {}) => {
    const [leaf, ...filterLeaves] = leaves;
    const { type: leafType } = leaf;
    switch (leafType) {
      case ID_SELECTOR: {
        const canUseGetElementById = !this.#shadow && baseNode.nodeType === ELEMENT_NODE && this.#root.nodeType !== ELEMENT_NODE;
        if (canUseGetElementById) {
          const leafName = unescapeSelector(leaf.name);
          const nodes = /* @__PURE__ */ new Set();
          const foundNode = this.#root.getElementById(leafName);
          if (foundNode && foundNode !== baseNode && baseNode.contains(foundNode)) {
            const isCompoundSelector = filterLeaves.length > 0;
            if (!isCompoundSelector || this._matchLeaves(filterLeaves, foundNode, opt)) {
              nodes.add(foundNode);
            }
          }
          return nodes;
        }
        return this._traverseAllDescendants(baseNode, leaves, opt);
      }
      case PS_ELEMENT_SELECTOR: {
        const leafName = unescapeSelector(leaf.name);
        matchPseudoElementSelector(leafName, leafType, opt);
        return /* @__PURE__ */ new Set();
      }
      default: {
        return this._traverseAllDescendants(baseNode, leaves, opt);
      }
    }
  };
  /**
   * Matches the descendant combinator ' '.
   * @private
   * @param {object} twig - The twig object.
   * @param {object} node - The Element node.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _matchDescendantCombinator = (twig, node, opt = {}) => {
    const { leaves } = twig;
    const { parentNode } = node;
    const { dir } = opt;
    if (dir === DIR_NEXT) {
      return this._findDescendantNodes(leaves, node, opt);
    }
    const ancestors = [];
    let refNode = parentNode;
    while (refNode) {
      if (this._matchLeaves(leaves, refNode, opt)) {
        ancestors.push(refNode);
      }
      refNode = refNode.parentNode;
    }
    if (ancestors.length) {
      return new Set(ancestors.reverse());
    }
    return /* @__PURE__ */ new Set();
  };
  /**
   * Matches the child combinator '>'.
   * @private
   * @param {object} twig - The twig object.
   * @param {object} node - The Element node.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _matchChildCombinator = (twig, node, opt = {}) => {
    const { leaves } = twig;
    const { dir } = opt;
    const { parentNode } = node;
    const matched = /* @__PURE__ */ new Set();
    if (dir === DIR_NEXT) {
      let refNode = node.firstElementChild;
      while (refNode) {
        if (this._matchLeaves(leaves, refNode, opt)) {
          matched.add(refNode);
        }
        refNode = refNode.nextElementSibling;
      }
    } else {
      if (parentNode && this._matchLeaves(leaves, parentNode, opt)) {
        matched.add(parentNode);
      }
    }
    return matched;
  };
  /**
   * Matches the adjacent sibling combinator '+'.
   * @private
   * @param {object} twig - The twig object.
   * @param {object} node - The Element node.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _matchAdjacentSiblingCombinator = (twig, node, opt = {}) => {
    const { leaves } = twig;
    const { dir } = opt;
    const matched = /* @__PURE__ */ new Set();
    const refNode = dir === DIR_NEXT ? node.nextElementSibling : node.previousElementSibling;
    if (refNode && this._matchLeaves(leaves, refNode, opt)) {
      matched.add(refNode);
    }
    return matched;
  };
  /**
   * Matches the general sibling combinator '~'.
   * @private
   * @param {object} twig - The twig object.
   * @param {object} node - The Element node.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _matchGeneralSiblingCombinator = (twig, node, opt = {}) => {
    const { leaves } = twig;
    const { dir } = opt;
    const matched = /* @__PURE__ */ new Set();
    let refNode = dir === DIR_NEXT ? node.nextElementSibling : node.previousElementSibling;
    while (refNode) {
      if (this._matchLeaves(leaves, refNode, opt)) {
        matched.add(refNode);
      }
      refNode = dir === DIR_NEXT ? refNode.nextElementSibling : refNode.previousElementSibling;
    }
    return matched;
  };
  /**
   * Matches a combinator.
   * @private
   * @param {object} twig - The twig object.
   * @param {object} node - The Element node.
   * @param {object} [opt] - Options.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  _matchCombinator = (twig, node, opt = {}) => {
    const {
      combo: { name: comboName }
    } = twig;
    switch (comboName) {
      case "+": {
        return this._matchAdjacentSiblingCombinator(twig, node, opt);
      }
      case "~": {
        return this._matchGeneralSiblingCombinator(twig, node, opt);
      }
      case ">": {
        return this._matchChildCombinator(twig, node, opt);
      }
      case " ":
      default: {
        return this._matchDescendantCombinator(twig, node, opt);
      }
    }
  };
  /**
   * Traverses with a TreeWalker and collects nodes matching the leaves.
   * @private
   * @param {TreeWalker} walker - The TreeWalker instance to use.
   * @param {Array} leaves - The AST leaves to match against.
   * @param {object} options - Traversal options.
   * @param {Node} options.startNode - The node to start traversal from.
   * @param {string} options.targetType - The type of target ('all' or 'first').
   * @param {Node} [options.boundaryNode] - The node to stop traversal at.
   * @param {boolean} [options.force] - Force traversal to the next node.
   * @returns {Array.<Node>} An array of matched nodes.
   */
  _traverseAndCollectNodes = (walker, leaves, options) => {
    const { boundaryNode, force, startNode, targetType } = options;
    const collectedNodes = [];
    let currentNode = traverseNode(startNode, walker, !!force);
    if (!currentNode) {
      return [];
    }
    if (currentNode.nodeType !== ELEMENT_NODE) {
      currentNode = walker.nextNode();
    } else if (currentNode === startNode && currentNode !== this.#root) {
      currentNode = walker.nextNode();
    }
    const matchOpt = {
      warn: this.#warn
    };
    while (currentNode) {
      if (boundaryNode) {
        if (currentNode === boundaryNode) {
          break;
        } else if (targetType === TARGET_ALL && !boundaryNode.contains(currentNode)) {
          break;
        }
      }
      if (this._matchLeaves(leaves, currentNode, matchOpt) && currentNode !== this.#node) {
        collectedNodes.push(currentNode);
        if (targetType !== TARGET_ALL) {
          break;
        }
      }
      currentNode = walker.nextNode();
    }
    return collectedNodes;
  };
  /**
   * Finds matched node(s) preceding this.#node.
   * @private
   * @param {Array.<object>} leaves - The AST leaves.
   * @param {object} node - The node to start from.
   * @param {object} opt - Options.
   * @param {boolean} [opt.force] - If true, traverses only to the next node.
   * @param {string} [opt.targetType] - The target type.
   * @returns {Array.<object>} A collection of matched nodes.
   */
  _findPrecede = (leaves, node, opt = {}) => {
    const { force, targetType } = opt;
    if (!this.#rootWalker) {
      this.#rootWalker = this._createTreeWalker(this.#root);
    }
    return this._traverseAndCollectNodes(this.#rootWalker, leaves, {
      force,
      targetType,
      boundaryNode: this.#node,
      startNode: node
    });
  };
  /**
   * Finds matched node(s) in #nodeWalker.
   * @private
   * @param {Array.<object>} leaves - The AST leaves.
   * @param {object} node - The node to start from.
   * @param {object} opt - Options.
   * @param {boolean} [opt.precede] - If true, finds preceding nodes.
   * @returns {Array.<object>} A collection of matched nodes.
   */
  _findNodeWalker = (leaves, node, opt = {}) => {
    const { precede, ...traversalOpts } = opt;
    if (precede) {
      const precedeNodes = this._findPrecede(leaves, this.#root, opt);
      if (precedeNodes.length) {
        return precedeNodes;
      }
    }
    if (!this.#nodeWalker) {
      this.#nodeWalker = this._createTreeWalker(this.#node);
    }
    return this._traverseAndCollectNodes(this.#nodeWalker, leaves, {
      startNode: node,
      ...traversalOpts
    });
  };
  /**
   * Matches the node itself.
   * @private
   * @param {Array} leaves - The AST leaves.
   * @param {boolean} check - Indicates if running in internal check().
   * @returns {Array} An array containing [nodes, filtered, pseudoElement].
   */
  _matchSelf = (leaves, check = false) => {
    const options = { check, warn: this.#warn };
    const matched = this._matchLeaves(leaves, this.#node, options);
    const nodes = matched ? [this.#node] : [];
    return [nodes, matched, this.#pseudoElement];
  };
  /**
   * Finds lineal nodes (self and ancestors).
   * @private
   * @param {Array} leaves - The AST leaves.
   * @param {object} opt - Options.
   * @returns {Array} An array containing [nodes, filtered].
   */
  _findLineal = (leaves, opt) => {
    const { complex } = opt;
    const nodes = [];
    const options = { warn: this.#warn };
    const selfMatched = this._matchLeaves(leaves, this.#node, options);
    if (selfMatched) {
      nodes.push(this.#node);
    }
    if (!selfMatched || complex) {
      let currentNode = this.#node.parentNode;
      while (currentNode) {
        if (this._matchLeaves(leaves, currentNode, options)) {
          nodes.push(currentNode);
        }
        currentNode = currentNode.parentNode;
      }
    }
    const filtered = nodes.length > 0;
    return [nodes, filtered];
  };
  /**
   * Finds entry nodes for pseudo-element selectors.
   * @private
   * @param {object} leaf - The pseudo-element leaf from the AST.
   * @param {Array.<object>} filterLeaves - Leaves for compound selectors.
   * @param {string} targetType - The type of target to find.
   * @returns {object} The result { nodes, filtered, pending }.
   */
  _findEntryNodesForPseudoElement = (leaf, filterLeaves, targetType) => {
    let nodes = [];
    let filtered = false;
    if (targetType === TARGET_SELF && this.#check) {
      const css = (0, import_css_tree.generate)(leaf);
      this.#pseudoElement.push(css);
      if (filterLeaves.length) {
        [nodes, filtered] = this._matchSelf(filterLeaves, this.#check);
      } else {
        nodes.push(this.#node);
        filtered = true;
      }
    } else {
      matchPseudoElementSelector(leaf.name, leaf.type, { warn: this.#warn });
    }
    return { nodes, filtered, pending: false };
  };
  /**
   * Finds entry nodes for ID selectors.
   * @private
   * @param {object} twig - The current twig from the AST branch.
   * @param {string} targetType - The type of target to find.
   * @param {object} opt - Additional options for finding nodes.
   * @returns {object} The result { nodes, filtered, pending }.
   */
  _findEntryNodesForId = (twig, targetType, opt) => {
    const { leaves } = twig;
    const [leaf, ...filterLeaves] = leaves;
    const { complex, precede } = opt;
    let nodes = [];
    let filtered = false;
    if (targetType === TARGET_SELF) {
      [nodes, filtered] = this._matchSelf(leaves);
    } else if (targetType === TARGET_LINEAL) {
      [nodes, filtered] = this._findLineal(leaves, { complex });
    } else if (targetType === TARGET_FIRST && this.#root.nodeType !== ELEMENT_NODE) {
      const node = this.#root.getElementById(leaf.name);
      if (node) {
        if (filterLeaves.length) {
          if (this._matchLeaves(filterLeaves, node, { warn: this.#warn })) {
            nodes.push(node);
            filtered = true;
          }
        } else {
          nodes.push(node);
          filtered = true;
        }
      }
    } else {
      nodes = this._findNodeWalker(leaves, this.#node, { precede, targetType });
      filtered = nodes.length > 0;
    }
    return { nodes, filtered, pending: false };
  };
  /**
   * Finds entry nodes for class selectors.
   * @private
   * @param {Array.<object>} leaves - The AST leaves for the selector.
   * @param {string} targetType - The type of target to find.
   * @param {object} opt - Additional options for finding nodes.
   * @returns {object} The result { nodes, filtered, pending }.
   */
  _findEntryNodesForClass = (leaves, targetType, opt) => {
    const { complex, precede } = opt;
    let nodes = [];
    let filtered = false;
    if (targetType === TARGET_SELF) {
      [nodes, filtered] = this._matchSelf(leaves);
    } else if (targetType === TARGET_LINEAL) {
      [nodes, filtered] = this._findLineal(leaves, { complex });
    } else {
      nodes = this._findNodeWalker(leaves, this.#node, { precede, targetType });
      filtered = nodes.length > 0;
    }
    return { nodes, filtered, pending: false };
  };
  /**
   * Finds entry nodes for type selectors.
   * @private
   * @param {Array.<object>} leaves - The AST leaves for the selector.
   * @param {string} targetType - The type of target to find.
   * @param {object} opt - Additional options for finding nodes.
   * @returns {object} The result { nodes, filtered, pending }.
   */
  _findEntryNodesForType = (leaves, targetType, opt) => {
    const { complex, precede } = opt;
    let nodes = [];
    let filtered = false;
    if (targetType === TARGET_SELF) {
      [nodes, filtered] = this._matchSelf(leaves);
    } else if (targetType === TARGET_LINEAL) {
      [nodes, filtered] = this._findLineal(leaves, { complex });
    } else {
      nodes = this._findNodeWalker(leaves, this.#node, { precede, targetType });
      filtered = nodes.length > 0;
    }
    return { nodes, filtered, pending: false };
  };
  /**
   * Finds entry nodes for other selector types (default case).
   * @private
   * @param {object} twig - The current twig from the AST branch.
   * @param {string} targetType - The type of target to find.
   * @param {object} opt - Additional options for finding nodes.
   * @returns {object} The result { nodes, filtered, pending }.
   */
  _findEntryNodesForOther = (twig, targetType, opt) => {
    const { leaves } = twig;
    const [leaf, ...filterLeaves] = leaves;
    const { complex, precede } = opt;
    let nodes = [];
    let filtered = false;
    let pending = false;
    if (targetType !== TARGET_LINEAL && /host(?:-context)?/.test(leaf.name)) {
      let shadowRoot = null;
      if (this.#shadow && this.#node.nodeType === DOCUMENT_FRAGMENT_NODE) {
        shadowRoot = this._matchShadowHostPseudoClass(leaf, this.#node);
      } else if (filterLeaves.length && this.#node.nodeType === ELEMENT_NODE) {
        shadowRoot = this._matchShadowHostPseudoClass(
          leaf,
          this.#node.shadowRoot
        );
      }
      if (shadowRoot) {
        let bool = true;
        const l = filterLeaves.length;
        for (let i = 0; i < l; i++) {
          const filterLeaf = filterLeaves[i];
          switch (filterLeaf.name) {
            case "host":
            case "host-context": {
              const matchedNode = this._matchShadowHostPseudoClass(
                filterLeaf,
                shadowRoot
              );
              bool = matchedNode === shadowRoot;
              break;
            }
            case "has": {
              bool = this._matchPseudoClassSelector(
                filterLeaf,
                shadowRoot,
                {}
              ).has(shadowRoot);
              break;
            }
            default: {
              bool = false;
            }
          }
          if (!bool) {
            break;
          }
        }
        if (bool) {
          nodes.push(shadowRoot);
          filtered = true;
        }
      }
    } else if (targetType === TARGET_SELF) {
      [nodes, filtered] = this._matchSelf(leaves);
    } else if (targetType === TARGET_LINEAL) {
      [nodes, filtered] = this._findLineal(leaves, { complex });
    } else if (targetType === TARGET_FIRST) {
      nodes = this._findNodeWalker(leaves, this.#node, { precede, targetType });
      filtered = nodes.length > 0;
    } else {
      pending = true;
    }
    return { nodes, filtered, pending };
  };
  /**
   * Finds entry nodes.
   * @private
   * @param {object} twig - The twig object.
   * @param {string} targetType - The target type.
   * @param {object} [opt] - Options.
   * @param {boolean} [opt.complex] - If true, the selector is complex.
   * @param {string} [opt.dir] - The find direction.
   * @returns {object} An object with nodes and their state.
   */
  _findEntryNodes = (twig, targetType, opt = {}) => {
    const { leaves } = twig;
    const [leaf, ...filterLeaves] = leaves;
    const { complex = false, dir = DIR_PREV } = opt;
    const precede = dir === DIR_NEXT && this.#node.nodeType === ELEMENT_NODE && this.#node !== this.#root;
    let result;
    switch (leaf.type) {
      case PS_ELEMENT_SELECTOR: {
        result = this._findEntryNodesForPseudoElement(
          leaf,
          filterLeaves,
          targetType
        );
        break;
      }
      case ID_SELECTOR: {
        result = this._findEntryNodesForId(twig, targetType, {
          complex,
          precede
        });
        break;
      }
      case CLASS_SELECTOR: {
        result = this._findEntryNodesForClass(leaves, targetType, {
          complex,
          precede
        });
        break;
      }
      case TYPE_SELECTOR: {
        result = this._findEntryNodesForType(leaves, targetType, {
          complex,
          precede
        });
        break;
      }
      default: {
        result = this._findEntryNodesForOther(twig, targetType, {
          complex,
          precede
        });
      }
    }
    return {
      compound: filterLeaves.length > 0,
      filtered: result.filtered,
      nodes: result.nodes,
      pending: result.pending
    };
  };
  /**
   * Determines the direction and starting twig for a selector branch.
   * @private
   * @param {Array.<object>} branch - The AST branch.
   * @param {string} targetType - The type of target to find.
   * @returns {object} An object with the direction and starting twig.
   */
  _determineTraversalStrategy = (branch, targetType) => {
    const branchLen = branch.length;
    const firstTwig = branch[0];
    const lastTwig = branch[branchLen - 1];
    if (branchLen === 1) {
      return { dir: DIR_PREV, twig: firstTwig };
    }
    const {
      leaves: [{ name: firstName, type: firstType }]
    } = firstTwig;
    const {
      leaves: [{ name: lastName, type: lastType }]
    } = lastTwig;
    const { combo: firstCombo } = firstTwig;
    if (this.#selector.includes(":scope") || lastType === PS_ELEMENT_SELECTOR || lastType === ID_SELECTOR) {
      return { dir: DIR_PREV, twig: lastTwig };
    }
    if (firstType === ID_SELECTOR) {
      return { dir: DIR_NEXT, twig: firstTwig };
    }
    if (firstName === "*" && firstType === TYPE_SELECTOR) {
      return { dir: DIR_PREV, twig: lastTwig };
    }
    if (lastName === "*" && lastType === TYPE_SELECTOR) {
      return { dir: DIR_NEXT, twig: firstTwig };
    }
    if (branchLen === 2) {
      if (targetType === TARGET_FIRST) {
        return { dir: DIR_PREV, twig: lastTwig };
      }
      const { name: comboName } = firstCombo;
      if (comboName === "+" || comboName === "~") {
        return { dir: DIR_PREV, twig: lastTwig };
      }
    }
    return { dir: DIR_NEXT, twig: firstTwig };
  };
  /**
   * Processes pending items not resolved with a direct strategy.
   * @private
   * @param {Set.<Map>} pendingItems - The set of pending items.
   */
  _processPendingItems = (pendingItems) => {
    if (!pendingItems.size) {
      return;
    }
    if (!this.#rootWalker) {
      this.#rootWalker = this._createTreeWalker(this.#root);
    }
    const isScopedContext = this.#node !== this.#root && this.#node.nodeType === ELEMENT_NODE;
    const walker = this.#rootWalker;
    let node = this.#root;
    if (isScopedContext) {
      node = this.#node;
    }
    let nextNode = traverseNode(node, walker);
    while (nextNode) {
      const isWithinScope = this.#node.nodeType !== ELEMENT_NODE || nextNode === this.#node || this.#node.contains(nextNode);
      if (isWithinScope) {
        for (const pendingItem of pendingItems) {
          const { leaves } = pendingItem.get("twig");
          if (this._matchLeaves(leaves, nextNode, { warn: this.#warn })) {
            const index = pendingItem.get("index");
            this.#ast[index].filtered = true;
            this.#ast[index].find = true;
            this.#nodes[index].push(nextNode);
          }
        }
      } else if (isScopedContext) {
        break;
      }
      nextNode = walker.nextNode();
    }
  };
  /**
   * Collects nodes.
   * @private
   * @param {string} targetType - The target type.
   * @returns {Array.<Array.<object>>} An array containing the AST and nodes.
   */
  _collectNodes = (targetType) => {
    const ast = this.#ast.values();
    if (targetType === TARGET_ALL || targetType === TARGET_FIRST) {
      const pendingItems = /* @__PURE__ */ new Set();
      let i = 0;
      for (const { branch } of ast) {
        const complex = branch.length > 1;
        const { dir, twig } = this._determineTraversalStrategy(
          branch,
          targetType
        );
        const { compound, filtered, nodes, pending } = this._findEntryNodes(
          twig,
          targetType,
          { complex, dir }
        );
        if (nodes.length) {
          this.#ast[i].find = true;
          this.#nodes[i] = nodes;
        } else if (pending) {
          pendingItems.add(
            /* @__PURE__ */ new Map([
              ["index", i],
              ["twig", twig]
            ])
          );
        }
        this.#ast[i].dir = dir;
        this.#ast[i].filtered = filtered || !compound;
        i++;
      }
      this._processPendingItems(pendingItems);
    } else {
      let i = 0;
      for (const { branch } of ast) {
        const twig = branch[branch.length - 1];
        const complex = branch.length > 1;
        const dir = DIR_PREV;
        const { compound, filtered, nodes } = this._findEntryNodes(
          twig,
          targetType,
          { complex, dir }
        );
        if (nodes.length) {
          this.#ast[i].find = true;
          this.#nodes[i] = nodes;
        }
        this.#ast[i].dir = dir;
        this.#ast[i].filtered = filtered || !compound;
        i++;
      }
    }
    return [this.#ast, this.#nodes];
  };
  /**
   * Gets combined nodes.
   * @private
   * @param {object} twig - The twig object.
   * @param {object} nodes - A collection of nodes.
   * @param {string} dir - The direction.
   * @returns {Array.<object>} A collection of matched nodes.
   */
  _getCombinedNodes = (twig, nodes, dir) => {
    const arr = [];
    const options = {
      dir,
      warn: this.#warn
    };
    for (const node of nodes) {
      const matched = this._matchCombinator(twig, node, options);
      if (matched.size) {
        arr.push(...matched);
      }
    }
    return arr;
  };
  /**
   * Matches a node in the 'next' direction.
   * @private
   * @param {Array} branch - The branch.
   * @param {Set.<object>} nodes - A collection of Element nodes.
   * @param {object} opt - Options.
   * @param {object} opt.combo - The combo object.
   * @param {number} opt.index - The index.
   * @returns {?object} The matched node.
   */
  _matchNodeNext = (branch, nodes, opt) => {
    const { combo, index } = opt;
    const { combo: nextCombo, leaves } = branch[index];
    const twig = {
      combo,
      leaves
    };
    const nextNodes = new Set(this._getCombinedNodes(twig, nodes, DIR_NEXT));
    if (nextNodes.size) {
      if (index === branch.length - 1) {
        const [nextNode] = sortNodes(nextNodes);
        return nextNode;
      }
      return this._matchNodeNext(branch, nextNodes, {
        combo: nextCombo,
        index: index + 1
      });
    }
    return null;
  };
  /**
   * Matches a node in the 'previous' direction.
   * @private
   * @param {Array} branch - The branch.
   * @param {object} node - The Element node.
   * @param {object} opt - Options.
   * @param {number} opt.index - The index.
   * @returns {?object} The node.
   */
  _matchNodePrev = (branch, node, opt) => {
    const { index } = opt;
    const twig = branch[index];
    const nodes = /* @__PURE__ */ new Set([node]);
    const nextNodes = new Set(this._getCombinedNodes(twig, nodes, DIR_PREV));
    if (nextNodes.size) {
      if (index === 0) {
        return node;
      }
      let matched;
      for (const nextNode of nextNodes) {
        matched = this._matchNodePrev(branch, nextNode, {
          index: index - 1
        });
        if (matched) {
          break;
        }
      }
      if (matched) {
        return node;
      }
    }
    return null;
  };
  /**
   * Processes a complex selector branch to find all matching nodes.
   * @private
   * @param {Array} branch - The selector branch from the AST.
   * @param {Array} entryNodes - The initial set of nodes to start from.
   * @param {string} dir - The direction of traversal ('next' or 'prev').
   * @returns {Set.<object>} A set of all matched nodes.
   */
  _processComplexBranchAll = (branch, entryNodes, dir) => {
    const matchedNodes = /* @__PURE__ */ new Set();
    const branchLen = branch.length;
    const lastIndex = branchLen - 1;
    if (dir === DIR_NEXT) {
      const { combo: firstCombo } = branch[0];
      for (const node of entryNodes) {
        let combo = firstCombo;
        let nextNodes = /* @__PURE__ */ new Set([node]);
        for (let j = 1; j < branchLen; j++) {
          const { combo: nextCombo, leaves } = branch[j];
          const twig = { combo, leaves };
          const nodesArr = this._getCombinedNodes(twig, nextNodes, dir);
          if (nodesArr.length) {
            if (j === lastIndex) {
              for (const nextNode of nodesArr) {
                matchedNodes.add(nextNode);
              }
            }
            combo = nextCombo;
            nextNodes = new Set(nodesArr);
          } else {
            nextNodes.clear();
            break;
          }
        }
      }
    } else {
      for (const node of entryNodes) {
        let nextNodes = /* @__PURE__ */ new Set([node]);
        for (let j = lastIndex - 1; j >= 0; j--) {
          const twig = branch[j];
          const nodesArr = this._getCombinedNodes(twig, nextNodes, dir);
          if (nodesArr.length) {
            if (j === 0) {
              matchedNodes.add(node);
            }
            nextNodes = new Set(nodesArr);
          } else {
            nextNodes.clear();
            break;
          }
        }
      }
    }
    return matchedNodes;
  };
  /**
   * Find a node contained by this.#node.
   * @private
   * @param {Array} nodesArr - The set of nodes to find from.
   * @returns {?object} The matched node, or null.
   */
  _findChildNodeContainedByNode = (nodesArr) => {
    let matchedNode = null;
    if (Array.isArray(nodesArr)) {
      const l = nodesArr.length;
      for (let i = 0; i < l; i++) {
        const node = nodesArr[i];
        if (this.#node.contains(node)) {
          matchedNode = node;
          break;
        }
      }
    }
    return matchedNode;
  };
  /**
   * Processes a complex selector branch to find the first matching node.
   * @private
   * @param {Array} branch - The selector branch from the AST.
   * @param {Array} entryNodes - The initial set of nodes to start from.
   * @param {string} dir - The direction of traversal ('next' or 'prev').
   * @param {string} targetType - The type of search (e.g., 'first').
   * @returns {?object} The first matched node, or null.
   */
  _processComplexBranchFirst = (branch, entryNodes, dir, targetType) => {
    const branchLen = branch.length;
    const lastIndex = branchLen - 1;
    if (dir === DIR_NEXT) {
      const { combo: entryCombo } = branch[0];
      for (const node of entryNodes) {
        const matchedNode = this._matchNodeNext(branch, /* @__PURE__ */ new Set([node]), {
          combo: entryCombo,
          index: 1
        });
        if (matchedNode) {
          if (this.#node.nodeType === ELEMENT_NODE) {
            if (matchedNode !== this.#node && this.#node.contains(matchedNode)) {
              return matchedNode;
            }
          } else {
            return matchedNode;
          }
        }
      }
      const { leaves: entryLeaves } = branch[0];
      const [entryNode] = entryNodes;
      if (this.#node.contains(entryNode)) {
        let [refNode] = this._findNodeWalker(entryLeaves, entryNode, {
          targetType
        });
        while (refNode) {
          const matchedNode = this._matchNodeNext(branch, /* @__PURE__ */ new Set([refNode]), {
            combo: entryCombo,
            index: 1
          });
          if (matchedNode) {
            if (this.#node.nodeType === ELEMENT_NODE) {
              if (matchedNode !== this.#node && this.#node.contains(matchedNode)) {
                return matchedNode;
              }
            } else {
              return matchedNode;
            }
          }
          [refNode] = this._findNodeWalker(entryLeaves, refNode, {
            targetType,
            force: true
          });
        }
      } else {
        const { combo: firstCombo } = branch[0];
        let combo = firstCombo;
        let nextNodes = /* @__PURE__ */ new Set([entryNode]);
        for (let j = 1; j < branchLen; j++) {
          const { combo: nextCombo, leaves } = branch[j];
          const twig = { combo, leaves };
          const nodesArr = this._getCombinedNodes(twig, nextNodes, dir);
          if (nodesArr.length) {
            if (j === lastIndex) {
              return this._findChildNodeContainedByNode(nodesArr);
            }
            combo = nextCombo;
            nextNodes = new Set(nodesArr);
          } else {
            break;
          }
        }
      }
    } else {
      for (const node of entryNodes) {
        const matchedNode = this._matchNodePrev(branch, node, {
          index: lastIndex - 1
        });
        if (matchedNode) {
          return matchedNode;
        }
      }
      if (targetType === TARGET_FIRST) {
        const { leaves: entryLeaves } = branch[lastIndex];
        const [entryNode] = entryNodes;
        let [refNode] = this._findNodeWalker(entryLeaves, entryNode, {
          targetType
        });
        while (refNode) {
          const matchedNode = this._matchNodePrev(branch, refNode, {
            index: lastIndex - 1
          });
          if (matchedNode) {
            return refNode;
          }
          [refNode] = this._findNodeWalker(entryLeaves, refNode, {
            targetType,
            force: true
          });
        }
      }
    }
    return null;
  };
  /**
   * Finds matched nodes.
   * @param {string} targetType - The target type.
   * @returns {Set.<object>} A collection of matched nodes.
   */
  find = (targetType) => {
    const [[...branches], collectedNodes] = this._collectNodes(targetType);
    const l = branches.length;
    let sort = l > 1 && targetType === TARGET_ALL && this.#selector.includes(":scope");
    let nodes = /* @__PURE__ */ new Set();
    for (let i = 0; i < l; i++) {
      const { branch, dir, find: find3 } = branches[i];
      if (!branch.length || !find3) {
        continue;
      }
      const entryNodes = collectedNodes[i];
      const lastIndex = branch.length - 1;
      if (lastIndex === 0) {
        if ((targetType === TARGET_ALL || targetType === TARGET_FIRST) && this.#node.nodeType === ELEMENT_NODE) {
          for (const node of entryNodes) {
            if (node !== this.#node && this.#node.contains(node)) {
              nodes.add(node);
              if (targetType === TARGET_FIRST) {
                break;
              }
            }
          }
        } else if (targetType === TARGET_ALL) {
          if (nodes.size) {
            for (const node of entryNodes) {
              nodes.add(node);
            }
            sort = true;
          } else {
            nodes = new Set(entryNodes);
          }
        } else {
          if (entryNodes.length) {
            nodes.add(entryNodes[0]);
          }
        }
      } else {
        if (targetType === TARGET_ALL) {
          const newNodes = this._processComplexBranchAll(
            branch,
            entryNodes,
            dir
          );
          if (nodes.size) {
            for (const newNode of newNodes) {
              nodes.add(newNode);
            }
            sort = true;
          } else {
            nodes = newNodes;
          }
        } else {
          const matchedNode = this._processComplexBranchFirst(
            branch,
            entryNodes,
            dir,
            targetType
          );
          if (matchedNode) {
            nodes.add(matchedNode);
          }
        }
      }
    }
    if (this.#check) {
      const match = !!nodes.size;
      let pseudoElement;
      if (this.#pseudoElement.length) {
        pseudoElement = this.#pseudoElement.join("");
      } else {
        pseudoElement = null;
      }
      return { match, pseudoElement };
    }
    if (targetType === TARGET_FIRST || targetType === TARGET_ALL) {
      nodes.delete(this.#node);
    }
    if ((sort || targetType === TARGET_FIRST) && nodes.size > 1) {
      return new Set(sortNodes(nodes));
    }
    return nodes;
  };
};

// src/index.js
var MAX_CACHE = 1024;
var DOMSelector = class {
  /* private fields */
  #window;
  #document;
  #finder;
  #idlUtils;
  #nwsapi;
  #cache;
  /**
   * Creates an instance of DOMSelector.
   * @param {Window} window - The window object.
   * @param {Document} document - The document object.
   * @param {object} [opt] - Options.
   */
  constructor(window, document, opt = {}) {
    const { idlUtils } = opt;
    this.#window = window;
    this.#document = document ?? window.document;
    this.#finder = new Finder(window);
    this.#idlUtils = idlUtils;
    this.#nwsapi = initNwsapi(window, document);
    this.#cache = new import_lru_cache.LRUCache({
      max: MAX_CACHE
    });
  }
  /**
   * Clears the internal cache of finder results.
   * @returns {void}
   */
  clear = () => {
    this.#finder.clearResults(true);
  };
  /**
   * Checks if an element matches a CSS selector.
   * @param {string} selector - The CSS selector to check against.
   * @param {Element} node - The element node to check.
   * @param {object} [opt] - Optional parameters.
   * @returns {CheckResult} An object containing the check result.
   */
  check = (selector, node, opt = {}) => {
    if (!node?.nodeType) {
      const e = new this.#window.TypeError(`Unexpected type ${getType(node)}`);
      return this.#finder.onError(e, opt);
    } else if (node.nodeType !== ELEMENT_NODE) {
      const e = new this.#window.TypeError(`Unexpected node ${node.nodeName}`);
      return this.#finder.onError(e, opt);
    }
    const document = node.ownerDocument;
    if (document === this.#document && document.contentType === "text/html" && document.documentElement && node.parentNode) {
      const cacheKey = `check_${selector}`;
      let filterMatches = false;
      if (this.#cache.has(cacheKey)) {
        filterMatches = this.#cache.get(cacheKey);
      } else {
        filterMatches = filterSelector(selector, TARGET_SELF);
        this.#cache.set(cacheKey, filterMatches);
      }
      if (filterMatches) {
        try {
          const n = this.#idlUtils ? this.#idlUtils.wrapperForImpl(node) : node;
          const match = this.#nwsapi.match(selector, n);
          return {
            match,
            pseudoElement: null
          };
        } catch (e) {
        }
      }
    }
    let res;
    try {
      if (this.#idlUtils) {
        node = this.#idlUtils.wrapperForImpl(node);
      }
      opt.check = true;
      opt.noexept = true;
      opt.warn = false;
      this.#finder.setup(selector, node, opt);
      res = this.#finder.find(TARGET_SELF);
    } catch (e) {
      this.#finder.onError(e, opt);
    }
    return res;
  };
  /**
   * Returns true if the element matches the selector.
   * @param {string} selector - The CSS selector to match against.
   * @param {Element} node - The element node to test.
   * @param {object} [opt] - Optional parameters.
   * @returns {boolean} `true` if the element matches, or `false` otherwise.
   */
  matches = (selector, node, opt = {}) => {
    if (!node?.nodeType) {
      const e = new this.#window.TypeError(`Unexpected type ${getType(node)}`);
      return this.#finder.onError(e, opt);
    } else if (node.nodeType !== ELEMENT_NODE) {
      const e = new this.#window.TypeError(`Unexpected node ${node.nodeName}`);
      return this.#finder.onError(e, opt);
    }
    const document = node.ownerDocument;
    if (document === this.#document && document.contentType === "text/html" && document.documentElement && node.parentNode) {
      const cacheKey = `matches_${selector}`;
      let filterMatches = false;
      if (this.#cache.has(cacheKey)) {
        filterMatches = this.#cache.get(cacheKey);
      } else {
        filterMatches = filterSelector(selector, TARGET_SELF);
        this.#cache.set(cacheKey, filterMatches);
      }
      if (filterMatches) {
        try {
          const n = this.#idlUtils ? this.#idlUtils.wrapperForImpl(node) : node;
          const res2 = this.#nwsapi.match(selector, n);
          return res2;
        } catch (e) {
        }
      }
    }
    let res;
    try {
      if (this.#idlUtils) {
        node = this.#idlUtils.wrapperForImpl(node);
      }
      this.#finder.setup(selector, node, opt);
      const nodes = this.#finder.find(TARGET_SELF);
      res = nodes.size;
    } catch (e) {
      this.#finder.onError(e, opt);
    }
    return !!res;
  };
  /**
   * Traverses up the DOM tree to find the first node that matches the selector.
   * @param {string} selector - The CSS selector to match against.
   * @param {Element} node - The element from which to start traversing.
   * @param {object} [opt] - Optional parameters.
   * @returns {?Element} The first matching ancestor element, or `null`.
   */
  closest = (selector, node, opt = {}) => {
    if (!node?.nodeType) {
      const e = new this.#window.TypeError(`Unexpected type ${getType(node)}`);
      return this.#finder.onError(e, opt);
    } else if (node.nodeType !== ELEMENT_NODE) {
      const e = new this.#window.TypeError(`Unexpected node ${node.nodeName}`);
      return this.#finder.onError(e, opt);
    }
    const document = node.ownerDocument;
    if (document === this.#document && document.contentType === "text/html" && document.documentElement && node.parentNode) {
      const cacheKey = `closest_${selector}`;
      let filterMatches = false;
      if (this.#cache.has(cacheKey)) {
        filterMatches = this.#cache.get(cacheKey);
      } else {
        filterMatches = filterSelector(selector, TARGET_LINEAL);
        this.#cache.set(cacheKey, filterMatches);
      }
      if (filterMatches) {
        try {
          const n = this.#idlUtils ? this.#idlUtils.wrapperForImpl(node) : node;
          const res2 = this.#nwsapi.closest(selector, n);
          return res2;
        } catch (e) {
        }
      }
    }
    let res;
    try {
      if (this.#idlUtils) {
        node = this.#idlUtils.wrapperForImpl(node);
      }
      this.#finder.setup(selector, node, opt);
      const nodes = this.#finder.find(TARGET_LINEAL);
      if (nodes.size) {
        let refNode = node;
        while (refNode) {
          if (nodes.has(refNode)) {
            res = refNode;
            break;
          }
          refNode = refNode.parentNode;
        }
      }
    } catch (e) {
      this.#finder.onError(e, opt);
    }
    return res ?? null;
  };
  /**
   * Returns the first element within the subtree that matches the selector.
   * @param {string} selector - The CSS selector to match.
   * @param {Document|DocumentFragment|Element} node - The node to find within.
   * @param {object} [opt] - Optional parameters.
   * @returns {?Element} The first matching element, or `null`.
   */
  querySelector = (selector, node, opt = {}) => {
    if (!node?.nodeType) {
      const e = new this.#window.TypeError(`Unexpected type ${getType(node)}`);
      return this.#finder.onError(e, opt);
    }
    let res;
    try {
      if (this.#idlUtils) {
        node = this.#idlUtils.wrapperForImpl(node);
      }
      this.#finder.setup(selector, node, opt);
      const nodes = this.#finder.find(TARGET_FIRST);
      if (nodes.size) {
        [res] = [...nodes];
      }
    } catch (e) {
      this.#finder.onError(e, opt);
    }
    return res ?? null;
  };
  /**
   * Returns an array of elements within the subtree that match the selector.
   * Note: This method returns an Array, not a NodeList.
   * @param {string} selector - The CSS selector to match.
   * @param {Document|DocumentFragment|Element} node - The node to find within.
   * @param {object} [opt] - Optional parameters.
   * @returns {Array<Element>} An array of elements, or an empty array.
   */
  querySelectorAll = (selector, node, opt = {}) => {
    if (!node?.nodeType) {
      const e = new this.#window.TypeError(`Unexpected type ${getType(node)}`);
      return this.#finder.onError(e, opt);
    }
    const document = node.nodeType === DOCUMENT_NODE ? node : node.ownerDocument;
    if (document === this.#document && document.contentType === "text/html" && document.documentElement && (node.nodeType !== DOCUMENT_FRAGMENT_NODE || !node.host)) {
      const cacheKey = `querySelectorAll_${selector}`;
      let filterMatches = false;
      if (this.#cache.has(cacheKey)) {
        filterMatches = this.#cache.get(cacheKey);
      } else {
        filterMatches = filterSelector(selector, TARGET_ALL);
        this.#cache.set(cacheKey, filterMatches);
      }
      if (filterMatches) {
        try {
          const n = this.#idlUtils ? this.#idlUtils.wrapperForImpl(node) : node;
          const res2 = this.#nwsapi.select(selector, n);
          return res2;
        } catch (e) {
        }
      }
    }
    let res;
    try {
      if (this.#idlUtils) {
        node = this.#idlUtils.wrapperForImpl(node);
      }
      this.#finder.setup(selector, node, opt);
      const nodes = this.#finder.find(TARGET_ALL);
      if (nodes.size) {
        res = [...nodes];
      }
    } catch (e) {
      this.#finder.onError(e, opt);
    }
    return res ?? [];
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DOMSelector
});
/*!
 * DOM Selector - A CSS selector engine.
 * @license MIT
 * @copyright asamuzaK (Kazz)
 * @see {@link https://github.com/asamuzaK/domSelector/blob/main/LICENSE}
 */
//# sourceMappingURL=index.cjs.map