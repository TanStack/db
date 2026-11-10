//.CommonJS
var CSSOM = {
	MediaList: require("./MediaList").MediaList,
	StyleSheet: require("./StyleSheet").StyleSheet,
	CSSRuleList: require("./CSSRuleList").CSSRuleList,
	CSSStyleRule: require("./CSSStyleRule").CSSStyleRule,
};
var errorUtils = require("./errorUtils").errorUtils;
///CommonJS


/**
 * @constructor
 * @param {CSSStyleSheetInit} [opts] - CSSStyleSheetInit options.
 * @param {string} [opts.baseURL] - The base URL of the stylesheet.
 * @param {boolean} [opts.disabled] - The disabled attribute of the stylesheet.
 * @param {MediaList | string} [opts.media] - The media attribute of the stylesheet.
 * @see http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSStyleSheet
 */
CSSOM.CSSStyleSheet = function CSSStyleSheet(opts) {
	CSSOM.StyleSheet.call(this);
	this.__constructed = true;
	this.__cssRules = new CSSOM.CSSRuleList();
	this.__ownerRule = null; 

	if (opts && typeof opts === "object") {
		if (opts.baseURL && typeof opts.baseURL === "string") {
			this.__baseURL = opts.baseURL;
		}
		if (opts.media && typeof opts.media === "string") {
			this.media.mediaText = opts.media;
		}
		if (typeof opts.disabled === "boolean") {
			this.disabled = opts.disabled;
		}
	}
};


CSSOM.CSSStyleSheet.prototype = Object.create(CSSOM.StyleSheet.prototype);
CSSOM.CSSStyleSheet.prototype.constructor = CSSOM.CSSStyleSheet;

Object.setPrototypeOf(CSSOM.CSSStyleSheet, CSSOM.StyleSheet);

Object.defineProperty(CSSOM.CSSStyleSheet.prototype, "cssRules", {
	get: function() {
		return this.__cssRules;
	}
});

Object.defineProperty(CSSOM.CSSStyleSheet.prototype, "rules", {
	get: function() {
		return this.__cssRules;
	}
});

Object.defineProperty(CSSOM.CSSStyleSheet.prototype, "ownerRule", {
	get: function() {
		return this.__ownerRule;
	}
});

/**
 * Used to insert a new rule into the style sheet. The new rule now becomes part of the cascade.
 *
 *   sheet = new Sheet("body {margin: 0}")
 *   sheet.toString()
 *   -> "body{margin:0;}"
 *   sheet.insertRule("img {border: none}", 0)
 *   -> 0
 *   sheet.toString()
 *   -> "img{border:none;}body{margin:0;}"
 *
 * @param {string} rule
 * @param {number} [index=0]
 * @see http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSStyleSheet-insertRule
 * @return {number} The index within the style sheet's rule collection of the newly inserted rule.
 */
CSSOM.CSSStyleSheet.prototype.insertRule = function(rule, index) {
	if (rule === undefined && index === undefined) {
		errorUtils.throwMissingArguments(this, 'insertRule', this.constructor.name);
	}
	if (index === void 0) {
		index = 0;
	}
	index = Number(index);
	if (index < 0) {
		index = 4294967296 + index;
	}
	if (index > this.cssRules.length) {
		errorUtils.throwIndexError(this, 'insertRule', this.constructor.name, index, this.cssRules.length);
	}
	
	var ruleToParse = String(rule);
	var parseErrors = [];
	var parsedSheet = CSSOM.parse(ruleToParse, undefined, function(err) {
		parseErrors.push(err);
	} );
	if (parsedSheet.cssRules.length !== 1) {
		errorUtils.throwParseError(this, 'insertRule', this.constructor.name, ruleToParse, 'SyntaxError');
	}
	var cssRule = parsedSheet.cssRules[0];
	
	// Helper function to find the last index of a specific rule constructor
	function findLastIndexOfConstructor(rules, constructorName) {
		for (var i = rules.length - 1; i >= 0; i--) {
			if (rules[i].constructor.name === constructorName) {
				return i;
			}
		}
		return -1;
	}
	
	// Helper function to find the first index of a rule that's NOT of specified constructors
	function findFirstNonConstructorIndex(rules, constructorNames) {
		for (var i = 0; i < rules.length; i++) {
			if (constructorNames.indexOf(rules[i].constructor.name) === -1) {
				return i;
			}
		}
		return rules.length;
	}
	
	// Validate rule ordering based on CSS specification
	if (cssRule.constructor.name === 'CSSImportRule') {
		if (this.__constructed === true) {
			errorUtils.throwError(this, 'DOMException',
				"Failed to execute 'insertRule' on '" + this.constructor.name + "': Can't insert @import rules into a constructed stylesheet.",
				'SyntaxError');
		}
		// @import rules cannot be inserted after @layer rules that already exist
		// They can only be inserted at the beginning or after other @import rules
		var firstLayerIndex = findFirstNonConstructorIndex(this.cssRules, ['CSSImportRule']);
		if (firstLayerIndex < this.cssRules.length && this.cssRules[firstLayerIndex].constructor.name === 'CSSLayerStatementRule' && index > firstLayerIndex) {
			errorUtils.throwError(this, 'DOMException',
				"Failed to execute 'insertRule' on '" + this.constructor.name + "': Failed to insert the rule.",
				'HierarchyRequestError');
		}
		
		// Also cannot insert after @namespace or other rules
		var firstNonImportIndex = findFirstNonConstructorIndex(this.cssRules, ['CSSImportRule']);
		if (index > firstNonImportIndex && firstNonImportIndex < this.cssRules.length && 
		    this.cssRules[firstNonImportIndex].constructor.name !== 'CSSLayerStatementRule') {
			errorUtils.throwError(this, 'DOMException',
				"Failed to execute 'insertRule' on '" + this.constructor.name + "': Failed to insert the rule.",
				'HierarchyRequestError');
		}
	} else if (cssRule.constructor.name === 'CSSNamespaceRule') {
		// @namespace rules can come after @layer and @import, but before any other rules
		// They cannot come before @import rules
		var firstImportIndex = -1;
		for (var i = 0; i < this.cssRules.length; i++) {
			if (this.cssRules[i].constructor.name === 'CSSImportRule') {
				firstImportIndex = i;
				break;
			}
		}
		var firstNonImportNamespaceIndex = findFirstNonConstructorIndex(this.cssRules, [
			'CSSLayerStatementRule', 
			'CSSImportRule', 
			'CSSNamespaceRule'
		]);
		
		// Cannot insert before @import rules
		if (firstImportIndex !== -1 && index <= firstImportIndex) {
			errorUtils.throwError(this, 'DOMException',
				"Failed to execute 'insertRule' on '" + this.constructor.name + "': Failed to insert the rule.",
				'HierarchyRequestError');
		}
		
		// Cannot insert if there are already non-special rules
		if (firstNonImportNamespaceIndex < this.cssRules.length) {
			errorUtils.throwError(this, 'DOMException',
				"Failed to execute 'insertRule' on '" + this.constructor.name + "': Failed to insert the rule.",
				'InvalidStateError');
		}
		
		// Cannot insert after other types of rules
		if (index > firstNonImportNamespaceIndex) {
			errorUtils.throwError(this, 'DOMException',
				"Failed to execute 'insertRule' on '" + this.constructor.name + "': Failed to insert the rule.",
				'HierarchyRequestError');
		}

		
	} else if (cssRule.constructor.name === 'CSSLayerStatementRule') {
		// @layer statement rules can be inserted anywhere before @import and @namespace
		// No additional restrictions beyond what's already handled
	} else {
		// Any other rule cannot be inserted before @import and @namespace
		var firstNonSpecialRuleIndex = findFirstNonConstructorIndex(this.cssRules, [
			'CSSLayerStatementRule',
			'CSSImportRule',
			'CSSNamespaceRule'
		]);
		
		if (index < firstNonSpecialRuleIndex) {
			errorUtils.throwError(this, 'DOMException',
				"Failed to execute 'insertRule' on '" + this.constructor.name + "': Failed to insert the rule.",
				'HierarchyRequestError');
		}

		if (parseErrors.filter(function(error) { return !error.isNested; }).length !== 0) {
			errorUtils.throwParseError(this, 'insertRule', this.constructor.name, ruleToParse, 'SyntaxError');
		}
	}
	
	cssRule.__parentStyleSheet = this;
	this.cssRules.splice(index, 0, cssRule);
	return index;
};

CSSOM.CSSStyleSheet.prototype.addRule = function(selector, styleBlock, index) {
	if (index === void 0) {
		index = this.cssRules.length;
	}
	this.insertRule(selector + "{" + styleBlock + "}", index);
	return -1;
};

/**
 * Used to delete a rule from the style sheet.
 *
 *   sheet = new Sheet("img{border:none} body{margin:0}")
 *   sheet.toString()
 *   -> "img{border:none;}body{margin:0;}"
 *   sheet.deleteRule(0)
 *   sheet.toString()
 *   -> "body{margin:0;}"
 *
 * @param {number} index within the style sheet's rule list of the rule to remove.
 * @see http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSStyleSheet-deleteRule
 */
CSSOM.CSSStyleSheet.prototype.deleteRule = function(index) {
	if (index === undefined) {
		errorUtils.throwMissingArguments(this, 'deleteRule', this.constructor.name);
	}
	index = Number(index);
	if (index < 0) {
		index = 4294967296 + index;
	}
	if (index >= this.cssRules.length) {
		errorUtils.throwIndexError(this, 'deleteRule', this.constructor.name, index, this.cssRules.length);
	}
	if (this.cssRules[index]) {		
		if (this.cssRules[index].constructor.name == "CSSNamespaceRule") {
			var shouldContinue = this.cssRules.every(function (rule) {
				return ['CSSImportRule','CSSLayerStatementRule','CSSNamespaceRule'].indexOf(rule.constructor.name) !== -1
			});
			if (!shouldContinue) {
				errorUtils.throwError(this, 'DOMException', "Failed to execute 'deleteRule' on '" + this.constructor.name + "': Failed to delete rule.", "InvalidStateError");
			}
		}
		if (this.cssRules[index].constructor.name == "CSSImportRule") {
			this.cssRules[index].styleSheet.__parentStyleSheet = null;
		}

		this.cssRules[index].__parentStyleSheet = null;
	}
	this.cssRules.splice(index, 1);
};

CSSOM.CSSStyleSheet.prototype.removeRule = function(index) {
	if (index === void 0) {
		index = 0;
	}
	this.deleteRule(index);
};


/**
 * Replaces the rules of a {@link CSSStyleSheet}
 * 
 * @returns a promise
 * @see https://www.w3.org/TR/cssom-1/#dom-cssstylesheet-replace
 */
CSSOM.CSSStyleSheet.prototype.replace = function(text) {
	var _Promise;
	if (this.__globalObject && this.__globalObject['Promise']) {
		_Promise = this.__globalObject['Promise'];
	} else {
		_Promise = Promise;
	}
	var _setTimeout;
	if (this.__globalObject && this.__globalObject['setTimeout']) {
		_setTimeout = this.__globalObject['setTimeout'];
	} else {
		_setTimeout = setTimeout;
	}
	var sheet = this;
	return new _Promise(function (resolve, reject) {
		// If the constructed flag is not set, or the disallow modification flag is set, throw a NotAllowedError DOMException.
		if (!sheet.__constructed || sheet.__disallowModification) {
			reject(errorUtils.createError(sheet, 'DOMException',
				"Failed to execute 'replaceSync' on '" + sheet.constructor.name + "': Not allowed.",
				'NotAllowedError'));
		}
		// Set the disallow modification flag.
		sheet.__disallowModification = true;

		// In parallel, do these steps:
		_setTimeout(function() {
			// Let rules be the result of running parse a stylesheet's contents from text.
			var rules = new CSSOM.CSSRuleList();
			CSSOM.parse(text, { styleSheet: sheet, cssRules: rules });
			// If rules contains one or more @import rules, remove those rules from rules.
			var i = 0;
			while (i < rules.length) {
				if (rules[i].constructor.name === 'CSSImportRule') {
					rules.splice(i, 1);
				} else {
					i++;
				}
			}
			// Set sheet's CSS rules to rules.
			sheet.__cssRules.splice.apply(sheet.__cssRules, [0, sheet.__cssRules.length].concat(rules));
			// Unset sheet’s disallow modification flag.
			delete sheet.__disallowModification;
			// Resolve promise with sheet.
			resolve(sheet);
		})
	});
}

/**
 * Synchronously replaces the rules of a {@link CSSStyleSheet}
 * 
 * @see https://www.w3.org/TR/cssom-1/#dom-cssstylesheet-replacesync
 */
CSSOM.CSSStyleSheet.prototype.replaceSync = function(text) {
	var sheet = this;
	// If the constructed flag is not set, or the disallow modification flag is set, throw a NotAllowedError DOMException.
	if (!sheet.__constructed || sheet.__disallowModification) {
		errorUtils.throwError(sheet, 'DOMException',
			"Failed to execute 'replaceSync' on '" + sheet.constructor.name + "': Not allowed.",
			'NotAllowedError');
	}
	// Let rules be the result of running parse a stylesheet's contents from text.
	var rules = new CSSOM.CSSRuleList();
	CSSOM.parse(text, { styleSheet: sheet, cssRules: rules });
	// If rules contains one or more @import rules, remove those rules from rules.
	var i = 0;
	while (i < rules.length) {
		if (rules[i].constructor.name === 'CSSImportRule') {
			rules.splice(i, 1);
		} else {
			i++;
		}
	}
	// Set sheet's CSS rules to rules.
	sheet.__cssRules.splice.apply(sheet.__cssRules, [0, sheet.__cssRules.length].concat(rules));
}

/**
 * NON-STANDARD
 * @return {string} serialize stylesheet
 */
CSSOM.CSSStyleSheet.prototype.toString = function() {
	var result = "";
	var rules = this.cssRules;
	for (var i=0; i<rules.length; i++) {
		result += rules[i].cssText + "\n";
	}
	return result;
};


//.CommonJS
exports.CSSStyleSheet = CSSOM.CSSStyleSheet;
CSSOM.parse = require('./parse').parse; // Cannot be included sooner due to the mutual dependency between parse.js and CSSStyleSheet.js
///CommonJS
