const assert = require('assert')
const { deterministicIntent } = require('../lib/agents/intent')

for (const [query, route] of [['你忙吗', 'social_chat'], ['你现在忙吗', 'social_chat'], ['你的边界在哪里', 'capability_boundary'], ['你能干什么', 'capability_boundary'], ['谢谢', 'social_chat']]) {
  assert.equal(deterministicIntent(query, {}).route, route)
}
console.log('Fast path intent tests passed')
