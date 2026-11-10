//.CommonJS
var CSSOM = {
	CSSStyleDeclaration: require("./CSSStyleDeclaration").CSSStyleDeclaration,
	CSSRule: require("./CSSRule").CSSRule,
	CSSRuleList: require("./CSSRuleList").CSSRuleList,
	CSSGroupingRule: require("./CSSGroupingRule").CSSGroupingRule,
};
// Use cssstyle if available
try {
	CSSOM.CSSStyleDeclaration = require("cssstyle").CSSStyleDeclaration;
} catch (e) {
	// ignore
}
///CommonJS


/**
 * @constructor
 * @see https://drafts.csswg.org/cssom/#the-csspagerule-interface
 */
CSSOM.CSSPageRule = function CSSPageRule() {
	CSSOM.CSSGroupingRule.call(this);
	this.__style = new CSSOM.CSSStyleDeclaration();
	this.__style.parentRule = this;
};

CSSOM.CSSPageRule.prototype = Object.create(CSSOM.CSSGroupingRule.prototype);
CSSOM.CSSPageRule.prototype.constructor = CSSOM.CSSPageRule;

Object.setPrototypeOf(CSSOM.CSSPageRule, CSSOM.CSSGroupingRule);

Object.defineProperty(CSSOM.CSSPageRule.prototype, "type", {
	value: 6,
	writable: false
});

Object.defineProperty(CSSOM.CSSPageRule.prototype, "selectorText", {
    get: function() {
        return this.__selectorText;	
    },
    set: function(value) {
        if (typeof value === "string") {
            var trimmedValue = value.trim();
            
            // Empty selector is valid for @page
            if (trimmedValue === '') {
                this.__selectorText = '';
                return;
            }
            
            // Parse @page selectorText for page name and pseudo-pages
            // Valid formats:
            // - (empty - no name, no pseudo-page)
            // - :left, :right, :first, :blank (pseudo-page only)
            // - named (named page only)
            // - named:first (named page with single pseudo-page)
            // - named:first:left (named page with multiple pseudo-pages)
			var atPageRuleSelectorRegExp = /^([^\s:]+)?((?::\w+)*)$/;
            var match = trimmedValue.match(atPageRuleSelectorRegExp);
            if (match) {
				var pageName = match[1] || '';
                var pseudoPages = match[2] || '';

				// Validate page name if present
				if (pageName) {
					var cssCustomIdentifierRegExp = /^(-?[_a-zA-Z]+(\.[_a-zA-Z]+)*[_a-zA-Z0-9-]*)$/; // Validates a css custom identifier
					// Page name can be an identifier or a string
					if (!cssCustomIdentifierRegExp.test(pageName)) {
						return;
					}
				}
                
                // Validate pseudo-pages if present
                if (pseudoPages) {
                    var pseudos = pseudoPages.split(':').filter(function(p) { return p; });
                    var validPseudos = ['left', 'right', 'first', 'blank'];
                    var allValid = true;
                    for (var j = 0; j < pseudos.length; j++) {
                        if (validPseudos.indexOf(pseudos[j].toLowerCase()) === -1) {
                            allValid = false;
                            break;
                        }
                    }
                    
                    if (!allValid) {
                        return; // Invalid pseudo-page, do nothing
                    }
                }
                
				this.__selectorText = pageName + pseudoPages.toLowerCase();
            }
        }
    }
});

Object.defineProperty(CSSOM.CSSPageRule.prototype, "style", {
	get: function() {
		return this.__style;	
	},
	set: function(value) {
		if (typeof value === "string") {
			this.__style.cssText = value;
		} else {
			this.__style = value;
		}
	}
});

Object.defineProperty(CSSOM.CSSPageRule.prototype, "cssText", {
	get: function() {
        var values = "";
        if (this.cssRules.length) {
            var valuesArr = [" {"];
            this.style.cssText && valuesArr.push(this.style.cssText);
            valuesArr.push(this.cssRules.reduce(function(acc, rule){ 
				if (rule.cssText !== "") {
					acc.push(rule.cssText);
				}
				return acc;
			}, []).join("\n  "));
            values = valuesArr.join("\n  ") + "\n}";
        } else {
            values = " {" + (this.style.cssText ? " " + this.style.cssText : "") + " }";
        }
		return "@page" + (this.selectorText ? " " + this.selectorText : "") + values;
	}
});

//.CommonJS
exports.CSSPageRule = CSSOM.CSSPageRule;
///CommonJS
