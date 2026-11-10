//.CommonJS
var CSSOM = {
  CSSRule: require("./CSSRule").CSSRule,
  CSSRuleList: require("./CSSRuleList").CSSRuleList,
  CSSGroupingRule: require("./CSSGroupingRule").CSSGroupingRule,
};
///CommonJS

/**
 * @constructor
 * @see https://drafts.csswg.org/css-cascade-5/#csslayerblockrule
 */
CSSOM.CSSLayerBlockRule = function CSSLayerBlockRule() {
  CSSOM.CSSGroupingRule.call(this);
  this.name = "";
};

CSSOM.CSSLayerBlockRule.prototype = Object.create(CSSOM.CSSGroupingRule.prototype);
CSSOM.CSSLayerBlockRule.prototype.constructor = CSSOM.CSSLayerBlockRule;

Object.setPrototypeOf(CSSOM.CSSLayerBlockRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSLayerBlockRule.prototype, "type", {
	value: 18,
	writable: false
});

Object.defineProperties(CSSOM.CSSLayerBlockRule.prototype, {
  cssText: {
    get: function () {
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
      return "@layer" + (this.name ? " " + this.name : "") + values;
    }
  },
});

//.CommonJS
exports.CSSLayerBlockRule = CSSOM.CSSLayerBlockRule;
///CommonJS
