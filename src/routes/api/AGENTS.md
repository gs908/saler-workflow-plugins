<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-20 | Updated: 2026-03-25 -->

# api

## Purpose
API 路由目录，支持多层级嵌套，包含业务 API 端点。

## Key Files

| File | Description |
|------|-------------|
| `users.js` | 用户相关 API 路由，包含 Mock 数据 |
| `coze.ts` | Coze 工作流 API 路由（会议分析、上传文件、查询结果） |
| `test.ts` | TypeScript 示例路由 |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/coze/meeting-analysis` | POST | 执行会议分析工作流 |
| `/api/coze/file-upload` | POST | 上传文件到 Coze |
| `/api/coze/workflow-result/:workflowId/:executeId` | GET | 查询工作流执行结果 |
| `/api/coze/meeting-result/:executeId` | GET | 查询会议分析结果（便捷接口） |
| `/api/coze/health` | GET | 健康检查 |

## For AI Agents

### 路由 URL
- `users.js` → `/saler-plugins/users`
- `coze.ts` → `/saler-plugins/api/coze`
- `test.ts` → `/saler-plugins/test`

### 请求格式
- 文件上传: `multipart/form-data`
- 其他 API: `application/json`

<!-- MANUAL: -->
