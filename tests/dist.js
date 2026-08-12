#!/usr/bin/env node
'use strict'
/* 构建产物完整性：确保 dist 与源码同步，防止手改 dist / 漏构建。 */
var fs = require('fs')
var path = require('path')
var crypto = require('crypto')
var ROOT = path.join(__dirname, '..')
var DIST = path.join(ROOT, 'dist')
var files = [
  'index.html', 'favicon.svg', 'manifest.webmanifest', '_headers', '.nojekyll',
  'README.md', 'LICENSE', 'vercel.json',
  'assets/yaml.js', 'assets/convert.js', 'assets/app.js', 'assets/worker.js', 'assets/style.css'
]
function hash(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') }
var fail = 0
files.forEach(function (rel) {
  var src = path.join(ROOT, rel), out = path.join(DIST, rel)
  if (!fs.existsSync(out)) { console.log('FAIL missing dist/' + rel); fail++; return }
  if (hash(src) !== hash(out)) { console.log('FAIL stale dist/' + rel); fail++; return }
  console.log('ok   ' + rel)
})
var meta = path.join(DIST, 'build-meta.json')
var standalone = path.join(DIST, 'clash2singbox-standalone.html')
if (!fs.existsSync(meta) || !fs.existsSync(standalone)) { console.log('FAIL missing generated build artifact'); fail++ }
else {
  var m = JSON.parse(fs.readFileSync(meta, 'utf8'))
  if (!m.version || !m.buildId || !m.bytes || m.bytes.standalone !== fs.statSync(standalone).size) { console.log('FAIL invalid build-meta.json'); fail++ }
  else console.log('ok   build-meta.json / standalone')
}
console.log('\n' + (fail ? 'DIST FAILURES: ' + fail : 'DIST ALL PASS'))
process.exit(fail ? 1 : 0)
