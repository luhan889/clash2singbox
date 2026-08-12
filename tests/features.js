/* 新增能力回归：node tests/features.js
 * 覆盖：proxy-providers 展开 / 代理组 use: / SUB-RULE / 全局 interface-name / routing-mark / 未转换字段告警
 */
var path = require('path')
var C = require(path.join(__dirname, '..', 'assets', 'convert.js'))

var pass = 0, fail = 0
function ok(name, cond, extra) {
	if (cond) { pass++; console.log('  ok   ' + name) }
	else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  实际：' + JSON.stringify(extra) : '')) }
}
function issue(report, level, kw) {
	for (var i = 0; i < report.issues.length; i++) {
		if (report.issues[i].level === level && String(report.issues[i].title).indexOf(kw) >= 0) return true
	}
	return false
}
function group(config, tag) {
	for (var i = 0; i < config.outbounds.length; i++) if (config.outbounds[i].tag === tag) return config.outbounds[i]
	return null
}
function y(lines) { return lines.join('\n') + '\n' }

/* ---------------- 1. proxy-providers ---------------- */

var PROVIDER_YAML = y([
	'proxy-providers:',
	'  inline-a:',
	'    type: http',
	'    payload:',
	'      - {name: PA-1, type: trojan, server: a.example.com, port: 443, password: p1}',
	'      - {name: PA-2, type: trojan, server: b.example.com, port: 443, password: p2}',
	'      - {name: 剩余流量：1TB, type: trojan, server: c.example.com, port: 443, password: p3}',
	'  filtered-b:',
	'    type: http',
	'    filter: "HK"',
	'    payload:',
	'      - {name: HK-01, type: ss, server: hk.example.com, port: 8388, cipher: aes-128-gcm, password: sspass}',
	'      - {name: JP-01, type: ss, server: jp.example.com, port: 8388, cipher: aes-128-gcm, password: sspass}',
	'  remote-c:',
	'    type: http',
	'    url: https://example.com/sub.yaml',
	'    interval: 3600',
	'proxies:',
	'  - {name: Local-1, type: trojan, server: local.example.com, port: 443, password: lp}',
	'proxy-groups:',
	'  - {name: 全部, type: select, use: [inline-a, filtered-b]}',
	'  - {name: 远程组, type: select, use: [remote-c]}',
	'  - {name: 混合, type: select, proxies: [Local-1], use: [filtered-b]}',
	'rules:',
	'  - MATCH,全部'
])

console.log('== proxy-providers')
var rp = C.convert(PROVIDER_YAML, {})
ok('内联 payload 已展开为节点（本地 1 + inline 2 + filter 后 1）', rp.report.nodes === 4, rp.report.nodes)
ok('信息伪节点在 provider 内也被过滤', rp.report.filtered === 1, rp.report.filtered)
var gAll = group(rp.config, '全部')
ok('use: 只拉入所引用集合的节点', gAll && gAll.outbounds.length === 3 && gAll.outbounds.indexOf('Local-1') < 0, gAll && gAll.outbounds)
ok('provider filter 生效（仅 HK-01）', gAll && gAll.outbounds.indexOf('HK-01') >= 0 && gAll.outbounds.indexOf('JP-01') < 0, gAll && gAll.outbounds)
var gMix = group(rp.config, '混合')
ok('显式 proxies 与 use: 可共存', gMix && gMix.outbounds.length === 2 && gMix.outbounds[0] === 'Local-1', gMix && gMix.outbounds)
ok('远程集合报 error 而不是静默失败', issue(rp.report, 'error', '无法离线拉取'))
ok('远程集合同时给出 warn 提示', issue(rp.report, 'warn', '远程订阅'))
ok('展开内联节点有 info 记录', issue(rp.report, 'info', '已展开 proxy-provider'))
var gRemote = group(rp.config, '远程组')
ok('远程组回退为全部本地节点，不会产生空组', gRemote && gRemote.outbounds.length === 4, gRemote && gRemote.outbounds)
ok('未定义集合也会报错', issue(C.convert(y(['proxies:', '  - {name: N, type: trojan, server: a.com, port: 443, password: p}', 'proxy-groups:', '  - {name: G, type: select, use: [nope]}', 'rules:', '  - MATCH,G']), {}).report, 'error', '未在 proxy-providers 中定义'))

/* ---------------- 2. SUB-RULE ---------------- */

var SUB_YAML = y([
	'proxies:',
	'  - {name: N1, type: trojan, server: a.com, port: 443, password: p}',
	'proxy-groups:',
	'  - {name: PROXY, type: select, proxies: [N1]}',
	'sub-rules:',
	'  sub-tcp:',
	'    - DOMAIN-SUFFIX,google.com,PROXY',
	'    - DOMAIN-KEYWORD,ads,REJECT',
	'    - MATCH,DIRECT',
	'rules:',
	'  - SUB-RULE,(NETWORK,tcp),sub-tcp',
	'  - SUB-RULE,(DOMAIN,x.com),missing-sub',
	'  - MATCH,PROXY'
])

console.log('\n== SUB-RULE')
var rs = C.convert(SUB_YAML, { mergeRules: false })
var rules = rs.config.route.rules
function findLogical(pred) {
	for (var i = 0; i < rules.length; i++) if (rules[i].type === 'logical' && pred(rules[i])) return rules[i]
	return null
}
var lg = findLogical(function (r) { return r.outbound === 'PROXY' && JSON.stringify(r.rules).indexOf('google.com') >= 0 })
ok('SUB-RULE 展开为 logical AND 规则', !!lg && lg.mode === 'and' && lg.rules.length === 2, lg)
ok('外层条件保留（NETWORK,tcp）', !!lg && JSON.stringify(lg.rules[0]).indexOf('tcp') >= 0, lg && lg.rules[0])
var rej = findLogical(function (r) { return r.action === 'reject' })
ok('子规则中的 REJECT 转为 reject 动作', !!rej, rej)
var mrule = null
for (var mi = 0; mi < rules.length; mi++) {
	if (rules[mi].type !== 'logical' && rules[mi].outbound === 'direct' && JSON.stringify(rules[mi]).indexOf('tcp') >= 0) mrule = rules[mi]
}
ok('子规则中的 MATCH 继承外层条件并走 direct', !!mrule, mrule)
ok('缺失的子规则给出告警而不是报错中断', issue(rs.report, 'warn', '不存在或为空'))
ok('最终 final 仍为 PROXY', rs.config.route.final === 'PROXY', rs.config.route.final)
var nested = C.convert(y([
	'proxies:', '  - {name: N1, type: trojan, server: a.com, port: 443, password: p}',
	'sub-rules:', '  a:', '    - SUB-RULE,(DOMAIN,y.com),b', '  b:', '    - MATCH,DIRECT',
	'rules:', '  - SUB-RULE,(NETWORK,udp),a', '  - MATCH,DIRECT'
]), {})
ok('嵌套 SUB-RULE 给出明确告警', issue(nested.report, 'warn', '嵌套 SUB-RULE'))

/* ---------------- 3. 全局 interface-name / routing-mark ---------------- */

console.log('\n== 全局网卡与路由标记')
var ri = C.convert(y([
	'interface-name: en0',
	'routing-mark: 233',
	'proxies:',
	'  - {name: N1, type: trojan, server: a.com, port: 443, password: p, interface-name: eth1, routing-mark: 99}',
	'rules:',
	'  - MATCH,DIRECT'
]), {})
ok('route.default_interface 已写入', ri.config.route.default_interface === 'en0', ri.config.route.default_interface)
ok('与 auto_detect_interface 互斥已处理', ri.config.route.auto_detect_interface === undefined, ri.config.route.auto_detect_interface)
ok('route.default_mark 已写入', ri.config.route.default_mark === 233, ri.config.route.default_mark)
var n1 = ri.config.outbounds[0]
ok('节点级 interface-name 仍映射为 bind_interface', n1.bind_interface === 'eth1', n1.bind_interface)
ok('节点级 routing-mark 仍映射为 routing_mark', n1.routing_mark === 99, n1.routing_mark)

/* ---------------- 4. 未转换字段告警 ---------------- */

console.log('\n== 未转换字段告警')
var rw = C.convert(y([
	'listeners:',
	'  - {name: l1, type: mixed, port: 7899}',
	'tunnels:',
	'  - tcp/udp,127.0.0.1:6553,114.114.114.114:53,DIRECT',
	'script:',
	'  code: |',
	'    def main(ctx, metadata):',
	'      return "DIRECT"',
	'proxies:',
	'  - {name: N1, type: trojan, server: a.com, port: 443, password: p}',
	'rules:',
	'  - MATCH,DIRECT'
]), {})
ok('listeners 给出告警', issue(rw.report, 'warn', 'listeners'))
ok('tunnels 给出告警', issue(rw.report, 'warn', 'tunnels'))
ok('script 给出告警', issue(rw.report, 'warn', 'script'))

/* ---------------- 5. 节点 JSON 形态（wrap）与面板伪节点 ---------------- */

var NODE_YAML = y([
	'proxies:',
	'  - {name: A1, type: anytls, server: a.com, port: 443, password: p, sni: a.com, client-fingerprint: chrome}',
	'  - {name: "Panel：www.example.xyz", type: trojan, server: b.com, port: 443, password: q}',
	'rules:',
	'  - MATCH,DIRECT'
])
var rArr = C.convert(NODE_YAML, { mode: 'nodes' })
var rObj = C.convert(NODE_YAML, { mode: 'nodes', wrap: 'outbounds' })
ok('节点模式默认输出裸数组', Array.isArray(rArr.config) && rArr.json.charAt(0) === '[')
ok('节点模式 report.wrap = array', rArr.report.wrap === 'array', rArr.report.wrap)
ok('wrap=outbounds 输出对象', !Array.isArray(rObj.config) && Array.isArray(rObj.config.outbounds))
ok('wrap=outbounds JSON 以 { 开头', rObj.json.charAt(0) === '{')
ok('wrap=outbounds report.wrap 正确', rObj.report.wrap === 'outbounds', rObj.report.wrap)
ok('wrap 不改变节点数量', rObj.config.outbounds.length === rArr.config.length, [rObj.config.outbounds.length, rArr.config.length])
ok('wrap 后仍是合法 JSON', JSON.parse(rObj.json).outbounds.length === rObj.config.outbounds.length)
ok('wrap 给出提示信息', issue(rObj.report, 'info', 'outbounds'))
var URL_YAML = y([
	'proxies:',
	'  - {name: A1, type: anytls, server: a.com, port: 443, password: p}',
	'  - {name: "https://t.me/example_channel", type: trojan, server: b.com, port: 443, password: q}',
	'rules:',
	'  - MATCH,DIRECT'
])
ok('面板节点默认忠实保留原名', rArr.config.length === 2 && rArr.config[1].tag === 'Panel：www.example.xyz', rArr.config.map(function (x) { return x.tag }))
ok('含 http(s):// 的公告节点被过滤', C.convert(URL_YAML, { mode: 'nodes' }).config.length === 1, C.convert(URL_YAML, { mode: 'nodes' }).config.length)
ok('关闭过滤后公告节点保留', C.convert(URL_YAML, { mode: 'nodes', filterInfo: false }).config.length === 2)
ok('完整配置模式不受 wrap 影响', !Array.isArray(C.convert(NODE_YAML, { wrap: 'outbounds' }).config))

var fsx = require('fs')
var MAINY = fsx.readFileSync(path.join(__dirname, 'fixture.yaml'), 'utf8')
var rMod = C.convert(MAINY, {}), rLeg = C.convert(MAINY, { target: 'legacy' })
function dirDetour(c) { var n = 0, l = (c.dns && c.dns.servers) || [], i2; for (i2 = 0; i2 < l.length; i2++) if (l[i2].detour === 'direct') n++; return n }
function dlDetour(c) { var n = 0, l = (c.route && c.route.rule_set) || [], i3; for (i3 = 0; i3 < l.length; i3++) if (l[i3].download_detour === 'direct') n++; return n }
function svDetour(c, tag) { var l = (c.dns && c.dns.servers) || [], i4; for (i4 = 0; i4 < l.length; i4++) if (l[i4].tag === tag) return l[i4].detour; return null }
ok('1.12+ DNS 服务器不再 detour 到空 direct 出站', dirDetour(rMod.config) === 0, dirDetour(rMod.config))
ok('1.12+ 远程规则集不再 download_detour 到空 direct 出站', dlDetour(rMod.config) === 0, dlDetour(rMod.config))
ok('1.12+ 整份配置不含 detour direct', JSON.stringify(rMod.config).indexOf('"detour":"direct"') < 0)
ok('代理 DNS 仍保留代理组 detour', typeof svDetour(rMod.config, 'dns-proxy') === 'string' && svDetour(rMod.config, 'dns-proxy') !== 'direct', svDetour(rMod.config, 'dns-proxy'))
ok('1.11 目标仍保留 detour direct', dirDetour(rLeg.config) >= 1, dirDetour(rLeg.config))
var badCfg = { dns: { servers: [{ type: 'udp', tag: 'a', server: '1.1.1.1', detour: 'direct' }] }, outbounds: [{ type: 'direct', tag: 'direct' }], route: { final: 'direct', rules: [] } }
var vres = C.validate(badCfg)
ok('自检能识别 detour 指向空 direct 出站', JSON.stringify(vres).indexOf('空 direct 出站') >= 0, vres)

/* 设备矩阵：五个客户端预设 × 两个内核目标 */
;['universal', 'android', 'apple', 'desktop', 'gui'].forEach(function (dv) {
	var dc = C.convert(MAINY, { preset: dv }).config
	var dt = (dc.inbounds || []).filter(function (i) { return i.type === 'tun' })[0] || {}
	var djs = JSON.stringify(dc)
	ok(dv + '：1.12+ 输出无空 direct detour', djs.indexOf('"detour":"direct"') < 0 && djs.indexOf('"download_detour":"direct"') < 0)
	ok(dv + '：tun 已开启自动路由', dt.auto_route === true, dt.auto_route)
})
ok('apple 预设使用 gvisor 栈', C.convert(MAINY, { preset: 'apple' }).config.inbounds[0].stack === 'gvisor')
ok('apple 预设不下发 strict_route', C.convert(MAINY, { preset: 'apple' }).config.inbounds[0].strict_route === undefined)
ok('android 预设不下发 strict_route', C.convert(MAINY, { preset: 'android' }).config.inbounds[0].strict_route === undefined)
ok('desktop 预设下发 strict_route', C.convert(MAINY, { preset: 'desktop' }).config.inbounds[0].strict_route === true)
ok('gui 预设下发 strict_route', C.convert(MAINY, { preset: 'gui' }).config.inbounds[0].strict_route === true)
var rLg2 = C.convert(MAINY, { target: 'legacy' }).report
var lgWarn = (rLg2.issues || []).filter(function (it) { return /sing-box 1\.1[2-9]/.test(it.title) }).length > 0
ok('1.11 目标给出 1.12+ 不兼容告警', lgWarn, (rLg2.issues || []).map(function (it) { return it.title }).slice(0, 3))


/* ===== 1.3.5：规则识别精度 / 节点形态自动匹配 ===== */
var RY135 = [
	'proxies:',
	'  - { name: A, type: trojan, server: a.example.com, port: 443, password: pw }',
	'proxy-groups:',
	'  - { name: PROXY, type: select, proxies: [A] }',
	'rules:',
	'  - DOMAIN-REGEX,(?i)^ad\\.example\\.com$,PROXY',
	'  - PROCESS-NAME,com.google.android.youtube,PROXY',
	'  - PROCESS-NAME,chrome.exe,PROXY',
	'  - SRC-GEOIP,LAN,DIRECT',
	'  - NETWORK-TYPE,wifi,DIRECT',
	'  - IN-TYPE,TUN,PROXY',
	'  - IN-TYPE,REDIR,PROXY',
	'  - MATCH,PROXY'
].join('\n')
var r135 = C.convert(RY135, {})
var j135 = JSON.stringify(r135.config.route.rules)
ok('DOMAIN-REGEX 保留 (?i) 大小写标记', j135.indexOf('(?i)') >= 0, j135.slice(0, 160))
ok('Android 包名走 package_name', j135.indexOf('"package_name":["com.google.android.youtube"]') >= 0, j135.slice(0, 220))
ok('桌面进程名仍走 process_name', j135.indexOf('"process_name":["chrome.exe"]') >= 0)
ok('SRC-GEOIP,LAN 映射为 source_ip_is_private', j135.indexOf('"source_ip_is_private":true') >= 0)
ok('NETWORK-TYPE,wifi 映射为 network_type', j135.indexOf('"network_type":["wifi"]') >= 0)
ok('IN-TYPE,TUN 指向 tun-in', j135.indexOf('"inbound":["tun-in"]') >= 0)
ok('IN-TYPE,REDIR 无对应入站时告警跳过', !!issue(r135.report, 'warn', 'IN-TYPE'))
ok('节点形态 auto：GUI 预设输出 outbounds 对象', C.convert(RY135, { mode: 'nodes', preset: 'gui' }).report.wrap === 'outbounds')
ok('节点形态 auto：其余客户端输出纯数组', C.convert(RY135, { mode: 'nodes', preset: 'android' }).report.wrap === 'array')
ok('节点形态：手动指定优先于自动', C.convert(RY135, { mode: 'nodes', preset: 'android', wrap: 'outbounds' }).report.wrap === 'outbounds')

/* ===== 1.3.6：sing-box 1.14 HTTP Client / Schema 输出 ===== */
var rLatest = C.convert(MAINY, { target: 'latest', geoSource: 'github', geoDetour: 'proxy' })
var cLatest = rLatest.config
var remoteLatest = ((cLatest.route || {}).rule_set || []).filter(function (x) { return x && x.type === 'remote' })
ok('1.14+ 输出官方 $schema', cLatest.$schema === 'https://sing-box.sagernet.org/schema.json', cLatest.$schema)
ok('1.14+ 远程规则集创建 http_clients', Array.isArray(cLatest.http_clients) && cLatest.http_clients.length === 1, cLatest.http_clients)
ok('1.14+ route.default_http_client 指向存在的客户端', cLatest.route.default_http_client === cLatest.http_clients[0].tag, cLatest.route.default_http_client)
ok('1.14+ 代理下载通过 HTTP Client detour', cLatest.http_clients[0].detour && cLatest.http_clients[0].detour !== 'direct', cLatest.http_clients[0])
ok('1.14+ 不再输出 deprecated download_detour', remoteLatest.every(function (x) { return x.download_detour === undefined }), remoteLatest)
var rModern13 = C.convert(MAINY, { target: 'modern', geoSource: 'github', geoDetour: 'proxy' }).config
var remoteModern13 = ((rModern13.route || {}).rule_set || []).filter(function (x) { return x && x.type === 'remote' })
ok('1.12–1.13 仍保留 download_detour 兼容路径', remoteModern13.some(function (x) { return x.download_detour !== undefined }))
ok('1.12–1.13 不输出 1.14 http_clients', rModern13.http_clients === undefined && rModern13.$schema === undefined)
var badHttp = JSON.parse(JSON.stringify(cLatest))
badHttp.route.default_http_client = 'missing-http-client'
ok('自检能识别悬空 default_http_client', !C.validate(badHttp).ok && JSON.stringify(C.validate(badHttp).errors).indexOf('HTTP Client') >= 0, C.validate(badHttp).errors)

console.log('\n' + (fail === 0 ? 'FEATURES ALL PASS' : 'FEATURES FAILURES: ' + fail) + '  (' + pass + '/' + (pass + fail) + ')')
process.exit(fail ? 1 : 0)
