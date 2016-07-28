var fs = require('fs')
var assert = require('assert')

var debug = require('debug')('fs-duplex-stream')
var Duplex = require('readable-stream').Duplex
var makeSymbol = require('make-symbol')

var AllIsRead = makeSymbol('allIsRead')
var BytesRead = makeSymbol('bytesRead')
var BytesWritten = makeSymbol('bytesWritten')
var FinishCalled = makeSymbol('finishCalled')
var ReadEncoding = makeSymbol('readEncoding')
var ReadTarget = makeSymbol('readTarget')
var WriteQueue = makeSymbol('writeQueue')
var WriteTarget = makeSymbol('writeTarget')

function onOpen (err, fd) {
  if (err) return this.emit('error', err)

  debug('file opened with descriptor id %d', fd)

  Object.defineProperty(this, 'fd', {
    value: fd,
    enumerable: true
  })

  if (this[ReadTarget] > this[BytesRead]) {
    debug('read enqueued, executing')

    var size = this[ReadTarget] - this[BytesRead]
    read.call(this, size)
  }

  if (this[WriteQueue] !== null && this[BytesRead] >= this[WriteTarget]) {
    debug('write enqueued, executing')

    var opts = this[WriteQueue]
    this[WriteQueue] = null
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

  debug('truncating file at %d bytes', this[BytesWritten])
  fs.ftruncate(this.fd, this[BytesWritten], onTruncate.bind(this))
}

function onReadResult (err, bytesRead, buffer) {
  if (err) return this.emit('error', err)

  debug('read %d bytes', bytesRead)

  this[BytesRead] += bytesRead

  var chunk = (bytesRead < buffer.length) ? buffer.slice(0, bytesRead) : buffer

  if (this[ReadEncoding]) {
    try {
      debug('decoding buffer as "%s"', this[ReadEncoding])
      chunk = chunk.toString(this[ReadEncoding])
    } catch (err) {
      return this.emit('error', err)
    }
  }

  if (bytesRead < buffer.length) {
    // Must be done before the call to .push since that will trigger another read
    this[AllIsRead] = true

    debug('last slice read')
    this.push(chunk)

    debug('ending stream')
    this.push(null)
  } else {
    debug('pushing read chunk')
    this.push(chunk)
  }

  if (this[WriteQueue] !== null) {
    if (this[BytesRead] >= this[WriteTarget]) {
      debug('write enqueued, executing')

      var opts = this[WriteQueue]
      this[WriteQueue] = null
      write.call(this, opts.chunk, opts.encoding, opts.cb)
    } else {
      if (this[BytesRead] === this[ReadTarget]) {
        this._read(this[WriteTarget] - this[BytesRead])
      }
    }
  }
}

function read (size) {
  var result = new Buffer(size)

  debug('queuing read of %d bytes at %d', size, this[BytesRead])
  fs.read(this.fd, result, 0, size, this[BytesRead], onReadResult.bind(this))
}

function write (chunk, encoding, cb) {
  assert(encoding === 'buffer')

  function onWriteResult (err, bytesWritten) {
    if (err) return cb(err)

    assert(bytesWritten === chunk.length)

    debug('wrote %d bytes', bytesWritten)
    this[BytesWritten] += bytesWritten

    cb(null)
  }

  debug('queuing write of %d bytes at %d', chunk.length, this[BytesWritten])
  fs.write(this.fd, chunk, 0, chunk.length, this[BytesWritten], onWriteResult.bind(this))
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

  Object.defineProperty(this, 'path', {
    value: path,
    enumerable: true
  })

  this[AllIsRead] = false
  this[BytesRead] = 0
  this[BytesWritten] = 0
  this[FinishCalled] = false
  this[ReadEncoding] = (opts.readEncoding || null)
  this[ReadTarget] = 0
  this[WriteQueue] = null
  this[WriteTarget] = 0

  fs.open(path, 'r+', onOpen.bind(this))
}

FSDuplexStream.prototype = Object.create(Duplex.prototype, {
  constructor: { value: FSDuplexStream, writable: true, configurable: true }
})

Object.defineProperty(FSDuplexStream.prototype, 'bytesRead', {
  get: function () { return this[BytesRead] },
  enumerable: true
})

Object.defineProperty(FSDuplexStream.prototype, 'bytesWritten', {
  get: function () { return this[BytesWritten] },
  enumerable: true
})

FSDuplexStream.prototype.emit = function (type) {
  if (type === 'finish' && this[FinishCalled] === false) {
    debug('intercepting finish event')
    this[FinishCalled] = true
    onFinish.call(this)
  } else {
    Duplex.prototype.emit.apply(this, arguments)
  }
}

FSDuplexStream.prototype._read = function (size) {
  debug('read of %d bytes requested', size)

  if (this[AllIsRead]) {
    debug('all is read, dropping request')
    return
  }

  if (this[ReadTarget] > this[BytesRead]) {
    debug('read already scheduled, dropping request')
    return
  }

  debug('advancing read target by %d bytes', size)
  this[ReadTarget] += size

  if (this.fd) read.call(this, size)
}

FSDuplexStream.prototype._write = function (chunk, encoding, cb) {
  debug('write of %d bytes requested', chunk.length)

  debug('advancing write target by %d bytes', chunk.length)
  this[WriteTarget] += chunk.length

  if (!this.fd) {
    debug('file not yet open, adding request to queue')
    this[WriteQueue] = { chunk: chunk, encoding: encoding, cb: cb }

    if (this[BytesRead] < this[WriteTarget] && this[BytesRead] === this[ReadTarget]) {
      this._read(this[WriteTarget] - this[BytesRead])
    }

    return
  }

  if (this[BytesRead] < this[WriteTarget]) {
    debug('chunk not yet read, adding request to queue')
    this[WriteQueue] = { chunk: chunk, encoding: encoding, cb: cb }

    if (this[BytesRead] === this[ReadTarget]) {
      this._read(this[WriteTarget] - this[BytesRead])
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
