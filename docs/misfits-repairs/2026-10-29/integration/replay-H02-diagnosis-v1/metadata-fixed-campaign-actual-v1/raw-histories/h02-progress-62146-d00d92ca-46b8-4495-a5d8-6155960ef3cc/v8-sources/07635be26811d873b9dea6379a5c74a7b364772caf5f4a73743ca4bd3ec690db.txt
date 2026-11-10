//.CommonJS
var CSSOM = {
	MediaList: require("./MediaList").MediaList
};
///CommonJS


/**
 * @see http://dev.w3.org/csswg/cssom/#the-stylesheet-interface
 */
CSSOM.StyleSheet = function StyleSheet() {
	this.__href = null;
	this.__ownerNode = null;
	this.__title = null;
	this.__media = new CSSOM.MediaList();
	this.__parentStyleSheet = null;
	this.disabled = false;
};

Object.defineProperties(CSSOM.StyleSheet.prototype, {
	type: {
		get: function() {
			return "text/css";
		}
	},
	href: {
		get: function() {
			return this.__href;
		}
	},
	ownerNode: {
		get: function() {
			return this.__ownerNode;
		}
	},
	title: {
		get: function() {
			return this.__title;
		}
	},
	media: {
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
	},
	parentStyleSheet: {
		get: function() {
			return this.__parentStyleSheet;
		}
	}
});

//.CommonJS
exports.StyleSheet = CSSOM.StyleSheet;
///CommonJS
