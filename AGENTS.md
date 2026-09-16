# AGENTS.md — 给 AI 编码工具的开发约束

本文件供 AI 编码助手（Copilot、Cursor、Codex 等）和人类开发者共同遵守。
修改本项目代码前，先读完本节。

## 项目部署方式（决定路径写法的根因）

本应用在公网以**子路径**形式经反向代理部署：`https://<站点>/ssq-draw/`。
即浏览器访问的是 `https://<站点>/ssq-draw/`，反向代理（Caddy）会把 `/ssq-draw/*`
的请求剥掉前缀后转给本地 `127.0.0.1:8765` 的 Python 进程。

因此前端与后端看到的路径**不一致**：

- 浏览器地址栏 / 前端代码里：路径带 `/ssq-draw` 前缀
- 后端 `app.py` 收到的请求：路径不带前缀（`/api/...`）

## 铁律（违反必出 404）

### 1. 前端请求 API 必须用相对路径，禁止前导 `/`

- ✅ 正确：`api('api/reroll')`、`fetch('api/state')`、`fetch(\`api/weights?strength=5\`)`
- ❌ 错误：`api('/api/reroll')`、`fetch('/api/state')`

原因：`'/api/...'` 以 `/` 开头，浏览器会直接请求到站点根路径
（`https://<站点>/api/...`），绕过了子路径反代 → 404。

### 2. 前端静态资源引用同样用相对路径

- ✅ `href="style.css"`、`src="app.js"`、`href="favicon.svg"`
- ❌ `href="/style.css"`、`src="/app.js"`

### 3. 后端 `app.py` 路由保持 `/api/...` 绝对路径，不要改成相对

后端是反代剥前缀后的落点，路由永远是 `/api/draw`、`/api/reroll`、`/api/check` 等绝对路径。

### 4. 新增前端文件时同样遵循相对路径规则

`static/` 下新增 HTML/JS/CSS 内部的所有 URL 引用，一律相对路径。

### 5. 不要绕过 Host/Origin 校验

后端 `app.py` 的 `allowed()` 依赖 `SSQ_PUBLIC_ORIGIN` 环境变量（部署时已配置）放行公网来源，
`X-App-Token` 校验始终保留。新增接口、改校验逻辑时保持这两层，不要为了调试临时绕过。

### 6. 改动后必须验证

- 必跑：`python3 -m unittest discover -s tests -v`（全部通过）
- 服务器部署场景：重启 `ssq-draw.service` 后走公网 URL 回归（页面 200、`/ssq-draw/api/state` 正常、抽号/重摇/算奖可调用）

## 历史教训

- `api('/api/reroll')`（绝对路径）曾在子路径部署下 404，统一改为 `api('api/reroll')` 修复。
- 与其「看着像是错的再改」，不如从一开始就用相对路径——这是本仓库的硬性约定。

## 代码快速定位

- `app.py`：HTTP 服务（内置 `http.server`），路由在 `do_GET` / `do_POST`
- `engine.py`：随机抽取、权重计算、历史数据抓取、校验、算奖逻辑
- `static/`：前端（`index.html` + `app.js` + `style.css`，无构建工具）
- `data/`：本地缓存（`history.json` 开奖历史、`settings.json` 更新周期）
- `tests/`：`unittest` 测试

## 技术栈提醒

- Python 3.10+，纯标准库，**不允许引入 pip 依赖**（无 requirements.txt，刻意保持零依赖）。
- 无 Node.js 构建步骤，前端是原生 JS，改了 `static/` 直接生效（重启服务即生效，无需构建）。