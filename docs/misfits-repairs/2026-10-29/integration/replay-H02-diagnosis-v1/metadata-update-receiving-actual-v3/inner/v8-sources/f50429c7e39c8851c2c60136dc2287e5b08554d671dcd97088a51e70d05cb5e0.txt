//.CommonJS
var CSSOM = {
	CSSStyleDeclaration: require("./CSSStyleDeclaration").CSSStyleDeclaration,
	CSSRule: require("./CSSRule").CSSRule,
	CSSRuleList: require("./CSSRuleList").CSSRuleList,
	CSSGroupingRule: require("./CSSGroupingRule").CSSGroupingRule,
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
 * @see http://dev.w3.org/csswg/cssom/#cssstylerule
 * @see http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSStyleRule
 */
CSSOM.CSSStyleRule = function CSSStyleRule() {
	CSSOM.CSSGroupingRule.call(this);
	this.__selectorText = "";
	this.__style = new CSSOM.CSSStyleDeclaration();
	this.__style.parentRule = this;
};

CSSOM.CSSStyleRule.prototype = Object.create(CSSOM.CSSGroupingRule.prototype);
CSSOM.CSSStyleRule.prototype.constructor = CSSOM.CSSStyleRule;

Object.setPrototypeOf(CSSOM.CSSStyleRule, CSSOM.CSSGroupingRule);

Object.defineProperty(CSSOM.CSSStyleRule.prototype, "type", {
	value: 1,
	writable: false
});

Object.defineProperty(CSSOM.CSSStyleRule.prototype, "selectorText", {
	get: function() {
		return this.__selectorText;	
	},
	set: function(value) {
		if (typeof value === "string") {
			var trimmedValue = value.trim();

			if (trimmedValue === '') {
				return;
			}

			// TODO: Setting invalid selectorText should be ignored
			// There are some validations already on lib/parse.js
			// but the same validations should be applied here.
			// Check if we can move these validation logic to a shared function.

			this.__selectorText = trimmedValue;
		}
	},
	configurable: true
});

Object.defineProperty(CSSOM.CSSStyleRule.prototype, "style", {
	get: function() {
		return this.__style;	
	},
	set: function(value) {
		if (typeof value === "string") {
			this.__style.cssText = value;
		} else {
			this.__style = value;
		}
	},
	configurable: true
});

Object.defineProperty(CSSOM.CSSStyleRule.prototype, "cssText", {
	get: function() {
		var text;
		if (this.selectorText) {
			var values = "";
			if (this.cssRules.length) {
				var valuesArr = [" {"];
				this.style.cssText && valuesArr.push(this.style.cssText);
				valuesArr.push(this.cssRules.reduce(function(acc, rule){ 
					if (rule.cssText !== "") {
						acc.push(rule.cssText);
					}
					return acc;
				}, []).join("\n  "));
				values = valuesArr.join("\n  ") + "\n}";
			} else {
				values = " {" + (this.style.cssText ? " " + this.style.cssText : "") + " }";
			}
			text = this.selectorText + values;
		} else {
			text = "";
		}
		return text;
	}
});

//.CommonJS
exports.CSSStyleRule = CSSOM.CSSStyleRule;
///CommonJS
