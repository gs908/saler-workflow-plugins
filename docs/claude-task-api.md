# Claude Task 外部接口文档

**Base URL：** `http://{host}:5699/saler-plugins/api/claude`

---

## 接口列表

| 接口 | 方法 | 说明 |
|------|------|------|
| `/async` | POST | 提交任务（推荐） |
| `/:taskId/status` | GET | 查询任务状态 |
| `/:taskId/stream` | GET | 订阅 SSE 实时输出 |
| `/:taskId/resume` | POST | 续接中断的任务 |
| `/:taskId/cancel` | POST | 取消任务 |

---

## 1. 提交任务

**POST /async**

### 请求体

```json
{
  "name":        "任务名称",            // 必填，例：港云数科售前报告
  "execute_id":   "pipe-001",            // 必填，外部流水线 ID（内部映射为 pipelineId）
  "filePaths":   "C:/work/report.md",  // 必填，服务器上已有文件的绝对路径

  "workDir":     "C:/work/project",    // 选填，不传使用 CLAUDE_DEFAULT_WORK_DIR（实际工作区 = workDir/executeId）
  "prompt":      "根据报告内容，生成视频，使用默认主题",  // 选填，不传使用 CLAUDE_DEFAULT_PROMPT
  "skill":       "video-report-generator",              // 选填，不传使用 CLAUDE_DEFAULT_SKILL
  "callbackUrl": "http://your-system/callback"          // 选填，不传使用 CLAUDE_DEFAULT_CALLBACK_URL
}
```

### 响应

```json
{
  "taskId":    "8cdba7df-7ef4-448a-b06a-defdd9298b74",
  "pipelineId": "pipe-001",
  "sessionId":  null,         // 初始为 null，任务完成后有值
  "status":    "pending",
  "startTime": 1774504023043,
  "streamUrl": "/saler-plugins/api/claude/{taskId}/stream"
}
```

---

## 2. 查询任务状态

**GET /:taskId/status**

### 响应

```json
{
  "id":         "8cdba7df-...",
  "status":     "completed",
  "prompt":     "请生成视频报告",
  "workDir":    "C:/work/project",
  "startTime":  1774504023043,
  "endTime":    1774504063263,
  "pipelineId": "pipe-001",
  "resultText": "Claude 完整输出文本...",
  "sessionId":  "ec78a10e-658f-44a8-a0f9-516408cb66c7"  // 用于续接
}
```

### status 枚举

| 值 | 说明 |
|----|------|
| `pending` | 等待执行 |
| `running` | 执行中 |
| `completed` | 成功完成 |
| `cancelled` | 已取消（有 sessionId 可续接） |
| `error` | 执行出错（有 sessionId 可续接） |

---

## 3. 订阅实时输出（SSE）

**GET /:taskId/stream**

长连接，服务端持续推送事件。任务已完成时，会回放历史事件后关闭连接。

### 事件格式

```
event: text
data: {"type":"text","content":"Claude 输出内容..."}

event: done
data: {"taskId":"...","status":"completed","endTime":1774504063263}
```

### 事件类型

| event | 说明 |
|-------|------|
| `init` | 任务开始 |
| `text` | Claude 文本输出 |
| `tool_start` | 开始调用工具（读写文件等） |
| `tool_use` | 工具调用结果 |
| `status` | 状态变更 |
| `result` | 最终结果，含 sessionId |
| `done` | 流结束，连接关闭 |
| `error` | 执行错误 |

---

## 4. 续接任务

**POST /:taskId/resume**

任务被取消或报错后，从中断处继续执行，无需从头重跑。

**前提：** 任务 status 为 `cancelled` 或 `error`，且有 `sessionId`。

### 响应

```json
{
  "success":   true,
  "taskId":    "8cdba7df-...",
  "status":    "running",
  "streamUrl": "/saler-plugins/api/claude/{taskId}/stream"
}
```

续接后重新订阅 `streamUrl` 即可接收后续输出。

---

## 5. 取消任务

**POST /:taskId/cancel**

### 响应

```json
{ "success": true, "taskId": "...", "status": "cancelled" }
```

---

## 6. 回调机制

创建任务时传入 `callbackUrl`，任务结束后系统自动 POST 回调。

### 回调 Payload

读取 `workDir/output/result.json` 内容，并附加系统字段：

```json
{
  // skill 生成的 result.json 业务数据（字段由 skill 决定）
  "status":"success",
  "execute_id":  "pipe-001",           // 创建任务时传入的 pipelineId
  "path": "video.mp4",
  "type":       "video_create",       // result.json status=success 时为 video_create，否则为空字符串
  "outcome": "success"
  // 系统自动附加
  "taskId":     "8cdba7df-...",       // 本次任务 ID
  "sessionId":  "ec78a10e-..."        // 用于续接的会话 ID
}
```

> 若 `workDir/output/result.json` 不存在或解析失败，**不发送回调**。

---

## 典型流程

```
外部系统                          Claude Task API
   |                                    |
   |-- POST /async ------------------>  |  立即返回 taskId
   |                                    |  后台开始执行...
   |                                    |
   |  （可选）GET /:taskId/status -----> |  查询进度
   |  （可选）GET /:taskId/stream -----> |  订阅实时 SSE
   |                                    |
   |<-- POST callbackUrl（任务完成）---   |  返回结果 + sessionId
   |                                    |
   |  （如需续接）POST /:taskId/resume -> |  从中断处继续
```
