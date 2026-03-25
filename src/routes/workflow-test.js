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
        subTitle: 'Coze 会议分析工作流测试工具',
        workflowId: process.env.COZE_MEETING_WORKFLOW_ID || ''
    });
});

/**
 * POST /workflow-test/save
 * 保存提交参数到 history.json
 * 支持增量更新：通过 timestamp 匹配已有记录
 */
router.post('/save', async (req, res) => {
    try {
        const { timestamp, meetingName, fileId, fileName, executeResponse, uploadResponse } = req.body;
        const history = readHistory();

        // 使用前端传来的 timestamp 或生成新的
        const key = timestamp || new Date().toISOString();
        const existing = history[key] || {};

        const record = {
            timestamp: key,
            input: {
                fileId: fileId || existing.input?.fileId,
                fileName: fileName || existing.input?.fileName,
                meetingName: meetingName || existing.input?.meetingName
            },
            uploadResponse: uploadResponse || existing.uploadResponse,
            executeResponse: executeResponse || existing.executeResponse,
            asyncResult: existing.asyncResult || null
        };

        history[key] = record;
        writeHistory(history);

        res.json({ success: true, timestamp: key });
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
