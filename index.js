const through = require('through')
const agent = require('superagent')
const fs = require('fs')
const cp = require('child_process')
const p = require('path')
const mkdirp = require('mkdirp')
const rmrf = require('rmrf')
const HOME = require('os-homedir')()

const SEARCHD = require('debug')('rfc:search')
const MATCHD = require('debug')('rfc:match')
const SYNCD = require('debug')('rfc:sync')

const fexists = fs.existsSync

/**
 * IETF RFC Base URL
 *
 * @default
 */

exports.RFC_BASE_URL = 'http://www.ietf.org/rfc'

/**
 * IETF RFC Index file URL
 *
 * @default http://www.ietf.org/rfc/rfc-index.txt
 */

exports.RFC_INDEX_URL = exports.RFC_BASE_URL + '/rfc-index.txt'

/**
 * Default RFC cache folder
 *
 * @default $HOME/.rfc.d
 */

exports.RFC_CACHE = p.resolve(HOME, '.rfc.d')

/**
 * Default RFC Index cache file (file name)
 *
 * @default
 */

exports.RFC_CACHE_INDEX = 'rfc-index'

/**
 * Syncs RFC Index file to `RFC_CACHE/RFC_CACHE_INDEX`
 *
 * @return {Stream}
 * @emits length
 * @emits progress
 * @emits data
 * @emits error
 * @emits end
 */
function sync () {
  const stream = through()
  const path = p.resolve(exports.RFC_CACHE, exports.RFC_CACHE_INDEX)

  mkdirp(exports.RFC_CACHE)
    .catch((err) => {
      if (err && !/EEXIST/.test(err.message)) {
        return stream.emit('error', err)
      }
    })
    .then(() => fetchIndex())

  return stream

  function fetchIndex () {
    SYNCD('GET index', this.rfc, exports.RFC_INDEX_URL)
    agent.get(exports.RFC_INDEX_URL, function (err, res) {
      if (err) {
        return stream.emit('error', err)
      }

      SYNCD('RESPONSE >', path)

      const out = fs.createWriteStream(path)

      let lines = null
      let line = null

      if (!res.text.length) {
        return stream.end()
      }

      lines = res.text.split('\n')
      stream.emit('length', lines.length)
      stream.pipe(out)

      // into chunks
      while ((line = lines.shift())) {
        stream.emit('progress', 1)
        line += '\n'
        stream.write(line)
      }
      stream.end()
    })
  }
}
exports.sync = sync

/**
 * Searches RFC Index based on a query
 *
 * @param {String|Regex} [query='*']
 * @param {Object} [opts]
 * @param {Boolean} [opts.useRemote = false] - always use remote index
 * @return {Stream}
 * @emits result
 * @emits error
 * @emits end
 * @todo  support query function
 */
function search (query, opts) {
  const stream = through(write)
  const indexFile = p.resolve(exports.RFC_CACHE, exports.RFC_CACHE_INDEX)

  if (!query || query === '*') {
    query = '.*'
  }

  if (!opts) {
    opts = {}
  }

  if (opts.useRemote || !fexists(indexFile)) {
    SEARCHD('REMOTE RFC_INDEX')
    agent.get(exports.RFC_INDEX_URL, function (err, res) {
      if (err) {
        return stream.emit('error', err)
      }

      parse(res.text)
    })
  } else {
    SEARCHD('CACHED RFC_INDEX')
    fs.readFile(indexFile, function (err, buf) {
      if (err) {
        return stream.emit('error', err)
      }

      parse(String(buf))
    })
  }

  return stream

  /**
   * parse RFC documents in RFC_CACHE_INDEX and write to `stream`
   * @param  {String} data - content of RFC_CACHE_INDEX
   */
  function parse (data) {
    const lines = data.split('\n')
    const tmp = []

    let didReachBody = false

    do {
      const line = trim(lines.shift())
      const header = trim(lines[0])
      if (/^RFC Index$/i.test(line) && /^[-]{9}$/.test(header)) {
        didReachBody = true
        lines.shift()
        break
      }
    } while (!didReachBody && lines.length)

    if (!didReachBody) {
      return stream.emit(
        'error',
        new Error('Failed to parse body of RFC index.')
      )
    }

    do {
      const line = lines.shift()
      if (line.length) {
        tmp.push(line)
      } else if (!line.length && tmp.length) {
        stream.write(tmp.join('\n'))
        tmp.length = 0
      }
    } while (lines.length)

    // DO NOT end stream here
    // stream should emit all 'result's and then 'end'
    // use empty string to signal EOS
    SEARCHD('END parse()')
    stream.write('')
  }

  /**
   * data handler of the `through` stream
   * search `query` in `chunk` and emit `result` if matched
   *
   * @param  {String} chunk - one RFC in RFC_CACHE_INDEX, written by `parse()`
   * @emit result
   */
  function write (chunk) {
    const str = String(chunk)

    let regex = null
    let parts = null
    let desc = null
    let num = null

    if (query instanceof RegExp) {
      regex = query
    } else {
      regex = RegExp('(' + query + ')', 'ig')
    }

    if (str === '') {
      SEARCHD('END write')
      stream.end()
    }

    SEARCHD('CHUNK[%d]: ', str.length, str)

    if (regex.test(str)) {
      parts = str.split(/^([0-9]+)\s+/)

      if (!parts.length) {
        return stream.emit('error', new Error('result parse error'))
      }

      if (!trim(parts[0])) {
        parts.shift()
      }

      if (!parts.length) {
        return
      }

      num = parts.shift()

      if (isNaN(num = parseInt(num, 10))) {
        return stream.emit('error', new Error('rfc # result parse error'))
      }

      desc = parts.shift()

      if (!desc || !desc.length) {
        return stream.emit(
          'error',
          new Error('rfc description result parse error')
        )
      }

      const rfc = new RFC({ rfc: num, desc: desc })
      MATCHD('RFC[%d] local[%s] synced[%s]', num, !!opts.local, rfc.isSynced())

      return stream.emit('result', rfc)
    }
  }
}
exports.search = search

/**
 * Opens a file with the user `PAGER`
 *
 * @param {String} file - path of file to open
 * @return {Stream}
 * @emits error
 * @emits end
 */
function open (file) {
  const stream = through()
  const PAGER = getPager()

  if (!fexists(file)) {
    return null
  }

  if (!PAGER) {
    console.error('error: PAGER environment constiable not set')
    process.exit(1)
  }

  const pager = cp.spawn(PAGER, [file], {
    stdio: 'inherit'
  })

  pager.on('error', function (err) {
    stream.emit('error', err)
  })

  pager.on('close', function () {
    stream.emit('end')
  })

  pager.once('spawn', () => process.nextTick(() => stream.emit('open', stream)))

  stream.pager = pager
  stream.on('error', close)

  return Object.assign(stream, { close })

  function close() {
    pager.kill()
    stream.end()
  }
}
exports.open = open

/**
 * Removes everything from the `RFC_CACHE`
 *
 */
function clear () {
  return rmrf(exports.RFC_CACHE)
}
exports.clear = clear

/**
 * Clears RFC Index cache
 *
 */
function clearIndex () {
  return rmrf(p.resolve(exports.RFC_CACHE, exports.RFC_CACHE_INDEX))
}
exports.clearIndex = clearIndex

/**
 * Lists all downloaded RFC files in `RFC_CACHE`
 *
 */
function list () {
  const stream = through()
  const ls = cp.spawn('ls', [exports.RFC_CACHE], {
    stdio: [null, 'pipe', 'pipe']
  })

  ls.on('error', function (err) {
    stream.emit('error', err)
  })

  ls.stdout.on('data', function (chunk) {
    const lines = trim(String(chunk)).split('\n')

    let line = null
    let item = null

    while ((line = lines.shift())) {
      if (/\.txt/.test(line)) {
        item = {}
        item.name = p.basename(line)
        item.path = p.resolve(exports.RFC_CACHE, line)
        stream.emit('item', item)
      }
    }
  })

  ls.stderr.on('data', function (chunk) {
    if (/no such file or directory/.test(String(chunk).toLowerCase())) {
      stream.emit('empty')
    } else {
      stream.emit('error', new Error(String(chunk)))
    }
  })

  return stream
}
exports.list = list

/**
 * Removes an RFC document from the cache
 *
 * @param {String|Number} rfc
 */
function clearRfc (rfc) {
  return rmrf(rfcCachePath(rfc))
}
exports.clearRfc = clearRfc

/**
 * `RFC` class representing an RFC document
 *
 * @class
 * @param {Object} opts
 * @param {Number} opts.rfc - RFC number
 * @param {String} [opts.desc = ''] - RFC description
 * @param {String} [opts.path = rfcCachePath(opts.rfc)] - Path for the downloaded RFC document
 */
function RFC (opts) {
  if (isNaN(opts.rfc)) {
    throw new Error('rfc should be a number')
  }

  this.rfc = Number(opts.rfc)
  this.desc = String(opts.desc || '')
  this.path = opts.path || rfcCachePath(opts.rfc)
}
exports.RFC = RFC

/**
 * Opens the RFC document with the user's `$PAGER`
 *
 */
RFC.prototype.open = function () {
  return exports.open(this.path)
}

/**
 * Predicate to test if the RFC document is sync'd to file system
 *
 */
RFC.prototype.isSynced = function () {
  return fexists(this.path)
}

/**
 * Syncs the RFC document to file system
 *
 */
RFC.prototype.sync = function () {
  const stream = through()
  const name = '/rfc' + this.rfc + '.txt'
  const path = this.path

  SYNCD('GET rfc[%d]', this.rfc, exports.RFC_BASE_URL + name)
  agent
    .get(exports.RFC_BASE_URL + name)
    .end(function (err, res) {
      if (err) {
        SYNCD('RESPONSE Error', err)
        return stream.emit('error', err)
      }

      SYNCD('RESPONSE >', path)
      stream.pipe(fs.createWriteStream(path))
      stream.write(res.text)
      stream.end()
      // will this end prematurely?
    })

  return stream
}

/**
 * Trim utility
 *
 * @private
 */
function trim (str) {
  str = str.replace(/^\s+/, '').trim()
  for (let i = str.length - 1; i >= 0; i--) {
    if (/\S/.test(str.charAt(i))) {
      str = str.substring(0, i + 1)
      break
    }
  }

  return str
}

/**
 * Get path of RFC document in cache
 *
 * @private
 * @param {String|Number} rfc - RFC number
 */
function rfcCachePath (rfc) {
  return p.resolve(exports.RFC_CACHE, 'rfc' + rfc + '.txt')
}

/**
 * Get available terminal pager
 *
 * @private
 * @return {String}
 */
function getPager () {
  const less = function less () { return cp.execSync('which less').toString().trim() }
  const more = function more () { return cp.execSync('which more').toString().trim() }
  const pg = function pg () { return cp.execSync('which pg').toString().trim() }

  return process.env.PAGER || less() || more() || pg()
}
