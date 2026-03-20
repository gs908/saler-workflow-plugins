<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-20 | Updated: 2026-03-20 -->

# src

## Purpose
应用源代码目录，包含 Express 应用主文件、路由和视图模板。

## Key Files

| File | Description |
|------|-------------|
| `app.js` | Express 应用主文件，包含中间件配置和路由扫描 |
| `routes/index.js` | 首页路由 |
| `routes/users.js` | 用户相关 API 路由 |
| `routes/test.ts` | TypeScript 示例路由 |
| `views/error.hbs` | 错误页面模板 |
| `views/index.hbs` | 首页模板 |
| `views/layout.hbs` | 布局模板 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `routes/` | 路由文件 (JS/TS) |
| `views/` | Handlebars 模板文件 |

## For AI Agents

### TypeScript 支持
- app.js 顶部注册 ts-node
- TypeScript 路由通过手动扫描加载 (route-scanner 不支持 .ts)
- 新建 TS 路由: 使用 `export default router`

### 路由约定
- JS 路由: route-scanner 自动扫描
- TS 路由: 手动扫描，需 `export default`
- 路径格式: `/saler-workflow-plugins/{route-name}`

### 路径说明
- `__dirname` 指向 `src/`
- views: `src/views/`
- routes: `src/routes/`
- public: `../public/`

### 中间件顺序
1. morgan (日志)
2. express.json/urlencoded (body 解析)
3. cookie-parser
4. express.static (静态文件)
5. cors
6. 路由 (route-scanner + 手动 TS 扫描)
7. 404 handler

## Dependencies

### Internal
- `bin/www` - 引用此目录的 app.js

### External
- route-scanner 0.2.2
- hbs 4.x
- cors 2.8
- express 4.16

<!-- MANUAL: -->
