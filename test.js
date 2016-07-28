/* eslint-env mocha */

var fs = require('fs')
var temp = require('fs-temp')
var assert = require('assert')

var createDuplexStream = require('./')

describe('FSDuplexStream', function () {
  it('pipes data through', function (done) {
    var path = temp.writeFileSync('aaaa', 'utf8')
    var file = createDuplexStream(path)

    file.pipe(file).on('finish', function () {
      assert.equal(fs.readFileSync(path, 'utf8'), 'aaaa')

      done()
    })
  })

  it('writes before it reads', function (done) {
    var path = temp.writeFileSync('aaaa', 'utf8')
    var file = createDuplexStream(path)

    file.end('bbbb')

    file.once('data', function (data) {
      assert.deepEqual(data, new Buffer('aaaa'))
    })

    file.once('finish', function () {
      assert.equal(fs.readFileSync(path, 'utf8'), 'bbbb')

      done()
    })
  })

  it('truncates the file', function (done) {
    var path = temp.writeFileSync('aaaa', 'utf8')
    var file = createDuplexStream(path)

    file.end('bb')

    file.on('data', function (data) {
      assert.ok(Buffer.isBuffer(data))
    })

    file.once('finish', function () {
      assert.equal(fs.readFileSync(path, 'utf8'), 'bb')

      done()
    })
  })

  it('can write without reading', function (done) {
    var path = temp.writeFileSync('aaaa', 'utf8')
    var file = createDuplexStream(path)

    file.end('bb')

    file.once('finish', function () {
      assert.equal(fs.readFileSync(path, 'utf8'), 'bb')

      done()
    })
  })

  it('respects readEncoding', function (done) {
    var path = temp.writeFileSync('aaaa', 'utf8')
    var file = createDuplexStream(path, { readEncoding: 'utf8' })

    file.end('')

    file.once('data', function (data) {
      assert.equal(typeof data, 'string')
    })

    file.once('finish', done)
  })

  it('respects writeEncoding', function (done) {
    var path = temp.writeFileSync('aaaa', 'utf8')
    var file = createDuplexStream(path, { writeEncoding: 'base64' })

    file.end('dGVzdA==')

    file.once('data', function (data) {
      assert.deepEqual(data, new Buffer('aaaa'))
    })

    file.once('finish', function () {
      assert.equal(fs.readFileSync(path, 'utf8'), 'test')

      done()
    })
  })

  it('works with large files', function (done) {
    var target = temp.createWriteStream()

    for (var i = 0; i < 4096; i++) {
      target.write('aaaaaaaaaaaaaaaa')
    }

    target.end()

    target.once('finish', function () {
      var file = createDuplexStream(target.path)

      for (var i = 0; i < 4096; i++) {
        file.write('bbbbbbbbbbbbbbbb')
      }

      file.end()

      file.on('finish', function () {
        var content = fs.readFileSync(target.path, 'utf8')

        assert.equal(content.length, 65536)
        assert.equal(content.substring(960, 966), 'bbbbbb')

        done()
      })
    })
  })
})
