//.CommonJS
var CSSOM = {};
///CommonJS

/**
 * Parses a CSS string and returns a `CSSStyleSheet` object representing the parsed stylesheet.
 *
 * @param {string} token - The CSS string to parse.
 * @param {object} [opts] - Optional parsing options.
 * @param {object} [opts.globalObject] - An optional global object to prioritize over the window object. Useful on jsdom webplatform tests.
 * @param {Element | ProcessingInstruction} [opts.ownerNode] - The owner node of the stylesheet.
 * @param {CSSRule} [opts.ownerRule] - The owner rule of the stylesheet.
 * @param {CSSOM.CSSStyleSheet} [opts.styleSheet] - Reuse a style sheet instead of creating a new one (e.g. as `parentStyleSheet`)
 * @param {CSSOM.CSSRuleList} [opts.cssRules] - Prepare all rules in this list instead of mutating the style sheet continually
 * @param {function|boolean} [errorHandler] - Optional error handler function or `true` to use `console.error`.
 * @returns {CSSOM.CSSStyleSheet} The parsed `CSSStyleSheet` object.
 */
CSSOM.parse = function parse(token, opts, errorHandler) {
	errorHandler = errorHandler === true ? (console && console.error) : errorHandler;

	var i = 0;

	/**
		"before-selector" or
		"selector" or
		"atRule" or
		"atBlock" or
		"conditionBlock" or
		"before-name" or
		"name" or
		"before-value" or
		"value"
	*/
	var state = "before-selector";

	var index;
	var buffer = "";
	var valueParenthesisDepth = 0;

	var SIGNIFICANT_WHITESPACE = {
		"name": true,
		"before-name": true,
		"selector": true,
		"value": true,
		"value-parenthesis": true,
		"atRule": true,
		"importRule-begin": true,
		"importRule": true,
		"namespaceRule-begin": true,
		"namespaceRule": true,
		"atBlock": true,
		"containerBlock": true,
		"conditionBlock": true,
		"counterStyleBlock": true,
		"propertyBlock": true,
		'documentRule-begin': true,
		"scopeBlock": true,
		"layerBlock": true,
		"pageBlock": true
	};

	var styleSheet;
	if (opts && opts.styleSheet) {
		styleSheet = opts.styleSheet;
	} else {
		if (opts && opts.globalObject && opts.globalObject.CSSStyleSheet) {
			styleSheet = new opts.globalObject.CSSStyleSheet();
		} else {
			styleSheet = new CSSOM.CSSStyleSheet();
		}
		styleSheet.__constructed = false;
	}

	var topScope;
	if (opts && opts.cssRules) {
		topScope = { cssRules: opts.cssRules };
	} else {
		topScope = styleSheet;
	}

	if (opts && opts.ownerNode) {
		styleSheet.__ownerNode = opts.ownerNode;
		var ownerNodeMedia = opts.ownerNode.media || (opts.ownerNode.getAttribute && opts.ownerNode.getAttribute("media"));
		if (ownerNodeMedia) {
			styleSheet.media.mediaText = ownerNodeMedia;
		}
		var ownerNodeTitle = opts.ownerNode.title || (opts.ownerNode.getAttribute && opts.ownerNode.getAttribute("title"));
		if (ownerNodeTitle) {
			styleSheet.__title = ownerNodeTitle;
		}
	}

	if (opts && opts.ownerRule) {
		styleSheet.__ownerRule = opts.ownerRule;
	}

	// @type CSSStyleSheet|CSSMediaRule|CSSContainerRule|CSSSupportsRule|CSSFontFaceRule|CSSKeyframesRule|CSSDocumentRule
	var currentScope = topScope;

	// @type CSSMediaRule|CSSContainerRule|CSSSupportsRule|CSSKeyframesRule|CSSDocumentRule
	var parentRule;

	var ancestorRules = [];
	var prevScope;

	var name, priority = "", styleRule, mediaRule, containerRule, counterStyleRule, propertyRule, supportsRule, importRule, fontFaceRule, keyframesRule, documentRule, hostRule, startingStyleRule, scopeRule, pageRule, layerBlockRule, layerStatementRule, nestedSelectorRule, namespaceRule;

	// Track defined namespace prefixes for validation
	var definedNamespacePrefixes = {};

	var atKeyframesRegExp = /@(-(?:\w+-)+)?keyframes/g; // Match @keyframes and vendor-prefixed @keyframes
	// Regex above is not ES5 compliant
	// var atRulesStatemenRegExp = /(?<!{.*)[;}]\s*/; // Match a statement by verifying it finds a semicolon or closing brace not followed by another semicolon or closing brace
	var beforeRulePortionRegExp = /{(?!.*{)|}(?!.*})|;(?!.*;)|\*\/(?!.*\*\/)/g; // Match the closest allowed character (a opening or closing brace, a semicolon or a comment ending) before the rule
	var beforeRuleValidationRegExp = /^[\s{};]*(\*\/\s*)?$/; // Match that the portion before the rule is empty or contains only whitespace, semicolons, opening/closing braces, and optionally a comment ending (*/) followed by whitespace
	var forwardRuleValidationRegExp = /(?:\s|\/\*|\{|\()/; // Match that the rule is followed by any whitespace, a opening comment, a condition opening parenthesis or a opening brace
	var forwardImportRuleValidationRegExp = /(?:\s|\/\*|'|")/; // Match that the rule is followed by any whitespace, an opening comment, a single quote or double quote
	var forwardRuleClosingBraceRegExp = /{[^{}]*}|}/; // Finds the next closing brace of a rule block
	var forwardRuleSemicolonAndOpeningBraceRegExp = /^.*?({|;)/; // Finds the next semicolon or opening brace after the at-rule	
	var cssCustomIdentifierRegExp = /^(-?[_a-zA-Z]+(\.[_a-zA-Z]+)*[_a-zA-Z0-9-]*)$/; // Validates a css custom identifier
	var startsWithCombinatorRegExp = /^\s*[>+~]/; // Checks if a selector starts with a CSS combinator (>, +, ~)
	var atPageRuleSelectorRegExp = /^([^\s:]+)?((?::\w+)*)$/;

	/**
	 * Searches for the first occurrence of a CSS at-rule statement terminator (`;` or `}`) 
	 * that is not inside a brace block within the given string. Mimics the behavior of a 
	 * regular expression match for such terminators, including any trailing whitespace.
	 * @param {string} str - The string to search for at-rule statement terminators.
	 * @returns {object | null} {0: string, index: number} or null if no match is found.
	 */
	function atRulesStatemenRegExpES5Alternative(ruleSlice) {
		for (var i = 0; i < ruleSlice.length; i++) {
			var char = ruleSlice[i];

			if (char === ';' || char === '}') {
				// Simulate negative lookbehind: check if there is a { before this position
				var sliceBefore = ruleSlice.substring(0, i);
				var openBraceIndex = sliceBefore.indexOf('{');

				if (openBraceIndex === -1) {
					// No { found before, so we treat it as a valid match
					var match = char;
					var j = i + 1;

					while (j < ruleSlice.length && /\s/.test(ruleSlice[j])) {
						match += ruleSlice[j];
						j++;
					}

					var matchObj = [match];
					matchObj.index = i;
					matchObj.input = ruleSlice;
					return matchObj;
				}
			}
		}

		return null;
	}

	/**
	 * Finds the first balanced block (including nested braces) in the string, starting from fromIndex.
	 * Returns an object similar to RegExp.prototype.match output.
	 * @param {string} str - The string to search.
	 * @param {number} [fromIndex=0] - The index to start searching from.
	 * @returns {object|null} - { 0: matchedString, index: startIndex, input: str } or null if not found.
	 */
	function matchBalancedBlock(str, fromIndex) {
		fromIndex = fromIndex || 0;
		var openIndex = str.indexOf('{', fromIndex);
		if (openIndex === -1) return null;
		var depth = 0;
		for (var i = openIndex; i < str.length; i++) {
			if (str[i] === '{') {
				depth++;
			} else if (str[i] === '}') {
				depth--;
				if (depth === 0) {
					var matchedString = str.slice(openIndex, i + 1);
					return {
						0: matchedString,
						index: openIndex,
						input: str
					};
				}
			}
		}
		return null;
	}

	/**
	 * Advances the index `i` to skip over a balanced block of curly braces in the given string.
	 * This is typically used to ignore the contents of a CSS rule block.
	 *
	 * @param {number} i - The current index in the string to start searching from.
	 * @param {string} str - The string containing the CSS code.
	 * @param {number} fromIndex - The index in the string where the balanced block search should begin.
	 * @returns {number} The updated index after skipping the balanced block.
	 */
	function ignoreBalancedBlock(i, str, fromIndex) {
		var ruleClosingMatch = matchBalancedBlock(str, fromIndex);
		if (ruleClosingMatch) {
			var ignoreRange = ruleClosingMatch.index + ruleClosingMatch[0].length;
			i += ignoreRange;
			if (token.charAt(i) === '}') {
				i -= 1;
			}
		} else {
			i += str.length;
		}
		return i;
	}

	/**
	 * Parses the scope prelude and extracts start and end selectors.
	 * @param {string} preludeContent - The scope prelude content (without @scope keyword)
	 * @returns {object} Object with startSelector and endSelector properties
	 */
	function parseScopePrelude(preludeContent) {
		var parts = preludeContent.split(/\s*\)\s*to\s+\(/);

		// Restore the parentheses that were consumed by the split
		if (parts.length === 2) {
			parts[0] = parts[0] + ')';
			parts[1] = '(' + parts[1];
		}

		var hasStart = parts[0] &&
			parts[0].charAt(0) === '(' &&
			parts[0].charAt(parts[0].length - 1) === ')';
		var hasEnd = parts[1] &&
			parts[1].charAt(0) === '(' &&
			parts[1].charAt(parts[1].length - 1) === ')';

		// Handle case: @scope to (<end>)
		var hasOnlyEnd = !hasStart &&
			!hasEnd &&
			parts[0].indexOf('to (') === 0 &&
			parts[0].charAt(parts[0].length - 1) === ')';

		var startSelector = '';
		var endSelector = '';

		if (hasStart) {
			startSelector = parts[0].slice(1, -1).trim();
		}
		if (hasEnd) {
			endSelector = parts[1].slice(1, -1).trim();
		}
		if (hasOnlyEnd) {
			endSelector = parts[0].slice(4, -1).trim();
		}

		return {
			startSelector: startSelector,
			endSelector: endSelector,
			hasStart: hasStart,
			hasEnd: hasEnd,
			hasOnlyEnd: hasOnlyEnd
		};
	};

	/**
	 * Checks if a selector contains pseudo-elements.
	 * @param {string} selector - The CSS selector to check
	 * @returns {boolean} True if the selector contains pseudo-elements
	 */
	function hasPseudoElement(selector) {
		// Match only double-colon (::) pseudo-elements
		// Also match legacy single-colon pseudo-elements: :before, :after, :first-line, :first-letter
		// These must NOT be followed by alphanumeric characters (to avoid matching :before-x or similar)
		var pseudoElementRegex = /::[a-zA-Z][\w-]*|:(before|after|first-line|first-letter)(?![a-zA-Z0-9_-])/;
		return pseudoElementRegex.test(selector);
	};

	/**
	 * Validates balanced parentheses, brackets, and quotes in a selector.
	 * 
	 * @param {string} selector - The CSS selector to validate
	 * @param {boolean} trackAttributes - Whether to track attribute selector context
	 * @param {boolean} useStack - Whether to use a stack for parentheses (needed for nested validation)
	 * @returns {boolean} True if the syntax is valid (all brackets, parentheses, and quotes are balanced)
	 */
	function validateBalancedSyntax(selector, trackAttributes, useStack) {
		var parenDepth = 0;
		var bracketDepth = 0;
		var inSingleQuote = false;
		var inDoubleQuote = false;
		var inAttr = false;
		var stack = useStack ? [] : null;

		for (var i = 0; i < selector.length; i++) {
			var char = selector[i];
			var prevChar = i > 0 ? selector[i - 1] : '';

			if (inSingleQuote) {
				if (char === "'" && prevChar !== "\\") {
					inSingleQuote = false;
				}
			} else if (inDoubleQuote) {
				if (char === '"' && prevChar !== "\\") {
					inDoubleQuote = false;
				}
			} else if (trackAttributes && inAttr) {
				if (char === "]") {
					inAttr = false;
				} else if (char === "'") {
					inSingleQuote = true;
				} else if (char === '"') {
					inDoubleQuote = true;
				}
			} else {
				if (trackAttributes && char === "[") {
					inAttr = true;
				} else if (char === "'") {
					inSingleQuote = true;
				} else if (char === '"') {
					inDoubleQuote = true;
				} else if (char === '(') {
					if (useStack) {
						stack.push("(");
					} else {
						parenDepth++;
					}
				} else if (char === ')') {
					if (useStack) {
						if (!stack.length || stack.pop() !== "(") {
							return false;
						}
					} else {
						parenDepth--;
						if (parenDepth < 0) {
							return false;
						}
					}
				} else if (char === '[') {
					bracketDepth++;
				} else if (char === ']') {
					bracketDepth--;
					if (bracketDepth < 0) {
						return false;
					}
				}
			}
		}

		// Check if everything is balanced
		if (useStack) {
			return stack.length === 0 && bracketDepth === 0 && !inSingleQuote && !inDoubleQuote && !inAttr;
		} else {
			return parenDepth === 0 && bracketDepth === 0 && !inSingleQuote && !inDoubleQuote;
		}
	};

	/**
	 * Checks for basic syntax errors in selectors (mismatched parentheses, brackets, quotes).
	 * @param {string} selector - The CSS selector to check
	 * @returns {boolean} True if there are syntax errors
	 */
	function hasBasicSyntaxError(selector) {
		return !validateBalancedSyntax(selector, false, false);
	};

	/**
	 * Checks for invalid combinator patterns in selectors.
	 * @param {string} selector - The CSS selector to check
	 * @returns {boolean} True if the selector contains invalid combinators
	 */
	function hasInvalidCombinators(selector) {
		// Check for invalid combinator patterns:
		// - <> (not a valid combinator)
		// - >> (deep descendant combinator, deprecated and invalid)
		// - Multiple consecutive combinators like >>, >~, etc.
		if (/<>/.test(selector)) return true;
		if (/>>/.test(selector)) return true;
		// Check for other invalid consecutive combinator patterns
		if (/[>+~]\s*[>+~]/.test(selector)) return true;
		return false;
	};

	/**
	 * Checks for invalid pseudo-like syntax (function calls without proper pseudo prefix).
	 * @param {string} selector - The CSS selector to check
	 * @returns {boolean} True if the selector contains invalid pseudo-like syntax
	 */
	function hasInvalidPseudoSyntax(selector) {
		// Check for specific known pseudo-elements used without : or :: prefix
		// Examples: slotted(div), part(name), cue(selector)
		// These are ONLY valid as ::slotted(), ::part(), ::cue()
		var invalidPatterns = [
			/(?:^|[\s>+~,\[])slotted\s*\(/i,
			/(?:^|[\s>+~,\[])part\s*\(/i,
			/(?:^|[\s>+~,\[])cue\s*\(/i,
			/(?:^|[\s>+~,\[])cue-region\s*\(/i
		];

		for (var i = 0; i < invalidPatterns.length; i++) {
			if (invalidPatterns[i].test(selector)) {
				return true;
			}
		}
		return false;
	};

	/**
	 * Checks for invalid nesting selector (&) usage.
	 * The & selector cannot be directly followed by a type selector without a delimiter.
	 * Valid: &.class, &#id, &[attr], &:hover, &::before, & div, &>div
	 * Invalid: &div, &span
	 * @param {string} selector - The CSS selector to check
	 * @returns {boolean} True if the selector contains invalid & usage
	 */
	function hasInvalidNestingSelector(selector) {
		// Check for & followed directly by a letter (type selector) without any delimiter
		// This regex matches & followed by a letter (start of type selector) that's not preceded by an escape
		// We need to exclude valid cases like &.class, &#id, &[attr], &:pseudo, &::pseudo, & (with space), &>
		var invalidNestingPattern = /&(?![.\#\[:>\+~\s])[a-zA-Z]/;
		return invalidNestingPattern.test(selector);
	};

	/**
	 * Checks if an at-rule can be nested based on parent chain validation.
	 * Used for at-rules like `@counter-style`, `@property` and `@font-face` rules that can only be nested inside
	 * `CSSScopeRule` or `CSSConditionRule` without `CSSStyleRule` in parent chain.
	 * @returns {boolean} `true` if nesting is allowed, `false` otherwise
	 */
	function canAtRuleBeNested() {
		if (currentScope === topScope) {
			return true; // Top-level is always allowed
		}

		var hasStyleRuleInChain = false;
		var hasValidParent = false;

		// Check currentScope
		if (currentScope.constructor.name === 'CSSStyleRule') {
			hasStyleRuleInChain = true;
		} else if (currentScope instanceof CSSOM.CSSScopeRule || currentScope instanceof CSSOM.CSSConditionRule) {
			hasValidParent = true;
		}

		// Check ancestorRules for CSSStyleRule
		if (!hasStyleRuleInChain) {
			for (var j = 0; j < ancestorRules.length; j++) {
				if (ancestorRules[j].constructor.name === 'CSSStyleRule') {
					hasStyleRuleInChain = true;
					break;
				}
				if (ancestorRules[j] instanceof CSSOM.CSSScopeRule || ancestorRules[j] instanceof CSSOM.CSSConditionRule) {
					hasValidParent = true;
				}
			}
		}

		// Allow nesting if we have a valid parent and no style rule in the chain
		return hasValidParent && !hasStyleRuleInChain;
	}

	function validateAtRule(atRuleKey, validCallback, cannotBeNested) {
		var isValid = false;
		var sourceRuleRegExp = atRuleKey === "@import" ? forwardImportRuleValidationRegExp : forwardRuleValidationRegExp;
		var ruleRegExp = new RegExp(atRuleKey + sourceRuleRegExp.source, sourceRuleRegExp.flags);
		var ruleSlice = token.slice(i);
		// Not all rules can be nested, if the rule cannot be nested and is in the root scope, do not perform the check
		var shouldPerformCheck = cannotBeNested && currentScope !== topScope ? false : true;
		// First, check if there is no invalid characters just after the at-rule
		if (shouldPerformCheck && ruleSlice.search(ruleRegExp) === 0) {
			// Find the closest allowed character before the at-rule (a opening or closing brace, a semicolon or a comment ending)
			var beforeSlice = token.slice(0, i);
			var regexBefore = new RegExp(beforeRulePortionRegExp.source, beforeRulePortionRegExp.flags);
			var matches = beforeSlice.match(regexBefore);
			var lastI = matches ? beforeSlice.lastIndexOf(matches[matches.length - 1]) : 0;
			var toCheckSlice = token.slice(lastI, i);
			// Check if we don't have any invalid in the portion before the `at-rule` and the closest allowed character
			var checkedSlice = toCheckSlice.search(beforeRuleValidationRegExp);
			if (checkedSlice === 0) {
				isValid = true;
			}
		}

		// Additional validation for @scope rule
		if (isValid && atRuleKey === "@scope") {
			var openBraceIndex = ruleSlice.indexOf('{');
			if (openBraceIndex !== -1) {
				// Extract the rule prelude (everything between the at-rule and {)
				var rulePrelude = ruleSlice.slice(0, openBraceIndex).trim();

				// Skip past at-rule keyword and whitespace
				var preludeContent = rulePrelude.slice("@scope".length).trim();

				if (preludeContent.length > 0) {
					// Parse the scope prelude
					var parsedScopePrelude = parseScopePrelude(preludeContent);
					var startSelector = parsedScopePrelude.startSelector;
					var endSelector = parsedScopePrelude.endSelector;
					var hasStart = parsedScopePrelude.hasStart;
					var hasEnd = parsedScopePrelude.hasEnd;
					var hasOnlyEnd = parsedScopePrelude.hasOnlyEnd;

					// Validation rules for @scope:
					// 1. Empty selectors in parentheses are invalid: @scope () {} or @scope (.a) to () {}
					if ((hasStart && startSelector === '') || (hasEnd && endSelector === '') || (hasOnlyEnd && endSelector === '')) {
						isValid = false;
					}
					// 2. Pseudo-elements are invalid in scope selectors
					else if ((startSelector && hasPseudoElement(startSelector)) || (endSelector && hasPseudoElement(endSelector))) {
						isValid = false;
					}
					// 3. Basic syntax errors (mismatched parens, brackets, quotes)
					else if ((startSelector && hasBasicSyntaxError(startSelector)) || (endSelector && hasBasicSyntaxError(endSelector))) {
						isValid = false;
					}
					// 4. Invalid combinator patterns
					else if ((startSelector && hasInvalidCombinators(startSelector)) || (endSelector && hasInvalidCombinators(endSelector))) {
						isValid = false;
					}
					// 5. Invalid pseudo-like syntax (function without : or :: prefix)
					else if ((startSelector && hasInvalidPseudoSyntax(startSelector)) || (endSelector && hasInvalidPseudoSyntax(endSelector))) {
						isValid = false;
					}
					// 6. Invalid structure (no proper parentheses found when prelude is not empty)
					else if (!hasStart && !hasOnlyEnd) {
						isValid = false;
					}
				}
				// Empty prelude (@scope {}) is valid
			}
		}

		if (isValid && atRuleKey === "@page") {
			var openBraceIndex = ruleSlice.indexOf('{');
			if (openBraceIndex !== -1) {
				// Extract the rule prelude (everything between the at-rule and {)
				var rulePrelude = ruleSlice.slice(0, openBraceIndex).trim();

				// Skip past at-rule keyword and whitespace
				var preludeContent = rulePrelude.slice("@page".length).trim();

				if (preludeContent.length > 0) {
					var trimmedValue = preludeContent.trim();

					// Empty selector is valid for @page
					if (trimmedValue !== '') {
						// Parse @page selectorText for page name and pseudo-pages
						// Valid formats:
						// - (empty - no name, no pseudo-page)
						// - :left, :right, :first, :blank (pseudo-page only)
						// - named (named page only)
						// - named:first (named page with single pseudo-page)
						// - named:first:left (named page with multiple pseudo-pages)
						var match = trimmedValue.match(atPageRuleSelectorRegExp);
						if (match) {
							var pageName = match[1] || '';
							var pseudoPages = match[2] || '';

							// Validate page name if present
							if (pageName) {
								if (!cssCustomIdentifierRegExp.test(pageName)) {
									isValid = false;
								}
							}

							// Validate pseudo-pages if present
							if (pseudoPages) {
								var pseudos = pseudoPages.split(':').filter(function (p) { return p; });
								var validPseudos = ['left', 'right', 'first', 'blank'];
								var allValid = true;
								for (var j = 0; j < pseudos.length; j++) {
									if (validPseudos.indexOf(pseudos[j].toLowerCase()) === -1) {
										allValid = false;
										break;
									}
								}

								if (!allValid) {
									isValid = false;
								}
							}
						} else {
							isValid = false;
						}
					}

				}
			}
		}

		if (!isValid) {
			// If it's invalid the browser will simply ignore the entire invalid block
			// Use regex to find the closing brace of the invalid rule

			// Regex used above is not ES5 compliant. Using alternative.
			// var ruleStatementMatch = ruleSlice.match(atRulesStatemenRegExp); //
			var ruleStatementMatch = atRulesStatemenRegExpES5Alternative(ruleSlice);

			// If it's a statement inside a nested rule, ignore only the statement
			if (ruleStatementMatch && currentScope !== topScope) {
				var ignoreEnd = ruleStatementMatch[0].indexOf(";");
				i += ruleStatementMatch.index + ignoreEnd;
				return;
			}

			// Check if there's a semicolon before the invalid at-rule and the first opening brace
			if (atRuleKey === "@layer") {
				var ruleSemicolonAndOpeningBraceMatch = ruleSlice.match(forwardRuleSemicolonAndOpeningBraceRegExp);
				if (ruleSemicolonAndOpeningBraceMatch && ruleSemicolonAndOpeningBraceMatch[1] === ";") {
					// Ignore the rule block until the semicolon
					i += ruleSemicolonAndOpeningBraceMatch.index + ruleSemicolonAndOpeningBraceMatch[0].length;
					state = "before-selector";
					return;
				}
			}

			// Ignore the entire rule block (if it's a statement it should ignore the statement plus the next block)
			i = ignoreBalancedBlock(i, ruleSlice);
			state = "before-selector";
		} else {
			validCallback.call(this);
		}
	}

	// Helper functions for looseSelectorValidator
	// Defined outside to avoid recreation on every validation call

	/**
	 * Check if character is a valid identifier start
	 * @param {string} c - Character to check
	 * @returns {boolean}
	 */
	function isIdentStart(c) {
		return /[a-zA-Z_\u00A0-\uFFFF]/.test(c);
	}

	/**
	 * Check if character is a valid identifier character
	 * @param {string} c - Character to check
	 * @returns {boolean}
	 */
	function isIdentChar(c) {
		return /[a-zA-Z0-9_\u00A0-\uFFFF\-]/.test(c);
	}

	/**
	 * Helper function to validate CSS selector syntax without regex backtracking.
	 * Iteratively parses the selector string to identify valid components.
	 * 
	 * Supports:
	 * - Escaped special characters (e.g., .class\!, #id\@name)
	 * - Namespace selectors (ns|element, *|element, |element)
	 * - All standard CSS selectors (class, ID, type, attribute, pseudo, etc.)
	 * - Combinators (>, +, ~, whitespace)
	 * - Nesting selector (&)
	 * 
	 * This approach eliminates exponential backtracking by using explicit character-by-character
	 * parsing instead of nested quantifiers in regex.
	 * 
	 * @param {string} selector - The selector to validate
	 * @returns {boolean} - True if valid selector syntax
	 */
	function looseSelectorValidator(selector) {
		if (!selector || selector.length === 0) {
			return false;
		}

		var i = 0;
		var len = selector.length;
		var hasMatchedComponent = false;

		// Helper: Skip escaped character (backslash + any char)
		function skipEscape() {
			if (i < len && selector[i] === '\\') {
				i += 2; // Skip backslash and next character
				return true;
			}
			return false;
		}

		// Helper: Parse identifier (with possible escapes)
		function parseIdentifier() {
			var start = i;
			while (i < len) {
				if (skipEscape()) {
					continue;
				} else if (isIdentChar(selector[i])) {
					i++;
				} else {
					break;
				}
			}
			return i > start;
		}

		// Helper: Parse namespace prefix (optional)
		function parseNamespace() {
			var start = i;

			// Match: *| or identifier| or |
			if (i < len && selector[i] === '*') {
				i++;
			} else if (i < len && (isIdentStart(selector[i]) || selector[i] === '\\')) {
				parseIdentifier();
			}

			if (i < len && selector[i] === '|') {
				i++;
				return true;
			}

			// Rollback if no pipe found
			i = start;
			return false;
		}

		// Helper: Parse pseudo-class/element arguments (with balanced parens)
		function parsePseudoArgs() {
			if (i >= len || selector[i] !== '(') {
				return false;
			}

			i++; // Skip opening paren
			var depth = 1;
			var inString = false;
			var stringChar = '';

			while (i < len && depth > 0) {
				var c = selector[i];

				if (c === '\\' && i + 1 < len) {
					i += 2; // Skip escaped character
				} else if (!inString && (c === '"' || c === '\'')) {
					inString = true;
					stringChar = c;
					i++;
				} else if (inString && c === stringChar) {
					inString = false;
					i++;
				} else if (!inString && c === '(') {
					depth++;
					i++;
				} else if (!inString && c === ')') {
					depth--;
					i++;
				} else {
					i++;
				}
			}

			return depth === 0;
		}

		// Main parsing loop
		while (i < len) {
			var matched = false;
			var start = i;

			// Skip whitespace
			while (i < len && /\s/.test(selector[i])) {
				i++;
			}
			if (i > start) {
				hasMatchedComponent = true;
				continue;
			}

			// Match combinators: >, +, ~
			if (i < len && /[>+~]/.test(selector[i])) {
				i++;
				hasMatchedComponent = true;
				// Skip trailing whitespace
				while (i < len && /\s/.test(selector[i])) {
					i++;
				}
				continue;
			}

			// Match nesting selector: &
			if (i < len && selector[i] === '&') {
				i++;
				hasMatchedComponent = true;
				matched = true;
			}
			// Match class selector: .identifier
			else if (i < len && selector[i] === '.') {
				i++;
				if (parseIdentifier()) {
					hasMatchedComponent = true;
					matched = true;
				}
			}
			// Match ID selector: #identifier
			else if (i < len && selector[i] === '#') {
				i++;
				if (parseIdentifier()) {
					hasMatchedComponent = true;
					matched = true;
				}
			}
			// Match pseudo-class/element: :identifier or ::identifier
			else if (i < len && selector[i] === ':') {
				i++;
				if (i < len && selector[i] === ':') {
					i++; // Pseudo-element
				}
				if (parseIdentifier()) {
					parsePseudoArgs(); // Optional arguments
					hasMatchedComponent = true;
					matched = true;
				}
			}
			// Match attribute selector: [...]
			else if (i < len && selector[i] === '[') {
				i++;
				var depth = 1;
				while (i < len && depth > 0) {
					if (selector[i] === '\\') {
						i += 2;
					} else if (selector[i] === '\'') {
						i++;
						while (i < len && selector[i] !== '\'') {
							if (selector[i] === '\\') i += 2;
							else i++;
						}
						if (i < len) i++; // Skip closing quote
					} else if (selector[i] === '"') {
						i++;
						while (i < len && selector[i] !== '"') {
							if (selector[i] === '\\') i += 2;
							else i++;
						}
						if (i < len) i++; // Skip closing quote
					} else if (selector[i] === '[') {
						depth++;
						i++;
					} else if (selector[i] === ']') {
						depth--;
						i++;
					} else {
						i++;
					}
				}
				if (depth === 0) {
					hasMatchedComponent = true;
					matched = true;
				}
			}
			// Match type selector with optional namespace: [namespace|]identifier
			else if (i < len && (isIdentStart(selector[i]) || selector[i] === '\\' || selector[i] === '*' || selector[i] === '|')) {
				parseNamespace(); // Optional namespace prefix

				if (i < len && selector[i] === '*') {
					i++; // Universal selector
					hasMatchedComponent = true;
					matched = true;
				} else if (i < len && (isIdentStart(selector[i]) || selector[i] === '\\')) {
					if (parseIdentifier()) {
						hasMatchedComponent = true;
						matched = true;
					}
				}
			}

			// If no match found, invalid selector
			if (!matched && i === start) {
				return false;
			}
		}

		return hasMatchedComponent;
	}

	/**
	 * Validates a basic CSS selector, allowing for deeply nested balanced parentheses in pseudo-classes.
	 * This function replaces the previous basicSelectorRegExp.
	 * 
	 * This function matches:
	 * - Type selectors (e.g., `div`, `span`)
	 * - Universal selector (`*`)
	 * - Namespace selectors (e.g., `*|div`, `custom|div`, `|div`)
	 * - ID selectors (e.g., `#header`, `#a\ b`, `#åèiöú`)
	 * - Class selectors (e.g., `.container`, `.a\ b`, `.åèiöú`)
	 * - Attribute selectors (e.g., `[type="text"]`)
	 * - Pseudo-classes and pseudo-elements (e.g., `:hover`, `::before`, `:nth-child(2)`)
	 * - Pseudo-classes with nested parentheses, including cases where parentheses are nested inside arguments,
	 *   such as `:has(.sel:nth-child(3n))`
	 * - The parent selector (`&`)
	 * - Combinators (`>`, `+`, `~`) with optional whitespace
	 * - Whitespace (descendant combinator)
	 *
	 * Unicode and escape sequences are allowed in identifiers.
	 *
	 * @param {string} selector
	 * @returns {boolean}
	 */
	function basicSelectorValidator(selector) {
		// Guard against extremely long selectors to prevent potential regex performance issues
		// Reasonable selectors are typically under 1000 characters
		if (selector.length > 10000) {
			return false;
		}

		// Validate balanced syntax with attribute tracking and stack-based parentheses matching
		if (!validateBalancedSyntax(selector, true, true)) {
			return false;
		}

		// Check for invalid combinator patterns
		if (hasInvalidCombinators(selector)) {
			return false;
		}

		// Check for invalid pseudo-like syntax
		if (hasInvalidPseudoSyntax(selector)) {
			return false;
		}

		// Check for invalid nesting selector (&) usage
		if (hasInvalidNestingSelector(selector)) {
			return false;
		}

		// Check for invalid pseudo-class usage with quoted strings
		// Pseudo-classes like :lang(), :dir(), :nth-*() should not accept quoted strings
		// Using iterative parsing instead of regex to avoid exponential backtracking
		var noQuotesPseudos = ['lang', 'dir', 'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type'];

		for (var idx = 0; idx < selector.length; idx++) {
			// Look for pseudo-class/element start
			if (selector[idx] === ':') {
				var pseudoStart = idx;
				idx++;

				// Skip second colon for pseudo-elements
				if (idx < selector.length && selector[idx] === ':') {
					idx++;
				}

				// Extract pseudo name
				var nameStart = idx;
				while (idx < selector.length && /[a-zA-Z0-9\-]/.test(selector[idx])) {
					idx++;
				}

				if (idx === nameStart) {
					continue; // No name found
				}

				var pseudoName = selector.substring(nameStart, idx).toLowerCase();

				// Check if this pseudo has arguments
				if (idx < selector.length && selector[idx] === '(') {
					idx++;
					var contentStart = idx;
					var depth = 1;

					// Find matching closing paren (handle nesting)
					while (idx < selector.length && depth > 0) {
						if (selector[idx] === '\\') {
							idx += 2; // Skip escaped character
						} else if (selector[idx] === '(') {
							depth++;
							idx++;
						} else if (selector[idx] === ')') {
							depth--;
							idx++;
						} else {
							idx++;
						}
					}

					if (depth === 0) {
						var pseudoContent = selector.substring(contentStart, idx - 1);

						// Check if this pseudo should not have quoted strings
						for (var j = 0; j < noQuotesPseudos.length; j++) {
							if (pseudoName === noQuotesPseudos[j] && /['"]/.test(pseudoContent)) {
								return false;
							}
						}
					}
				}
			}
		}

		// Use the iterative validator to avoid regex backtracking issues
		return looseSelectorValidator(selector);
	}

	/**
	 * Regular expression to match CSS pseudo-classes with arguments.
	 *
	 * Matches patterns like `:pseudo-class(argument)`, capturing the pseudo-class name and its argument.
	 *
	 * Capture groups:
	 *   1. The pseudo-class name (letters and hyphens).
	 *   2. The argument inside the parentheses (can contain nested parentheses, quoted strings, and other characters.).
	 *
	 * Global flag (`g`) is used to find all matches in the input string.
	 *
	 * Example matches:
	 *   - :nth-child(2n+1)
	 *   - :has(.sel:nth-child(3n))
	 *   - :not(".foo, .bar")
	 *
	 * REPLACED WITH FUNCTION to avoid exponential backtracking.
	 */

	/**
	 * Extract pseudo-classes with arguments from a selector using iterative parsing.
	 * Replaces the previous globalPseudoClassRegExp to avoid exponential backtracking.
	 * 
	 * Handles:
	 * - Regular content without parentheses or quotes
	 * - Single-quoted strings
	 * - Double-quoted strings  
	 * - Nested parentheses (arbitrary depth)
	 * 
	 * @param {string} selector - The CSS selector to parse
	 * @returns {Array} Array of matches, each with: [fullMatch, pseudoName, pseudoArgs, startIndex]
	 */
	function extractPseudoClasses(selector) {
		var matches = [];

		for (var i = 0; i < selector.length; i++) {
			// Look for pseudo-class start (single or double colon)
			if (selector[i] === ':') {
				var pseudoStart = i;
				i++;

				// Skip second colon for pseudo-elements (::)
				if (i < selector.length && selector[i] === ':') {
					i++;
				}

				// Extract pseudo name
				var nameStart = i;
				while (i < selector.length && /[a-zA-Z\-]/.test(selector[i])) {
					i++;
				}

				if (i === nameStart) {
					continue; // No name found
				}

				var pseudoName = selector.substring(nameStart, i);

				// Check if this pseudo has arguments
				if (i < selector.length && selector[i] === '(') {
					i++;
					var argsStart = i;
					var depth = 1;
					var inSingleQuote = false;
					var inDoubleQuote = false;

					// Find matching closing paren (handle nesting and strings)
					while (i < selector.length && depth > 0) {
						var ch = selector[i];

						if (ch === '\\') {
							i += 2; // Skip escaped character
						} else if (ch === "'" && !inDoubleQuote) {
							inSingleQuote = !inSingleQuote;
							i++;
						} else if (ch === '"' && !inSingleQuote) {
							inDoubleQuote = !inDoubleQuote;
							i++;
						} else if (ch === '(' && !inSingleQuote && !inDoubleQuote) {
							depth++;
							i++;
						} else if (ch === ')' && !inSingleQuote && !inDoubleQuote) {
							depth--;
							i++;
						} else {
							i++;
						}
					}

					if (depth === 0) {
						var pseudoArgs = selector.substring(argsStart, i - 1);
						var fullMatch = selector.substring(pseudoStart, i);

						// Store match in same format as regex: [fullMatch, pseudoName, pseudoArgs, startIndex]
						matches.push([fullMatch, pseudoName, pseudoArgs, pseudoStart]);
					}

					// Move back one since loop will increment
					i--;
				}
			}
		}

		return matches;
	}

	/**
	 * Parses a CSS selector string and splits it into parts, handling nested parentheses.
	 *
	 * This function is useful for splitting selectors that may contain nested function-like
	 * syntax (e.g., :not(.foo, .bar)), ensuring that commas inside parentheses do not split
	 * the selector.
	 *
	 * @param {string} selector - The CSS selector string to parse.
	 * @returns {string[]} An array of selector parts, split by top-level commas, with whitespace trimmed.
	 */
	function parseAndSplitNestedSelectors(selector) {
		var depth = 0;           // Track parenthesis nesting depth
		var buffer = "";         // Accumulate characters for current selector part
		var parts = [];          // Array of split selector parts
		var inSingleQuote = false; // Track if we're inside single quotes
		var inDoubleQuote = false; // Track if we're inside double quotes
		var i, char;

		for (i = 0; i < selector.length; i++) {
			char = selector.charAt(i);

			// Handle single quote strings
			if (char === "'" && !inDoubleQuote) {
				inSingleQuote = !inSingleQuote;
				buffer += char;
			}
			// Handle double quote strings
			else if (char === '"' && !inSingleQuote) {
				inDoubleQuote = !inDoubleQuote;
				buffer += char;
			}
			// Process characters outside of quoted strings
			else if (!inSingleQuote && !inDoubleQuote) {
				if (char === '(') {
					// Entering a nested level (e.g., :is(...))
					depth++;
					buffer += char;
				} else if (char === ')') {
					// Exiting a nested level
					depth--;
					buffer += char;
				} else if (char === ',' && depth === 0) {
					// Found a top-level comma separator - split here
					if (buffer.trim()) {
						parts.push(buffer.trim());
					}
					buffer = "";
				} else {
					// Regular character - add to buffer
					buffer += char;
				}
			}
			// Characters inside quoted strings - add to buffer
			else {
				buffer += char;
			}
		}

		// Add any remaining content in buffer as the last part
		if (buffer.trim()) {
			parts.push(buffer.trim());
		}

		return parts;
	}

	/**
	 * Validates a CSS selector string, including handling of nested selectors within certain pseudo-classes.
	 *
	 * This function checks if the provided selector is valid according to the rules defined by
	 * `basicSelectorValidator`. For pseudo-classes that accept selector lists (such as :not, :is, :has, :where),
	 * it recursively validates each nested selector using the same validation logic.
	 *
	 * @param {string} selector - The CSS selector string to validate.
	 * @returns {boolean} Returns `true` if the selector is valid, otherwise `false`.
	 */

	// Cache to store validated selectors (previously a ES6 Map, now an ES5-compliant object)
	var validatedSelectorsCache = {};

	// Only pseudo-classes that accept selector lists should recurse
	var selectorListPseudoClasses = {
		'not': true,
		'is': true,
		'has': true,
		'where': true
	};

	function validateSelector(selector) {
		if (validatedSelectorsCache.hasOwnProperty(selector)) {
			return validatedSelectorsCache[selector];
		}

		// Use function-based parsing to extract pseudo-classes (avoids backtracking)
		var pseudoClassMatches = extractPseudoClasses(selector);

		for (var j = 0; j < pseudoClassMatches.length; j++) {
			var pseudoClass = pseudoClassMatches[j][1];
			if (selectorListPseudoClasses.hasOwnProperty(pseudoClass)) {
				var nestedSelectors = parseAndSplitNestedSelectors(pseudoClassMatches[j][2]);

				// Check if ANY selector in the list contains & (nesting selector)
				// If so, skip validation for the entire selector list since & will be replaced at runtime
				var hasAmpersand = false;
				for (var k = 0; k < nestedSelectors.length; k++) {
					if (/&/.test(nestedSelectors[k])) {
						hasAmpersand = true;
						break;
					}
				}

				// If any selector has &, skip validation for this entire pseudo-class
				if (hasAmpersand) {
					continue;
				}

				// Otherwise, validate each selector normally
				for (var i = 0; i < nestedSelectors.length; i++) {
					var nestedSelector = nestedSelectors[i];
					if (!validatedSelectorsCache.hasOwnProperty(nestedSelector)) {
						var nestedSelectorValidation = validateSelector(nestedSelector);
						validatedSelectorsCache[nestedSelector] = nestedSelectorValidation;
						if (!nestedSelectorValidation) {
							validatedSelectorsCache[selector] = false;
							return false;
						}
					} else if (!validatedSelectorsCache[nestedSelector]) {
						validatedSelectorsCache[selector] = false;
						return false;
					}
				}
			}
		}

		var basicSelectorValidation = basicSelectorValidator(selector);
		validatedSelectorsCache[selector] = basicSelectorValidation;

		return basicSelectorValidation;
	}

	/**
	 * Validates namespace selectors by checking if the namespace prefix is defined.
	 * 
	 * @param {string} selector - The CSS selector to validate
	 * @returns {boolean} Returns true if the namespace is valid, false otherwise
	 */
	function validateNamespaceSelector(selector) {
		// Check if selector contains a namespace prefix
		// We need to ignore pipes inside attribute selectors
		var pipeIndex = -1;
		var inAttr = false;
		var inSingleQuote = false;
		var inDoubleQuote = false;

		for (var i = 0; i < selector.length; i++) {
			var char = selector[i];

			if (inSingleQuote) {
				if (char === "'" && selector[i - 1] !== "\\") {
					inSingleQuote = false;
				}
			} else if (inDoubleQuote) {
				if (char === '"' && selector[i - 1] !== "\\") {
					inDoubleQuote = false;
				}
			} else if (inAttr) {
				if (char === "]") {
					inAttr = false;
				} else if (char === "'") {
					inSingleQuote = true;
				} else if (char === '"') {
					inDoubleQuote = true;
				}
			} else {
				if (char === "[") {
					inAttr = true;
				} else if (char === "|" && !inAttr) {
					// This is a namespace separator, not an attribute operator
					pipeIndex = i;
					break;
				}
			}
		}

		if (pipeIndex === -1) {
			return true; // No namespace, always valid
		}

		var namespacePrefix = selector.substring(0, pipeIndex);

		// Universal namespace (*|) and default namespace (|) are always valid
		if (namespacePrefix === '*' || namespacePrefix === '') {
			return true;
		}

		// Check if the custom namespace prefix is defined
		return definedNamespacePrefixes.hasOwnProperty(namespacePrefix);
	}

	/**
	 * Processes a CSS selector text 
	 * 
	 * @param {string} selectorText - The CSS selector text to process
	 * @returns {string} The processed selector text with normalized whitespace and invalid selectors removed
	 */
	function processSelectorText(selectorText) {
		// Normalize whitespace first
		var normalized = selectorText.replace(/(['"])(?:\\.|[^\\])*?\1|(\r\n|\r|\n)/g, function (match, _, newline) {
			if (newline) return " ";
			return match;
		});

		// Recursively process pseudo-classes to handle nesting
		return processNestedPseudoClasses(normalized);
	}

	/**
	 * Recursively processes pseudo-classes to filter invalid selectors
	 * 
	 * @param {string} selectorText - The CSS selector text to process
	 * @param {number} depth - Current recursion depth (to prevent infinite loops)
	 * @returns {string} The processed selector text with invalid selectors removed
	 */
	function processNestedPseudoClasses(selectorText, depth) {
		// Prevent infinite recursion
		if (typeof depth === 'undefined') {
			depth = 0;
		}
		if (depth > 10) {
			return selectorText;
		}

		var pseudoClassMatches = extractPseudoClasses(selectorText);

		// If no pseudo-classes found, return as-is
		if (pseudoClassMatches.length === 0) {
			return selectorText;
		}

		// Build result by processing matches from right to left (to preserve positions)
		var result = selectorText;

		for (var j = pseudoClassMatches.length - 1; j >= 0; j--) {
			var pseudoClass = pseudoClassMatches[j][1];
			if (selectorListPseudoClasses.hasOwnProperty(pseudoClass)) {
				var fullMatch = pseudoClassMatches[j][0];
				var pseudoArgs = pseudoClassMatches[j][2];
				var matchStart = pseudoClassMatches[j][3];

				// Check if ANY selector contains & BEFORE processing
				var nestedSelectorsRaw = parseAndSplitNestedSelectors(pseudoArgs);
				var hasAmpersand = false;
				for (var k = 0; k < nestedSelectorsRaw.length; k++) {
					if (/&/.test(nestedSelectorsRaw[k])) {
						hasAmpersand = true;
						break;
					}
				}

				// If & is present, skip all processing (keep everything unchanged)
				if (hasAmpersand) {
					continue;
				}

				// Recursively process the arguments
				var processedArgs = processNestedPseudoClasses(pseudoArgs, depth + 1);
				var nestedSelectors = parseAndSplitNestedSelectors(processedArgs);

				// Filter out invalid selectors
				var validSelectors = [];
				for (var i = 0; i < nestedSelectors.length; i++) {
					var nestedSelector = nestedSelectors[i];
					if (basicSelectorValidator(nestedSelector)) {
						validSelectors.push(nestedSelector);
					}
				}

				// Reconstruct the pseudo-class with only valid selectors
				var newArgs = validSelectors.join(', ');
				var newPseudoClass = ':' + pseudoClass + '(' + newArgs + ')';

				// Replace in the result string using position (processing right to left preserves positions)
				result = result.substring(0, matchStart) + newPseudoClass + result.substring(matchStart + fullMatch.length);
			}
		}

		return result;

		return normalized;
	}

	/**
	 * Checks if a given CSS selector text is valid by splitting it by commas
	 * and validating each individual selector using the `validateSelector` function.
	 *
	 * @param {string} selectorText - The CSS selector text to validate. Can contain multiple selectors separated by commas.
	 * @returns {boolean} Returns true if all selectors are valid, otherwise false.
	 */
	function isValidSelectorText(selectorText) {
		// TODO: The same validations here needs to be reused in CSSStyleRule.selectorText setter
		// TODO: Move these validation logic to a shared function to be reused in CSSStyleRule.selectorText setter

		// Check for empty selector lists in pseudo-classes (e.g., :is(), :not(), :where(), :has())
		// These are invalid after filtering out invalid selectors
		if (/:(?:is|not|where|has)\(\s*\)/.test(selectorText)) {
			return false;
		}

		// Check for newlines inside single or double quotes using regex
		// This matches any quoted string (single or double) containing a newline
		var quotedNewlineRegExp = /(['"])(?:\\.|[^\\])*?\1/g;
		var match;
		while ((match = quotedNewlineRegExp.exec(selectorText)) !== null) {
			if (/\r|\n/.test(match[0].slice(1, -1))) {
				return false;
			}
		}
		// Split selectorText by commas and validate each part
		var selectors = parseAndSplitNestedSelectors(selectorText);
		for (var i = 0; i < selectors.length; i++) {
			var processedSelectors = selectors[i].trim();
			if (!validateSelector(processedSelectors) || !validateNamespaceSelector(processedSelectors)) {
				return false;
			}
		}
		return true;
	}

	function pushToAncestorRules(rule) {
		if (ancestorRules.indexOf(rule) === -1) {
			ancestorRules.push(rule);
		}
	}

	function parseError(message, isNested) {
		var lines = token.substring(0, i).split('\n');
		var lineCount = lines.length;
		var charCount = lines.pop().length + 1;
		var error = new Error(message + ' (line ' + lineCount + ', char ' + charCount + ')');
		error.line = lineCount;
		/* jshint sub : true */
		error['char'] = charCount;
		error.styleSheet = styleSheet;
		error.isNested = !!isNested;
		// Print the error but continue parsing the sheet
		try {
			throw error;
		} catch (e) {
			errorHandler && errorHandler(e);
		}
	};

	// Helper functions to check character types
	function isSelectorStartChar(char) {
		return '.:#&*['.indexOf(char) !== -1;
	}

	function isWhitespaceChar(char) {
		return ' \t\n\r'.indexOf(char) !== -1;
	}

	var endingIndex = token.length - 1;
	var initialEndingIndex = endingIndex;

	for (var character; (character = token.charAt(i)); i++) {
		if (i === endingIndex) {
			switch (state) {
				case "importRule":
				case "namespaceRule":
				case "layerBlock":
					if (character !== ";") {
						token += ";";
						endingIndex += 1;
					}
					break;
				case "value":
					if (character !== "}") {
						if (character === ";") {
							token += "}"
						} else {
							token += ";";
						}
						endingIndex += 1;
						break;
					}
				case "name":
				case "before-name":
					if (character === "}") {
						token += " "
					} else {
						token += "}"
					}
					endingIndex += 1
					break;
				case "before-selector":
					if (character !== "}" && currentScope !== styleSheet) {
						token += "}"
						endingIndex += 1
						break;
					}
			}
		}

		// Handle escape sequences before processing special characters
		// If we encounter a backslash, add both the backslash and the next character to buffer
		// and skip the next iteration to prevent the escaped character from being interpreted
		if (character === '\\' && i + 1 < token.length) {
			buffer += character + token.charAt(i + 1);
			i++; // Skip the next character
			continue;
		}

		switch (character) {

			case " ":
			case "\t":
			case "\r":
			case "\n":
			case "\f":
				if (SIGNIFICANT_WHITESPACE[state]) {
					buffer += character;
				}
				break;

			// String
			case '"':
				index = i + 1;
				do {
					index = token.indexOf('"', index) + 1;
					if (!index) {
						parseError('Unmatched "');
					}
				} while (token[index - 2] === '\\');
				if (index === 0) {
					break;
				}
				buffer += token.slice(i, index);
				i = index - 1;
				switch (state) {
					case 'before-value':
						state = 'value';
						break;
					case 'importRule-begin':
						state = 'importRule';
						if (i === endingIndex) {
							token += ';'
						}
						break;
					case 'namespaceRule-begin':
						state = 'namespaceRule';
						if (i === endingIndex) {
							token += ';'
						}
						break;
				}
				break;

			case "'":
				index = i + 1;
				do {
					index = token.indexOf("'", index) + 1;
					if (!index) {
						parseError("Unmatched '");
					}
				} while (token[index - 2] === '\\');
				if (index === 0) {
					break;
				}
				buffer += token.slice(i, index);
				i = index - 1;
				switch (state) {
					case 'before-value':
						state = 'value';
						break;
					case 'importRule-begin':
						state = 'importRule';
						break;
					case 'namespaceRule-begin':
						state = 'namespaceRule';
						break;
				}
				break;

			// Comment
			case "/":
				if (token.charAt(i + 1) === "*") {
					i += 2;
					index = token.indexOf("*/", i);
					if (index === -1) {
						i = token.length - 1;
						buffer = "";
					} else {
						i = index + 1;
					}
				} else {
					buffer += character;
				}
				if (state === "importRule-begin") {
					buffer += " ";
					state = "importRule";
				}
				if (state === "namespaceRule-begin") {
					buffer += " ";
					state = "namespaceRule";
				}
				break;

			// At-rule
			case "@":
				if (nestedSelectorRule) {
					if (styleRule && styleRule.constructor.name === "CSSNestedDeclarations") {
						currentScope.cssRules.push(styleRule);
					}
					if (nestedSelectorRule.parentRule && nestedSelectorRule.parentRule.constructor.name === "CSSStyleRule") {
						styleRule = nestedSelectorRule.parentRule;
					}
					// Don't reset nestedSelectorRule here - preserve it through @-rules
				}
				if (token.indexOf("@-moz-document", i) === i) {
					validateAtRule("@-moz-document", function () {
						state = "documentRule-begin";
						documentRule = new CSSOM.CSSDocumentRule();
						documentRule.__starts = i;
						i += "-moz-document".length;
					});
					buffer = "";
					break;
				} else if (token.indexOf("@media", i) === i) {
					validateAtRule("@media", function () {
						state = "atBlock";
						mediaRule = new CSSOM.CSSMediaRule();
						mediaRule.__starts = i;
						i += "media".length;
					});
					buffer = "";
					break;
				} else if (token.indexOf("@container", i) === i) {
					validateAtRule("@container", function () {
						state = "containerBlock";
						containerRule = new CSSOM.CSSContainerRule();
						containerRule.__starts = i;
						i += "container".length;
					});
					buffer = "";
					break;
				} else if (token.indexOf("@counter-style", i) === i) {
					buffer = "";
					// @counter-style can be nested only inside CSSScopeRule or CSSConditionRule
					// and only if there's no CSSStyleRule in the parent chain
					var cannotBeNested = !canAtRuleBeNested();
					validateAtRule("@counter-style", function () {
						state = "counterStyleBlock"
						counterStyleRule = new CSSOM.CSSCounterStyleRule();
						counterStyleRule.__starts = i;
						i += "counter-style".length;
					}, cannotBeNested);
					break;
				} else if (token.indexOf("@property", i) === i) {
					buffer = "";
					// @property can be nested only inside CSSScopeRule or CSSConditionRule
					// and only if there's no CSSStyleRule in the parent chain
					var cannotBeNested = !canAtRuleBeNested();
					validateAtRule("@property", function () {
						state = "propertyBlock"
						propertyRule = new CSSOM.CSSPropertyRule();
						propertyRule.__starts = i;
						i += "property".length;
					}, cannotBeNested);
					break;
				} else if (token.indexOf("@scope", i) === i) {
					validateAtRule("@scope", function () {
						state = "scopeBlock";
						scopeRule = new CSSOM.CSSScopeRule();
						scopeRule.__starts = i;
						i += "scope".length;
					});
					buffer = "";
					break;
				} else if (token.indexOf("@layer", i) === i) {
					validateAtRule("@layer", function () {
						state = "layerBlock"
						layerBlockRule = new CSSOM.CSSLayerBlockRule();
						layerBlockRule.__starts = i;
						i += "layer".length;
					});
					buffer = "";
					break;
				} else if (token.indexOf("@page", i) === i) {
					validateAtRule("@page", function () {
						state = "pageBlock"
						pageRule = new CSSOM.CSSPageRule();
						pageRule.__starts = i;
						i += "page".length;
					});
					buffer = "";
					break;
				} else if (token.indexOf("@supports", i) === i) {
					validateAtRule("@supports", function () {
						state = "conditionBlock";
						supportsRule = new CSSOM.CSSSupportsRule();
						supportsRule.__starts = i;
						i += "supports".length;
					});
					buffer = "";
					break;
				} else if (token.indexOf("@host", i) === i) {
					validateAtRule("@host", function () {
						state = "hostRule-begin";
						i += "host".length;
						hostRule = new CSSOM.CSSHostRule();
						hostRule.__starts = i;
					});
					buffer = "";
					break;
				} else if (token.indexOf("@starting-style", i) === i) {
					validateAtRule("@starting-style", function () {
						state = "startingStyleRule-begin";
						i += "starting-style".length;
						startingStyleRule = new CSSOM.CSSStartingStyleRule();
						startingStyleRule.__starts = i;
					});
					buffer = "";
					break;
				} else if (token.indexOf("@import", i) === i) {
					buffer = "";
					validateAtRule("@import", function () {
						state = "importRule-begin";
						i += "import".length;
						buffer += "@import";
					}, true);
					break;
				} else if (token.indexOf("@namespace", i) === i) {
					buffer = "";
					validateAtRule("@namespace", function () {
						state = "namespaceRule-begin";
						i += "namespace".length;
						buffer += "@namespace";
					}, true);
					break;
				} else if (token.indexOf("@font-face", i) === i) {
					buffer = "";
					// @font-face can be nested only inside CSSScopeRule or CSSConditionRule
					// and only if there's no CSSStyleRule in the parent chain
					var cannotBeNested = !canAtRuleBeNested();
					validateAtRule("@font-face", function () {
						state = "fontFaceRule-begin";
						i += "font-face".length;
						fontFaceRule = new CSSOM.CSSFontFaceRule();
						fontFaceRule.__starts = i;
					}, cannotBeNested);
					break;
				} else {
					atKeyframesRegExp.lastIndex = i;
					var matchKeyframes = atKeyframesRegExp.exec(token);
					if (matchKeyframes && matchKeyframes.index === i) {
						state = "keyframesRule-begin";
						keyframesRule = new CSSOM.CSSKeyframesRule();
						keyframesRule.__starts = i;
						keyframesRule._vendorPrefix = matchKeyframes[1]; // Will come out as undefined if no prefix was found
						i += matchKeyframes[0].length - 1;
						buffer = "";
						break;
					} else if (state === "selector") {
						state = "atRule";
					}
				}
				buffer += character;
				break;

			case "{":
				if (currentScope === topScope) {
					nestedSelectorRule = null;
				}
				if (state === 'before-selector') {
					parseError("Unexpected {");
					i = ignoreBalancedBlock(i, token.slice(i));
					break;
				}
				if (state === "selector" || state === "atRule") {
					if (!nestedSelectorRule && buffer.indexOf(";") !== -1) {
						var ruleClosingMatch = token.slice(i).match(forwardRuleClosingBraceRegExp);
						if (ruleClosingMatch) {
							styleRule = null;
							buffer = "";
							state = "before-selector";
							i += ruleClosingMatch.index + ruleClosingMatch[0].length;
							break;
						}
					}

					// Ensure styleRule exists before trying to set properties on it
					if (!styleRule) {
						styleRule = new CSSOM.CSSStyleRule();
						styleRule.__starts = i;
					}

					var originalParentRule = parentRule;

					if (parentRule) {
						styleRule.__parentRule = parentRule;
						pushToAncestorRules(parentRule);
					}

					currentScope = parentRule = styleRule;
					var processedSelectorText = processSelectorText(buffer.trim());
					// In a nested selector, ensure each selector contains '&' at the beginning, except for selectors that already have '&' somewhere
					if (originalParentRule && originalParentRule.constructor.name === "CSSStyleRule") {
						styleRule.selectorText = parseAndSplitNestedSelectors(processedSelectorText).map(function (sel) {
							// Add & at the beginning if there's no & in the selector, or if it starts with a combinator
							return (sel.indexOf('&') === -1 || startsWithCombinatorRegExp.test(sel)) ? '& ' + sel : sel;
						}).join(', ');
					} else {
						styleRule.selectorText = processedSelectorText;
					}
					styleRule.style.__starts = i;
					styleRule.__parentStyleSheet = styleSheet;
					buffer = "";
					state = "before-name";
				} else if (state === "atBlock") {
					mediaRule.media.mediaText = buffer.trim();

					if (parentRule) {
						mediaRule.__parentRule = parentRule;
						pushToAncestorRules(parentRule);
						// If entering @media from within a CSSStyleRule, set nestedSelectorRule
						// so that & selectors and declarations work correctly inside
						if (parentRule.constructor.name === "CSSStyleRule" && !nestedSelectorRule) {
							nestedSelectorRule = parentRule;
						}
					}

					currentScope = parentRule = mediaRule;
					pushToAncestorRules(mediaRule);
					mediaRule.__parentStyleSheet = styleSheet;
					styleRule = null; // Reset styleRule when entering @-rule
					buffer = "";
					state = "before-selector";
				} else if (state === "containerBlock") {
					containerRule.__conditionText = buffer.trim();

					if (parentRule) {
						containerRule.__parentRule = parentRule;
						pushToAncestorRules(parentRule);
						if (parentRule.constructor.name === "CSSStyleRule" && !nestedSelectorRule) {
							nestedSelectorRule = parentRule;
						}
					}
					currentScope = parentRule = containerRule;
					pushToAncestorRules(containerRule);
					containerRule.__parentStyleSheet = styleSheet;
					styleRule = null; // Reset styleRule when entering @-rule
					buffer = "";
					state = "before-selector";
				} else if (state === "counterStyleBlock") {
					var counterStyleName = buffer.trim().replace(/\n/g, "");
					// Validate: name cannot be empty, contain whitespace, or contain dots
					var isValidCounterStyleName = counterStyleName.length > 0 && !/[\s.]/.test(counterStyleName);

					if (isValidCounterStyleName) {
						counterStyleRule.name = counterStyleName;
						if (parentRule) {
							counterStyleRule.__parentRule = parentRule;
						}
						counterStyleRule.__parentStyleSheet = styleSheet;
						styleRule = counterStyleRule;
					}
					buffer = "";
				} else if (state === "propertyBlock") {
					var propertyName = buffer.trim().replace(/\n/g, "");
					// Validate: name must start with -- (custom property)
					var isValidPropertyName = propertyName.indexOf("--") === 0;

					if (isValidPropertyName) {
						propertyRule.__name = propertyName;
						if (parentRule) {
							propertyRule.__parentRule = parentRule;
						}
						propertyRule.__parentStyleSheet = styleSheet;
						styleRule = propertyRule;
					}
					buffer = "";
				} else if (state === "conditionBlock") {
					supportsRule.__conditionText = buffer.trim();

					if (parentRule) {
						supportsRule.__parentRule = parentRule;
						pushToAncestorRules(parentRule);
						if (parentRule.constructor.name === "CSSStyleRule" && !nestedSelectorRule) {
							nestedSelectorRule = parentRule;
						}
					}

					currentScope = parentRule = supportsRule;
					pushToAncestorRules(supportsRule);
					supportsRule.__parentStyleSheet = styleSheet;
					styleRule = null; // Reset styleRule when entering @-rule
					buffer = "";
					state = "before-selector";
				} else if (state === "scopeBlock") {
					var parsedScopePrelude = parseScopePrelude(buffer.trim());

					if (parsedScopePrelude.hasStart) {
						scopeRule.__start = parsedScopePrelude.startSelector;
					}
					if (parsedScopePrelude.hasEnd) {
						scopeRule.__end = parsedScopePrelude.endSelector;
					}
					if (parsedScopePrelude.hasOnlyEnd) {
						scopeRule.__end = parsedScopePrelude.endSelector;
					}

					if (parentRule) {
						scopeRule.__parentRule = parentRule;
						pushToAncestorRules(parentRule);
						if (parentRule.constructor.name === "CSSStyleRule" && !nestedSelectorRule) {
							nestedSelectorRule = parentRule;
						}
					}
					currentScope = parentRule = scopeRule;
					pushToAncestorRules(scopeRule);
					scopeRule.__parentStyleSheet = styleSheet;
					styleRule = null; // Reset styleRule when entering @-rule
					buffer = "";
					state = "before-selector";
				} else if (state === "layerBlock") {
					layerBlockRule.name = buffer.trim();

					var isValidName = layerBlockRule.name.length === 0 || layerBlockRule.name.match(cssCustomIdentifierRegExp) !== null;

					if (isValidName) {
						if (parentRule) {
							layerBlockRule.__parentRule = parentRule;
							pushToAncestorRules(parentRule);
							if (parentRule.constructor.name === "CSSStyleRule" && !nestedSelectorRule) {
								nestedSelectorRule = parentRule;
							}
						}

						currentScope = parentRule = layerBlockRule;
						pushToAncestorRules(layerBlockRule);
						layerBlockRule.__parentStyleSheet = styleSheet;
					}
					styleRule = null; // Reset styleRule when entering @-rule
					buffer = "";
					state = "before-selector";
				} else if (state === "pageBlock") {
					pageRule.selectorText = buffer.trim();

					if (parentRule) {
						pageRule.__parentRule = parentRule;
						pushToAncestorRules(parentRule);
					}

					currentScope = parentRule = pageRule;
					pageRule.__parentStyleSheet = styleSheet;
					styleRule = pageRule;
					buffer = "";
					state = "before-name";
				} else if (state === "hostRule-begin") {
					if (parentRule) {
						pushToAncestorRules(parentRule);
					}

					currentScope = parentRule = hostRule;
					pushToAncestorRules(hostRule);
					hostRule.__parentStyleSheet = styleSheet;
					buffer = "";
					state = "before-selector";
				} else if (state === "startingStyleRule-begin") {
					if (parentRule) {
						startingStyleRule.__parentRule = parentRule;
						pushToAncestorRules(parentRule);
						if (parentRule.constructor.name === "CSSStyleRule" && !nestedSelectorRule) {
							nestedSelectorRule = parentRule;
						}
					}

					currentScope = parentRule = startingStyleRule;
					pushToAncestorRules(startingStyleRule);
					startingStyleRule.__parentStyleSheet = styleSheet;
					styleRule = null; // Reset styleRule when entering @-rule
					buffer = "";
					state = "before-selector";

				} else if (state === "fontFaceRule-begin") {
					if (parentRule) {
						fontFaceRule.__parentRule = parentRule;
					}
					fontFaceRule.__parentStyleSheet = styleSheet;
					styleRule = fontFaceRule;
					buffer = "";
					state = "before-name";
				} else if (state === "keyframesRule-begin") {
					keyframesRule.name = buffer.trim();
					if (parentRule) {
						pushToAncestorRules(parentRule);
						keyframesRule.__parentRule = parentRule;
					}
					keyframesRule.__parentStyleSheet = styleSheet;
					currentScope = parentRule = keyframesRule;
					buffer = "";
					state = "keyframeRule-begin";
				} else if (state === "keyframeRule-begin") {
					styleRule = new CSSOM.CSSKeyframeRule();
					styleRule.keyText = buffer.trim();
					styleRule.__starts = i;
					buffer = "";
					state = "before-name";
				} else if (state === "documentRule-begin") {
					// FIXME: what if this '{' is in the url text of the match function?
					documentRule.matcher.matcherText = buffer.trim();
					if (parentRule) {
						pushToAncestorRules(parentRule);
						documentRule.__parentRule = parentRule;
					}
					currentScope = parentRule = documentRule;
					pushToAncestorRules(documentRule);
					documentRule.__parentStyleSheet = styleSheet;
					buffer = "";
					state = "before-selector";
				} else if (state === "before-name" || state === "name") {
					// @font-face and similar rules don't support nested selectors
					// If we encounter a nested selector block inside them, skip it
					if (styleRule.constructor.name === "CSSFontFaceRule" ||
						styleRule.constructor.name === "CSSKeyframeRule" ||
						(styleRule.constructor.name === "CSSPageRule" && parentRule === styleRule)) {
						// Skip the nested block
						var ruleClosingMatch = token.slice(i).match(forwardRuleClosingBraceRegExp);
						if (ruleClosingMatch) {
							i += ruleClosingMatch.index + ruleClosingMatch[0].length - 1;
							buffer = "";
							state = "before-name";
							break;
						}
					}

					if (styleRule.constructor.name === "CSSNestedDeclarations") {
						if (styleRule.style.length) {
							parentRule.cssRules.push(styleRule);
							styleRule.__parentRule = parentRule;
							styleRule.__parentStyleSheet = styleSheet;
							pushToAncestorRules(parentRule);
						} else {
							// If the styleRule is empty, we can assume that it's a nested selector
							pushToAncestorRules(parentRule);
						}
					} else {
						currentScope = parentRule = styleRule;
						pushToAncestorRules(parentRule);
						styleRule.__parentStyleSheet = styleSheet;
					}

					styleRule = new CSSOM.CSSStyleRule();
					var processedSelectorText = processSelectorText(buffer.trim());
					// In a nested selector, ensure each selector contains '&' at the beginning, except for selectors that already have '&' somewhere
					if (parentRule.constructor.name === "CSSScopeRule" || (parentRule.constructor.name !== "CSSStyleRule" && parentRule.parentRule === null)) {
						styleRule.selectorText = processedSelectorText;
					} else {
						styleRule.selectorText = parseAndSplitNestedSelectors(processedSelectorText).map(function (sel) {
							// Add & at the beginning if there's no & in the selector, or if it starts with a combinator
							return (sel.indexOf('&') === -1 || startsWithCombinatorRegExp.test(sel)) ? '& ' + sel : sel;
						}).join(', ');
					}
					styleRule.style.__starts = i - buffer.length;
					styleRule.__parentRule = parentRule;
					// Only set nestedSelectorRule if we're directly inside a CSSStyleRule or CSSScopeRule,
					// not inside other grouping rules like @media/@supports
					if (parentRule.constructor.name === "CSSStyleRule" || parentRule.constructor.name === "CSSScopeRule") {
						nestedSelectorRule = styleRule;
					}

					buffer = "";
					state = "before-name";
				}
				break;

			case ":":
				if (state === "name") {
					// It can be a nested selector, let's check
					var openBraceBeforeMatch = token.slice(i).match(/[{;}]/);
					var hasOpenBraceBefore = openBraceBeforeMatch && openBraceBeforeMatch[0] === '{';
					if (hasOpenBraceBefore) {
						// Is a selector
						buffer += character;
					} else {
						// Is a declaration
						name = buffer.trim();
						buffer = "";
						state = "before-value";
					}
				} else {
					buffer += character;
				}
				break;

			case "(":
				if (state === 'value') {
					// ie css expression mode
					if (buffer.trim() === 'expression') {
						var info = (new CSSOM.CSSValueExpression(token, i)).parse();

						if (info.error) {
							parseError(info.error);
						} else {
							buffer += info.expression;
							i = info.idx;
						}
					} else {
						state = 'value-parenthesis';
						//always ensure this is reset to 1 on transition
						//from value to value-parenthesis
						valueParenthesisDepth = 1;
						buffer += character;
					}
				} else if (state === 'value-parenthesis') {
					valueParenthesisDepth++;
					buffer += character;
				} else {
					buffer += character;
				}
				break;

			case ")":
				if (state === 'value-parenthesis') {
					valueParenthesisDepth--;
					if (valueParenthesisDepth === 0) state = 'value';
				}
				buffer += character;
				break;

			case "!":
				if (state === "value" && token.indexOf("!important", i) === i) {
					priority = "important";
					i += "important".length;
				} else {
					buffer += character;
				}
				break;

			case ";":
				switch (state) {
					case "before-value":
					case "before-name":
						parseError("Unexpected ;");
						buffer = "";
						state = "before-name";
						break;
					case "value":
						styleRule.style.setProperty(name, buffer.trim(), priority, parseError);
						priority = "";
						buffer = "";
						state = "before-name";
						break;
					case "atRule":
						buffer = "";
						state = "before-selector";
						break;
					case "importRule":
						var isValid = topScope.cssRules.length === 0 || topScope.cssRules.some(function (rule) {
							return ['CSSImportRule', 'CSSLayerStatementRule'].indexOf(rule.constructor.name) !== -1
						});
						if (isValid) {
							importRule = new CSSOM.CSSImportRule();
							if (opts && opts.globalObject && opts.globalObject.CSSStyleSheet) {
								importRule.__styleSheet = new opts.globalObject.CSSStyleSheet();
							}
							importRule.styleSheet.__constructed = false;
							importRule.__parentStyleSheet = importRule.styleSheet.__parentStyleSheet = styleSheet;
							importRule.parse(buffer + character);
							topScope.cssRules.push(importRule);
						}
						buffer = "";
						state = "before-selector";
						break;
					case "namespaceRule":
						var isValid = topScope.cssRules.length === 0 || topScope.cssRules.every(function (rule) {
							return ['CSSImportRule', 'CSSLayerStatementRule', 'CSSNamespaceRule'].indexOf(rule.constructor.name) !== -1
						});
						if (isValid) {
							try {
								// Validate namespace syntax before creating the rule
								var testNamespaceRule = new CSSOM.CSSNamespaceRule();
								testNamespaceRule.parse(buffer + character);

								namespaceRule = testNamespaceRule;
								namespaceRule.__parentStyleSheet = styleSheet;
								topScope.cssRules.push(namespaceRule);

								// Track the namespace prefix for validation
								if (namespaceRule.prefix) {
									definedNamespacePrefixes[namespaceRule.prefix] = namespaceRule.namespaceURI;
								}
							} catch (e) {
								parseError(e.message);
							}
						}
						buffer = "";
						state = "before-selector";
						break;
					case "layerBlock":
						var nameListStr = buffer.trim().split(",").map(function (name) {
							return name.trim();
						});
						var isInvalid = nameListStr.some(function (name) {
							return name.trim().match(cssCustomIdentifierRegExp) === null;
						});

						// Check if there's a CSSStyleRule in the parent chain
						var hasStyleRuleParent = false;
						if (parentRule) {
							var checkParent = parentRule;
							while (checkParent) {
								if (checkParent.constructor.name === "CSSStyleRule") {
									hasStyleRuleParent = true;
									break;
								}
								checkParent = checkParent.__parentRule;
							}
						}

						if (!isInvalid && !hasStyleRuleParent) {
							layerStatementRule = new CSSOM.CSSLayerStatementRule();
							layerStatementRule.__parentStyleSheet = styleSheet;
							layerStatementRule.__starts = layerBlockRule.__starts;
							layerStatementRule.__ends = i;
							layerStatementRule.nameList = nameListStr;

							// Add to parent rule if nested, otherwise to top scope
							if (parentRule) {
								layerStatementRule.__parentRule = parentRule;
								parentRule.cssRules.push(layerStatementRule);
							} else {
								topScope.cssRules.push(layerStatementRule);
							}
						}
						buffer = "";
						state = "before-selector";
						break;
					default:
						buffer += character;
						break;
				}
				break;

			case "}":
				if (state === "counterStyleBlock") {
					// FIXME : Implement missing properties on CSSCounterStyleRule interface and update parse method
					// For now it's just assigning entire rule text
					if (counterStyleRule.name) {
						// Only process if name was set (valid)
						counterStyleRule.parse("@counter-style " + counterStyleRule.name + " { " + buffer + " }");
						counterStyleRule.__ends = i + 1;
						// Add to parent's cssRules
						if (counterStyleRule.__parentRule) {
							counterStyleRule.__parentRule.cssRules.push(counterStyleRule);
						} else {
							topScope.cssRules.push(counterStyleRule);
						}
					}
					// Restore currentScope to parent after closing this rule
					if (counterStyleRule.__parentRule) {
						currentScope = counterStyleRule.__parentRule;
					}
					styleRule = null;
					buffer = "";
					state = "before-selector";
					break;
				}
				if (state === "propertyBlock") {
					// Only process if name was set (valid)
					if (propertyRule.__name) {
						var parseSuccess = propertyRule.parse("@property " + propertyRule.__name + " { " + buffer + " }");
						// Only add the rule if parse was successful (syntax, inherits, and initial-value validation passed)
						if (parseSuccess) {
							propertyRule.__ends = i + 1;
							// Add to parent's cssRules
							if (propertyRule.__parentRule) {
								propertyRule.__parentRule.cssRules.push(propertyRule);
							} else {
								topScope.cssRules.push(propertyRule);
							}
						}
					}
					// Restore currentScope to parent after closing this rule
					if (propertyRule.__parentRule) {
						currentScope = propertyRule.__parentRule;
					}
					styleRule = null;
					buffer = "";
					state = "before-selector";
					break;
				}
				switch (state) {
					case "value":
						styleRule.style.setProperty(name, buffer.trim(), priority, parseError);
						priority = "";
					/* falls through */
					case "before-value":
					case "before-name":
					case "name":
						styleRule.__ends = i + 1;

						if (parentRule === styleRule) {
							parentRule = ancestorRules.pop()
						}

						if (parentRule) {
							styleRule.__parentRule = parentRule;
						}
						styleRule.__parentStyleSheet = styleSheet;

						if (currentScope === styleRule) {
							currentScope = parentRule || topScope;
						}

						if (styleRule.constructor.name === "CSSStyleRule" && !isValidSelectorText(styleRule.selectorText)) {
							if (styleRule === nestedSelectorRule) {
								nestedSelectorRule = null;
							}
							parseError('Invalid CSSStyleRule (selectorText = "' + styleRule.selectorText + '")', styleRule.parentRule !== null);
						} else {
							if (styleRule.parentRule) {
								styleRule.parentRule.cssRules.push(styleRule);
							} else {
								currentScope.cssRules.push(styleRule);
							}
						}
						buffer = "";
						if (currentScope.constructor === CSSOM.CSSKeyframesRule) {
							state = "keyframeRule-begin";
						} else {
							state = "before-selector";
						}

						if (styleRule.constructor.name === "CSSNestedDeclarations") {
							if (currentScope !== topScope) {
								// Only set nestedSelectorRule if currentScope is CSSStyleRule or CSSScopeRule
								// Not for other grouping rules like @media/@supports
								if (currentScope.constructor.name === "CSSStyleRule" || currentScope.constructor.name === "CSSScopeRule") {
									nestedSelectorRule = currentScope;
								}
							}
							styleRule = null;
						} else {
							// Update nestedSelectorRule when closing a CSSStyleRule
							if (styleRule === nestedSelectorRule) {
								var selector = styleRule.selectorText && styleRule.selectorText.trim();
								// Check if this is proper nesting (&.class, &:pseudo) vs prepended & (& :is, & .class with space)
								// Prepended & has pattern "& X" where X starts with : or .
								var isPrependedAmpersand = selector && selector.match(/^&\s+[:\.]/);

								// Check if parent is a grouping rule that can contain nested selectors
								var isGroupingRule = currentScope && currentScope instanceof CSSOM.CSSGroupingRule;

								if (!isPrependedAmpersand && isGroupingRule) {
									// Proper nesting - set nestedSelectorRule to parent for more nested selectors
									// But only if it's a CSSStyleRule or CSSScopeRule, not other grouping rules like @media
									if (currentScope.constructor.name === "CSSStyleRule" || currentScope.constructor.name === "CSSScopeRule") {
										nestedSelectorRule = currentScope;
									}
									// If currentScope is another type of grouping rule (like @media), keep nestedSelectorRule unchanged
								} else {
									// Prepended & or not nested in grouping rule - reset to prevent CSSNestedDeclarations
									nestedSelectorRule = null;
								}
							} else if (nestedSelectorRule && currentScope instanceof CSSOM.CSSGroupingRule) {
								// When closing a nested rule that's not the nestedSelectorRule itself,
								// maintain nestedSelectorRule if we're still inside a grouping rule
								// This ensures declarations after nested selectors inside @media/@supports etc. work correctly
							}
							styleRule = null;
							break;
						}
					case "keyframeRule-begin":
					case "before-selector":
					case "selector":
						// End of media/supports/document rule.
						if (!parentRule) {
							parseError("Unexpected }");

							var hasPreviousStyleRule = currentScope.cssRules.length && currentScope.cssRules[currentScope.cssRules.length - 1].constructor.name === "CSSStyleRule";
							if (hasPreviousStyleRule) {
								i = ignoreBalancedBlock(i, token.slice(i), 1);
							}

							break;
						}

						// Find the actual parent rule by popping from ancestor stack
						while (ancestorRules.length > 0) {
							parentRule = ancestorRules.pop();

							// Skip if we popped the current scope itself (happens because we push both rule and parent)
							if (parentRule === currentScope) {
								continue;
							}

							// Only process valid grouping rules
							if (!(parentRule instanceof CSSOM.CSSGroupingRule && (parentRule.constructor.name !== 'CSSStyleRule' || parentRule.__parentRule))) {
								continue;
							}

							// Determine if we're closing a special nested selector context
							var isClosingNestedSelectorContext = nestedSelectorRule && 
								(currentScope === nestedSelectorRule || nestedSelectorRule.__parentRule === currentScope);

							if (isClosingNestedSelectorContext) {
								// Closing the nestedSelectorRule or its direct container
								if (nestedSelectorRule.parentRule) {
									// Add nestedSelectorRule to its parent and update scope
									prevScope = nestedSelectorRule;
									currentScope = nestedSelectorRule.parentRule;
									if (currentScope.cssRules.indexOf(prevScope) === -1) {
										currentScope.cssRules.push(prevScope);
									}
									nestedSelectorRule = currentScope;
									// Stop here to preserve context for sibling selectors
									break;
								} else {
									// Top-level CSSStyleRule with nested grouping rule
									prevScope = currentScope;
									var actualParent = ancestorRules.length > 0 ? ancestorRules[ancestorRules.length - 1] : nestedSelectorRule;
									if (actualParent !== prevScope) {
										actualParent.cssRules.push(prevScope);
									}
									currentScope = actualParent;
									parentRule = actualParent;
									break;
								}
							} else {
								// Regular case: add currentScope to parentRule
								prevScope = currentScope;
								if (parentRule !== prevScope) {
									parentRule.cssRules.push(prevScope);
								}
								break;
							}
						}

						// If currentScope has a __parentRule and wasn't added yet, add it
						if (ancestorRules.length === 0 && currentScope.__parentRule && currentScope.__parentRule.cssRules) {
							if (currentScope.__parentRule.cssRules.findIndex(function (rule) {
								return rule === currentScope
							}) === -1) {
								currentScope.__parentRule.cssRules.push(currentScope);
							}
						}

						// Only handle top-level rule closing if we processed all ancestors
						if (ancestorRules.length === 0 && currentScope.parentRule == null) {
							currentScope.__ends = i + 1;
							if (currentScope !== topScope && topScope.cssRules.findIndex(function (rule) {
								return rule === currentScope
							}) === -1) {
								topScope.cssRules.push(currentScope);
							}
							currentScope = topScope;
							if (nestedSelectorRule === parentRule) {
								// Check if this selector is really starting inside another selector
								var nestedSelectorTokenToCurrentSelectorToken = token.slice(nestedSelectorRule.__starts, i + 1);
								var openingBraceMatch = nestedSelectorTokenToCurrentSelectorToken.match(/{/g);
								var closingBraceMatch = nestedSelectorTokenToCurrentSelectorToken.match(/}/g);
								var openingBraceLen = openingBraceMatch && openingBraceMatch.length;
								var closingBraceLen = closingBraceMatch && closingBraceMatch.length;

								if (openingBraceLen === closingBraceLen) {
									// If the number of opening and closing braces are equal, we can assume that the new selector is starting outside the nestedSelectorRule
									nestedSelectorRule.__ends = i + 1;
									nestedSelectorRule = null;
									parentRule = null;
								}
							} else {
								parentRule = null;
							}
						} else {
							currentScope = parentRule;
						}

						buffer = "";
						state = "before-selector";
						break;
				}
				break;

			default:
				switch (state) {
					case "before-selector":
						state = "selector";
						if ((styleRule || scopeRule) && parentRule) {
							// Assuming it's a declaration inside Nested Selector OR a Nested Declaration
							// If Declaration inside Nested Selector let's keep the same styleRule
							if (!isSelectorStartChar(character) && !isWhitespaceChar(character) && parentRule instanceof CSSOM.CSSGroupingRule) {
								// parentRule.__parentRule = styleRule;
								state = "before-name";
								if (styleRule !== parentRule) {
									styleRule = new CSSOM.CSSNestedDeclarations();
									styleRule.__starts = i;
								}
							}

						} else if (nestedSelectorRule && parentRule && parentRule instanceof CSSOM.CSSGroupingRule) {
							if (isSelectorStartChar(character)) {
								// If starting with a selector character, create CSSStyleRule instead of CSSNestedDeclarations
								styleRule = new CSSOM.CSSStyleRule();
								styleRule.__starts = i;
							} else if (!isWhitespaceChar(character)) {
								// Starting a declaration (not whitespace, not a selector)
								state = "before-name";
								// Check if we should create CSSNestedDeclarations
								// This happens if: parent has cssRules OR nestedSelectorRule exists (indicating CSSStyleRule in hierarchy)
								if (parentRule.cssRules.length || nestedSelectorRule) {
									currentScope = parentRule;
									// Only set nestedSelectorRule if parentRule is CSSStyleRule or CSSScopeRule
									if (parentRule.constructor.name === "CSSStyleRule" || parentRule.constructor.name === "CSSScopeRule") {
										nestedSelectorRule = parentRule;
									}
									styleRule = new CSSOM.CSSNestedDeclarations();
									styleRule.__starts = i;
								} else {
									if (parentRule.constructor.name === "CSSStyleRule") {
										styleRule = parentRule;
									} else {
										styleRule = new CSSOM.CSSStyleRule();
										styleRule.__starts = i;
									}
								}
							}
						}
						break;
					case "before-name":
						state = "name";
						break;
					case "before-value":
						state = "value";
						break;
					case "importRule-begin":
						state = "importRule";
						break;
					case "namespaceRule-begin":
						state = "namespaceRule";
						break;
				}
				buffer += character;
				break;
		}

		// Auto-close all unclosed nested structures
		// Check AFTER processing the character, at the ORIGINAL ending index
		// Only add closing braces if CSS is incomplete (not at top scope)
		if (i === initialEndingIndex && (currentScope !== topScope || ancestorRules.length > 0)) {
			var needsClosing = ancestorRules.length;
			if (currentScope !== topScope && ancestorRules.indexOf(currentScope) === -1) {
				needsClosing += 1;
			}
			// Add closing braces for all unclosed structures
			for (var closeIdx = 0; closeIdx < needsClosing; closeIdx++) {
				token += "}";
				endingIndex += 1;
			}
		}
	}

	if (buffer.trim() !== "") {
		parseError("Unexpected end of input");
	}

	return styleSheet;
};


//.CommonJS
exports.parse = CSSOM.parse;
// The following modules cannot be included sooner due to the mutual dependency with parse.js
CSSOM.CSSStyleSheet = require("./CSSStyleSheet").CSSStyleSheet;
CSSOM.CSSStyleRule = require("./CSSStyleRule").CSSStyleRule;
CSSOM.CSSNestedDeclarations = require("./CSSNestedDeclarations").CSSNestedDeclarations;
CSSOM.CSSImportRule = require("./CSSImportRule").CSSImportRule;
CSSOM.CSSNamespaceRule = require("./CSSNamespaceRule").CSSNamespaceRule;
CSSOM.CSSGroupingRule = require("./CSSGroupingRule").CSSGroupingRule;
CSSOM.CSSMediaRule = require("./CSSMediaRule").CSSMediaRule;
CSSOM.CSSCounterStyleRule = require("./CSSCounterStyleRule").CSSCounterStyleRule;
CSSOM.CSSPropertyRule = require("./CSSPropertyRule").CSSPropertyRule;
CSSOM.CSSContainerRule = require("./CSSContainerRule").CSSContainerRule;
CSSOM.CSSConditionRule = require("./CSSConditionRule").CSSConditionRule;
CSSOM.CSSSupportsRule = require("./CSSSupportsRule").CSSSupportsRule;
CSSOM.CSSFontFaceRule = require("./CSSFontFaceRule").CSSFontFaceRule;
CSSOM.CSSHostRule = require("./CSSHostRule").CSSHostRule;
CSSOM.CSSStartingStyleRule = require("./CSSStartingStyleRule").CSSStartingStyleRule;
CSSOM.CSSStyleDeclaration = require('./CSSStyleDeclaration').CSSStyleDeclaration;
CSSOM.CSSKeyframeRule = require('./CSSKeyframeRule').CSSKeyframeRule;
CSSOM.CSSKeyframesRule = require('./CSSKeyframesRule').CSSKeyframesRule;
CSSOM.CSSValueExpression = require('./CSSValueExpression').CSSValueExpression;
CSSOM.CSSDocumentRule = require('./CSSDocumentRule').CSSDocumentRule;
CSSOM.CSSScopeRule = require('./CSSScopeRule').CSSScopeRule;
CSSOM.CSSLayerBlockRule = require("./CSSLayerBlockRule").CSSLayerBlockRule;
CSSOM.CSSLayerStatementRule = require("./CSSLayerStatementRule").CSSLayerStatementRule;
CSSOM.CSSPageRule = require("./CSSPageRule").CSSPageRule;
// Use cssstyle if available
require("./cssstyleTryCatchBlock");
///CommonJS
