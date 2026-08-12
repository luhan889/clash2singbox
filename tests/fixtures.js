/* Fixture 语义比对测试：node tests/fixtures.js
 * 读取 fixtures/*.yaml → 节点模式转换 → 与 *.expected.json 做对象级比较（忽略键顺序）。
 */
var fs = require('fs')
var path = require('path')
var C = require(path.join(__dirname, '..', 'assets', 'convert.js'))
var DIR = path.join(__dirname, '..', 'fixtures')

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

function diff(actual, expected, at) {
	if (Array.isArray(expected) || Array.isArray(actual)) {
		if (!Array.isArray(actual)) return at + '：期望数组，实际 ' + JSON.stringify(actual)
		if (!Array.isArray(expected)) return at + '：期望 ' + JSON.stringify(expected) + '，实际数组'
		if (actual.length !== expected.length) return at + '：数组长度 ' + actual.length + ' ≠ ' + expected.length
		for (var i = 0; i < expected.length; i++) {
			var d = diff(actual[i], expected[i], at + '[' + i + ']')
			if (d) return d
		}
		return null
	}
	if (isObj(expected) || isObj(actual)) {
		if (!isObj(actual)) return at + '：期望对象，实际 ' + JSON.stringify(actual)
		if (!isObj(expected)) return at + '：期望 ' + JSON.stringify(expected) + '，实际对象'
		var ek = Object.keys(expected).sort(), ak = Object.keys(actual).sort(), k
		for (k = 0; k < ek.length; k++) if (ak.indexOf(ek[k]) < 0) return at + '：缺少字段 ' + ek[k]
		for (k = 0; k < ak.length; k++) if (ek.indexOf(ak[k]) < 0) return at + '：多出字段 ' + ak[k] + ' = ' + JSON.stringify(actual[ak[k]])
		for (k = 0; k < ek.length; k++) {
			var dd = diff(actual[ek[k]], expected[ek[k]], at + '.' + ek[k])
			if (dd) return dd
		}
		return null
	}
	if (actual !== expected) return at + '：' + JSON.stringify(actual) + ' ≠ ' + JSON.stringify(expected)
	return null
}

var names = fs.readdirSync(DIR).filter(function (f) { return /\.yaml$/.test(f) }).sort()
var fails = 0, total = 0

names.forEach(function (file) {
	var base = file.replace(/\.yaml$/, '')
	var yamlText = fs.readFileSync(path.join(DIR, file), 'utf8')
	var expected = JSON.parse(fs.readFileSync(path.join(DIR, base + '.expected.json'), 'utf8'))
	var result
	total++
	try {
		result = C.convert(yamlText, { mode: 'nodes', pretty: true })
	} catch (error) {
		fails++
		console.log('  FAIL ' + base + '  转换抛错：' + error.message)
		return
	}
	var d = diff(result.config, expected, base)
	if (d) { fails++; console.log('  FAIL ' + base + '  ' + d); return }
	var json = JSON.parse(result.json)
	var d2 = diff(json, expected, base + '(JSON)')
	if (d2) { fails++; console.log('  FAIL ' + base + '  序列化后不一致：' + d2); return }
	var v = C.validate(result.config)
	if (!v.ok) { fails++; console.log('  FAIL ' + base + '  结构校验失败：' + v.errors.join('；')); return }
	var errs = (result.report.issues || []).filter(function (x) { return x.level === 'error' })
	if (errs.length) { fails++; console.log('  FAIL ' + base + '  存在错误诊断：' + errs[0].title); return }
	console.log('  ok   ' + base + '  (' + result.config.length + ' 个出站 · ' + result.report.ms + ' ms)')
})

console.log('\n' + (fails === 0 ? 'FIXTURES ALL PASS' : 'FIXTURES FAILURES: ' + fails) + '  (' + (total - fails) + '/' + total + ')')
process.exit(fails ? 1 : 0)
