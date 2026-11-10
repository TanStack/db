//.CommonJS
var CSSOM = {
	CSSRule: require("./CSSRule").CSSRule,
  CSSRuleList: require("./CSSRuleList").CSSRuleList,
	CSSGroupingRule: require("./CSSGroupingRule").CSSGroupingRule,
	CSSConditionRule: require("./CSSConditionRule").CSSConditionRule,
	MediaList: require("./MediaList").MediaList
};
///CommonJS


/**
 * @constructor
 * @see http://dev.w3.org/csswg/cssom/#cssmediarule
 * @see http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSMediaRule
 */
CSSOM.CSSMediaRule = function CSSMediaRule() {
	CSSOM.CSSConditionRule.call(this);
	this.__media = new CSSOM.MediaList();
};

CSSOM.CSSMediaRule.prototype = Object.create(CSSOM.CSSConditionRule.prototype);
CSSOM.CSSMediaRule.prototype.constructor = CSSOM.CSSMediaRule;

Object.setPrototypeOf(CSSOM.CSSMediaRule, CSSOM.CSSConditionRule);

Object.defineProperty(CSSOM.CSSMediaRule.prototype, "type", {
	value: 4,
	writable: false
});

// https://opensource.apple.com/source/WebCore/WebCore-7611.1.21.161.3/css/CSSMediaRule.cpp
Object.defineProperties(CSSOM.CSSMediaRule.prototype, {
  "media": {
    get: function() {
      return this.__media;
    },
    set: function(value) {
      if (typeof value === "string") {
        this.__media.mediaText = value;
      } else {
        this.__media = value;
      }
    },
    configurable: true,
    enumerable: true
  },
  "conditionText": {
    get: function() {
      return this.media.mediaText;
    }
  },
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
      return "@media " + this.media.mediaText + values;
    }
  }
});


//.CommonJS
exports.CSSMediaRule = CSSOM.CSSMediaRule;
///CommonJS
