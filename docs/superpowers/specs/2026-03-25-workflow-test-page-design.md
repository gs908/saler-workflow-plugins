# 工作流执行测试页面设计

## 1. 概述

创建一个用于可视化测试 Coze 工作流执行的页面，用于手动测试会议分析工作流。

## 2. 页面路由

- **GET** `/workflow-test` → 渲染 `src/views/workflow-test.hbs`

## 3. 页面结构

```
┌─────────────────────────────────────┐
│  工作流执行测试页面                   │
├─────────────────────────────────────┤
│  [表单区域]                          │
│  TXT链接: [________________]         │
│  会议名称: [________________]         │
│           [提交执行]                  │
├─────────────────────────────────────┤
│  [执行结果区域]                       │
│  状态: -                            │
│  execute_id: -                      │
│  debug_url: -                       │
│  输出: -                            │
├─────────────────────────────────────┤
│  [倒计时区域]                         │
│  剩余时间: 05:00                     │
│  [获取异步结果] (禁用状态)            │
└─────────────────────────────────────┘
```

## 4. 功能流程

### 4.1 提交执行
1. 用户输入 `txtUrl` 和 `meetingName`
2. 点击提交，调用 `POST /api/coze/meeting-analysis`
3. 返回成功后将输入参数和返回内容保存到 `data/runtime/history.json`

### 4.2 结果展示
- 显示 `execute_id`、`debug_url`、状态信息
- 成功后启动 5 分钟倒计时

### 4.3 异步结果获取
- 倒计时结束后，可点击「获取异步结果」按钮
- 调用 `GET /api/coze/workflow-result/:workflowId/:executeId`
- 将结果更新到 `history.json` 中

## 5. history.json 格式

```json
{
  "timestamp": "2026-03-25T10:00:00.000Z",
  "input": {
    "txtUrl": "https://example.com/test.txt",
    "meetingName": "测试会议"
  },
  "executeResponse": {
    "code": 0,
    "msg": "",
    "execute_id": "741364789030728****",
    "debug_url": "https://www.coze.cn/work_flow?execute_id=..."
  },
  "asyncResult": null
}
```

异步结果获取后更新 `asyncResult` 字段。

## 6. 技术实现

- **前端**：原生 HTML + JavaScript（无框架依赖）
- **模板引擎**：Handlebars
- **历史记录**：Node.js `fs` 模块读写 `data/runtime/history.json`
- **styling**：复用项目已有 `base.css` 样式

## 7. 文件清单

| 文件 | 说明 |
|------|------|
| `src/views/workflow-test.hbs` | 页面模板 |
| `src/routes/workflow-test.js` | 页面路由 |
| `src/app.js` | 注册新路由 |
| `data/runtime/history.json` | 运行历史记录 |
| `docs/superpowers/specs/2026-03-25-workflow-test-page-design.md` | 本文档 |

## 8. API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/coze/meeting-analysis` | POST | 执行会议分析工作流 |
| `/api/coze/workflow-result/:workflowId/:executeId` | GET | 查询工作流结果 |
| `/workflow-test` | GET | 渲染测试页面 |
