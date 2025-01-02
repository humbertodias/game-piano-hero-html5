/* 
  dom.loadScript.js : 0.2.0
  2025-01-01 (Updated)

  Original code by Mudcube (2011-2014).
  Updated for clarity and maintainability.

  Functionality:
    - Dynamically load scripts with optional strict (sequential) or loose ordering.
    - Verify global objects existence (e.g., "JSZip") after load.
    - Provide per-script and batch-level callbacks for success/error.
    - Track already loaded scripts to prevent duplication.
*/

(function(global) {
  "use strict";

  // Polyfill basic Promise if needed (for very old browsers). 
  // If your environment already supports Promises, remove or comment this out.
  if (typeof Promise === "undefined") {
    // Basic minimal polyfill (not production-grade).
    var PENDING = 0, FULFILLED = 1, REJECTED = 2;
    var SimplePromise = function(executor) {
      var self = this;
      this.state = PENDING;
      this.value = null;
      this.handlers = [];
      function resolve(result) {
        if (self.state !== PENDING) return;
        self.state = FULFILLED;
        self.value = result;
        self.handlers.forEach(handle);
      }
      function reject(err) {
        if (self.state !== PENDING) return;
        self.state = REJECTED;
        self.value = err;
        self.handlers.forEach(handle);
      }
      function handle(handler) {
        if (self.state === PENDING) {
          self.handlers.push(handler);
        } else if (self.state === FULFILLED && handler.onFulfilled) {
          handler.onFulfilled(self.value);
        } else if (self.state === REJECTED && handler.onRejected) {
          handler.onRejected(self.value);
        }
      }
      this.then = function(onFulfilled, onRejected) {
        return new SimplePromise(function(resolve2, reject2) {
          handle({
            onFulfilled: function(val) {
              if (!onFulfilled) {
                resolve2(val);
              } else {
                try {
                  var ret = onFulfilled(val);
                  resolve2(ret);
                } catch(e) {
                  reject2(e);
                }
              }
            },
            onRejected: function(err) {
              if (!onRejected) {
                reject2(err);
              } else {
                try {
                  var ret = onRejected(err);
                  resolve2(ret);
                } catch(e) {
                  reject2(e);
                }
              }
            }
          });
        });
      };
      executor(resolve, reject);
    };
    // Minimal polyfill usage
    global.Promise = SimplePromise;
  }

  // Helper to check if a global variable path exists.
  function globalExists(path, rootObj) {
    try {
      if (!path) return true; // If no verification needed, treat as success.
      var safePath = path.replace(/["'\]\[]/g, "."); // Replace bracket notation w/ dot
      var parts = safePath.split(".");
      var obj = rootObj || global;
      for (var i = 0; i < parts.length; i++) {
        var key = parts[i];
        if (!key) continue; // skip empty from consecutive dots
        if (obj[key] == null) {
          return false;
        }
        obj = obj[key];
      }
      return true;
    } catch(e) {
      return false;
    }
  }

  // The main loader constructor
  function LoadScript() {
    this.loaded = {};   // Map of url -> boolean
    this.loading = {};  // Map of url -> 'in progress' callback
  }

  // Add method: can accept either a single config or an object with multiple URLs
  LoadScript.prototype.add = function(config) {
    if (typeof config === "string") {
      config = { url: config };
    }
    var that = this;
    // If no 'urls' array is present, convert to one
    var urls = config.urls;
    if (!urls) {
      urls = [{
        url: config.url,
        verify: config.verify,
        onsuccess: config.onsuccess
      }];
    }

    var strictOrder = !!config.strictOrder;
    var onBatchSuccess = config.onsuccess || function(){};
    var onBatchError   = config.error     || function(){};

    // Either load in strict sequence or loose parallel
    if (strictOrder) {
      // Strict (sequential) approach
      var index = 0;
      var loadNext = function() {
        if (index >= urls.length) {
          // All scripts processed
          onBatchSuccess();
          return;
        }
        loadSingle(urls[index])
          .then(function() {
            // If script loaded successfully, move to next
            index++;
            loadNext();
          })
          .catch(function(err) {
            // On error, call batch error and stop
            onBatchError(err);
          });
      };
      loadNext();
    } else {
      // Loose approach: load all in parallel, then check global verifications
      var promises = urls.map(function(u) {
        return loadSingle(u);
      });
      // Wait for all to finish
      Promise.all(promises)
        .then(function() {
          onBatchSuccess();
        })
        .catch(function(err) {
          onBatchError(err);
        });
    }

    // Returns a Promise that resolves after one script is loaded & verified
    function loadSingle(element) {
      return new Promise(function(resolve, reject) {
        var url = element.url;
        var verifyKey = element.verify;
        
        // If already loaded, skip script injection
        if (that.loaded[url]) {
          // But still check verification
          if (verifyKey && !globalExists(verifyKey)) {
            return reject(new Error("Global object '" + verifyKey + "' not found, though script claims loaded."));
          }
          if (element.onsuccess) element.onsuccess();
          return resolve();
        }

        // If the script is currently loading by another call, attach a callback
        if (that.loading[url]) {
          that.loading[url].push(function(verified) {
            if (!verified) {
              reject(new Error("Script " + url + " failed to load/verify"));
            } else {
              if (element.onsuccess) element.onsuccess();
              resolve();
            }
          });
          return;
        }

        // Mark as loading
        that.loading[url] = [];

        // Create and append <script> tag
        var script = document.createElement("script");
        script.type = "text/javascript";
        script.src = url;

        // Called on success
        script.onload = function() {
          if (verifyKey && !globalExists(verifyKey)) {
            finishLoading(false);
            reject(new Error("Global object '" + verifyKey + "' not found after loading " + url));
            return;
          }
          // Mark as loaded
          that.loaded[url] = true;
          finishLoading(true);
          if (element.onsuccess) element.onsuccess();
          resolve();
        };

        // Called on error
        script.onerror = function() {
          finishLoading(false);
          reject(new Error("Failed to load script: " + url));
        };

        function finishLoading(success) {
          // Fire off queued callbacks
          that.loading[url].forEach(function(cb) {
            cb(success);
          });
          delete that.loading[url];
        }

        // Inject script
        document.head.appendChild(script);
      });
    }
  };

  // Attach to global namespace
  if (typeof(global.dom) === "undefined") {
    global.dom = {};
  }
  var instance = new LoadScript();
  global.dom.loadScript = instance;

  // Node.js export if applicable
  if (typeof module !== "undefined" && module.exports) {
    module.exports = instance;
  }

})(typeof window !== "undefined" ? window : this);
