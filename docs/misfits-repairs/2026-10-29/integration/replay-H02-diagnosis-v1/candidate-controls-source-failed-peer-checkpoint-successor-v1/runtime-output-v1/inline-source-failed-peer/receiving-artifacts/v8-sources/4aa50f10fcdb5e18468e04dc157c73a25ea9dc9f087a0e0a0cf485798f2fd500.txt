//.CommonJS
var CSSOM = {
	CSSRule: require("./CSSRule").CSSRule,
	CSSStyleSheet: require("./CSSStyleSheet").CSSStyleSheet,
	MediaList: require("./MediaList").MediaList
};
///CommonJS


/**
 * @constructor
 * @see http://dev.w3.org/csswg/cssom/#cssimportrule
 * @see http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSImportRule
 */
CSSOM.CSSImportRule = function CSSImportRule() {
	CSSOM.CSSRule.call(this);
	this.__href = "";
	this.__media = new CSSOM.MediaList();
  this.__layerName = null;
  this.__supportsText = null;
	this.__styleSheet = new CSSOM.CSSStyleSheet();
};

CSSOM.CSSImportRule.prototype = Object.create(CSSOM.CSSRule.prototype);
CSSOM.CSSImportRule.prototype.constructor = CSSOM.CSSImportRule;

Object.setPrototypeOf(CSSOM.CSSImportRule, CSSOM.CSSRule);

Object.defineProperty(CSSOM.CSSImportRule.prototype, "type", {
	value: 3,
	writable: false
});

Object.defineProperty(CSSOM.CSSImportRule.prototype, "cssText", {
  get: function() {
    var mediaText = this.media.mediaText;
    return "@import url(\"" + this.href.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + "\")" + (this.layerName !== null ? " layer" + (this.layerName && "(" + this.layerName + ")") : "" ) + (this.supportsText ? " supports(" + this.supportsText + ")" : "" ) + (mediaText ? " " + mediaText : "") + ";";
  }
});

Object.defineProperty(CSSOM.CSSImportRule.prototype, "href", {
  get: function() {
    return this.__href;
  }
});

Object.defineProperty(CSSOM.CSSImportRule.prototype, "media", {
  get: function() {
    return this.__media;
  },
	set: function(value) {
		if (typeof value === "string") {
			this.__media.mediaText = value;
		} else {
			this.__media = value;
		}
	}
});

Object.defineProperty(CSSOM.CSSImportRule.prototype, "layerName", {
  get: function() {
    return this.__layerName;
  }
});

Object.defineProperty(CSSOM.CSSImportRule.prototype, "supportsText", {
  get: function() {
    return this.__supportsText;
  }
});

Object.defineProperty(CSSOM.CSSImportRule.prototype, "styleSheet", {
  get: function() {
    return this.__styleSheet;
  }
});

/**
 * NON-STANDARD
 * Rule text parser.
 * @param {string} cssText
 */
Object.defineProperty(CSSOM.CSSImportRule.prototype, "parse", {
  value: function(cssText) {
    var i = 0;

    /**
     * @import url(partial.css) screen, handheld;
     *        ||               |
     *        after-import     media
     *         |
     *         url
     */
    var state = '';

    var buffer = '';
    var index;

    var layerRegExp = /layer\(([^)]*)\)/;
    var layerRuleNameRegExp = /^(-?[_a-zA-Z]+(\.[_a-zA-Z]+)*[_a-zA-Z0-9-]*)$/;
    var doubleOrMoreSpacesRegExp = /\s{2,}/g;
    
    /**
     * Extracts the content inside supports() handling nested parentheses.
     * @param {string} text - The text to parse
     * @returns {object|null} - {content: string, endIndex: number} or null if not found
     */
    function extractSupportsContent(text) {
      var supportsIndex = text.indexOf('supports(');
      if (supportsIndex !== 0) {
        return null;
      }
      
      var depth = 0;
      var start = supportsIndex + 'supports('.length;
      var i = start;
      
      for (; i < text.length; i++) {
        if (text[i] === '(') {
          depth++;
        } else if (text[i] === ')') {
          if (depth === 0) {
            // Found the closing parenthesis for supports()
            return {
              content: text.slice(start, i),
              endIndex: i
            };
          }
          depth--;
        }
      }
      
      return null; // Unbalanced parentheses
    }

    for (var character; (character = cssText.charAt(i)); i++) {

      switch (character) {
        case ' ':
        case '\t':
        case '\r':
        case '\n':
        case '\f':
          if (state === 'after-import') {
            state = 'url';
          } else {
            buffer += character;
          }
          break;

        case '@':
          if (!state && cssText.indexOf('@import', i) === i) {
            state = 'after-import';
            i += 'import'.length;
            buffer = '';
          }
          break;

        case 'u':
          if (state === 'media') {
            buffer += character;
          }
          if (state === 'url' && cssText.indexOf('url(', i) === i) {
            index = cssText.indexOf(')', i + 1);
            if (index === -1) {
              throw i + ': ")" not found';
            }
            i += 'url('.length;
            var url = cssText.slice(i, index);
            if (url[0] === url[url.length - 1]) {
              if (url[0] === '"' || url[0] === "'") {
                url = url.slice(1, -1);
              }
            }
            this.__href = url;
            i = index;
            state = 'media';
          }
          break;

        case '"':
          if (state === 'after-import' || state === 'url') {
            index = cssText.indexOf('"', i + 1);
            if (!index) {
              throw i + ": '\"' not found";
            }
            this.__href = cssText.slice(i + 1, index);
            i = index;
            state = 'media';
          }
          break;

        case "'":
          if (state === 'after-import' || state === 'url') {
            index = cssText.indexOf("'", i + 1);
            if (!index) {
              throw i + ': "\'" not found';
            }
            this.__href = cssText.slice(i + 1, index);
            i = index;
            state = 'media';
          }
          break;

        case ';':
          if (state === 'media') {
            if (buffer) {
              var bufferTrimmed = buffer.trim();
              
              if (bufferTrimmed.indexOf('layer') === 0) {
                var layerMatch =  bufferTrimmed.match(layerRegExp);

                if (layerMatch) {
                  var layerName = layerMatch[1].trim();

                  if (layerName.match(layerRuleNameRegExp) !== null) {
                    this.__layerName = layerMatch[1].trim();
                    bufferTrimmed = bufferTrimmed.replace(layerRegExp, '')
                      .replace(doubleOrMoreSpacesRegExp, ' ') // Replace double or more spaces with single space
                      .trim();
                  } else {
                    // REVIEW: In the browser, an empty layer() is not processed as a unamed layer
                    // and treats the rest of the string as mediaText, ignoring the parse of supports()
                    if (bufferTrimmed) {
                      this.media.mediaText = bufferTrimmed;
                      return;
                    }
                  }
                } else {
                  this.__layerName = "";
                  bufferTrimmed = bufferTrimmed.substring('layer'.length).trim()
                }
              }

              var supportsResult = extractSupportsContent(bufferTrimmed);

              if (supportsResult) {
                // REVIEW: In the browser, an empty supports() invalidates and ignores the entire @import rule
                this.__supportsText = supportsResult.content.trim();
                // Remove the entire supports(...) from the buffer
                bufferTrimmed = bufferTrimmed.slice(0, 0) + bufferTrimmed.slice(supportsResult.endIndex + 1);
                bufferTrimmed = bufferTrimmed.replace(doubleOrMoreSpacesRegExp, ' ').trim();
              }

              // REVIEW: In the browser, any invalid media is replaced with 'not all'
              if (bufferTrimmed) {
                this.media.mediaText = bufferTrimmed;
              }
            }
          }
          break;

        default:
          if (state === 'media') {
            buffer += character;
          }
          break;
      }
    }
  }
});


//.CommonJS
exports.CSSImportRule = CSSOM.CSSImportRule;
///CommonJS
