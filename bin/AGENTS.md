<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-20 | Updated: 2026-03-20 -->

# bin

## Purpose
服务启动脚本目录，包含 Node.js HTTP 服务器启动入口。

## Key Files

| File | Description |
|------|-------------|
| `www` | 服务启动脚本，监听 5699 端口 |

## For AI Agents

### 工作目录
- 此目录由 `bin/www` 引用 `../src/app.js`
- 启动命令: `node ./bin/www`

### 注意事项
- 脚本引用路径已修正为 `../src/app`
- 端口配置: `process.env.PORT || '5699'`

<!-- MANUAL: -->
