//.CommonJS
var CSSOM = {
	CSSStyleDeclaration: require("./CSSStyleDeclaration").CSSStyleDeclaration,
	CSSRule: require("./CSSRule").CSSRule
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
 * @see http://dev.w3.org/csswg/cssom/#css-font-face-rule
 */
CSSOM.CSSFontFaceRule = function CSSFontFaceRule() {
	CSSOM.CSSRule.call(this);
	this.__style = new CSSOM.CSSStyleDeclaration();
	this.__style.parentRule = this;
};

CSSOM.CSSFontFaceRule.prototype = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSFontFaceRule.prototype.constructor = CSSOM.CSSFontFaceRule;

Object.setPrototypeOf(CSSOM.CSSFontFaceRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSFontFaceRule.prototype, "type", {
	value: 5,
	writable: false
});

//FIXME
//CSSOM.CSSFontFaceRule.prototype.insertRule = CSSStyleSheet.prototype.insertRule;
//CSSOM.CSSFontFaceRule.prototype.deleteRule = CSSStyleSheet.prototype.deleteRule;

Object.defineProperty(CSSOM.CSSFontFaceRule.prototype, "style", {
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

// http://www.opensource.apple.com/source/WebCore/WebCore-955.66.1/css/WebKitCSSFontFaceRule.cpp
Object.defineProperty(CSSOM.CSSFontFaceRule.prototype, "cssText", {
  get: function() {
    return "@font-face {" + (this.style.cssText ? " " + this.style.cssText : "") + " }";
  }
});


//.CommonJS
exports.CSSFontFaceRule = CSSOM.CSSFontFaceRule;
///CommonJS
