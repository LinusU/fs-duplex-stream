var fs = require('fs')
var assert = require('assert')

var debug = require('debug')('fs-duplex-stream')
var writer = require('flush-write-stream')
var duplexify = require('duplexify')
var writev = require('writev')

function createWriter (write, flush, options) {
  var stream = writer(write, flush)

  stream._writev = writev

  if (options.writeEncoding) {
    stream.setDefaultEncoding(options.writeEncoding)
  }

  return stream
}

function streamsWaiter (readable, writable) {
  var done = null
  var readDone = false
  var writeDone = false

  readable.on('end', function () {
    debug('readable stream is done')

    readDone = true
    if (writeDone && done) done()
  })

  writable.on('finish', function () {
    debug('writable stream is done')

    writeDone = true
    if (readDone && done) done()
  })

  return function (cb) {
    if (readDone && writeDone) return cb()

    assert(done === null)
    done = cb
  }
}

module.exports = function createDuplexStream (path, options) {
  if (options == null) options = {}

  if (typeof options !== 'object') {
    throw new TypeError('options should be an object')
  }

  debug('creating read stream' + (options.readEncoding ? ' with encoding ' + options.readEncoding : ''))
  var readable = fs.createReadStream(path, options.readEncoding && { encoding: options.readEncoding })

  debug('creating write stream')
  var writable = fs.createWriteStream(path + '-' + process.pid + '-' + Date.now())

  var waitForStreams = streamsWaiter(readable, writable)

  function write (data, enc, cb) {
    debug('enqueuing %d bytes of data ("%s" encoding)', data.length, enc)
    writable.write(data, enc, cb)
  }

  function flush (cb) {
    waitForStreams(function () {
      debug('renaming temporary file to replace original file')
      fs.rename(writable.path, readable.path, cb)
    })

    debug('ending writable stream')
    writable.end()
  }

  var stream = duplexify(createWriter(write, flush, options), readable, {
    readableObjectMode: Boolean(options.readEncoding),
    writableObjectMode: Boolean(options.writeEncoding)
  })

  Object.defineProperty(stream, 'path', {
    get: function () { return readable.path },
    enumerable: true
  })

  Object.defineProperty(stream, 'bytesWritten', {
    get: function () { return writable.bytesWritten },
    enumerable: true
  })

  return stream
}
