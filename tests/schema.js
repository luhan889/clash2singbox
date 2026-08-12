/* sing-box 配置 Schema 校验器（离线）：node tests/schema.js
 *
 * 为什么存在：开发环境无网络、无官方二进制，跑不了 `sing-box check`。
 * 因此把 sing-box 1.11 – 1.14 的关键配置 schema 逐字段写死在这里，做等价检查：
 *   1. 未知字段——sing-box 使用严格 JSON 解码，多余字段会直接 error
 *   2. 必填字段缺失
 *   3. 字段类型错误
 *   4. 枚举取值非法
 *   5. 引用完整性（tag 去重、detour / outbound / rule_set / dns server 引用）
 * CI 中仍会用真实的 sing-box check 做最后一道确认，两者不互相替代。
 */
var fs = require('fs')
var path = require('path')
var C = require(path.join(__dirname, '..', 'assets', 'convert.js'))
var FIX = path.join(__dirname, '..', 'fixtures')
var MAIN = path.join(__dirname, 'fixture.yaml')

var errors = []
function err(at, msg) { errors.push(at + '：' + msg) }

/* ---------------- 类型工具 ---------------- */

var T = {
	str: function (v) { return typeof v === 'string' },
	num: function (v) { return typeof v === 'number' && isFinite(v) },
	int: function (v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v },
	bool: function (v) { return v === true || v === false },
	obj: function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v) },
	arr: function (v) { return Array.isArray(v) },
	port: function (v) { return typeof v === 'number' && Math.floor(v) === v && v >= 1 && v <= 65535 },
	dur: function (v) { return typeof v === 'string' && /^[0-9]+(\.[0-9]+)?(ns|us|ms|s|m|h|d)$/.test(v) },
	any: function () { return true }
}
T.strArr = function (v) {
	if (!Array.isArray(v)) return false
	for (var i = 0; i < v.length; i++) if (typeof v[i] !== 'string') return false
	return true
}
T.intArr = function (v) {
	if (!Array.isArray(v)) return false
	for (var i = 0; i < v.length; i++) if (typeof v[i] !== 'number') return false
	return true
}
T.strOrArr = function (v) { return typeof v === 'string' || T.strArr(v) }

function emptyDirectTag(config, tag) {
	var list = config.outbounds || [], j, o, k, n
	for (j = 0; j < list.length; j++) {
		o = list[j]
		if (!o || o.type !== 'direct' || o.tag !== tag) continue
		n = 0
		for (k in o) if (Object.prototype.hasOwnProperty.call(o, k) && k !== 'type' && k !== 'tag') n++
		return n === 0
	}
	return false
}
function legacyDnsConfig(config) {
	var list = (config.dns && config.dns.servers) || [], j
	for (j = 0; j < list.length; j++) if (list[j] && list[j].address !== undefined) return true
	return false
}
function enumOf(list) {
	var f = function (v) { return list.indexOf(v) >= 0 }
	f.__enum = list
	return f
}

function merge() {
	var out = {}, i, k
	for (i = 0; i < arguments.length; i++) {
		var src = arguments[i]
		for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k]
	}
	return out
}

/* 核心：字段白名单 + 类型 + 必填 */
function fields(at, obj, spec, required) {
	if (!T.obj(obj)) { err(at, '应为对象，实际 ' + JSON.stringify(obj)); return }
	var k
	for (k in obj) {
		if (!Object.prototype.hasOwnProperty.call(obj, k)) continue
		if (!spec[k]) { err(at, '未知字段 ' + k + '（sing-box 严格解码会直接报错）'); continue }
		if (!spec[k](obj[k])) {
			err(at + '.' + k, '取值非法 ' + JSON.stringify(obj[k]) +
				(spec[k].__enum ? '（合法值：' + spec[k].__enum.join(' / ') + '）' : ''))
		}
	}
	for (var i = 0; required && i < required.length; i++) {
		if (obj[required[i]] === undefined) err(at, '缺少必填字段 ' + required[i])
	}
}

/* ---------------- 公用枚举 ---------------- */

var DOMAIN_STRATEGY = enumOf(['', 'prefer_ipv4', 'prefer_ipv6', 'ipv4_only', 'ipv6_only'])
var NETWORK = enumOf(['tcp', 'udp'])
var NETWORK_LIST = function (v) {
	if (typeof v === 'string') return NETWORK(v)
	if (!Array.isArray(v)) return false
	for (var i = 0; i < v.length; i++) if (!NETWORK(v[i])) return false
	return true
}

/* ---------------- log / experimental / ntp ---------------- */

var LOG = {
	disabled: T.bool,
	level: enumOf(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic']),
	output: T.str,
	timestamp: T.bool
}

var CLASH_API = {
	external_controller: T.str,
	external_ui: T.str,
	external_ui_download_url: T.str,
	external_ui_download_detour: T.str,
	secret: T.str,
	default_mode: T.str,
	access_control_allow_origin: T.strArr,
	access_control_allow_private_network: T.bool
}

var CACHE_FILE = {
	enabled: T.bool,
	path: T.str,
	cache_id: T.str,
	store_fakeip: T.bool,
	store_rdrc: T.bool,
	rdrc_timeout: T.dur
}

var EXPERIMENTAL = { clash_api: T.obj, cache_file: T.obj, v2ray_api: T.obj, debug: T.obj }

/* ---------------- 入站 ---------------- */

var IN_COMMON = {
	type: T.str,
	tag: T.str,
	listen: T.str,
	listen_port: T.port,
	tcp_fast_open: T.bool,
	tcp_multi_path: T.bool,
	udp_fragment: T.bool,
	udp_timeout: T.dur,
	detour: T.str,
	sniff: T.bool,
	sniff_override_destination: T.bool,
	sniff_timeout: T.dur,
	domain_strategy: DOMAIN_STRATEGY,
	udp_disable_domain_unmapping: T.bool
}

var IN_TUN = merge(IN_COMMON, {
	interface_name: T.str,
	address: T.strArr,
	inet4_address: T.strOrArr,
	inet6_address: T.strOrArr,
	mtu: T.int,
	gso: T.bool,
	auto_route: T.bool,
	iproute2_table_index: T.int,
	iproute2_rule_index: T.int,
	auto_redirect: T.bool,
	auto_redirect_input_mark: T.any,
	auto_redirect_output_mark: T.any,
	loopback_address: T.strArr,
	strict_route: T.bool,
	route_address: T.strArr,
	route_exclude_address: T.strArr,
	route_address_set: T.strArr,
	route_exclude_address_set: T.strArr,
	inet4_route_address: T.strArr,
	inet6_route_address: T.strArr,
	inet4_route_exclude_address: T.strArr,
	inet6_route_exclude_address: T.strArr,
	endpoint_independent_nat: T.bool,
	stack: enumOf(['system', 'gvisor', 'mixed']),
	include_interface: T.strArr,
	exclude_interface: T.strArr,
	include_uid: T.intArr,
	include_uid_range: T.strArr,
	exclude_uid: T.intArr,
	exclude_uid_range: T.strArr,
	include_android_user: T.intArr,
	include_package: T.strArr,
	exclude_package: T.strArr,
	platform: T.obj
})

var IN_LISTEN = merge(IN_COMMON, {
	users: T.arr,
	set_system_proxy: T.bool
})

var INBOUND = {
	tun: { spec: IN_TUN, required: ['type'] },
	mixed: { spec: IN_LISTEN, required: ['type', 'listen'] },
	socks: { spec: IN_LISTEN, required: ['type', 'listen'] },
	http: { spec: IN_LISTEN, required: ['type', 'listen'] },
	direct: { spec: merge(IN_COMMON, { network: NETWORK_LIST, override_address: T.str, override_port: T.port }), required: ['type'] }
}

function checkInbound(at, v) {
	if (!T.obj(v)) { err(at, '入站应为对象'); return }
	var def = INBOUND[v.type]
	if (!def) { err(at, '未知入站类型 ' + JSON.stringify(v.type)); return }
	fields(at + '(' + v.type + ')', v, def.spec, def.required)
	if (v.users !== undefined) {
		for (var i = 0; i < v.users.length; i++) {
			fields(at + '.users[' + i + ']', v.users[i], { username: T.str, password: T.str }, ['username'])
		}
	}
	if (v.platform !== undefined) {
		fields(at + '.platform', v.platform, { http_proxy: T.obj })
	}
}


/* ---------------- TLS / 传输层 / Mux ---------------- */

var UTLS = { enabled: T.bool, fingerprint: enumOf(['chrome', 'firefox', 'edge', 'safari', 'ios', 'android', 'random', 'randomized', '360', 'qq']) }
var REALITY = { enabled: T.bool, public_key: T.str, short_id: T.str }
var ECH = { enabled: T.bool, pq_signature_schemes_enabled: T.bool, dynamic_record_sizing_disabled: T.bool, config: T.strArr, config_path: T.str }

var TLS = {
	enabled: T.bool,
	disable_sni: T.bool,
	server_name: T.str,
	insecure: T.bool,
	alpn: T.strArr,
	min_version: T.str,
	max_version: T.str,
	cipher_suites: T.strArr,
	certificate: T.strOrArr,
	certificate_path: T.str,
	fragment: T.bool,
	fragment_fallback_delay: T.dur,
	record_fragment: T.bool,
	utls: T.obj,
	reality: T.obj,
	ech: T.obj
}

function checkTls(at, v) {
	fields(at, v, TLS, ['enabled'])
	if (T.obj(v) && v.utls !== undefined) fields(at + '.utls', v.utls, UTLS, ['enabled'])
	if (T.obj(v) && v.reality !== undefined) fields(at + '.reality', v.reality, REALITY, ['enabled', 'public_key'])
	if (T.obj(v) && v.ech !== undefined) fields(at + '.ech', v.ech, ECH)
}

var TRANSPORT = {
	http: { type: T.str, host: T.strArr, path: T.str, method: T.str, headers: T.obj, idle_timeout: T.dur, ping_timeout: T.dur },
	ws: { type: T.str, path: T.str, headers: T.obj, max_early_data: T.int, early_data_header_name: T.str },
	quic: { type: T.str },
	grpc: { type: T.str, service_name: T.str, idle_timeout: T.dur, ping_timeout: T.dur, permit_without_stream: T.bool },
	httpupgrade: { type: T.str, host: T.str, path: T.str, headers: T.obj }
}

function checkTransport(at, v) {
	if (!T.obj(v)) { err(at, '传输层应为对象'); return }
	var spec = TRANSPORT[v.type]
	if (!spec) { err(at, '未知传输层类型 ' + JSON.stringify(v.type)); return }
	fields(at + '(' + v.type + ')', v, spec, ['type'])
	if (v.type === 'grpc' && !v.service_name) err(at, 'grpc 传输层缺少 service_name')
}

var MUX = {
	enabled: T.bool,
	protocol: enumOf(['smux', 'yamux', 'h2mux']),
	max_connections: T.int,
	min_streams: T.int,
	max_streams: T.int,
	padding: T.bool,
	brutal: T.obj
}

/* ---------------- 出站公用字段 ---------------- */

var DIAL = {
	detour: T.str,
	bind_interface: T.str,
	bind_address: T.str,
	inet4_bind_address: T.str,
	inet6_bind_address: T.str,
	routing_mark: T.int,
	reuse_addr: T.bool,
	connect_timeout: T.dur,
	tcp_fast_open: T.bool,
	tcp_multi_path: T.bool,
	udp_fragment: T.bool,
	domain_strategy: DOMAIN_STRATEGY,
	domain_resolver: T.any,
	network_strategy: T.str,
	network_type: T.strArr,
	fallback_network_type: T.strArr,
	fallback_delay: T.dur
}

var SERVER = { type: T.str, tag: T.str, server: T.str, server_port: T.port, server_ports: T.strArr }
var BASE = merge(SERVER, DIAL, { network: NETWORK_LIST, tls: T.obj, transport: T.obj, multiplex: T.obj })

/* ---------------- 出站 / endpoint ---------------- */

var OUTBOUND = {
	direct: { spec: merge(SERVER, DIAL, { override_address: T.str, override_port: T.port }), required: ['type', 'tag'] },
	block: { spec: { type: T.str, tag: T.str }, required: ['type', 'tag'] },
	selector: { spec: { type: T.str, tag: T.str, outbounds: T.strArr, 'default': T.str, interrupt_exist_connections: T.bool }, required: ['type', 'tag', 'outbounds'] },
	urltest: { spec: { type: T.str, tag: T.str, outbounds: T.strArr, url: T.str, interval: T.dur, tolerance: T.int, idle_timeout: T.dur, interrupt_exist_connections: T.bool }, required: ['type', 'tag', 'outbounds'] },
	shadowsocks: { spec: merge(BASE, { method: T.str, password: T.str, plugin: T.str, plugin_opts: T.str, udp_over_tcp: T.any }), required: ['type', 'tag', 'server', 'server_port', 'method', 'password'] },
	vmess: { spec: merge(BASE, { uuid: T.str, security: T.str, alter_id: T.int, global_padding: T.bool, authenticated_length: T.bool, packet_encoding: T.str }), required: ['type', 'tag', 'server', 'server_port', 'uuid'] },
	vless: { spec: merge(BASE, { uuid: T.str, flow: enumOf(['', 'xtls-rprx-vision']), packet_encoding: enumOf(['', 'packetaddr', 'xudp']) }), required: ['type', 'tag', 'server', 'server_port', 'uuid'] },
	trojan: { spec: merge(BASE, { password: T.str }), required: ['type', 'tag', 'server', 'server_port', 'password'] },
	hysteria: { spec: merge(BASE, { up: T.str, up_mbps: T.int, down: T.str, down_mbps: T.int, obfs: T.str, auth: T.str, auth_str: T.str, recv_window_conn: T.int, recv_window: T.int, disable_mtu_discovery: T.bool }), required: ['type', 'tag', 'server'] },
	hysteria2: { spec: merge(BASE, { up_mbps: T.int, down_mbps: T.int, obfs: T.obj, password: T.str, brutal_debug: T.bool }), required: ['type', 'tag', 'server'] },
	tuic: { spec: merge(BASE, { uuid: T.str, password: T.str, congestion_control: enumOf(['cubic', 'new_reno', 'bbr']), udp_relay_mode: enumOf(['native', 'quic']), udp_over_stream: T.bool, zero_rtt_handshake: T.bool, heartbeat: T.dur }), required: ['type', 'tag', 'server', 'server_port', 'uuid'] },
	anytls: { spec: merge(BASE, { password: T.str, idle_session_check_interval: T.dur, idle_session_timeout: T.dur, min_idle_session: T.int }), required: ['type', 'tag', 'server', 'server_port', 'password'] },
	shadowtls: { spec: merge(BASE, { version: T.int, password: T.str }), required: ['type', 'tag', 'server', 'server_port'] },
	socks: { spec: merge(BASE, { version: enumOf(['4', '4a', '5']), username: T.str, password: T.str, uot: T.bool }), required: ['type', 'tag', 'server', 'server_port'] },
	http: { spec: merge(BASE, { username: T.str, password: T.str, path: T.str, headers: T.obj }), required: ['type', 'tag', 'server', 'server_port'] },
	ssh: { spec: merge(SERVER, DIAL, { user: T.str, password: T.str, private_key: T.strOrArr, private_key_path: T.str, private_key_passphrase: T.str, host_key: T.strArr, host_key_algorithms: T.strArr, client_version: T.str }), required: ['type', 'tag', 'server'] },
	wireguard: { spec: merge(SERVER, DIAL, { system_interface: T.bool, gso: T.bool, interface_name: T.str, local_address: T.strArr, private_key: T.str, peer_public_key: T.str, pre_shared_key: T.str, reserved: T.any, workers: T.int, mtu: T.int, network: NETWORK_LIST }), required: ['type', 'tag'] }
}

var ENDPOINT = {
	wireguard: { spec: { type: T.str, tag: T.str, system: T.bool, name: T.str, mtu: T.int, address: T.strArr, private_key: T.str, listen_port: T.port, peers: T.arr, udp_timeout: T.dur, workers: T.int, detour: T.str, domain_resolver: T.any }, required: ['type', 'tag', 'address', 'private_key', 'peers'] },
	tailscale: { spec: { type: T.str, tag: T.str, state_directory: T.str, auth_key: T.str, control_url: T.str, ephemeral: T.bool, hostname: T.str, accept_routes: T.bool, exit_node: T.str, exit_node_allow_lan_access: T.bool, advertise_routes: T.strArr, advertise_exit_node: T.bool, udp_timeout: T.dur }, required: ['type', 'tag'] }
}

var PEER = { address: T.str, port: T.port, public_key: T.str, pre_shared_key: T.str, allowed_ips: T.strArr, persistent_keepalive_interval: T.int, reserved: T.any }

function checkNode(at, v, table, label) {
	if (!T.obj(v)) { err(at, label + '应为对象'); return }
	var def = table[v.type]
	if (!def) { err(at, '未知' + label + '类型 ' + JSON.stringify(v.type)); return }
	fields(at + '(' + v.type + ')', v, def.spec, def.required)
	if (v.tls !== undefined) checkTls(at + '.tls', v.tls)
	if (v.transport !== undefined) checkTransport(at + '.transport', v.transport)
	if (v.multiplex !== undefined) fields(at + '.multiplex', v.multiplex, MUX, ['enabled'])
	if ((v.type === 'hysteria' || v.type === 'hysteria2') && v.server_port === undefined && v.server_ports === undefined) err(at, '缺少 server_port 或 server_ports（端口跳跃）')
	if (v.type === 'hysteria2' && v.obfs !== undefined) fields(at + '.obfs', v.obfs, { type: T.str, password: T.str }, ['type'])
	if (Array.isArray(v.peers)) {
		for (var i = 0; i < v.peers.length; i++) fields(at + '.peers[' + i + ']', v.peers[i], PEER, ['address', 'port', 'public_key'])
	}
	if (v.udp_over_tcp !== undefined && T.obj(v.udp_over_tcp)) fields(at + '.udp_over_tcp', v.udp_over_tcp, { enabled: T.bool, version: T.int })
}

/* ---------------- DNS ---------------- */

var DNS_SERVER_NEW = {
	type: enumOf(['udp', 'tcp', 'tls', 'quic', 'https', 'h3', 'dhcp', 'fakeip', 'hosts', 'local', 'resolved', 'tailscale', 'predefined']),
	tag: T.str,
	server: T.str,
	server_port: T.port,
	path: T.str,
	headers: T.obj,
	interface: T.str,
	detour: T.str,
	domain_resolver: T.any,
	inet4_range: T.str,
	inet6_range: T.str,
	predefined: T.obj,
	hosts: T.any,
	bind_interface: T.str,
	inet4_bind_address: T.str,
	inet6_bind_address: T.str,
	routing_mark: T.int,
	connect_timeout: T.dur,
	tcp_fast_open: T.bool,
	udp_fragment: T.bool,
	network_strategy: T.str,
	accept_fallback: T.bool,
	tls: T.obj
}

var DNS_SERVER_OLD = {
	tag: T.str,
	address: T.str,
	address_resolver: T.str,
	address_strategy: DOMAIN_STRATEGY,
	strategy: DOMAIN_STRATEGY,
	detour: T.str,
	client_subnet: T.str
}

function checkDnsServer(at, v) {
	if (!T.obj(v)) { err(at, 'DNS server 应为对象'); return }
	if (v.type !== undefined) {
		fields(at + '(' + v.type + ')', v, DNS_SERVER_NEW, ['type'])
		if (v.tls !== undefined) checkTls(at + '.tls', v.tls)
	} else fields(at + '(legacy)', v, DNS_SERVER_OLD, ['address'])
}

var ACTION = enumOf(['route', 'route-options', 'reject', 'hijack-dns', 'sniff', 'resolve', 'predefined'])

var MATCH = {
	inbound: T.strOrArr, ip_version: T.int, network: NETWORK_LIST, auth_user: T.strOrArr,
	protocol: T.strOrArr, client: T.strOrArr,
	domain: T.strOrArr, domain_suffix: T.strOrArr, domain_keyword: T.strOrArr, domain_regex: T.strOrArr,
	geosite: T.strOrArr, source_geoip: T.strOrArr, geoip: T.strOrArr,
	source_ip_cidr: T.strOrArr, source_ip_is_private: T.bool, ip_cidr: T.strOrArr, ip_is_private: T.bool, ip_accept_any: T.bool,
	source_port: T.any, source_port_range: T.strOrArr, port: T.any, port_range: T.strOrArr,
	process_name: T.strOrArr, process_path: T.strOrArr, process_path_regex: T.strOrArr, package_name: T.strOrArr,
	user: T.strOrArr, user_id: T.any, clash_mode: T.str, query_type: T.any,
	network_type: T.strOrArr, network_is_expensive: T.bool, network_is_constrained: T.bool,
	wifi_ssid: T.strOrArr, wifi_bssid: T.strOrArr,
	rule_set: T.strOrArr, rule_set_ip_cidr_match_source: T.bool, rule_set_ip_cidr_accept_empty: T.bool,
	invert: T.bool, outbound: T.str, action: ACTION,
	type: T.str, mode: enumOf(['and', 'or']), rules: T.arr,
	/* 动作字段 */
	sniffer: T.strArr, timeout: T.dur, strategy: DOMAIN_STRATEGY, server: T.str,
	disable_cache: T.bool, rewrite_ttl: T.int, client_subnet: T.str,
	method: enumOf(['default', 'drop']), no_drop: T.bool,
	override_address: T.str, override_port: T.port,
	udp_disable_domain_unmapping: T.bool, udp_connect: T.bool, udp_timeout: T.dur,
	answer: T.any, ns: T.any, extra: T.any
}

var LOGICAL = { type: T.str, mode: MATCH.mode, rules: T.arr, invert: T.bool, outbound: T.str, action: ACTION, server: T.str, strategy: DOMAIN_STRATEGY, disable_cache: T.bool, rewrite_ttl: T.int, client_subnet: T.str, method: MATCH.method, no_drop: T.bool, sniffer: T.strArr, timeout: T.dur, udp_disable_domain_unmapping: T.bool, udp_connect: T.bool, udp_timeout: T.dur }

function checkRule(at, v, refs, isDns, nested) {
	if (!T.obj(v)) { err(at, '规则应为对象'); return }
	if (v.type === 'logical') {
		fields(at + '(logical)', v, LOGICAL, ['type', 'mode', 'rules'])
		if (Array.isArray(v.rules)) {
			if (!v.rules.length) err(at, 'logical 规则的 rules 为空')
			for (var i = 0; i < v.rules.length; i++) checkRule(at + '.rules[' + i + ']', v.rules[i], refs, isDns, true)
		}
	} else {
		fields(at, v, MATCH)
		if (v.type !== undefined) err(at, 'type 只能为 logical，实际 ' + JSON.stringify(v.type))
	}
	var keys = Object.keys(v)
	var matchKeys = 0
	for (var m = 0; m < keys.length; m++) {
		if (['outbound', 'action', 'server', 'type', 'mode', 'rules', 'invert', 'strategy', 'disable_cache', 'rewrite_ttl', 'client_subnet', 'method', 'no_drop', 'sniffer', 'timeout'].indexOf(keys[m]) < 0) matchKeys++
	}
	if (!matchKeys && v.type !== 'logical' && v.action === undefined) err(at, '规则没有任何匹配条件')
	/* 引用完整性 */
	var action = v.action || 'route'
	if (!isDns && !nested && action === 'route') {
		if (!v.outbound) err(at, 'route 动作缺少 outbound')
		else if (refs.tags.indexOf(v.outbound) < 0) err(at, 'outbound 引用不存在的 tag ' + JSON.stringify(v.outbound))
	}
	if (isDns && v.server !== undefined && refs.dnsTags.indexOf(v.server) < 0) err(at, 'server 引用不存在的 DNS tag ' + JSON.stringify(v.server))
	if (v.rule_set !== undefined) {
		var rs = typeof v.rule_set === 'string' ? [v.rule_set] : v.rule_set
		for (var r = 0; r < rs.length; r++) if (refs.ruleSets.indexOf(rs[r]) < 0) err(at, 'rule_set 引用不存在的 tag ' + JSON.stringify(rs[r]))
	}
}

var ROUTE = {
	rules: T.arr, rule_set: T.arr, final: T.str,
	default_http_client: T.str,
	auto_detect_interface: T.bool, override_android_vpn: T.bool,
	default_interface: T.str, default_mark: T.int,
	default_domain_resolver: T.any, default_network_strategy: T.str,
	find_process: T.bool, geoip: T.obj, geosite: T.obj
}

var RULESET = {
	type: enumOf(['local', 'remote', 'inline']), tag: T.str,
	format: enumOf(['binary', 'source']), url: T.str,
	download_detour: T.str, http_client: function (v) { return T.str(v) || T.obj(v) }, update_interval: T.dur, path: T.str, rules: T.arr
}

var DNS = {
	servers: T.arr, rules: T.arr, final: T.str, strategy: DOMAIN_STRATEGY,
	disable_cache: T.bool, disable_expire: T.bool, independent_cache: T.bool,
	cache_capacity: T.int, reverse_mapping: T.bool, client_subnet: T.str, fakeip: T.obj
}

var HTTP_CLIENT = { tag: T.str, engine: T.str, version: T.int, disable_version_fallback: T.bool, headers: T.obj, tls: T.obj, detour: T.str, domain_resolver: T.any }

var TOP = { '$schema': T.str, log: T.obj, dns: T.obj, ntp: T.obj, http_clients: T.arr, inbounds: T.arr, outbounds: T.arr, endpoints: T.arr, route: T.obj, experimental: T.obj, certificate: T.obj }

/* ---------------- 顶层校验 ---------------- */

function validateConfig(config) {
	errors = []
	if (!T.obj(config)) { err('config', '配置应为对象'); return errors }
	fields('config', config, TOP)

	if (config.log !== undefined) fields('log', config.log, LOG)
	if (config.experimental !== undefined) {
		fields('experimental', config.experimental, EXPERIMENTAL)
		if (config.experimental.clash_api !== undefined) fields('experimental.clash_api', config.experimental.clash_api, CLASH_API)
		if (config.experimental.cache_file !== undefined) fields('experimental.cache_file', config.experimental.cache_file, CACHE_FILE)
	}

	var refs = { tags: [], dnsTags: [], ruleSets: [], httpClients: [] }
	var all = (config.outbounds || []).concat(config.endpoints || [])
	var i, m
	for (i = 0; i < all.length; i++) {
		if (!T.obj(all[i]) || typeof all[i].tag !== 'string') continue
		if (refs.tags.indexOf(all[i].tag) >= 0) err('outbounds/endpoints', 'tag 重复：' + all[i].tag)
		refs.tags.push(all[i].tag)
	}
	if (config.dns && Array.isArray(config.dns.servers)) {
		for (i = 0; i < config.dns.servers.length; i++) {
			var dt = config.dns.servers[i] && config.dns.servers[i].tag
			if (typeof dt !== 'string') continue
			if (refs.dnsTags.indexOf(dt) >= 0) err('dns.servers[' + i + ']', 'tag 重复：' + dt)
			refs.dnsTags.push(dt)
		}
	}
	if (Array.isArray(config.http_clients)) {
		for (i = 0; i < config.http_clients.length; i++) {
			var hc = config.http_clients[i]
			fields('http_clients[' + i + ']', hc, HTTP_CLIENT, ['tag'])
			if (!T.obj(hc) || typeof hc.tag !== 'string') continue
			if (refs.httpClients.indexOf(hc.tag) >= 0) err('http_clients[' + i + ']', 'tag 重复：' + hc.tag)
			refs.httpClients.push(hc.tag)
		}
	}
	if (config.route && Array.isArray(config.route.rule_set)) {
		for (i = 0; i < config.route.rule_set.length; i++) {
			var rt = config.route.rule_set[i] && config.route.rule_set[i].tag
			if (typeof rt !== 'string') continue
			if (refs.ruleSets.indexOf(rt) >= 0) err('route.rule_set[' + i + ']', 'tag 重复：' + rt)
			refs.ruleSets.push(rt)
		}
	}

	/* 入站 */
	if (config.inbounds !== undefined) {
		if (!config.inbounds.length) err('inbounds', '入站为空，sing-box 无法接收流量')
		var ports = {}
		for (i = 0; i < config.inbounds.length; i++) {
			var inb = config.inbounds[i]
			checkInbound('inbounds[' + i + ']', inb)
			if (!T.obj(inb)) continue
			if (inb.listen_port) {
				var key = (inb.listen || '*') + ':' + inb.listen_port
				if (ports[key]) err('inbounds[' + i + ']', '监听端口冲突 ' + key)
				ports[key] = true
			}
			if (inb.detour !== undefined && refs.tags.indexOf(inb.detour) < 0) err('inbounds[' + i + ']', 'detour 引用不存在的 tag ' + inb.detour)
		}
	}

	/* 出站 */
	for (i = 0; i < (config.outbounds || []).length; i++) {
		var ob = config.outbounds[i]
		checkNode('outbounds[' + i + ']', ob, OUTBOUND, '出站')
		if (!T.obj(ob)) continue
		if (ob.type === 'selector' || ob.type === 'urltest') {
			var mem = Array.isArray(ob.outbounds) ? ob.outbounds : []
			if (!mem.length) err('outbounds[' + i + ']', ob.type + ' 组 ' + ob.tag + ' 成员为空（sing-box 会启动失败）')
			for (m = 0; m < mem.length; m++) if (refs.tags.indexOf(mem[m]) < 0) err('outbounds[' + i + ']', '组 ' + ob.tag + ' 引用不存在的成员 ' + mem[m])
			if (mem.indexOf(ob.tag) >= 0) err('outbounds[' + i + ']', '组 ' + ob.tag + ' 引用了自身，会造成环路')
			if (ob.default !== undefined && mem.indexOf(ob.default) < 0) err('outbounds[' + i + ']', 'default 不在成员列表中：' + ob.default)
		}
		if (ob.detour !== undefined && refs.tags.indexOf(ob.detour) < 0) err('outbounds[' + i + ']', 'detour 引用不存在的 tag ' + ob.detour)
		if (ob.detour !== undefined && !legacyDnsConfig(config) && emptyDirectTag(config, ob.detour)) err('outbounds[' + i + ']', 'detour 指向空 direct 出站 ' + ob.detour + '，sing-box 1.12+ 会拒绝启动')
	}
	for (i = 0; i < (config.endpoints || []).length; i++) checkNode('endpoints[' + i + ']', config.endpoints[i], ENDPOINT, 'endpoint')
	for (i = 0; i < (config.http_clients || []).length; i++) {
		var hc2 = config.http_clients[i]
		if (T.obj(hc2) && hc2.detour !== undefined && refs.tags.indexOf(hc2.detour) < 0) err('http_clients[' + i + ']', 'detour 引用不存在的 tag ' + hc2.detour)
	}

	/* DNS */
	if (config.dns !== undefined) {
		fields('dns', config.dns, DNS)
		if (config.dns.fakeip !== undefined) fields('dns.fakeip', config.dns.fakeip, { enabled: T.bool, inet4_range: T.str, inet6_range: T.str }, ['enabled'])
		for (i = 0; i < (config.dns.servers || []).length; i++) {
			checkDnsServer('dns.servers[' + i + ']', config.dns.servers[i])
			var ds = config.dns.servers[i]
			if (T.obj(ds) && ds.detour !== undefined && refs.tags.indexOf(ds.detour) < 0) err('dns.servers[' + i + ']', 'detour 引用不存在的 tag ' + ds.detour)
			if (T.obj(ds) && ds.detour !== undefined && ds.type !== undefined && emptyDirectTag(config, ds.detour)) err('dns.servers[' + i + ']', 'detour 指向空 direct 出站，sing-box 1.12+ 会拒绝启动（新式 DNS 服务器默认就是空 direct 拨号器）')
		}
		for (i = 0; i < (config.dns.rules || []).length; i++) checkRule('dns.rules[' + i + ']', config.dns.rules[i], refs, true)
		if (config.dns.final !== undefined && refs.dnsTags.indexOf(config.dns.final) < 0) err('dns.final', '引用不存在的 DNS tag ' + config.dns.final)
	}

	/* route */
	if (config.route !== undefined) {
		fields('route', config.route, ROUTE)
		for (i = 0; i < (config.route.rule_set || []).length; i++) {
			var rs = config.route.rule_set[i]
			fields('route.rule_set[' + i + ']', rs, RULESET, ['type', 'tag'])
			if (!T.obj(rs)) continue
			if (rs.type === 'remote' && !rs.url) err('route.rule_set[' + i + ']', 'remote 规则集缺少 url')
			if (rs.type === 'local' && !rs.path) err('route.rule_set[' + i + ']', 'local 规则集缺少 path')
			if (rs.type === 'inline' && !Array.isArray(rs.rules)) err('route.rule_set[' + i + ']', 'inline 规则集缺少 rules')
			if (rs.download_detour !== undefined && refs.tags.indexOf(rs.download_detour) < 0) err('route.rule_set[' + i + ']', 'download_detour 引用不存在的 tag ' + rs.download_detour)
			if (rs.download_detour !== undefined && !legacyDnsConfig(config) && emptyDirectTag(config, rs.download_detour)) err('route.rule_set[' + i + ']', 'download_detour 指向空 direct 出站，sing-box 1.12+ 会拒绝启动')
			if (typeof rs.http_client === 'string' && refs.httpClients.indexOf(rs.http_client) < 0) err('route.rule_set[' + i + ']', 'http_client 引用不存在的 tag ' + rs.http_client)
		}
		for (i = 0; i < (config.route.rules || []).length; i++) checkRule('route.rules[' + i + ']', config.route.rules[i], refs, false)
		if (config.route.final !== undefined && refs.tags.indexOf(config.route.final) < 0) err('route.final', '引用不存在的出站 tag ' + config.route.final)
		if (config.route.default_interface !== undefined && config.route.auto_detect_interface === true) err('route', 'default_interface 与 auto_detect_interface 互斥，sing-box 会直接报错')
		if (config.route.default_http_client !== undefined && refs.httpClients.indexOf(config.route.default_http_client) < 0) err('route.default_http_client', '引用不存在的 HTTP Client ' + config.route.default_http_client)
	}
	return errors
}

/* ---------------- 跑全部语料 ---------------- */

var fails = 0, total = 0

function run(name, config) {
	total++
	var errs = validateConfig(config)
	if (!errs.length) { console.log('  ok   ' + name); return }
	fails++
	console.log('  FAIL ' + name)
	for (var i = 0; i < Math.min(errs.length, 6); i++) console.log('        · ' + errs[i])
	if (errs.length > 6) console.log('        · …共 ' + errs.length + ' 条')
}

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

console.log('== 客户端预设')
;['universal', 'android', 'apple', 'desktop', 'gui'].forEach(function (preset) {
	run('full · ' + preset, C.convert(mainYaml, { preset: preset, pretty: true }).config)
})

console.log('== 客户端预设 × sing-box 1.11')
;['universal', 'android', 'apple', 'desktop', 'gui'].forEach(function (preset) {
	run('full · 1.11 · ' + preset, C.convert(mainYaml, { preset: preset, target: 'legacy', pretty: true }).config)
})

console.log('== 客户端预设 × sing-box 1.14+')
;['universal', 'android', 'apple', 'desktop', 'gui'].forEach(function (preset) {
	run('full · 1.14+ · ' + preset, C.convert(mainYaml, { preset: preset, target: 'latest', pretty: true }).config)
})

console.log('\n== 开关组合')
;[
	['tun+fakeip', { tun: true, fakeip: true, ipv6: true }],
	['no-tun+no-fakeip', { tun: false, fakeip: false, mixed: true, mixedPort: 7891 }],
	['legacy-1.11', { target: 'legacy' }],
	['latest-1.14', { target: 'latest', geoDetour: 'proxy' }],
	['minimal-style', { style: 'minimal' }],
	['no-filter', { filterInfo: false }],
	['flags-on', { flags: true, keepName: false }],
	['no-merge+resolve', { mergeRules: false, resolveIpRules: true, dnsFollowRoute: true }],
	['github-geo+proxy', { geoSource: 'github', geoDetour: 'proxy', clashApi: true }]
].forEach(function (pair) {
	run('full · ' + pair[0], C.convert(mainYaml, pair[1]).config)
})

console.log('\n== Fixture（完整配置 + 纯节点）')
fs.readdirSync(FIX).filter(function (f) { return /\.yaml$/.test(f) }).sort().forEach(function (file) {
	var name = file.replace(/\.yaml$/, '')
	var text = fs.readFileSync(path.join(FIX, file), 'utf8')
	run('full · ' + name, C.convert(text, {}).config)
	run('full · 1.14+ · ' + name, C.convert(text, { target: 'latest' }).config)
	run('nodes · ' + name, wrap(C.convert(text, { mode: 'nodes' }).config))
})

console.log('\n' + (fails === 0 ? 'SCHEMA ALL PASS' : 'SCHEMA FAILURES: ' + fails) + '  (' + (total - fails) + '/' + total + ')')
process.exit(fails ? 1 : 0)
