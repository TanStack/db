//.CommonJS
var CSSOM = {
	CSSRule: require("./CSSRule").CSSRule,
	CSSStyleSheet: require("./CSSStyleSheet").CSSStyleSheet
};
///CommonJS


/**
 * @constructor
 * @see https://drafts.csswg.org/cssom/#the-cssnamespacerule-interface
 */
CSSOM.CSSNamespaceRule = function CSSNamespaceRule() {
	CSSOM.CSSRule.call(this);
	this.__prefix = "";
	this.__namespaceURI = "";
};

CSSOM.CSSNamespaceRule.prototype = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSNamespaceRule.prototype.constructor = CSSOM.CSSNamespaceRule;

Object.setPrototypeOf(CSSOM.CSSNamespaceRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSNamespaceRule.prototype, "type", {
  value: 10,
  writable: false
});

Object.defineProperty(CSSOM.CSSNamespaceRule.prototype, "cssText", {
  get: function() {
    return "@namespace" + (this.prefix && " " + this.prefix) + " url(\"" + this.namespaceURI + "\");";
  }
});

Object.defineProperty(CSSOM.CSSNamespaceRule.prototype, "prefix", {
  get: function() {
    return this.__prefix;
  }
});

Object.defineProperty(CSSOM.CSSNamespaceRule.prototype, "namespaceURI", {
  get: function() {
    return this.__namespaceURI;
  }
});


/**
 * NON-STANDARD
 * Rule text parser.
 * @param {string} cssText
 */
Object.defineProperty(CSSOM.CSSNamespaceRule.prototype, "parse", {
  value: function(cssText) {
    var newPrefix = "";
    var newNamespaceURI = "";

    // Remove @namespace and trim
    var text = cssText.trim();
    if (text.indexOf('@namespace') === 0) {
      text = text.slice('@namespace'.length).trim();
    }

    // Remove trailing semicolon if present
    if (text.charAt(text.length - 1) === ';') {
      text = text.slice(0, -1).trim();
    }

    // Regex to match valid namespace syntax:
    // 1. [optional prefix] url("...") or [optional prefix] url('...') or [optional prefix] url() or [optional prefix] url(unquoted)
    // 2. [optional prefix] "..." or [optional prefix] '...'
    // The prefix must be a valid CSS identifier (letters, digits, hyphens, underscores, starting with letter or underscore)
    var re = /^(?:([a-zA-Z_][a-zA-Z0-9_-]*)\s+)?(?:url\(\s*(?:(['"])(.*?)\2\s*|([^)]*?))\s*\)|(['"])(.*?)\5)$/;
    var match = text.match(re);

    if (match) {
      // If prefix is present
      if (match[1]) {
        newPrefix = match[1];
      }
      // If url(...) form with quotes
      if (typeof match[3] !== "undefined") {
        newNamespaceURI = match[3];
      }
      // If url(...) form without quotes
      else if (typeof match[4] !== "undefined") {
        newNamespaceURI = match[4].trim();
      }
      // If quoted string form
      else if (typeof match[6] !== "undefined") {
        newNamespaceURI = match[6];
      }

      this.__prefix = newPrefix;
      this.__namespaceURI = newNamespaceURI;
    } else {
      throw new DOMException("Invalid @namespace rule", "InvalidStateError");
    }
  }
});
//.CommonJS
exports.CSSNamespaceRule = CSSOM.CSSNamespaceRule;
///CommonJS
