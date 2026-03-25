<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-20 | Updated: 2026-03-25 -->

# src

## Purpose
应用源代码目录，包含 Express 应用主文件、路由、视图模板、配置、任务和工具函数。

## Key Files

| File | Description |
|------|-------------|
| `app.js` | Express 应用主文件，包含中间件配置和路由扫描 |
| `README.md` | src 目录结构说明 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `config/` | 配置读取，集中管理 API 配置、环境变量等 |
| `modules/` | 相对完整的业务模块单元，可被 task 引用 |
| `task/` | 完整的任务封装，通常组合多个 modules |
| `routes/` | 路由配置，支持 .js 和 .ts |
| `utils/` | 通用工具函数 |
| `views/` | Handlebars 页面模板 |

## Directory Structure

```
src/
├── app.js              # Express 应用入口
├── config/             # 配置读取
│   └── coze.config.ts # Coze 相关配置
├── modules/            # 业务模块单元
│   └── plugin.ts
├── task/              # 完整任务
│   └── meeting-analysis.ts
├── routes/            # 路由配置
│   └── api/           # API 路由（多层级嵌套）
│       ├── coze.ts
│       ├── test.ts
│       └── users.js
├── utils/             # 工具函数
│   ├── history.js
│   └── http-client.ts
└── views/             # 页面模板
    ├── layout.hbs
    ├── index.hbs
    ├── error.hbs
    └── workflow-test.hbs
```

## For AI Agents

### TypeScript 支持
- app.js 顶部注册 ts-node
- TypeScript 路由通过手动扫描加载 (route-scanner 不支持 .ts)
- 新建 TS 路由: 使用 `export default router`

### 路由约定
- JS 路由: route-scanner 自动扫描
- TS 路由: 手动扫描，需 `export default`
- 路径格式: `/saler-plugins/{route-name}`
- API 路由目录: `src/routes/api/`
- 页面路由: `src/routes/workflow-test.js`

### 命名规范
- **路由文件**：按功能命名，如 `coze.ts`、`users.js`
- **API 路由**：放在 `routes/api/` 下，自动挂载到 `/api/` 路径
- **页面路由**：放在 `routes/` 根目录，如 `workflow-test.js`

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
