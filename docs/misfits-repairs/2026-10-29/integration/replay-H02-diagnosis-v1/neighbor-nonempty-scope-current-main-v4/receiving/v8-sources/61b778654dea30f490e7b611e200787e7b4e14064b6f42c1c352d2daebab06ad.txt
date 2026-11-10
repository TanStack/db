//.CommonJS
var CSSOM = {
	CSSRule: require("./CSSRule").CSSRule,
  CSSRuleList: require("./CSSRuleList").CSSRuleList,
	CSSGroupingRule: require("./CSSGroupingRule").CSSGroupingRule,
	CSSConditionRule: require("./CSSConditionRule").CSSConditionRule,
};
///CommonJS


/**
 * @constructor
 * @see https://drafts.csswg.org/css-contain-3/
 * @see https://www.w3.org/TR/css-contain-3/
 */
CSSOM.CSSContainerRule = function CSSContainerRule() {
	CSSOM.CSSConditionRule.call(this);
};

CSSOM.CSSContainerRule.prototype = Object.create(CSSOM.CSSConditionRule.prototype);
CSSOM.CSSContainerRule.prototype.constructor = CSSOM.CSSContainerRule;

Object.setPrototypeOf(CSSOM.CSSContainerRule, CSSOM.CSSConditionRule);

Object.defineProperty(CSSOM.CSSContainerRule.prototype, "type", {
	value: 17,
	writable: false
});

Object.defineProperties(CSSOM.CSSContainerRule.prototype, {
  "cssText": {
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
      return "@container " + this.conditionText + values;
    }
  },
  "containerName": {
      get: function() {
        var parts = this.conditionText.trim().split(/\s+/);
        if (parts.length > 1 && parts[0] !== '(' && !parts[0].startsWith('(')) {
          return parts[0];
        }
        return "";
      }
    },
  "containerQuery": {
      get: function() {
        var parts = this.conditionText.trim().split(/\s+/);
        if (parts.length > 1 && parts[0] !== '(' && !parts[0].startsWith('(')) {
          return parts.slice(1).join(' ');
        }
        return this.conditionText;
      }
    },
});


//.CommonJS
exports.CSSContainerRule = CSSOM.CSSContainerRule;
///CommonJS
