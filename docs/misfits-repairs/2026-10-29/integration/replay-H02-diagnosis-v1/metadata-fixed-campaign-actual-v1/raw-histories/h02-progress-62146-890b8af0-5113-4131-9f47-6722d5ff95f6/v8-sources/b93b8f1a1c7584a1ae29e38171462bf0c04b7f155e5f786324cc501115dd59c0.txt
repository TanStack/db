//.CommonJS
var CSSOM = {
	CSSRule: require("./CSSRule").CSSRule,
	CSSRuleList: require("./CSSRuleList").CSSRuleList,
	parse: require('./parse').parse
};
var errorUtils = require("./errorUtils").errorUtils;
///CommonJS


/**
 * @constructor
 * @see https://drafts.csswg.org/cssom/#the-cssgroupingrule-interface
 */
CSSOM.CSSGroupingRule = function CSSGroupingRule() {
	CSSOM.CSSRule.call(this);
	this.__cssRules = new CSSOM.CSSRuleList();
};

CSSOM.CSSGroupingRule.prototype  = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSGroupingRule.prototype.constructor = CSSOM.CSSGroupingRule;

Object.setPrototypeOf(CSSOM.CSSGroupingRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSGroupingRule.prototype, "cssRules", {
	get: function() {
		return this.__cssRules;
	}
});

/**
 * Used to insert a new CSS rule to a list of CSS rules.
 *
 * @example
 *   cssGroupingRule.cssText
 *   -> "body{margin:0;}"
 *   cssGroupingRule.insertRule("img{border:none;}", 1)
 *   -> 1
 *   cssGroupingRule.cssText
 *   -> "body{margin:0;}img{border:none;}"
 *
 * @param {string} rule
 * @param {number} [index]
 * @see https://www.w3.org/TR/cssom-1/#dom-cssgroupingrule-insertrule
 * @return {number} The index within the grouping rule's collection of the newly inserted rule.
 */
 CSSOM.CSSGroupingRule.prototype.insertRule = function insertRule(rule, index) {
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
	var ruleToParse = processedRuleToParse = String(rule);
	ruleToParse = ruleToParse.trim().replace(/^\/\*[\s\S]*?\*\/\s*/, "");
	var isNestedSelector = this.constructor.name === "CSSStyleRule";
	if (isNestedSelector === false) {
		var currentRule = this;
		while (currentRule.parentRule) {
			currentRule = currentRule.parentRule;
			if (currentRule.constructor.name === "CSSStyleRule") {
				isNestedSelector = true;
				break;
			}
		}
	}
	if (isNestedSelector) {
		processedRuleToParse = 's { n { } ' + ruleToParse + '}';
	}
	var isScopeRule = this.constructor.name === "CSSScopeRule";
	if (isScopeRule) {
		if (isNestedSelector) {
			processedRuleToParse = 's { ' + '@scope {' + ruleToParse + '}}';
		} else {
			processedRuleToParse = '@scope {' + ruleToParse + '}';
		}
	}
	var parsedRules = new CSSOM.CSSRuleList();
	CSSOM.parse(processedRuleToParse, {
		styleSheet: this.parentStyleSheet,
		cssRules: parsedRules
	});
	if (isScopeRule) {
		if (isNestedSelector) {
			parsedRules = parsedRules[0].cssRules[0].cssRules;
		} else {
			parsedRules = parsedRules[0].cssRules
		}
	}
	if (isNestedSelector) {
		parsedRules = parsedRules[0].cssRules.slice(1);
	}
	if (parsedRules.length !== 1) {
		if (isNestedSelector && parsedRules.length === 0 && ruleToParse.indexOf('@font-face') === 0) {
			errorUtils.throwError(this, 'DOMException', 
				"Failed to execute 'insertRule' on '" + this.constructor.name + "': " +
				"Only conditional nested group rules, style rules, @scope rules, @apply rules, and nested declaration rules may be nested.",
				'HierarchyRequestError');
		} else {
			errorUtils.throwParseError(this, 'insertRule', this.constructor.name, ruleToParse, 'SyntaxError');
		}
	}
	var cssRule = parsedRules[0];

	if (cssRule.constructor.name === 'CSSNestedDeclarations' && cssRule.style.length === 0) {
		errorUtils.throwParseError(this, 'insertRule', this.constructor.name, ruleToParse, 'SyntaxError');	
	}
	
	// Check for rules that cannot be inserted inside a CSSGroupingRule
	if (cssRule.constructor.name === 'CSSImportRule' || cssRule.constructor.name === 'CSSNamespaceRule') {
		var ruleKeyword = cssRule.constructor.name === 'CSSImportRule' ? '@import' : '@namespace';
		errorUtils.throwError(this, 'DOMException', 
			"Failed to execute 'insertRule' on '" + this.constructor.name + "': " +
			"'" + ruleKeyword + "' rules cannot be inserted inside a group rule.",
			'HierarchyRequestError');
	}
	
	// Check for CSSLayerStatementRule (@layer statement rules)
	if (cssRule.constructor.name === 'CSSLayerStatementRule') {
		errorUtils.throwParseError(this, 'insertRule', this.constructor.name, ruleToParse, 'SyntaxError');
	}
	
	cssRule.__parentRule = this;
	this.cssRules.splice(index, 0, cssRule);
	return index;
};

/**
 * Used to delete a rule from the grouping rule.
 *
 *   cssGroupingRule.cssText
 *   -> "img{border:none;}body{margin:0;}"
 *   cssGroupingRule.deleteRule(0)
 *   cssGroupingRule.cssText
 *   -> "body{margin:0;}"
 *
 * @param {number} index within the grouping rule's rule list of the rule to remove.
 * @see https://www.w3.org/TR/cssom-1/#dom-cssgroupingrule-deleterule
 */
 CSSOM.CSSGroupingRule.prototype.deleteRule = function deleteRule(index) {
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
	this.cssRules[index].__parentRule = null;
	this.cssRules[index].__parentStyleSheet = null;
	this.cssRules.splice(index, 1);
};

//.CommonJS
exports.CSSGroupingRule = CSSOM.CSSGroupingRule;
///CommonJS
