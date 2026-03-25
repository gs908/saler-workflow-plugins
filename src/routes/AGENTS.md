<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-20 | Updated: 2026-03-25 -->

# routes

## Purpose
路由文件目录，包含所有 API 路由和页面路由。支持 JavaScript 和 TypeScript。

## Key Files

| File | Description |
|------|-------------|
| `index.js` | 首页路由，渲染 index.hbs |
| `workflow-test.js` | 工作流测试页面路由 |
| `api/users.js` | 用户 API 路由，包含 Mock 数据 |
| `api/coze.ts` | Coze 工作流 API 路由 |
| `api/test.ts` | TypeScript 示例路由 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `api/` | API 路由文件，支持多层级嵌套 (见 `api/AGENTS.md`) |

## For AI Agents

### 新建路由
1. 创建文件: `src/routes/{name}.js` 或 `src/routes/{name}.ts`
2. 导出 router: `module.exports = router` (JS) 或 `export default router` (TS)
3. 路由自动注册，URL: `/saler-plugins/{name}`

### TypeScript 模板
```typescript
import { Router, Request, Response } from 'express';
const router = Router();
router.get('/', (req: Request, res: Response) => {
    res.json({ message: 'Hello' });
});
export default router;
```

### 特殊路由
- `index.js` → `/saler-plugins/` (replace /index → /)
- `workflow-test.js` → `/saler-plugins/workflow-test`
- `api/coze.ts` → `/saler-plugins/api/coze`
- `api/users.js` → `/saler-plugins/api/users`

### 注意事项
- route-scanner 只扫描 .js 文件
- .ts 文件需要手动扫描处理
- 手动注册的路由放在 route-scanner 扫描之后

<!-- MANUAL: -->
