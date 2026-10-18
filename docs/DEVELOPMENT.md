# 开发与运行

## Windows 启动

本机与 CI 使用 Node.js 24；已记录的开发环境为 Node 24.16、npm 11.17，浏览器测试使用系统 Edge。依赖版本由根目录锁文件确定。

```powershell
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。该命令先检查端口，再同时启动 Node API 和 Vite。端口冲突会明确失败，网页不会静默换端口。WebStorm 可从根 `package.json` 的 npm 面板运行相同命令。

| 入口 | 用途 |
| --- | --- |
| `/` | 作品介绍、团队自制样例和上传入口 |
| `/source-audit` | 图表加配文、来源判断、引用和修改建议 |
| `/audit` | 图内读数确认、程序计算、跨图和纵轴检查 |
| `/settings` | 配置来源、模型协议、地址、密钥和手动连接测试 |

## 端口与服务

默认 API 为 `127.0.0.1:3001`，网页为 `127.0.0.1:5173`。根 `.env` 或进程环境中的 `PORT`、`WEB_PORT` 可以覆盖默认值；Vite 代理和 API 使用同一份 `PORT`。例如：

```powershell
$env:PORT = '3107'
$env:WEB_PORT = '5187'
npm run dev
```

之后打开 `http://127.0.0.1:5187`。结束该次自定义运行后，在同一终端移除这两个进程变量，或另开终端恢复默认端口。查看占用可用 `netstat -ano | findstr :3001`；先识别对应进程，保留其他项目服务。

`npm run build` 生成 `dist/client/` 和 `dist/server/`，包含类型检查。开发使用 `npm run dev`；正式部署另见计划文档，生产构建成功不表示已有可公网访问的部署。

## 配置模型

默认在设置页配置，服务端保存到 `%LOCALAPPDATA%\TuZheng\settings.json`。两种协议分别保留配置，密钥留空可保留原值，页面读取只返回“是否已配置”。

2026-10-18 新版实录实际使用的组合为 `Anthropic Messages`、`https://api.deepseek.com/anthropic/v1`、`deepseek-flash`。这是注明日期的成功记录；预设列表中的其他协议和型号不因出现在列表里就算本次通过。

仅选择样例或上传到输入区不会调用模型。主动读取新图、运行来源核验、提交补证和测试连接会调用配置的上游服务，可能产生费用；连接测试不发送图片，因此通过连接测试不能代替多模态读取验证。

显式使用服务端环境配置时，从根 [.env.example](../.env.example)填写 `MODEL_CONFIG_SOURCE=env` 及整套 `MODEL_PROVIDER`、`MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY`，重启后生效。页面显示来源并只读，环境字段与本机文件整份选择。字段校验、密钥边界、文件损坏恢复与 HTTPS 约束统一见[模型配置说明](MODEL-CONFIG.md)。

预设的历史调研依据在[模型预设记录](../.scratch/model-presets-research/endpoints-2026-10-01.md)；使用时仍以服务商当期支持情况和自己的实际请求为准。

## 离线检查

以下命令不调用付费模型：

```powershell
npm run docs:check
npm run verify:materials
npm test
npm run test:recording
npm run eval:samples
npm run eval:holdout -- --verify
npm run eval:source-audit -- --check-only
npm run build
npm run test:e2e
```

浏览器测试覆盖 320/390/1280 三个视口，模型相关路径使用替身，既有开发服务可被复用。没有系统 Edge 时，需先安装 Playwright Chromium 并调整 `config/playwright.config.ts` 的浏览器通道。

`npm run verify:model-config` 使用临时用户目录和假密钥，串行验证 file/env × 默认 3001/5173、自定义 3107/5187 四组真实进程；这些端口须先空闲，脚本不停止已有服务。它检查配置读取和代理，不做模型调用。

`npm run verify:ui -- --states --text-200 --output=.cache/ui-check` 生成四路由与状态的界面检查；模型连接使用替身。`npm run verify:sample-renders` 逐字节比对 SVG 对应 PNG，字体栅格化受 Edge 版本影响，CI 将其作为不阻塞的信号。

PDF 检查使用 `node docs/submission/build-report.mjs --competition --check`，重建时移除 `--check`。截图脚本 `node e2e/submission-screenshots.mjs` 使用替身，只生成界面说明材料。

## 在线评测与 CI

`eval:source-audit` 不带 `--check-only` 时会真实调用模型；`eval:demo:http` 和 `eval:holdout:http` 需显式执行参数及独立批次授权。执行前核对未知请求、候选锁、预算、停止条件和负责人抽查，流程见[受控评测说明](evaluations/candidate-runbook.md)。保存结果的 replay 只重统计历史记录，不证明当前模型修复效果。

[CI](../.github/workflows/ci.yml)执行离线检查、材料指纹、构建、固定样例和三视口测试，不配置模型密钥。测试、CI、实录、负责人验收、真实读者研究和第二台 Windows 是不同证据，查阅时按[证据索引](evidence/README.md)区分。
