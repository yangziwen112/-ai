const assert = require('assert')
const { compressHistory, formatHistory } = require('../lib/context')

const history = [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '你好，有什么可以帮你？' },
  { role: 'user', content: '我的密码是多少？' },
  { role: 'user', content: '教资报名时间 https://private.example/a' },
  { role: 'assistant', content: '请查看官方来源。' }
]
const compressed = compressHistory(history)
assert.equal(compressed.length, 4)
assert.ok(!formatHistory(history).includes('密码'))
assert.ok(!formatHistory(history).includes('https://'))
console.log('Context compression tests passed')
