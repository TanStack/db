//.CommonJS
var CSSOM = {
  CSSRule: require("./CSSRule").CSSRule,
  CSSRuleList: require("./CSSRuleList").CSSRuleList,
  CSSGroupingRule: require("./CSSGroupingRule").CSSGroupingRule
};
///CommonJS


/**
 * @constructor
 * @see https://www.w3.org/TR/css-conditional-3/#the-cssconditionrule-interface
 */
CSSOM.CSSConditionRule = function CSSConditionRule() {
  CSSOM.CSSGroupingRule.call(this);
  this.__conditionText = '';
};

CSSOM.CSSConditionRule.prototype = Object.create(CSSOM.CSSGroupingRule.prototype);
CSSOM.CSSConditionRule.prototype.constructor = CSSOM.CSSConditionRule;

Object.setPrototypeOf(CSSOM.CSSConditionRule, CSSOM.CSSGroupingRule);

Object.defineProperty(CSSOM.CSSConditionRule.prototype, "conditionText", {
  get: function () {
    return this.__conditionText;
  }
});

//.CommonJS
exports.CSSConditionRule = CSSOM.CSSConditionRule;
///CommonJS
