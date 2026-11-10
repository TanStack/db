//.CommonJS
var CSSOM = {
	CSSRule: require("./CSSRule").CSSRule
};
///CommonJS


/**
 * @constructor
 * @see https://drafts.csswg.org/css-counter-styles/#the-csscounterstylerule-interface
 */
CSSOM.CSSCounterStyleRule = function CSSCounterStyleRule() {
	CSSOM.CSSRule.call(this);
    this.name = "";
	this.__props = "";
};

CSSOM.CSSCounterStyleRule.prototype = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSCounterStyleRule.prototype.constructor = CSSOM.CSSCounterStyleRule;

Object.setPrototypeOf(CSSOM.CSSCounterStyleRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSCounterStyleRule.prototype, "type", {
	value: 11,
	writable: false
});

Object.defineProperty(CSSOM.CSSCounterStyleRule.prototype, "cssText", {
	get: function() {
		// FIXME : Implement real cssText generation based on properties
		return "@counter-style " + this.name + " { " + this.__props + " }";
	}
});

/**
 * NON-STANDARD
 * Rule text parser.
 * @param {string} cssText
 */
Object.defineProperty(CSSOM.CSSCounterStyleRule.prototype, "parse", {
	value: function(cssText) {
		// Extract the name from "@counter-style <name> { ... }"
		var match = cssText.match(/@counter-style\s+([^\s{]+)\s*\{([^]*)\}/);
		if (match) {
			this.name = match[1];
			// Get the text inside the brackets and clean it up
			var propsText = match[2];
			this.__props = propsText.trim().replace(/\n/g, " ").replace(/(['"])(?:\\.|[^\\])*?\1|(\s{2,})/g, function (match, quote) {
				return quote ? match : ' ';
			});
		}
	}
});

//.CommonJS
exports.CSSCounterStyleRule = CSSOM.CSSCounterStyleRule;
///CommonJS
