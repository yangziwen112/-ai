const assert = require('assert')
const { DEFAULT_SOURCES } = require('../lib/source-catalog')

const requiredGroups = ['teacher-cert', 'graduate-exam', 'exam', 'three-innovation', 'innovation-entrepreneurship', 'challenge-cup', 'career']
for (const group of requiredGroups) {
  assert.ok(DEFAULT_SOURCES.some(source => source.groups.includes(group)), `missing source group: ${group}`)
}
for (const source of DEFAULT_SOURCES) {
  assert.ok(/^https:\/\//.test(source.listUrl), `${source.id} must use HTTPS`)
  assert.equal(source.official, true, `${source.id} must be official`)
  assert.ok(source.linkPattern instanceof RegExp, `${source.id} needs a link pattern`)
  assert.ok(Number(source.recencyDays) > 0, `${source.id} needs recency window`)
}
console.log(`source catalog tests passed: ${DEFAULT_SOURCES.length} sources`)
