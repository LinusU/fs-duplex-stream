var fs = require('fs')
var debug = require('debug')('fs-duplex-stream')
var assert = require('assert')
var Duplex = require('stream').Duplex

function onOpen (err, fd) {
  if (err) return this.emit('error', err)

  debug('file opened with descriptor id %d', fd)

  this.fd = fd

  if (this._readTarget > this.bytesRead) {
    debug('read enqueued, executing')

    var size = this._readTarget - this.bytesRead
    read.call(this, size)
  }

  if (this._writeQueue !== null && this.bytesRead >= this._writeTarget) {
    debug('write enqueued, executing')

    var opts = this._writeQueue
    this._writeQueue = null
    write.call(this, opts.chunk, opts.encoding, opts.cb)
  }
}

function onClose (err) {
  if (err) this.emit('error', err)

  debug('file descriptor closed')
  this.emit('finish')
}

function onTruncate (err) {
  if (err) this.emit('error', err)

  debug('closing file descriptor %d', this.fd)
  fs.close(this.fd, onClose.bind(this))
}

function onFinish () {
  assert(this.fd)

  debug('truncating file at %d bytes', this.bytesWritten)
  fs.ftruncate(this.fd, this.bytesWritten, onTruncate.bind(this))
}

function onReadResult (err, bytesRead, buffer) {
  if (err) return this.emit('error', err)

  debug('read %d bytes', bytesRead)

  this.bytesRead += bytesRead

  var chunk = (bytesRead < buffer.length) ? buffer.slice(0, bytesRead) : buffer

  if (this._readEncoding) {
    try {
      debug('decoding buffer as "%s"', this._readEncoding)
      chunk = chunk.toString(this._readEncoding)
    } catch (err) {
      return this.emit('error', err)
    }
  }

  if (bytesRead < buffer.length) {
    // Must be done before the call to .push since that will trigger another read
    this._allIsRead = true

    debug('last slice read')
    this.push(chunk)

    debug('ending stream')
    this.push(null)
  } else {
    debug('pushing read chunk')
    this.push(chunk)
  }

  if (this._writeQueue !== null) {
    if (this.bytesRead >= this._writeTarget) {
      debug('write enqueued, executing')

      var opts = this._writeQueue
      this._writeQueue = null
      write.call(this, opts.chunk, opts.encoding, opts.cb)
    } else {
      if (this.bytesRead === this._readTarget) {
        this._read(this._writeTarget - this.bytesRead)
      }
    }
  }
}

function read (size) {
  var result = new Buffer(size)

  debug('queuing read of %d bytes at %d', size, this.bytesRead)
  fs.read(this.fd, result, 0, size, this.bytesRead, onReadResult.bind(this))
}

function write (chunk, encoding, cb) {
  assert(encoding === 'buffer')

  function onWriteResult (err, bytesWritten) {
    if (err) return cb(err)

    assert(bytesWritten === chunk.length)

    debug('wrote %d bytes', bytesWritten)
    this.bytesWritten += bytesWritten

    cb(null)
  }

  debug('queuing write of %d bytes at %d', chunk.length, this.bytesWritten)
  fs.write(this.fd, chunk, 0, chunk.length, this.bytesWritten, onWriteResult.bind(this))
}

function FSDuplexStream (path, opts) {
  if (!(this instanceof FSDuplexStream)) {
    throw new TypeError("Class constructor FSDuplexStream cannot be invoked without 'new'")
  }

  if (opts === undefined) opts = {}

  Duplex.call(this, {
    readableObjectMode: Boolean(opts.readEncoding)
  })

  if (opts.writeEncoding) {
    this.setDefaultEncoding(opts.writeEncoding)
  }

  this.path = path
  this.bytesRead = 0
  this.bytesWritten = 0

  this._readEncoding = (opts.readEncoding || null)

  this._writeQueue = null
  this._allIsRead = false
  this._readTarget = 0
  this._writeTarget = 0

  fs.open(path, 'r+', onOpen.bind(this))

  var origEmit = this.emit
  this.emit = function (ev) {
    if (ev === 'finish') {
      debug('intercepting finish event')

      this.emit = origEmit
      onFinish.call(this)

      return
    }

    origEmit.apply(this, arguments)
  }
}

FSDuplexStream.prototype = Object.create(Duplex.prototype)

FSDuplexStream.prototype._read = function (size) {
  debug('read of %d bytes requested', size)

  if (this._allIsRead) {
    debug('all is read, dropping request')
    return
  }

  if (this._readTarget > this.bytesRead) {
    debug('read already scheduled, dropping request')
    return
  }

  debug('advancing read target by %d bytes', size)
  this._readTarget += size

  if (this.fd) read.call(this, size)
}

FSDuplexStream.prototype._write = function (chunk, encoding, cb) {
  debug('write of %d bytes requested', chunk.length)

  debug('advancing write target by %d bytes', chunk.length)
  this._writeTarget += chunk.length

  if (!this.fd) {
    debug('file not yet open, adding request to queue')
    this._writeQueue = { chunk, encoding, cb }

    if (this.bytesRead < this._writeTarget && this.bytesRead === this._readTarget) {
      this._read(this._writeTarget - this.bytesRead)
    }

    return
  }

  if (this.bytesRead < this._writeTarget) {
    debug('chunk not yet read, adding request to queue')
    this._writeQueue = { chunk, encoding, cb }

    if (this.bytesRead === this._readTarget) {
      this._read(this._writeTarget - this.bytesRead)
    }

    return
  }

  write.call(this, chunk, encoding, cb)
}

FSDuplexStream.prototype._writev = function (chunks, cb) {
  debug('write of %d chunks requested', chunks.length)

  var i
  var size = 0

  for (i = 0; i < chunks.length; i++) {
    size += chunks[i].chunk.length
  }

  var pos = 0
  var buffer = new Buffer(size)

  for (i = 0; i < chunks.length; i++) {
    chunks[i].chunk.copy(buffer, pos)
    pos += chunks[i].chunk.length
  }

  assert(pos === size)

  return this._write(buffer, 'buffer', cb)
}

module.exports = function createDuplexStream (path, options) {
  return new FSDuplexStream(path, options)
}
