//.CommonJS
var CSSOM = {};
///CommonJS


/**
 * @constructor
 * @see http://dev.w3.org/csswg/cssom/#the-medialist-interface
 */
CSSOM.MediaList = function MediaList(){
	this.length = 0;
};

CSSOM.MediaList.prototype = {

	constructor: CSSOM.MediaList,

	/**
	 * @return {string}
	 */
	get mediaText() {
		return Array.prototype.join.call(this, ", ");
	},

	/**
	 * @param {string} value
	 */
	set mediaText(value) {
		if (typeof value === "string") {
			var values = value.split(",").filter(function(text){
				return !!text;
			});
			var length = this.length = values.length;
			for (var i=0; i<length; i++) {
				this[i] = values[i].trim();
			}
		} else if (value === null) {
			var length = this.length;
			for (var i = 0; i < length; i++) {
				delete this[i];
			}
			this.length = 0;
		}
	},

	/**
	 * @param {string} medium
	 */
	appendMedium: function(medium) {
		if (Array.prototype.indexOf.call(this, medium) === -1) {
			this[this.length] = medium;
			this.length++;
		}
	},

	/**
	 * @param {string} medium
	 */
	deleteMedium: function(medium) {
		var index = Array.prototype.indexOf.call(this, medium);
		if (index !== -1) {
			Array.prototype.splice.call(this, index, 1);
		}
	},

	item: function(index) {
		return this[index] || null;
	},

	toString: function() {
		return this.mediaText;
	}
};


//.CommonJS
exports.MediaList = CSSOM.MediaList;
///CommonJS
