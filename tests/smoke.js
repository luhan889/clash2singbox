/* 新能力冒烟测试：node tests/smoke.js */
var path = require('path')
var C = require(path.join(__dirname, '..', 'assets', 'convert.js'))

var Y = [
	'proxies:',
	'  - {name: "\u9999\u6e2f\u00b7HK 01", type: anytls, server: hk.example.com, port: 8443, password: pw, sni: hk.example.com, alpn: [h2, http/1.1], client-fingerprint: chrome, skip-cert-verify: false}',
	'  - {name: "Panel\uff1awww.example.com", type: trojan, server: t.example.com, port: 443, password: pw}',
	'  - {name: "\u5269\u4f59\u6d41\u91cf\uff1a121.03 GB", type: trojan, server: x.example.com, port: 443, password: pw}',
	'  - {name: "\u5957\u9910\u5230\u671f\uff1a2030-03-08", type: trojan, server: y.example.com, port: 443, password: pw}',
	'  - {name: "\u5927\u6d41\u91cf\u8282\u70b9 01", type: trojan, server: z.example.com, port: 443, password: pw}',
	'  - name: "US Reality"',
	'    type: vless',
	'    server: us.example.com',
	'    port: 443',
	'    uuid: 11111111-2222-3333-4444-555555555555',
	'    tls: true',
	'    servername: www.microsoft.com',
	'    flow: xtls-rprx-vision',
	'    client-fingerprint: chrome',
	'    reality-opts: {public-key: PUBKEY, short-id: 6ba85179}',
	'proxy-groups:',
	'  - {name: "\u9009\u62e9", type: select, proxies: ["\u9999\u6e2f\u00b7HK 01", "\u5269\u4f59\u6d41\u91cf\uff1a121.03 GB", DIRECT]}',
	'rules:',
	'  - MATCH,\u9009\u62e9'
].join('\n')

var fails = 0, total = 0
function ok(name, cond, extra) {
	total++
	if (cond) console.log('  ok   ' + name)
	else { fails++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  <-- ' + JSON.stringify(extra))) }
}

var n = C.convert(Y, { mode: 'nodes' })
ok('节点模式输出数组', Array.isArray(n.config), typeof n.config)
ok('节点模式没有 direct/selector', n.config.filter(function (o) { return o.type === 'direct' || o.type === 'selector' }).length === 0, n.config.map(function (o) { return o.type }))
ok('伪节点已过滤 2 个', n.report.filtered === 2, n.report.filtered)
ok('真节点保留 4 个', n.config.length === 4, n.config.length)
ok('“大流量节点 01” 未被误删', !!n.config.filter(function (o) { return o.tag.indexOf('\u5927\u6d41\u91cf') === 0 }).length, n.config.map(function (o) { return o.tag }))
ok('原名未被修改', n.config[1].tag === 'Panel\uff1awww.example.com', n.config[1].tag)
ok('节点模式 report.mode', n.report.mode === 'nodes', n.report.mode)
ok('节点模式无分组/规则', n.report.groups === 0 && n.report.rules === 0, [n.report.groups, n.report.rules])
ok('节点模式 JSON 为 Array', n.json.charAt(0) === '[', n.json.slice(0, 20))

var any = n.config[0]
ok('AnyTLS tag/type/server/port', any.type === 'anytls' && any.server === 'hk.example.com' && any.server_port === 8443, any)
ok('AnyTLS password', any.password === 'pw', any.password)
ok('AnyTLS tls.server_name', any.tls && any.tls.server_name === 'hk.example.com', any.tls)
ok('AnyTLS alpn', any.tls && any.tls.alpn && any.tls.alpn.length === 2, any.tls && any.tls.alpn)
ok('AnyTLS 保留 utls 指纹', any.tls && any.tls.utls && any.tls.utls.enabled === true && any.tls.utls.fingerprint === 'chrome', any.tls && any.tls.utls)
ok('AnyTLS 完整模式保留 idle 字段', any.idle_session_check_interval === '30s' && any.idle_session_timeout === '30s' && any.min_idle_session === 0, any)

var re = n.config[3]
ok('VLESS Reality uuid', re.uuid === '11111111-2222-3333-4444-555555555555', re.uuid)
ok('VLESS Reality flow', re.flow === 'xtls-rprx-vision', re.flow)
ok('VLESS Reality server_name', re.tls.server_name === 'www.microsoft.com', re.tls.server_name)
ok('VLESS Reality 字段完整', re.tls.reality.enabled === true && re.tls.reality.public_key === 'PUBKEY' && re.tls.reality.short_id === '6ba85179', re.tls.reality)
ok('VLESS Reality utls', re.tls.utls.enabled === true && re.tls.utls.fingerprint === 'chrome', re.tls.utls)

var m = C.convert(Y, { mode: 'nodes', style: 'minimal' })
var many = m.config[0]
ok('Minimal 删除 anytls 默认值', many.idle_session_check_interval === undefined && many.idle_session_timeout === undefined && many.min_idle_session === undefined, many)
ok('Minimal 仍保留 utls', many.tls.utls.fingerprint === 'chrome', many.tls)
ok('Minimal 仍保留 password/sni', many.password === 'pw' && many.tls.server_name === 'hk.example.com', many)
ok('Minimal report.style', m.report.style === 'minimal', m.report.style)

var keep = C.convert(Y, { mode: 'nodes', filterInfo: false })
ok('关闭过滤后保留全部节点', keep.config.length === 6, keep.config.length)

var fg = C.convert(Y, { mode: 'nodes', flags: true })
ok('旗帜：香港 -> HK', fg.config[0].tag.indexOf('\ud83c\udded\ud83c\uddf0') === 0, fg.config[0].tag)
ok('旗帜：US Reality -> US', fg.config[3].tag.indexOf('\ud83c\uddfa\ud83c\uddf8') === 0, fg.config[3].tag)
ok('旗帜不改变本体名', fg.config[0].tag.indexOf('\u9999\u6e2f\u00b7HK 01') > 0, fg.config[0].tag)
ok('默认不加旗帜', n.config[0].tag === '\u9999\u6e2f\u00b7HK 01', n.config[0].tag)

var cn = C.convert('proxies:\n  - {name: "\ud83c\udded\ud83c\uddf0 \u9999\u6e2f \u2b50 01", type: trojan, server: a.com, port: 443, password: p}', { mode: 'nodes', keepName: false })
ok('去除装饰名', cn.config[0].tag === '\u9999\u6e2f 01', cn.config[0].tag)

var full = C.convert(Y, {})
ok('完整模式返回对象', !Array.isArray(full.config) && !!full.config.route, typeof full.config)
ok('完整模式也过滤伪节点', full.report.filtered === 2 && full.report.nodes === 4, [full.report.filtered, full.report.nodes])
var grp = full.config.outbounds.filter(function (o) { return o.type === 'selector' })[0]
ok('分组不引用已过滤节点', grp.outbounds.indexOf('\u5269\u4f59\u6d41\u91cf\uff1a121.03 GB') < 0, grp.outbounds)
ok('分组无 undefined 成员', grp.outbounds.filter(function (t) { return !t }).length === 0, grp.outbounds)

var v1 = C.validate(full.config)
ok('validate 完整配置通过', v1.ok, v1.errors)
var v2 = C.validate(n.config)
ok('validate 节点数组通过', v2.ok, v2.errors)
var broken = JSON.parse(JSON.stringify(full.config))
broken.route.rules.push({ domain: ['a.com'], outbound: 'ghost' })
broken.outbounds.push({ type: 'selector', tag: 'g2', outbounds: ['nope'] })
var v3 = C.validate(broken)
ok('validate 捕获悬空引用', !v3.ok && v3.errors.length === 2, v3.errors)

ok('isInfoNode 强关键词', C.isInfoNode('\u8ddd\u79bb\u4e0b\u6b21\u91cd\u7f6e\u5269\u4f59\uff1a22 \u5929') === true)
ok('isInfoNode 不误判', C.isInfoNode('HK 01 | 1.5x') === false)
ok('isInfoNode 英文', C.isInfoNode('Expire: 2030-01-01') === true)
ok('regionOf 中文', C.regionOf('\u65e5\u672c\u4e1c\u4eac 01') === 'JP')
ok('regionOf 代码', C.regionOf('SG-Premium-02') === 'SG')
ok('regionOf 无匹配', C.regionOf('Premium Node') === null, C.regionOf('Premium Node'))

console.log('\n' + (fails === 0 ? 'SMOKE ALL PASS' : 'SMOKE FAILURES: ' + fails) + '  (' + (total - fails) + '/' + total + ')')
process.exit(fails ? 1 : 0)
