//.CommonJS
var CSSOM = {};
///CommonJS

// NOTE: Check viability to add a validation for css values or use a dependency like csstree-validator
/**
 * Regular expression to detect invalid characters in the value portion of a CSS style declaration.
 *
 * This regex matches a colon (:) that is not inside parentheses and not inside single or double quotes.
 * It is used to ensure that the value part of a CSS property does not contain unexpected colons,
 * which would indicate a malformed declaration (e.g., "color: foo:bar;" is invalid).
 *
 * The negative lookahead `(?![^(]*\))` ensures that the colon is not followed by a closing
 * parenthesis without encountering an opening parenthesis, effectively ignoring colons inside
 * function-like values (e.g., `url(data:image/png;base64,...)`).
 *
 * The lookahead `(?=(?:[^'"]|'[^']*'|"[^"]*")*$)` ensures that the colon is not inside single or double quotes,
 * allowing colons within quoted strings (e.g., `content: ":";` or `background: url("foo:bar.png");`).
 *
 * Example:
 *   "color: red;"         // valid, does not match
 *   "background: url(data:image/png;base64,...);" // valid, does not match
 *   "content: ':';"       // valid, does not match
 *   "color: foo:bar;"     // invalid, matches
 */
var basicStylePropertyValueValidationRegExp = /:(?![^(]*\))(?=(?:[^'"]|'[^']*'|"[^"]*")*$)/;

/**
 * @constructor
 * @see http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSStyleDeclaration
 */
CSSOM.CSSStyleDeclaration = function CSSStyleDeclaration(){
	this.length = 0;
	this.parentRule = null;

	// NON-STANDARD
	this._importants = {};
};


CSSOM.CSSStyleDeclaration.prototype = {

	constructor: CSSOM.CSSStyleDeclaration,

	/**
	 *
	 * @param {string} name
	 * @see http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSStyleDeclaration-getPropertyValue
	 * @return {string} the value of the property if it has been explicitly set for this declaration block.
	 * Returns the empty string if the property has not been set.
	 */
	getPropertyValue: function(name) {
		return this[name] || "";
	},

	/**
	 *
	 * @param {string} name
	 * @param {string} value
	 * @param {string} [priority=null] "important" or null
	 * @see http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSStyleDeclaration-setProperty
	 */
	setProperty: function(name, value, priority, parseErrorHandler) 
	{
		// NOTE: Check viability to add a validation for css values or use a dependency like csstree-validator
		if (basicStylePropertyValueValidationRegExp.test(value)) {
			parseErrorHandler && parseErrorHandler('Invalid CSSStyleDeclaration property (name = "' + name + '", value = "' + value + '")');
		} else if (this[name]) {
			// Property already exist. Overwrite it.
			var index = Array.prototype.indexOf.call(this, name);
			if (index < 0) {
				this[this.length] = name;
				this.length++;
			}
	
			// If the priority value of the incoming property is "important",
			// or the value of the existing property is not "important", 
			// then remove the existing property and rewrite it.
			if (priority || !this._importants[name]) {
				this.removeProperty(name);
				this[this.length] = name;
				this.length++;
				this[name] = value + '';
				this._importants[name] = priority;
			}
		} else {
			// New property.
			this[this.length] = name;
			this.length++;
			this[name] = value + '';
			this._importants[name] = priority;
		}
	},

	/**
	 *
	 * @param {string} name
	 * @see http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSStyleDeclaration-removeProperty
	 * @return {string} the value of the property if it has been explicitly set for this declaration block.
	 * Returns the empty string if the property has not been set or the property name does not correspond to a known CSS property.
	 */
	removeProperty: function(name) {
		if (!(name in this)) {
			return "";
		}
		var index = Array.prototype.indexOf.call(this, name);
		if (index < 0) {
			return "";
		}
		var prevValue = this[name];
		this[name] = "";

		// That's what WebKit and Opera do
		Array.prototype.splice.call(this, index, 1);

		// That's what Firefox does
		//this[index] = ""

		return prevValue;
	},

	getPropertyCSSValue: function() {
		//FIXME
	},

	/**
	 *
	 * @param {String} name
	 */
	getPropertyPriority: function(name) {
		return this._importants[name] || "";
	},


	/**
	 *   element.style.overflow = "auto"
	 *   element.style.getPropertyShorthand("overflow-x")
	 *   -> "overflow"
	 */
	getPropertyShorthand: function() {
		//FIXME
	},

	isPropertyImplicit: function() {
		//FIXME
	},

	// Doesn't work in IE < 9
	get cssText(){
		var properties = [];
		for (var i=0, length=this.length; i < length; ++i) {
			var name = this[i];
			var value = this.getPropertyValue(name);
			var priority = this.getPropertyPriority(name);
			if (priority) {
				priority = " !" + priority;
			}
			properties[i] = name + ": " + value + priority + ";";
		}
		return properties.join(" ");
	},

	set cssText(text){
		var i, name;
		for (i = this.length; i--;) {
			name = this[i];
			this[name] = "";
		}
		Array.prototype.splice.call(this, 0, this.length);
		this._importants = {};

		var dummyRule = CSSOM.parse('#bogus{' + text + '}').cssRules[0].style;
		var length = dummyRule.length;
		for (i = 0; i < length; ++i) {
			name = dummyRule[i];
			this.setProperty(dummyRule[i], dummyRule.getPropertyValue(name), dummyRule.getPropertyPriority(name));
		}
	}
};


//.CommonJS
exports.CSSStyleDeclaration = CSSOM.CSSStyleDeclaration;
CSSOM.parse = require('./parse').parse; // Cannot be included sooner due to the mutual dependency between parse.js and CSSStyleDeclaration.js
///CommonJS
