# Clash2SingBox

纯前端、零依赖、零构建的 **Clash / mihomo YAML → sing-box JSON** 可视化转换器。解析、转换、校验全部在浏览器本地完成，配置不上传、不落盘、不请求任何接口。

- 全站无第三方运行时依赖与 CDN；`node build.mjs` 会在 `dist/build-meta.json` 自动记录引擎、界面与单文件离线版的实际体积，避免 README 数字漂移。
- 1000 节点 + 5000 条规则实测 **114 ms**（含伪节点过滤、地区识别与全量结构自检）。
- CI 真实校验：**sing-box 1.11.15（legacy）/ 1.12.15 / 1.13.18 / 1.14.0-beta.14**；兼容范围以 CI 固定版本与官方 `sing-box check` 为准。

---

## 两种输出模式

顶部一栏二选一，互不干扰：

| 模式 | 输出 | 用途 |
| --- | --- | --- |
| **节点 JSON** | `[{ "type": "anytls", "tag": "...", ... }, ...]` 纯出站数组 | 粘贴进客户端节点列表、分享节点、做节点库 |
| **完整配置** | `{ "log", "dns", "inbounds", "outbounds", "endpoints", "route", "experimental" }` | 直接作为 sing-box `config.json` 使用 |

节点模式只做「协议字段映射」这一件事：不产生 `selector` / `urltest` / `direct` / `block`，不写 `dns` / `inbounds` / `route`，输出节点数与源文件里的真实节点严格一一对应（WireGuard 仍以 endpoint 对象形式排在数组末尾）。

### 输出风格：完整 / Minimal

| 风格 | 行为 |
| --- | --- |
| 完整（默认） | 忠实保留所有可映射字段，包含与 sing-box 默认值相同的显式字段（如 AnyTLS 的 `idle_session_check_interval: "30s"`、`idle_session_timeout: "30s"`、`min_idle_session: 0`），便于逐字段核对与排错 |
| Minimal | 省略与 sing-box 默认值一致的字段，结果更接近社区常见的节点 JSON，便于分享 |

Minimal 只删除「等于默认值」的字段，**不会**删除 `password`、`uuid`、`tls.server_name`、`tls.utls`、`tls.reality` 等任何有效信息。

---

## 节点名与订阅伪节点

**默认忠实保留原名。** `Panel：www.example.com` 输出仍是 `Panel：www.example.com`，不会被自作主张改成 `🇦🇲 Panel：…`。

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| 过滤订阅信息节点 | 开 | 把「剩余流量：121.03 GB」「套餐到期：2030-03-08」这类伪节点排除在外 |
| 保留原节点名称 | 开 | 关闭后才会做名称清洗 |
| 保留 TLS 指纹 | 开 | 关闭后不输出 `tls.utls` |
| 自动补全国家/地区旗帜 | **关** | 独立开关，与协议转换完全解耦；开启后只在识别到地区时前置旗帜，不改动名称本体 |

过滤采用**分级关键词**，不是粗暴匹配：

- **强关键词**（剩余流量、套餐到期、过期时间、重置、订阅、官网、最新地址、Traffic / Expire / Reset / Subscription / Website / Official …）直接判定。
- **弱关键词**（流量、套餐、到期…）需同时出现数字与单位/日期/冒号上下文才判定，因此「大流量套餐节点 07」这类**真节点不会被误删**。
- 过滤不是硬删除：可随时关闭，过滤数量在统计区以「已过滤」展示，被过滤的名字逐条列在诊断抽屉里。
- 完整配置模式下，被过滤的节点会同步从代理组成员中移除，不会留下悬空引用。

---

## 导入报错对照

| 报错 | 客户端 | 原因 | 处理 |
| --- | --- | --- | --- |
| `Failed to update subscription […]. Reason: Not a valid subscription data` | GUI.for.SingBox | 订阅内容是**裸数组** `[ {…} ]`，该客户端的订阅解析器只认顶层带 `outbounds` 键的对象 | 在「节点 JSON 形态」里选 `{ "outbounds": [ … ] }` 后重新导出 |
| 导入后无法启动 / 提示缺少 inbounds、route | SFA / SFI / SFM | 把「节点 JSON」当成配置文件导入了，节点数组不是完整配置 | 改用「完整配置」模式导出 `config.json` |
| `decode config: json: unknown field …` | 全平台 | 内核版本低于输出目标 | 「目标内核」选 `sing-box 1.11 旧版兼容`，或升级客户端 |
| 节点列表里出现 `剩余流量`、`到期时间`、`https://…` 等条目 | 全平台 | 机场把公告当节点下发 | 保持「过滤订阅信息节点」开启（默认开）；`Panel：www.…` 这类按规范**默认忠实保留**，需要剔除请在源 YAML 里删除 |

---

## 特性

- **三档内部输出剖面**：`1.11 legacy`、`1.12–1.13 modern`（默认稳定档）与 `1.14+ latest`；1.14+ 会使用 HTTP Client 机制并避免输出已弃用的 `download_detour`。
- **客户端预设**：通用 / SFA（Android）/ SFI・SFM（iOS、macOS）/ sing-box 桌面版 / GUI.for.SingBox，自动适配 TUN 栈与 `strict_route` 等平台差异。
- **全协议覆盖**：Shadowsocks（含 2022-blake3、obfs、v2ray-plugin、ShadowTLS）、VMess、VLESS（Reality + Vision）、Trojan、Hysteria、Hysteria2（含端口跳跃）、TUIC v5、AnyTLS、WireGuard（endpoints）、SSH、HTTP、SOCKS、直连。
- **传输层完整映射**：WebSocket（含 `?ed=` early-data）、gRPC、HTTP/2、HTTPUpgrade、TCP-HTTP 伪装、uTLS 指纹、ECH、Multiplex（含 Brutal 限速）。
- **规则引擎**：20+ 种 Clash 规则类型、`AND/OR/NOT` 逻辑规则、端口区间、进程匹配；GEOSITE/GEOIP 自动转为 `.srs` 远程规则集，相邻同目标规则自动合并。
- **DNS 完整重建**：FakeIP、分流解析、hosts 预定义、fake-ip-filter、`domain_resolver` 引导链。
- **内置结构自检**：悬空出站引用、重复标签、无效规则集、空代理组、无效 `route.final` 全部自动修正或报告，并以分级诊断（错误 / 警告 / 提示）展示。
- **体验细节**：拖放导入、子线程转换不阻塞界面、十万行 JSON 虚拟渲染、亮暗主题、全快捷键、PWA 离线可用、移动端底部面板、尊重 `prefers-reduced-motion`。

---

## 快速开始

```bash
npx serve .          # 仓库根目录即站点根目录，无需安装、无需构建
node build.mjs       # 生成 dist/ 与 dist/clash2singbox-standalone.html
```

> 直接双击 `index.html`（`file://`）也可使用，此时自动退回主线程转换（浏览器不允许 `file://` 创建 Worker）。

---

## 部署

三大平台均为 **零配置静态部署**，不需要 Node 运行时、不需要云函数。

| 平台 | 关键设置 | 内置文件 |
| --- | --- | --- |
| **Vercel** | Framework Preset 选 Other，Build Command 留空，Output Directory 填 `.` | `vercel.json`（安全头 + CSP + 缓存） |
| **Cloudflare Pages** | Build command 留空，Build output directory 填 `/` | `_headers` |
| **GitHub Pages** | Settings → Pages → Source 选 GitHub Actions | `.github/workflows/ci.yml`、`.nojekyll` |

```bash
npx vercel deploy --prod
npx wrangler pages deploy .
```

所有资源引用均为相对路径，部署在 `https://user.github.io/repo/` 子路径下也能正常工作。

---

## 客户端兼容矩阵

| 客户端 | 内核 | 推荐目标 | 说明 |
| --- | --- | --- | --- |
| sing-box for Android（SFA） | 1.12+ | `1.12–1.13` / `1.14+` | 预设选 SFA；TUN 栈 `system` |
| sing-box for iOS（SFI） | 1.12+ | `1.12–1.13` / `1.14+` | 预设选 SFI/SFM；TUN 栈 `gvisor`，不下发 `strict_route` |
| sing-box for macOS（SFM） | 1.12+ | `1.12–1.13` / `1.14+` | 同上 |
| sing-box 桌面版 / CLI | 1.12+ | `1.12–1.13` / `1.14+` | 预设选桌面版；开启 `strict_route` |
| GUI.for.SingBox | 跟随内核 | `1.12–1.13` / `1.14+` | 预设选 GUI；保留 Clash API 供面板接管 |
| NekoBox / Hiddify 等旧内核 | 1.11 | `1.11 旧版兼容` | 输出 legacy DNS 字段与 `fakeip` 块 |

> 两套剖面均不使用已在 1.13 移除的 `block`/`dns` 出站，也不使用已在 1.12 移除的 `geosite`/`geoip` 规则字段。

---

## 协议字段映射

以下为逐字段对照（左：Clash / mihomo，右：sing-box）。源配置里的有效信息一律不丢弃。

### 公共字段

`name → tag`、`type → type`、`server → server`、`port → server_port`、`udp →`（sing-box 默认支持，不需字段）、`ip-version → domain_strategy`、`dialer-proxy → detour`、`interface-name → bind_interface`、`routing-mark → routing_mark`。

### TLS 公共块

| Clash | sing-box |
| --- | --- |
| `tls: true` / 协议隐含 | `tls.enabled: true` |
| `sni` / `servername` | `tls.server_name` |
| `skip-cert-verify` | `tls.insecure` |
| `alpn` | `tls.alpn` |
| `client-fingerprint` | `tls.utls: { enabled: true, fingerprint }` |
| `reality-opts.public-key` / `.short-id` | `tls.reality: { enabled: true, public_key, short_id }` |
| `ech-opts` | `tls.ech` |
| `ca-str` / `certificate` | `tls.certificate` |

### AnyTLS

| Clash | sing-box | 备注 |
| --- | --- | --- |
| `password` | `password` | |
| `sni` | `tls.server_name` | |
| `skip-cert-verify` | `tls.insecure` | |
| `alpn` | `tls.alpn` | |
| `client-fingerprint: chrome` | `tls.utls: { enabled: true, fingerprint: "chrome" }` | 完整保留，不因参考 JSON 里没有就丢掉 |
| — | `idle_session_check_interval` / `idle_session_timeout` / `min_idle_session` | 完整风格下显式写出 `30s` / `30s` / `0`，Minimal 风格省略 |

### VLESS（含 Reality + XTLS Vision）

| Clash | sing-box |
| --- | --- |
| `uuid` | `uuid` |
| `flow: xtls-rprx-vision` | `flow: "xtls-rprx-vision"` |
| `packet-encoding` | `packet_encoding`（`xudp` / `packetaddr`） |
| `servername` | `tls.server_name` |
| `reality-opts` | `tls.reality.{enabled,public_key,short_id}` |
| `client-fingerprint` | `tls.utls.{enabled,fingerprint}` |
| `network` + `ws-opts` / `grpc-opts` / `h2-opts` | `transport` |

### 其他协议

| Clash | sing-box | 关键字段 |
| --- | --- | --- |
| `ss` | `shadowsocks` | `cipher → method`、`password`、`plugin: obfs → obfs-local` + `plugin_opts: "obfs=http;obfs-host=..."`、`v2ray-plugin`、`shadow-tls` → 自动生成 `shadowtls` 前置链 |
| `vmess` | `vmess` | `uuid`、`alterId → alter_id`（为 0 时省略）、`cipher → security`、`global-padding`、`authenticated-length` |
| `trojan` | `trojan` | `password` + TLS 块 + `transport` + `smux → multiplex` |
| `hysteria` | `hysteria` | `auth-str → auth_str`、`up`/`down` 带宽归一、`obfs`、`recv-window` |
| `hysteria2` | `hysteria2` | `password`、`up → up_mbps`、`down → down_mbps`、`obfs` + `obfs-password → obfs: { type: "salamander", password }`、`ports → server_ports` |
| `tuic` | `tuic` | `uuid`、`password`、`congestion-controller → congestion_control`、`udp-relay-mode`、`heartbeat-interval` 毫秒→`Ns`、`reduce-rtt → zero_rtt_handshake` |
| `wireguard` | `endpoints[].wireguard` | `ip`/`ipv6 → address[]`、`private-key`、`peers[].{address,port,public_key,pre_shared_key,reserved,allowed_ips}`、`mtu`（1.11 目标下降级为出站并告警） |
| `socks5` | `socks` | `version: "5"`、`username`、`password` |
| `http` | `http` | `username`、`password`、`headers`、TLS 块 |
| `ssh` | `ssh` | `username`、`password`、`private-key`、`host-key` |
| `ssr` / `snell` / `mieru` | — | sing-box 不支持，跳过并报错提示 |

---

## 代理组与路由

| Clash | sing-box |
| --- | --- |
| `select` | `selector` |
| `url-test` ・ `fallback` ・ `load-balance` | `urltest`（sing-box 无 fallback/负载均衡类型，降级并提示） |
| `relay` | 链式 `detour` |
| `DIRECT` | `direct` 出站 |
| `REJECT` ・ `REJECT-DROP` | 路由动作 `{ "action": "reject" }` |
| `DOMAIN` / `-SUFFIX` / `-KEYWORD` / `-REGEX` | `domain` / `domain_suffix` / `domain_keyword` / `domain_regex` |
| `IP-CIDR` / `IP-CIDR6` | `ip_cidr` |
| `SRC-IP-CIDR` / `SRC-PORT` / `DST-PORT` | `source_ip_cidr` / `source_port` / `port`（自动识别区间） |
| `PROCESS-NAME` / `PROCESS-PATH` | `process_name` / `process_path` |
| `NETWORK` / `IN-TYPE` / `IN-USER` | `network` / `inbound` / `auth_user` |
| `GEOSITE` / `GEOIP` / `RULE-SET` | `rule_set` + 自动注册远程 `.srs` |
| `AND` / `OR` / `NOT` | 嵌套 `rules` + `invert` |
| `MATCH` / `FINAL` | `route.final` |

### DNS

| Clash | sing-box（1.12+） |
| --- | --- |
| `dns.nameserver` | 主 DNS 服务器（`type: udp/tls/https/quic/h3`） |
| `dns.fallback` / `proxy-server-nameserver` | 代理侧 DNS，`detour` 指向代理出站 |
| `dns.direct-nameserver` | 直连解析服务器 |
| `dns.enhanced-mode: fake-ip` | `type: fakeip` 服务器 + `inet4_range` |
| `dns.fake-ip-filter` | FakeIP 旁路规则 |
| `dns.nameserver-policy` | DNS 规则（域名→指定服务器） |
| `hosts` | `predefined` 服务器 |

---

## 选项与快捷键

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| 输出模式 | 完整配置 | 节点 JSON（纯数组）/ 完整配置（可直接跑） |
| 输出风格 | 完整 | 完整 / Minimal（省略默认值字段） |
| 目标版本 | 1.12–1.13 | 可切换 1.11 legacy / 1.12–1.13 stable / 1.14+ latest 输出剖面 |
| 客户端预设 | 通用 | 一键适配 SFA / SFI・SFM / 桌面 / GUI |
| TUN 栈 | 自动 | 自动 = Apple 平台强制 `gvisor`，其余跟随源 `tun.stack` |
| FakeIP | 开 | 关闭后自动为 IP 类规则插入 `resolve` 动作 |
| 规则集源 | jsDelivr | jsDelivr / GitHub / SagerNet / 自定义模板（`{kind}`、`{name}`） |
| 合并规则 | 开 | 相邻同目标同类型规则合并 |
| Clash API | 开 | 为 GUI 面板保留 `experimental.clash_api` |

快捷键（与代码一致）：`Ctrl/⌘ + Enter` 转换・`Ctrl/⌘ + S` 下载・`Ctrl/⌘ + K` 复制・`Ctrl/⌘ + O` 选文件・`Ctrl/⌘ + D` 切主题・`Esc` 依次关闭「移动端设置面板 → 拖放遮罩 → 诊断抽屉」。

移动端（宽度 ≤ 900px）顶栏为 `[转换] [⚙ 设置]`，设置以底部面板（Bottom Sheet）弹出，带遮罩、可下拉、尊重安全区，不再把选项堆在正文上方。

宽屏（≥ 901px）同一个 `⚙ 设置` 用于整列收起 / 展开侧栏：收起后那 270px 全部让给编辑器与输出，选择写入 `localStorage`（`c2s.rail`）下次打开沟保持。侧栏自身可独立滚动，标题栏（`转换选项` 与 `恢复默认`）sticky 吸顶。

---

## 测试与校验

```bash
node tests/run.js        # 核心结构 / 转换 / 选项矩阵回归
node tests/smoke.js      # 43 项输出模式与节点适配冒烟
node tests/fixtures.js   # 10 组真实 Fixture 语义比对
node tests/check.js      # 生成并离线校验多档目标配置；--emit 可供官方 CLI 复核
node tests/features.js   # 新能力与版本边界回归（含 1.14 HTTP Client）
node tests/schema.js     # 项目自维护的字段级 / 引用完整性校验
node build.mjs && node tests/layout.js   # 9 种视口的无头布局回归
node tests/e2e.js                    # 81 项前端端到端回归（桌面 / 单文件 / 414px 手机三个目标，真实点击·穿层命中·折叠·通知）
node tests/check.js --emit .ci-configs   # 导出供 sing-box check 使用的配置
```

**Fixture 语义比对**：`fixtures/<协议>.yaml` 与 `fixtures/<协议>.expected.json` 成对存放（anytls、vless-reality、vmess-ws、trojan、shadowsocks、hysteria2、tuic、socks-http、wireguard、info-nodes）。`tests/fixtures.js` 先把两边都 `JSON.parse`，再做**递归对象比较**（键顺序无关），失败时打印第一个不一致的 JSON 路径，不做字符串 diff。

**官方校验链**：`tests/schema.js` 继续负责快速离线字段/引用完整性检查，但不冒充官方校验。CI 会分别生成 `legacy11 / modern13 / latest14` 配置：用 sing-box **1.11.15 / 1.12.15 / 1.13.18 / 1.14.0-beta.14** 执行真实 `sing-box check -c`；1.14 任务还会运行 `sing-box schema -o` 生成当前二进制对应的官方 Draft 2020-12 Schema，再用 `tests/official_schema.py` 逐份验证 `latest14` 配置。浏览器 E2E 与核心/CLI 校验拆成独立 Job，最终 GitHub Pages **只有在所有关键 Job 全部通过后才允许部署**。本地没有 sing-box 时仍可用 `node tests/check.js` + `node tests/schema.js` 做离线预检。

---

## 已知限制

- **proxy-providers**：内联 `payload` 会被展开为真实节点（支持集合级 `filter` / `exclude-filter`）；带 `url` 的**远程订阅拉不到**，会在报告里给出 error，并回退为本地节点填充（不会产生空组）。
- **RULE-SET 必须是 .srs**：命中内置对照表或官方 geo 名录的会替换为等价 `geosite`/`geoip`；其余文本 / YAML / MRS 规则集会**跳过并告警**（不伪造 404 地址）。
- **字面无法映射的规则**：`IP-ASN`、`IP-SUFFIX`、`SCRIPT`、`DSCP` 等逐条告警后跳过。
- **SUB-RULE 已支持**：展开为 `logical`(and) 规则；仅**嵌套** SUB-RULE（子规则里再写 SUB-RULE）不支持，会告警跳过。
- **listeners / tunnels / script**：无对应语义，告警后不转换。
- **输入体量上限**：单次输入超过 **8 MB** 会被拒绝（避免浏览器卡死），典型机场配置远低于该值。
- **协议缺口**：`ssr`（sing-box 1.6 已删除）、`snell`、`mieru`、`rc4-md5` 等已移除加密无法转换。
- **策略组语义差异**：`fallback` 与 `load-balance` 均降级为 `urltest`。
- **`sing-box check` 需官方二进制**：本仓库开发时无法运行它（无网络、无二进制），只在 CI 中执行；本地以 `tests/schema.js`（字段级 schema）+ `tests/check.js`（结构）作为近似替代。

---

## 隐私与安全

全部转换在浏览器内完成，**不上传、不存储、无后端**；只有界面选项与主题会写入 `localStorage`，配置正文从不落盘。

`_headers` 与 `vercel.json` 下发的安全头（两者完全一致，与本节描述逐字对应）：

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

说明：未下发 `X-Frame-Options`，嵌套防护由 CSP `frame-ancestors 'none'` 提供（现代浏览器等效）。`/assets/*` 缓存 `public, max-age=86400`，`/sw.js` 为 `no-cache`。

**单文件版与 CSP：** `dist/clash2singbox-standalone.html` 把 CSS/JS 内联到 HTML 里，因此与仓库内的 `script-src 'self'; style-src 'self'`（无 `unsafe-inline`）**相冲突**。它的定位是 `file://` 本地离线使用，此时不受该头约束；若一定要托管，请二选一：推荐直接部署多文件的 `dist/`，或仅为该单文件路径放宽为 `script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'`。

**Service Worker：** 缓存名为 `clash2singbox-<版本>-<内容哈希>`（如 `clash2singbox-1.2.0-be71210e7b`），由 `build.mjs` 根据壳文件 SHA-256 在构建时注入，发布新版本必定换缓存、旧壳自动清除。

---

## 目录结构

```
index.html                # 单页面壳
assets/
  yaml.js                 # 零依赖 YAML 解析器
  convert.js              # 转换引擎（解析 → 节点 → 过滤/命名 → 分组 → 规则 → DNS → 输出适配 → 自检）
  worker.js               # Web Worker 包装（失败自动回退主线程）
  app.js                  # 界面逻辑、虚拟渲染、高亮、快捷键、移动端面板
  style.css               # 设计系统与动效
fixtures/                 # 10 组 <协议>.yaml + <协议>.expected.json
tests/
  fixture.yaml            # 覆盖全协议的基准配置
  run.js                  # 核心回归断言
  smoke.js                # 43 项输出模式冒烟
  fixtures.js             # Fixture 语义比对
  check.js                # 离线结构校验 + CI 配置导出
build.mjs                 # dist/ + 单文件构建（并注入 SW 构建哈希）
.github/workflows/        # ci.yml（测试 + sing-box check 矩阵 + Pages 部署）
vercel.json / _headers    # 平台安全头与缓存策略
sw.js / manifest.webmanifest
```

---

## 许可证

MIT © 2026 works。本工具仅做配置格式转换，不附带、不分发任何节点或订阅。

---

## 1.3.6 修订记录

- **发布 Gate 闭环**：移除独立 `deploy-pages.yml`，Pages 部署改为 `ci.yml` 最终 Job；核心、浏览器、1.11、1.12/1.13、1.14 官方校验任一失败都不会上线。
- **1.14+ 独立能力档**：新增 `latest` 目标；远程规则集使用 `http_clients` + `route.default_http_client`，不再输出 1.14 已弃用的 `download_detour`，并添加官方 `$schema`。
- **官方双重校验**：1.14 CI 同时执行 `sing-box schema` + Draft 2020-12 Schema 校验与真实 `sing-box check`；固定版本更新至 1.13.18 / 1.14.0-beta.14。
- **CI 解耦与防卡死**：核心、浏览器、CLI 校验分 Job；Chrome 探测和 E2E/Layout 子进程增加 timeout，Job 本身也有超时上限。
- **构建可信度**：新增 `tests/dist.js` 防止源码与 `dist/` 漂移；构建体积写入 `dist/build-meta.json`，不再手写 README 体积数字。
- **文档清理**：修正 `sync-box` / `拒绍启动` 等 typo，去掉容易过期的固定测试数量。

## 1.3.5 修订记录

- **移除全部面板折叠**，改为三栏手动分割：侧栏｜输入｜输出 之间各有一条可拖拽分割条，支持拖拽、方向键 ±16px（Shift ±48px）、Home 与双击复位，宽度写入 `c2s.split`；≤900px 自动隐藏并回退为上下堆叠。
- **统计条去掉折叠按钮并扩容**：新增「出站 / DNS / 跳过」三项，并补一条元信息（内核目标 · 客户端 · 输出形态／落地出站与规则条数）。
- **深色模式原生滚动条修复**：为 `:root[data-theme]` 显式声明 `color-scheme`，并统一 `html / body / textarea` 滚动条配色，白色滚动条不再出现在深色界面里。
- **节点 JSON 形态新增「自动（跟随客户端）」并设为默认**：GUI.for.SingBox 输出 `{"outbounds": […]}`，其余客户端输出纯数组。
- **首次访问按设备自动匹配客户端预设**（Android → SFA，iOS / macOS → SFI / SFM，Windows / Linux → 桌面版），仅在用户未手动选择过时生效。
- **规则识别精度**：`DOMAIN-REGEX` / `PROCESS-PATH-REGEX` 保留 `(?i)`（Go RE2 支持内联标记，此前被剔除会改变语义）；Android 包名走 `package_name`；`SRC-GEOIP,LAN/PRIVATE` → `source_ip_is_private`；`NETWORK-TYPE` → `network_type`；`IN-TYPE` 只指向真实存在的入站，其余明确告警跳过。

## 1.3.4 修订记录

围绕“其他设备版本是否也验证过”补齐的一轮：

- **设备 × 内核双维矩阵校验**：`universal / android / apple / desktop / gui` 五个预设，分别在 sing-box 1.12+ 与 1.11 两个目标下全量校验（原先只按 1.12+ 遍历预设）。
- **1.11 目标不兼容告警**：选择 1.11 时直接在诊断区给出提醒并附一键「切到 1.12+」——因为 1.11 必须保留的 `detour: "direct"` 正是 1.12+ 拒绝启动的写法，而 SFA / SFI / SFM / GUI 现行版本多为 1.12+。
- **CI 拆分为两个校验任务**：1.12+ 配置交给 `1.12.15 / 1.13.16 / 1.14.0-beta.4`；1.11 目标配置单独落盘到 `.ci-configs/legacy11/` 并交给 `1.11.15` 校验，避免新内核误判 legacy 配置。
- **设备差异回归**：apple 预设强制 gvisor 栈、不下发 `strict_route`；desktop / gui 下发 `strict_route`；android 不下发；五个预设均断言 `tun.auto_route` 已开启且输出中不存在指向空 direct 出站的 detour。

## 1.3.3 修订记录

- **修复 sing-box for Android / iOS / macOS 启动失败（致命）**：内核报 `start dns/udp[dns-resolver]: detour to an empty direct outbound makes no sense`。sing-box 1.12+ 的新式 DNS 服务器本身就等价于「空 direct 出站」拨号器，再写 `detour: "direct"` 会被判定为无意义并直接拒绝启动。
- 1.12+ 目标不再输出这类 detour，覆盖 `dns.servers[].detour`、`route.rule_set[].download_detour`、`outbounds[].detour`、`endpoints[].detour` 四处。
- 1.11（legacy）目标保持 `detour: "direct"` 不变：旧内核的默认出站并非直连，去掉会让引导 DNS 走代理甚至成环。
- 仅当 direct 出站为纯空壳（只有 type / tag）时清理；若它带有拨号字段则 detour 合法并保留。用户指向代理组的 detour（`nameserver-policy` / `fallback` / `dialer-proxy`）完全保留。
- 离线校验器 `tests/schema.js` 与内置自检 `validate()` 新增该规则；`tests/features.js` 新增 6 项回归。
- 修正 `tests/run.js` 中两条把错误行为当成预期的断言（它们是这次事故未被拦下的直接原因）。

## 1.3.2 修订记录

- **诊断区改为通知式提醒**：零问题时不再常驻一块占位文案（原「未发现问题，配置可直接使用。」），改为右下角轻量通知 3.2 秒自动消失；有问题时通知带「查看诊断」动作，诊断抽屉保持收起不抢占空间。
- **诊断示例默认折叠**：错误 / 警告的示例节点收进「示例 N 项」折叠条，展开后在 92px 内滚动，不再一次撑开三行长文本。
- **一键切换目标内核**：检测到「AnyTLS 需要 sing-box 1.12+」这类因旧核目标被跳过的节点时，通知与诊断行内直接给出「切到 1.12+」按钮，一次点击恢复全部节点。
- **各板块可折叠**：输入面板 / 输出面板 / 统计条均可折叠；桌面端面板收为 46px 竖排标题条且两侧互斥（折叠一侧另一侧自动占满），手机端收为标题行；状态写入 localStorage（c2s.fold）。
- **视觉统一**：折叠按钮、通知、诊断示例条、修复按钮共用同一套圆角 / 描边 / 悬停 / 180° 箭头旋转规则。
- **端到端回归扩到 81 项**：新增折叠尺寸与横向溢出、折叠持久化、零问题无占位块、通知存在性、示例默认折叠、旧核跳过与一键修复共 8 项 × 3 个目标。

## 1.3.1 修订记录

- **彻底消除选项栏穿层**：原本表头用 `position: sticky` 放在滚动容器**内部**，会被同级卡片与开关的堆叠上下文压穿（桌面、手机 Bottom Sheet 都会）。现改为**结构隔离**：`.rail` 不再滚动（`overflow: hidden`），新增 `.rail-body` 独立滚动区，表头在滚动区**之外**——穿层在物理结构上不可能发生。
- **新增穿层命中测试**：`tests/e2e.js` 用 `document.elementFromPoint()` 在滚动 600px 后对表头中心做命中判定，并验证滚动发生在内容区而非整栏；新增 **414px 手机目标**，共 57 项断言。
- **客户端选项在两种模式下统一保留**：节点 JSON 模式不再隐藏「客户端」，并与节点 JSON 形态**联动**——选 GUI.for.SingBox 自动切为 `{"outbounds": [ … ] }`，其余客户端切为数组；用户手动改过形态后不再自动覆写。
- **协议分布重做**：原来是一组无标注的柱状色块（单一协议时退化成一个蓝方块，不知所云），改为可读胶囊：圆点 + 协议名 + 节点数，最多 8 项，悬停高亮。
- **滚动条统一细化**：选项区 / 代码区 / 诊断抽屉统一为 10px 透明轨道 + 圆角滑块，不再出现糗粙的系统默认滚动条。
- **手机 Bottom Sheet 优化**：头部固定不随内容滚动，新增顶部拖拽条（drag handle），内容区带 `env(safe-area-inset-bottom)` 安全区内边路。

## 1.3.0 修订记录

- **修复致命前端回归**：`assets/app.js` 在初始化尾部误用了不在作用域内的 `$()`，抛 `ReferenceError` 后导致**其后所有事件绑定全部失效**（输出模式切换、侧边栏开关、问题面板展开、全部快捷键），表现为“只能输出完整配置”。已修正并用端到端测试锂住。
- **新增 `tests/e2e.js`**：无头 Chromium 里对 `dist/index.html` 与单文件版**真实点击**（粘贴 → 切节点 JSON → 切形态 → 切回完整配置 → 再切回），共 30 项断言；启动期异常也会被捕获（探针在 app.js 之前就挂上 `error` 监听）。已并入 CI。

- **节点 JSON 新增 `{"outbounds": […]}` 形态**：GUI.for.SingBox 等客户端的订阅解析器不接受裸数组，会报 `Not a valid subscription data`；现在可在「节点 JSON 形态」里一键切换。
- **链接型伪节点识别**：节点名含 `http(s)://` 的公告条目会被识别为伪节点（仍可关闭过滤）；`Panel：www.…` 按规范默认忠实保留，不擅自删除。
- **proxy-providers 真正落地**：内联 `payload` 展开为真实节点，支持集合级 `filter` / `exclude-filter`；代理组的 `use:` 只拉入**被引用集合**的节点，不再无差别填入全部节点。
- **远程集合显式报错**：拉不到的 `url` 集合会同时给出 error + warn，并回退为本地节点填充，避免空组导致 sing-box 启动失败。
- **sub-rules / SUB-RULE 支持**：`SUB-RULE,(条件),子规则名` 展开为 `logical`(and)；子规则里的 `MATCH` 继承外层条件，`REJECT` 转为 `reject` 动作；缺失与嵌套情况精确告警。
- **全局 `interface-name` / `routing-mark`**：写入 `route.default_interface` / `route.default_mark`，并自动去掉与之互斥的 `auto_detect_interface`。
- **未转换字段不再静默**：`listeners` / `tunnels` / `script` 逐项告警。
- **输入体量保护**：超过 8 MB 的粘贴或文件直接拒绝并提示，不再把主线程 / Worker 托死。
- **底部面板可访问性**：移动端设置面板带 `role="dialog"` + `aria-modal`，打开自动聚焦、Tab 焦点陷阱、关闭后焦点归还触发按钮。
- **新增三套测试**：`tests/features.js`（37）、`tests/schema.js`（33 份配置的字段级 schema）、`tests/layout.js`（9 种视口），全部并入 CI。
- 诚实声明：官方 `sing-box check` 从未在开发环境跑过（无网络、无二进制），只能由 CI 完成。

---

## 1.2.0 修订记录

- **新增纯节点 JSON 输出模式**，与完整配置模式在顶部二选一；节点模式下不再产生任何策略组与路由块。
- **协议字段映射逐项核对**：AnyTLS/VLESS Reality 的 `tls.utls`、`tls.reality`、`flow`、`packet_encoding` 全量保留，不再因参考 JSON 缺字段而丢弃源信息。
- **新增 Minimal 风格**，只省略等于 sing-box 默认值的字段。
- **新增订阅信息伪节点分级过滤**（可关闭、不误删真节点、同步清理分组成员）。
- **tag 默认忠实保留原名**，旗帜补全改为独立可选开关（默认关）。
- **新增真实 Fixture 语义比对与 CI `sing-box check` 版本矩阵**，断言总数 109 → 159，另增 43 项冒烟、10 组 Fixture、33 份配置校验。
- **修复重置后刷新旧配置重现**：重置现在同时覆写 `localStorage`，不再依赖转换回写。
- **移动端改为底部设置面板**，顶栏仅保留 `[转换] [⚙ 设置]`。
- **SW 缓存名带版本与构建哈希**；README 快捷键、安全头、兼容性表述均与代码/配置逐字对齐。
- **侧栏布局根因修复**：`.rail` 是定高的列向 flex 容器，子卡片默认 `flex-shrink: 1` 会被压扁，叠加 `.group { overflow: hidden }` 导致「入口 / 路由」等卡片在**所有宽度**下都被从中间裁断，而且侧栏 `scrollHeight === clientHeight` 根本不产生滚动，被裁内容无法触达。现以 `.rail > * { flex: 0 0 auto }` 根治。
- **取消隐式横向滚动**：底部统计条与协议芯片改为自动换行（原来 `overflow-x: auto` + `scrollbar-width: none`，在 1024 / 414 / 360 / 320px 下有 4–7 个元素冲出可视区且无滚动提示）；新增 ≤ 560px 断点处理顶栏与分段控件换行。
- **宽屏侧栏可整列收起**：`⚙ 设置` 在桌面端切换 `.shell.rail-off`，状态持久化；并修正 `自动补全国家/地区旗帜` 错别字。
- **布局回归实测**：1440 / 1280 / 1024 / 900 / 768 / 414 / 360 / 320px 八个宽度无头浏览器实测，卡片裁切数 0、横向溢出数 0、侧栏 `scrollHeight` 1500–1579 > 可视高度（可滚动）。
