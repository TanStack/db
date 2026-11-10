//.CommonJS
var CSSOM = {
  CSSRule: require("./CSSRule").CSSRule,
  CSSStyleDeclaration: require('./CSSStyleDeclaration').CSSStyleDeclaration
};
// Use cssstyle if available
try {
	CSSOM.CSSStyleDeclaration = require("cssstyle").CSSStyleDeclaration;
} catch (e) {
	// ignore
}
///CommonJS


/**
 * @constructor
 * @see https://drafts.csswg.org/css-nesting-1/
 */
CSSOM.CSSNestedDeclarations = function CSSNestedDeclarations() {
  CSSOM.CSSRule.call(this);
  this.__style = new CSSOM.CSSStyleDeclaration();
  this.__style.parentRule = this;
};

CSSOM.CSSNestedDeclarations.prototype = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSNestedDeclarations.prototype.constructor = CSSOM.CSSNestedDeclarations;

Object.setPrototypeOf(CSSOM.CSSNestedDeclarations, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSNestedDeclarations.prototype, "type", {
  value: 0,
  writable: false
});

Object.defineProperty(CSSOM.CSSNestedDeclarations.prototype, "style", {
	get: function() {
		return this.__style;	
	},
	set: function(value) {
		if (typeof value === "string") {
			this.__style.cssText = value;
		} else {
			this.__style = value;
		}
	}
});

Object.defineProperty(CSSOM.CSSNestedDeclarations.prototype, "cssText", {
  get: function () {
    return this.style.cssText;
  }
});

//.CommonJS
exports.CSSNestedDeclarations = CSSOM.CSSNestedDeclarations;
///CommonJS