/* 布局回归（无头 Chromium）：node tests/layout.js
 *
 * 断言：9 种视口宽度下
 *   1. 文档无横向溢出
 *   2. 侧栏/卡片无被裁剪的内容（overflow:hidden 且内容超出）
 *   3. 内容超高时侧栏必须可滚动
 * 未找到浏览器时跳过（CI 用 CHROME_BIN 指定）。需先执行 node build.mjs。
 */
var fs = require('fs')
var path = require('path')
var cp = require('child_process')

var ROOT = path.join(__dirname, '..')
var DIST = path.join(ROOT, 'dist')
var SRC = path.join(DIST, 'index.html')
var WIDTHS = [1920, 1440, 1321, 1320, 1280, 1101, 1100, 1024, 916, 901, 900, 768, 560, 414, 390, 360, 320]
var browserTimedOut = false

function findBrowser() {
	var list = [process.env.CHROME_BIN, 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']
	for (var i = 0; i < list.length; i++) {
		var c = list[i]
		if (!c) continue
		if (fs.existsSync(c)) return c
		if (/[\\/]/.test(c)) continue
		try {
			var out = process.platform === 'win32'
				? cp.execFileSync('where.exe', [c], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
				: cp.execFileSync('sh', ['-c', 'command -v "$1"', 'sh', c], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
			if (out) return out.split(/\r?\n/)[0]
		} catch (e) { /* ignore */ }
	}
	return null
}

var PROBE = [
	'(function(){',
	'function run(){',
	'function panes(){',
	'  var shell = document.getElementById("shell"); var pin = document.getElementById("paneIn"); var pout = document.getElementById("paneOut");',
	'  if (!shell || !pin || !pout) return null;',
	'  var s = shell.getBoundingClientRect(); var a = pin.getBoundingClientRect(); var b = pout.getBoundingClientRect();',
	'  return { inW: a.width, outW: b.width, order: a.right <= b.left + 1, rightGap: Math.abs(s.right - b.right) };',
	'}',
	'var narrow = innerWidth <= 900;',
	'var rail = document.getElementById("rail");',
	'if (rail && narrow) { rail.style.transition = "none"; rail.className = "rail open"; }',
	'var out = { w: innerWidth, clipped: [], docOverflow: 0, railOverflow: 0, railScrollable: 1, railH: 0, railView: 0 };',
	'var de = document.documentElement;',
	'out.docOverflow = de.scrollWidth - de.clientWidth > 1 ? de.scrollWidth - de.clientWidth : 0;',
	'var boxes = document.querySelectorAll(".rail .group, .rail-head, .card, .panel, .stats, .protos");',
	'for (var i = 0; i < boxes.length; i++) {',
	'  var b = boxes[i]; var cs = getComputedStyle(b);',
	'  if (cs.display === "none" || !b.getClientRects().length) continue;',
	'  var hiddenY = cs.overflowY === "hidden" || cs.overflow === "hidden";',
	'  var hiddenX = cs.overflowX === "hidden" || cs.overflow === "hidden";',
	'  if (hiddenY && b.scrollHeight - b.clientHeight > 2) out.clipped.push((b.className || b.id) + " \u7ad6\u5411\u88c1\u526a " + (b.scrollHeight - b.clientHeight) + "px");',
	'  if (hiddenX && b.scrollWidth - b.clientWidth > 2) out.clipped.push((b.className || b.id) + " \u6a2a\u5411\u88c1\u526a " + (b.scrollWidth - b.clientWidth) + "px");',
	'}',
	'if (rail) {',
	'  var rs = getComputedStyle(rail);',
	'  out.railH = rail.scrollHeight; out.railView = rail.clientHeight;',
	'  out.railOverflow = rail.scrollWidth - rail.clientWidth > 1 ? rail.scrollWidth - rail.clientWidth : 0;',
	'  if (rail.scrollHeight - rail.clientHeight > 2 && rs.overflowY !== "auto" && rs.overflowY !== "scroll") out.railScrollable = 0;',
	'}',
	'if (!narrow) {',
	'  var shell = document.getElementById("shell"); var toggle = document.getElementById("railToggle");',
	'  if (shell && toggle) {',
	'    if (shell.classList.contains("rail-off")) toggle.click();',
	'    out.panesOn = panes(); toggle.click(); out.panesOff = panes(); toggle.click();',
	'  }',
	'}',
	'var d = document.createElement("div");',
	'd.textContent = "RES" + "ULTS" + JSON.stringify(out) + "DO" + "NE";',
	'document.body.appendChild(d);',
	'}',
	'setTimeout(run, 900);',
	'})();'
].join('\n')

function measure(bin, width) {
	var tmp = path.join(DIST, '_layout' + width + '.html')
	var html = fs.readFileSync(SRC, 'utf8')
	html = html.replace('</body>', '<script>' + PROBE + '</script></body>')
	fs.writeFileSync(tmp, html, 'utf8')
	var dom = ''
	try {
		dom = cp.execFileSync(bin, [
			'--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
			'--window-size=' + width + ',900', '--virtual-time-budget=8000', '--dump-dom', tmp
		], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] })
	} catch (e) {
		if (e && (e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT')) { browserTimedOut = true; console.error('[LAYOUT_TIMEOUT] ' + width + 'px：Chromium 20 秒内未退出，停止后续视口测试') }
		dom = String(e.stdout || '')
	}
	fs.unlinkSync(tmp)
	var all = dom.match(/RESULTS([\s\S]*?)DONE/g)
	if (!all || !all.length) return null
	var last = all[all.length - 1].replace(/^RESULTS/, '').replace(/DONE$/, '')
	try { return JSON.parse(last) } catch (e2) { return null }
}

var bin = findBrowser()
if (!bin) {
	console.log('LAYOUT ' + (process.env.CI ? 'FAIL' : 'SKIP') + '\uff1a\u672a\u627e\u5230 Chromium/Chrome\uff08\u53ef\u7528 CHROME_BIN \u6307\u5b9a\uff09')
	process.exit(process.env.CI ? 1 : 0)
}
if (!fs.existsSync(SRC)) {
	console.log('LAYOUT FAIL\uff1a\u7f3a\u5c11 dist/index.html\uff0c\u8bf7\u5148\u6267\u884c node build.mjs')
	process.exit(1)
}

console.log('\u6d4f\u89c8\u5668\uff1a' + bin)
var fails = 0, total = 0
for (var wi = 0; wi < WIDTHS.length; wi++) {
	var w = WIDTHS[wi]
	total++
	var r = measure(bin, w)
	if (!r) {
		fails++; console.log('  FAIL ' + w + 'px  \u63a2\u9488\u672a\u8fd4\u56de\u7ed3\u679c')
		if (browserTimedOut) break
		continue
	}
	var bad = []
	if (r.docOverflow) bad.push('\u6587\u6863\u6a2a\u5411\u6ea2\u51fa ' + r.docOverflow + 'px')
	if (r.railOverflow) bad.push('\u4fa7\u680f\u6a2a\u5411\u6ea2\u51fa ' + r.railOverflow + 'px')
	if (!r.railScrollable) bad.push('\u4fa7\u680f\u5185\u5bb9\u8d85\u9ad8\u4f46\u4e0d\u53ef\u6eda\u52a8')
	if (r.clipped && r.clipped.length) bad.push('\u88c1\u526a\uff1a' + r.clipped.join('\uff1b'))
	if (r.w > 900) {
		if (!r.panesOn || r.panesOn.inW < 240 || r.panesOn.outW < 240 || !r.panesOn.order || r.panesOn.rightGap > 2) bad.push('\u4fa7\u680f\u5c55\u5f00\u65f6\u8f93\u5165/\u8f93\u51fa\u9762\u677f\u5e03\u5c40\u5f02\u5e38 ' + JSON.stringify(r.panesOn))
		if (!r.panesOff || r.panesOff.inW < 240 || r.panesOff.outW < 240 || !r.panesOff.order || r.panesOff.rightGap > 2) bad.push('\u4fa7\u680f\u6536\u8d77\u65f6\u8f93\u5165/\u8f93\u51fa\u9762\u677f\u5e03\u5c40\u5f02\u5e38 ' + JSON.stringify(r.panesOff))
	}
	if (bad.length) { fails++; console.log('  FAIL ' + w + 'px  ' + bad.join(' | ')) }
	else console.log('  ok   ' + w + 'px  \u4fa7\u680f ' + r.railH + '/' + r.railView)
}

console.log('\n' + (fails === 0 ? 'LAYOUT ALL PASS' : 'LAYOUT FAILURES: ' + fails) + '  (' + (total - fails) + '/' + total + ')')
process.exit(fails ? 1 : 0)
