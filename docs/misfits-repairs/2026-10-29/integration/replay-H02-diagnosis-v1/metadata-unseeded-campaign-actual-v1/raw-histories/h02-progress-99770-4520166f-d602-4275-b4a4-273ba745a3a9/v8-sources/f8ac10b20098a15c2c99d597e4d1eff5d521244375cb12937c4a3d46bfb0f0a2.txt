//.CommonJS
var CSSOM = {
  CSSRule: require("./CSSRule").CSSRule,
  CSSRuleList: require("./CSSRuleList").CSSRuleList,
  CSSGroupingRule: require("./CSSGroupingRule").CSSGroupingRule,
  CSSConditionRule: require("./CSSConditionRule").CSSConditionRule
};
///CommonJS


/**
 * @constructor
 * @see https://drafts.csswg.org/css-conditional-3/#the-csssupportsrule-interface
 */
CSSOM.CSSSupportsRule = function CSSSupportsRule() {
  CSSOM.CSSConditionRule.call(this);
};

CSSOM.CSSSupportsRule.prototype = Object.create(CSSOM.CSSConditionRule.prototype);
CSSOM.CSSSupportsRule.prototype.constructor = CSSOM.CSSSupportsRule;
  
Object.setPrototypeOf(CSSOM.CSSSupportsRule, CSSOM.CSSConditionRule);

Object.defineProperty(CSSOM.CSSSupportsRule.prototype, "type", {
	value: 12,
	writable: false
});

Object.defineProperty(CSSOM.CSSSupportsRule.prototype, "cssText", {
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
    return "@supports " + this.conditionText + values;
  }
});

//.CommonJS
exports.CSSSupportsRule = CSSOM.CSSSupportsRule;
///CommonJS
