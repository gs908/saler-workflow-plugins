<!-- Generated: 2026-03-20 | Updated: 2026-03-20 -->

# saler-workflow-plugins

## Purpose
Fake API 服务，用于快速开发测试。提供路由自动扫描、HBS 模板引擎、Mock 数据生成等功能。已支持 TypeScript。

## Key Files

| File | Description |
|------|-------------|
| `package.json` | 项目配置，包含依赖和脚本 |
| `tsconfig.json` | TypeScript 配置 |
| `bin/www` | 服务启动入口 |
| `src/app.js` | Express 应用主文件 |
| `pnpm-lock.yaml` | pnpm 锁定文件 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `bin/` | 服务启动脚本 (see `bin/AGENTS.md`) |
| `src/` | 应用源代码 (see `src/AGENTS.md`) |
| `public/` | 静态资源文件 (see `public/AGENTS.md`) |

## For AI Agents

### 开发命令
- `pnpm start` - 启动服务 (端口 5699)
- `pnpm dev` - 开发模式 (热重载)
- `pnpm type-check` - TypeScript 类型检查
- `pnpm build` - 编译 TypeScript

### 注意事项
- 使用 pnpm 作为包管理器
- TypeScript 路由需手动扫描 (route-scanner 不支持 .ts)
- 路由文件放在 `src/routes/` 目录
- API 路由放在 `src/routes/api/` 目录
- views 模板放在 `src/views/` 目录

### 架构说明
- 应用入口: `bin/www` → `src/app.js`
- 路由扫描: route-scanner (JS) + 手动扫描 (TS)
- 路由前缀: `/saler-plugins`

## Dependencies

### External
- Express 4.16 - Web 框架
- route-scanner 0.2.2 - 路由自动扫描
- hbs 4.x - Handlebars 模板引擎
- mockjs 1.1 - Mock 数据生成
- ts-node 10.9 - TypeScript 运行时
- TypeScript 5.9 - 类型支持

<!-- MANUAL: -->
