
/**
 * Module dependencies
 */

var through = require('through')
  , agent = require('superagent')
  , fs = require('fs')
  , cp = require('child_process')
  , p = require('path')
  , mkdirp = require('mkdirp')
  , rmrf = require('rmrf')

var fread = fs.readFileSync;
var fexists = fs.existsSync;
var TMPDIR = '/tmp';

/**
 * IETF RFC Base URL
 */

exports.RFC_BASE_URL = 'http://www.ietf.org/rfc';

/**
 * IETF RFC Index file URL
 */

exports.RFC_INDEX_URL = exports.RFC_BASE_URL + '/rfc-index.txt';

/**
 * Default RFC cache
 */

exports.RFC_CACHE = [TMPDIR, 'ietf-rfc'].join('/');

/**
 * Default RFC Index cache
 * file name
 */

exports.RFC_CACHE_INDEX = '/rfc-index';

/**
 * Syncs RFC Index file to
 * a local file
 *
 * @api public
 * @return {Stream}
 */

exports.sync = sync;
function sync () {
  var stream = through();
  var path = null;

  path = exports.RFC_CACHE;
  path += exports.RFC_CACHE_INDEX;

  mkdirp(exports.RFC_CACHE, function (err) {
    if (null != err && !/EEXIST/.test(err.message)) {
      return stream.emit('error', err);
    }

    fetchIndex();
  });

  return stream;

  function fetchIndex () {
    agent.get(exports.RFC_INDEX_URL, function (err, res) {
      if (null != err) {
        return stream.emit('error', err);
      }

      var out = fs.createWriteStream(path, {
       flags: 'w+' 
      });

      var line = null;
      var lines = null;
      var len = 0;
      var progress = 0;

      if (0 != res.text.length) {
        lines = res.text.split('\n');
        len = lines.length;

        stream.emit('length', len);

        stream.pipe(out);

        // into chunks
        while (null != (line = lines.shift())) {
          stream.emit('progress', 1);
          line += '\n';
          stream.write(line);
        }

        stream.end();
      }
    });
  }
}

/**
 * Searches RFC Index based
 * on a query
 *
 * @api public
 * @param {String|Regex|Function} query
 * @param {Object} opts - optiona;
 * @return {Stream}
 */

exports.search = search;
function search (query, opts) {
  var stream = through(write);
  var indexFile = exports.RFC_CACHE +'/'+ exports.RFC_CACHE_INDEX;

  if (null == query || '*' == query) {
    query = '.*';
  }

  if ('object' != typeof opts) {
    opts = {};
  }

  if (opts.useRemote || !fexists(indexFile)) {
    agent.get(exports.RFC_INDEX_URL, function (err, res) {
      if (null != err) {
        return stream.emit('error', err);
      }

      parse(res.text);

    });
  } else {
    fs.readFile(indexFile, function (err, buf) {
      if (null != err) {
        return stream.emit('error', err);
      }

      parse(String(buf));
    });
  }

  return stream;

  function parse (data) {
    var line = null;
    var nline = null;
    var ch = null;
    var chunk = null;
    var i = -1;
    var lines = data.split('\n');
    var inBody = false;
    var buffer = [];
    var tmp = [];

    while (null != (line = lines.shift())) {
      nline = lines[0];
      ch = trim(line).toLowerCase();

      if (/^rfc index$/.test(ch)) {
        if ('---------' == trim(nline)) {
          inBody = true;
          lines.shift();
          break;
        }
      }
    }

    if (false == inBody) {
      return stream.emit('error', new Error("body parse error"));
    }

    while (null != (line = lines.shift())) {
      if (line.length) {
        tmp.push(line);
      } else if (!line.length && tmp.length) {
        stream.write(tmp.join('\n'));
        tmp = [];
      }
    }

    stream.end();
  }

  function write (chunk) {
    var regex = null;
    var num = null;
    var desc = null;
    var parts = null;
    var str = String(chunk);

    if (query instanceof RegExp) {
      regex = query;
    }

    switch (typeof query) {
      case 'string':
        regex = regex || RegExp('('+ query +')', 'ig');

        if (regex.test(str)) {
          parts = str.split(/^([0-9]+)\s+/);

          if (null == parts) {
            return stream.emit('error', new Error("result parse error"));
          }

          if ('' == trim(parts[0])) {
            parts.shift();
          }

          if (!parts.length) {
            return;
          }

          num = parts.shift();

          if (true == isNaN(num = parseInt(num, 10))) {
            return stream.emit('error', new Error("rfc # result parse error"));
          }

          desc = parts.shift();

          if (null == desc || 0 == desc.length) {
            return stream.emit('error',
                               new Error("rfc description result parse error"));
          }

          var rfc = new RFC({rfc: num, desc: desc});

          if (opts.local && rfc.isSynced()) {
            stream.emit('result', rfc);
          } else if (!opts.local && !rfc.isSynced()) {
            rfc.sync().on('error', function (err) {
              stream.emit('error', err);
            }).on('end', function () {
              stream.emit('result', rfc);
            });
          } else {
            stream.emit('result', rfc);
          }

          return;
        }
        break;
    }
  }
}

/**
 * Opens a file in the RFC cache 
 * with the user `PAGER'
 *
 * @api public
 * @param {String} path
 */

exports.open = open;
function open (file) {
  var stream = through();
  var doc = null;
  var cmd = null;
  var pager = null;

  if (!fexists(file)) {
    return null;
  }

  pager = cp.spawn(process.env.PAGER, [file], {
    stdio: 'inherit'});

  pager.on('error', function (err) {
    stream.emit('error', err);
  });

  pager.on('close', function () {
    stream.emit('end');
  });

  stream.on('error', cleanup);

  return stream;

  function cleanup () {
    pager.kill();
    stream.end();
  }
}

/**
 * Removes everything from the RFC cache
 *
 * @api public
 */

exports.clear = clear;
function clear () {
  return rmrf(exports.RFC_CACHE);
}

/**
 * Clears RFC Index cache
 *
 * @api public
 */

exports.clearIndex = clearIndex;
function clearIndex () {
  return rmrf(exports.RFC_CACHE_INDEX);
}

/**
 * Lists all RFC files
 *
 * @api public
 */

exports.list = list;
function list () {
  var stream = through();
  var ls = null;

  ls = cp.spawn('ls',
         [exports.RFC_CACHE],
         { stdio: [null, 'pipe', 'pipe'] });

  ls.on('error', function (err) {
    stream.emit('error', err);
  });

  ls.stdout.on('data', function (chunk) {
    var item = null;
    var str = trim(String(chunk));
    var line = null;
    var lines = str.split('\n');

    while (null != (line = lines.shift())) {
      if (/.txt/.test(line)) {
        item = {};
        item.name = p.basename(line);
        item.path = exports.RFC_CACHE +'/'+ line;
        stream.emit('item', item);
      }
    }
  });

  ls.stderr.on('data', function (chunk) {
    if (/no such file or directory/.test(String(chunk).toLowerCase())) {
      stream.emit('empty');
    } else {
      stream.emit('error', new Error(String(chunk)));
    }
  });

  return stream;
}

/**
 * Removes an RFC from the cache
 *
 * @api public
 * @param {String|Number} rfc
 */

exports.clearRfc = clearRfc;
function clearRfc (rfc) {
  return rmrf(exports.RFC_CACHE_INDEX + '/rfc'+ rfc +'.txt');
}

/**
 * `RFC' constructor
 *
 * @api public
 * @param {Object} opts
 */

exports.RFC = RFC;
function RFC (opts) {
  this.rfc = Number(opts.rfc);
  this.desc = String(opts.desc);
  this.path = opts.path || [
    exports.RFC_CACHE, 'rfc'+ this.rfc +'.txt'].join('/');
}

/**
 * Opens the RFC with the
 * users `$PAGER'
 *
 * @api public
 */

RFC.prototype.open = function () {
  var stream = through();
  return exports.open(this.path);
};

/**
 * Predicate to test if RFC
 * is sync'd to system
 *
 * @api public
 */

RFC.prototype.isSynced = function () {
  return fexists(this.path) ? true : false;
};

/**
 * Syncs RFC to system
 *
 * @api public
 */

RFC.prototype.sync = function () {
  var stream = through();
  var name = '/rfc'+ this.rfc +'.txt';
  var fpath = exports.RFC_CACHE + name;

  agent.get(exports.RFC_BASE_URL + name, function (err, res) {
    if (null != err) {
      return stream.emit('error', err);
    }

    var out = fs.createWriteStream(fpath);
    stream.pipe(out);
    stream.write(trim(res.text));
    stream.end();
    out.end();
  });

  return stream;
};

/**
 * Trim utility
 */

function trim (str) {
  var i = 0;
  str = str.replace(/^\s+/, '').trim();
  for (i = str.length - 1; i >= 0; i--) {;
    if (true == /\S/.test(str.charAt(i))) {
      str = str.substring(0, i + 1);
      break;
    }
  }

  return str;
}
