# Clash2SingBox

纯前端、零运行时依赖的 **Clash / mihomo YAML → sing-box JSON** 可视化转换器。

解析、转换与校验全部在浏览器本地完成：**配置不上传、不存储，也不会请求第三方接口**。

- 支持节点 JSON 与完整 `config.json` 两种输出
- 覆盖 sing-box `1.11 legacy`、`1.12–1.13 stable` 和 `1.14+ latest`
- 支持常见代理协议、策略组、规则、DNS、FakeIP 与远程规则集
- 内置结构自检、分级诊断、Web Worker、虚拟渲染和 PWA 离线能力
- CI 使用官方 `sing-box check` 校验多个内核版本

> 项目基准：1000 个节点 + 5000 条规则约 **114 ms**。实际耗时取决于设备、浏览器和配置复杂度。

---

## 快速开始

无需安装依赖，也无需构建：

```bash
npx serve .
```

然后打开终端显示的本地地址。也可以直接双击 `index.html`；在 `file://` 环境下，应用会自动从 Web Worker 回退到主线程转换。

如需生成发布目录和单文件离线版：

```bash
node build.mjs
```

构建产物：

- `dist/`：适合静态托管的多文件版本
- `dist/clash2singbox-standalone.html`：适合本地离线使用的单文件版本
- `dist/build-meta.json`：自动记录构建版本与实际体积

---

## 使用方法

1. 粘贴 YAML，或将配置文件拖入输入区。
2. 选择输出模式、目标内核和客户端预设。
3. 点击 **转换**，检查诊断结果后复制或下载 JSON。

### 输出模式

| 模式          | 输出                                                                             | 适用场景                                 |
| ------------- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| **节点 JSON** | 纯出站数组，或 `{ "outbounds": [...] }`                                          | 导入客户端节点列表、分享节点、维护节点库 |
| **完整配置**  | 包含 `log`、`dns`、`inbounds`、`outbounds`、`endpoints`、`route`、`experimental` | 直接作为 sing-box `config.json` 使用     |

节点模式只映射真实节点，不生成策略组、路由、DNS、`direct` 或 `reject`。WireGuard 会以 endpoint 对象排在数组末尾。

### 输出风格

| 风格             | 说明                                                     |
| ---------------- | -------------------------------------------------------- |
| **完整**（默认） | 保留所有可映射字段，并显式输出部分默认值，便于核对和排错 |
| **Minimal**      | 仅省略与 sing-box 默认值相同的字段，适合分享             |

Minimal 不会删除 `password`、`uuid`、`tls.server_name`、`tls.utls`、`tls.reality` 等有效信息。

### 常用选项

| 选项             | 默认值      | 说明                                                     |
| ---------------- | ----------- | -------------------------------------------------------- |
| 目标内核         | `1.12–1.13` | 可切换 `1.11 legacy`、`1.12–1.13 stable`、`1.14+ latest` |
| 客户端预设       | 自动识别    | 适配 SFA、SFI/SFM、桌面版和 GUI.for.SingBox              |
| 过滤订阅信息节点 | 开          | 排除“剩余流量”“套餐到期”“订阅地址”等伪节点               |
| 保留原节点名称   | 开          | 默认不清洗或改写节点名                                   |
| 保留 TLS 指纹    | 开          | 保留 `tls.utls`                                          |
| 自动补全地区旗帜 | 关          | 仅在识别到地区时添加旗帜，不改动名称本体                 |
| FakeIP           | 开          | 关闭后自动为 IP 类规则补充解析动作                       |
| 合并规则         | 开          | 合并相邻、同目标、同类型规则                             |
| Clash API        | 开          | 保留 `experimental.clash_api` 供 GUI 面板接管            |

伪节点过滤使用分级关键词和上下文判断，不会仅凭“流量”“套餐”等弱关键词直接删除节点。过滤结果会显示在诊断区，且可随时关闭。

### 快捷键

| 快捷键           | 操作               |
| ---------------- | ------------------ |
| `Ctrl/⌘ + Enter` | 转换               |
| `Ctrl/⌘ + S`     | 下载               |
| `Ctrl/⌘ + K`     | 复制               |
| `Ctrl/⌘ + O`     | 选择文件           |
| `Ctrl/⌘ + D`     | 切换主题           |
| `Esc`            | 关闭当前浮层或面板 |

---

## 功能概览

- **协议转换**：Shadowsocks、VMess、VLESS、Trojan、Hysteria、Hysteria2、TUIC、AnyTLS、WireGuard、SSH、HTTP、SOCKS 等。
- **传输与 TLS**：WebSocket、gRPC、HTTP/2、HTTPUpgrade、TCP-HTTP、uTLS、Reality、ECH、Multiplex 和 Brutal。
- **策略组**：`select → selector`，`url-test/fallback/load-balance → urltest`，`relay → detour` 链。
- **规则引擎**：支持常见域名、IP、端口、进程和入站规则，以及 `AND` / `OR` / `NOT`、`MATCH` / `FINAL`。
- **DNS 重建**：支持 FakeIP、分流解析、hosts、fake-ip-filter、nameserver-policy 和 `domain_resolver` 引导链。
- **结构自检**：检测并修复重复标签、悬空引用、空代理组、无效规则集和无效 `route.final`。
- **大配置体验**：Web Worker 转换、十万行 JSON 虚拟渲染、拖放导入、响应式布局、亮暗主题和 PWA 离线使用。

### 协议与关键映射

| Clash / mihomo            | sing-box                 | 关键字段                                             |
| ------------------------- | ------------------------ | ---------------------------------------------------- |
| `ss`                      | `shadowsocks`            | `cipher → method`、插件、ShadowTLS 前置链            |
| `vmess`                   | `vmess`                  | `uuid`、`alterId → alter_id`、`cipher → security`    |
| `vless`                   | `vless`                  | Reality、XTLS Vision、`packet_encoding`、`transport` |
| `trojan`                  | `trojan`                 | TLS、传输层、Multiplex                               |
| `hysteria`                | `hysteria`               | 认证、带宽、obfs、接收窗口                           |
| `hysteria2`               | `hysteria2`              | 端口跳跃、带宽、Salamander obfs                      |
| `tuic`                    | `tuic`                   | 拥塞控制、UDP relay、心跳、0-RTT                     |
| `anytls`                  | `anytls`                 | TLS、uTLS、会话参数                                  |
| `wireguard`               | `endpoints[].wireguard`  | 地址、密钥、peer、MTU；1.11 目标会降级               |
| `socks5` / `http` / `ssh` | `socks` / `http` / `ssh` | 认证、TLS、私钥与 host key                           |

`ssr`、`snell`、`mieru` 等 sing-box 不支持的协议会被跳过，并在诊断区明确提示。

---

## 客户端兼容性

| 客户端                      | 推荐目标              | 预设行为                                            |
| --------------------------- | --------------------- | --------------------------------------------------- |
| sing-box for Android（SFA） | `1.12–1.13` / `1.14+` | TUN 栈使用 `system`                                 |
| sing-box for iOS（SFI）     | `1.12–1.13` / `1.14+` | TUN 栈使用 `gvisor`，不下发 `strict_route`          |
| sing-box for macOS（SFM）   | `1.12–1.13` / `1.14+` | 同 SFI                                              |
| sing-box 桌面版 / CLI       | `1.12–1.13` / `1.14+` | 开启 `strict_route`                                 |
| GUI.for.SingBox             | `1.12–1.13` / `1.14+` | 保留 Clash API；节点 JSON 默认使用 `outbounds` 包装 |
| NekoBox / Hiddify 等旧内核  | `1.11 legacy`         | 输出旧版 DNS 与 FakeIP 结构                         |

> 输出不会使用已在 sing-box 1.13 移除的 `block` / `dns` 出站，也不会使用已在 1.12 移除的 `geosite` / `geoip` 规则字段。

### 常见导入问题

| 现象                                                 | 原因                     | 处理方式                                      |
| ---------------------------------------------------- | ------------------------ | --------------------------------------------- |
| GUI.for.SingBox 提示 `Not a valid subscription data` | 导入了裸数组             | 将节点 JSON 形态改为 `{ "outbounds": [...] }` |
| 导入后缺少 `inbounds` 或 `route`                     | 把节点 JSON 当成完整配置 | 改用“完整配置”模式                            |
| `unknown field ...`                                  | 客户端内核低于输出目标   | 选择 `1.11 legacy`，或升级客户端              |
| 节点列表出现流量、到期时间或订阅地址                 | 机场将公告作为节点下发   | 保持“过滤订阅信息节点”开启                    |

---

## 静态部署

项目不需要 Node.js 运行时或云函数，仓库根目录即可作为站点根目录。

| 平台                 | 配置                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| **Vercel**           | Framework Preset 选择 `Other`；Build Command 留空；Output Directory 填 `.` |
| **Cloudflare Pages** | Build command 留空；Build output directory 填 `/`                          |
| **GitHub Pages**     | Settings → Pages → Source 选择 `GitHub Actions`                            |

```bash
npx vercel deploy --prod
npx wrangler pages deploy .
```

## 已知限制

- 远程 `proxy-providers` 无法在纯前端环境中直接拉取；内联 `payload` 可正常展开。
- `RULE-SET` 必须是 `.srs`；无法可靠映射的文本、YAML 或 MRS 规则集会跳过并告警。
- `IP-ASN`、`IP-SUFFIX`、`SCRIPT`、`DSCP` 等无直接对应语义的规则会跳过并告警。
- `SUB-RULE` 支持一层展开，不支持嵌套 `SUB-RULE`。
- `listeners`、`tunnels` 和 `script` 无对应语义，不会转换。
- `fallback` 与 `load-balance` 会降级为 `urltest`。
- 单次输入上限为 **8 MB**，用于避免浏览器因超大配置失去响应。
- 本地未安装 sing-box 时，`tests/schema.js` 与 `tests/check.js` 只能作为离线预检，不能替代官方 `sing-box check`。

---

## 隐私与安全

- 配置正文仅在浏览器内存中处理，不上传、不存储、不写入 `localStorage`。
- `localStorage` 只保存主题、界面状态和转换选项。
- `_headers` 与 `vercel.json` 提供一致的 CSP、`nosniff`、Referrer Policy 和 Permissions Policy。
- Service Worker 缓存名包含版本与内容哈希，新版本发布后会自动清理旧缓存。

### 单文件版与 CSP

`dist/clash2singbox-standalone.html` 内联了 CSS 和 JavaScript，适合通过 `file://` 本地离线使用。

仓库默认 CSP 不允许内联脚本和样式。如需托管，建议部署多文件版 `dist/`；若必须托管单文件版，需要仅对该路径调整 `script-src` 和 `style-src` 策略。

---

## 目录结构

```text
index.html                     # 页面入口
assets/
  yaml.js                      # 零依赖 YAML 解析器
  convert.js                   # 转换引擎
  worker.js                    # Web Worker 与主线程回退
  app.js                       # 界面逻辑、渲染与快捷键
  style.css                    # 样式与响应式布局
fixtures/                      # 协议输入与预期输出
tests/                         # 回归、Fixture、Schema、E2E 与布局测试
build.mjs                      # 构建 dist/ 与单文件版
.github/workflows/             # CI 与 GitHub Pages 部署
vercel.json / _headers         # 安全头与缓存策略
sw.js / manifest.webmanifest   # PWA
```

## 许可证

MIT © 2026 works。

本工具仅用于配置格式转换，不附带或分发任何节点与订阅。
