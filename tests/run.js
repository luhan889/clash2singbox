/* Clash2SingBox 引擎回归测试：node tests/run.js */
var fs = require('fs')
var path = require('path')
var C = require(path.join(__dirname, '..', 'assets', 'convert.js'))
var yamlText = fs.readFileSync(path.join(__dirname, 'fixture.yaml'), 'utf8')

var fails = 0, total = 0
function ok(name, cond, extra) {
	total++
	if (cond) console.log('  ok   ' + name)
	else { fails++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  <-- ' + JSON.stringify(extra))) }
}
function sec(t) { console.log('\n== ' + t) }
function byTag(arr, tag) {
	arr = arr || []
	for (var i = 0; i < arr.length; i++) if (arr[i].tag === tag) return arr[i]
	return null
}
function findRule(rules, fn) {
	rules = rules || []
	for (var i = 0; i < rules.length; i++) if (fn(rules[i])) return rules[i]
	return null
}

var r = C.convert(yamlText, {})
var cfg = r.config, rep = r.report
console.log('report: ' + JSON.stringify({ nodes: rep.nodes, skipped: rep.skipped, groups: rep.groups, rules: rep.rules, ruleSets: rep.ruleSets, dnsServers: rep.dnsServers, ms: rep.ms, bytes: rep.bytes }))
console.log('issues:')
rep.issues.forEach(function (it) { console.log('  [' + it.level + '] x' + it.count + ' ' + it.title + (it.samples.length ? ' :: ' + it.samples.join(' | ') : '')) })

sec('1 结构')
ok('顶层键顺序', Object.keys(cfg).join(',') === 'log,dns,inbounds,outbounds,endpoints,route,experimental', Object.keys(cfg).join(','))
ok('JSON 可解析且一致', JSON.parse(r.json).route.final === cfg.route.final)
ok('输出稳定（两次相同）', C.convert(yamlText, {}).json === r.json)
ok('CRLF 输入等效', C.convert(yamlText.replace(/\n/g, '\r\n'), {}).report.nodes === rep.nodes)

sec('2 节点')
ok('节点数 12 / 跳过 2', rep.nodes === 12 && rep.skipped === 2, [rep.nodes, rep.skipped])
var ss2022 = byTag(cfg.outbounds, 'SS-2022')
ok('ss-2022 加密', ss2022 && ss2022.method === '2022-blake3-aes-128-gcm' && ss2022.password === 'MDEyMzQ1Njc4OWFiY2RlZg==')
ok('udp_over_tcp v2', ss2022 && ss2022.udp_over_tcp && ss2022.udp_over_tcp.version === 2)
var ssObfs = byTag(cfg.outbounds, 'SS-Obfs')
ok('obfs 插件', ssObfs && ssObfs.plugin === 'obfs-local' && /obfs=tls/.test(ssObfs.plugin_opts) && /obfs-host=bing.com/.test(ssObfs.plugin_opts), ssObfs && ssObfs.plugin_opts)
ok('rc4-md5 已跳过', !byTag(cfg.outbounds, 'SS-RC4-应该被跳过'))
ok('ssr 已跳过', !byTag(cfg.outbounds, 'SSR-应该被跳过'))
var vmess = byTag(cfg.outbounds, 'VMess-WS-TLS')
ok('vmess ws + early data', vmess && vmess.transport.type === 'ws' && vmess.transport.path === '/path' && vmess.transport.max_early_data === 2048 && vmess.transport.early_data_header_name === 'Sec-WebSocket-Protocol', vmess && vmess.transport)
ok('vmess tls sni', vmess && vmess.tls.enabled === true && vmess.tls.server_name === 'v.example.com')
ok('vmess ws Host 头', vmess && vmess.transport.headers && vmess.transport.headers.Host === 'v.example.com')
var reality = byTag(cfg.outbounds, 'VLESS-Reality-Vision')
ok('reality 字段', reality && reality.tls.reality.enabled === true && reality.tls.reality.public_key === '2vNiVJ0M6nS0Xk9pYqZ3aBcDeFgHiJkLmNoPqRsTuVw' && reality.tls.reality.short_id === '6ba85179e30d4fc2')
ok('reality utls + flow', reality && reality.tls.utls.fingerprint === 'chrome' && reality.flow === 'xtls-rprx-vision')
var grpc = byTag(cfg.outbounds, 'VLESS-gRPC')
ok('grpc service_name', grpc && grpc.transport.type === 'grpc' && grpc.transport.service_name === 'GunService')
var trojan = byTag(cfg.outbounds, 'Trojan-Mux')
ok('trojan 强制 tls + insecure', trojan && trojan.tls.enabled === true && trojan.tls.insecure === true)
ok('trojan brutal mux', trojan && trojan.multiplex.protocol === 'h2mux' && trojan.multiplex.brutal.up_mbps === 50 && trojan.multiplex.brutal.down_mbps === 100, trojan && trojan.multiplex)
var hy2 = byTag(cfg.outbounds, 'Hysteria2-Hop')
ok('hysteria2 端口跃迁', hy2 && hy2.server_ports && hy2.server_ports[0] === '20000:30000' && hy2.server_port === undefined, hy2 && hy2.server_ports)
ok('hysteria2 obfs / 带宽', hy2 && hy2.obfs.type === 'salamander' && hy2.obfs.password === 'obfspwd' && hy2.up_mbps === 100 && hy2.down_mbps === 500)
var hy1 = byTag(cfg.outbounds, 'Hysteria1')
ok('hysteria1 auth_str/带宽', hy1 && hy1.auth_str === 'hyauth' && hy1.up_mbps === 50 && hy1.down_mbps === 200)
var tuic = byTag(cfg.outbounds, 'TUIC-v5')
ok('tuic 字段', tuic && tuic.congestion_control === 'bbr' && tuic.udp_relay_mode === 'native' && tuic.zero_rtt_handshake === true && tuic.heartbeat === '10s', tuic && tuic.heartbeat)
ok('anytls（1.12+）', !!byTag(cfg.outbounds, 'AnyTLS'))
ok('wireguard 为 endpoint', cfg.endpoints.length === 1 && cfg.endpoints[0].address[0] === '10.0.0.2/32' && cfg.endpoints[0].peers[0].reserved.length === 3, cfg.endpoints[0] && cfg.endpoints[0].peers)
var socks = byTag(cfg.outbounds, 'Socks-Chain')
ok('socks 版本 + 链式 detour', socks && socks.version === '5' && socks.detour === 'Trojan-Mux')
ok('无 block/dns/fallback 类型出站', !cfg.outbounds.some(function (o) { return o.type === 'block' || o.type === 'dns' || o.type === 'fallback' }))
ok('存在 direct 出站', !!byTag(cfg.outbounds, 'direct'))

sec('3 代理组')
var sel = byTag(cfg.outbounds, '节点选择')
ok('select → selector', sel && sel.type === 'selector')
ok('无效成员已剔除', sel && sel.outbounds.indexOf('不存在的节点') < 0 && sel.outbounds.indexOf('direct') >= 0, sel && sel.outbounds)
var auto = byTag(cfg.outbounds, '♻️ 自动选择')
ok('url-test → urltest', auto && auto.type === 'urltest' && auto.interval === '300s' && auto.tolerance === 50, auto && auto.interval)
ok('exclude-filter 生效', auto && auto.outbounds.indexOf('Socks-Chain') < 0 && auto.outbounds.indexOf('SS-2022') >= 0, auto && auto.outbounds)
ok('load-balance → urltest', (byTag(cfg.outbounds, '负载均衡') || {}).type === 'urltest')
ok('REJECT 组不生成出站', !byTag(cfg.outbounds, '拦截'))

sec('4 路由规则')
var rules = cfg.route.rules
ok('首条 sniff', rules[0].action === 'sniff')
ok('次条 hijack-dns', rules[1].protocol === 'dns' && rules[1].action === 'hijack-dns')
ok('clash_mode 规则', !!findRule(rules, function (x) { return x.clash_mode === 'Global' }))
ok('内网直连', !!findRule(rules, function (x) { return x.ip_is_private === true && x.outbound === 'direct' }))
var merged = findRule(rules, function (x) { return x.domain_suffix && x.domain_suffix.indexOf('.taobao.com') >= 0 })
ok('相邻同目标规则已合并', merged && merged.domain_suffix.length === 2 && merged.domain.length === 2, merged)
ok('DOMAIN-SUFFIX 同时输出 domain', merged && merged.domain.indexOf('taobao.com') >= 0)
ok('拦截动作', !!findRule(rules, function (x) { return x.action === 'reject' && x.rule_set }))
ok('port / port_range', !!findRule(rules, function (x) { return x.port && x.port.indexOf(443) >= 0 }) && !!findRule(rules, function (x) { return x.port_range && x.port_range[0] === '10000:20000' }))
ok('逻辑规则 AND', !!findRule(rules, function (x) { return x.type === 'logical' && x.mode === 'and' && x.rules.length === 2 }))
ok('逻辑规则 NOT invert', !!findRule(rules, function (x) { return x.type === 'logical' && x.invert === true }))
ok('无 geosite/geoip 旧字段', !/"geosite":|"geoip":/.test(r.json))
ok('final 为首个组', cfg.route.final === '节点选择', cfg.route.final)
ok('auto_detect_interface', cfg.route.auto_detect_interface === true)
ok('default_domain_resolver', cfg.route.default_domain_resolver.server === 'dns-resolver')

sec('5 规则集')
var sets = cfg.route.rule_set
ok('规则集均为 .srs 远程集', sets.length >= 4 && sets.every(function (s) { return /\.srs$/.test(s.url) && s.type === 'remote' && s.format === 'binary' && s.download_detour === undefined }), sets.map(function (s) { return s.tag }))
ok('srs 直链保留', !!byTag(sets, 'ruleset-custom-srs'))
ok('Loyalsoldier reject → geosite', !!byTag(sets, 'geosite-category-ads-all'))
ok('cncidr → geoip-cn', !!byTag(sets, 'geoip-cn'))
ok('geosite-geolocation-!cn', !!byTag(sets, 'geosite-geolocation-!cn'))

sec('6 DNS')
var dns = cfg.dns
var boot = byTag(dns.servers, 'dns-resolver')
ok('bootstrap 解析器（1.12+ 不带 detour）', boot && boot.type === 'udp' && boot.server === '223.5.5.5' && boot.detour === undefined, boot)
var dd = byTag(dns.servers, 'dns-direct')
ok('dns-direct https', dd && dd.type === 'https' && dd.server === 'dns.alidns.com' && dd.domain_resolver === 'dns-resolver', dd)
var dp = byTag(dns.servers, 'dns-proxy')
ok('dns-proxy detour 为代理组', dp && dp.detour === '节点选择', dp)
var df = byTag(dns.servers, 'dns-fake')
ok('fakeip 服务器', df && df.type === 'fakeip' && df.inet4_range === '198.18.0.1/16', df)
var hosts = byTag(dns.servers, 'dns-hosts')
ok('hosts 服务器', hosts && hosts.predefined['router.local'] === '192.168.1.1', hosts)
ok('hosts 多地址', hosts && hosts.predefined['dual.local'].length === 2)
ok('nameserver-policy 规则', !!findRule(dns.rules, function (x) { return x.server === 'dns-policy' && x.rule_set }))
ok('fake-ip-filter 规则', !!findRule(dns.rules, function (x) { return x.domain_suffix && x.domain_suffix.indexOf('.local') >= 0 && x.server === 'dns-direct' }))
ok('fakeip 兑底规则', dns.rules[dns.rules.length - 1].query_type.join(',') === 'A,AAAA')
ok('dns.final / strategy', dns.final === 'dns-proxy' && dns.strategy === 'ipv4_only')
ok('无旧版 address 字段', dns.servers.every(function (s) { return s.address === undefined }))
ok('DNS 规则无 action 字段', dns.rules.every(function (x) { return x.action === undefined }))

sec('7 入站与实验性')
ok('tun 入站', cfg.inbounds[0].type === 'tun' && cfg.inbounds[0].stack === 'system' && cfg.inbounds[0].auto_route === true, cfg.inbounds[0])
ok('mixed 入站端口', cfg.inbounds[1].type === 'mixed' && cfg.inbounds[1].listen_port === 7890 && cfg.inbounds[1].listen === '127.0.0.1')
ok('clash_api 端口与密钥', cfg.experimental.clash_api.external_controller === '127.0.0.1:9091' && cfg.experimental.clash_api.secret === 's3cret', cfg.experimental.clash_api)
ok('cache_file store_fakeip', cfg.experimental.cache_file.store_fakeip === true)
ok('无已移除字段', !/store_rdrc|independent_cache|sniff_override_destination/.test(r.json))

sec('8 选项矩阵')
var apple = C.convert(yamlText, { preset: 'apple', ipv6: true }).config
ok('apple 预设：gvisor + 无 strict_route', apple.inbounds[0].stack === 'gvisor' && apple.inbounds[0].strict_route === undefined, apple.inbounds[0])
ok('ipv6：双栈地址 + prefer_ipv4', apple.inbounds[0].address.length === 2 && apple.dns.strategy === 'prefer_ipv4')
var noFake = C.convert(yamlText, { fakeip: false }).config
ok('关闭 fakeip 后插入 resolve', !!findRule(noFake.route.rules, function (x) { return x.action === 'resolve' }) && !byTag(noFake.dns.servers, 'dns-fake'))
var lan = C.convert(yamlText, { allowLan: true, tun: false }).config
ok('allowLan + 仅 mixed', lan.inbounds.length === 1 && lan.inbounds[0].listen === '0.0.0.0')
var legacy = C.convert(yamlText, { target: 'legacy' })
var lc = legacy.config
ok('legacy：address 字符串', byTag(lc.dns.servers, 'dns-direct').address === 'https://dns.alidns.com/dns-query', byTag(lc.dns.servers, 'dns-direct'))
ok('legacy：fakeip 块', lc.dns.fakeip.enabled === true && lc.dns.fakeip.inet4_range === '198.18.0.1/16')
ok('legacy：无 default_domain_resolver', lc.route.default_domain_resolver === undefined)
ok('legacy：wireguard 为出站', !lc.endpoints && !!byTag(lc.outbounds, 'WireGuard'))
ok('legacy：anytls 已跳过并报错', !byTag(lc.outbounds, 'AnyTLS') && legacy.report.errorCount > 0)
ok('legacy：仍使用 rule action', lc.route.rules[0].action === 'sniff')
var plain = C.convert(yamlText, { sniff: false, clashApi: false, lanDirect: false, cacheFile: false, mergeRules: false }).config
ok('关闭开关生效', plain.route.rules[0].protocol === 'dns' && plain.experimental === undefined, Object.keys(plain))
var gh = C.convert(yamlText, { geoSource: 'sagernet', geoDetour: 'proxy' }).config
ok('geo 源切换 + 代理下载', /sing-geosite/.test(gh.route.rule_set[0].url) && gh.route.rule_set[0].download_detour === '节点选择', gh.route.rule_set[0])

sec('9 鲁棒性')
function throws(text) { try { C.convert(text, {}); return false } catch (e) { return true } }
ok('非法根结构报错', throws('- just\n- a\n- list'))
ok('空配置仍可生成', (function () { var x = C.convert('proxies: []\nrules: []\n', {}); return x.config.outbounds.length >= 1 && x.config.route.final === 'direct' })())
ok('无规则时回退到首节点', C.convert('proxies:\n  - {name: a, type: socks5, server: 1.1.1.1, port: 1080}\n', {}).config.route.final === 'a')
ok('自检清理悬空引用', (function () {
	var x = C.convert('proxies: []\nproxy-groups:\n  - {name: G, type: select, proxies: [不存在]}\nrules:\n  - MATCH,G\n', {})
	var g = byTag(x.config.outbounds, 'G')
	return g && g.outbounds.length === 1 && g.outbounds[0] === 'direct'
})())

sec('10 性能')
var big = ['proxies:']
for (var i = 0; i < 1000; i++) big.push('  - {name: n' + i + ', type: trojan, server: s' + i + '.example.com, port: 443, password: p' + i + ', sni: s' + i + '.example.com}')
big.push('proxy-groups:')
big.push('  - {name: G, type: url-test, include-all: true}')
big.push('rules:')
for (var j = 0; j < 5000; j++) big.push('  - DOMAIN-SUFFIX,d' + j + '.example.com,G')
big.push('  - MATCH,G')
var bigText = big.join('\n')
var t0 = Date.now()
var bigResult = C.convert(bigText, {})
var ms = Date.now() - t0
ok('1000 节点 / 5000 规则 < 2000ms（实测 ' + ms + 'ms）', ms < 2000, ms)
ok('大配置节点数', bigResult.report.nodes === 1000)
ok('大配置规则已合并', bigResult.config.route.rules.length < 20, bigResult.config.route.rules.length)

sec('11 解析器修复回归')
function Y() { return Array.prototype.join.call(arguments, '\n') }
var P = C.parseYaml
ok('流式序列中的别名', JSON.stringify(P(Y('a: &x 1', 'b: [*x, 2]')).b) === '[1,2]', P(Y('a: &x 1', 'b: [*x, 2]')).b)
ok('流式映射中的合并键', P(Y('a: &b {x: 1, y: 2}', 'c: {<<: *b, y: 3}')).c.x === 1 && P(Y('a: &b {x: 1, y: 2}', 'c: {<<: *b, y: 3}')).c.y === 3, P(Y('a: &b {x: 1, y: 2}', 'c: {<<: *b, y: 3}')).c)
ok('块标量 |+ 保留尾随空行', P(Y('t: |+', '  one', '', 'n: 1')).t === 'one\n\n', P(Y('t: |+', '  one', '', 'n: 1')).t)
ok('块标量 |- 去除末尾换行', P(Y('t: |-', '  one', '  two')).t === 'one\ntwo')
ok('显式标签 !!str 不转数字', P(Y('a: !!str 123')).a === '123', P(Y('a: !!str 123')).a)
ok('跨行双引号折叠', P(Y('a: \"foo', '  bar\"')).a === 'foo bar', P(Y('a: \"foo', '  bar\"')).a)
ok('跨行纯量折叠', P(Y('a: foo', '  bar')).a === 'foo bar', P(Y('a: foo', '  bar')).a)
ok('缩进不一致自动对齐', P(Y('a: 1', ' b: 2')).b === 2)
ok('冒号后缺空格自动修正', P(Y('port:443')).port === 443, P(Y('port:443')))
ok('十六进制与八进制', P(Y('a: 0x1f', 'b: 0o17')).a === 31 && P(Y('a: 0x1f', 'b: 0o17')).b === 15)
ok('解析告警已上报', (function () { var w = P(Y('a: 1', ' b: 2')).__warnings; return !!w && w.length > 0 })())

sec('12 转换核心修复回归')
var NODE = '  - {name: A, type: trojan, server: a.com, port: 443, password: p}'
var y2 = C.convert(Y('rule-providers:', '  txtset: {type: http, behavior: classical, format: text, url: \"https://e.com/a.txt\", path: ./a.txt}', '  srsset: {type: http, behavior: domain, url: \"https://e.com/b.srs\", path: ./b.srs}', '  fileset: {type: file, behavior: domain, path: ./rules/c.yaml}', 'proxies:', NODE, 'rules:', '  - RULE-SET,txtset,A', '  - RULE-SET,srsset,A', '  - RULE-SET,fileset,A', '  - RULE-SET,undefinedset,A', '  - MATCH,A'), {})
var tags2 = (y2.config.route.rule_set || []).map(function (s) { return s.tag }).join(',')
ok('文本规则集不再伪造 geosite 地址', tags2 === 'ruleset-srsset', tags2)
ok('未定义规则集报错', y2.report.errorCount >= 1, y2.report.errorCount)
ok('本地文本规则集跳过并告警', y2.report.warnCount >= 2, y2.report.warnCount)
var y8 = C.convert(Y('rule-providers:', '  loc: {type: file, behavior: domain, path: ./x.srs}', 'proxies:', NODE, 'rules:', '  - RULE-SET,loc,A', '  - MATCH,A'), {})
var ls = (y8.config.route.rule_set || [])[0]
ok('本地 .srs 规则集映射为 local', !!ls && ls.type === 'local' && ls.path === './x.srs', ls)
var y3 = C.convert(Y('authentication:', '  - \"u:p\"', 'proxies:', NODE, 'rules:', '  - IN-USER,u,A', '  - MATCH,A'), { tun: false })
var mi = byTag(y3.config.inbounds, 'mixed-in')
ok('mixed 入站继承 authentication', !!mi && !!mi.users && mi.users[0].username === 'u' && mi.users[0].password === 'p', mi)
ok('IN-USER 映射为 auth_user', !!findRule(y3.config.route.rules, function (x) { return x.auth_user && x.auth_user[0] === 'u' }))
var y4 = C.convert(Y('tun:', '  enable: true', '  auto-route: false', '  stack: system', '  inet4-address: 198.19.0.1/30', 'proxies:', NODE, 'rules:', '  - MATCH,A'), { preset: 'desktop' })
var ti = byTag(y4.config.inbounds, 'tun-in')
ok('尊重 auto-route: false', !!ti && ti.auto_route === false && ti.strict_route === undefined, ti)
ok('沿用 Clash 的 tun 地址', !!ti && ti.address[0] === '198.19.0.1/30', ti && ti.address)
var y5 = C.convert(Y('proxies:', '  - {name: A, type: trojan, server: a.com, port: 443, password: p, ip-version: ipv4-prefer}', 'rules:', '  - MATCH,A'), {})
ok('ip-version 映射为 domain_strategy', byTag(y5.config.outbounds, 'A').domain_strategy === 'prefer_ipv4', byTag(y5.config.outbounds, 'A').domain_strategy)
var y7 = C.convert(Y('dns:', '  enable: true', '  nameserver: [223.5.5.5]', '  direct-nameserver: [119.29.29.29]', 'proxies:', NODE, 'rules:', '  - MATCH,A'), {})
var dd = byTag(y7.config.dns.servers, 'dns-direct')
ok('direct-nameserver 用于直连解析', !!dd && JSON.stringify(dd).indexOf('119.29.29.29') >= 0, dd)
var y9 = C.convert(Y('proxies:', '  - {name: HTTPUpgrade, type: vmess, server: hu.example.com, port: 443, uuid: 11111111-1111-1111-1111-111111111111, tls: true, network: httpupgrade, ws-opts: {path: /upgrade, headers: {Host: cdn.example.com, X-Edge: edge-token}}}', 'rules:', '  - MATCH,HTTPUpgrade'), {})
var hu = byTag(y9.config.outbounds, 'HTTPUpgrade')
ok('HTTPUpgrade 保留 Host 与自定义请求头', !!hu && hu.transport && hu.transport.type === 'httpupgrade' && hu.transport.host === 'cdn.example.com' && hu.transport.headers && hu.transport.headers['X-Edge'] === 'edge-token' && hu.transport.headers.Host === undefined, hu && hu.transport)

sec('13 输出模式与节点适配')

var NY = [
	'proxies:',
	'  - {name: "AnyTLS", type: anytls, server: a1.com, port: 8443, password: pw, sni: a1.com, alpn: [h2], client-fingerprint: chrome, skip-cert-verify: true}',
	'  - {name: "VLESS-R", type: vless, server: a2.com, port: 443, uuid: 11111111-1111-1111-1111-111111111111, flow: xtls-rprx-vision, tls: true, servername: www.apple.com, client-fingerprint: chrome, packet-encoding: xudp, reality-opts: {public-key: PK, short-id: ab12}}',
	'  - {name: "VMess", type: vmess, server: a3.com, port: 443, uuid: 22222222-2222-2222-2222-222222222222, cipher: auto, alterId: 4, tls: true, network: ws, ws-opts: {path: /p, headers: {Host: a3.com}}}',
	'  - {name: "Trojan", type: trojan, server: a4.com, port: 443, password: tp, sni: a4.com}',
	'  - {name: "SS", type: ss, server: a5.com, port: 8388, cipher: aes-256-gcm, password: sp}',
	'  - {name: "HY2", type: hysteria2, server: a6.com, port: 443, password: hp, up: 50, down: 200, obfs: salamander, obfs-password: op, sni: a6.com}',
	'  - {name: "TUIC", type: tuic, server: a7.com, port: 443, uuid: 33333333-3333-3333-3333-333333333333, password: tup, congestion-controller: bbr, udp-relay-mode: native, sni: a7.com}',
	'  - {name: "WG", type: wireguard, server: a8.com, port: 51820, ip: 10.0.0.2/32, private-key: privkey, public-key: pubkey, mtu: 1408}',
	'  - {name: "SOCKS", type: socks5, server: a9.com, port: 1080, username: u, password: p}',
	'  - {name: "HTTPP", type: http, server: a10.com, port: 8080, username: u, password: p}',
	'  - {name: "日本东京 01", type: trojan, server: jp.com, port: 443, password: jp}',
	'  - {name: "剩余流量：88.8 GB", type: trojan, server: info1.com, port: 443, password: x}',
	'  - {name: "官网：example.com", type: trojan, server: info2.com, port: 443, password: x}',
	'  - {name: "大流量套餐节点 07", type: trojan, server: real.com, port: 443, password: x}',
	'proxy-groups:',
	'  - {name: 选择, type: select, proxies: [AnyTLS, "剩余流量：88.8 GB", DIRECT]}',
	'rules:',
	'  - MATCH,选择'
].join('\n')

var N = C.convert(NY, { mode: 'nodes' })
function nb(tag) { return byTag(N.config, tag) }

ok('节点模式返回数组', Array.isArray(N.config), typeof N.config)
ok('节点模式 JSON 为数组字面量', N.json.charAt(0) === '[' && N.json.charAt(N.json.length - 1) === ']')
ok('节点模式不输出 dns/inbounds/route', N.json.indexOf('"dns"') < 0 && N.json.indexOf('"inbounds"') < 0 && N.json.indexOf('"route"') < 0)
ok('节点模式不产生 selector/direct/block', N.config.filter(function (o) { return ['selector', 'urltest', 'direct', 'block'].indexOf(o.type) >= 0 }).length === 0)
ok('节点数量与真实节点一致', N.config.length === 12, N.config.length)
ok('report.mode = nodes', N.report.mode === 'nodes' && N.report.groups === 0 && N.report.rules === 0)
ok('输出为合法 JSON', (function () { try { return Array.isArray(JSON.parse(N.json)) } catch (e) { return false } })())
ok('无错误级诊断', N.report.errorCount === 0, N.report.issues)

var A = nb('AnyTLS')
ok('AnyTLS 字段完整', !!A && A.type === 'anytls' && A.server === 'a1.com' && A.server_port === 8443 && A.password === 'pw', A)
ok('AnyTLS TLS 映射', !!A && A.tls.enabled === true && A.tls.server_name === 'a1.com' && A.tls.insecure === true && A.tls.alpn[0] === 'h2', A && A.tls)
ok('AnyTLS 保留 uTLS 指纹', !!A && A.tls.utls.enabled === true && A.tls.utls.fingerprint === 'chrome', A && A.tls.utls)
ok('AnyTLS 会话字段（完整风格）', !!A && A.idle_session_check_interval === '30s' && A.idle_session_timeout === '30s' && A.min_idle_session === 0, A)

var V = nb('VLESS-R')
ok('VLESS 认证与流控', !!V && V.uuid === '11111111-1111-1111-1111-111111111111' && V.flow === 'xtls-rprx-vision' && V.packet_encoding === 'xudp', V)
ok('VLESS REALITY 完整嵌套', !!V && V.tls.reality.enabled === true && V.tls.reality.public_key === 'PK' && V.tls.reality.short_id === 'ab12', V && V.tls)
ok('VLESS uTLS 与 SNI 共存', !!V && V.tls.server_name === 'www.apple.com' && V.tls.utls.fingerprint === 'chrome', V && V.tls)

var M = nb('VMess')
ok('VMess 字段映射', !!M && M.uuid === '22222222-2222-2222-2222-222222222222' && M.security === 'auto' && M.alter_id === 4, M)
ok('VMess WS 传输', !!M && M.transport.type === 'ws' && M.transport.path === '/p' && M.transport.headers.Host === 'a3.com', M && M.transport)

var T = nb('Trojan')
ok('Trojan 密码与 TLS', !!T && T.password === 'tp' && T.tls.enabled === true && T.tls.server_name === 'a4.com', T)
var S = nb('SS')
ok('Shadowsocks method/password', !!S && S.method === 'aes-256-gcm' && S.password === 'sp', S)
var H = nb('HY2')
ok('Hysteria2 带宽与 obfs', !!H && H.up_mbps === 50 && H.down_mbps === 200 && H.obfs.type === 'salamander' && H.obfs.password === 'op', H)
ok('Hysteria2 密码与 TLS', !!H && H.password === 'hp' && H.tls.server_name === 'a6.com', H)
var U = nb('TUIC')
ok('TUIC 认证与拥塞控制', !!U && U.uuid === '33333333-3333-3333-3333-333333333333' && U.password === 'tup' && U.congestion_control === 'bbr' && U.udp_relay_mode === 'native', U)
var W = nb('WG')
ok('WireGuard endpoint 字段', !!W && W.address[0] === '10.0.0.2/32' && W.private_key === 'privkey' && W.mtu === 1408, W)
ok('WireGuard peer 字段', !!W && W.peers[0].address === 'a8.com' && W.peers[0].port === 51820 && W.peers[0].public_key === 'pubkey' && W.peers[0].allowed_ips.length === 2, W && W.peers)
ok('WireGuard 排在数组末尾', N.config[N.config.length - 1].type === 'wireguard', N.config[N.config.length - 1].tag)
var K = nb('SOCKS'), Q = nb('HTTPP')
ok('SOCKS 版本与认证', !!K && K.version === '5' && K.username === 'u' && K.password === 'p', K)
ok('HTTP 认证', !!Q && Q.type === 'http' && Q.username === 'u' && Q.password === 'p', Q)

ok('保留原节点名称', !!nb('日本东京 01') && !nb('\ud83c\uddef\ud83c\uddf5 日本东京 01'), N.config.map(function (o) { return o.tag }))
ok('默认不自动加旗帜', N.config.filter(function (o) { return /[\uD83C][\uDDE6-\uDDFF]/.test(o.tag) }).length === 0)
ok('订阅信息伪节点已过滤', N.report.filtered === 2 && !nb('剩余流量：88.8 GB') && !nb('官网：example.com'), N.report.filtered)
ok('弱关键词不误删真节点', !!nb('大流量套餐节点 07'))
ok('过滤可关闭', C.convert(NY, { mode: 'nodes', filterInfo: false }).config.length === 14)

var FL = C.convert(NY, { mode: 'nodes', flags: true })
ok('旗帜可选开启', byTag(FL.config, '\ud83c\uddef\ud83c\uddf5 日本东京 01') !== null, FL.config.map(function (o) { return o.tag }))
ok('旗帜不影响无地区节点', byTag(FL.config, 'AnyTLS') !== null)

var MI = C.convert(NY, { mode: 'nodes', style: 'minimal' })
var MA = byTag(MI.config, 'AnyTLS')
ok('Minimal 省略 AnyTLS 默认值', MA.idle_session_check_interval === undefined && MA.idle_session_timeout === undefined && MA.min_idle_session === undefined, MA)
ok('Minimal 保留关键字段', MA.password === 'pw' && MA.tls.server_name === 'a1.com' && MA.tls.utls.fingerprint === 'chrome', MA)
ok('Minimal 不影响节点数量', MI.config.length === N.config.length)
ok('report.style 可读', MI.report.style === 'minimal' && N.report.style === 'full')

var NF = C.convert(NY, { mode: 'nodes', keepFp: false })
ok('关闭指纹后不写 uTLS', byTag(NF.config, 'AnyTLS').tls.utls === undefined)

var FULLN = C.convert(NY, {})
var gsel = byTag(FULLN.config.outbounds, '选择')
ok('完整模式分组跳过已过滤节点', gsel.outbounds.indexOf('剩余流量：88.8 GB') < 0 && gsel.outbounds.indexOf('AnyTLS') >= 0, gsel.outbounds)
ok('完整模式 WireGuard 归 endpoints', (FULLN.config.endpoints || []).length === 1 && FULLN.report.endpoints === 1)
ok('完整模式 report.mode = full', FULLN.report.mode === 'full')

ok('validate 接受完整配置', C.validate(FULLN.config).ok, C.validate(FULLN.config).errors)
ok('validate 接受节点数组', C.validate(N.config).ok, C.validate(N.config).errors)
ok('validate 捕获重复标签', C.validate([{ type: 'direct', tag: 'x' }, { type: 'direct', tag: 'x' }]).errors.length === 1)
ok('validate 捕获悬空 detour', C.validate([{ type: 'trojan', tag: 'a', server: 's', server_port: 1, password: 'p', detour: 'ghost' }]).ok === false)
ok('validate 捕获无效 route.final', C.validate({ inbounds: [{ type: 'mixed' }], outbounds: [{ type: 'direct', tag: 'direct' }], route: { final: 'nope' } }).ok === false)
ok('validate 捕获空分组与悬空成员', C.validate({ inbounds: [{ type: 'mixed' }], outbounds: [{ type: 'selector', tag: 'g', outbounds: ['nope'] }, { type: 'direct', tag: 'direct' }], route: { final: 'direct' } }).errors.length === 1)
ok('validate 捕获悬空规则集', C.validate({ inbounds: [{ type: 'mixed' }], outbounds: [{ type: 'direct', tag: 'direct' }], route: { final: 'direct', rules: [{ rule_set: ['ghost'], outbound: 'direct' }] } }).ok === false)
ok('isInfoNode / regionOf 已导出', typeof C.isInfoNode === 'function' && typeof C.regionOf === 'function' && C.regionOf('SG-01') === 'SG')

console.log('\n' + (fails === 0 ? 'ALL PASS' : 'FAILURES: ' + fails) + '  (' + (total - fails) + '/' + total + ')')
process.exit(fails ? 1 : 0)
