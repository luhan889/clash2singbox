/* 前端端到端回归（真实点击）：node tests/e2e.js
 * 在无头 Chromium 里加载构建产物，模拟粘贴、切换输出模式、切换节点 JSON 形态，
 * 断言真实产出的 JSON 形态与界面状态。无浏览器时跳过。
 */
var fs = require('fs')
var path = require('path')
var cp = require('child_process')

var ROOT = path.join(__dirname, '..')
var pass = 0, fail = 0
var browserTimedOut = false

function ok(name, cond, extra) {
	if (cond) { pass++; console.log('  ok   ' + name) }
	else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  实际：' + JSON.stringify(extra) : '')) }
}

function findBrowser() {
	var cands = [process.env.CHROME_BIN, 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']
	for (var i = 0; i < cands.length; i++) {
		var c = cands[i]
		if (!c) continue
		if (fs.existsSync(c)) return c
		if (/[\\/]/.test(c)) continue
		try {
			var p = process.platform === 'win32'
				? cp.execFileSync('where.exe', [c], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
				: cp.execFileSync('sh', ['-c', 'command -v "$1"', 'sh', c], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
			if (p) return p.split(/\r?\n/)[0]
		} catch (e) { /* keep looking */ }
	}
	return null
}

var YAML = [
	'proxies:',
	'  - {name: HK1, type: anytls, server: hk.example.com, port: 8443, password: pw, sni: hk.example.com, client-fingerprint: chrome}',
	'  - {name: US1, type: vless, server: us.example.com, port: 443, uuid: 11111111-2222-3333-4444-555555555555, flow: xtls-rprx-vision, tls: true, servername: www.microsoft.com, reality-opts: {public-key: PUBKEY, short-id: 6ba85179}}',
	'proxy-groups:',
	'  - {name: PROXY, type: select, proxies: [HK1, US1]}',
	'rules:',
	'  - DOMAIN-SUFFIX,google.com,PROXY',
	'  - MATCH,DIRECT'
].join('\\n')

var PROBE = [
	'<script>(function(){',
	'var R={errors:[],steps:{}};',
	'window.addEventListener("error",function(e){R.errors.push("error: "+(e.message||"?"))});',
	'var YAML="' + YAML + '";',
	'function q(s){return document.querySelector(s)}',
	'function fire(n,t){var e=document.createEvent("HTMLEvents");e.initEvent(t,true,true);n.dispatchEvent(e)}',
	'function snap(){var U=window.C2S_UI,st=U.state,rep=st.report||{},w=q("#opt-wrap");',
	'return{mode:q("#opt-mode").value,repMode:rep.mode||"",wrap:rep.wrap||"",first:(st.json||"").charAt(0),',
	'len:(st.json||"").length,nodes:rep.nodes||0,title:q("#outTitle").textContent,dl:q("#download").textContent,',
	'segOn:(function(){var b=document.querySelectorAll("#modeSeg .seg-btn"),o=[];for(var i=0;i<b.length;i++)if(b[i].className.indexOf("is-on")>=0)o.push(b[i].getAttribute("data-mode"));return o.join(",")})(),',
	'wrapHidden:!w||!!(w.closest?w.closest("[data-nodes]").hidden:false),wrapVal:w?w.value:"",',
	'hasIn:(st.json||"").indexOf("\\"inbounds\\"")>=0,stat:q("#statNodes").textContent,clientHidden:(function(){var f=q("#opt-preset"),l=f&&f.closest?f.closest("label"):null;return !f||!l||!!l.hidden})(),chip:(function(){var p=q("#protos .proto");return p?p.textContent:""})(),chipDot:!!q("#protos .proto i"),headHit:(function(){var h=q(".rail-head");if(!h)return "none";var r=h.getBoundingClientRect();var e=document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+r.height/2));return e?((e===h||h.contains(e))?"head":((e.className||e.tagName)+"")):"none"})(),bodyScroll:(function(){var b=q("#railBody");return b?b.scrollTop:-1})(),railScroll:(function(){var b=q("#rail");return b?b.scrollTop:-1})(),vw:window.innerWidth,vh:window.innerHeight,railCls:(function(){var r=q("#rail");return r?r.className:""})(),railTop:(function(){var r=q("#rail");return r?Math.round(r.getBoundingClientRect().top):-1})(),noneBlock:!!q("#issues .none"),drawerHidden:(function(){var d=q("#issues");return !d||!!d.hidden})(),issueRows:document.querySelectorAll("#issues .issue").length,sam:!!q("#issues details.sam"),samOpen:(function(){var d=q("#issues details.sam");return !!(d&&d.open)})(),fix:!!q("#issues [data-fix=target]"),toasts:document.querySelectorAll("#toasts .toast").length,act:!!q("#toasts .toast .act"),tgt:(function(){var f=q("#opt-target");return f?f.value:""})(),inW:(function(){var p=q("#paneIn");return p?Math.round(p.getBoundingClientRect().width):-1})(),inH:(function(){var p=q("#paneIn");return p?Math.round(p.getBoundingClientRect().height):-1})(),shellCls:(function(){var s=q(".shell");return s?s.className:""})(),ovf:document.documentElement.scrollWidth-window.innerWidth,splitStore:localStorage.getItem("c2s.split")||"",splitVis:(function(){var h=q("#split2");return h?getComputedStyle(h).display:"none"})()}}',
	'var steps=[];function step(n,f){steps.push([n,f])}',
	'function run(){if(!steps.length){return done()}var s=steps.shift();try{s[1]()}catch(e){R.errors.push(s[0]+": "+e.message)}setTimeout(run,450)}',
	'step("boot",function(){R.steps.boot=snap()});',
	'step("paste",function(){var t=q("#yaml");t.value=YAML;fire(t,"input")});',
	'step("afterPaste",function(){R.steps.afterPaste=snap()});',
	'step("clickNodes",function(){q("#modeSeg .seg-btn[data-mode=nodes]").click()});',
	'step("afterNodes",function(){R.steps.afterNodes=snap()});',
	'step("setWrap",function(){var w=q("#opt-wrap");w.value="outbounds";fire(w,"change")});',
	'step("afterWrap",function(){R.steps.afterWrap=snap()});',
	'step("clickFull",function(){q("#modeSeg .seg-btn[data-mode=full]").click()});',
	'step("afterFull",function(){R.steps.afterFull=snap()});',
	'step("backToNodes",function(){q("#modeSeg .seg-btn[data-mode=nodes]").click()});',
	'step("afterBack",function(){R.steps.afterBack=snap();try{R.stored=JSON.parse(localStorage.getItem("c2s.options")||"{}")}catch(e){R.stored={}}});',
	'step("prepScroll",function(){q("#modeSeg .seg-btn[data-mode=full]").click()});',
	'step("openRail",function(){var r=q("#rail");if(r)r.style.transition="none";if(window.innerWidth<=900){q("#railToggle").click()}});',
	'step("scrollRail",function(){var b=q("#railBody");if(b)b.scrollTop=600});',
	'step("afterScroll",function(){R.steps.afterScroll=snap()});',
	'step("closeRail",function(){if(window.innerWidth<=900){var c=q("#railClose");if(c)c.click()}});',
	'step("dragSplit",function(){var h=q("#split2"),p=q("#paneIn");R.steps.dragBefore=p?Math.round(p.getBoundingClientRect().width):-1;if(!h)return;var r=h.getBoundingClientRect(),x=Math.round(r.left+2),y=Math.round(r.top+20);function m(t,cx,node){node.dispatchEvent(new MouseEvent(t,{clientX:cx,clientY:y,bubbles:true,cancelable:true}))}m("mousedown",x,h);m("mousemove",x-140,document);m("mouseup",x-140,document)});',
	'step("afterDrag",function(){R.steps.afterDrag=snap()});',
	'step("resetSplit",function(){var h=q("#split2");if(h)h.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,cancelable:true}))});',
	'step("afterReset",function(){R.steps.afterReset=snap()});',
	'step("legacy",function(){var t=q("#opt-target");t.value="legacy";fire(t,"change")});',
	'step("afterLegacy",function(){R.steps.afterLegacy=snap()});',
	'step("clickFixToast",function(){var b=q("#toasts .toast .act");if(b)b.click()});',
	'step("afterFix",function(){R.steps.afterFix=snap()});',
	'function done(){R.errors=(window.__E2E_ERR||[]).concat(R.errors);var p=document.createElement("pre");p.id="RES";p.textContent="RES"+"ULTS"+JSON.stringify(R)+"DO"+"NE";document.body.appendChild(p)}',
	'var tries=0;(function wait(){if(window.C2S_UI){return run()}if(++tries>60){R.errors.push("C2S_UI 未就绪");return done()}setTimeout(wait,50)})();',
	'})()</script>'
].join('\n')

var EARLY = '<script>window.__E2E_ERR=[];window.addEventListener("error",function(e){window.__E2E_ERR.push("boot: "+(e.message||"?")+" @"+String(e.filename||"").split("/").pop()+":"+e.lineno+":"+e.colno)});</script>'

function probe(browser, target, label, size) {
	var src = fs.readFileSync(target, 'utf8')
	var tmp = path.join(ROOT, 'dist', '_e2e-' + label + '.html')
	var hi = src.indexOf('<head>')
	if (hi >= 0) src = src.slice(0, hi + 6) + EARLY + src.slice(hi + 6)
	var idx = src.lastIndexOf('</body>')
	fs.writeFileSync(tmp, idx < 0 ? src + PROBE : src.slice(0, idx) + PROBE + src.slice(idx), 'utf8')
	var out = ''
	try {
		out = cp.execFileSync(browser, [
			'--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
			'--allow-file-access-from-files', '--window-size=' + (size || '1440,900'),
			'--virtual-time-budget=40000', '--dump-dom', 'file://' + tmp
		], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] })
	} catch (e) {
		if (e && (e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT')) { browserTimedOut = true; console.error('[E2E_TIMEOUT] ' + label + '：Chromium 30 秒内未退出，停止后续浏览器目标测试') }
		out = (e.stdout || '').toString()
	}
	try { fs.unlinkSync(tmp) } catch (e) { /* ignore */ }
	var hits = out.match(/RESULTS[\s\S]*?DONE/g)
	if (!hits || !hits.length) return null
	var raw = hits[hits.length - 1].replace(/^RESULTS/, '').replace(/DONE$/, '')
	try { return JSON.parse(raw) } catch (e) { return null }
}

var browser = findBrowser()
if (!browser) {
	console.log('E2E ' + (process.env.CI ? 'FAIL' : 'SKIP') + '：未找到 Chromium/Chrome，设置 CHROME_BIN 后重试')
	process.exit(process.env.CI ? 1 : 0)
}

var targets = [
	['dist', path.join(ROOT, 'dist', 'index.html'), '1440,900'],
	['standalone', path.join(ROOT, 'dist', 'clash2singbox-standalone.html'), '1440,900'],
	['mobile-414', path.join(ROOT, 'dist', 'index.html'), '414,850']
]

for (var t = 0; t < targets.length; t++) {
	var label = targets[t][0], file = targets[t][1]
	if (!fs.existsSync(file)) { ok(label + '：产物存在', false, file); continue }
	console.log('\n[' + label + '] ' + path.relative(ROOT, file))
	var R = probe(browser, file, label, targets[t][2])
	if (!R) { ok(label + '：探针返回结果', false); if (browserTimedOut) break; continue }
	var s = R.steps || {}
	ok(label + '：无 JS 运行时错误', (R.errors || []).length === 0, R.errors)
	ok(label + '：启动状态一致（模式/高亮/形态选择器）', !!s.boot && s.boot.mode === 'full' && s.boot.segOn === 'full' && s.boot.wrapHidden === true, s.boot)
	ok(label + '：粘贴后输出完整配置', !!s.afterPaste && s.afterPaste.first === '{' && s.afterPaste.hasIn === true, s.afterPaste)
	ok(label + '：粘贴后识别 2 个节点', !!s.afterPaste && String(s.afterPaste.nodes) === '2', s.afterPaste && s.afterPaste.nodes)
	ok(label + '：点「节点 JSON」切到 nodes', !!s.afterNodes && s.afterNodes.mode === 'nodes' && s.afterNodes.repMode === 'nodes', s.afterNodes)
	ok(label + '：节点模式输出裸数组', !!s.afterNodes && s.afterNodes.first === '[', s.afterNodes)
	ok(label + '：节点模式下载名为 outbounds.json', !!s.afterNodes && s.afterNodes.dl.indexOf('outbounds.json') >= 0, s.afterNodes && s.afterNodes.dl)
	ok(label + '：节点模式显示形态选择器', !!s.afterNodes && s.afterNodes.wrapHidden === false, s.afterNodes)
	ok(label + '：切形态后立即重转为对象', !!s.afterWrap && s.afterWrap.first === '{' && s.afterWrap.wrap === 'outbounds', s.afterWrap)
	ok(label + '：切形态后标题同步', !!s.afterWrap && s.afterWrap.title.indexOf('outbounds') >= 0, s.afterWrap && s.afterWrap.title)
	ok(label + '：切回完整配置正常', !!s.afterFull && s.afterFull.repMode === 'full' && s.afterFull.hasIn === true, s.afterFull)
	ok(label + '：完整配置隐藏形态选择器', !!s.afterFull && s.afterFull.wrapHidden === true, s.afterFull)
	ok(label + '：再切回节点模式仍生效', !!s.afterBack && s.afterBack.repMode === 'nodes', s.afterBack)
	ok(label + '：分段控件高亮与模式一致', !!s.afterBack && s.afterBack.segOn === 'nodes', s.afterBack && s.afterBack.segOn)
	ok(label + '：选项已持久化', !!R.stored && R.stored.mode === 'nodes', R.stored && R.stored.mode)
	ok(label + '：客户端选项两种模式都可见', !!s.afterBack && s.afterBack.clientHidden === false && !!s.afterFull && s.afterFull.clientHidden === false, [s.afterBack && s.afterBack.clientHidden, s.afterFull && s.afterFull.clientHidden])
	ok(label + '：协议标签可读（名称+数量）', !!s.afterFull && /[a-z]/.test(s.afterFull.chip) && /[0-9]/.test(s.afterFull.chip) && s.afterFull.chipDot === true, s.afterFull && s.afterFull.chip)
	ok(label + '：滚动后表头不被穿层', !!s.afterScroll && s.afterScroll.headHit === 'head', s.afterScroll && s.afterScroll.headHit)
	ok(label + '：滚动发生在内容区而非整欄', !!s.afterScroll && s.afterScroll.bodyScroll > 0 && s.afterScroll.railScroll === 0, s.afterScroll && [s.afterScroll.bodyScroll, s.afterScroll.railScroll])
	ok(label + '：零问题时不再渲染占位文案块', !!s.afterFull && s.afterFull.noneBlock === false && s.afterFull.drawerHidden === true, s.afterFull && [s.afterFull.noneBlock, s.afterFull.drawerHidden])
	ok(label + '：干净结果以通知形式提示', !!s.afterPaste && s.afterPaste.toasts >= 1, s.afterPaste && s.afterPaste.toasts)
	ok(label + '：分割条桌面端可见、移动端隐藏', !!s.afterDrag && (s.afterDrag.vw > 900 ? s.afterDrag.splitVis !== 'none' : s.afterDrag.splitVis === 'none'), s.afterDrag && s.afterDrag.splitVis)
	ok(label + '：拖拽分割条可调节输入面板宽度', !!s.afterDrag && (s.afterDrag.vw > 900 ? (s.afterDrag.inW > 0 && s.afterDrag.inW <= s.dragBefore - 60) : true) && s.afterDrag.ovf <= 1, [s.dragBefore, s.afterDrag && s.afterDrag.inW, s.afterDrag && s.afterDrag.ovf])
	ok(label + '：分割宽度已写入本地存储', !!s.afterDrag && (s.afterDrag.vw > 900 ? s.afterDrag.splitStore.indexOf('"in"') >= 0 : true), s.afterDrag && s.afterDrag.splitStore)
	ok(label + '：双击分割条恢复默认宽度', !!s.afterReset && (s.afterReset.vw > 900 ? s.afterReset.inW > s.afterDrag.inW : true), [s.afterDrag && s.afterDrag.inW, s.afterReset && s.afterReset.inW])
	ok(label + '：旧核目标下 AnyTLS 被跳过并报错', !!s.afterLegacy && s.afterLegacy.tgt === 'legacy' && s.afterLegacy.issueRows >= 1 && Number(s.afterLegacy.nodes) === 1, s.afterLegacy && [s.afterLegacy.tgt, s.afterLegacy.nodes, s.afterLegacy.issueRows])
	ok(label + '：诊断示例默认折叠不撑开', !!s.afterLegacy && s.afterLegacy.sam === true && s.afterLegacy.samOpen === false, s.afterLegacy && [s.afterLegacy.sam, s.afterLegacy.samOpen])
	ok(label + '：通知内一键切内核后节点恢复', !!s.afterFix && s.afterFix.tgt === 'modern' && Number(s.afterFix.nodes) === 2 && s.afterFix.drawerHidden === true, s.afterFix && [s.afterFix.tgt, s.afterFix.nodes, s.afterFix.drawerHidden])
}

console.log('\n' + (fail === 0 ? 'E2E ALL PASS' : 'E2E FAILURES: ' + fail) + '  (' + pass + '/' + (pass + fail) + ')')
process.exit(fail ? 1 : 0)
