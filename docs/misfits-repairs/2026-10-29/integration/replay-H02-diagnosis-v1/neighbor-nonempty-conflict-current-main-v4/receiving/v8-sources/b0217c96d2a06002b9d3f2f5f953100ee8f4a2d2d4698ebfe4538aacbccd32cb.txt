//.CommonJS
var CSSOM = {
    CSSRule: require("./CSSRule").CSSRule,
    CSSRuleList: require("./CSSRuleList").CSSRuleList,
    MatcherList: require("./MatcherList").MatcherList
};
///CommonJS


/**
 * @constructor
 * @see https://developer.mozilla.org/en/CSS/@-moz-document
 * @deprecated This rule is a non-standard Mozilla-specific extension and is not part of any official CSS specification.
 */
CSSOM.CSSDocumentRule = function CSSDocumentRule() {
    CSSOM.CSSRule.call(this);
    this.matcher = new CSSOM.MatcherList();
    this.cssRules = new CSSOM.CSSRuleList();
};

CSSOM.CSSDocumentRule.prototype = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSDocumentRule.prototype.constructor = CSSOM.CSSDocumentRule;

Object.setPrototypeOf(CSSOM.CSSDocumentRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSDocumentRule.prototype, "type", {
	value: 10,
	writable: false
});

//FIXME
//CSSOM.CSSDocumentRule.prototype.insertRule = CSSStyleSheet.prototype.insertRule;
//CSSOM.CSSDocumentRule.prototype.deleteRule = CSSStyleSheet.prototype.deleteRule;

Object.defineProperty(CSSOM.CSSDocumentRule.prototype, "cssText", {
  get: function() {
    var cssTexts = [];
    for (var i=0, length=this.cssRules.length; i < length; i++) {
        cssTexts.push(this.cssRules[i].cssText);
    }
    return "@-moz-document " + this.matcher.matcherText + " {" + (cssTexts.length ? "\n  " + cssTexts.join("\n  ") : "") + "\n}";
  }
});


//.CommonJS
exports.CSSDocumentRule = CSSOM.CSSDocumentRule;
///CommonJS
