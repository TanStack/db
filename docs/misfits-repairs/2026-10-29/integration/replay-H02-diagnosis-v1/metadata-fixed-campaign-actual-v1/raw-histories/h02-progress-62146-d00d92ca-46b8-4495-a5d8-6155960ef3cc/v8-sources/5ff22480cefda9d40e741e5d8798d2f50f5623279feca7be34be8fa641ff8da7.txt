//.CommonJS
var CSSOM = {
  CSSRule: require("./CSSRule").CSSRule,
  CSSRuleList: require("./CSSRuleList").CSSRuleList,
  CSSGroupingRule: require("./CSSGroupingRule").CSSGroupingRule,
};
///CommonJS

/**
 * @constructor
 * @see https://drafts.csswg.org/css-cascade-6/#cssscoperule
 */
CSSOM.CSSScopeRule = function CSSScopeRule() {
  CSSOM.CSSGroupingRule.call(this);
  this.__start = null;
  this.__end = null;
};

CSSOM.CSSScopeRule.prototype = Object.create(CSSOM.CSSGroupingRule.prototype);
CSSOM.CSSScopeRule.prototype.constructor = CSSOM.CSSScopeRule;

Object.setPrototypeOf(CSSOM.CSSScopeRule, CSSOM.CSSGroupingRule);

Object.defineProperties(CSSOM.CSSScopeRule.prototype, {
  type: {
    value: 0,
    writable: false,
  },
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
      return "@scope" + (this.start ? " (" + this.start + ")" : "") + (this.end ? " to (" + this.end + ")" : "") + values;
    },
    configurable: true,
    enumerable: true,
  },
  start: {
    get: function () {
      return this.__start;
    }
  },
  end: {
    get: function () {
      return this.__end;
    }
  }
});

//.CommonJS
exports.CSSScopeRule = CSSOM.CSSScopeRule;
///CommonJS
