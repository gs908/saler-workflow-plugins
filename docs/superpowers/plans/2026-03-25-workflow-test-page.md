# Workflow Test Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a page to visually test Coze workflow execution with file upload, meeting name input, 5-minute countdown timer, and async result fetching.

**Architecture:** Express.js with Handlebars templates. The page submits to existing `/api/coze/meeting-analysis` endpoint, displays results, runs a 5-minute countdown, then fetches async results via `/api/coze/workflow-result/:workflowId/:executeId`. All input/output is persisted to `data/runtime/history.json`.

**Tech Stack:** Express.js, Handlebars,原生 JavaScript, Node.js fs module

---

## File Structure

| File | Action |
|------|--------|
| `src/views/workflow-test.hbs` | Create - page template |
| `src/routes/workflow-test.js` | Create - GET route renders page |
| `src/utils/history.js` | Create - history.json read/write utility |
| `src/app.js` | Modify - register new route |
| `data/runtime/history.json` | Create - initial empty JSON `{}` |

---

## Task 1: Create history utility

**File:** Create: `src/utils/history.js`

- [ ] **Step 1: Write the utility**

```javascript
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../../data/runtime/history.json');

function readHistory() {
    if (!fs.existsSync(HISTORY_FILE)) {
        return {};
    }
    const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
}

function writeHistory(data) {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { readHistory, writeHistory };
```

- [ ] **Step 2: Test the utility**

Run: N/A (manual verification only)

- [ ] **Step 3: Commit**

```bash
git add src/utils/history.js
git commit -m "feat: add history.json utility"
```

---

## Task 2: Create workflow-test route

**File:** Create: `src/routes/workflow-test.js`

- [ ] **Step 1: Write the route**

```javascript
const express = require('express');
const router = express.Router();
const { readHistory, writeHistory } = require('../utils/history');

/**
 * GET /workflow-test
 * 渲染工作流测试页面
 */
router.get('/', async (req, res) => {
    res.render('workflow-test', {
        title: '工作流执行测试',
        subTitle: 'Coze 会议分析工作流测试工具'
    });
});

/**
 * POST /workflow-test/save
 * 保存提交参数到 history.json
 */
router.post('/save', async (req, res) => {
    try {
        const { meetingName, txtUrl, executeResponse } = req.body;
        const history = readHistory();

        const record = {
            timestamp: new Date().toISOString(),
            input: { txtUrl, meetingName },
            executeResponse,
            asyncResult: null
        };

        // 使用时间戳作为 key 便于区分多条记录
        const key = new Date().toISOString();
        history[key] = record;
        writeHistory(history);

        res.json({ success: true });
    } catch (error) {
        console.error('[WorkflowTest] 保存失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /workflow-test/async-result
 * 更新 asyncResult 到 history.json
 */
router.put('/async-result', async (req, res) => {
    try {
        const { timestamp, asyncResult } = req.body;
        const history = readHistory();

        if (history[timestamp]) {
            history[timestamp].asyncResult = asyncResult;
            writeHistory(history);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[WorkflowTest] 更新失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/workflow-test.js
git commit -m "feat: add workflow-test route with save and async-result endpoints"
```

---

## Task 3: Create workflow-test page template

**File:** Create: `src/views/workflow-test.hbs`

- [ ] **Step 1: Write the page**

```html
<div class="workflow-test-container">
    <h1>工作流执行测试</h1>

    <!-- 表单区域 -->
    <div class="form-section">
        <div class="form-group">
            <label for="txtUrl">TXT 文件链接:</label>
            <input type="text" id="txtUrl" name="txtUrl" placeholder="https://example.com/test.txt" />
        </div>
        <div class="form-group">
            <label for="meetingName">会议名称:</label>
            <input type="text" id="meetingName" name="meetingName" placeholder="输入会议名称" />
        </div>
        <button id="submitBtn" type="button">提交执行</button>
    </div>

    <!-- 执行结果区域 -->
    <div class="result-section">
        <h2>执行结果</h2>
        <div class="result-item">
            <span class="label">状态:</span>
            <span id="status">-</span>
        </div>
        <div class="result-item">
            <span class="label">execute_id:</span>
            <span id="executeId">-</span>
        </div>
        <div class="result-item">
            <span class="label">debug_url:</span>
            <a id="debugUrl" href="#" target="_blank">-</a>
        </div>
        <div class="result-item">
            <span class="label">输出:</span>
            <pre id="output">-</pre>
        </div>
    </div>

    <!-- 倒计时区域 -->
    <div class="timer-section">
        <h2>异步结果获取</h2>
        <div class="timer-display">
            <span class="label">剩余时间:</span>
            <span id="timer">05:00</span>
        </div>
        <button id="fetchResultBtn" type="button" disabled>获取异步结果</button>
    </div>
</div>

<style>
.workflow-test-container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
}

.form-section, .result-section, .timer-section {
    margin-bottom: 30px;
    padding: 20px;
    border: 1px solid #ddd;
    border-radius: 4px;
}

.form-group {
    margin-bottom: 15px;
}

.form-group label {
    display: inline-block;
    width: 100px;
}

.form-group input {
    width: 300px;
    padding: 5px;
}

button {
    padding: 8px 16px;
    cursor: pointer;
}

button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.result-item {
    margin-bottom: 10px;
}

.result-item .label {
    font-weight: bold;
    margin-right: 10px;
}

#output {
    background: #f5f5f5;
    padding: 10px;
    max-height: 200px;
    overflow-y: auto;
}

.timer-display {
    font-size: 24px;
    margin-bottom: 15px;
}
</style>

<script>
document.addEventListener('DOMContentLoaded', function() {
    const submitBtn = document.getElementById('submitBtn');
    const fetchResultBtn = document.getElementById('fetchResultBtn');
    const txtUrlInput = document.getElementById('txtUrl');
    const meetingNameInput = document.getElementById('meetingName');
    const statusEl = document.getElementById('status');
    const executeIdEl = document.getElementById('executeId');
    const debugUrlEl = document.getElementById('debugUrl');
    const outputEl = document.getElementById('output');
    const timerEl = document.getElementById('timer');

    let currentTimestamp = null;
    let timerInterval = null;
    let remainingSeconds = 300; // 5分钟

    // 提交执行
    submitBtn.addEventListener('click', async function() {
        const txtUrl = txtUrlInput.value.trim();
        const meetingName = meetingNameInput.value.trim();

        if (!txtUrl || !meetingName) {
            alert('请填写所有字段');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = '执行中...';

        try {
            const response = await fetch('/saler-plugins/api/coze/meeting-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ txtUrl, meetingName, waitForCompletion: false })
            });

            const result = await response.json();

            if (result.success) {
                const data = result.data;
                statusEl.textContent = '已提交';
                executeIdEl.textContent = data.execute_id || '-';
                debugUrlEl.textContent = data.debug_url || '-';
                debugUrlEl.href = data.debug_url || '#';
                outputEl.textContent = JSON.stringify(data, null, 2);

                // 保存到 history.json
                const saveResponse = await fetch('/saler-plugins/workflow-test/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        txtUrl,
                        meetingName,
                        executeResponse: data
                    })
                });

                const saveResult = await saveResponse.json();
                if (saveResult.success) {
                    currentTimestamp = new Date().toISOString();
                    startTimer();
                }
            } else {
                statusEl.textContent = '失败: ' + (result.error || '未知错误');
            }
        } catch (error) {
            statusEl.textContent = '请求失败: ' + error.message;
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '提交执行';
        }
    });

    // 启动倒计时
    function startTimer() {
        remainingSeconds = 300;
        fetchResultBtn.disabled = true;
        updateTimerDisplay();

        timerInterval = setInterval(function() {
            remainingSeconds--;
            updateTimerDisplay();

            if (remainingSeconds <= 0) {
                clearInterval(timerInterval);
                fetchResultBtn.disabled = false;
                timerEl.textContent = '00:00';
            }
        }, 1000);
    }

    // 更新计时器显示
    function updateTimerDisplay() {
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        timerEl.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }

    // 获取异步结果
    fetchResultBtn.addEventListener('click', async function() {
        const executeId = executeIdEl.textContent;
        if (!executeId || executeId === '-') {
            alert('无可用的 execute_id');
            return;
        }

        fetchResultBtn.disabled = true;
        fetchResultBtn.textContent = '获取中...';

        try {
            // 需要从配置或上下文获取 workflowId
            const workflowId = ''; // TODO: 从后端获取或前端配置
            const response = await fetch(`/saler-plugins/api/coze/workflow-result/${workflowId}/${executeId}`);
            const result = await response.json();

            if (result.success) {
                outputEl.textContent = JSON.stringify(result.data, null, 2);
                statusEl.textContent = result.data.status || '完成';

                // 更新 history.json
                if (currentTimestamp) {
                    await fetch('/saler-plugins/workflow-test/async-result', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            timestamp: currentTimestamp,
                            asyncResult: result.data
                        })
                    });
                }
            } else {
                outputEl.textContent = '获取失败: ' + (result.error || '未知错误');
            }
        } catch (error) {
            outputEl.textContent = '请求失败: ' + error.message;
        } finally {
            fetchResultBtn.disabled = false;
            fetchResultBtn.textContent = '获取异步结果';
        }
    });
});
</script>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/workflow-test.hbs
git commit -m "feat: add workflow-test page template"
```

---

## Task 4: Register route in app.js

**Files:** Modify: `src/app.js`

- [ ] **Step 1: Add route registration**

After the existing route scanning code (around line 79), add:

```javascript
// Manual route for workflow-test page
const workflowTestRouter = require('./routes/workflow-test');
app.use('/workflow-test', workflowTestRouter);
```

- [ ] **Step 2: Commit**

```bash
git add src/app.js
git commit -m "feat: register workflow-test route"
```

---

## Task 5: Create initial history.json

**File:** Create: `data/runtime/history.json`

- [ ] **Step 1: Write empty JSON**

```json
{}
```

- [ ] **Step 2: Commit**

```bash
git add data/runtime/history.json
git commit -m "feat: add runtime history.json"
```

---

## Task 6: Verify

- [ ] **Step 1: 启动服务**

Run: `npm run dev` 或 `node src/app.js`

- [ ] **Step 2: 访问页面**

Open: `http://localhost:3000/workflow-test`

- [ ] **Step 3: 测试提交流程**

填写 TXT 链接和会议名称，点击提交，检查：
- 执行结果区域显示返回数据
- `data/runtime/history.json` 生成记录
- 5分钟倒计时启动

- [ ] **Step 4: 测试异步结果获取**

等待倒计时结束或手动修改 remainingSeconds 为 0，点击「获取异步结果」，检查 history.json 更新
