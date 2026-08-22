function installWebStreamsPolyfill() {
  if (typeof globalThis.ReadableStream === 'function' &&
      typeof globalThis.WritableStream === 'function' &&
      typeof globalThis.TransformStream === 'function') return

  const streams = require('web-streams-polyfill')
  const names = [
    'ReadableStream',
    'ReadableStreamDefaultReader',
    'ReadableStreamBYOBReader',
    'ReadableStreamDefaultController',
    'ReadableByteStreamController',
    'ReadableStreamBYOBRequest',
    'WritableStream',
    'WritableStreamDefaultWriter',
    'WritableStreamDefaultController',
    'TransformStream',
    'TransformStreamDefaultController',
    'ByteLengthQueuingStrategy',
    'CountQueuingStrategy'
  ]

  names.forEach(name => {
    if (typeof globalThis[name] === 'undefined' && streams[name]) globalThis[name] = streams[name]
  })
}

function installEncodingPolyfill() {
  if (typeof globalThis.TextEncoder === 'function' && typeof globalThis.TextDecoder === 'function') return
  const { TextEncoder, TextDecoder } = require('util')
  if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = TextEncoder
  if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = TextDecoder
}

installWebStreamsPolyfill()
installEncodingPolyfill()

module.exports = { installWebStreamsPolyfill, installEncodingPolyfill }
