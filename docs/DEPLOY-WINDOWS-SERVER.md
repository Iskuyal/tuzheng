# 在 Windows Server 2016 上部署「图证」

> **状态：部署指引（计划），未在 Server 2016 或任何远程服务器上实测。** 已验收的是开发机上的本机运行（见 [README](../README.md) 与[分阶段路线图](PHASES.md)）。本文里每条命令的效果、每个版本前提都还没在目标机器上跑过，因此**不要把它当作已交付的能力**，也不要在提交材料里引用为「已部署」。第一次照做时请逐步记录实际输出，回来更新本文件的状态。

## 0. 这份文档解决什么

**目标场景**：让**指导老师**（少数已知访问者）用自己的电脑打开网页，看到 `/audit` 图内闭环与 `/source-audit` 来源核验两条演示路径。

**明确不在范围内**：把站点对匿名公众开放（那需要改变密钥方案：当前服务端只有一份共享密钥，任何人都能通过 `/api/settings` 覆盖它，见[访问检查记录](submission/accessibility-check.md)第 4 节）、多实例部署、Docker、用户登录与按用户隔离。

**访问者少是这个方案成立的前提**：一层共享口令 + 限流足以覆盖「几位老师看了觉得没问题」的用途；它不构成一个可对外运营的服务。

## 1. 先选部署形态

| 形态 | 指导老师在哪 | 需要额外准备 | 工作量 |
| --- | --- | --- | --- |
| **A. 校内网直达** | 与服务器同一校园网，能访问服务器内网 IP | 无。只需开内网 80 端口 | 最小 |
| **B. 校外访问（推荐按需要选）** | 在家/外网 | **公网域名**（解析到服务器公网 IP）＋ 80 端口可从外网访问 ＋ Let's Encrypt 证书 | 多一步证书与域名 |

两种形态的**应用部署部分完全相同**（第 3.1—3.5、3.8 节），差别只在第 3.6（口令）与 3.7（HTTPS）：**形态 A 可以省掉证书，但不能省掉口令**——即使只有几位老师，站点一旦连得上就人人连得上。

## 2. 当前实现强加的约束（先读，避免白做）

| 约束 | 依据 | 对部署的含义 |
| --- | --- | --- |
| 服务端只监听 `127.0.0.1` | [server/index.ts:17](../server/index.ts#L17)（地址写死） | **不要改代码**。nginx 装在同一台服务器上反代到 `127.0.0.1:3001` 即可 |
| 服务端不提供静态文件、没有 CORS | [server/app.ts](../server/app.ts) 只有 `/api/*` 路由 | 前端必须由 nginx 托管 `dist/client/`，且与 API **同源**；不能用别的域名或端口拼前端 |
| 前端路由是 history 模式 | [web/router.ts:4](../web/router.ts#L4)（`createWebHistory`） | nginx 必须配 SPA 回退，否则直接打开/刷新 `/source-audit` 会 404 |
| 任何上传接口都零认证 | [server/app.ts:206](../server/app.ts#L206)、[server/app.ts:296](../server/app.ts#L296) | 每个「读取图片」请求 = 一次真实模型调用 = 一次真实扣费，必须限流 |
| 密钥按**当前 Windows 用户**存放 | [server/model-settings.ts:93](../server/model-settings.ts#L93)（`%LOCALAPPDATA%\TuZheng\settings.json`） | 服务的运行账号必须与配置密钥时的账号一致，否则页面会报「实时视觉读取尚未配置」 |
| 密钥不走环境变量、不回传页面 | [AGENTS.md](../AGENTS.md) 的「密钥与示例」约定 | 不要试图用 `.env` 注入密钥；`.env` 只用于 `PORT` |
| 来源核验会话在**进程内存**里（30 分钟 / 16 条） | [server/source-sessions.ts:6](../server/source-sessions.ts#L6-L8) | **禁止 cluster / 多实例 / 重启即丢**；「补充恢复」在服务重启后会返回 410 |
| 图片只驻留内存、不落盘 | [server/app.ts:195](../server/app.ts#L195) | 不需要准备上传目录，也不需要给它权限 |

## 3. 操作步骤

### 3.1 前置环境

| 组件 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | **24.x**，或 22.12 以上的 22.x | 与 [README](../README.md) 的本地要求一致 |
| npm | 随 Node 安装 | 阶段验收用的是 npm 11.17 |
| nginx for Windows | 任意近期版本 | 只做静态托管与反向代理 |
| NSSM 或 WinSW | 最新版 | 把 Node 与 nginx 注册成 Windows 服务 |
| Git for Windows | 可选 | 也可以直接拷贝整个目录 |
| **Java** | **不需要** | 本项目没有任何 Java 组件 |
| **Python** | **不需要**（运行时） | 只有重建提交材料 PDF 时才可选用 pypdf 回填页码，见 [build-report.mjs:4](submission/build-report.mjs#L4) |

需要一并知道的两条环境事实：

- Node 官方平台表把 Windows x64 的 `>= Windows 10 / Server 2016` 列为 Tier 1，所以 Server 2016 属于**名义支持**；但这是本次部署最大的未知项，**先把它当冒烟测试做**（3.1 最后一行的验证命令）。参考 [Node.js BUILDING.md](https://raw.githubusercontent.com/nodejs/node/main/BUILDING.md)。
- Windows Server 2016 的扩展支持 **2027-01-12 到期**，且 Node 官方声明不为已 EOL 的平台提供支持。这台机器大约只剩一年可用窗口，长期方案要提前想。

```powershell
node -v            # 期望 v24.x
npm -v             # 期望 11.x
node -e "console.log(process.versions)"   # 能打印即通过冒烟；报错就先解决 Node，别往下做
```

### 3.2 取代码并构建

构建需要 devDependencies（vite / typescript / vue-tsc），**不能用 `--omit=dev` 装**。

```powershell
git clone https://github.com/Iskuyal/tuzheng.git C:\apps\web-match
cd C:\apps\web-match

# 关键：跳过 Playwright 浏览器下载（几百 MB）。本项目的浏览器测试用系统自带 Edge
# （config/playwright.config.ts 的 channel: "msedge"），服务器上不需要那份浏览器，生产也不跑 e2e。
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = 1

npm ci
npm run build
```

`npm run build` = 类型检查 + `vite build` + 服务端编译，产物两处：

- 前端静态文件：`dist\client\`（含 `index.html`、`assets\`、`samples\`）
- 服务端入口：`dist\server\server\index.js`

**更省事的替代路径**：在开发机或 CI 上构建好，只把 `dist\`、生产依赖的 `node_modules`、`package.json` 拷到服务器。这样服务器完全不需要装 devDependencies，也不必在 Server 2016 上跑 vue-tsc。

构建完成后**不要**立刻 `npm prune --omit=dev`——它会把 vite 等一起删掉，之后想重建就得重装。

### 3.3 配置模型密钥（最容易踩的一步）

以下是默认 `file` 模式。赛事部署可显式启用 `env` 模式，由运行服务的环境注入完整协议／地址／模型／密钥；设置页只读，环境密钥不会写入设置文件。变量、地址限制与重启要求见[模型配置说明](MODEL-CONFIG.md)。这只是配置输入兼容，本轮未验证 Windows Server 部署。

用**将来跑服务的那个 Windows 账号**登录一次，然后：

1. 临时用开发模式或直接在服务起来后打开站点 → 右上角「模型设置」；
2. 选协议（OpenAI Responses 兼容 / Anthropic Messages）→ 填地址与模型名 → 填 API Key；
3. 先点「测试连接」，再保存。

保存位置：`%LOCALAPPDATA%\TuZheng\settings.json`。

如果服务的运行账号与你配置时的账号不同（典型是 LocalSystem），该文件会落到 `C:\Windows\System32\config\systemprofile\AppData\Local\TuZheng\settings.json`，服务读不到你刚保存的密钥，页面会一直提示未配置。二选一：

- **推荐**：把服务的登录账号设为那个已配置密钥的账号（单管理员机器上最简单）；
- 或给服务单独设 `LOCALAPPDATA` 环境变量，指向已配置好的目录（见 3.4）。

注意这是**唯一一份共享密钥**：所有访问者都在消耗它，且没有按人隔离或预算封顶。

### 3.4 把 API 注册成 Windows 服务

**不要用 `npm run dev` 部署**——那是 `tsx watch` 开发模式，用于本机开发与演示。

```powershell
New-Item -ItemType Directory -Force C:\apps\web-match\logs

nssm install TuZhengApi "C:\Program Files\nodejs\node.exe" "C:\apps\web-match\dist\server\server\index.js"
nssm set TuZhengApi AppDirectory C:\apps\web-match

# 仅当服务账号不是配置密钥的那个账号时才需要（把路径换成 3.3 里实际保存的位置）
nssm set TuZhengApi AppEnvironmentExtra LOCALAPPDATA=C:\Users\<配置过密钥的账号>\AppData\Local

nssm set TuZhengApi AppStdout   C:\apps\web-match\logs\api.out.log
nssm set TuZhengApi AppStderr   C:\apps\web-match\logs\api.err.log
nssm set TuZhengApi AppRotateFiles 1
nssm set TuZhengApi Start SERVICE_AUTO_START
nssm start TuZhengApi

curl http://127.0.0.1:3001/api/samples     # 期望返回 JSON
```

若要改端口：在 `C:\apps\web-match\.env` 里写 `PORT=3001`（参考 [.env.example](../.env.example)），或用 `AppEnvironmentExtra` 设 `PORT`。改完两边都要改（nginx 的 `proxy_pass` 也要跟着改）。

### 3.5 配置 nginx

```nginx
server {
    listen 80;
    server_name _;          # 形态 B 改成你的域名

    root  C:/apps/web-match/dist/client;     # nginx 在 Windows 上用正斜杠
    index index.html;

    # ★ nginx 默认上限 1m，会在应用之前就拦掉上传；应用自身上限是 5MB
    client_max_body_size 6m;

    location /api/ {
        # ★ 必须写 127.0.0.1，不能写 localhost：服务端只监听 IPv4 回环，
        #   localhost 在部分 Windows 解析顺序下会先走 ::1，得到 ECONNREFUSED
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # ★ 模型调用是秒级到几十秒；默认 60s 对慢模型偏紧
        proxy_read_timeout 120s;
    }

    # ★ 前端是 history 路由，直接打开或刷新子路径必须回退到 index.html，否则 404
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

nginx for Windows 本身不是 Windows 服务，仍需 NSSM/WinSW 包一层，并在启动前用 `nginx -t` 验证配置。

### 3.6 访问控制（形态 A、B 都必须做）

**口令**：用 nginx Basic Auth。nginx for Windows 不自带 `htpasswd`，可以用随 nginx 一起的 OpenSSL 生成，或下载 Apache 的 `htpasswd.exe`：

```powershell
# 生成 apr1 格式的哈希行，写入 C:\nginx\conf\.htpasswd
# 每位老师一条记录，便于单独撤销某人
openssl passwd -apr1
```

```nginx
# 放在 server 块内
auth_basic           "TuZheng";
auth_basic_user_file C:/nginx/conf/.htpasswd;
```

**限流**（访问者虽少，但一次误刷就是一次扣费）。放在 `http` 块：

```nginx
limit_req_zone $binary_remote_addr zone=modelapi:10m rate=30r/m;

# 放在 server 块内：只对真正调用模型的两个接口限速
location /api/audit/image {
    limit_req zone=modelapi burst=5 nodelay;
    proxy_pass http://127.0.0.1:3001;
    proxy_read_timeout 120s;
}
location /api/source-audit/ {
    limit_req zone=modelapi burst=5 nodelay;
    proxy_pass http://127.0.0.1:3001;
    proxy_read_timeout 120s;
}
```

**把设置页改成只读**：指导老师不需要改模型设置，而 `PUT /api/settings` 可以覆盖你的密钥。只允许读、禁止写最稳妥：

```nginx
location /api/settings {
    limit_except GET { deny all; }
    proxy_pass http://127.0.0.1:3001;
}
location /api/settings/test-connection { deny all; }
```

（`/api/settings` 的读接口只返回地址、模型名和「密钥是否已配置」，不回传密钥，所以允许 GET 不泄露密钥。）

### 3.7 防火墙与 HTTPS

```powershell
New-NetFirewallRule -DisplayName "TuZheng-HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
# 形态 B 再加 443（放通 80 仅为 Let's Encrypt 的 http-01 校验）
New-NetFirewallRule -DisplayName "TuZheng-HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

- **形态 A（校内网）**：不开公网端口；只在校园网内可达即可，可暂不上证书。
- **形态 B（校外）**：公网域名解析到本机 → 用 win-acme 申 Let's Encrypt 证书 → 加 `listen 443 ssl` 并把证书路径填进配置 → 80 端口留作自动续期与跳转。nginx for Windows 使用自带 OpenSSL，TLS 1.2/1.3 不受 Server 2016 的 Schannel 老协议配置影响。

**加了 Basic Auth 就必须上 HTTPS**（形态 B）：否则老师的口令以明文过网。形态 A 若只在校园网内，风险可接受，但仍建议后续补证书。

### 3.8 系统层面

```powershell
Add-MpPreference -ExclusionPath C:\apps\web-match   # Defender 会显著拖慢 npm ci；这是部署路径，属受控目录
w32tm /resync                                       # 模型调用走 HTTPS，系统时间必须准确
```

日志只有 3.4 里配置的 NSSM 重定向：应用本身用 `console.log/warn` 输出，**不写日志文件**。

## 4. 验收清单

按顺序做，前一条不过就不要往下：

- [ ] `node -v` 在 Server 2016 上能正常执行（3.1 的冒烟测试）
- [ ] `npm run build` 成功，`dist\client\index.html` 与 `dist\server\server\index.js` 都存在
- [ ] `curl http://127.0.0.1:3001/api/samples` 返回 200 + JSON
- [ ] `http://<服务器地址>/` 打开着陆页；**直接刷新 `/source-audit` 不出现 404**
- [ ] 上传一张团队自制 PNG → 走通「读取 → 确认 → 计算」。**这一步才真正证明 3.3 的密钥与出网都通了**
- [ ] `/source-audit` 走通「载入团队自制 CPI 样例 + 填配文 → 核验 → 追问 → 补证」
- [ ] 未带口令访问返回 401；带上口令后正常
- [ ] 用老师的网络环境（校外则从校外）实际打开一次
- [ ] `npm test` 在服务器上全绿（离线，不需要密钥，可作为「代码本身在这台机器上能跑」的独立证据）

## 5. 已知风险与边界

| 风险 | 说明 |
| --- | --- |
| 一份共享密钥 | 所有访问者共用同一份额度，无按人隔离、无预算封顶；口令泄露等于额度泄露 |
| 无用户与审计 | 站点没有登录，任何持有口令的人看到同样的内容，也留不下「谁核验了什么」的记录 |
| 内存会话 | 服务重启（含部署新版本）会让在途的「补充恢复」失效 |
| 单实例 | 不能 cluster。多实例会让 `/api/source-audit/resume` 随机失败 |
| 平台临近 EOL | Server 2016 扩展支持 2027-01-12 结束，之后 Node 官方不再承诺支持 |
| 未实测 | 本文全部步骤没有在 Server 2016 上跑过；3.1 的 Node 冒烟是第一个可能失败的关口 |

## 6. 真开访问前必须同步的文档

仓库当前把「公网部署」明确记为**未做**，并写明了理由。一旦实际提供服务，下列内容会与实现不一致，必须一起更新（本次部署指引**不修改**这些文件）：

- [README.md](../README.md) 第 147 行的「公网部署留待后续阶段」
- [访问检查记录](submission/accessibility-check.md) 第 4 节的「本次决定不提供」及其条件
- [演示视频脚本](submission/demo-video-script.md) 里「公网演示不属于已验收项」的排除条目

## 7. 停止与回滚

```powershell
nssm stop TuZhengApi
nssm remove TuZhengApi confirm
nginx -s stop
Remove-NetFirewallRule -DisplayName "TuZheng-HTTP"
Remove-NetFirewallRule -DisplayName "TuZheng-HTTPS"
```

密钥文件留在 `%LOCALAPPDATA%\TuZheng\settings.json`；彻底清除时手动删除该文件或其中的 `apiKey` 字段。仓库目录可整体删除，不含任何密钥。
