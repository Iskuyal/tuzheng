# 临时演示部署（窗口化，Windows Server 2016）

> **用途**：演示当天把「图证」跑起来，让指导老师从自己的电脑打开。
> **状态：计划，未在 Server 2016 上实测。**
> **代价（先说清）**：没有 Windows 服务、没有开机自启、没有日志轮转。**服务器重启、注销登录、或那个跑 Node 的窗口被关掉，站点就下线**，重新执行第 5 步即可恢复。

## 环境基线（本文按你服务器的实际情况写）

| 项 | 值 |
| --- | --- |
| 域名 | `tuzheng.yuuuu.cyou`（Cloudflare 前置，橙色云开启） |
| 代码目录 | `C:\Users\Administrator\Desktop\web\tuzheng` |
| 后端 | Node + Express，只监听 `127.0.0.1:3001` |
| 端口占用 | 3000 图床 / 5000 Monitor2 / 8080 CoinTrace / 8090 EasySchedule → **3001 空闲**，后端启动不需要额外参数 |
| 前端 | Vite 产物 `dist\client`，由 nginx 静态托管 |
| nginx | `C:\Users\Administrator\Desktop\web\Nginx-1.30.3`（**已在运行并服务另外 5 个站点**） |
| HTTPS | 在 Cloudflare 处终止，源站只监听 80 |

## ⚠️ 先读：三条不能碰的红线

0. **所有 nginx 命令必须先 `cd` 进 nginx 目录。** Windows 版 nginx 将**当前工作目录**作为 prefix，而非 exe 所在目录。从别处调用 `...\Nginx-1.30.3\nginx.exe -t` 时，它会查找 `<当前目录>\conf\nginx.conf` 并报 `test failed`，**无法验证预期的配置文件**。
   ```powershell
   cd C:\Users\Administrator\Desktop\web\Nginx-1.30.3
   .\nginx.exe -t
   .\nginx.exe -s reload
   ```
   验证前缀对不对：`.\nginx.exe -T 2>&1 | Select-String "configuration file"`，必须打印 `C:\Users\Administrator\Desktop\web\Nginx-1.30.3\conf\nginx.conf`。

1. **不要 `Start-Process ...\nginx.exe`** —— 你的 nginx 已经在跑 5 个站点，再启一个会端口冲突。
2. **不要 `nginx -s stop`** —— 那会把 monitor / img / money / kebiao **一起停掉**。图证下线只需要关掉跑 Node 的那个窗口。

配置改动一律用 **`nginx -s reload`**（热加载）。若新配置有语法错误，nginx 会拒绝加载，并**继续用旧配置运行**，另外 5 个站点不受影响。

---

## TL;DR

```powershell
# ── 一次性 ──────────────────────────────────────────
cd C:\Users\Administrator\Desktop\web\tuzheng
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = 1
npm ci
npm run build

# 备份后替换 nginx 配置（完整版见 config\nginx\nginx.conf.example）
Copy-Item C:\Users\Administrator\Desktop\web\Nginx-1.30.3\conf\nginx.conf C:\Users\Administrator\Desktop\web\Nginx-1.30.3\conf\nginx.conf.bak
#   …把新配置写入 C:\Users\Administrator\Desktop\web\Nginx-1.30.3\conf\nginx.conf…
C:\Users\Administrator\Desktop\web\Nginx-1.30.3\nginx.exe -t          # 必须先过
C:\Users\Administrator\Desktop\web\Nginx-1.30.3\nginx.exe -s reload

# 口令文件 C:\Users\Administrator\Desktop\web\Nginx-1.30.3\conf\.htpasswd 内容一行：demo:{PLAIN}你的长口令
# Cloudflare 后台加一条 tuzheng 的 A/CNAME 指向本服务器（橙色云）

# ── 每次演示 ────────────────────────────────────────
cd C:\Users\Administrator\Desktop\web\tuzheng
node dist\server\server\index.js      # ← 这个窗口不要关，最小化即可
```

---

## 1. 确认 Node（1 分钟，只做一次）

```powershell
node -v
```

期望输出 `v24.x`（README 要求 24.x，或 22.12 以上的 22.x）。若没有输出，先解决 Node 的运行问题；这是整个部署过程中唯一无法仅靠阅读代码提前判断的环节。

**Java 不需要**（本项目没有 Java 组件）；**Python 运行时也不需要**（只在重建提交材料 PDF 时可选用来读页码）。

## 2. 拉代码并构建（约 3—5 分钟，只做一次）

```powershell
# 首次：拉代码（服务器上已有代码就跳过这两行）
git clone https://github.com/Iskuyal/tuzheng.git C:\Users\Administrator\Desktop\web\tuzheng
cd C:\Users\Administrator\Desktop\web\tuzheng

# 省掉几百 MB：本项目浏览器测试用系统自带 Edge，那份测试浏览器演示用不到
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = 1

npm ci
npm run build
```

确认两个产物存在（构建需要 devDependencies，所以不能 `npm ci --omit=dev`）：

- `dist\client\index.html` → 前端静态文件
- `dist\server\server\index.js` → 后端入口，就是第 5 步要跑的

以后代码有更新，只需重跑 `npm run build`。

## 3. 替换 nginx 配置（只做一次）

完整文件在本仓库 [config/nginx/nginx.conf.example](../config/nginx/nginx.conf.example)——它就是你现有 `nginx.conf` 加上图证的 server 块，**整份替换**即可，不用手工合并。

```powershell
# 1) 先备份（它正在服务另外 5 个站点，必须留退路）
Copy-Item C:\Users\Administrator\Desktop\web\Nginx-1.30.3\conf\nginx.conf C:\Users\Administrator\Desktop\web\Nginx-1.30.3\conf\nginx.conf.bak

# 2) 把 config\nginx\nginx.conf.example 的内容写入 C:\Users\Administrator\Desktop\web\Nginx-1.30.3\conf\nginx.conf

# 3) 语法检查 —— 必须通过再谈下一步
C:\Users\Administrator\Desktop\web\Nginx-1.30.3\nginx.exe -t

# 4) 热加载（不是 restart，更不是 stop）
C:\Users\Administrator\Desktop\web\Nginx-1.30.3\nginx.exe -s reload
```

**如果你的环境与基线不同，只改这 4 处：**

| 位置 | 作用 |
| --- | --- |
| `server_name tuzheng.yuuuu.cyou;` | 换域名 |
| `auth_basic_user_file C:/Users/Administrator/Desktop/web/Nginx-1.30.3/conf/.htpasswd;` | 路径必须是 nginx 实际的 conf 目录，写错会 **500**（不是 401） |
| `root C:/Users/Administrator/Desktop/web/tuzheng/dist/client;`（3 处） | 代码实际路径 |
| `proxy_pass http://127.0.0.1:3001;`（2 处） | 后端端口 |

**Cloudflare 后台**：加一条 `tuzheng` 的 A/CNAME 记录指向本服务器，橙色云开启（与 img / money / kebiao 同样做法）。

**reload 后顺手确认另外 5 个站点还在**：依次打开 monitor / img / money / kebiao，能看到页面就说明你的替换没有破坏它们。

## 4. 建口令文件（只做一次）

新建 `C:\Users\Administrator\Desktop\web\Nginx-1.30.3\conf\.htpasswd`，内容一行：

```
demo:{PLAIN}换成一个足够长的口令
```

- Windows 版 nginx 支持 `{PLAIN}` 与 `$apr1$` 前缀（nginx 核心里是纯 C 实现，见 `src/core/ngx_crypt.c`），**不需要 htpasswd 工具**。
- 但裸 `crypt()` 在 Windows 是空实现（`src/os/win32/ngx_user.c` 的 STUB），所以**不要写没有前缀的明文**，否则永远登录不上。
- 想存哈希：`openssl passwd -apr1`，把 `$apr1$...` 整串填进去。
- 给每位老师一条记录（`demo:` / `teacher1:` …），方便单独撤销。

## 5. 启动（每次演示都要做）

**只需要一个窗口**——nginx 本来就在跑，不用管它；只有 Node 需要你守着。

```powershell
cd C:\Users\Administrator\Desktop\web\tuzheng
node dist\server\server\index.js
```

看到 `图证服务端已启动：http://127.0.0.1:3001` 即成功。**这个窗口不要关，最小化即可。**

放行端口（只做一次；你的 nginx 80 端口应该早就放行了，这条只是兜底）：

```powershell
New-NetFirewallRule -DisplayName "TuZheng-Demo" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

**配置模型密钥（默认 file 模式）**：在**服务器本机**打开浏览器访问 `http://127.0.0.1/settings`，填地址 / 模型名 / API Key → 先点「测试连接」→ 保存。

> 窗口化正好绕开了正式部署里最麻烦的坑：进程就是你登录的账号在跑，密钥一定存在你的 `%LOCALAPPDATA%\TuZheng\settings.json`，一定读得到。**前提是始终用同一个 Windows 账号启动。**

赛事环境兼容可改用显式 `env` 模式，由启动 API 的环境完整提供模型协议、地址、模型与密钥，设置页只读且不会写回密钥；详见[模型配置说明](MODEL-CONFIG.md)。本轮仅验证本机进程与端口，未部署到服务器。

## 6. 自检三条

```powershell
curl.exe -o NUL -w "%{http_code}`n" http://127.0.0.1:3001/api/samples
# 期望 200 —— 后端活着

curl.exe -o NUL -w "%{http_code}`n" http://127.0.0.1/api/samples
# 期望 401 —— 口令生效

curl.exe -u demo:你的口令 -o NUL -w "%{http_code}`n" http://127.0.0.1/api/samples
# 期望 200 —— 口令正确
```

三条都对，就可以把 `https://tuzheng.yuuuu.cyou/` 和口令发给老师了。

---

## 演示当天清单

- [ ] 跑 Node 的那个窗口还在（别关、别点右上角 ×）
- [ ] 远程桌面**只断开连接，不要点「注销」**——注销会把 Node 进程一起杀掉
- [ ] 确认 Windows 更新不会在演示中途自动重启（有更新就提前重启一次，再执行第 5 步）
- [ ] `curl.exe http://127.0.0.1:3001/api/samples` 有响应
- [ ] 自己先完整走一遍 `/audit` 和 `/source-audit`，尤其是「追问 → 补证」，顺便确认模型额度还在
- [ ] 让老师先打开一次：弹口令框 → 输口令 → 页面出来
- [ ] 顺手确认另外 5 个站点正常（它们和本次演示无关，但都挂在这台 nginx 上）

## 仍然要小心的 5 件事

| 事项 | 不处理的后果 |
| --- | --- |
| nginx 默认 1MB 上传上限 | 老师传图直接 413，会以为是应用坏了（配置里已用 `client_max_body_size 8m` 解决，删掉就会复现） |
| `proxy_pass` 写成 `localhost` | 可能解析到 `::1` → 502（配置里已写死 `127.0.0.1`） |
| 缺 SPA 回退 | 直接打开/刷新 `/source-audit` → 404（配置里已有 `try_files`） |
| 一份共享口令 + 一份共享密钥 | 谁拿到口令谁就消耗你的额度 → 口令设长，配置里的 `limit_req` 别删 |
| 重启 / 注销 / 关窗口就下线 | 这是这条路线的选择，不是 bug；重跑第 5 步即可 |

## 安全边界（如实说明，不是让你现在就改）

HTTPS 在 Cloudflare 终止，源站只监听 80 → **浏览器到 CF 是加密的，但 CF 到源站那一跳的 HTTP 是明文，Basic Auth 口令会在这一跳以明文经过公网。**

- 临时演示给一位老师看：可接受（口令设长、演示完就关掉 Node 窗口）。
- 要长期开放：换 Cloudflare Tunnel，或给 nginx 配 Origin Certificate 监听 443 并把 CF 的 SSL 模式改成 Full (strict)。

## 演示结束

```powershell
# 只关掉跑 Node 的那个窗口（或在该窗口按 Ctrl+C）
```

**不要动 nginx。** 图证的后端一停，`tuzheng` 站点自然就是 502，而另外 5 个站点照常运行。

密钥留在 `%LOCALAPPDATA%\TuZheng\settings.json`，下次演示不用重填。

## 可选：连 `npm run build` 都想省

用一个窗口同时起前后端：

```powershell
cd C:\Users\Administrator\Desktop\web\tuzheng
npm run dev
```

然后把 nginx 里 `tuzheng` 那个 server 块的 `root`、`location /api/`、`location /` 三处换成一条：

```nginx
location / { proxy_pass http://127.0.0.1:5173; proxy_read_timeout 120s; }
```

（`client_max_body_size`、口令保护照旧保留。Vite 自己会把 `/api` 转到 3001。）

两个代价：

1. 开发模式页面加载比构建产物慢；
2. `tsx watch` 会在项目文件变动时自动重启 API，**重启会丢掉在途的「追问 → 补证」会话**——演示期间不要碰项目目录里的文件。

## 以后要从临时演示升级成长期服务

只需要补三件事，做法见[正式部署指引](DEPLOY-WINDOWS-SERVER.md)：

1. 用 NSSM/WinSW 把 Node 注册成 Windows 服务（nginx 你已经是常驻的，不用动）；
2. 服务注册时确认**运行账号就是配置模型密钥的那个账号**（否则读不到密钥）；
3. 把 stdout/stderr 重定向到日志文件（服务没有控制台，出错时什么都看不到）。
