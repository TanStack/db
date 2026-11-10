//.CommonJS
var CSSOM = {
	CSSRule: require("./CSSRule").CSSRule,
	CSSRuleList: require("./CSSRuleList").CSSRuleList
};
///CommonJS


/**
 * @constructor
 * @see http://www.w3.org/TR/shadow-dom/#host-at-rule
 * @see http://html5index.org/Shadow%20DOM%20-%20CSSHostRule.html
 * @deprecated This rule was part of early Shadow DOM drafts but was removed in favor of the more flexible :host and :host-context() pseudo-classes in modern CSS for Web Components.
 */
CSSOM.CSSHostRule = function CSSHostRule() {
	CSSOM.CSSRule.call(this);
	this.cssRules = new CSSOM.CSSRuleList();
};

CSSOM.CSSHostRule.prototype = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSHostRule.prototype.constructor = CSSOM.CSSHostRule;

Object.setPrototypeOf(CSSOM.CSSHostRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSHostRule.prototype, "type", {
	value: 1001,
	writable: false
});

//FIXME
//CSSOM.CSSHostRule.prototype.insertRule = CSSStyleSheet.prototype.insertRule;
//CSSOM.CSSHostRule.prototype.deleteRule = CSSStyleSheet.prototype.deleteRule;

Object.defineProperty(CSSOM.CSSHostRule.prototype, "cssText", {
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
		return "@host" + values;
	}
});


//.CommonJS
exports.CSSHostRule = CSSOM.CSSHostRule;
///CommonJS
