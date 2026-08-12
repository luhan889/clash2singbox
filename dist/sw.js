/*! Clash2SingBox Service Worker — 应用壳缓存，离线可用 */
/* BUILD 由 build.mjs 在构建时改写为「版本号-内容哈希」，保证每次发布都启用新缓存 */
var BUILD = '1.3.6-30395fcd3f'
var CACHE = 'clash2singbox-' + BUILD
var SHELL = [
	'./',
	'./index.html',
	'./assets/style.css',
	'./assets/yaml.js',
	'./assets/convert.js',
	'./assets/app.js',
	'./assets/worker.js',
	'./favicon.svg',
	'./manifest.webmanifest'
]

self.addEventListener('install', function (event) {
	event.waitUntil(
		caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL) }).then(function () { return self.skipWaiting() })
	)
})

self.addEventListener('activate', function (event) {
	event.waitUntil(
		caches.keys().then(function (keys) {
			return Promise.all(keys.map(function (key) { return key === CACHE ? null : caches.delete(key) }))
		}).then(function () { return self.clients.claim() })
	)
})

self.addEventListener('fetch', function (event) {
	var request = event.request
	if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return
	event.respondWith(
		caches.match(request).then(function (hit) {
			if (hit) return hit
			return fetch(request).then(function (response) {
				if (response && response.ok && response.type === 'basic') {
					var copy = response.clone()
					caches.open(CACHE).then(function (cache) { cache.put(request, copy) })
				}
				return response
			}).catch(function () { return caches.match('./index.html') })
		})
	)
})
