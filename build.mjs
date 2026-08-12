#!/usr/bin/env node
/*!
 * build.mjs — 零依赖构建脚本
 * 1) 把可部署文件复制到 dist/
 * 2) 生成单文件离线版 dist/clash2singbox-standalone.html
 */
import { readFile, writeFile, mkdir, cp, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root, 'dist')
const read = (rel) => readFile(path.join(root, rel), 'utf8')

const COPY = [
	'index.html',
	'favicon.svg',
	'manifest.webmanifest',
	'sw.js',
	'_headers',
	'.nojekyll',
	'README.md',
	'LICENSE',
	'vercel.json',
	'assets'
]

async function main() {
	await rm(dist, { recursive: true, force: true })
	await mkdir(dist, { recursive: true })
	for (const entry of COPY) {
		await cp(path.join(root, entry), path.join(dist, entry), { recursive: true })
	}

	/* Service Worker 缓存名带上版本与内容哈希，避开旧壳残留 */
	const shell = ['index.html', 'assets/style.css', 'assets/yaml.js', 'assets/convert.js', 'assets/app.js', 'assets/worker.js']
	const shellSources = []
	for (const rel of shell) shellSources.push(await read(rel))
	const engine = shellSources[shell.indexOf('assets/convert.js')]
	const version = (/VERSION = '([^']+)'/.exec(engine) || [, '0.0.0'])[1]
	const hash = createHash('sha256').update(shellSources.join('\u0000')).digest('hex').slice(0, 10)
	const buildId = version + '-' + hash
	const swSource = await read('sw.js')
	const swOut = swSource.replace(/var BUILD = '[^']*'/, () => "var BUILD = '" + buildId + "'")
	if (swOut === swSource) throw new Error('未能在 sw.js 中注入构建标识 BUILD')
	await writeFile(path.join(dist, 'sw.js'), swOut, 'utf8')

	const html = await read('index.html')
	const css = await read('assets/style.css')
	const icon = await read('favicon.svg')
	const scripts = ['assets/yaml.js', 'assets/convert.js', 'assets/app.js']
	const iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(icon, 'utf8').toString('base64')

	let out = html
		.replace('<link rel="stylesheet" href="assets/style.css">', () => '<style>\n' + css + '</style>')
		.replace('<link rel="manifest" href="manifest.webmanifest">', () => '')
		.replace(/<link rel="icon"[^>]*>/, () => '<link rel="icon" href="' + iconUrl + '" type="image/svg+xml">')

	for (const rel of scripts) {
		const code = await read(rel)
		const tag = '<script src="' + rel + '"></script>'
		if (!out.includes(tag)) throw new Error('未在 index.html 中找到脚本引用：' + rel)
		out = out.replace(tag, () => '<script>\n' + code + '\n</script>')
	}

	const target = path.join(dist, 'clash2singbox-standalone.html')
	await writeFile(target, out, 'utf8')

	const sizeOf = async (rel) => (await stat(path.join(dist, rel))).size
	const metrics = {
		version,
		buildId,
		bytes: {
			engine: (await sizeOf('assets/yaml.js')) + (await sizeOf('assets/convert.js')),
			ui: (await sizeOf('index.html')) + (await sizeOf('assets/app.js')) + (await sizeOf('assets/style.css')),
			standalone: await sizeOf('clash2singbox-standalone.html')
		}
	}
	await writeFile(path.join(dist, 'build-meta.json'), JSON.stringify(metrics, null, 2) + '\n', 'utf8')
	const kib = (n) => (n / 1024).toFixed(1)
	console.log('dist/                              ← 可直接部署的静态站点')
	console.log('Service Worker 缓存名                 clash2singbox-' + buildId)
	console.log('引擎 / UI / 单文件                     ' + kib(metrics.bytes.engine) + ' / ' + kib(metrics.bytes.ui) + ' / ' + kib(metrics.bytes.standalone) + ' KiB')
	console.log('构建指标                               dist/build-meta.json')
}

main().catch((error) => {
	console.error(error.message)
	process.exit(1)
})
