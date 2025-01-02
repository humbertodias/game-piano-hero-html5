/*
 * util.request.js : A small utility to handle XHR or NodeFS for local files.
 *
 * Usage:
 *   util.request({
 *     url: './dir/something.extension',
 *     data: 'test!',                 // optional body (triggers POST)
 *     method: 'PUT',                 // override the default GET/POST
 *     format: 'text',                // text | xml | json | binary
 *     responseType: 'text',          // text | json | arraybuffer | blob | ...
 *     headers: { ... },             // optional headers
 *     withCredentials: true,         // cross-site requests
 *     onerror(evt, percent) { ... },
 *     onsuccess(evt, response) { ... },
 *     onprogress(evt, fraction) { ... } // fraction is between 0..1
 *   });
 */

;(function(root) {
  // If there's no 'util', define it
  var util = root.util || (root.util = {});

  /**
   * Dispatches an HTTP-like request in the browser, or uses NodeFS if a local path is detected.
   * 
   * @param {Object|string} opts  - Either a URL string or an options object.
   *   {string}   opts.url        - The URL or file path to request.
   *   {string}   opts.method     - 'GET' | 'POST' | 'PUT' etc. Defaults to GET or POST if data is present.
   *   {string}   opts.data       - If provided, triggers a POST by default. 
   *   {string}   opts.format     - 'text', 'xml', 'json', or 'binary' (affects how the response is parsed).
   *   {string}   opts.responseType  - 'text', 'arraybuffer', 'blob', 'document', or 'json' ...
   *   {Object}   opts.headers    - Key/value pairs for request headers.
   *   {boolean}  opts.withCredentials - For cross-site requests that need credentials.
   *   {Function} opts.onerror(evt, fraction)   - Called on error or if no network.
   *   {Function} opts.onsuccess(evt, response) - Called with final response.
   *   {Function} opts.onprogress(evt, fraction)- Called with progress fraction 0..1.
   * @param {Function} [onsuccess] - Optional second param for success callback.
   * @param {Function} [onerror]   - Optional third param for error callback.
   * @param {Function} [onprogress]- Optional fourth param for progress callback.
   * 
   * @returns {XMLHttpRequest|undefined} The XHR object if running in a browser, otherwise undefined if in Node.
   */
  util.request = function(opts, onsuccess, onerror, onprogress) {
    'use strict';

    // Normalize arguments
    if (typeof opts === 'string') {
      opts = { url: opts };
    }
    var data = opts.data;
    var url = opts.url;
    var method = opts.method || (data ? 'POST' : 'GET');
    var format = opts.format;          // text | xml | json | binary
    var headers = opts.headers;
    var responseType = opts.responseType;
    var withCredentials = opts.withCredentials || false;

    // Fallback to the function-based arguments if specified
    onsuccess = onsuccess || opts.onsuccess;
    onerror   = onerror   || opts.onerror;
    onprogress= onprogress|| opts.onprogress;

    // Check if Node environment has a local path
    if (typeof NodeFS !== 'undefined' && root.loc && typeof root.loc.isLocalUrl === 'function') {
      if (root.loc.isLocalUrl(url)) {
        // Use NodeFS
        NodeFS.readFile(url, 'utf8', function(err, res) {
          if (err) {
            if (onerror) onerror(err);
          } else {
            if (onsuccess) onsuccess({ responseText: res }, res);
          }
        });
        return;
      }
    }

    // Otherwise, do an XHR in browser
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);

    // Optional custom headers
    if (headers) {
      for (var h in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, h)) {
          xhr.setRequestHeader(h, headers[h]);
        }
      }
    } else if (data) {
      // If data is present and no headers set, assume a URL-encoded form
      xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    }

    // For binary, attempt to override the MIME type if supported
    if (format === 'binary' && typeof xhr.overrideMimeType === 'function') {
      xhr.overrideMimeType('text/plain; charset=x-user-defined');
    }

    // If user wants a certain type back (like 'arraybuffer' or 'json')
    if (responseType) {
      xhr.responseType = responseType;
    }

    if (withCredentials) {
      xhr.withCredentials = true;
    }

    // If we have an onerror callback, wire up XHR's onerror if possible
    if (onerror && 'onerror' in xhr) {
      xhr.onerror = function(evt) {
        onerror.call(xhr, evt);
      };
    }

    // Progress handlers
    if (onprogress) {
      // If there's data, we track upload progress
      if (data && xhr.upload && 'onprogress' in xhr.upload) {
        xhr.upload.onprogress = function(evt) {
          if (!evt.lengthComputable) return;
          var fraction = evt.loaded / evt.total;
          onprogress.call(xhr, evt, fraction);
        };
      } else {
        // Otherwise, we track download progress
        xhr.addEventListener('progress', function(evt) {
          if (!evt.lengthComputable) {
            // Attempt to parse content-length from headers as fallback
            var rawBytes = parseInt(xhr.getResponseHeader('Content-Length-Raw'), 10);
            if (isFinite(rawBytes)) {
              evt.total = rawBytes;
              evt.lengthComputable = true;
            } else {
              // We cannot compute progress fraction
              return;
            }
          }
          var fraction = evt.loaded / evt.total;
          onprogress.call(xhr, evt, fraction);
        });
      }
    }

    // State changes
    xhr.onreadystatechange = function(evt) {
      if (xhr.readyState === 4) {
        // The request is complete
        var status = xhr.status;
        var successCodes = [200, 304, 308];

        // 0 can sometimes mean success in local environment or cordova
        if (status === 0 && root.client && root.client.cordova) {
          status = 200;
        }
        
        if (successCodes.indexOf(status) !== -1) {
          // success
          if (!onsuccess) return;
          var result;
          try {
            // parse the result based on opts.format
            if (format === 'xml') {
              result = xhr.responseXML;
            } else if (format === 'text') {
              result = xhr.responseText;
            } else if (format === 'json') {
              result = JSON.parse(xhr.response);
            } else {
              // default: either the raw xhr.response or text, depending on usage
              result = xhr.response || xhr.responseText;
            }
          } catch(parseErr) {
            if (onerror) onerror.call(xhr, parseErr);
            return;
          }
          onsuccess.call(xhr, evt, result);
        } else {
          // error or not found
          if (onerror) onerror.call(xhr, evt);
        }
      }
    };

    // Fire off the request
    xhr.send(data);

    // Return the XHR object in case callers want to abort or track it
    return xhr;
  };

  /* If Node environment, set up the necessary requires */
  if (typeof module !== 'undefined' && module.exports) {
    var NodeFS = require('fs');
    var XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;
    module.exports = root.util.request;
  }
})(typeof MIDI !== 'undefined' ? MIDI : this);
