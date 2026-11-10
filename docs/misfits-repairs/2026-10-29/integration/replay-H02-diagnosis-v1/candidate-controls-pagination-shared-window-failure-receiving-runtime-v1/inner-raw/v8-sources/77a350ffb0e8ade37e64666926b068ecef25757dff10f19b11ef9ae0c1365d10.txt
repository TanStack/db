//.CommonJS
var CSSOM = {
  CSSRule: require("./CSSRule").CSSRule,
};
///CommonJS

/**
 * @constructor
 * @see https://drafts.csswg.org/css-cascade-5/#csslayerstatementrule
 */
CSSOM.CSSLayerStatementRule = function CSSLayerStatementRule() {
  CSSOM.CSSRule.call(this);
  this.nameList = [];
};

CSSOM.CSSLayerStatementRule.prototype = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSLayerStatementRule.prototype.constructor = CSSOM.CSSLayerStatementRule;

Object.setPrototypeOf(CSSOM.CSSLayerStatementRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSLayerStatementRule.prototype, "type", {
	value: 0,
	writable: false
});

Object.defineProperties(CSSOM.CSSLayerStatementRule.prototype, {
  cssText: {
    get: function () {
      return "@layer " + this.nameList.join(", ") + ";";
    }
  },
});

//.CommonJS
exports.CSSLayerStatementRule = CSSOM.CSSLayerStatementRule;
///CommonJS
