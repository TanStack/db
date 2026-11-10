//.CommonJS
var CSSOM = {
	CSSRule: require("./CSSRule").CSSRule,
	CSSRuleList: require("./CSSRuleList").CSSRuleList,
	parse: require("./parse").parse
};
var errorUtils = require("./errorUtils").errorUtils;
///CommonJS


/**
 * @constructor
 * @see http://www.w3.org/TR/css3-animations/#DOM-CSSKeyframesRule
 */
CSSOM.CSSKeyframesRule = function CSSKeyframesRule() {
	CSSOM.CSSRule.call(this);
	this.name = '';
	this.cssRules = new CSSOM.CSSRuleList();
	
	// Set up initial indexed access
	this._setupIndexedAccess();
	
	// Override cssRules methods after initial setup, store references as non-enumerable properties
	var self = this;
	var originalPush = this.cssRules.push;
	var originalSplice = this.cssRules.splice;
	
	// Create non-enumerable method overrides
	Object.defineProperty(this.cssRules, 'push', {
		value: function() {
			var result = originalPush.apply(this, arguments);
			self._setupIndexedAccess();
			return result;
		},
		writable: true,
		enumerable: false,
		configurable: true
	});
	
	Object.defineProperty(this.cssRules, 'splice', {
		value: function() {
			var result = originalSplice.apply(this, arguments);
			self._setupIndexedAccess();
			return result;
		},
		writable: true,
		enumerable: false,
		configurable: true
	});
};

CSSOM.CSSKeyframesRule.prototype = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSKeyframesRule.prototype.constructor = CSSOM.CSSKeyframesRule;

Object.setPrototypeOf(CSSOM.CSSKeyframesRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSKeyframesRule.prototype, "type", {
	value: 7,
	writable: false
});

// http://www.opensource.apple.com/source/WebCore/WebCore-955.66.1/css/WebKitCSSKeyframesRule.cpp
Object.defineProperty(CSSOM.CSSKeyframesRule.prototype, "cssText", {
  get: function() {
    var values = "";
	var valuesArr = [" {"];
	if (this.cssRules.length) {
	valuesArr.push(this.cssRules.reduce(function(acc, rule){ 
		if (rule.cssText !== "") {
		acc.push(rule.cssText);
		}
		return acc;
	}, []).join("\n  "));
	}
	values = valuesArr.join("\n  ") + "\n}";
    var cssWideKeywords = ['initial', 'inherit', 'revert', 'revert-layer', 'unset', 'none'];
    var processedName = cssWideKeywords.includes(this.name) ? '"' + this.name + '"' : this.name;
    return "@" + (this._vendorPrefix || '') + "keyframes " + processedName + values;
  }
});

/**
 * Appends a new keyframe rule to the list of keyframes.
 * 
 * @param {string} rule - The keyframe rule string to append (e.g., "50% { opacity: 0.5; }")
 * @see https://www.w3.org/TR/css-animations-1/#dom-csskeyframesrule-appendrule
 */
CSSOM.CSSKeyframesRule.prototype.appendRule = function appendRule(rule) {
	if (arguments.length === 0) {
		errorUtils.throwMissingArguments(this, 'appendRule', 'CSSKeyframesRule');
	}
	
	var parsedRule;
	try {
		// Parse the rule string as a keyframe rule
		var tempStyleSheet = CSSOM.parse("@keyframes temp { " + rule + " }");
		if (tempStyleSheet.cssRules.length > 0 && tempStyleSheet.cssRules[0].cssRules.length > 0) {
			parsedRule = tempStyleSheet.cssRules[0].cssRules[0];
		} else {
			throw new Error("Failed to parse keyframe rule");
		}
	} catch (e) {
		errorUtils.throwParseError(this, 'appendRule', 'CSSKeyframesRule', rule);
	}
	
	parsedRule.__parentRule = this;
	this.cssRules.push(parsedRule);
};

/**
 * Deletes a keyframe rule that matches the specified key.
 * 
 * @param {string} select - The keyframe selector to delete (e.g., "50%", "from", "to")
 * @see https://www.w3.org/TR/css-animations-1/#dom-csskeyframesrule-deleterule
 */
CSSOM.CSSKeyframesRule.prototype.deleteRule = function deleteRule(select) {
	if (arguments.length === 0) {
		errorUtils.throwMissingArguments(this, 'deleteRule', 'CSSKeyframesRule');
	}
	
	var normalizedSelect = this._normalizeKeyText(select);
	
	for (var i = 0; i < this.cssRules.length; i++) {
		var rule = this.cssRules[i];
		if (this._normalizeKeyText(rule.keyText) === normalizedSelect) {
			rule.__parentRule = null;
			this.cssRules.splice(i, 1);
			return;
		}
	}
};

/**
 * Finds and returns the keyframe rule that matches the specified key.
 * When multiple rules have the same key, returns the last one.
 * 
 * @param {string} select - The keyframe selector to find (e.g., "50%", "from", "to")
 * @return {CSSKeyframeRule|null} The matching keyframe rule, or null if not found
 * @see https://www.w3.org/TR/css-animations-1/#dom-csskeyframesrule-findrule
 */
CSSOM.CSSKeyframesRule.prototype.findRule = function findRule(select) {
	if (arguments.length === 0) {
		errorUtils.throwMissingArguments(this, 'findRule', 'CSSKeyframesRule');
	}
	
	var normalizedSelect = this._normalizeKeyText(select);
	
	// Iterate backwards to find the last matching rule
	for (var i = this.cssRules.length - 1; i >= 0; i--) {
		var rule = this.cssRules[i];
		if (this._normalizeKeyText(rule.keyText) === normalizedSelect) {
			return rule;
		}
	}
	
	return null;
};

/**
 * Normalizes keyframe selector text for comparison.
 * Handles "from" -> "0%" and "to" -> "100%" conversions and trims whitespace.
 * 
 * @private
 * @param {string} keyText - The keyframe selector text to normalize
 * @return {string} The normalized keyframe selector text
 */
CSSOM.CSSKeyframesRule.prototype._normalizeKeyText = function _normalizeKeyText(keyText) {
	if (!keyText) return '';
	
	var normalized = keyText.toString().trim().toLowerCase();
	
	// Convert keywords to percentages for comparison
	if (normalized === 'from') {
		return '0%';
	} else if (normalized === 'to') {
		return '100%';
	}
	
	return normalized;
};

/**
 * Makes CSSKeyframesRule iterable over its cssRules.
 * Allows for...of loops and other iterable methods.
 */
if (typeof Symbol !== 'undefined' && Symbol.iterator) {
	CSSOM.CSSKeyframesRule.prototype[Symbol.iterator] = function() {
		var index = 0;
		var cssRules = this.cssRules;
		
		return {
			next: function() {
				if (index < cssRules.length) {
					return { value: cssRules[index++], done: false };
				} else {
					return { done: true };
				}
			}
		};
	};
}

/**
 * Adds indexed getters for direct access to cssRules by index.
 * This enables rule[0], rule[1], etc. access patterns.
 * Works in environments where Proxy is not available (like jsdom).
 */
CSSOM.CSSKeyframesRule.prototype._setupIndexedAccess = function() {
	// Remove any existing indexed properties
	for (var i = 0; i < 1000; i++) { // reasonable upper limit
		if (this.hasOwnProperty(i)) {
			delete this[i];
		} else {
			break;
		}
	}
	
	// Add indexed getters for current cssRules
	for (var i = 0; i < this.cssRules.length; i++) {
		(function(index) {
			Object.defineProperty(this, index, {
				get: function() {
					return this.cssRules[index];
				},
				enumerable: false,
				configurable: true
			});
		}.call(this, i));
	}
	
	// Update length property
	Object.defineProperty(this, 'length', {
		get: function() {
			return this.cssRules.length;
		},
		enumerable: false,
		configurable: true
	});
};





//.CommonJS
exports.CSSKeyframesRule = CSSOM.CSSKeyframesRule;
///CommonJS
