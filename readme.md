# FS Duplex Stream

Read and write to the same file simultaneously.

## Installation

```sh
npm install --save fs-duplex-stream
```

## Usage

```js
const createDuplexStream = require('fs-duplex-stream')
const iconv = require('iconv')

const file = createDuplexStream('old-text-file.txt')
const convert = iconv.decodeStream('win1251')

// Pipe file content thru converter and back to the file
file.pipe(convert).pipe(file)

// Print message when file is fully converted
file.on('finish', () => console.log('File converted to UTF-8'))
```

## API

### createDuplexStream(path[, options])

+ `path` &lt;String&gt; | &lt;Buffer&gt;
+ `options` &lt;Object&gt;
  + `readEncoding` &lt;String&gt;
  + `writeEncoding` &lt;String&gt;

Returns a new DuplexStream object.

`options` is an object or string with the following defaults:

```js
{
  readEncoding: null,
  writeEncoding: 'utf8'
}
```

The `readEncoding` and `writeEncoding` can be any one of those accepted by
[Buffer][].

### Class: DuplexStream

`DuplexStream` is a [Duplex Stream][].

#### duplexStream.bytesWritten

The number of bytes written so far. Does not include data that is still queued
for writing.

#### duplexStream.path

The path to the file the stream is reading and writing from as specified in the
first argument to `createDuplexStream()`. If `path` is passed as a string, then
`duplexStream.path` will be a string. If `path` is passed as a Buffer, then
`duplexStream.path` will be a Buffer.

[Buffer]: https://nodejs.org/api/buffer.html#buffer_buffer
[Duplex Stream]: https://nodejs.org/api/stream.html#stream_class_stream_duplex
