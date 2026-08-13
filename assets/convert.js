/*!
 * convert.js — Clash / Clash.Meta (mihomo) → sing-box 转换引擎
 * 目标内核：sing-box 1.11 ～ 1.14+（SFA / SFI / SFM / GUI.for.SingBox / CLI）
 * 纯本地、零依赖，可在主线程、Worker 与 Node 中运行。
 */
;(function (root, factory) {
	var api = factory()
	root.Clash2SingBox = api
	if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
	'use strict'

	var VERSION = '1.3.6'
	var _yaml = null
	function yaml() {
		if (_yaml) return _yaml
		if (typeof YAMLLite !== 'undefined') _yaml = YAMLLite
		else if (typeof require === 'function') _yaml = require('./yaml.js')
		if (!_yaml) throw new Error('YAML 解析器未加载')
		return _yaml
	}

	/* sing-box geo \u89c4\u5219\u96c6\u4e2d\u786e\u5b9e\u5b58\u5728\u7684\u540d\u79f0\uff0c\u907f\u514d\u51ed\u7a7a\u62fc\u51fa 404 \u5730\u5740 */
	var GEO_NAMES = 'apple:site google:both microsoft:site openai:site netflix:both youtube:site telegram:both twitter:site facebook:site instagram:site github:site spotify:site disney:site tiktok:site bilibili:site steam:site amazon:site paypal:site adobe:site oracle:site discord:site reddit:site twitch:site whatsapp:site line:site niconico:site pixiv:site onedrive:site speedtest:site bahamut:site hbo:site primevideo:site cloudflare:both akamai:site fastly:site cn:both private:both gfw:site geolocation-!cn:site geolocation-cn:site tld-!cn:site category-ads-all:site category-games:site category-porn:site category-media:site icloud:site googlefcm:site'
	var TARGET_CAPS = {
		legacy: { modernDns: false, wireguardEndpoint: false, httpClient: false, schema: false, label: '1.11' },
		modern: { modernDns: true, wireguardEndpoint: true, httpClient: false, schema: false, label: '1.12–1.13' },
		latest: { modernDns: true, wireguardEndpoint: true, httpClient: true, schema: true, label: '1.14 beta' }
	}
	function targetCaps(target) { return TARGET_CAPS[target] || TARGET_CAPS.modern }

	var DEFAULTS = {
		target: 'modern',
		preset: 'universal',
		mode: 'full',
		wrap: 'auto',
		style: 'full',
		filterInfo: true,
		keepFp: true,
		keepName: true,
		flags: false,
		tun: true,
		tunStack: 'auto',
		mixed: true,
		mixedPort: '',
		allowLan: false,
		ipv6: false,
		fakeip: true,
		dnsDirect: '',
		dnsProxy: '',
		dnsFollowRoute: true,
		lanDirect: true,
		sniff: true,
		resolveIpRules: true,
		clashApi: true,
		clashApiPort: '',
		cacheFile: true,
		geoSource: 'jsdelivr',
		geoTemplate: '',
		geoDetour: 'direct',
		ruleSetGuess: true,
		mergeRules: true,
		logLevel: 'info',
		pretty: true
	}

	var GEO = {
		jsdelivr: {
			site: 'https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/{name}.srs',
			ip: 'https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geoip/{name}.srs'
		},
		github: {
			site: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/{name}.srs',
			ip: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geoip/{name}.srs'
		},
		sagernet: {
			site: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-{name}.srs',
			ip: 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-{name}.srs'
		}
	}

	var SS_METHODS = {
		'none': 1, 'aes-128-gcm': 1, 'aes-192-gcm': 1, 'aes-256-gcm': 1,
		'chacha20-ietf-poly1305': 1, 'xchacha20-ietf-poly1305': 1,
		'2022-blake3-aes-128-gcm': 1, '2022-blake3-aes-256-gcm': 1, '2022-blake3-chacha20-poly1305': 1
	}
	var UTLS = { chrome: 1, firefox: 1, edge: 1, safari: 1, ios: 1, android: 1, random: 1, randomized: 1, '360': 1, qq: 1 }
	var LOYAL = {
		reject: ['site', 'category-ads-all'], icloud: ['site', 'icloud'], apple: ['site', 'apple'],
		google: ['site', 'google'], proxy: ['site', 'geolocation-!cn'], direct: ['site', 'cn'],
		private: ['site', 'private'], gfw: ['site', 'gfw'], greatfire: ['site', 'geolocation-!cn'],
		'tld-not-cn': ['site', 'tld-!cn'], telegramcidr: ['ip', 'telegram'], lancidr: ['ip', 'private'],
		cncidr: ['ip', 'cn'], applications: null
	}
	var FAKEIP_FILTER = ['+.lan', '+.local', '+.localdomain', '+.home.arpa', '+.msftconnecttest.com', '+.msftncsi.com', 'time.*.com', 'ntp.*.com', '+.stun.*', 'localhost.ptlogin2.qq.com']


	/* ---------------- 节点名：订阅信息识别 / 地区旗帜 / 精简 ---------------- */

	var INFO_STRONG = ['剩余流量', '剩余时间', '剩余天数', '距离下次重置', '距离重置', '套餐到期', '到期时间', '过期时间', '有效期至', '官网', '最新地址', '最新网址', '订阅地址', '剩余:', '剩余：', '重置日', '客服', '邀请码', '续费', '充值', '禁止分享', '请勿', 'expire', 'expiration', 'subscription', 'official website', 'remaining traffic', 'traffic reset', 'data reset']
	var INFO_WEAK = ['流量', '套餐', '到期', '重置', '订阅', '官方', 'traffic', 'reset', 'website', 'official', 'balance']
	var RE_INFO_CTX = /(gb|tb|mb|[天日]|20[0-9][0-9]|[:：%])/
	var RE_INFO_SCHEME = /https?:\/\//
	var RE_DIGIT = /[0-9]/
	var RE_FLAG = /[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/
	var RE_WORD = /[A-Za-z0-9]/
	var REGION = 'HK 香港 hongkong hong-kong hkg|TW 台湾 臺灣 台北 新北 彰化 taiwan|JP 日本 东京 大阪 埼玉 japan tokyo osaka|SG 新加坡 狮城 獅城 singapore|US 美国 美國 洛杉矶 圣何塞 西雅图 硅谷 凤凰城 达拉斯 纽约 芝加哥 united-states america los-angeles san-jose seattle|KR 韩国 韓國 首尔 korea seoul|GB 英国 英國 伦敦 london britain|DE 德国 德國 法兰克福 germany frankfurt|FR 法国 法國 巴黎 france paris|NL 荷兰 荷蘭 阿姆斯特丹 netherlands amsterdam|RU 俄罗斯 俄羅斯 莫斯科 russia moscow|CA 加拿大 多伦多 温哥华 canada toronto|AU 澳大利亚 澳洲 悉尼 australia sydney|IN 印度 india mumbai|TR 土耳其 turkey istanbul|BR 巴西 brazil|AR 阿根廷 argentina|VN 越南 vietnam|TH 泰国 泰國 曼谷 thailand|MY 马来西亚 馬來西亞 malaysia|PH 菲律宾 菲律賓 philippines|ID 印尼 印度尼西亚 indonesia jakarta|AE 阿联酋 迪拜 dubai emirates|IL 以色列 israel|ZA 南非 south-africa|MX 墨西哥 mexico|CL 智利 chile|CH 瑞士 switzerland zurich|SE 瑞典 sweden|NO 挪威 norway|FI 芬兰 芬蘭 finland|DK 丹麦 丹麥 denmark|PL 波兰 波蘭 poland|IT 意大利 義大利 米兰 italy milan|ES 西班牙 spain madrid|AT 奥地利 奧地利 austria|IE 爱尔兰 愛爾蘭 ireland dublin|UA 乌克兰 烏克蘭 ukraine|MO 澳门 澳門 macao macau|CN 中国 中國 回国 回國 上海 北京 广州 深圳 杭州 china|AM 亚美尼亚 亞美尼亞 armenia|KZ 哈萨克 kazakhstan|EG 埃及 egypt|SA 沙特 saudi|NZ 新西兰 紐西蘭 new-zealand|PT 葡萄牙 portugal|GR 希腊 希臘 greece|CZ 捷克 czech|HU 匈牙利 hungary|RO 罗马尼亚 romania|BG 保加利亚 bulgaria|LT 立陶宛 lithuania|LV 拉脱维亚 latvia|EE 爱沙尼亚 estonia|BE 比利时 belgium|LU 卢森堡 luxembourg|IS 冰岛 iceland|NG 尼日利亚 nigeria|KH 柬埔寨 cambodia|MM 缅甸 myanmar|LA 老挝 laos|MN 蒙古 mongolia|BD 孟加拉 bangladesh|PK 巴基斯坦 pakistan|LK 斯里兰卡 lanka|NP 尼泊尔 nepal|BN 文莱 brunei|CO 哥伦比亚 colombia|PE 秘鲁 peru|RS 塞尔维亚 serbia|BY 白俄罗斯 belarus|MD 摩尔多瓦 moldova'
	var _regions = null

	function isInfoNode(name) {
		var s = String(name === undefined || name === null ? '' : name).toLowerCase()
		if (!s) return false
		var i
		for (i = 0; i < INFO_STRONG.length; i++) if (s.indexOf(INFO_STRONG[i]) >= 0) return true
		for (i = 0; i < INFO_WEAK.length; i++) {
			if (s.indexOf(INFO_WEAK[i]) < 0) continue
			if (RE_DIGIT.test(s) && RE_INFO_CTX.test(s)) return true
		}
		if (RE_INFO_SCHEME.test(s)) return true
		return false
	}

	function regions() {
		if (_regions) return _regions
		_regions = []
		var rows = REGION.split('|')
		for (var i = 0; i < rows.length; i++) {
			var parts = rows[i].split(' ')
			var entry = { code: parts[0], cjk: [], ascii: [] }
			for (var j = 1; j < parts.length; j++) {
				var w = parts[j]
				if (!w) continue
				if (/^[\x21-\x7e]+$/.test(w)) entry.ascii.push(w.toLowerCase())
				else entry.cjk.push(w)
			}
			_regions.push(entry)
		}
		return _regions
	}

	function wordHit(hay, word) {
		var at = hay.indexOf(word)
		while (at >= 0) {
			var before = at === 0 ? '' : hay.charAt(at - 1)
			var after = hay.charAt(at + word.length)
			if (!RE_WORD.test(before) && !RE_WORD.test(after)) return true
			at = hay.indexOf(word, at + 1)
		}
		return false
	}

	function regionOf(name) {
		var raw = String(name === undefined || name === null ? '' : name)
		if (!raw) return null
		var low = raw.toLowerCase()
		var table = regions(), i, j
		for (i = 0; i < table.length; i++) for (j = 0; j < table[i].cjk.length; j++) if (raw.indexOf(table[i].cjk[j]) >= 0) return table[i].code
		for (i = 0; i < table.length; i++) for (j = 0; j < table[i].ascii.length; j++) if (table[i].ascii[j].length > 2 && low.indexOf(table[i].ascii[j]) >= 0) return table[i].code
		for (i = 0; i < table.length; i++) if (wordHit(raw, table[i].code)) return table[i].code
		return null
	}

	function flagOf(code) {
		if (!code || code.length !== 2) return ''
		var a = code.charCodeAt(0) - 65, b = code.charCodeAt(1) - 65
		if (a < 0 || a > 25 || b < 0 || b > 25) return ''
		return '\uD83C' + String.fromCharCode(0xDDE6 + a) + '\uD83C' + String.fromCharCode(0xDDE6 + b)
	}

	function cleanName(text) {
		return String(text)
			.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
			.replace(/[\u2190-\u2BFF\uFE0E\uFE0F\u200B-\u200D\u2122\u00AE]/g, '')
			.replace(/\s{2,}/g, ' ')
			.replace(/^[\s\-_|·]+/, '')
			.replace(/[\s\-_|·]+$/, '')
	}

	/* 节点名策略与协议转换完全解耦：仅在此处决定 tag 文本 */
	function decorate(name, opts) {
		var out = String(name)
		if (opts.keepName === false) {
			var cleaned = cleanName(out)
			if (cleaned) out = cleaned
		}
		if (opts.flags === true && !RE_FLAG.test(out)) {
			var code = regionOf(out)
			if (code) out = flagOf(code) + ' ' + out
		}
		return out
	}

	/* Minimal 输出：仅删除与 sing-box 默认值完全一致的字段 */
	function minifyNode(ob) {
		if (!ob || typeof ob !== 'object') return ob
		var t = ob.type
		if (t === 'vmess') {
			if (ob.security === 'auto') delete ob.security
			if (ob.alter_id === 0) delete ob.alter_id
		}
		if (t === 'socks' && ob.version === '5') delete ob.version
		if (t === 'anytls') {
			if (ob.idle_session_check_interval === '30s') delete ob.idle_session_check_interval
			if (ob.idle_session_timeout === '30s') delete ob.idle_session_timeout
			if (ob.min_idle_session === 0) delete ob.min_idle_session
		}
		if (t === 'tuic') {
			if (ob.congestion_control === 'cubic') delete ob.congestion_control
			if (ob.udp_relay_mode === 'native') delete ob.udp_relay_mode
			if (ob.heartbeat === '10s') delete ob.heartbeat
		}
		if (t === 'hysteria2' && ob.hop_interval === '30s') delete ob.hop_interval
		if (ob.tls) {
			if (ob.tls.insecure === false) delete ob.tls.insecure
			if (ob.tls.disable_sni === false) delete ob.tls.disable_sni
		}
		if (ob.transport && ob.transport.path === '/' && (ob.transport.type === 'ws' || ob.transport.type === 'httpupgrade' || ob.transport.type === 'http')) delete ob.transport.path
		if (ob.tcp_fast_open === false) delete ob.tcp_fast_open
		if (ob.multiplex && ob.multiplex.padding === false) delete ob.multiplex.padding
		return ob
	}

	/* ---------------- 基础工具 ---------------- */

	function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now() }
	function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v) }
	function has(o, k) { return isObj(o) && o[k] !== undefined && o[k] !== null && o[k] !== '' }
	function pick(o) { for (var i = 1; i < arguments.length; i++) if (has(o, arguments[i])) return o[arguments[i]]; return undefined }
	function str(v) { return v === undefined || v === null || v === '' ? undefined : String(v) }
	function int(v) { if (v === undefined || v === null || v === '') return undefined; var n = parseInt(v, 10); return isFinite(n) ? n : undefined }
	function bool(v) {
		if (v === undefined || v === null || v === '') return undefined
		if (typeof v === 'boolean') return v
		var s = String(v).toLowerCase()
		return s === 'true' || s === '1' || s === 'yes' || s === 'on'
	}
	function list(v) { return v === undefined || v === null || v === '' ? undefined : Array.isArray(v) ? v.slice() : [v] }
	function strList(v) {
		var a = list(v)
		if (!a) return undefined
		var out = []
		for (var i = 0; i < a.length; i++) if (a[i] !== null && a[i] !== undefined && a[i] !== '') out.push(String(a[i]))
		return out.length ? out : undefined
	}
	function assign(target) {
		for (var i = 1; i < arguments.length; i++) {
			var src = arguments[i]
			if (!src) continue
			for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) target[k] = src[k]
		}
		return target
	}
	function hostPort(host, port) {
		if (!host) return ''
		var h = String(host)
		if (h.indexOf(':') >= 0 && h.charAt(0) !== '[') h = '[' + h + ']'
		return port ? h + ':' + port : h
	}
	function isIp(host) { return !host || /^[0-9.]+$/.test(host) || String(host).indexOf(':') >= 0 }
	function dur(v, unit) {
		if (v === undefined || v === null || v === '') return undefined
		if (typeof v === 'number') return v + (unit || 's')
		var s = String(v).trim()
		return /^\d+$/.test(s) ? s + (unit || 's') : s
	}
	function bw(v) {
		if (v === undefined || v === null || v === '') return undefined
		if (typeof v === 'number') return Math.max(0, Math.round(v))
		var m = /^\s*([0-9]*\.?[0-9]+)\s*([a-zA-Z/]*)\s*$/.exec(String(v))
		if (!m) return undefined
		var n = parseFloat(m[1]), u = (m[2] || '').toLowerCase().replace(/\/s$/, ''), mul = 1
		if (u === '' || u === 'm' || u === 'mbps' || u === 'mbit') mul = 1
		else if (u === 'k' || u === 'kbps' || u === 'kbit') mul = 0.001
		else if (u === 'g' || u === 'gbps' || u === 'gbit') mul = 1000
		else if (u === 'b' || u === 'bps') mul = 0.000001
		else if (u === 'kb') mul = 0.008
		else if (u === 'mb') mul = 8
		else if (u === 'gb') mul = 8000
		return Math.max(0, Math.round(n * mul))
	}
	function b64bytes(s) {
		try {
			var bin = typeof atob === 'function' ? atob(String(s)) : Buffer.from(String(s), 'base64').toString('binary')
			var out = []
			for (var i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i))
			return out
		} catch (e) { return null }
	}
	function toRegExp(pattern) {
		var flags = ''
		var body = String(pattern).replace(/\(\?i\)/g, function () { flags = 'i'; return '' })
		return new RegExp(body, flags)
	}
	function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

	/* ---------------- 诊断信息（去重聚合） ---------------- */

	function Diag() { this.map = {}; this.order = [] }
	Diag.prototype.push = function (level, title, sample) {
		var key = level + '|' + title
		var item = this.map[key]
		if (!item) {
			item = this.map[key] = { level: level, title: title, count: 0, samples: [] }
			this.order.push(item)
		}
		item.count++
		if (sample && item.samples.length < 6 && item.samples.indexOf(String(sample)) < 0) item.samples.push(String(sample))
		return item
	}
	Diag.prototype.error = function (t, s) { return this.push('error', t, s) }
	Diag.prototype.warn = function (t, s) { return this.push('warn', t, s) }
	Diag.prototype.info = function (t, s) { return this.push('info', t, s) }
	Diag.prototype.all = function () {
		var rank = { error: 0, warn: 1, info: 2 }
		return this.order.slice().sort(function (a, b) { return rank[a.level] - rank[b.level] || b.count - a.count })
	}

	/* ---------------- TLS / 传输层 / 多路复用 ---------------- */

	function fingerprint(p, clash) {
		var fp = str(pick(p, 'client-fingerprint', 'client_fingerprint')) || str(pick(clash || {}, 'global-client-fingerprint'))
		if (!fp) return undefined
		fp = fp.toLowerCase()
		return UTLS[fp] ? fp : 'chrome'
	}

	function buildTls(p, ctx, force) {
		var reality = pick(p, 'reality-opts', 'reality_opts')
		var enabled = bool(pick(p, 'tls')) === true || !!force || isObj(reality)
		if (!enabled) return undefined
		var tls = { enabled: true }
		var sni = str(pick(p, 'servername', 'sni', 'server-name', 'peer'))
		if (sni) tls.server_name = sni
		if (bool(pick(p, 'skip-cert-verify', 'skip_cert_verify')) === true) tls.insecure = true
		if (bool(pick(p, 'disable-sni')) === true) tls.disable_sni = true
		var alpn = strList(pick(p, 'alpn'))
		if (alpn) tls.alpn = alpn
		var ca = str(pick(p, 'ca-str', 'ca_str', 'certificate'))
		if (ca) tls.certificate = ca.split('\n')
		var fp = fingerprint(p, ctx.clash)
		if (isObj(reality)) {
			var pub = str(pick(reality, 'public-key', 'public_key'))
			var sid = str(pick(reality, 'short-id', 'short_id'))
			if (!pub) { ctx.diag.error('REALITY 缺少 public-key，节点已跳过', p.name); return null }
			tls.reality = { enabled: true, public_key: pub }
			if (sid !== undefined) tls.reality.short_id = sid
			if (ctx.opts.keepFp !== false) tls.utls = { enabled: true, fingerprint: fp || 'chrome' }
		} else if (fp && ctx.opts.keepFp !== false) {
			tls.utls = { enabled: true, fingerprint: fp }
		}
		var ech = pick(p, 'ech-opts', 'ech_opts')
		if (isObj(ech) && bool(pick(ech, 'enable')) === true) {
			tls.ech = { enabled: true }
			var cfg = str(pick(ech, 'config'))
			if (cfg) tls.ech.config = cfg.split('\n')
		}
		return tls
	}

	function headersOf(raw) {
		if (!isObj(raw)) return undefined
		var out = {}, any = false
		for (var k in raw) {
			if (!Object.prototype.hasOwnProperty.call(raw, k)) continue
			var v = raw[k]
			if (Array.isArray(v)) { var a = strList(v); if (a) { out[k] = a.length === 1 ? a[0] : a; any = true } }
			else if (v !== null && v !== undefined && v !== '') { out[k] = String(v); any = true }
		}
		return any ? out : undefined
	}

	function buildTransport(p, ctx, tlsOn) {
		var net = String(pick(p, 'network') || 'tcp').toLowerCase()
		var name = p.name
		if (net === 'tcp' || net === '') {
			var httpOpts = pick(p, 'http-opts', 'http_opts')
			if (!isObj(httpOpts)) return undefined
			var paths = strList(pick(httpOpts, 'path')) || ['/']
			var t = { type: 'http', path: paths[0] }
			var method = str(pick(httpOpts, 'method'))
			if (method) t.method = method
			var hd = headersOf(pick(httpOpts, 'headers'))
			if (hd) {
				var hostHeader = hd.Host || hd.host
				if (hostHeader) { t.host = Array.isArray(hostHeader) ? hostHeader : [hostHeader]; delete hd.Host; delete hd.host }
				if (Object.keys(hd).length) t.headers = hd
			}
			if (paths.length > 1) ctx.diag.info('HTTP 伪装多路径仅保留第一个', name)
			return t
		}
		if (net === 'ws') {
			var ws = pick(p, 'ws-opts', 'ws_opts') || {}
			var path = str(pick(ws, 'path')) || str(pick(p, 'ws-path')) || '/'
			var headers = headersOf(pick(ws, 'headers')) || headersOf(pick(p, 'ws-headers'))
			var early = int(pick(ws, 'max-early-data', 'max_early_data'))
			var earlyName = str(pick(ws, 'early-data-header-name', 'early_data_header_name'))
			var ed = /[?&]ed=(\d+)/.exec(path)
			if (ed) {
				if (early === undefined) early = int(ed[1])
				if (!earlyName) earlyName = 'Sec-WebSocket-Protocol'
				path = path.replace(/[?&]ed=\d+/, '').replace(/\?$/, '') || '/'
			}
			if (bool(pick(ws, 'v2ray-http-upgrade', 'v2ray_http_upgrade')) === true) {
				var hu = { type: 'httpupgrade', path: path }
				var hh = headers && (headers.Host || headers.host)
				if (hh) { hu.host = Array.isArray(hh) ? hh[0] : hh; delete headers.Host; delete headers.host }
				if (headers && Object.keys(headers).length) hu.headers = headers
				return hu
			}
			var out = { type: 'ws', path: path }
			if (headers && Object.keys(headers).length) out.headers = headers
			if (early !== undefined && early > 0) {
				out.max_early_data = early
				out.early_data_header_name = earlyName || 'Sec-WebSocket-Protocol'
			}
			return out
		}
		if (net === 'grpc') {
			var g = pick(p, 'grpc-opts', 'grpc_opts') || {}
			var svc = str(pick(g, 'grpc-service-name', 'grpc_service_name', 'serviceName'))
			var gt = { type: 'grpc' }
			if (svc) gt.service_name = svc
			return gt
		}
		if (net === 'h2' || net === 'http2') {
			var h2 = pick(p, 'h2-opts', 'h2_opts') || {}
			var ht = { type: 'http' }
			var hosts = strList(pick(h2, 'host'))
			if (hosts) ht.host = hosts
			var hp = str(pick(h2, 'path'))
			if (hp) ht.path = hp
			if (!tlsOn) ctx.diag.warn('h2 传输未开启 TLS，sing-box 将降级为 HTTP/1.1', name)
			return ht
		}
		if (net === 'httpupgrade') {
			var hu2 = pick(p, 'ws-opts', 'ws_opts') || {}
			var t2 = { type: 'httpupgrade', path: str(pick(hu2, 'path')) || '/' }
			var hs = headersOf(pick(hu2, 'headers'))
			var hostv = hs && (hs.Host || hs.host)
			if (hostv) {
				t2.host = Array.isArray(hostv) ? hostv[0] : hostv
				delete hs.Host
				delete hs.host
			}
			if (hs && Object.keys(hs).length) t2.headers = hs
			return t2
		}
		if (net === 'quic') {
			ctx.diag.warn('QUIC 传输层兼容性有限，请在客户端验证', name)
			return { type: 'quic' }
		}
		ctx.diag.warn('未知传输层 network=' + net + '，已忽略', name)
		return undefined
	}

	function buildMux(p) {
		var smux = pick(p, 'smux')
		if (!isObj(smux) || bool(pick(smux, 'enabled')) !== true) return undefined
		var mux = { enabled: true }
		var proto = str(pick(smux, 'protocol'))
		if (proto) mux.protocol = proto.toLowerCase()
		var mc = int(pick(smux, 'max-connections', 'max_connections'))
		if (mc) mux.max_connections = mc
		var mins = int(pick(smux, 'min-streams', 'min_streams'))
		if (mins) mux.min_streams = mins
		var maxs = int(pick(smux, 'max-streams', 'max_streams'))
		if (maxs) mux.max_streams = maxs
		if (bool(pick(smux, 'padding')) === true) mux.padding = true
		var brutal = pick(smux, 'brutal-opts', 'brutal')
		if (isObj(brutal) && bool(pick(brutal, 'enabled')) === true) {
			mux.brutal = { enabled: true, up_mbps: bw(pick(brutal, 'up')) || 100, down_mbps: bw(pick(brutal, 'down')) || 100 }
		}
		return mux
	}

	function dialFields(out, p) {
		if (bool(pick(p, 'udp')) === false) out.network = 'tcp'
		if (bool(pick(p, 'tfo', 'fast-open', 'fast_open')) === true) out.tcp_fast_open = true
		var ipVer = String(str(pick(p, 'ip-version', 'ip_version')) || '').toLowerCase()
		if (ipVer === 'ipv4') out.domain_strategy = 'ipv4_only'
		else if (ipVer === 'ipv6') out.domain_strategy = 'ipv6_only'
		else if (ipVer === 'ipv4-prefer') out.domain_strategy = 'prefer_ipv4'
		else if (ipVer === 'ipv6-prefer') out.domain_strategy = 'prefer_ipv6'
		if (bool(pick(p, 'mptcp')) === true) out.tcp_multi_path = true
		var iface = str(pick(p, 'interface-name', 'interface_name'))
		if (iface) out.bind_interface = iface
		var mark = int(pick(p, 'routing-mark', 'routing_mark'))
		if (mark) out.routing_mark = mark
		return out
	}

	function base(type, p, tag) {
		return { type: type, tag: tag, server: str(pick(p, 'server')), server_port: int(pick(p, 'port', 'server-port', 'server_port')) }
	}

	/* ---------------- 协议转换 ---------------- */

	var PROTO = {}

	PROTO.ss = PROTO.shadowsocks = function (p, tag, ctx) {
		var method = String(pick(p, 'cipher', 'method') || '').toLowerCase()
		if (!SS_METHODS[method]) {
			ctx.diag.error('Shadowsocks 加密方式 “' + (method || '空') + '” 已被 sing-box 移除，节点已跳过', p.name)
			return null
		}
		var out = base('shadowsocks', p, tag)
		out.method = method
		out.password = str(pick(p, 'password')) || ''
		var plugin = String(pick(p, 'plugin') || '').toLowerCase()
		var po = pick(p, 'plugin-opts', 'plugin_opts') || {}
		var extra = []
		if (plugin === 'obfs' || plugin === 'obfs-local' || plugin === 'simple-obfs') {
			out.plugin = 'obfs-local'
			var parts = ['obfs=' + (str(pick(po, 'mode')) || 'http')]
			var host = str(pick(po, 'host'))
			if (host) parts.push('obfs-host=' + host)
			var opath = str(pick(po, 'path'))
			if (opath) parts.push('obfs-uri=' + opath)
			out.plugin_opts = parts.join(';')
		} else if (plugin === 'v2ray-plugin') {
			out.plugin = 'v2ray-plugin'
			var vp = ['mode=' + (str(pick(po, 'mode')) || 'websocket')]
			if (bool(pick(po, 'tls')) === true) vp.push('tls')
			var vhost = str(pick(po, 'host'))
			if (vhost) vp.push('host=' + vhost)
			var vpath = str(pick(po, 'path'))
			if (vpath) vp.push('path=' + vpath)
			if (bool(pick(po, 'skip-cert-verify')) === true) vp.push('skip-cert-verify')
			out.plugin_opts = vp.join(';')
		} else if (plugin === 'shadow-tls') {
			var stTag = ctx.tags.unique(tag + '-shadowtls')
			var st = { type: 'shadowtls', tag: stTag, server: out.server, server_port: out.server_port }
			st.version = int(pick(po, 'version')) || 3
			st.password = str(pick(po, 'password')) || ''
			st.tls = { enabled: true }
			var stHost = str(pick(po, 'host'))
			if (stHost) st.tls.server_name = stHost
			if (bool(pick(po, 'skip-cert-verify')) === true) st.tls.insecure = true
			var stAlpn = strList(pick(po, 'alpn'))
			if (stAlpn) st.tls.alpn = stAlpn
			var stFp = fingerprint(po, ctx.clash) || fingerprint(p, ctx.clash)
			if (stFp && ctx.opts.keepFp !== false) st.tls.utls = { enabled: true, fingerprint: stFp }
			extra.push(st)
			delete out.server
			delete out.server_port
			out.detour = stTag
			ctx.diag.info('shadow-tls 已拆分为 shadowtls + shadowsocks 链式出站', p.name)
		} else if (plugin && plugin !== 'none') {
			ctx.diag.error('不支持的 SS 插件 “' + plugin + '”，节点已跳过', p.name)
			return null
		}
		if (bool(pick(p, 'udp-over-tcp', 'udp_over_tcp')) === true) {
			out.udp_over_tcp = { enabled: true, version: int(pick(p, 'udp-over-tcp-version')) || 2 }
		}
		var mux = buildMux(p)
		if (mux) out.multiplex = mux
		return { outbound: dialFields(out, p), extra: extra }
	}

	PROTO.vmess = function (p, tag, ctx) {
		var out = base('vmess', p, tag)
		out.uuid = str(pick(p, 'uuid'))
		if (!out.uuid) { ctx.diag.error('VMess 缺少 uuid，节点已跳过', p.name); return null }
		out.security = String(pick(p, 'cipher', 'security') || 'auto').toLowerCase()
		var aid = int(pick(p, 'alterId', 'alterid', 'alter-id', 'alter_id'))
		if (aid) out.alter_id = aid
		if (bool(pick(p, 'global-padding', 'global_padding')) === true) out.global_padding = true
		if (bool(pick(p, 'authenticated-length', 'authenticated_length')) === true) out.authenticated_length = true
		var tls = buildTls(p, ctx)
		if (tls === null) return null
		if (tls) out.tls = tls
		var tr = buildTransport(p, ctx, !!tls)
		if (tr) out.transport = tr
		var pe = str(pick(p, 'packet-encoding', 'packet_encoding'))
		if (pe) out.packet_encoding = pe
		var mux = buildMux(p)
		if (mux) out.multiplex = mux
		return { outbound: dialFields(out, p) }
	}

	PROTO.vless = function (p, tag, ctx) {
		var out = base('vless', p, tag)
		out.uuid = str(pick(p, 'uuid'))
		if (!out.uuid) { ctx.diag.error('VLESS 缺少 uuid，节点已跳过', p.name); return null }
		var flow = String(pick(p, 'flow') || '').toLowerCase()
		if (flow) {
			if (flow.indexOf('vision') >= 0) out.flow = 'xtls-rprx-vision'
			else ctx.diag.warn('VLESS flow “' + flow + '” 不被 sing-box 支持，已置空', p.name)
		}
		var tls = buildTls(p, ctx)
		if (tls === null) return null
		if (tls) out.tls = tls
		var tr = buildTransport(p, ctx, !!tls)
		if (tr) out.transport = tr
		var pe = str(pick(p, 'packet-encoding', 'packet_encoding'))
		if (pe) out.packet_encoding = pe === 'packet' ? 'packetaddr' : pe
		var mux = buildMux(p)
		if (mux) out.multiplex = mux
		return { outbound: dialFields(out, p) }
	}

	PROTO.trojan = function (p, tag, ctx) {
		var out = base('trojan', p, tag)
		out.password = str(pick(p, 'password')) || ''
		var tls = buildTls(p, ctx, true)
		if (tls === null) return null
		out.tls = tls
		var tr = buildTransport(p, ctx, true)
		if (tr) out.transport = tr
		if (has(p, 'ss-opts') || has(p, 'ss_opts')) ctx.diag.warn('Trojan-Go 的 ss-opts 不被 sing-box 支持，已忽略', p.name)
		var mux = buildMux(p)
		if (mux) out.multiplex = mux
		return { outbound: dialFields(out, p) }
	}

	PROTO.hysteria = function (p, tag, ctx) {
		var out = base('hysteria', p, tag)
		var up = bw(pick(p, 'up', 'up-mbps', 'up_mbps'))
		var down = bw(pick(p, 'down', 'down-mbps', 'down_mbps'))
		if (up) out.up_mbps = up
		if (down) out.down_mbps = down
		var auth = str(pick(p, 'auth-str', 'auth_str', 'auth'))
		if (auth) out.auth_str = auth
		var obfs = str(pick(p, 'obfs'))
		if (obfs) out.obfs = obfs
		var proto = String(pick(p, 'protocol') || 'udp').toLowerCase()
		if (proto !== 'udp') ctx.diag.warn('Hysteria protocol=' + proto + ' 不被 sing-box 支持（仅 udp）', p.name)
		var rwc = int(pick(p, 'recv-window-conn', 'recv_window_conn'))
		if (rwc) out.recv_window_conn = rwc
		var rw = int(pick(p, 'recv-window', 'recv_window'))
		if (rw) out.recv_window = rw
		if (bool(pick(p, 'disable-mtu-discovery', 'disable_mtu_discovery')) === true) out.disable_mtu_discovery = true
		out.tls = buildTls(p, ctx, true)
		return { outbound: dialFields(out, p) }
	}

	PROTO.hysteria2 = PROTO.hy2 = function (p, tag, ctx) {
		var out = base('hysteria2', p, tag)
		var ports = str(pick(p, 'ports', 'port-range', 'server-ports'))
		if (ports) {
			var ranges = [], segs = ports.split(/[,;]/)
			for (var i = 0; i < segs.length; i++) {
				var t = segs[i].trim()
				if (!t) continue
				var m = /^(\d+)\s*[-:]\s*(\d+)$/.exec(t)
				if (m) ranges.push(m[1] + ':' + m[2])
				else if (/^\d+$/.test(t)) ranges.push(t + ':' + t)
			}
			if (ranges.length) {
				out.server_ports = ranges
				delete out.server_port
				var hop = dur(pick(p, 'hop-interval', 'hop_interval'))
				if (hop) out.hop_interval = hop
			}
		}
		var up = bw(pick(p, 'up', 'up-mbps'))
		var down = bw(pick(p, 'down', 'down-mbps'))
		if (up) out.up_mbps = up
		if (down) out.down_mbps = down
		out.password = str(pick(p, 'password', 'auth', 'auth-str')) || ''
		var obfs = String(pick(p, 'obfs') || '').toLowerCase()
		if (obfs === 'salamander') out.obfs = { type: 'salamander', password: str(pick(p, 'obfs-password', 'obfs_password')) || '' }
		else if (obfs && obfs !== 'none') ctx.diag.warn('Hysteria2 obfs 类型 “' + obfs + '” 不被支持，已忽略', p.name)
		out.tls = buildTls(p, ctx, true)
		return { outbound: dialFields(out, p) }
	}

	PROTO.tuic = function (p, tag, ctx) {
		var uuid = str(pick(p, 'uuid'))
		if (!uuid) { ctx.diag.error('TUIC v4（token 认证）不被 sing-box 支持，节点已跳过', p.name); return null }
		var out = base('tuic', p, tag)
		out.uuid = uuid
		out.password = str(pick(p, 'password')) || ''
		var cc = str(pick(p, 'congestion-controller', 'congestion_control'))
		if (cc) out.congestion_control = /new.?reno/i.test(cc) ? 'new_reno' : cc.toLowerCase()
		var urm = str(pick(p, 'udp-relay-mode', 'udp_relay_mode'))
		if (urm) out.udp_relay_mode = urm.toLowerCase()
		if (bool(pick(p, 'udp-over-stream')) === true) out.udp_over_stream = true
		if (bool(pick(p, 'reduce-rtt', 'zero-rtt-handshake')) === true) out.zero_rtt_handshake = true
		var hb = pick(p, 'heartbeat-interval', 'heartbeat_interval', 'heartbeat')
		if (hb !== undefined) {
			if (typeof hb === 'number' || /^\d+$/.test(String(hb))) out.heartbeat = Math.max(1, Math.round((int(hb) || 10000) / 1000)) + 's'
			else out.heartbeat = String(hb)
		}
		out.tls = buildTls(p, ctx, true)
		return { outbound: dialFields(out, p) }
	}

	PROTO.anytls = function (p, tag, ctx) {
		if (!ctx.caps.modernDns) {
			ctx.diag.error('AnyTLS 需要 sing-box 1.12+，当前目标为 1.11，节点已跳过', p.name)
			return null
		}
		var out = base('anytls', p, tag)
		out.password = str(pick(p, 'password')) || ''
		out.idle_session_check_interval = dur(pick(p, 'idle-session-check-interval')) || '30s'
		out.idle_session_timeout = dur(pick(p, 'idle-session-timeout')) || '30s'
		var mis = int(pick(p, 'min-idle-session'))
		out.min_idle_session = mis === undefined ? 0 : mis
		out.tls = buildTls(p, ctx, true)
		return { outbound: dialFields(out, p) }
	}

	PROTO.http = PROTO.https = function (p, tag, ctx) {
		var out = base('http', p, tag)
		var u = str(pick(p, 'username', 'user'))
		if (u) out.username = u
		var pw = str(pick(p, 'password'))
		if (pw) out.password = pw
		var hh = headersOf(pick(p, 'headers'))
		if (hh) out.headers = hh
		var tls = buildTls(p, ctx)
		if (tls) out.tls = tls
		return { outbound: dialFields(out, p) }
	}

	PROTO.socks5 = PROTO.socks = function (p, tag, ctx) {
		var out = base('socks', p, tag)
		out.version = '5'
		var u = str(pick(p, 'username', 'user'))
		if (u) out.username = u
		var pw = str(pick(p, 'password'))
		if (pw) out.password = pw
		if (bool(pick(p, 'tls')) === true) ctx.diag.warn('SOCKS over TLS 不被 sing-box 支持，已按明文输出', p.name)
		return { outbound: dialFields(out, p) }
	}

	PROTO.ssh = function (p, tag, ctx) {
		var out = base('ssh', p, tag)
		var u = str(pick(p, 'username', 'user'))
		if (u) out.user = u
		var pw = str(pick(p, 'password'))
		if (pw) out.password = pw
		var key = pick(p, 'private-key', 'privateKey')
		if (key) out.private_key = String(key).split('\n')
		var kp = str(pick(p, 'private-key-passphrase'))
		if (kp) out.private_key_passphrase = kp
		var hk = strList(pick(p, 'host-key'))
		if (hk) out.host_key = hk
		return { outbound: dialFields(out, p) }
	}

	PROTO.direct = function (p, tag) { return { outbound: dialFields({ type: 'direct', tag: tag }, p) } }

	PROTO.wireguard = function (p, tag, ctx) {
		var addrs = []
		var ip4 = str(pick(p, 'ip', 'address'))
		if (ip4) addrs.push(ip4.indexOf('/') > 0 ? ip4 : ip4 + '/32')
		var ip6 = str(pick(p, 'ipv6'))
		if (ip6) addrs.push(ip6.indexOf('/') > 0 ? ip6 : ip6 + '/128')
		var privateKey = str(pick(p, 'private-key', 'privateKey', 'private_key'))
		if (!privateKey || !addrs.length) {
			ctx.diag.error('WireGuard 缺少 private-key 或本地地址，节点已跳过', p.name)
			return null
		}
		function reservedOf(v) {
			if (Array.isArray(v)) return v.slice(0, 3).map(function (x) { return int(x) || 0 })
			if (typeof v === 'string' && v) { var b = b64bytes(v); return b && b.length >= 3 ? b.slice(0, 3) : undefined }
			return undefined
		}
		var peersRaw = list(pick(p, 'peers')) || [p]
		var peers = []
		for (var i = 0; i < peersRaw.length; i++) {
			var q = peersRaw[i]
			if (!isObj(q)) continue
			var peer = { address: str(pick(q, 'server')), port: int(pick(q, 'port')), public_key: str(pick(q, 'public-key', 'publicKey', 'public_key')) }
			if (!peer.address || !peer.port || !peer.public_key) continue
			var psk = str(pick(q, 'pre-shared-key', 'preshared-key', 'pre_shared_key'))
			if (psk) peer.pre_shared_key = psk
			peer.allowed_ips = strList(pick(q, 'allowed-ips', 'allowed_ips')) || ['0.0.0.0/0', '::/0']
			var rsv = reservedOf(pick(q, 'reserved'))
			if (rsv) peer.reserved = rsv
			var ka = int(pick(q, 'persistent-keepalive'))
			if (ka) peer.persistent_keepalive_interval = ka
			peers.push(peer)
		}
		if (!peers.length) { ctx.diag.error('WireGuard 缺少有效 peer，节点已跳过', p.name); return null }
		var mtu = int(pick(p, 'mtu'))
		if (!ctx.caps.wireguardEndpoint) {
			var lo = { type: 'wireguard', tag: tag, server: peers[0].address, server_port: peers[0].port, local_address: addrs, private_key: privateKey, peer_public_key: peers[0].public_key }
			if (peers[0].pre_shared_key) lo.pre_shared_key = peers[0].pre_shared_key
			if (peers[0].reserved) lo.reserved = peers[0].reserved
			if (mtu) lo.mtu = mtu
			if (peers.length > 1) ctx.diag.warn('1.11 目标下 WireGuard 仅保留首个 peer', p.name)
			return { outbound: lo }
		}
		var ep = { type: 'wireguard', tag: tag, address: addrs, private_key: privateKey, peers: peers }
		if (mtu) ep.mtu = mtu
		return { endpoint: ep }
	}

	var UNSUPPORTED = {
		ssr: 'ShadowsocksR 自 sing-box 1.6 起已移除',
		shadowsocksr: 'ShadowsocksR 自 sing-box 1.6 起已移除',
		snell: 'sing-box 不支持 Snell 协议',
		mieru: 'sing-box 不支持 Mieru 协议'
	}

	/* ---------------- 标签与规则集注册表 ---------------- */

	function Tags() { this.used = {} }
	Tags.prototype.unique = function (name) {
		var tag = String(name === undefined || name === null || name === '' ? 'node' : name).trim() || 'node'
		if (!this.used[tag]) { this.used[tag] = 1; return tag }
		var i = 2
		while (this.used[tag + ' (' + i + ')']) i++
		var next = tag + ' (' + i + ')'
		this.used[next] = 1
		return next
	}
	Tags.prototype.take = function (name) { this.used[name] = 1; return name }

	function RuleSets(ctx) { this.ctx = ctx; this.map = {}; this.list = [] }
	RuleSets.prototype.template = function (kind) {
		var opts = this.ctx.opts
		if (opts.geoSource === 'custom' && opts.geoTemplate) return String(opts.geoTemplate).replace('{kind}', kind === 'site' ? 'geosite' : 'geoip')
		var src = GEO[opts.geoSource] || GEO.jsdelivr
		return kind === 'site' ? src.site : src.ip
	}
	RuleSets.prototype.geo = function (kind, name) {
		var clean = String(name).trim().toLowerCase()
		var tag = (kind === 'site' ? 'geosite-' : 'geoip-') + clean.replace(/[^a-z0-9!._-]+/g, '-')
		if (!this.map[tag]) {
			var url = this.template(kind).replace('{name}', encodeURI(clean))
			var entry = { type: 'remote', tag: tag, format: 'binary', url: url, update_interval: '7d' }
			if (!this.ctx.caps.httpClient && this.ctx.geoDetour) entry.download_detour = this.ctx.geoDetour
			this.map[tag] = { tag: tag, kind: kind, entry: entry }
			this.list.push(this.map[tag])
		}
		return tag
	}
	RuleSets.prototype.provider = function (name) {
		var ctx = this.ctx
		var provider = ctx.providers[name]
		var behavior = String((provider && pick(provider, 'behavior')) || 'domain').toLowerCase()
		var url = provider && str(pick(provider, 'url'))
		var format = String((provider && pick(provider, 'format')) || 'yaml').toLowerCase()
		var ptype = String((provider && pick(provider, 'type')) || '').toLowerCase()
		var local = ptype === 'file' || ptype === 'inline' ? String((provider && str(pick(provider, 'path'))) || ptype) : ''
		var kind = behavior === 'ipcidr' ? 'ip' : 'site'
		if (local && /\.srs$/i.test(local)) {
			var ltag = 'ruleset-' + String(name).toLowerCase().replace(/[^a-z0-9!._-]+/g, '-')
			if (!this.map[ltag]) {
				this.map[ltag] = { tag: ltag, kind: kind, entry: { type: 'local', tag: ltag, format: 'binary', path: local } }
				this.list.push(this.map[ltag])
			}
			return ltag
		}
		if (url && /\.srs($|[?#])/i.test(url)) {
			var tag = 'ruleset-' + String(name).toLowerCase().replace(/[^a-z0-9!._-]+/g, '-')
			if (!this.map[tag]) {
				var entry2 = { type: 'remote', tag: tag, format: 'binary', url: url, update_interval: '7d' }
				if (!ctx.caps.httpClient && ctx.geoDetour) entry2.download_detour = ctx.geoDetour
				this.map[tag] = { tag: tag, kind: kind, entry: entry2 }
				this.list.push(this.map[tag])
			}
			return tag
		}
		if (!ctx.opts.ruleSetGuess) {
			ctx.diag.warn('RULE-SET 未转换（已关闭规则集推断），相关规则已跳过', name)
			return null
		}
		var key = String(name).toLowerCase()
		var mapped = Object.prototype.hasOwnProperty.call(LOYAL, key) ? LOYAL[key] : undefined
		if (mapped === null) {
			ctx.diag.warn('规则集 “' + name + '” 为进程名列表，sing-box 无对应规则集，已跳过', name)
			return null
		}
		var geoName = key
		if (mapped) { kind = mapped[0]; geoName = mapped[1] }
		else {
			var guessed = ''
			if (url) {
				var m = /\/([^/]+)\.(yaml|yml|list|txt|mrs|json|srs)($|[?#])/i.exec(url)
				if (m) guessed = m[1].toLowerCase()
			}
			var KNOWN = {}, gi, pair
			var names = GEO_NAMES.split(' ')
			for (gi = 0; gi < names.length; gi++) { pair = names[gi].split(':'); KNOWN[pair[0]] = pair[1] }
			var aka = guessed && Object.prototype.hasOwnProperty.call(LOYAL, guessed) ? LOYAL[guessed] : undefined
			if (aka) { kind = aka[0]; geoName = aka[1] }
			else if (KNOWN[key]) geoName = key
			else if (KNOWN[guessed]) geoName = guessed
			else {
				if (!provider) ctx.diag.error('\u89c4\u5219\u96c6 \u201c' + name + '\u201d \u672a\u5728 rule-providers \u4e2d\u5b9a\u4e49\uff0c\u76f8\u5173\u89c4\u5219\u5df2\u8df3\u8fc7', name)
				else if (local) ctx.diag.warn('\u89c4\u5219\u96c6 \u201c' + name + '\u201d \u6307\u5411\u672c\u5730\u6587\u4ef6 ' + local + '\uff0csing-box \u9700\u8981 .srs \u89c4\u5219\u96c6\uff0c\u76f8\u5173\u89c4\u5219\u5df2\u8df3\u8fc7', name)
				else ctx.diag.warn('\u89c4\u5219\u96c6 \u201c' + name + '\u201d \u662f Clash \u6587\u672c\u89c4\u5219\u96c6\uff08' + behavior + '/' + format + '\uff09\uff0csing-box \u65e0\u6cd5\u8bfb\u53d6\uff0c\u76f8\u5173\u89c4\u5219\u5df2\u8df3\u8fc7\uff1b\u53ef\u7528 sing-box rule-set convert \u8f6c\u6210 .srs', name)
				return null
			}
			var known = KNOWN[geoName]
			if (known === 'ip' || (known === 'both' && behavior === 'ipcidr')) kind = 'ip'
			else if (known === 'site') kind = 'site'
			ctx.diag.info('规则集 “' + name + '” 已推断为 ' + (kind === 'site' ? 'geosite' : 'geoip') + ':' + geoName + '，请核对规则集地址', name)
		}
		return this.geo(kind, geoName)
	}

	/* ---------------- Clash 域名模式 → sing-box 匹配项 ---------------- */

	function newBucket() { return { domain: [], suffix: [], keyword: [], regex: [], geosite: [], geoip: [], ruleset: [] } }
	function domainPattern(pattern, bucket) {
		var s = String(pattern === undefined || pattern === null ? '' : pattern).trim()
		if (!s) return
		if (/^geosite:/i.test(s)) { bucket.geosite.push(s.slice(8)); return }
		if (/^geoip:/i.test(s)) { bucket.geoip.push(s.slice(6)); return }
		if (/^rule-set:/i.test(s)) { bucket.ruleset.push(s.slice(9)); return }
		if (s === '*' || s === '+') { bucket.regex.push('.*'); return }
		if (s.indexOf('+.') === 0) {
			var root = s.slice(2)
			if (!root) return
			bucket.suffix.push('.' + root)
			bucket.domain.push(root)
			return
		}
		if (s.indexOf('*.') === 0 && s.indexOf('*', 2) < 0) { bucket.regex.push('^[^.]+\\.' + escapeRe(s.slice(2)) + '$'); return }
		if (s.indexOf('*') >= 0) { bucket.regex.push('^' + escapeRe(s).replace(/\\\*/g, '[^.]*') + '$'); return }
		if (s.charAt(0) === '.') { bucket.suffix.push(s); return }
		bucket.domain.push(s)
	}
	function bucketToRule(bucket, ruleSets) {
		var rule = {}, i
		if (bucket.domain.length) rule.domain = bucket.domain
		if (bucket.suffix.length) rule.domain_suffix = bucket.suffix
		if (bucket.keyword.length) rule.domain_keyword = bucket.keyword
		if (bucket.regex.length) rule.domain_regex = bucket.regex
		var sets = []
		for (i = 0; i < bucket.geosite.length; i++) sets.push(ruleSets.geo('site', bucket.geosite[i]))
		for (i = 0; i < bucket.geoip.length; i++) sets.push(ruleSets.geo('ip', bucket.geoip[i]))
		for (i = 0; i < bucket.ruleset.length; i++) { var t = ruleSets.provider(bucket.ruleset[i]); if (t) sets.push(t) }
		if (sets.length) rule.rule_set = sets
		return Object.keys(rule).length ? rule : null
	}

	/* ---------------- 规则转换 ---------------- */

	function splitRule(text) {
		var out = [], depth = 0, buf = ''
		for (var i = 0; i < text.length; i++) {
			var c = text.charAt(i)
			if (c === '(') depth++
			else if (c === ')') depth--
			if (c === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue }
			buf += c
		}
		out.push(buf.trim())
		return out
	}
	function splitLogical(text) {
		var s = String(text === undefined ? '' : text).trim()
		if (s.charAt(0) === '(' && s.lastIndexOf(')') > 0) s = s.slice(1, s.lastIndexOf(')'))
		var parts = [], depth = 0, buf = ''
		for (var i = 0; i < s.length; i++) {
			var c = s.charAt(i)
			if (c === '(') { depth++; if (depth === 1) { buf = ''; continue } }
			if (c === ')') { depth--; if (depth === 0) { parts.push(buf); continue } }
			if (depth >= 1) buf += c
		}
		return parts
	}
	function portRange(value, rule, isSource) {
		var single = [], ranges = [], segs = String(value).split('/')
		for (var i = 0; i < segs.length; i++) {
			var t = segs[i].trim()
			if (!t) continue
			var m = /^(\d+)\s*-\s*(\d+)$/.exec(t)
			if (m) ranges.push(m[1] + ':' + m[2])
			else if (/^\d+$/.test(t)) single.push(parseInt(t, 10))
		}
		if (single.length) rule[isSource ? 'source_port' : 'port'] = single
		if (ranges.length) rule[isSource ? 'source_port_range' : 'port_range'] = ranges
		return single.length + ranges.length > 0
	}

	function condition(type, value, ctx, kindOut) {
		var t = String(type || '').toUpperCase().replace(/_/g, '-')
		var rule = {}, i, b
		switch (t) {
			case 'DOMAIN': rule.domain = [String(value)]; break
			case 'DOMAIN-SUFFIX':
				var d = String(value).replace(/^\./, '')
				rule.domain = [d]
				rule.domain_suffix = ['.' + d]
				break
			case 'DOMAIN-KEYWORD': rule.domain_keyword = [String(value)]; break
			case 'DOMAIN-REGEX': rule.domain_regex = [String(value)]; break
			case 'DOMAIN-WILDCARD':
				b = newBucket()
				domainPattern(value, b)
				rule = bucketToRule(b, ctx.ruleSets) || {}
				break
			case 'GEOSITE': rule.rule_set = [ctx.ruleSets.geo('site', value)]; break
			case 'GEOIP':
				var gv = String(value).toUpperCase()
				if (gv === 'LAN' || gv === 'PRIVATE') rule.ip_is_private = true
				else rule.rule_set = [ctx.ruleSets.geo('ip', value)]
				if (kindOut) kindOut.ip = true
				break
			case 'IP-CIDR': case 'IP-CIDR6': case 'IP6-CIDR':
				rule.ip_cidr = [String(value)]
				if (kindOut) kindOut.ip = true
				break
			case 'SRC-IP-CIDR': rule.source_ip_cidr = [String(value)]; break
			case 'DST-PORT': if (!portRange(value, rule, false)) return null; break
			case 'SRC-PORT': if (!portRange(value, rule, true)) return null; break
			case 'NETWORK': rule.network = [String(value).toLowerCase()]; break
			case 'PROCESS-NAME':
				var pn = String(value)
				if (/^[A-Za-z][\w]*(\.[A-Za-z0-9_]+){2,}$/.test(pn) && !/\.(exe|app|bin|sh)$/i.test(pn)) rule.package_name = [pn]
				else rule.process_name = [pn]
				break
			case 'PROCESS-PATH': rule.process_path = [String(value)]; break
			case 'PROCESS-PATH-REGEX': rule.process_path_regex = [String(value)]; break
			case 'UID': var uid = int(value); if (uid === undefined) return null; rule.user_id = [uid]; break
			case 'IN-TYPE':
				var itv = String(value).toLowerCase()
				if (itv === 'tun') rule.inbound = ['tun-in']
				else if (itv === 'mixed' || itv === 'socks' || itv === 'socks5' || itv === 'http' || itv === 'https') rule.inbound = ['mixed-in']
				else { ctx.diag.warn('IN-TYPE “' + value + '” 在转换结果中没有对应入站，规则已跳过', value); return null }
				break
			case 'IN-NAME': rule.inbound = [String(value)]; break
			case 'RULE-SET':
				var rsTag = ctx.ruleSets.provider(String(value))
				if (!rsTag) return null
				rule.rule_set = [rsTag]
				if (kindOut && ctx.ruleSets.map[rsTag] && ctx.ruleSets.map[rsTag].kind === 'ip') kindOut.ip = true
				break
			case 'AND': case 'OR': case 'NOT':
				var subs = splitLogical(value), rules = []
				for (i = 0; i < subs.length; i++) {
					var parts = splitRule(subs[i])
					var sub = condition(parts[0], parts[1], ctx, kindOut)
					if (sub && sub !== 'FINAL') rules.push(sub)
				}
				if (!rules.length) return null
				if (t === 'NOT') return { type: 'logical', mode: 'and', rules: rules, invert: true }
				if (rules.length === 1) return rules[0]
				return { type: 'logical', mode: t === 'AND' ? 'and' : 'or', rules: rules }
			case 'MATCH': case 'FINAL': return 'FINAL'
			case 'IN-USER': rule.auth_user = [String(value)]; break
			case 'SRC-GEOIP':
				var sgv = String(value).toUpperCase()
				if (sgv === 'LAN' || sgv === 'PRIVATE') { rule.source_ip_is_private = true; break }
				ctx.diag.warn('SRC-GEOIP 仅支持 LAN / PRIVATE（sing-box 无源地址 GeoIP 匹配），规则已跳过', value)
				return null
			case 'NETWORK-TYPE':
				var ntv = String(value).toLowerCase().replace('4g', 'cellular').replace('5g', 'cellular')
				if (ntv === 'wifi' || ntv === 'cellular' || ntv === 'ethernet' || ntv === 'other') { rule.network_type = [ntv]; break }
				ctx.diag.warn('NETWORK-TYPE “' + value + '” 不在 sing-box 支持的 wifi / cellular / ethernet / other 之内，规则已跳过', value)
				return null
			case 'IP-SUFFIX': case 'SRC-IP-SUFFIX': case 'IP-ASN': case 'SRC-IP-ASN':
			case 'SUB-RULE': case 'PROCESS-NAME-REGEX': case 'IN-PORT':
			case 'DSCP':
				ctx.diag.warn(t + ' 在 sing-box 中无对应匹配项，规则已跳过', value)
				return null
			default:
				ctx.diag.warn('未知规则类型 “' + t + '”，已跳过', value)
				return null
		}
		return Object.keys(rule).length ? rule : null
	}

	var MERGEABLE = [['domain', 'domain_suffix'], ['domain_keyword'], ['domain_regex'], ['ip_cidr'], ['source_ip_cidr'], ['rule_set'], ['process_name'], ['process_path'], ['port'], ['source_port']]
	function mergeKeyOf(rule) {
		var keys = [], k
		for (k in rule) if (Object.prototype.hasOwnProperty.call(rule, k) && k.indexOf('__') !== 0) keys.push(k)
		if (!keys.length) return null
		for (var i = 0; i < MERGEABLE.length; i++) {
			var ok = true
			for (var j = 0; j < keys.length; j++) if (MERGEABLE[i].indexOf(keys[j]) < 0) { ok = false; break }
			if (ok) return 'g' + i
		}
		return null
	}
	function mergeAdjacent(rules) {
		var out = []
		for (var i = 0; i < rules.length; i++) {
			var cur = rules[i], prev = out[out.length - 1]
			if (prev && cur.__merge && prev.__merge === cur.__merge && prev.__target === cur.__target) {
				for (var k in cur) {
					if (!Object.prototype.hasOwnProperty.call(cur, k) || k.indexOf('__') === 0) continue
					if (Array.isArray(cur[k])) prev[k] = (prev[k] || []).concat(cur[k])
				}
				continue
			}
			out.push(cur)
		}
		return out
	}

	/* ---------------- DNS 地址解析 ---------------- */

	function parseDns(input) {
		var s = String(input === undefined || input === null ? '' : input).trim()
		if (!s) return null
		var detour
		var hash = s.indexOf('#')
		if (hash > 0) { detour = s.slice(hash + 1).trim(); s = s.slice(0, hash).trim() }
		var lower = s.toLowerCase()
		if (lower === 'system' || lower === 'local' || lower === 'system://') return { type: 'local', detour: detour }
		if (lower === 'fakeip' || lower === 'fake-ip') return { type: 'fakeip', detour: detour }
		if (lower.indexOf('dhcp://') === 0) return { type: 'dhcp', host: s.slice(7) || 'auto', detour: detour }
		if (lower.indexOf('rcode://') === 0) return { type: 'rcode', detour: detour }
		var scheme = 'udp', rest = s
		var m = /^([a-z0-9+]+):\/\/(.*)$/i.exec(s)
		if (m) { scheme = m[1].toLowerCase(); rest = m[2] }
		var path
		var slash = rest.indexOf('/')
		if (slash >= 0) { path = rest.slice(slash); rest = rest.slice(0, slash) }
		var host = rest, port
		if (rest.charAt(0) === '[') {
			var close = rest.indexOf(']')
			host = rest.slice(1, close)
			if (rest.charAt(close + 1) === ':') port = int(rest.slice(close + 2))
		} else {
			var colon = rest.lastIndexOf(':')
			if (colon > 0 && /^\d+$/.test(rest.slice(colon + 1))) { host = rest.slice(0, colon); port = int(rest.slice(colon + 1)) }
		}
		var type = 'udp'
		if (scheme === 'tcp') type = 'tcp'
		else if (scheme === 'tls' || scheme === 'dot') type = 'tls'
		else if (scheme === 'https' || scheme === 'doh') type = 'https'
		else if (scheme === 'quic' || scheme === 'doq') type = 'quic'
		else if (scheme === 'h3' || scheme === 'http3') type = 'h3'
		if (!host) return null
		return { type: type, host: host, port: port, path: path, detour: detour }
	}

	/* ---------------- 结构校验（离线版 sing-box check） ---------------- */

	var NEED_ADDR = { shadowsocks: 1, vmess: 1, vless: 1, trojan: 1, hysteria: 1, hysteria2: 1, tuic: 1, anytls: 1, socks: 1, http: 1, ssh: 1, shadowtls: 1 }
	var NEED_UUID = { vmess: 1, vless: 1, tuic: 1 }

	function validate(config) {
		var errors = []
		function indexTags(arr) {
			var map = {}
			for (var i = 0; i < (arr || []).length; i++) {
				var it = arr[i] || {}
				if (!it.type) errors.push('第 ' + (i + 1) + ' 个出站缺少 type')
				if (!it.tag) errors.push('第 ' + (i + 1) + ' 个出站缺少 tag')
				else if (map[it.tag]) errors.push('出站标签重复：' + it.tag)
				else map[it.tag] = it
			}
			return map
		}
		function checkNodes(map) {
			for (var tag in map) {
				if (!has(map, tag)) continue
				var ob = map[tag]
				if (NEED_ADDR[ob.type]) {
					if (!ob.server) errors.push('出站 “' + tag + '” 缺少 server')
					if (!ob.server_port && !ob.server_ports) errors.push('出站 “' + tag + '” 缺少 server_port')
				}
				if (NEED_UUID[ob.type] && !ob.uuid) errors.push('出站 “' + tag + '” 缺少 uuid')
				if (ob.type === 'shadowsocks' && !ob.method) errors.push('出站 “' + tag + '” 缺少 method')
				if (ob.type === 'trojan' && !ob.password) errors.push('出站 “' + tag + '” 缺少 password')
				if (ob.type === 'anytls' && !ob.password) errors.push('出站 “' + tag + '” 缺少 password')
				if (ob.type === 'wireguard' && !(ob.peers || ob.peer_public_key)) errors.push('出站 “' + tag + '” 缺少 peers')
				if (ob.tls && ob.tls.reality && ob.tls.reality.enabled && !ob.tls.reality.public_key) errors.push('出站 “' + tag + '” 的 REALITY 缺少 public_key')
				if (ob.flow && ob.flow !== 'xtls-rprx-vision') errors.push('出站 “' + tag + '” 的 flow 不被 sing-box 支持：' + ob.flow)
				if (ob.detour && !map[ob.detour]) errors.push('出站 “' + tag + '” 的 detour 指向不存在的 “' + ob.detour + '”')
			}
		}
		if (Array.isArray(config)) {
			checkNodes(indexTags(config))
			return { ok: errors.length === 0, errors: errors }
		}
		if (!isObj(config)) return { ok: false, errors: ['配置既不是对象也不是数组'] }
		var all = (config.outbounds || []).concat(config.endpoints || [])
		var known = indexTags(all)
		checkNodes(known)
		var i
		for (i = 0; i < all.length; i++) {
			var g = all[i]
			if (g.type !== 'selector' && g.type !== 'urltest') continue
			if (!g.outbounds || !g.outbounds.length) { errors.push('代理组 “' + g.tag + '” 成员为空'); continue }
			for (var m = 0; m < g.outbounds.length; m++) if (!known[g.outbounds[m]]) errors.push('代理组 “' + g.tag + '” 引用不存在的出站 “' + g.outbounds[m] + '”')
			if (g.default && !known[g.default]) errors.push('代理组 “' + g.tag + '” 的 default 无效')
		}
		if (!config.inbounds || !config.inbounds.length) errors.push('缺少 inbounds')
		var route = config.route || {}
		if (!route.final) errors.push('route.final 缺失')
		else if (!known[route.final]) errors.push('route.final 指向不存在的出站 “' + route.final + '”')
		var httpTags = {}
		for (i = 0; i < (config.http_clients || []).length; i++) {
			var hc = config.http_clients[i] || {}
			if (!hc.tag) errors.push('HTTP Client 缺少 tag')
			else if (httpTags[hc.tag]) errors.push('HTTP Client 标签重复：' + hc.tag)
			else httpTags[hc.tag] = 1
			if (hc.detour && !known[hc.detour]) errors.push('HTTP Client “' + hc.tag + '” 的 detour 无效')
		}
		if (route.default_http_client && !httpTags[route.default_http_client]) errors.push('route.default_http_client 引用不存在的 HTTP Client “' + route.default_http_client + '”')
		var setTags = {}
		for (i = 0; i < (route.rule_set || []).length; i++) {
			var rs = route.rule_set[i] || {}
			if (!rs.tag) errors.push('rule_set 缺少 tag')
			else if (setTags[rs.tag]) errors.push('rule_set 标签重复：' + rs.tag)
			else setTags[rs.tag] = 1
			if (rs.type === 'remote' && !rs.url) errors.push('远程规则集 “' + rs.tag + '” 缺少 url')
			if (rs.type === 'local' && !rs.path) errors.push('本地规则集 “' + rs.tag + '” 缺少 path')
			if (rs.download_detour && !known[rs.download_detour]) errors.push('规则集 “' + rs.tag + '” 的 download_detour 无效')
			if (typeof rs.http_client === 'string' && !httpTags[rs.http_client]) errors.push('规则集 “' + rs.tag + '” 的 http_client 无效')
		}
		var dns = config.dns || {}
		var emptyDirect2 = {}, edj, edk2, edn2
		for (edj = 0; edj < (config.outbounds || []).length; edj++) {
			var edo2 = config.outbounds[edj] || {}
			if (edo2.type !== 'direct') continue
			edn2 = 0
			for (edk2 in edo2) if (Object.prototype.hasOwnProperty.call(edo2, edk2) && edk2 !== 'type' && edk2 !== 'tag') edn2++
			if (!edn2) emptyDirect2[edo2.tag] = 1
		}
		var dnsTags = {}
		for (i = 0; i < (dns.servers || []).length; i++) {
			var sv = dns.servers[i] || {}
			if (!sv.tag) errors.push('DNS 服务器缺少 tag')
			else if (dnsTags[sv.tag]) errors.push('DNS 服务器标签重复：' + sv.tag)
			else dnsTags[sv.tag] = 1
			if (sv.detour && !known[sv.detour]) errors.push('DNS 服务器 “' + sv.tag + '” 的 detour 无效')
			if (sv.detour && sv.type && emptyDirect2[sv.detour]) errors.push('DNS 服务器 “' + sv.tag + '” 的 detour 指向空 direct 出站，sing-box 1.12+ 会拒绝启动')
		}
		if (dns.final && !dnsTags[dns.final]) errors.push('dns.final 指向不存在的服务器 “' + dns.final + '”')
		function walk(rules, isDns) {
			for (var k = 0; k < (rules || []).length; k++) {
				var r = rules[k] || {}
				if (r.outbound && !known[r.outbound]) errors.push('路由规则指向不存在的出站 “' + r.outbound + '”')
				if (isDns && r.server && !dnsTags[r.server]) errors.push('DNS 规则指向不存在的服务器 “' + r.server + '”')
				for (var q = 0; q < (r.rule_set || []).length; q++) if (!setTags[r.rule_set[q]]) errors.push('规则引用不存在的规则集 “' + r.rule_set[q] + '”')
				if (r.rules) walk(r.rules, isDns)
			}
		}
		walk(route.rules, false)
		walk(dns.rules, true)
		return { ok: errors.length === 0, errors: errors }
	}

	/* ---------------- 主转换 ---------------- */

	function convert(text, options) {
		var t0 = now()
		var opts = assign({}, DEFAULTS, options || {})
		var clash = yaml().parse(text)
		if (!isObj(clash)) throw new Error('未识别到有效的 Clash 配置：根节点应为 YAML 映射（包含 proxies 等字段）')

		var diag = new Diag()
		var parseWarnings = (clash && clash.__warnings) || []
		for (var pw = 0; pw < parseWarnings.length; pw++) diag.info(parseWarnings[pw])
		var ctx = {
			opts: opts, caps: targetCaps(opts.target), clash: clash, diag: diag, tags: new Tags(),
			providers: isObj(pick(clash, 'rule-providers', 'rule_providers')) ? pick(clash, 'rule-providers', 'rule_providers') : {},
			geoDetour: 'direct'
		}
		ctx.ruleSets = new RuleSets(ctx)
		ctx.tags.take('direct')

		/* ---- 1. 节点 ---- */
		var proxies = list(pick(clash, 'proxies', 'proxy')) || []
		var outbounds = [], endpoints = [], nodeTags = [], nameMap = {}, protoCount = {}, pendingDetour = [], typeOfTag = {}
		var filteredNames = {}, filteredCount = 0

		/* proxy-providers：内联 payload 直接展开为节点；远程订阅无法离线拉取，记录后在代理组处显式报错 */
		var providersRaw = isObj(pick(clash, 'proxy-providers', 'proxy_providers')) ? pick(clash, 'proxy-providers', 'proxy_providers') : {}
		var providerNodes = {}, providerRemote = {}, proxyEntries = [], pvName
		for (var pe = 0; pe < proxies.length; pe++) proxyEntries.push({ p: proxies[pe], provider: '' })
		for (pvName in providersRaw) {
			if (!Object.prototype.hasOwnProperty.call(providersRaw, pvName)) continue
			var pvDef = providersRaw[pvName]
			if (!isObj(pvDef)) continue
			providerNodes[pvName] = []
			var pvKeep = null, pvDrop = null
			var pvF = str(pick(pvDef, 'filter'))
			var pvX = str(pick(pvDef, 'exclude-filter', 'exclude_filter'))
			try { if (pvF) pvKeep = toRegExp(pvF) } catch (ep1) { diag.warn('代理集合 filter 正则无法解析，已忽略', pvName) }
			try { if (pvX) pvDrop = toRegExp(pvX) } catch (ep2) { diag.warn('代理集合 exclude-filter 正则无法解析，已忽略', pvName) }
			var payload = list(pick(pvDef, 'payload')) || [], taken = 0
			for (var py = 0; py < payload.length; py++) {
				if (!isObj(payload[py])) continue
				var pyName = str(pick(payload[py], 'name')) || ''
				if (pvKeep && !pvKeep.test(pyName)) continue
				if (pvDrop && pvDrop.test(pyName)) continue
				proxyEntries.push({ p: payload[py], provider: pvName })
				taken++
			}
			if (taken) diag.info('已展开 proxy-provider 内联节点', pvName + ' × ' + taken)
			else {
				var pvUrl = str(pick(pvDef, 'url'))
				providerRemote[pvName] = pvUrl || '-'
				if (pvUrl) diag.warn('代理集合 “' + pvName + '” 是远程订阅，纯前端离线环境无法拉取其节点', pvUrl)
				else diag.warn('代理集合 “' + pvName + '” 既无 payload 也无 url，无法解析', pvName)
			}
		}
		for (var i = 0; i < proxyEntries.length; i++) {
			var p = proxyEntries[i].p
			var pProvider = proxyEntries[i].provider
			if (!isObj(p)) { diag.warn('节点格式无法识别，已跳过'); continue }
			var type = String(pick(p, 'type') || '').toLowerCase()
			var rawName = str(pick(p, 'name')) || (type || 'node') + '-' + (i + 1)
			if (opts.filterInfo !== false && isInfoNode(rawName)) {
				filteredNames[rawName] = 1
				filteredCount++
				diag.info('已过滤订阅信息伪节点（可在节点选项中关闭过滤）', rawName)
				continue
			}
			if (UNSUPPORTED[type]) { diag.error(UNSUPPORTED[type] + '，节点已跳过', rawName); continue }
			var handler = PROTO[type]
			if (!handler) { diag.error('不支持的协议类型 “' + (type || '未知') + '”，节点已跳过', rawName); continue }
			var wantTag = decorate(rawName, opts)
			var tag = ctx.tags.unique(wantTag)
			if (tag !== wantTag) diag.info('节点名重复，已自动重命名', rawName)
			var result = null
			try { result = handler(p, tag, ctx) } catch (err) { diag.error('节点转换异常：' + err.message, rawName) }
			if (!result) { delete ctx.tags.used[tag]; continue }
			if (opts.style === 'minimal') {
				if (result.outbound) minifyNode(result.outbound)
				if (result.endpoint) minifyNode(result.endpoint)
				if (result.extra) for (var mx = 0; mx < result.extra.length; mx++) minifyNode(result.extra[mx])
			}
			if (result.outbound) {
				if (!result.outbound.detour && type !== 'direct' && (!result.outbound.server || !result.outbound.server_port) && !result.outbound.server_ports) {
					diag.error('节点缺少 server 或 port，已跳过', rawName)
					delete ctx.tags.used[tag]
					continue
				}
				outbounds.push(result.outbound)
			} else if (result.endpoint) endpoints.push(result.endpoint)
			if (result.extra) for (var x = 0; x < result.extra.length; x++) outbounds.push(result.extra[x])
			nodeTags.push(tag)
			nameMap[rawName] = tag
			typeOfTag[tag] = type
			if (pProvider && providerNodes[pProvider]) providerNodes[pProvider].push(tag)
			protoCount[type] = (protoCount[type] || 0) + 1
			var dp = str(pick(p, 'dialer-proxy', 'dialer_proxy'))
			if (dp) pendingDetour.push([result.outbound || result.endpoint, dp])
		}
		if (!nodeTags.length) diag.warn('未转换出任何可用节点，请检查源配置的 proxies 字段')

		/* ---- 1.5 纯节点输出模式：直接返回 sing-box outbound 数组 ---- */
		if (opts.mode === 'nodes') {
			for (var nd = 0; nd < pendingDetour.length; nd++) {
				var ndTag = nameMap[pendingDetour[nd][1]]
				if (ndTag) pendingDetour[nd][0].detour = ndTag
				else diag.warn('dialer-proxy “' + pendingDetour[nd][1] + '” 未找到，已忽略')
			}
			var nodeList = outbounds.concat(endpoints)
			if (endpoints.length) diag.info('WireGuard 属于 sing-box 的 endpoints 字段，已排在数组末尾，导入时请放入 endpoints', String(endpoints.length) + ' 个')
			var nseen = {}, nk
			for (nk = 0; nk < nodeList.length; nk++) {
				if (nseen[nodeList[nk].tag]) diag.error('出站标签重复：' + nodeList[nk].tag)
				else nseen[nodeList[nk].tag] = 1
			}
			for (nk = 0; nk < nodeList.length; nk++) {
				if (nodeList[nk].detour && !nseen[nodeList[nk].detour]) { diag.warn('出站 detour 无效，已移除', nodeList[nk].tag); delete nodeList[nk].detour }
			}
			/* auto：GUI.for.SingBox 订阅只能读 {"outbounds": […]}，其余客户端用纯数组 */
			var wrapMode = (!opts.wrap || opts.wrap === 'auto') ? (opts.preset === 'gui' ? 'outbounds' : 'array') : opts.wrap
			var nodeWrap = wrapMode === 'outbounds'
			var nodePayload = nodeWrap ? { outbounds: nodeList } : nodeList
			if (nodeWrap) diag.info('已包裹为 {"outbounds": […]} 形态，适用于 GUI for SingBox 等客户端的订阅导入')
			var nodeJson
			try {
				nodeJson = JSON.stringify(nodePayload, null, opts.pretty ? 2 : 0)
				JSON.parse(nodeJson)
			} catch (eN) { throw new Error('生成的 JSON 无法序列化：' + eN.message) }
			var nIssues = diag.all(), nErr = 0, nWarn = 0, nInfo = 0
			for (var nI = 0; nI < nIssues.length; nI++) {
				if (nIssues[nI].level === 'error') nErr += nIssues[nI].count
				else if (nIssues[nI].level === 'warn') nWarn += nIssues[nI].count
				else nInfo += nIssues[nI].count
			}
			return {
				config: nodePayload,
				json: nodeJson,
				report: {
					nodes: nodeTags.length,
					nodesInput: proxies.length,
					skipped: Math.max(0, proxies.length - nodeTags.length - filteredCount),
					filtered: filteredCount,
					groups: 0, rules: 0, rulesInput: 0, userRules: 0, ruleSets: 0,
					outbounds: nodeList.length,
					endpoints: endpoints.length,
					dnsServers: 0,
					protocols: protoCount,
					issues: nIssues,
					errorCount: nErr, warnCount: nWarn, infoCount: nInfo,
					bytes: nodeJson.length,
					ms: Math.round((now() - t0) * 10) / 10,
					target: opts.target, preset: opts.preset, final: '',
					mode: 'nodes',
					wrap: nodeWrap ? 'outbounds' : 'array',
					style: opts.style === 'minimal' ? 'minimal' : 'full',
					version: VERSION
				}
			}
		}

		/* ---- 2. 代理组 ---- */
		var groupsRaw = list(pick(clash, 'proxy-groups', 'proxy_groups')) || []
		var groupMap = {}, groupDefs = [], gi, rejectGroups = {}
		for (gi = 0; gi < groupsRaw.length; gi++) {
			var g = groupsRaw[gi]
			if (!isObj(g)) continue
			var gname = str(pick(g, 'name'))
			if (!gname) { diag.warn('代理组缺少名称，已跳过'); continue }
			var gtag = ctx.tags.unique(gname)
			groupMap[gname] = gtag
			groupDefs.push({ raw: g, tag: gtag, name: gname })
		}

		function resolveTarget(name) {
			var n = String(name === undefined || name === null ? '' : name).trim()
			var upper = n.toUpperCase()
			if (upper === 'DIRECT' || upper === 'COMPATIBLE') return { outbound: 'direct' }
			if (upper === 'REJECT' || upper === 'REJECT-DROP' || upper === 'REJECT-TINYGIF' || upper === 'BLOCK') return { reject: true }
			if (upper === 'PASS') return null
			if (filteredNames[n]) return { drop: true }
			if (rejectGroups[n]) return { reject: true }
			if (groupMap[n]) return { outbound: groupMap[n] }
			if (nameMap[n]) return { outbound: nameMap[n] }
			return undefined
		}

		var keptDefs = []
		for (gi = 0; gi < groupDefs.length; gi++) {
			var pdef = groupDefs[gi]
			var pm = strList(pick(pdef.raw, 'proxies')) || []
			var firstReject = false, allReject = pm.length > 0
			for (var pi = 0; pi < pm.length; pi++) {
				var pt = resolveTarget(pm[pi])
				var isRej = !!(pt && pt.reject)
				if (pi === 0) firstReject = isRej
				if (!isRej) allReject = false
			}
			if (firstReject || allReject) {
				rejectGroups[pdef.name] = 1
				delete groupMap[pdef.name]
				diag.info('\u4ee3\u7406\u7ec4\u4ee5 REJECT \u4e3a\u9996\u9009\u6210\u5458\uff0c\u6307\u5411\u8be5\u7ec4\u7684\u89c4\u5219\u5df2\u8f6c\u4e3a sing-box \u62e6\u622a\u52a8\u4f5c', pdef.name)
			} else keptDefs.push(pdef)
		}
		groupDefs = keptDefs

		var groupOutbounds = []
		for (gi = 0; gi < groupDefs.length; gi++) {
			var def = groupDefs[gi]
			var raw = def.raw
			var gType = String(pick(raw, 'type') || 'select').toLowerCase()
			var members = [], seen = {}
			var addMember = function (name) {
				var target = resolveTarget(name)
				if (target === undefined) { diag.warn('代理组成员 “' + name + '” 不存在或已被跳过，已从组中移除', def.name); return }
				if (!target) return
				if (target.drop) return
				if (target.reject) { diag.warn('sing-box 无 REJECT 出站，已从代理组移除该成员（拦截请用路由规则）', def.name); return }
				if (target.outbound === def.tag || seen[target.outbound]) return
				seen[target.outbound] = 1
				members.push(target.outbound)
			}
			var explicit = strList(pick(raw, 'proxies')) || []
			for (var mi = 0; mi < explicit.length; mi++) addMember(explicit[mi])
			var useProviders = strList(pick(raw, 'use')) || []
			var includeAll = bool(pick(raw, 'include-all', 'include_all')) === true || bool(pick(raw, 'include-all-proxies')) === true || bool(pick(raw, 'include-all-providers')) === true
			var unresolved = 0
			for (var ui = 0; ui < useProviders.length; ui++) {
				var un = useProviders[ui]
				if (providerNodes[un] && providerNodes[un].length) {
					for (var uj = 0; uj < providerNodes[un].length; uj++) addMember(providerNodes[un][uj])
				} else if (providerRemote[un]) {
					unresolved++
					diag.error('代理组引用的远程代理集合 “' + un + '” 无法离线拉取，该组缺少这部分节点；请在 Clash 侧导出含完整 proxies 的配置后再转换', def.name)
				} else {
					unresolved++
					diag.error('代理组引用的代理集合 “' + un + '” 未在 proxy-providers 中定义', def.name)
				}
			}
			if (includeAll) { for (var ni = 0; ni < nodeTags.length; ni++) addMember(nodeTags[ni]) }
			else if (unresolved && !members.length) {
				diag.warn('代理组因远程代理集合不可用而为空，已用全部本地节点填充以保证配置可启动', def.name)
				for (var nj = 0; nj < nodeTags.length; nj++) addMember(nodeTags[nj])
			}
			var filter = str(pick(raw, 'filter'))
			var exclude = str(pick(raw, 'exclude-filter', 'exclude_filter'))
			var excludeType = str(pick(raw, 'exclude-type'))
			if (filter || exclude || excludeType) {
				var keepRe = null, dropRe = null
				try { if (filter) keepRe = toRegExp(filter) } catch (e1) { diag.warn('代理组 filter 正则无法解析，已忽略', def.name) }
				try { if (exclude) dropRe = toRegExp(exclude) } catch (e2) { diag.warn('代理组 exclude-filter 正则无法解析，已忽略', def.name) }
				var types = excludeType ? excludeType.toLowerCase().split('|') : null
				var filtered = []
				for (var fi2 = 0; fi2 < members.length; fi2++) {
					var m2 = members[fi2]
					var isNode = !!typeOfTag[m2]
					if (isNode) {
						if (keepRe && !keepRe.test(m2)) continue
						if (dropRe && dropRe.test(m2)) continue
						if (types && types.indexOf(typeOfTag[m2]) >= 0) continue
					}
					filtered.push(m2)
				}
				members = filtered
			}
			if (!members.length) {
				diag.warn('代理组为空，已填入 direct 以保证配置可启动', def.name)
				members.push('direct')
			}
			var ob = { type: 'selector', tag: def.tag, outbounds: members }
			if (gType === 'url-test' || gType === 'urltest' || gType === 'fallback' || gType === 'load-balance' || gType === 'smart') {
				ob.type = 'urltest'
				var url = str(pick(raw, 'url'))
				if (url) ob.url = url
				var interval = dur(pick(raw, 'interval'))
				if (interval) ob.interval = interval
				var tolerance = int(pick(raw, 'tolerance'))
				if (tolerance) ob.tolerance = tolerance
				if (gType === 'fallback') diag.info('Clash fallback 组已转为 sing-box urltest（自动选择最优节点）', def.name)
				else if (gType === 'load-balance') diag.warn('sing-box 无负载均衡组，已转为 urltest', def.name)
				else if (gType === 'smart') diag.info('mihomo smart 组��转为 urltest', def.name)
			} else if (gType === 'relay') {
				diag.warn('sing-box 不支持 relay 组，已降级为 selector（链式代理请用 dialer-proxy/detour）', def.name)
			} else if (gType !== 'select' && gType !== 'selector') {
				diag.warn('未知代理组类型 “' + gType + '”，已按 selector 处理', def.name)
			}
			if (ob.type === 'selector') {
				var dft = str(pick(raw, 'default'))
				if (dft) {
					var dt = resolveTarget(dft)
					if (dt && dt.outbound && members.indexOf(dt.outbound) >= 0) ob.default = dt.outbound
				}
				if (bool(pick(raw, 'interrupt-exist-connections')) === true) ob.interrupt_exist_connections = true
			}
			groupOutbounds.push(ob)
		}

		for (var pd = 0; pd < pendingDetour.length; pd++) {
			var dTarget = resolveTarget(pendingDetour[pd][1])
			if (dTarget && dTarget.outbound) pendingDetour[pd][0].detour = dTarget.outbound
			else diag.warn('dialer-proxy “' + pendingDetour[pd][1] + '” 未找到，已忽略')
		}

		var firstGroup = groupOutbounds.length ? groupOutbounds[0].tag : (nodeTags.length ? nodeTags[0] : 'direct')
		ctx.geoDetour = opts.geoDetour === 'proxy' ? firstGroup : (ctx.caps.modernDns ? undefined : 'direct')

		/* ---- 3. 路由规则 ---- */
		var rulesRaw = strList(pick(clash, 'rules', 'rule')) || []
		var subRules = isObj(pick(clash, 'sub-rules', 'sub_rules')) ? pick(clash, 'sub-rules', 'sub_rules') : {}
		var routeRules = [], finalTag = null, ruleCount = 0, directRuleSets = {}
		if ((list(pick(clash, 'listeners')) || []).length) diag.warn('Clash listeners（额外入站监听）未转换，如需请在 sing-box inbounds 中手动补充')
		if (isObj(pick(clash, 'tunnels')) || (list(pick(clash, 'tunnels')) || []).length) diag.warn('Clash tunnels 未转换，sing-box 请改用 direct 入站')
		if (pick(clash, 'script')) diag.warn('Clash script 脚本规则无法转换（sing-box 无脚本引擎），已忽略')
		for (var ri = 0; ri < rulesRaw.length; ri++) {
			var parts2 = splitRule(rulesRaw[ri])
			var rType = String(parts2[0] || '').toUpperCase()
			var rValue, rTargetName
			if (rType === 'MATCH' || rType === 'FINAL') { rValue = ''; rTargetName = parts2[1] }
			else { rValue = parts2[1]; rTargetName = parts2[2] }
			if (rTargetName === undefined) { diag.warn('规则格式不完整，已跳过', rulesRaw[ri]); continue }
			if (rType === 'SUB-RULE') {
				var subName = String(rTargetName || '')
				var subList = strList(subRules[subName]) || []
				if (!subList.length) { diag.warn('SUB-RULE 引用的子规则 “' + subName + '” 不存在或为空，已跳过', rulesRaw[ri]); continue }
				var outKind = { ip: false }, outCond = null
				var innerTxt = String(rValue || '').trim().replace(/^\(/, '').replace(/\)$/, '')
				var outParts = splitRule(innerTxt)
				try { outCond = condition(outParts[0], outParts[1], ctx, outKind) } catch (eSub) { diag.warn('SUB-RULE 条件转换异常：' + eSub.message, rulesRaw[ri]) }
				if (!outCond || outCond === 'FINAL') { diag.warn('SUB-RULE 外层条件无法识别，已跳过', rulesRaw[ri]); continue }
				for (var sj = 0; sj < subList.length; sj++) {
					var sParts = splitRule(subList[sj])
					var sType = String(sParts[0] || '').toUpperCase()
					if (sType === 'SUB-RULE') { diag.warn('暂不支持嵌套 SUB-RULE，已跳过', subList[sj]); continue }
					var sValue, sTargetName
					if (sType === 'MATCH' || sType === 'FINAL') { sValue = ''; sTargetName = sParts[1] }
					else { sValue = sParts[1]; sTargetName = sParts[2] }
					var sTarget = resolveTarget(sTargetName)
					if (sTarget === undefined) { diag.warn('子规则目标 “' + sTargetName + '” 不存在，已跳过', subList[sj]); continue }
					if (!sTarget || sTarget.drop) continue
					var sOut = sTarget.reject ? 'reject' : sTarget.outbound
					if (sType === 'MATCH' || sType === 'FINAL') {
						var mRule = JSON.parse(JSON.stringify(outCond))
						mRule.__target = sOut
						mRule.__ip = !!outKind.ip
						mRule.__merge = null
						routeRules.push(mRule)
						ruleCount++
						continue
					}
					var sKind = { ip: false }, sCond = null
					try { sCond = condition(sType, sValue, ctx, sKind) } catch (eS2) { diag.warn('子规则转换异常：' + eS2.message, subList[sj]) }
					if (!sCond || sCond === 'FINAL') continue
					var comb = { type: 'logical', mode: 'and', rules: [JSON.parse(JSON.stringify(outCond)), JSON.parse(JSON.stringify(sCond))] }
					comb.__target = sOut
					comb.__ip = !!(outKind.ip || sKind.ip)
					comb.__merge = null
					routeRules.push(comb)
					ruleCount++
				}
				continue
			}
			var target = resolveTarget(rTargetName)
			if (target === undefined) { diag.warn('规则目标 “' + rTargetName + '” 不存在，规则已跳过', rulesRaw[ri]); continue }
			if (target === null) { diag.info('PASS 规则无对应语义，已跳过', rulesRaw[ri]); continue }
			if (target.drop) { diag.info('规则目标为已过滤的订阅信息节点，规则已跳过', rulesRaw[ri]); continue }
			if (rType === 'MATCH' || rType === 'FINAL') {
				if (target.reject) {
					diag.warn('MATCH 目标为 REJECT，已转为尾部拦截规则')
					routeRules.push({ network: ['tcp', 'udp'], __target: 'reject', __merge: null, __ip: false })
				} else finalTag = target.outbound
				continue
			}
			var kindOut = { ip: false }, cond = null
			try { cond = condition(rType, rValue, ctx, kindOut) } catch (e3) { diag.warn('规则转换异常：' + e3.message, rulesRaw[ri]) }
			if (!cond || cond === 'FINAL') continue
			cond.__target = target.reject ? 'reject' : target.outbound
			cond.__ip = !!kindOut.ip
			cond.__merge = cond.type === 'logical' ? null : mergeKeyOf(cond)
			routeRules.push(cond)
			ruleCount++
			if (!target.reject && target.outbound === 'direct' && cond.rule_set) {
				for (var rsi = 0; rsi < cond.rule_set.length; rsi++) {
					var meta = ctx.ruleSets.map[cond.rule_set[rsi]]
					if (meta && meta.kind === 'site') directRuleSets[cond.rule_set[rsi]] = 1
				}
			}
		}
		if (opts.mergeRules) routeRules = mergeAdjacent(routeRules)

		/* ---- 4. 入站 ---- */
		var preset = opts.preset
		var apple = preset === 'apple'
		var mixedPort = int(opts.mixedPort) || int(pick(clash, 'mixed-port', 'mixed_port')) || int(pick(clash, 'port')) || int(pick(clash, 'socks-port')) || 7890
		var allowLan = opts.allowLan === true || (opts.allowLan === 'auto' && bool(pick(clash, 'allow-lan')) === true)
		var inbounds = []
		if (opts.tun) {
			var tunCfg = isObj(pick(clash, 'tun')) ? pick(clash, 'tun') : {}
			var stack = opts.tunStack !== 'auto' ? String(opts.tunStack) : (apple ? 'gvisor' : String(str(pick(tunCfg, 'stack')) || 'mixed').toLowerCase())
			if (stack !== 'system' && stack !== 'gvisor' && stack !== 'mixed') stack = 'mixed'
			var tunV4 = strList(pick(tunCfg, 'inet4-address', 'inet4_address', 'address')) || []
			var tunV6 = strList(pick(tunCfg, 'inet6-address', 'inet6_address')) || []
			var address = [], ai
			for (ai = 0; ai < tunV4.length; ai++) {
				if (tunV4[ai].indexOf(':') < 0) address.push(tunV4[ai])
				else tunV6.push(tunV4[ai])
			}
			if (!address.length) address = ['172.19.0.1/30']
			if (opts.ipv6) address = address.concat(tunV6.length ? tunV6 : ['fdfe:dcba:9876::1/126'])
			var tun = {
				type: 'tun', tag: 'tun-in',
				address: address,
				mtu: int(pick(tunCfg, 'mtu')) || 9000,
				auto_route: bool(pick(tunCfg, 'auto-route', 'auto_route')) === false ? false : true,
				stack: stack
			}
			var strictRoute = bool(pick(tunCfg, 'strict-route', 'strict_route'))
			var strictOk = preset === 'desktop' || preset === 'gui' || preset === 'universal'
			if (strictOk && strictRoute !== false) tun.strict_route = true
			else if (!strictOk && strictRoute === true) diag.info('\u76ee\u6807\u5ba2\u6237\u7aef\u4e0d\u652f\u6301 strict-route\uff0c\u5df2\u5ffd\u7565\u8be5\u9879')
			if (tun.auto_route === false) {
				delete tun.strict_route
				diag.info('Clash 配置关闭了 auto-route，已同步关闭 sing-box 自动路由')
			}
			if (!ctx.caps.schema) tun.endpoint_independent_nat = false
			inbounds.push(tun)
		}
		var authList = strList(pick(clash, 'authentication')) || []
		var authUsers = []
		for (var ui = 0; ui < authList.length; ui++) {
			var sep = authList[ui].indexOf(':')
			if (sep > 0) authUsers.push({ username: authList[ui].slice(0, sep), password: authList[ui].slice(sep + 1) })
		}
		if (opts.mixed) {
			var mixedIn = { type: 'mixed', tag: 'mixed-in', listen: allowLan ? '0.0.0.0' : '127.0.0.1', listen_port: mixedPort }
			if (authUsers.length) mixedIn.users = authUsers
			inbounds.push(mixedIn)
		}
		if (!inbounds.length) {
			diag.warn('未启用任何入站，已自动添加 mixed 入站')
			inbounds.push({ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: mixedPort })
		}

		/* ---- 5. DNS ---- */
		var modern = ctx.caps.modernDns
		if (!modern) diag.warn('目标内核为 1.11（legacy）：这份配置的 detour 写法在 sing-box 1.12+ 上会拒绝启动，而 SFA / SFI / SFM / GUI 当前多为 sing-box 1.12+，如非必要请切回 1.12+ 目标')
		var dnsRaw = isObj(pick(clash, 'dns')) ? pick(clash, 'dns') : {}
		var fakeip4 = str(pick(dnsRaw, 'fake-ip-range')) || '198.18.0.0/15'
		var fakeip6 = 'fc00::/18'
		var dnsServers = [], serverKeys = {}, dnsTagUsed = {}

		function firstDns(value) {
			var arr = strList(value)
			if (!arr) return null
			for (var i2 = 0; i2 < arr.length; i2++) {
				var spec = parseDns(arr[i2])
				if (spec && spec.type !== 'rcode' && spec.type !== 'fakeip') return spec
			}
			return null
		}
		function detourOf(spec, fallback) {
			if (spec && spec.detour) {
				var t = resolveTarget(spec.detour)
				if (t && t.outbound) return t.outbound
				diag.warn('DNS 服务器指定的出站 “' + spec.detour + '” 不存在，已使用默认出站')
			}
			return fallback
		}
		function addServer(spec, preferTag, detour) {
			if (!spec) return null
			var key = [spec.type, spec.host || '', spec.port || '', spec.path || '', detour || ''].join('|')
			if (serverKeys[key]) return serverKeys[key]
			var tag = preferTag, n = 2
			while (dnsTagUsed[tag]) tag = preferTag + '-' + n++
			dnsTagUsed[tag] = 1
			var s
			if (modern) {
				if (spec.type === 'fakeip') {
					s = { type: 'fakeip', tag: tag, inet4_range: fakeip4 }
					if (opts.ipv6) s.inet6_range = fakeip6
				} else if (spec.type === 'local') {
					s = { type: 'local', tag: tag }
				} else if (spec.type === 'dhcp') {
					s = { type: 'dhcp', tag: tag }
					if (spec.host && spec.host !== 'auto') s.interface = spec.host
				} else {
					s = { type: spec.type, tag: tag, server: spec.host }
					if (spec.port) s.server_port = spec.port
					if ((spec.type === 'https' || spec.type === 'h3') && spec.path && spec.path !== '/') s.path = spec.path
					if (detour) s.detour = detour
					if (!isIp(spec.host)) s.domain_resolver = bootstrapTag
				}
			} else {
				var addr
				if (spec.type === 'local') addr = 'local'
				else if (spec.type === 'fakeip') addr = 'fakeip'
				else if (spec.type === 'dhcp') addr = 'dhcp://' + (spec.host || 'auto')
				else if (spec.type === 'https') addr = 'https://' + hostPort(spec.host, spec.port) + (spec.path || '/dns-query')
				else if (spec.type === 'h3') addr = 'h3://' + hostPort(spec.host, spec.port) + (spec.path || '/dns-query')
				else if (spec.type === 'tls') addr = 'tls://' + hostPort(spec.host, spec.port)
				else if (spec.type === 'quic') addr = 'quic://' + hostPort(spec.host, spec.port)
				else if (spec.type === 'tcp') addr = 'tcp://' + hostPort(spec.host, spec.port)
				else addr = hostPort(spec.host, spec.port)
				s = { tag: tag, address: addr }
				if (detour) s.detour = detour
				if (spec.type !== 'local' && spec.type !== 'fakeip' && spec.type !== 'dhcp' && !isIp(spec.host)) s.address_resolver = bootstrapTag
			}
			dnsServers.push(s)
			serverKeys[key] = tag
			return tag
		}

		var bootstrapSpec = firstDns(pick(dnsRaw, 'default-nameserver')) || firstDns(pick(dnsRaw, 'proxy-server-nameserver')) || null
		var bootstrapHost = bootstrapSpec && bootstrapSpec.host && isIp(bootstrapSpec.host) ? bootstrapSpec.host : '223.5.5.5'
		var bootstrapPort = bootstrapSpec && bootstrapSpec.host === bootstrapHost ? bootstrapSpec.port : undefined
		var bootstrapTag = 'dns-resolver'
		dnsTagUsed[bootstrapTag] = 1
		if (modern) {
			var bs = { type: 'udp', tag: bootstrapTag, server: bootstrapHost }
			if (bootstrapPort) bs.server_port = bootstrapPort
			dnsServers.push(bs)
		} else {
			dnsServers.push({ tag: bootstrapTag, address: hostPort(bootstrapHost, bootstrapPort), detour: 'direct' })
		}

		var directSpec = parseDns(opts.dnsDirect) || firstDns(pick(dnsRaw, 'direct-nameserver', 'direct_nameserver')) || firstDns(pick(dnsRaw, 'nameserver')) || parseDns('https://223.5.5.5/dns-query')
		var directTag = addServer(directSpec, 'dns-direct', detourOf(directSpec, modern ? undefined : 'direct'))
		var proxySpec = parseDns(opts.dnsProxy) || firstDns(pick(dnsRaw, 'fallback')) || parseDns('https://1.1.1.1/dns-query')
		var proxyTag = addServer(proxySpec, 'dns-proxy', detourOf(proxySpec, firstGroup))
		var fakeTag = opts.fakeip ? addServer({ type: 'fakeip' }, 'dns-fake') : null

		var dnsRules = []
		var hostsRaw = pick(clash, 'hosts')
		if (isObj(hostsRaw)) {
			if (modern) {
				var predefined = {}, hostCount = 0, hk
				for (hk in hostsRaw) {
					if (!Object.prototype.hasOwnProperty.call(hostsRaw, hk)) continue
					var hv = strList(hostsRaw[hk])
					if (!hv) continue
					predefined[hk] = hv.length === 1 ? hv[0] : hv
					hostCount++
				}
				if (hostCount) {
					dnsServers.push({ type: 'hosts', tag: 'dns-hosts', predefined: predefined })
					dnsTagUsed['dns-hosts'] = 1
					var hb = newBucket()
					for (hk in predefined) if (Object.prototype.hasOwnProperty.call(predefined, hk)) domainPattern(hk, hb)
					var hostRule = bucketToRule(hb, ctx.ruleSets)
					if (hostRule) { hostRule.server = 'dns-hosts'; dnsRules.push(hostRule) }
				}
			} else diag.warn('hosts 需要 sing-box 1.12+ 的 hosts DNS 服务器，当前目标下已忽略')
		}
		if (opts.clashApi) {
			dnsRules.push({ clash_mode: 'Direct', server: directTag })
			dnsRules.push({ clash_mode: 'Global', server: proxyTag })
		}
		if (fakeTag) {
			var fb = newBucket()
			var filters = strList(pick(dnsRaw, 'fake-ip-filter')) || FAKEIP_FILTER
			for (var fi3 = 0; fi3 < filters.length; fi3++) domainPattern(filters[fi3], fb)
			var fRule = bucketToRule(fb, ctx.ruleSets)
			if (fRule) { fRule.server = directTag; dnsRules.push(fRule) }
		}
		var policy = pick(dnsRaw, 'nameserver-policy', 'nameserver_policy')
		if (isObj(policy)) {
			var byServer = {}, order = []
			for (var pk in policy) {
				if (!Object.prototype.hasOwnProperty.call(policy, pk)) continue
				var pspec = firstDns(policy[pk])
				if (!pspec) continue
				var ptag = addServer(pspec, 'dns-policy', detourOf(pspec, modern ? undefined : 'direct'))
				if (!ptag) continue
				if (!byServer[ptag]) { byServer[ptag] = newBucket(); order.push(ptag) }
				var keys = String(pk).split(',')
				for (var ki = 0; ki < keys.length; ki++) domainPattern(keys[ki].trim(), byServer[ptag])
			}
			for (var oi = 0; oi < order.length; oi++) {
				var pRule = bucketToRule(byServer[order[oi]], ctx.ruleSets)
				if (pRule) { pRule.server = order[oi]; dnsRules.push(pRule) }
			}
		}
		if (opts.dnsFollowRoute) {
			var directSets = Object.keys(directRuleSets)
			if (directSets.length) dnsRules.push({ rule_set: directSets, server: directTag })
		}
		if (fakeTag) dnsRules.push({ query_type: ['A', 'AAAA'], server: fakeTag })

		var dns = { servers: dnsServers }
		if (dnsRules.length) dns.rules = dnsRules
		dns.final = proxyTag || directTag || bootstrapTag
		dns.strategy = opts.ipv6 ? 'prefer_ipv4' : 'ipv4_only'
		if (!modern && fakeTag) {
			dns.fakeip = { enabled: true, inet4_range: fakeip4 }
			if (opts.ipv6) dns.fakeip.inet6_range = fakeip6
		}

		/* ---- 6. 路由 ---- */
		var routeOut = []
		if (opts.sniff) routeOut.push({ action: 'sniff' })
		routeOut.push({ protocol: 'dns', action: 'hijack-dns' })
		if (opts.clashApi) {
			routeOut.push({ clash_mode: 'Direct', outbound: 'direct' })
			routeOut.push({ clash_mode: 'Global', outbound: firstGroup })
		}
		if (opts.lanDirect) routeOut.push({ ip_is_private: true, outbound: 'direct' })
		var resolved = false
		for (var rr = 0; rr < routeRules.length; rr++) {
			var rule = routeRules[rr]
			if (!resolved && opts.resolveIpRules && !opts.fakeip && rule.__ip) { routeOut.push({ action: 'resolve' }); resolved = true }
			var target2 = rule.__target
			delete rule.__target
			delete rule.__ip
			delete rule.__merge
			if (target2 === 'reject') rule.action = 'reject'
			else rule.outbound = target2
			routeOut.push(rule)
		}
		var route = { rules: routeOut }
		if (ctx.ruleSets.list.length) {
			var sets = []
			for (var si = 0; si < ctx.ruleSets.list.length; si++) sets.push(ctx.ruleSets.list[si].entry)
			route.rule_set = sets
		}
		route.final = finalTag || firstGroup
		route.auto_detect_interface = true
		var gIface = str(pick(clash, 'interface-name', 'interface_name'))
		if (gIface) {
			route.default_interface = gIface
			delete route.auto_detect_interface
			diag.info('已沿用 Clash 全局 interface-name（与 auto_detect_interface 互斥，已关闭自动检测）', gIface)
		}
		var gMark = int(pick(clash, 'routing-mark', 'routing_mark'))
		if (gMark) { route.default_mark = gMark; diag.info('已沿用 Clash 全局 routing-mark', String(gMark)) }
		if (modern) route.default_domain_resolver = { server: bootstrapTag }

		/* ---- 7. 组装 ---- */
		var allOutbounds = groupOutbounds.concat(outbounds)
		allOutbounds.push({ type: 'direct', tag: 'direct' })
		var config = { log: { level: str(opts.logLevel) || 'info', timestamp: true }, dns: dns, inbounds: inbounds, outbounds: allOutbounds }
		if (ctx.caps.schema) config.$schema = 'https://sing-box.sagernet.org/schema.json'
		if (endpoints.length) config.endpoints = endpoints
		if (ctx.caps.httpClient && route.rule_set && route.rule_set.some(function (item) { return item && item.type === 'remote' })) {
			var httpClient = { tag: 'ruleset-download' }
			if (ctx.geoDetour) httpClient.detour = ctx.geoDetour
			config.http_clients = [httpClient]
			route.default_http_client = httpClient.tag
		}
		config.route = route
		var experimental = {}
		if (opts.clashApi) {
			var ctrl = str(pick(clash, 'external-controller', 'external_controller')) || ''
			var apiPort = int(opts.clashApiPort) || int((ctrl.split(':')[1] || '').replace(/[^0-9]/g, '')) || 9090
			experimental.clash_api = { external_controller: '127.0.0.1:' + apiPort }
			var secret = str(pick(clash, 'secret'))
			if (secret) experimental.clash_api.secret = secret
		}
		if (opts.cacheFile) {
			experimental.cache_file = { enabled: true }
			if (opts.fakeip) experimental.cache_file.store_fakeip = true
		}
		if (Object.keys(experimental).length) config.experimental = experimental

		/* ---- 8. 自检与修复 ---- */
		var known = { direct: 1 }, dup = {}, oi2
		for (oi2 = 0; oi2 < allOutbounds.length; oi2++) {
			var tg = allOutbounds[oi2].tag
			if (known[tg] && oi2 !== allOutbounds.length - 1) dup[tg] = 1
			known[tg] = 1
		}
		for (oi2 = 0; oi2 < endpoints.length; oi2++) known[endpoints[oi2].tag] = 1
		for (var dk in dup) if (Object.prototype.hasOwnProperty.call(dup, dk)) diag.error('出站标签重复：' + dk)
		for (oi2 = 0; oi2 < allOutbounds.length; oi2++) {
			var ob2 = allOutbounds[oi2]
			if (ob2.outbounds) {
				var keep = []
				for (var mi2 = 0; mi2 < ob2.outbounds.length; mi2++) if (known[ob2.outbounds[mi2]]) keep.push(ob2.outbounds[mi2])
				if (keep.length !== ob2.outbounds.length) diag.warn('代理组存在无效成员，已自动清理', ob2.tag)
				ob2.outbounds = keep.length ? keep : ['direct']
				if (ob2.default && ob2.outbounds.indexOf(ob2.default) < 0) delete ob2.default
			}
			if (ob2.detour && !known[ob2.detour]) { diag.warn('出站 detour 无效，已移除', ob2.tag); delete ob2.detour }
		}
		var setTags = {}
		if (route.rule_set) for (var st = 0; st < route.rule_set.length; st++) setTags[route.rule_set[st].tag] = 1
		function pruneRule(r) {
			if (r.rule_set) {
				var ok = []
				for (var q = 0; q < r.rule_set.length; q++) if (setTags[r.rule_set[q]]) ok.push(r.rule_set[q])
				if (!ok.length) delete r.rule_set
				else r.rule_set = ok
			}
			if (r.rules) for (var q2 = 0; q2 < r.rules.length; q2++) pruneRule(r.rules[q2])
			if (r.action === 'sniff' || r.action === 'resolve') return true
			var conds = 0
			for (var k2 in r) if (Object.prototype.hasOwnProperty.call(r, k2) && k2 !== 'outbound' && k2 !== 'action' && k2 !== 'invert' && k2 !== 'server' && k2 !== 'type' && k2 !== 'mode') conds++
			return conds > 0
		}
		var keptRules = []
		for (var rk = 0; rk < route.rules.length; rk++) {
			var r2 = route.rules[rk]
			if (r2.outbound && !known[r2.outbound]) { diag.warn('路由规则指向不存在的出站，已移除', r2.outbound); continue }
			if (!pruneRule(r2)) continue
			keptRules.push(r2)
		}
		route.rules = keptRules
		if (!known[route.final]) {
			var fb2 = known[firstGroup] ? firstGroup : 'direct'
			diag.warn('最终出站无效，已回退到 ' + fb2)
			route.final = fb2
		}
		var emptyDirect = {}, edi, edk, edn
		for (edi = 0; edi < allOutbounds.length; edi++) {
			var edo = allOutbounds[edi]
			if (!edo || edo.type !== 'direct') continue
			edn = 0
			for (edk in edo) if (Object.prototype.hasOwnProperty.call(edo, edk) && edk !== 'type' && edk !== 'tag') edn++
			if (!edn) emptyDirect[edo.tag] = 1
		}
		var stripped = 0
		var serverTags = {}
		for (var ds = 0; ds < dnsServers.length; ds++) {
			serverTags[dnsServers[ds].tag] = 1
			if (dnsServers[ds].detour && !known[dnsServers[ds].detour]) delete dnsServers[ds].detour
			if (modern && dnsServers[ds].detour && emptyDirect[dnsServers[ds].detour]) { delete dnsServers[ds].detour; stripped++ }
		}
		if (modern) for (edi = 0; edi < allOutbounds.length; edi++) if (allOutbounds[edi].detour && emptyDirect[allOutbounds[edi].detour]) { delete allOutbounds[edi].detour; stripped++ }
		if (modern) for (edi = 0; edi < endpoints.length; edi++) if (endpoints[edi].detour && emptyDirect[endpoints[edi].detour]) { delete endpoints[edi].detour; stripped++ }
		if (route.rule_set) for (edi = 0; edi < route.rule_set.length; edi++) {
			var rsx = route.rule_set[edi]
			if (ctx.caps.httpClient && rsx.download_detour !== undefined) { delete rsx.download_detour; stripped++ }
			else if (rsx.download_detour === undefined) delete rsx.download_detour
			else if (modern && emptyDirect[rsx.download_detour]) { delete rsx.download_detour; stripped++ }
		}
		if (stripped && typeof diag.info === 'function') diag.info('已移除 ' + stripped + ' 处指向空 direct 出站的 detour（sing-box 1.12+ 会拒绝启动）')
		if (dns.rules) {
			var keptDns = []
			for (var dr = 0; dr < dns.rules.length; dr++) {
				var d2 = dns.rules[dr]
				if (!d2.server || !serverTags[d2.server]) continue
				if (!pruneRule(d2)) continue
				keptDns.push(d2)
			}
			if (keptDns.length) dns.rules = keptDns
			else delete dns.rules
		}
		if (!serverTags[dns.final]) dns.final = dnsServers.length ? dnsServers[0].tag : undefined

		var json
		try {
			json = JSON.stringify(config, null, opts.pretty ? 2 : 0)
			JSON.parse(json)
		} catch (e4) {
			throw new Error('生成的 JSON 无法序列化：' + e4.message)
		}

		var issues = diag.all(), errorCount = 0, warnCount = 0, infoCount = 0
		for (var ii = 0; ii < issues.length; ii++) {
			if (issues[ii].level === 'error') errorCount += issues[ii].count
			else if (issues[ii].level === 'warn') warnCount += issues[ii].count
			else infoCount += issues[ii].count
		}
		var report = {
			nodes: nodeTags.length,
			nodesInput: proxies.length,
			skipped: Math.max(0, proxies.length - nodeTags.length - filteredCount),
			filtered: filteredCount,
			groups: groupOutbounds.length,
			rules: route.rules.length,
			rulesInput: rulesRaw.length,
			userRules: ruleCount,
			ruleSets: ctx.ruleSets.list.length,
			outbounds: allOutbounds.length + endpoints.length,
			dnsServers: dnsServers.length,
			protocols: protoCount,
			issues: issues,
			errorCount: errorCount,
			warnCount: warnCount,
			infoCount: infoCount,
			bytes: json.length,
			ms: Math.round((now() - t0) * 10) / 10,
			target: opts.target,
			preset: opts.preset,
			final: route.final,
			endpoints: endpoints.length,
			mode: 'full',
			style: opts.style === 'minimal' ? 'minimal' : 'full',
			version: VERSION
		}
		return { config: config, json: json, report: report }
	}

	return {
		convert: convert,
		DEFAULTS: DEFAULTS,
		VERSION: VERSION,
		parseYaml: function (text) { return yaml().parse(text) },
		validate: validate,
		isInfoNode: isInfoNode,
		regionOf: regionOf
	}
})
