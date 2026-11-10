//.CommonJS
var CSSOM = {
	CSSRule: require("./CSSRule").CSSRule
};
///CommonJS


/**
 * @constructor
 * @see https://drafts.css-houdini.org/css-properties-values-api/#the-css-property-rule-interface
 */
CSSOM.CSSPropertyRule = function CSSPropertyRule() {
	CSSOM.CSSRule.call(this);
	this.__name = "";
	this.__syntax = "";
	this.__inherits = false;
	this.__initialValue = null;
};

CSSOM.CSSPropertyRule.prototype = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSPropertyRule.prototype.constructor = CSSOM.CSSPropertyRule;

Object.setPrototypeOf(CSSOM.CSSPropertyRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSPropertyRule.prototype, "type", {
	value: 0,
	writable: false
});

Object.defineProperty(CSSOM.CSSPropertyRule.prototype, "cssText", {
	get: function() {
		var text = "@property " + this.name + " {";
		if (this.syntax !== "") {
			text += " syntax: \"" + this.syntax.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + "\";";
		}
		text += " inherits: " + (this.inherits ? "true" : "false") + ";";
		if (this.initialValue !== null) {
			text += " initial-value: " + this.initialValue + ";";
		}
		text += " }";
		return text;
	}
});

Object.defineProperty(CSSOM.CSSPropertyRule.prototype, "name", {
	get: function() {
		return this.__name;
	}
});

Object.defineProperty(CSSOM.CSSPropertyRule.prototype, "syntax", {
	get: function() {
		return this.__syntax;
	}
});

Object.defineProperty(CSSOM.CSSPropertyRule.prototype, "inherits", {
	get: function() {
		return this.__inherits;
	}
});

Object.defineProperty(CSSOM.CSSPropertyRule.prototype, "initialValue", {
	get: function() {
		return this.__initialValue;
	}
});

/**
 * NON-STANDARD
 * Rule text parser.
 * @param {string} cssText
 * @returns {boolean} True if the rule is valid and was parsed successfully
 */
Object.defineProperty(CSSOM.CSSPropertyRule.prototype, "parse", {
	value: function(cssText) {
		// Extract the name from "@property <name> { ... }"
		var match = cssText.match(/@property\s+(--[^\s{]+)\s*\{([^]*)\}/);
		if (!match) {
			return false;
		}
		
		this.__name = match[1];
		var bodyText = match[2];
		
		// Parse syntax descriptor (REQUIRED)
		var syntaxMatch = bodyText.match(/syntax\s*:\s*(['"])([^]*?)\1\s*;/);
		if (!syntaxMatch) {
			return false; // syntax is required
		}
		this.__syntax = syntaxMatch[2];
		
		// Syntax cannot be empty
		if (this.__syntax === "") {
			return false;
		}
		
		// Parse inherits descriptor (REQUIRED)
		var inheritsMatch = bodyText.match(/inherits\s*:\s*(true|false)\s*;/);
		if (!inheritsMatch) {
			return false; // inherits is required
		}
		this.__inherits = inheritsMatch[1] === "true";
		
		// Parse initial-value descriptor (OPTIONAL, but required if syntax is not "*")
		var initialValueMatch = bodyText.match(/initial-value\s*:\s*([^;]+);/);
		if (initialValueMatch) {
			this.__initialValue = initialValueMatch[1].trim();
		} else {
			// If syntax is not "*", initial-value is required
			if (this.__syntax !== "*") {
				return false;
			}
		}
		
		return true; // Successfully parsed
	}
});

//.CommonJS
exports.CSSPropertyRule = CSSOM.CSSPropertyRule;
///CommonJS
