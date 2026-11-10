var CSSOM = {
  /**
   * Creates and configures a new CSSOM instance with the specified options.
   * 
   * @param {Object} opts - Configuration options for the CSSOM instance
   * @param {Object} [opts.globalObject] - Optional global object to be assigned to CSSOM objects prototype
   * @returns {Object} A new CSSOM instance with the applied configuration
   * @description
   * This method creates a new instance of CSSOM and optionally
   * configures CSSStyleSheet with a global object reference. When a globalObject is provided
   * and CSSStyleSheet exists on the instance, it creates a new CSSStyleSheet constructor
   * using a factory function and assigns the globalObject to its prototype's __globalObject property.
   */
  setup: function (opts) {
    var instance = Object.create(this);
    if (opts.globalObject) {
      if (instance.CSSStyleSheet) {
        const factoryCSSStyleSheet = createFunctionFactory(instance.CSSStyleSheet);
        const CSSStyleSheet = factoryCSSStyleSheet();
        CSSStyleSheet.prototype.__globalObject = opts.globalObject;

        instance.CSSStyleSheet = CSSStyleSheet;
      }
    }
    return instance;
  }
};

function createFunctionFactory(fn) {
  return function() {
    // Create a new function that delegates to the original
    var newFn = function() {
      return fn.apply(this, arguments);
    };

    // Copy prototype chain
    Object.setPrototypeOf(newFn, Object.getPrototypeOf(fn));

    // Copy own properties
    for (var key in fn) {
      if (Object.prototype.hasOwnProperty.call(fn, key)) {
        newFn[key] = fn[key];
      }
    }

    // Clone the .prototype object for constructor-like behavior
    if (fn.prototype) {
      newFn.prototype = Object.create(fn.prototype);
    }

    return newFn;
  };
}

//.CommonJS
module.exports = CSSOM;
///CommonJS

