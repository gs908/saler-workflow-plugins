# src 目录结构

```
src/
├── app.js              # Express 应用入口
├── config/             # 配置读取
│   └── coze.config.ts # Coze 相关配置
├── modules/            # 相对完整的业务模块（插件单元）
│   └── plugin.ts
├── task/              # 完整的任务（可包含多个 modules）
│   └── meeting-analysis.ts
├── routes/            # 路由配置（支持 .js 和 .ts）
│   └── api/           # API 路由，支持多层级嵌套
│       ├── coze.ts
│       ├── test.ts
│       └── users.js
├── utils/             # 工具函数
│   ├── history.js     # history.json 读写
│   └── http-client.ts
└── views/             # 页面模板（Handlebars）
    ├── layout.hbs
    ├── index.hbs
    ├── error.hbs
    └── workflow-test.hbs
```

## 目录说明

| 目录 | 说明 |
|------|------|
| `config/` | 集中管理所有配置读取，如 API 配置、环境变量等 |
| `modules/` | 相对完整的业务模块单元，可被 task 引用 |
| `task/` | 完整的任务封装，通常组合多个 modules，实现独立业务功能 |
| `routes/` | Express 路由配置，支持 `.js` 和 `.ts`，`api/` 子目录支持多层级嵌套 |
| `utils/` | 通用工具函数，不涉及业务逻辑 |
| `views/` | Handlebars 页面模板 |

## 命名规范

- **路由文件**：按功能命名，如 `coze.ts`、`users.js`
- **API 路由**：放在 `routes/api/` 下，自动挂载到 `/api/` 路径
- **页面路由**：放在 `routes/` 根目录，如 `workflow-test.js`
- **TS 路由**：通过 `scanTsRoutes()` 自动扫描注册

## 页面访问

- 首页：`GET /`
- 工作流测试页：`GET /workflow-test`
