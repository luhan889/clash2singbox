/*! Clash2SingBox Worker — 在子线程中执行转换，保证主线程不卡顿 */
importScripts('yaml.js', 'convert.js')

self.onmessage = function (event) {
	var data = event.data || {}
	var id = data.id
	try {
		var result = self.Clash2SingBox.convert(data.text || '', data.options || {})
		self.postMessage({ id: id, ok: true, json: result.json, report: result.report })
	} catch (error) {
		self.postMessage({ id: id, ok: false, message: (error && error.message) || String(error) })
	}
}
