/*! Clash2SingBox UI — 无依赖、无构建、纯本地运行 */
;(function () {
	'use strict'

	var API = self.Clash2SingBox
	var DEFAULTS = API.DEFAULTS
	var KEY_OPTS = 'c2s.options'
	var KEY_THEME = 'c2s.theme'
	var LINE = 20
	var PAD = 30

	function $(id) { return document.getElementById(id) }
	function store(key, value) { try { localStorage.setItem(key, value) } catch (e) {} }
	function restore(key) { try { return localStorage.getItem(key) } catch (e) { return null } }

	var el = {
		yaml: $('yaml'), code: $('code'), spacer: $('spacer'), viewport: $('viewport'),
		empty: $('empty'), status: $('status'), issues: $('issues'), issueCount: $('issueCount'),
		issuesToggle: $('issuesToggle'), protos: $('protos'), inputMeta: $('inputMeta'),
		drop: $('drop'), file: $('file'), tplField: $('tplField'), ver: $('ver'),
		rail: $('rail'), railVeil: $('railVeil'), railToggle: $('railToggle'), railClose: $('railClose'), shell: $('shell'),
		modeSeg: $('modeSeg'), optMode: $('opt-mode'), outTitle: $('outTitle'), download: $('download'),
		statNodes: $('statNodes'), statGroups: $('statGroups'), statRules: $('statRules'),
		statFiltered: $('statFiltered'), statSets: $('statSets'), statMs: $('statMs'), statSize: $('statSize'),
		statOut: $('statOut'), statDns: $('statDns'), statSkipped: $('statSkipped'), statMeta: $('statMeta')
	}

	var state = { options: {}, json: '', lines: [], report: null, seq: 0, first: 0, count: 0 }

	/* ---------------- 主题 ---------------- */

	function paint(mode) { document.documentElement.setAttribute('data-theme', mode) }

	var themeOverride = null

	function initTheme() {
		themeOverride = restore(KEY_THEME)
		var mq = self.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null
		paint(themeOverride || (mq && mq.matches ? 'dark' : 'light'))
		if (mq && mq.addEventListener) {
			mq.addEventListener('change', function (event) {
				if (!themeOverride) paint(event.matches ? 'dark' : 'light')
			})
		}
		$('theme').addEventListener('click', function () {
			var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
			themeOverride = next
			paint(next)
			store(KEY_THEME, next)
		})
	}

	/* ---------------- 选项 ---------------- */

	var fields = [].slice.call(document.querySelectorAll('[data-opt]'))

	function collect() {
		var out = {}
		for (var i = 0; i < fields.length; i++) {
			var node = fields[i]
			var key = node.getAttribute('data-opt')
			if (node.type === 'checkbox') out[key] = node.checked
			else if (node.type === 'number') out[key] = node.value === '' ? '' : Number(node.value)
			else out[key] = node.value
		}
		return out
	}

	function fill(options) {
		for (var i = 0; i < fields.length; i++) {
			var node = fields[i]
			var key = node.getAttribute('data-opt')
			if (!(key in options)) continue
			if (node.type === 'checkbox') node.checked = !!options[key]
			else node.value = options[key] == null ? '' : String(options[key])
		}
		$('tplField').hidden = options.geoSource !== 'custom'
	}

	function merged() {
		var saved = {}
		try { saved = JSON.parse(restore(KEY_OPTS) || '{}') || {} } catch (e) { saved = {} }
		var out = {}
		for (var key in DEFAULTS) {
			if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) continue
			out[key] = Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : DEFAULTS[key]
		}
		return out
	}

	/* ---------------- 转换引擎（Worker 优先，失败回退主线程） ---------------- */

	var worker = null
	var pending = {}

	function bootWorker() {
		if (location.protocol === 'file:' || typeof Worker === 'undefined' || !document.currentScript) return null
		try {
			var w = new Worker('assets/worker.js')
			w.onmessage = function (event) {
				var data = event.data || {}
				var resolve = pending[data.id]
				delete pending[data.id]
				if (resolve) resolve(data)
			}
			w.onerror = function () {
				worker = null
				for (var id in pending) { var fn = pending[id]; delete pending[id]; fn({ id: id, fallback: true }) }
			}
			return w
		} catch (e) { return null }
	}

	function runLocal(text, options) {
		try {
			var result = API.convert(text, options)
			return { ok: true, json: result.json, report: result.report }
		} catch (error) {
			return { ok: false, message: (error && error.message) || String(error) }
		}
	}

	function run(text, options, done) {
		if (!worker) return done(runLocal(text, options))
		var id = 'r' + ++state.seq
		var settled = false
		pending[id] = function (data) {
			if (settled) return
			settled = true
			if (data.fallback) return done(runLocal(text, options))
			done(data)
		}
		try { worker.postMessage({ id: id, text: text, options: options }) }
		catch (e) { delete pending[id]; worker = null; done(runLocal(text, options)) }
	}

	/* ---------------- 预览渲染 ---------------- */

	function esc(text) {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	}

	var TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g

	function highlight(line) {
		return esc(line).replace(TOKEN, function (all, text, colon, num, word) {
			if (text) return colon ? '<i class="k">' + text + '</i>' + colon : '<i class="s">' + text + '</i>'
			if (num) return '<i class="n">' + num + '</i>'
			return '<i class="b">' + word + '</i>'
		})
	}

	function paintWindow(force) {
		var total = state.lines.length
		if (!total) { el.code.textContent = ''; state.count = 0; return }
		var view = Math.ceil(el.viewport.clientHeight / LINE) + PAD * 2
		var first = Math.max(0, Math.floor(el.viewport.scrollTop / LINE) - PAD)
		var last = Math.min(total, first + view)
		if (!force && first === state.first && last - first === state.count) return
		state.first = first
		state.count = last - first
		var html = ''
		for (var i = first; i < last; i++) {
			html += '<span class="ln" data-n="' + (i + 1) + '">' + highlight(state.lines[i]) + '</span>'
		}
		el.code.innerHTML = html
		el.code.style.transform = 'translateY(' + first * LINE + 'px)'
	}

	function show(json) {
		state.json = json
		state.lines = json ? json.split('\n') : []
		state.first = -1
		state.count = -1
		el.empty.hidden = !!json
		el.spacer.style.height = Math.max(state.lines.length * LINE, 1) + 'px'
		el.viewport.scrollTop = 0
		paintWindow(true)
		el.code.classList.remove('fade')
		void el.code.offsetWidth
		el.code.classList.add('fade')
	}

	self.C2S_UI = { el: el, state: state, collect: collect, fill: fill, merged: merged, run: run, show: show, paintWindow: paintWindow, bootWorker: bootWorker, store: store, restore: restore, initTheme: initTheme, KEY_OPTS: KEY_OPTS, LINE: LINE, setWorker: function (w) { worker = w } }
})()

;(function () {
	'use strict'

	var UI = self.C2S_UI
	var API = self.Clash2SingBox
	var el = UI.el
	var state = UI.state
	var themeBtn = document.getElementById('theme')
	var timer = null
	var job = 0

	var SAMPLE = [
		'mixed-port: 7890',
		'allow-lan: false',
		'mode: rule',
		'log-level: info',
		'external-controller: 127.0.0.1:9090',
		'dns:',
		'  enable: true',
		'  enhanced-mode: fake-ip',
		'  fake-ip-range: 198.18.0.1/16',
		'  nameserver: [223.5.5.5, https://dns.alidns.com/dns-query]',
		'  fallback: [1.1.1.1, https://dns.google/dns-query]',
		'proxies:',
		'  - name: "\u9999\u6e2f\u00b7Shadowsocks"',
		'    type: ss',
		'    server: hk.example.com',
		'    port: 8443',
		'    cipher: 2022-blake3-aes-128-gcm',
		'    password: "c2FtcGxlcGFzc3dvcmQ9"',
		'    udp: true',
		'  - name: "\u65e5\u672c\u00b7VMess-WS-TLS"',
		'    type: vmess',
		'    server: jp.example.com',
		'    port: 443',
		'    uuid: 11111111-2222-3333-4444-555555555555',
		'    alterId: 0',
		'    cipher: auto',
		'    tls: true',
		'    servername: jp.example.com',
		'    network: ws',
		'    ws-opts:',
		'      path: /ray',
		'      headers:',
		'        Host: jp.example.com',
		'  - name: "\u65b0\u52a0\u5761\u00b7VLESS-Reality"',
		'    type: vless',
		'    server: sg.example.com',
		'    port: 443',
		'    uuid: 66666666-7777-8888-9999-000000000000',
		'    tls: true',
		'    servername: www.microsoft.com',
		'    flow: xtls-rprx-vision',
		'    client-fingerprint: chrome',
		'    reality-opts:',
		'      public-key: EXAMPLE_PUBLIC_KEY_ONLY',
		'      short-id: 6ba85179e30d4fc2',
		'  - name: "\u7f8e\u56fd\u00b7Hysteria2"',
		'    type: hysteria2',
		'    server: us.example.com',
		'    port: 443',
		'    password: sample-password',
		'    up: "50 Mbps"',
		'    down: "200 Mbps"',
		'    sni: us.example.com',
		'  - name: "\u53f0\u6e7e\u00b7Trojan"',
		'    type: trojan',
		'    server: tw.example.com',
		'    port: 443',
		'    password: sample-password',
		'    sni: tw.example.com',
		'proxy-groups:',
		'  - name: "\u8282\u70b9\u9009\u62e9"',
		'    type: select',
		'    proxies: ["\u81ea\u52a8\u9009\u62e9", "\u9999\u6e2f\u00b7Shadowsocks", "\u65e5\u672c\u00b7VMess-WS-TLS", "\u65b0\u52a0\u5761\u00b7VLESS-Reality", "\u7f8e\u56fd\u00b7Hysteria2", "\u53f0\u6e7e\u00b7Trojan", DIRECT]',
		'  - name: "\u81ea\u52a8\u9009\u62e9"',
		'    type: url-test',
		'    tolerance: 50',
		'    interval: 300',
		'    proxies: ["\u9999\u6e2f\u00b7Shadowsocks", "\u65e5\u672c\u00b7VMess-WS-TLS", "\u65b0\u52a0\u5761\u00b7VLESS-Reality", "\u7f8e\u56fd\u00b7Hysteria2", "\u53f0\u6e7e\u00b7Trojan"]',
		'  - name: "\u5e7f\u544a\u62e6\u622a"',
		'    type: select',
		'    proxies: [REJECT, DIRECT]',
		'rules:',
		'  - DOMAIN-SUFFIX,local,DIRECT',
		'  - GEOIP,LAN,DIRECT',
		'  - GEOSITE,category-ads-all,\u5e7f\u544a\u62e6\u622a',
		'  - GEOSITE,cn,DIRECT',
		'  - GEOSITE,geolocation-!cn,\u8282\u70b9\u9009\u62e9',
		'  - GEOIP,CN,DIRECT',
		'  - DST-PORT,853,\u8282\u70b9\u9009\u62e9',
		'  - MATCH,\u8282\u70b9\u9009\u62e9'
	].join('\n')

	function esc(text) {
		return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	}

	function setStatus(text, kind) {
		el.status.textContent = text
		el.status.className = 'badge' + (kind ? ' ' + kind : '')
	}

	function toastBox() {
		var box = document.getElementById('toasts')
		if (!box) {
			box = document.createElement('div')
			box.className = 'toasts'
			box.id = 'toasts'
			box.setAttribute('aria-live', 'polite')
			document.body.appendChild(box)
		}
		return box
	}

	function toast(text, kind, action) {
		var box = toastBox()
		var stale = box.querySelectorAll('.toast .act')
		for (var s = 0; s < stale.length; s++) {
			var host = stale[s].parentNode
			if (host && host.parentNode) host.parentNode.removeChild(host)
		}
		while (box.children.length > 2) box.removeChild(box.children[box.children.length - 1])
		var node = document.createElement('div')
		node.className = 'toast' + (kind ? ' ' + kind : '')
		node.setAttribute('role', 'status')
		node.appendChild(document.createElement('i'))
		var body = document.createElement('span')
		body.className = 'tx'
		body.textContent = text
		node.appendChild(body)
		var timer = 0
		function close() {
			if (timer) clearTimeout(timer)
			node.className = node.className.replace(' in', '')
			setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node) }, 200)
		}
		if (action) {
			var act = document.createElement('button')
			act.type = 'button'
			act.className = 'act'
			act.textContent = action.label
			act.addEventListener('click', function () { close(); action.run() })
			node.appendChild(act)
		}
		var shut = document.createElement('button')
		shut.type = 'button'
		shut.className = 'x'
		shut.setAttribute('aria-label', '\u5173\u95ed')
		shut.textContent = '\u00d7'
		shut.addEventListener('click', close)
		node.appendChild(shut)
		box.insertBefore(node, box.firstChild)
		setTimeout(function () { node.className += ' in' }, 16)
		timer = setTimeout(close, action ? 7000 : 3200)
		return node
	}

	function flash(text) {
		toast(text, 'ok')
	}


	function renderProtos(map) {
		var keys = Object.keys(map || {})
		keys.sort(function (a, b) { return map[b] - map[a] })
		if (!keys.length) { el.protos.innerHTML = ''; return }
		el.protos.textContent = ''
		for (var i = 0; i < keys.length && i < 8; i++) {
			var key = keys[i]
			var box = document.createElement('div')
			box.className = 'proto'
			box.title = key + ' \u00d7 ' + map[key] + ' \u4e2a\u8282\u70b9'
			var dot = document.createElement('i')
			var label = document.createElement('span')
			label.textContent = key
			var num = document.createElement('b')
			num.textContent = String(map[key])
			box.appendChild(dot)
			box.appendChild(label)
			box.appendChild(num)
			el.protos.appendChild(box)
		}
	}

	var issueRows = 0
	var lastIssueSig = null

	function issueSig(list) {
		var out = []
		for (var i = 0; i < list.length; i++) out.push(list[i].level + '|' + list[i].title + '|' + (list[i].count || 1))
		return out.join('~')
	}

	function needsModern(item) {
		return item.level === 'error' && /sing-box 1\.1[2-9]/.test(String(item.title))
	}

	function targetFixable(list) {
		var field = document.getElementById('opt-target')
		if (!field || field.value !== 'legacy') return false
		for (var i = 0; i < list.length; i++) if (needsModern(list[i])) return true
		return false
	}

	function applyTargetFix() {
		var field = document.getElementById('opt-target')
		if (!field) return
		field.value = 'modern'
		var ev = document.createEvent('HTMLEvents')
		ev.initEvent('change', true, false)
		field.dispatchEvent(ev)
	}

	function openIssues() {
		el.issues.hidden = false
		el.issuesToggle.setAttribute('aria-expanded', 'true')
	}

	function renderIssues(list) {
		var total = 0
		var errs = 0
		var warns = 0
		for (var i = 0; i < list.length; i++) {
			var n = list[i].count || 1
			total += n
			if (list[i].level === 'error') errs += n
			else if (list[i].level === 'warn') warns += n
		}
		issueRows = list.length
		el.issueCount.textContent = String(total)
		var sig = issueSig(list)
		var fresh = sig !== lastIssueSig
		lastIssueSig = sig
		el.issuesToggle.className = 'btn tiny ghost' + (errs ? ' has-err' : warns ? ' has-warn' : list.length ? '' : ' clean')
		if (!list.length) {
			el.issues.innerHTML = ''
			el.issues.hidden = true
			el.issuesToggle.setAttribute('aria-expanded', 'false')
			if (fresh && el.statNodes.textContent !== '0') toast('\u672a\u53d1\u73b0\u95ee\u9898\uff0c\u914d\u7f6e\u53ef\u76f4\u63a5\u4f7f\u7528', 'ok')
			return
		}
		var fixable = targetFixable(list)
		var html = ''
		for (var j = 0; j < list.length; j++) {
			var item = list[j]
			var label = item.level === 'error' ? '\u9519\u8bef' : item.level === 'warn' ? '\u8b66\u544a' : '\u63d0\u793a'
			html += '<div class="issue ' + item.level + '"><span class="lvl">' + label + '</span><div class="body">'
			html += '<div class="t"><span>' + esc(item.title) + '</span>' + (item.count > 1 ? '<span class="c">\u00d7' + item.count + '</span>' : '') + '</div>'
			if (item.samples && item.samples.length) {
				html += '<details class="sam"><summary>\u793a\u4f8b ' + item.samples.length + ' \u9879</summary><div class="s">' + esc(item.samples.join(' \u00b7 ')) + '</div></details>'
			}
			html += '</div>'
			if (fixable && needsModern(item)) html += '<button class="fix" type="button" data-fix="target">\u5207\u5230 1.12+</button>'
			html += '</div>'
		}
		el.issues.innerHTML = html
		if (!fresh) return
		var parts = []
		if (errs) parts.push(errs + ' \u9879\u9519\u8bef')
		if (warns) parts.push(warns + ' \u9879\u8b66\u544a')
		if (total - errs - warns) parts.push((total - errs - warns) + ' \u9879\u63d0\u793a')
		var head = String(list[0].title)
		if (head.length > 42) head = head.slice(0, 42) + '\u2026'
		toast(parts.join(' \u00b7 ') + '\uff1a' + head, errs ? 'err' : warns ? 'warn' : '', fixable
			? { label: '\u5207\u5230 1.12+', run: applyTargetFix }
			: { label: '\u67e5\u770b\u8bca\u65ad', run: openIssues })
	}


	var CLIENT_LABEL = { universal: '通用', android: 'SFA・Android', apple: 'SFI / SFM', desktop: 'sing-box 桌面版', gui: 'GUI.for.SingBox' }

	function metaText(report) {
		var bits = [report.target === 'legacy' ? 'sing-box 1.11' : report.target === 'latest' ? 'sing-box 1.14+' : 'sing-box 1.12–1.13']
		bits.push(CLIENT_LABEL[report.preset] || '通用')
		if (report.mode === 'nodes') bits.push(report.wrap === 'outbounds' ? '{ "outbounds": [ … ] }' : '数组 [ … ]')
		else bits.push('落地 ' + (report.final || 'direct') + '，规则 ' + (report.rulesInput || 0) + ' → ' + (report.rules || 0))
		if (report.style === 'minimal') bits.push('Minimal')
		return bits.join(' · ')
	}

	function renderReport(report) {
		el.statNodes.textContent = report.nodes
		el.statFiltered.textContent = report.filtered || 0
		el.statGroups.textContent = report.groups
		el.statRules.textContent = report.rules
		el.statSets.textContent = report.ruleSets
		el.statMs.textContent = report.ms
		el.statSize.textContent = (report.bytes / 1024).toFixed(1)
		el.statOut.textContent = report.outbounds || 0
		el.statDns.textContent = report.dnsServers || 0
		el.statSkipped.textContent = report.skipped || 0
		el.statMeta.textContent = metaText(report)
		renderProtos(report.protocols)
		renderIssues(report.issues || [])
		if (report.errorCount) setStatus('\u9519\u8bef ' + report.errorCount, 'err')
		else if (report.warnCount) setStatus('\u8b66\u544a ' + report.warnCount, 'warn')
		else setStatus('\u81ea\u68c0\u901a\u8fc7', 'ok')
	}

	function applyMode() {
		var nodes = el.optMode.value === 'nodes'
		var gated = [].slice.call(document.querySelectorAll('[data-full]'))
		for (var i = 0; i < gated.length; i++) gated[i].hidden = nodes
		var onlyNodes = [].slice.call(document.querySelectorAll('[data-nodes]'))
		for (var k = 0; k < onlyNodes.length; k++) onlyNodes[k].hidden = !nodes
		var btns = [].slice.call(el.modeSeg.querySelectorAll('.seg-btn'))
		for (var j = 0; j < btns.length; j++) {
			var on = (btns[j].getAttribute('data-mode') === 'nodes') === nodes
			btns[j].className = on ? 'seg-btn is-on' : 'seg-btn'
			btns[j].setAttribute('aria-checked', on ? 'true' : 'false')
		}
		el.download.textContent = nodes ? '\u4e0b\u8f7d outbounds.json' : '\u4e0b\u8f7d config.json'
		var wrapSel = document.getElementById('opt-wrap')
		var wrapped = !!wrapSel && wrapSel.value === 'outbounds'
		el.outTitle.textContent = nodes ? (wrapped ? 'sing-box \u8282\u70b9 JSON\uff08{"outbounds": \u2026}\uff09' : 'sing-box \u8282\u70b9 JSON\uff08outbounds \u6570\u7ec4\uff09') : 'sing-box config.json'
	}

	var railLastFocus = null

	/* 底部面板属于模态层：需要可聚焦元素清单、焦点陷阱与焦点归还 */
	function railFocusables() {
		var nodes = el.rail.querySelectorAll('button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')
		var out = []
		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i]
			if (n.disabled || n.hidden) continue
			if (!n.getClientRects().length) continue
			out.push(n)
		}
		return out
	}

	function railOpen(open) {
		el.rail.className = open ? 'rail open' : 'rail'
		el.railVeil.hidden = !open
		el.railToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
		if (open) {
			railLastFocus = document.activeElement
			el.rail.setAttribute('role', 'dialog')
			el.rail.setAttribute('aria-modal', 'true')
			var first = railFocusables()[0]
			if (first) first.focus()
		} else {
			el.rail.removeAttribute('role')
			el.rail.removeAttribute('aria-modal')
			if (railLastFocus && railLastFocus.focus) railLastFocus.focus()
			railLastFocus = null
		}
	}

	function railIsOpen() { return el.rail.className.indexOf('open') >= 0 }

	/* 宽屏：整列收起侧栏，把空间让给编辑器与输出；窄屏：底部面板 */
	var KEY_RAIL = 'c2s.rail'
	function wideScreen() { return !self.matchMedia || matchMedia('(min-width: 901px)').matches }
	function railCollapsed() { return el.shell.className.indexOf('rail-off') >= 0 }
	var railOff = false

	function paintShell() {
		el.shell.className = railOff ? 'shell rail-off' : 'shell'
	}

	/* 三栏宽度：拖拽 / 方向键微调 / 双击复位，写入本地存储 */
	var KEY_SPLIT = 'c2s.split'
	var MIN_RAIL = 200, MAX_RAIL = 460, MIN_PANE = 260, DEF_RAIL = 270
	var sizes = { rail: DEF_RAIL, 'in': 0 }

	function fireResize() {
		var ev = document.createEvent('HTMLEvents')
		ev.initEvent('resize', true, false)
		window.dispatchEvent(ev)
	}

	function pointX(ev) { return ev && ev.touches && ev.touches[0] ? ev.touches[0].clientX : (ev ? ev.clientX : 0) }

	function clampSizes() {
		var total = el.shell.getBoundingClientRect().width
		if (!total) return
		var railW = railOff ? 0 : Math.max(MIN_RAIL, Math.min(MAX_RAIL, sizes.rail || DEF_RAIL))
		var avail = total - railW - (railOff ? 5 : 10)
		var inW = sizes['in'] || Math.round(avail / 2.1)
		var max = avail - MIN_PANE
		inW = max < MIN_PANE ? Math.round(avail / 2) : Math.max(MIN_PANE, Math.min(max, inW))
		if (!railOff) sizes.rail = Math.round(railW)
		sizes['in'] = Math.round(inW)
	}

	function paintSplit() {
		if (!wideScreen()) { el.shell.style.removeProperty('--w-rail'); el.shell.style.removeProperty('--w-in'); return }
		clampSizes()
		el.shell.style.setProperty('--w-rail', sizes.rail + 'px')
		el.shell.style.setProperty('--w-in', sizes['in'] + 'px')
	}

	function storeSplit() { UI.store(KEY_SPLIT, JSON.stringify(sizes)) }

	function startDrag(handle, which, ev) {
		if (!wideScreen()) return
		if (ev && ev.preventDefault) ev.preventDefault()
		var startX = pointX(ev), from = sizes[which] || (which === 'rail' ? DEF_RAIL : 0)
		handle.className = 'split dragging'
		if (document.body.classList) document.body.classList.add('resizing')
		function move(e2) {
			if (e2 && e2.preventDefault) e2.preventDefault()
			sizes[which] = from + (pointX(e2) - startX)
			paintSplit()
		}
		function up() {
			handle.className = 'split'
			if (document.body.classList) document.body.classList.remove('resizing')
			document.removeEventListener('mousemove', move)
			document.removeEventListener('mouseup', up)
			document.removeEventListener('touchmove', move)
			document.removeEventListener('touchend', up)
			storeSplit(); fireResize()
		}
		document.addEventListener('mousemove', move)
		document.addEventListener('mouseup', up)
		document.addEventListener('touchmove', move, { passive: false })
		document.addEventListener('touchend', up)
	}

	function bindSplit(id, which) {
		var handle = document.getElementById(id)
		if (!handle) return
		handle.addEventListener('mousedown', function (ev) { startDrag(handle, which, ev) })
		handle.addEventListener('touchstart', function (ev) { startDrag(handle, which, ev) }, { passive: false })
		handle.addEventListener('dblclick', function () {
			sizes[which] = which === 'rail' ? DEF_RAIL : 0
			paintSplit(); storeSplit(); fireResize()
		})
		handle.addEventListener('keydown', function (ev) {
			var k = String(ev.key || '').toLowerCase(), step = ev.shiftKey ? 48 : 16
			if (k === 'arrowleft') sizes[which] = (sizes[which] || DEF_RAIL) - step
			else if (k === 'arrowright') sizes[which] = (sizes[which] || DEF_RAIL) + step
			else if (k === 'home') sizes[which] = which === 'rail' ? DEF_RAIL : 0
			else return
			ev.preventDefault()
			paintSplit(); storeSplit(); fireResize()
		})
	}

	function applyRail(collapsed) {
		railOff = collapsed
		paintShell()
		paintSplit()
		UI.store(KEY_RAIL, collapsed ? 'off' : 'on')
		if (wideScreen()) el.railToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
	}


	function reset() {
		UI.show('')
		state.report = null
		el.statNodes.textContent = '0'
		el.statFiltered.textContent = '0'
		el.statGroups.textContent = '0'
		el.statRules.textContent = '0'
		el.statSets.textContent = '0'
		el.statMs.textContent = '0'
		el.statSize.textContent = '0'
		el.statOut.textContent = '0'
		el.statDns.textContent = '0'
		el.statSkipped.textContent = '0'
		el.statMeta.textContent = '等待输入'
		el.protos.innerHTML = ''
		el.issueCount.textContent = '0'
		el.issues.innerHTML = '<p class="none">暂无诊断信息。</p>'
		setStatus('\u5c31\u7ee7')
	}

	/* 输入体量上限：超过该值直接拒绝，避免主线程/Worker 卡死或 OOM */
	var MAX_INPUT = 8 * 1024 * 1024

	function inputTooLarge(bytes) {
		UI.show('')
		state.report = null
		setStatus('\u8f93\u5165\u8fc7\u5927', 'err')
		el.issueCount.textContent = '1'
		el.issues.innerHTML = '<div class="issue error"><span class="lvl">\u9519\u8bef</span><div class="body"><div class="t">'
			+ esc('内容约 ' + (bytes / 1048576).toFixed(1) + ' MB，超过 8 MB 上限；请先在 Clash 侧精简订阅或分批转换（典型机场配置不超过 2 MB）') + '</div></div></div>'
		el.issues.hidden = false
		el.issuesToggle.setAttribute('aria-expanded', 'true')
	}

	function convert() {
		var text = el.yaml.value
		el.inputMeta.textContent = text
			? text.split('\n').length + ' \u884c \u00b7 ' + (text.length / 1024).toFixed(1) + ' KB'
			: '\u7b49\u5f85\u8f93\u5165'
		if (!text.trim()) { reset(); return }
		if (text.length > MAX_INPUT) { inputTooLarge(text.length); return }
		state.options = UI.collect()
		UI.store(UI.KEY_OPTS, JSON.stringify(state.options))
		var mine = ++job
		setStatus('\u8f6c\u6362\u4e2d\u2026', 'busy')
		UI.run(text, state.options, function (result) {
			if (mine !== job) return
			if (!result || !result.ok) {
				UI.show('')
				setStatus('\u89e3\u6790\u5931\u8d25', 'err')
				el.issueCount.textContent = '1'
				el.issues.innerHTML = '<div class="issue error"><span class="lvl">\u9519\u8bef</span><div class="body"><div class="t">'
					+ esc((result && result.message) || '\u672a\u77e5\u9519\u8bef') + '</div></div></div>'
				el.issues.hidden = false
				el.issuesToggle.setAttribute('aria-expanded', 'true')
				return
			}
			state.report = result.report
			UI.show(result.json)
			renderReport(result.report)
		})
	}

	function schedule() { clearTimeout(timer); timer = setTimeout(convert, 220) }

	function download() {
		if (!state.json) { flash('\u6682\u65e0\u53ef\u4e0b\u8f7d\u5185\u5bb9'); return }
		var blob = new Blob([state.json], { type: 'application/json;charset=utf-8' })
		var url = URL.createObjectURL(blob)
		var link = document.createElement('a')
		link.href = url
		link.download = state.report && state.report.mode === 'nodes' ? 'outbounds.json' : 'config.json'
		document.body.appendChild(link)
		link.click()
		document.body.removeChild(link)
		setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
	}

	function copy() {
		if (!state.json) { flash('\u6682\u65e0\u53ef\u590d\u5236\u5185\u5bb9'); return }
		var legacy = function () {
			var area = document.createElement('textarea')
			area.value = state.json
			area.setAttribute('readonly', '')
			area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
			document.body.appendChild(area)
			area.select()
			try { document.execCommand('copy'); flash('\u5df2\u590d\u5236') } catch (e) {}
			document.body.removeChild(area)
		}
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(state.json).then(function () { flash('\u5df2\u590d\u5236') }, legacy)
		} else legacy()
	}

	function loadFile(file) {
		if (!file) return
		if (file.size > MAX_INPUT) { inputTooLarge(file.size); return }
		var reader = new FileReader()
		reader.onload = function () { el.yaml.value = String(reader.result || ''); convert() }
		reader.onerror = function () { setStatus('\u6587\u4ef6\u8bfb\u53d6\u5931\u8d25', 'err') }
		reader.readAsText(file)
	}

	function hasFiles(event) {
		var transfer = event.dataTransfer
		if (!transfer) return false
		var types = transfer.types || []
		for (var i = 0; i < types.length; i++) if (types[i] === 'Files') return true
		return false
	}

	/* ---------------- 事件 ---------------- */

	el.yaml.addEventListener('input', schedule)
	el.viewport.addEventListener('scroll', function () { UI.paintWindow(false) }, { passive: true })
	addEventListener('resize', function () { UI.paintWindow(true) })

	document.getElementById('download').addEventListener('click', download)
	document.getElementById('copy').addEventListener('click', copy)
	document.getElementById('pick').addEventListener('click', function () { el.file.click() })
	el.file.addEventListener('change', function () { loadFile(el.file.files && el.file.files[0]); el.file.value = '' })
	document.getElementById('sample').addEventListener('click', function () { el.yaml.value = SAMPLE; convert() })
	document.getElementById('clear').addEventListener('click', function () { el.yaml.value = ''; el.yaml.focus(); convert() })
	document.getElementById('reset').addEventListener('click', function () {
		UI.fill(API.DEFAULTS)
		state.options = UI.collect()
		UI.store(UI.KEY_OPTS, JSON.stringify(state.options))
		applyMode()
		convert()
		flash('\u5df2\u6062\u590d\u9ed8\u8ba4\u8bbe\u7f6e')
	})
	var wrapField = document.getElementById('opt-wrap')
	var presetField = document.getElementById('opt-preset')
	if (wrapField) wrapField.addEventListener('change', function () { applyMode(); convert() })
	if (presetField) presetField.addEventListener('change', function () { applyMode(); convert() })
	;[].slice.call(el.modeSeg.querySelectorAll('.seg-btn')).forEach(function (btn) {
		btn.addEventListener('click', function () {
			var want = btn.getAttribute('data-mode')
			if (el.optMode.value === want) return
			el.optMode.value = want
			applyMode()
			convert()
		})
	})
	el.railToggle.addEventListener('click', function () {
		if (wideScreen()) applyRail(!railCollapsed())
		else railOpen(!railIsOpen())
	})
	el.railClose.addEventListener('click', function () { railOpen(false) })
	el.railVeil.addEventListener('click', function () { railOpen(false) })
	el.issuesToggle.addEventListener('click', function () {
		if (!issueRows) { toast('\u672a\u53d1\u73b0\u95ee\u9898\uff0c\u914d\u7f6e\u53ef\u76f4\u63a5\u4f7f\u7528', 'ok'); return }
		var open = el.issues.hidden
		el.issues.hidden = !open
		el.issuesToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
	})

	for (var f = 0; f < 1; f++) void f
	;[].slice.call(document.querySelectorAll('[data-opt]')).forEach(function (node) {
		var event = node.tagName === 'SELECT' || node.type === 'checkbox' ? 'change' : 'input'
		node.addEventListener(event, function () {
			if (node.id === 'opt-geoSource') el.tplField.hidden = node.value !== 'custom'
			if (event === 'change') convert(); else schedule()
		})
	})

	var depth = 0
	addEventListener('dragenter', function (event) { if (!hasFiles(event)) return; depth++; el.drop.hidden = false })
	addEventListener('dragover', function (event) { if (hasFiles(event)) event.preventDefault() })
	addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) el.drop.hidden = true })
	addEventListener('drop', function (event) {
		if (!hasFiles(event)) return
		event.preventDefault()
		depth = 0
		el.drop.hidden = true
		loadFile(event.dataTransfer.files && event.dataTransfer.files[0])
	})

	document.addEventListener('keydown', function (event) {
		var key = (event.key || '').toLowerCase()
		if (key === 'tab' && railIsOpen() && !wideScreen()) {
			var f = railFocusables()
			if (!f.length) return
			var first = f[0], last = f[f.length - 1]
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
			return
		}
		if (key === 'escape') {
			if (railIsOpen()) { railOpen(false); return }
			if (!el.drop.hidden) { depth = 0; el.drop.hidden = true; return }
			if (!el.issues.hidden) {
				el.issues.hidden = true
				el.issuesToggle.setAttribute('aria-expanded', 'false')
			}
			return
		}
		if (!(event.ctrlKey || event.metaKey) || event.altKey) return
		if (key === 'enter') { event.preventDefault(); convert() }
		else if (key === 's') { event.preventDefault(); download() }
		else if (key === 'k') { event.preventDefault(); copy() }
		else if (key === 'o') { event.preventDefault(); el.file.click() }
		else if (key === 'd') { event.preventDefault(); themeBtn.click() }
	})

	/* ---------------- 启动 ---------------- */

	UI.initTheme()
	UI.fill(UI.merged())
	applyMode()
	/* 首次访问：根据当前设备自动选定客户端预设（之后尊重用户选择） */
	var KEY_AUTO = 'c2s.autoclient'
	function detectClient() {
		var ua = String(navigator.userAgent || '') + ' ' + String(navigator.platform || '')
		if (/Android/i.test(ua)) return 'android'
		if (/iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(ua)) return 'apple'
		if (/Windows|Linux|CrOS|X11/i.test(ua)) return 'desktop'
		return 'universal'
	}
	if (!UI.restore(KEY_AUTO) && presetField) {
		var guess = detectClient()
		UI.store(KEY_AUTO, guess)
		if (presetField.value !== guess) {
			presetField.value = guess
			state.options = UI.collect()
			UI.store(UI.KEY_OPTS, JSON.stringify(state.options))
			applyMode()
			toast('已按当前设备自动选定客户端：' + (CLIENT_LABEL[guess] || guess) + '，可在顶部随时改', 'ok')
		}
	}
	try { var savedSplit = JSON.parse(UI.restore(KEY_SPLIT) || '{}') || {} } catch (errSplit) { savedSplit = {} }
	sizes.rail = parseInt(savedSplit.rail, 10) || DEF_RAIL
	sizes['in'] = parseInt(savedSplit['in'], 10) || 0
	bindSplit('split1', 'rail')
	bindSplit('split2', 'in')
	addEventListener('resize', function () { paintSplit() })
	el.issues.addEventListener('click', function (event) {
		var hit = event.target
		if (hit && hit.getAttribute && hit.getAttribute('data-fix') === 'target') applyTargetFix()
	})
	paintSplit()
	applyRail(UI.restore(KEY_RAIL) === 'off')
	UI.setWorker(UI.bootWorker())
	el.ver.textContent = 'v' + API.VERSION
	reset()
	if (navigator.serviceWorker && location.protocol.indexOf('http') === 0) {
		addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}) })
	}
})()
