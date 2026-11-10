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
 * @see http://www.w3.org/TR/css3-animations/#DOM-CSSKeyframeRule
 */
CSSOM.CSSKeyframeRule = function CSSKeyframeRule() {
	CSSOM.CSSRule.call(this);
	this.keyText = '';
	this.__style = new CSSOM.CSSStyleDeclaration();
	this.__style.parentRule = this;
};

CSSOM.CSSKeyframeRule.prototype = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSKeyframeRule.prototype.constructor = CSSOM.CSSKeyframeRule;

Object.setPrototypeOf(CSSOM.CSSKeyframeRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSKeyframeRule.prototype, "type", {
	value: 8,
	writable: false
});

//FIXME
//CSSOM.CSSKeyframeRule.prototype.insertRule = CSSStyleSheet.prototype.insertRule;
//CSSOM.CSSKeyframeRule.prototype.deleteRule = CSSStyleSheet.prototype.deleteRule;

Object.defineProperty(CSSOM.CSSKeyframeRule.prototype, "style", {
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

// http://www.opensource.apple.com/source/WebCore/WebCore-955.66.1/css/WebKitCSSKeyframeRule.cpp
Object.defineProperty(CSSOM.CSSKeyframeRule.prototype, "cssText", {
  get: function() {
    return this.keyText + " {" + (this.style.cssText ? " " + this.style.cssText : "") + " }";
  }
});


//.CommonJS
exports.CSSKeyframeRule = CSSOM.CSSKeyframeRule;
///CommonJS
