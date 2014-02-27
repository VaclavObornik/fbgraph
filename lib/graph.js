/**
 * Module Dependencies
 */

var request = require('request')
  , qs = require('qs')
  , url = require('url')
  , crypto = require('crypto')
  , noop = function () {
  };


// Using `extend` from https://github.com/Raynos/xtend
function extend(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i]
      , keys = Object.keys(source);

    for (var j = 0; j < keys.length; j++) {
      var name = keys[j];
      target[name] = source[name];
    }
  }

  return target;
}


/**
 * GraphRequest Stream
 *
 * @param {String} method
 * @param {String} url
 * @param {object/function} - postData
 * - object to be used for post
 * - assumed to be a callback function if callback is undefined
 * @param {function/undefined} - callback function
 */

function GraphRequest(graph, method, url, postData, callback) {
  if (typeof callback === 'undefined') {
    callback = postData;
    postData = {};
  }

  this.graph = graph;

  url = this.prepareUrl(url);
  this.callback = callback || noop;
  this.postData = postData;

  this.options = extend({}, requestOptions);
  this.options.encoding = this.options.encoding || 'utf-8';

  // these particular set of options should be immutable
  this.options.method = method;
  this.options.uri = url;
  this.options.followRedirect = false;

  this[method.toLowerCase()]();

  return this;
}


/**
 * "Prepares" given url string
 * - adds protocol and host prefix if none is given
 * @param {string} url string
 */
GraphRequest.prototype.prepareUrl = function (url) {
  url = this.cleanUrl(url);

  if (url.substr(0, 4) !== 'http') {
    url = this.graph.graphUrl + url;
  }

  return url;
};

/**
 * "Cleans" given url string
 * - adds lading slash
 * - adds access token if we have one
 * - adds appsecret_proof if we have an accessToken and appSecret
 * @param {string} url string
 */

GraphRequest.prototype.cleanUrl = function (url) {
  url = url.trim();

  // add leading slash
  if (url.charAt(0) !== '/' && url.substr(0, 4) !== 'http') url = '/' + url;

  // add access token to url
  if (this.graph.accessToken && url.indexOf('access_token=') === -1) {
    url += ~url.indexOf('?') ? '&' : '?';
    url += "access_token=" + this.graph.accessToken;
  }

  // add appsecret_proof to the url
  if (this.graph.accessToken && this.graph.appSecret && url.indexOf('appsecret_proof') === -1) {
    var hmac = crypto.createHmac('sha256', this.graph.appSecret);
    hmac.update(this.graph.accessToken);

    url += ~url.indexOf('?') ? '&' : '?';
    url += "appsecret_proof=" + hmac.digest('hex');
  }

  return url;
};

/**
 * Gets called on response.end
 * @param {String|Object} body
 */

GraphRequest.prototype.end = function (body) {
  var json = typeof body === 'string' ? null : body
    , err = null;

  if (!json) {
    try {

      // this accounts for `real` json strings
      if (~body.indexOf('{') && ~body.indexOf('}')) {
        json = JSON.parse(body);

      } else {
        // this accounts for responses that are plain strings
        // access token responses have format of "accessToken=....&..."
        // but facebook has random responses that just return "true"
        // so we'll convert those to { data: true }
        if (!~body.indexOf('='))    body = 'data=' + body;
        if (body.charAt(0) !== '?') body = '?' + body;

        json = url.parse(body, true).query;
      }

    } catch (e) {
      err = {
        message: 'Error parsing json', exception: e
      };
    }
  }

  if (!err && (json && json.error)) err = json.error;

  this.callback(err, json);
};


/**
 * https.get request wrapper
 */

GraphRequest.prototype.get = function () {
  var self = this;

  request.get(this.options, function (err, res, body) {
    if (err) {
      self.callback({
                      message: 'Error processing https request', exception: err
                    }, null);

      return;
    }

    if (~res.headers['content-type'].indexOf('image')) {
      body = {
        image: true, location: res.headers.location
      };
    }

    self.end(body);
  });
};


/**
 * https.post request wrapper
 */

GraphRequest.prototype.post = function () {

  var self = this
    , postData = qs.stringify(this.postData);

  this.options.body = postData;

  request(this.options, function (err, res, body) {
    if (err) {
      self.callback({
                      message: 'Error processing https request', exception: err
                    }, null);

      return;
    }

    self.end(body);
  });

};


function Graph(options) {
  options = options || {};
  this.accessToken = options.accessToken || null;
  this.appSecret = options.appSecret || null;
  this.graphUrl = options.graphUrl || 'https://graph.facebook.com';
  this.oauthDialogUrl = options.oauthDialogUrl || "http://www.facebook.com/dialog/oauth?";
  this.oauthDialogUrlMobile = options.oauthDialogUrlMobile || "http://m.facebook.com/dialog/oauth?";
  this.requestOptions = options.requestOptions || {};
}

/**
 * Accepts an url an returns facebook
 * json data to the callback provided
 *
 * if the response is an image
 * ( FB redirects profile image requests directly to the image )
 * We'll send back json containing  {image: true, location: imageLocation }
 *
 * Ex:
 *
 *    Passing params directly in the url
 *
 *      graph.get("zuck?fields=picture", callback)
 *
 *    OR
 *
 *      var params = { fields: picture };
 *      graph.get("zuck", params, callback);
 *
 *    GraphApi calls that redirect directly to an image
 *    will return a json response with relavant fields
 *
 *      graph.get("/zuck/picture", callback);
 *
 *      {
 *        image: true,
 *        location: "http://profile.ak.fbcdn.net/hprofile-ak-snc4/157340_4_3955636_q.jpg"
 *      }
 *
 *
 * @param {object} params
 * @param {string} url
 * @param {function} callback
 */

Graph.prototype.get = function (url, params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = null;
  }

  if (typeof url !== 'string') {
    return callback({ message: 'GraphRequest api url must be a string' }, null);
  }

  if (params) {
    url += ~url.indexOf('?') ? '&' : '?';
    url += qs.stringify(params);
  }

  return new GraphRequest(this, 'GET', url, callback);
};

/**
 * Publish to the facebook graph
 * access token will be needed for posts
 * Ex:
 *
 *    var wallPost = { message: "heyooo budday" };
 *    graph.post(friendID + "/feed", wallPost, callback);
 *
 * @param {string} url
 * @param {object} postData
 * @param {function} callback
 */

Graph.prototype.post = function (url, postData, callback) {
  if (typeof url !== 'string') {
    return callback({ message: 'GraphRequest api url must be a string' }, null);
  }

  if (typeof postData === 'function') {
    callback = postData;
    postData = url.indexOf('access_token') !== -1 ? {} : {access_token: this.accessToken};
  }

  return new GraphRequest(this, 'POST', url, postData, callback);
};

/**
 * Deletes an object from the graph api
 * by sending a "DELETE", which is really
 * a post call, along with a method=delete param
 *
 * @param {string} url
 * @param {function} callback
 */

Graph.prototype.del = function (url, callback) {
  if (!url.match(/[?|&]method=delete/i)) {
    url += ~url.indexOf('?') ? '&' : '?';
    url += 'method=delete';
  }

  this.post(url, callback);
};


/**
 * Perform a search on the graph api
 *
 * @param {object} options (search options)
 * @param {function} callback
 */

Graph.prototype.search = function (options, callback) {
  options = options || {};
  var url = '/search?' + qs.stringify(options);
  return this.get(url, callback);
};


/**
 * Perform a fql query or mutliquery
 * multiqueries are done by sending in
 * an object :
 *
 *     var query = {
 *         name:         "SELECT name FROM user WHERE uid = me()"
 *       , permissions:  "SELECT " + FBConfig.scope + " FROM permissions WHERE uid = me()"
 *     };
 *
 * @param {string/object} query
 * @param {function} callback
 */
Graph.prototype.fql = function (query, callback) {
  if (typeof query !== 'string') query = JSON.stringify(query);

  var url = '/fql?q=' + encodeURIComponent(query);
  return this.get(url, callback);
};


/**
 * @param {object} params containing:
 *   - client_id
 *   - redirect_uri
 * @param {object} opts  Options hash. { mobile: true } will return mobile oAuth URL
 * @returns the oAuthDialogUrl based on params
 */
Graph.prototype.getOauthUrl = function (params, opts) {
  var url = (opts && opts.mobile) ? this.oauthDialogUrlMobile : this.oauthDialogUrl;
  return url + qs.stringify(params);
};

/**
 * Authorizes user and sets the
 * accessToken if everything worked out
 *
 * @param {object} params containing:
 *   - client_id
 *   - redirect_uri
 *   - client_secret
 *   - code
 * @param {function} callback
 */

Graph.prototype.authorize = function (params, callback) {
  var self = this;

  this.get("/oauth/access_token", params, function (err, res) {
    if (!err) self.setAccessToken(res.access_token);

    callback(err, res);
  });
};

/**
 * Extends the expiration time of accessToken
 *
 * @param {object} params containing:
 *   - client_id
 *   - client_secret
 *   - access_token (optional)
 * @param {function} callback
 */

Graph.prototype.extendAccessToken = function (params, callback) {
  var self = this;

  params.grant_type = 'fb_exchange_token';
  params.fb_exchange_token = params.access_token ? params.access_token : this.getAccessToken();

  this.get("/oauth/access_token", params, function (err, res) {
    if (!err && !params.access_token) {
      self.setAccessToken(res.access_token);
    }

    callback(err, res);
  });
};

/**
 * Set request options.
 * These are mapped directly to the
 * `request` module options object
 * @param {Object} options
 */

Graph.prototype.setOptions = function (options) {
  if (typeof options === 'object')  this.requestOptions = options;

  return this;
};

/**
 * @returns the request options object
 */

Graph.prototype.getOptions = function () {
  return this.requestOptions;
};

/**
 * Sets the access token
 * @param {string} token
 */

Graph.prototype.setAccessToken = function (token) {
  this.accessToken = token;
  return this;
};

/**
 * @returns the access token
 */

Graph.prototype.getAccessToken = function () {
  return this.accessToken;
};

/**
 * Sets the app secret, used to verify all API calls if provided
 * @param {string} token
 */

Graph.prototype.setAppSecret = function (token) {
  this.appSecret = token;
  return this;
};

/**
 * @returns the app secret
 */

Graph.prototype.getAppSecret = function () {
  return this.appSecret;
};

/**
 * sets graph url
 */

Graph.prototype.setGraphUrl = function (url) {
  this.graphUrl = url;
  return this;
};

/**
 * @returns the graphUrl
 */

Graph.prototype.getGraphUrl = function () {
  return this.graphUrl;
};



exports = Graph;