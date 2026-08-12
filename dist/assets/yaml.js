/*!
 * yaml.js — 面向 Clash / mihomo 配置的 YAML 子集解析器
 * 块映射 / 块序列 / 紧凑序列映射 / 流式集合(含锚点与合并键) / 引号跨行折叠 /
 * 纯量跨行折叠 / 块标量(| > 与 - + 截断) / 锚点·别名·合并键 / 显式标签 / 多文档 /
 * Tab 缩进与常见缩进错误自动修正。零依赖，浏览器与 Node 通用。
 */
;(function (root, factory) {
	var api = factory()
	root.YAMLLite = api
	if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
	'use strict'

	var RE_INT = /^[-+]?[0-9]+$/
	var RE_HEX = /^[-+]?0x[0-9a-fA-F]+$/
	var RE_OCT = /^[-+]?0o[0-7]+$/
	var RE_FLOAT = /^[-+]?(?:[0-9]+\.[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/
	var RE_EXP = /^[-+]?[0-9]+[eE][-+]?[0-9]+$/
	var RE_ZERO_LEAD = /^[-+]?0[0-9]/
	var RE_LENIENT = /^[^\s:{}[\]"',]+$/
	var ESCAPES = { '0': '\0', a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0' }

	function fail(message, line) {
		var err = new Error(line ? '第 ' + line + ' 行：' + message : message)
		err.name = 'YamlError'
		err.line = line || 0
		throw err
	}

	/* 去掉行尾注释：引号内的 # 与紧贴前一字符的 # 均不是注释 */
	function stripComment(text) {
		var quote = null
		for (var i = 0; i < text.length; i++) {
			var c = text.charCodeAt(i)
			if (quote) {
				if (c === 92 && quote === 34) i++
				else if (c === quote) quote = null
				continue
			}
			if (c === 34 || c === 39) { quote = c; continue }
			if (c === 35 && (i === 0 || text.charCodeAt(i - 1) === 32 || text.charCodeAt(i - 1) === 9)) return text.slice(0, i)
		}
		return text
	}

	function unescape(body) {
		return body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, function (m, g) {
			if (g.charAt(0) === 'u' && g.length === 5) return String.fromCharCode(parseInt(g.slice(1), 16))
			if (g.charAt(0) === 'x' && g.length === 3) return String.fromCharCode(parseInt(g.slice(1), 16))
			return ESCAPES[g] !== undefined ? ESCAPES[g] : g
		})
	}

	function radix(text, base, prefix) {
		var negative = text.charAt(0) === '-'
		var value = parseInt(text.replace(prefix, ''), base)
		return negative ? -value : value
	}

	/* 显式标签：!!str 123 必须保持字符串，其余按标签语义解析 */
	function tagged(text) {
		var sp = text.search(/\s/)
		if (sp < 0) return null
		var tag = text.slice(0, sp)
		var body = text.slice(sp + 1).replace(/^\s+/, '')
		var q = body.charAt(0)
		var quoted = (q === '"' || q === "'") && body.length > 1 && body.charAt(body.length - 1) === q
		if (tag === '!!str' || tag === '!str') return quoted ? scalar(body) : body
		if (tag === '!!null') return null
		if (tag === '!!bool') return /^(true|yes|on|y|1)$/i.test(body)
		if (tag === '!!int') return Math.trunc(Number(body)) || 0
		if (tag === '!!float') return Number(body)
		return scalar(body)
	}

	function scalar(raw) {
		var s = raw.trim()
		if (!s) return null
		var q = s.charAt(0)
		if ((q === '"' || q === "'") && s.length > 1 && s.charAt(s.length - 1) === q) {
			var body = s.slice(1, -1)
			return q === '"' ? unescape(body) : body.replace(/''/g, "'")
		}
		if (q === '!') return tagged(s)
		if (s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null
		if (s === 'true' || s === 'True' || s === 'TRUE') return true
		if (s === 'false' || s === 'False' || s === 'FALSE') return false
		if (RE_INT.test(s)) {
			if (RE_ZERO_LEAD.test(s)) return s /* 保留 0 开头的字符串，如密码 0123 */
			var n = Number(s)
			return Number.isSafeInteger(n) ? n : s
		}
		if (RE_HEX.test(s)) return radix(s, 16, /^[-+]?0x/)
		if (RE_OCT.test(s)) return radix(s, 8, /^[-+]?0o/)
		if (RE_FLOAT.test(s) || RE_EXP.test(s)) return Number(s)
		return s
	}

	function clone(value) {
		if (Array.isArray(value)) {
			var a = new Array(value.length)
			for (var i = 0; i < value.length; i++) a[i] = clone(value[i])
			return a
		}
		if (value && typeof value === 'object') {
			var o = {}
			for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k)) o[k] = clone(value[k])
			return o
		}
		return value
	}

	/* 引号是否在本行内闭合 */
	function quoteClosed(text, q) {
		for (var i = 1; i < text.length; i++) {
			var c = text.charAt(i)
			if (c === '\\' && q === '"') { i++; continue }
			if (c === q) {
				if (q === "'" && text.charAt(i + 1) === "'") { i++; continue }
				return true
			}
		}
		return false
	}

	/* 合并键 <<：已存在的显式字段优先 */
	function merge(out, value) {
		var sources = Array.isArray(value) ? value : [value]
		for (var i = 0; i < sources.length; i++) {
			var src = sources[i]
			if (!src || typeof src !== 'object' || Array.isArray(src)) continue
			for (var k in src) {
				if (!Object.prototype.hasOwnProperty.call(src, k)) continue
				if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = src[k]
			}
		}
	}

	/* ---------- 流式集合 { } [ ] ---------- */

	function depthOf(text, from) {
		var quote = null, depth = from || 0
		for (var i = 0; i < text.length; i++) {
			var c = text.charAt(i)
			if (quote) {
				if (c === '\\' && quote === '"') i++
				else if (c === quote) quote = null
				continue
			}
			if (c === '"' || c === "'") quote = c
			else if (c === '{' || c === '[') depth++
			else if (c === '}' || c === ']') depth--
		}
		return depth
	}

	function Flow(text, line, anchors) {
		this.s = text
		this.i = 0
		this.line = line
		this.anchors = anchors || {}
	}
	Flow.prototype.ws = function () {
		while (this.i < this.s.length && /\s/.test(this.s.charAt(this.i))) this.i++
	}
	Flow.prototype.name = function () {
		var start = ++this.i
		while (this.i < this.s.length && !/[\s,:\]}]/.test(this.s.charAt(this.i))) this.i++
		return this.s.slice(start, this.i)
	}
	Flow.prototype.value = function () {
		this.ws()
		var c = this.s.charAt(this.i)
		if (c === '{') return this.map()
		if (c === '[') return this.seq()
		if (c === '*') {
			var alias = this.name()
			if (!(alias in this.anchors)) fail('未定义的别名 *' + alias, this.line)
			return clone(this.anchors[alias])
		}
		if (c === '&') {
			var anchor = this.name()
			var value = this.value()
			this.anchors[anchor] = value
			return value
		}
		return scalar(this.token())
	}
	Flow.prototype.token = function () {
		var start = this.i, quote = null
		while (this.i < this.s.length) {
			var c = this.s.charAt(this.i)
			if (quote) {
				if (c === '\\' && quote === '"') this.i++
				else if (c === quote) quote = null
				this.i++
				continue
			}
			if (c === '"' || c === "'") { quote = c; this.i++; continue }
			if (c === ',' || c === '}' || c === ']') break
			this.i++
		}
		return this.s.slice(start, this.i)
	}
	Flow.prototype.key = function () {
		var start = this.i, quote = null
		while (this.i < this.s.length) {
			var c = this.s.charAt(this.i)
			if (quote) {
				if (c === '\\' && quote === '"') this.i++
				else if (c === quote) quote = null
				this.i++
				continue
			}
			if (c === '"' || c === "'") { quote = c; this.i++; continue }
			if (c === ':' || c === ',' || c === '}') break
			this.i++
		}
		return this.s.slice(start, this.i)
	}
	Flow.prototype.map = function () {
		var out = {}
		this.i++
		for (;;) {
			this.ws()
			if (this.i >= this.s.length) fail('流式映射未闭合', this.line)
			var c = this.s.charAt(this.i)
			if (c === '}') { this.i++; break }
			if (c === ',') { this.i++; continue }
			var rawKey = this.key()
			var parsedKey = scalar(rawKey)
			var key = rawKey.trim() === '<<' ? '<<' : parsedKey === null ? '' : String(parsedKey)
			this.ws()
			var value = null
			if (this.s.charAt(this.i) === ':') {
				this.i++
				value = this.value()
			}
			if (key === '<<') merge(out, value)
			else out[key] = value
			this.ws()
			if (this.s.charAt(this.i) === ',') this.i++
		}
		return out
	}
	Flow.prototype.seq = function () {
		var out = []
		this.i++
		for (;;) {
			this.ws()
			if (this.i >= this.s.length) fail('流式序列未闭合', this.line)
			var c = this.s.charAt(this.i)
			if (c === ']') { this.i++; break }
			if (c === ',') { this.i++; continue }
			out.push(this.value())
		}
		return out
	}

	/* ---------- 主解析器 ---------- */

	function Parser(input) {
		var text = String(input == null ? '' : input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
		this.raw = text.split('\n')
		this.warnings = []
		this.lines = []
		this.anchors = {}
		this.p = 0
		var tabFixed = false
		for (var i = 0; i < this.raw.length; i++) {
			var src = this.raw[i]
			if (src.charCodeAt(0) === 9 || /^ *\t/.test(src)) {
				src = src.replace(/^[ \t]+/, function (m) { return m.replace(/\t/g, '  ') })
				this.raw[i] = src
				tabFixed = true
			}
			var t = stripComment(src)
			if (!t.trim()) continue
			var indent = 0
			while (t.charCodeAt(indent) === 32) indent++
			var body = t.slice(indent).replace(/\s+$/, '')
			if (body === '---' || body === '...') {
				if (this.lines.length) { this.warn('检测到多文档 YAML，仅解析第一个文档'); break }
				continue
			}
			if (body.charAt(0) === '%') continue
			this.lines.push({ n: i + 1, indent: indent, text: body })
		}
		if (tabFixed) this.warn('检测到 Tab 缩进，已自动转换为空格')
	}

	Parser.prototype.warn = function (message) {
		if (this.warnings.indexOf(message) < 0) this.warnings.push(message)
	}

	Parser.prototype.cur = function () { return this.lines[this.p] }

	Parser.prototype.parse = function () {
		if (!this.lines.length) return null
		var value = this.node(this.lines[0].indent)
		var rest = this.cur()
		if (rest) fail('缩进不一致，无法解析 “' + rest.text.slice(0, 40) + '”', rest.n)
		return value
	}

	function isItem(text) { return text === '-' || text.charAt(0) === '-' && (text.charAt(1) === ' ' || text.charAt(1) === '\t') }

	Parser.prototype.node = function (indent) {
		var line = this.cur()
		if (!line || line.indent < indent) return null
		return isItem(line.text) ? this.seq(indent) : this.map(indent)
	}

	Parser.prototype.seq = function (indent) {
		var out = []
		for (;;) {
			var line = this.cur()
			if (!line || !isItem(line.text)) break
			if (line.indent !== indent) {
				if (line.indent < indent || !out.length) break
				this.warn('第 ' + line.n + ' 行缩进与同级列表不一致，已自动对齐')
				line.indent = indent
			}
			var rest = line.text.slice(1)
			var offset = 1
			while (rest.charAt(0) === ' ' || rest.charAt(0) === '\t') { rest = rest.slice(1); offset++ }
			if (!rest) {
				this.p++
				var next = this.cur()
				out.push(next && next.indent > indent ? this.node(next.indent) : null)
				continue
			}
			line.indent = indent + offset
			line.text = rest
			if (isItem(rest)) out.push(this.seq(line.indent))
			else if (this.keyEnd(rest) >= 0) out.push(this.map(line.indent))
			else { this.p++; out.push(this.value(rest, line)) }
		}
		return out
	}

	/* 返回分隔键与值的冒号位置，找不到返回 -1 */
	Parser.prototype.keyEnd = function (text) {
		var quote = null, depth = 0
		for (var i = 0; i < text.length; i++) {
			var c = text.charAt(i)
			if (quote) {
				if (c === '\\' && quote === '"') i++
				else if (c === quote) quote = null
				continue
			}
			if (c === '"' || c === "'") quote = c
			else if (c === '{' || c === '[') depth++
			else if (c === '}' || c === ']') depth--
			else if (c === ':' && depth === 0) {
				var n = text.charAt(i + 1)
				if (n === '' || n === ' ' || n === '\t') return i
			}
		}
		return -1
	}

	/* 宽容解析：冒号后缺少空格，如 port:443 */
	Parser.prototype.lenientKeyEnd = function (text) {
		var at = text.indexOf(':')
		if (at <= 0) return -1
		var next = text.charAt(at + 1)
		if (next === '' || next === '/' || next === ':') return -1
		return RE_LENIENT.test(text.slice(0, at)) ? at : -1
	}

	Parser.prototype.map = function (indent) {
		var out = {}
		var count = 0
		for (;;) {
			var line = this.cur()
			if (!line || isItem(line.text)) break
			if (line.indent !== indent) {
				if (line.indent < indent || !count) break
				if (this.keyEnd(line.text) < 0 && this.lenientKeyEnd(line.text) < 0) break
				this.warn('第 ' + line.n + ' 行缩进与同级字段不一致，已自动对齐')
				line.indent = indent
			}
			var at = this.keyEnd(line.text)
			if (at < 0) {
				at = this.lenientKeyEnd(line.text)
				if (at < 0) fail('缺少 “:”，无法解析 “' + line.text.slice(0, 40) + '”', line.n)
				this.warn('第 ' + line.n + ' 行冒号后缺少空格，已自动修正')
			}
			var rawKey = line.text.slice(0, at).replace(/\s+$/, '')
			var rest = line.text.slice(at + 1).replace(/^\s+/, '')
			var key = rawKey === '<<' ? '<<' : String(scalar(rawKey))
			this.p++
			var value = this.value(rest, line, indent)
			if (key === '<<') merge(out, value)
			else out[key] = value
			count++
		}
		return out
	}

	Parser.prototype.value = function (rest, line, indent) {
		if (indent === undefined) indent = line.indent
		if (!rest) {
			var next = this.cur()
			if (!next) return null
			if (next.indent > indent) return this.node(next.indent)
			if (next.indent === indent && isItem(next.text)) return this.seq(indent)
			return null
		}
		var head = rest.charAt(0)
		if (head === '&' || head === '*') {
			var space = rest.search(/\s/)
			var name = (space < 0 ? rest : rest.slice(0, space)).slice(1)
			var tail = space < 0 ? '' : rest.slice(space + 1).replace(/^\s+/, '')
			if (head === '*') {
				if (!(name in this.anchors)) fail('未定义的别名 *' + name, line.n)
				return clone(this.anchors[name])
			}
			var anchored = this.value(tail, line, indent)
			this.anchors[name] = anchored
			return anchored
		}
		if (head === '|' || head === '>') return this.block(rest, line, indent)
		if (head === '{' || head === '[') {
			var text = rest
			var depth = depthOf(text, 0)
			while (depth > 0) {
				var more = this.cur()
				if (!more) fail('流式集合未闭合', line.n)
				text += ' ' + more.text
				this.p++
				depth = depthOf(text, 0)
			}
			return new Flow(text, line.n, this.anchors).value()
		}
		if (head === '"' || head === "'") {
			var quoted = rest, guard = 0
			while (!quoteClosed(quoted, head) && guard++ < 64) {
				var cont = this.cur()
				if (!cont) break
				quoted += ' ' + cont.text
				this.p++
			}
			return scalar(quoted)
		}
		var plain = rest
		for (;;) {
			var nx = this.cur()
			if (!nx || nx.indent <= indent || isItem(nx.text) || this.keyEnd(nx.text) >= 0) break
			plain += ' ' + nx.text
			this.p++
		}
		return scalar(plain)
	}

	Parser.prototype.block = function (header, line, indent) {
		var folded = header.charAt(0) === '>'
		var chomp = header.indexOf('-') > 0 ? 'strip' : header.indexOf('+') > 0 ? 'keep' : 'clip'
		var explicit = (header.match(/[1-9]/) || [])[0]
		var collected = []
		var minIndent = explicit ? indent + Number(explicit) : -1
		var last = line.n - 1
		for (var i = line.n; i < this.raw.length; i++) {
			var src = this.raw[i]
			var trimmed = src.replace(/\s+$/, '')
			if (trimmed === '') { collected.push(''); last = i; continue }
			var ind = 0
			while (src.charCodeAt(ind) === 32) ind++
			if (ind <= indent) break
			if (minIndent < 0) minIndent = ind
			collected.push(trimmed.slice(Math.min(ind, minIndent)))
			last = i
		}
		while (this.lines[this.p] && this.lines[this.p].n <= last + 1 && this.lines[this.p].indent > indent) this.p++
		if (chomp !== 'keep') while (collected.length && collected[collected.length - 1] === '') collected.pop()
		var body
		if (folded) {
			var parts = [], buffer = []
			for (var j = 0; j < collected.length; j++) {
				var text2 = collected[j]
				if (text2 === '') { parts.push(buffer.join(' ')); buffer = [] }
				else if (/^[ \t]/.test(text2)) {
					if (buffer.length) { parts.push(buffer.join(' ')); buffer = [] }
					parts.push(text2)
				} else buffer.push(text2)
			}
			if (buffer.length) parts.push(buffer.join(' '))
			body = parts.join('\n')
		} else body = collected.join('\n')
		if (chomp === 'clip' && body) body += '\n'
		if (chomp === 'keep') body += '\n'
		return body
	}

	function parse(text) {
		var parser = new Parser(text)
		var data = parser.parse()
		if (data && typeof data === 'object') {
			try { Object.defineProperty(data, '__warnings', { value: parser.warnings, enumerable: false }) } catch (e) {}
		}
		return data
	}

	return { parse: parse, scalar: scalar, VERSION: '1.1.0' }
})
