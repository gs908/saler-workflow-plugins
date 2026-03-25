<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-20 | Updated: 2026-03-25 -->

# views

## Purpose
Handlebars 模板文件目录，包含页面视图和布局。

## Key Files

| File | Description |
|------|-------------|
| `layout.hbs` | 主布局模板 |
| `index.hbs` | 首页模板 |
| `error.hbs` | 错误页面模板 |
| `workflow-test.hbs` | 工作流测试页面 |

## For AI Agents

### 模板引擎配置
- 引擎: hbs (Handlebars)
- 视图目录: `src/views/`
- 布局支持: 已启用

### 使用方式
```javascript
res.render('index', { title: 'Page Title' });
```

### 页面访问
- 首页: `GET /`
- 工作流测试: `GET /workflow-test`

<!-- MANUAL: -->
