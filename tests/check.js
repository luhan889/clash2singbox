/* 完整配置结构校验（离线）+ CI 配置产出
 * 用法：node tests/check.js
 *      node tests/check.js --emit .ci-configs   # 写出供 sing-box check 使用的 json
 */
var fs = require('fs')
var path = require('path')
var C = require(path.join(__dirname, '..', 'assets', 'convert.js'))
var FIX = path.join(__dirname, '..', 'fixtures')
var MAIN = path.join(__dirname, 'fixture.yaml')

var args = process.argv.slice(2)
var emitAt = args.indexOf('--emit')
var emitDir = emitAt >= 0 ? args[emitAt + 1] : null
if (emitDir) {
	emitDir = path.resolve(process.cwd(), emitDir)
	fs.rmSync(emitDir, { recursive: true, force: true })
	fs.mkdirSync(emitDir, { recursive: true })
}

var fails = 0, total = 0, written = 0

function check(name, config) {
	total++
	var v = C.validate(config)
	if (v.ok) console.log('  ok   ' + name)
	else { fails++; console.log('  FAIL ' + name + '  ' + v.errors.join('；')) }
	return v.ok
}

function emit(name, config) {
	if (!emitDir) return
	var out = path.join(emitDir, name + '.json')
	fs.mkdirSync(path.dirname(out), { recursive: true })
	fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n', 'utf8')
	written++
}

/* 节点数组包装为可被 sing-box check 直接校验的最小配置 */
function wrap(nodes) {
	var outbounds = [], endpoints = []
	for (var i = 0; i < nodes.length; i++) {
		if (nodes[i].type === 'wireguard' && nodes[i].peers) endpoints.push(nodes[i])
		else outbounds.push(nodes[i])
	}
	var config = {
		log: { level: 'error' },
		inbounds: [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 7890 }],
		outbounds: outbounds.concat([{ type: 'direct', tag: 'direct' }]),
		route: { final: 'direct' }
	}
	if (endpoints.length) config.endpoints = endpoints
	return config
}

var mainYaml = fs.readFileSync(MAIN, 'utf8')
var PRESETS = ['universal', 'android', 'apple', 'desktop', 'gui']

console.log('== 完整配置（主 Fixture × 客户端预设）')
PRESETS.forEach(function (preset) {
	var r = C.convert(mainYaml, { preset: preset, pretty: true })
	if (check('full · ' + preset, r.config)) emit('modern13/full-main-' + preset, r.config)
})

console.log('\n== 完整配置（主 Fixture × 客户端预设 × sing-box 1.11）')
PRESETS.forEach(function (preset) {
	var r = C.convert(mainYaml, { preset: preset, target: 'legacy', pretty: true })
	if (check('full · 1.11 · ' + preset, r.config)) emit('legacy11/full-main-' + preset, r.config)
})

console.log('\n== 完整配置（主 Fixture × 客户端预设 × sing-box 1.14+）')
PRESETS.forEach(function (preset) {
	var r = C.convert(mainYaml, { preset: preset, target: 'latest', pretty: true })
	if (check('full · 1.14+ · ' + preset, r.config)) emit('latest14/full-main-' + preset, r.config)
})

console.log('\n== 完整配置（开关组合）')
var COMBOS = [
	['tun+fakeip', { tun: true, fakeip: true, ipv6: true }],
	['no-tun+no-fakeip', { tun: false, fakeip: false, mixed: true, mixedPort: 7891 }],
	['legacy-1.11', { target: 'legacy' }],
	['latest-1.14', { target: 'latest', geoDetour: 'proxy' }],
	['minimal-style', { style: 'minimal' }],
	['no-filter', { filterInfo: false }],
	['flags-on', { flags: true, keepName: false }],
	['no-merge+resolve', { mergeRules: false, resolveIpRules: true, dnsFollowRoute: true }],
	['github-geo+proxy', { geoSource: 'github', geoDetour: 'proxy', clashApi: true }]
]
COMBOS.forEach(function (pair) {
	var r = C.convert(mainYaml, pair[1])
	if (check('full · ' + pair[0], r.config)) {
		var prefix = pair[1].target === 'legacy' ? 'legacy11/' : pair[1].target === 'latest' ? 'latest14/' : 'modern13/'
		emit(prefix + 'full-main-' + pair[0].replace(/[^a-z0-9.]+/gi, '-'), r.config)
	}
})

console.log('\n== Fixture 完整配置与节点数组')
fs.readdirSync(FIX).filter(function (f) { return /\.yaml$/.test(f) }).sort().forEach(function (file) {
	var name = file.replace(/\.yaml$/, '')
	var text = fs.readFileSync(path.join(FIX, file), 'utf8')
	var full = C.convert(text, {})
	if (check('full · ' + name, full.config)) emit('modern13/full-' + name, full.config)
	var latest = C.convert(text, { target: 'latest' })
	if (check('full · 1.14+ · ' + name, latest.config)) emit('latest14/full-' + name, latest.config)
	var nodes = C.convert(text, { mode: 'nodes' })
	if (check('nodes · ' + name, nodes.config)) emit('modern13/nodes-' + name, wrap(nodes.config))
})

console.log('\n' + (fails === 0 ? 'CHECK ALL PASS' : 'CHECK FAILURES: ' + fails) + '  (' + (total - fails) + '/' + total + ')')
if (emitDir) console.log('已写出 ' + written + ' 份配置 → ' + emitDir)
process.exit(fails ? 1 : 0)
