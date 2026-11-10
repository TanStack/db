//.CommonJS
var CSSOM = {};
///CommonJS


/**
 * @constructor
 * @see https://drafts.csswg.org/cssom/#the-cssrulelist-interface
 */
CSSOM.CSSRuleList = function CSSRuleList(){
  const arr = new Array();
  Object.setPrototypeOf(arr, CSSOM.CSSRuleList.prototype);
  return arr;
};

CSSOM.CSSRuleList.prototype = Object.create(Array.prototype);
CSSOM.CSSRuleList.prototype.constructor = CSSOM.CSSRuleList;

CSSOM.CSSRuleList.prototype.item = function(index) {
    return this[index] || null;
};


//.CommonJS
exports.CSSRuleList = CSSOM.CSSRuleList;
///CommonJS
