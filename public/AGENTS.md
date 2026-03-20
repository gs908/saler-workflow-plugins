<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-20 | Updated: 2026-03-20 -->

# public

## Purpose
静态资源目录，提供 CSS、图片、JavaScript 等静态文件服务。

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `stylesheets/` | CSS 样式文件 |
| `images/` | 图片资源 |
| `javascripts/` | 客户端 JavaScript |

## For AI Agents

### 访问方式
- URL: `/stylesheets/base.css`
- 本地路径: `public/stylesheets/base.css`
- 映射到: `src/app.js` 中的 `express.static`

### 注意事项
- 静态文件路径在 `src/` 上一级
- 实际路径: `../public/`

<!-- MANUAL: -->
