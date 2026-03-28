/* ========================================
   Claude Code 任务管理 - 前端逻辑
   ======================================== */

const API_BASE = '/saler-plugins/api/claude';

// Skill 列表（动态从服务器加载）
let SKILLS = [{ value: '', label: '-- 不指定 Skill --' }];

// 默认工作目录（按需修改）
const DEFAULT_WORK_DIR = 'C:/Users/18601/Desktop/workflow';

// 全局状态
const state = {
  tasks: [],
  currentTaskId: null,
  taskOutputs: {},     // taskId -> { text: '', events: [] }
  activeReaders: {},   // taskId -> ReadableStream reader
  emptyStateEl: null,  // 缓存 emptyState 元素，防止被 innerHTML='' 销毁
};

// ---- 初始化 ----
document.addEventListener('DOMContentLoaded', function () {
  state.emptyStateEl = document.getElementById('emptyState');
  initDropdowns();
  bindEvents();
  loadTasks(true);
});

function initDropdowns() {
  document.getElementById('inputWorkDir').value = DEFAULT_WORK_DIR;

  // 动态加载服务器 ~/.claude/skills 目录下的 skill 列表
  fetch(API_BASE + '/skills')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var skillSelect = document.getElementById('inputSkill');
      skillSelect.innerHTML = '';
      SKILLS = [{ value: '', label: '-- 不指定 Skill --' }].concat(data.skills || []);
      SKILLS.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.value;
        opt.textContent = s.label;
        skillSelect.appendChild(opt);
      });
      // 默认选中 video-report-generator
      skillSelect.value = 'video-report-generator';
    })
    .catch(function () {
      // 加载失败时保留默认空选项，不影响其他功能
    });
}

function bindEvents() {
  document.getElementById('btnNewTask').addEventListener('click', showModal);
  document.getElementById('btnRefresh').addEventListener('click', function () { loadTasks(true); });
  document.getElementById('btnCloseModal').addEventListener('click', hideModal);
  document.getElementById('btnCancelModal').addEventListener('click', hideModal);
  document.getElementById('btnCancelTask').addEventListener('click', handleCancelTask);
  document.getElementById('btnDeleteTask').addEventListener('click', handleDeleteTask);
  var resumeBtn = document.getElementById('btnResumeTask');
  if (resumeBtn) resumeBtn.addEventListener('click', handleResumeTask);
  var retryBtn = document.getElementById('btnRetryTask');
  if (retryBtn) retryBtn.addEventListener('click', handleRetryTask);
  document.getElementById('btnClearOutput').addEventListener('click', clearOutput);
  document.getElementById('newTaskForm').addEventListener('submit', handleCreateTask);

  document.getElementById('modalOverlay').addEventListener('click', function (e) {
    if (e.target === this) hideModal();
  });
}

// ---- API 调用 ----
var _loadTasksTimer = null;

function loadTasks(immediate) {
  if (_loadTasksTimer) clearTimeout(_loadTasksTimer);
  var delay = immediate ? 0 : 300;
  _loadTasksTimer = setTimeout(function () {
    _loadTasksTimer = null;
    _doLoadTasks();
  }, delay);
}

function _doLoadTasks() {
  fetch(API_BASE + '/', {
    headers: { 'Accept': 'application/json' }
  })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      state.tasks = data.tasks || [];

      // 清理前端已不存在于后端的 taskOutputs，避免内存无限增长
      var liveIds = {};
      state.tasks.forEach(function (t) { liveIds[t.id] = true; });
      Object.keys(state.taskOutputs).forEach(function (id) {
        if (!liveIds[id]) delete state.taskOutputs[id];
      });

      renderTaskList();
      document.getElementById('taskCount').textContent = state.tasks.length;
      if (state.currentTaskId) {
        refreshTaskDetail(state.currentTaskId);
      }
    })
    .catch(function () {
      // 静默失败，不弹 toast 打扰用户
    });
}

function handleCreateTask(e) {
  e.preventDefault();

  var name = document.getElementById('inputName').value.trim();
  var prompt = document.getElementById('inputPrompt').value.trim();
  var workDir = document.getElementById('inputWorkDir').value.trim();
  var pipelineId = document.getElementById('inputPipelineId').value.trim();
  var skill = document.getElementById('inputSkill').value;
  var filesInput = document.getElementById('inputFiles');

  if (!name || !prompt || !workDir || !pipelineId) {
    showToast('请填写任务名称、任务描述、工作目录和任务编号', 'error');
    return;
  }

  // 防重复提交
  var submitBtn = document.querySelector('#newTaskForm button[type="submit"]');
  if (submitBtn && submitBtn.disabled) return;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提交中…'; }

  var formData = new FormData();
  formData.append('name', name);
  formData.append('prompt', prompt);
  formData.append('workDir', workDir);
  if (pipelineId) formData.append('pipelineId', pipelineId);
  if (skill) formData.append('skill', skill);

  if (filesInput.files.length > 0) {
    for (var i = 0; i < filesInput.files.length; i++) {
      formData.append('files', filesInput.files[i]);
    }
  }

  hideModal();
  document.getElementById('newTaskForm').reset();
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交'; }

  fetch(API_BASE + '/', { method: 'POST', body: formData })
    .then(function (response) {
      if (!response.ok) {
        return response.json().then(function (err) {
          throw new Error(err.error || '创建任务失败');
        });
      }

      var taskId = response.headers.get('X-Task-Id');
      if (taskId) {
        state.taskOutputs[taskId] = { text: '', events: [] };
        state.currentTaskId = taskId;
      }

      startSSEReader(taskId, response);
      showTaskDetail(taskId);
      showToast('任务已创建', 'success');

      loadTasks();
    })
    .catch(function (err) {
      showToast('创建任务失败: ' + err.message, 'error');
    });
}

function handleCancelTask() {
  var taskId = state.currentTaskId;
  if (!taskId) return;

  if (!confirm('确定要取消这个任务吗？')) return;

  fetch(API_BASE + '/' + taskId + '/cancel', { method: 'POST' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.success) {
        showToast('任务已取消', 'info');
        loadTasks();
        refreshTaskDetail(taskId);
      } else {
        showToast(data.error || '取消失败', 'error');
      }
    })
    .catch(function (err) {
      showToast('取消任务失败: ' + err.message, 'error');
    });
}

function handleDeleteTask() {
  var taskId = state.currentTaskId;
  if (!taskId) return;

  var task = state.tasks.find(function (t) { return t.id === taskId; });
  var isRunning = task && (task.status === 'running' || task.status === 'pending');
  var confirmMsg = isRunning
    ? '任务正在执行中，删除将强制取消并清除所有记录，确定吗？'
    : '确定要删除这个任务吗？此操作不可撤销。';

  if (!confirm(confirmMsg)) return;

  fetch(API_BASE + '/' + taskId, { method: 'DELETE' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.success) {
        // 清理前端缓存
        delete state.taskOutputs[taskId];
        if (state.activeReaders[taskId]) {
          try { state.activeReaders[taskId].cancel(); } catch (e) { /* ignore */ }
          delete state.activeReaders[taskId];
        }
        state.currentTaskId = null;

        // 隐藏右侧详情面板
        document.getElementById('detailContent').style.display = 'none';
        document.getElementById('detailPlaceholder').style.display = 'flex';

        showToast('任务已删除', 'info');
        loadTasks(true);
      } else {
        showToast(data.error || '删除失败', 'error');
      }
    })
    .catch(function (err) {
      showToast('删除任务失败: ' + err.message, 'error');
    });
}

// ---- 续接任务 ----
function handleResumeTask() {
  var taskId = state.currentTaskId;
  if (!taskId) return;

  if (!confirm('将从任务中断处续接执行，确定吗？')) return;

  fetch(API_BASE + '/' + taskId + '/resume', { method: 'POST' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.success) {
        showToast('任务续接中…', 'info');
        // 清理旧的 SSE 连接，重新订阅
        if (state.activeReaders[taskId]) {
          try { state.activeReaders[taskId].cancel(); } catch (e) { /* ignore */ }
          delete state.activeReaders[taskId];
        }
        loadTasks();
        subscribeToStream(taskId);
      } else {
        showToast(data.error || '续接失败', 'error');
      }
    })
    .catch(function (err) {
      showToast('续接任务失败: ' + err.message, 'error');
    });
}

function handleRetryTask() {
  var taskId = state.currentTaskId;
  if (!taskId) return;

  if (!confirm('将用相同参数重新创建并执行任务，确定吗？')) return;

  fetch(API_BASE + '/' + taskId + '/retry', { method: 'POST' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.success) {
        showToast('已创建新任务，执行中…', 'info');
        loadTasks();
        // 切换到新任务
        if (data.newTaskId) {
          state.currentTaskId = data.newTaskId;
          subscribeToStream(data.newTaskId);
        }
      } else {
        showToast(data.error || '重新执行失败', 'error');
      }
    })
    .catch(function (err) {
      showToast('重新执行失败: ' + err.message, 'error');
    });
}

// ---- SSE 流式读取 ----
function startSSEReader(taskId, response) {
  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '';

  state.activeReaders[taskId] = reader;

  if (!state.taskOutputs[taskId]) {
    state.taskOutputs[taskId] = { text: '', events: [] };
  }

  function flushBuffer(tid, buf) {
    var blocks = buf.split('\n\n');
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].trim()) processSSELines(tid, blocks[i]);
    }
  }

  function processChunk() {
    reader.read().then(function (result) {
      if (result.done) {
        if (buffer.trim()) flushBuffer(taskId, buffer);
        delete state.activeReaders[taskId];
        loadTasks();
        return;
      }

      buffer += decoder.decode(result.value, { stream: true });
      var lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (var i = 0; i < lines.length; i++) {
        if (lines[i].trim()) processSSELines(taskId, lines[i]);
      }

      processChunk();
    }).catch(function () {
      delete state.activeReaders[taskId];
      loadTasks();
    });
  }

  processChunk();
}

function processSSELines(taskId, chunk) {
  var lines = chunk.split('\n');
  var eventType = '';
  var dataStr = '';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf('event: ') === 0) {
      eventType = line.substring(7);
    } else if (line.indexOf('data: ') === 0) {
      dataStr = line.substring(6);
    }
  }

  if (!dataStr) return;

  var data;
  try {
    data = JSON.parse(dataStr);
  } catch (e) {
    return;
  }

  var output = state.taskOutputs[taskId];
  if (!output) return;

  output.events.push({ event: eventType, data: data });

  switch (eventType) {
    case 'init':
      appendToolEvent(taskId, '任务启动', 'ID: ' + data.taskId);
      break;

    case 'text':
      if (data.content) {
        output.text += data.content;
        renderOutput(taskId);
      }
      break;

    case 'text_delta':
      if (data.text) {
        output.text += data.text;
        renderOutput(taskId);
      }
      break;

    case 'tool_use':
    case 'tool_start':
      appendToolEvent(taskId, '调用工具: ' + data.name, JSON.stringify(data.input || '').substring(0, 80));
      break;

    case 'tool_result':
      appendToolEvent(taskId, '工具结果', '');
      break;

    case 'status':
      appendToolEvent(taskId, '状态变更: ' + data.status, '');
      updateTaskStatus(taskId, data.status);
      break;

    case 'error':
      appendToolEvent(taskId, '错误: ' + (data.error || '未知错误'), '');
      break;

    case 'result':
      if (data.result) {
        output.text += '\n\n---\n\n' + data.result;
        renderOutput(taskId);
      }
      break;

    case 'done':
      appendToolEvent(taskId, '任务完成', '');
      loadTasks();
      break;
  }
}

function appendToolEvent(taskId, title, detail) {
  if (state.currentTaskId !== taskId) return;

  var container = document.getElementById('outputContent');
  var div = document.createElement('div');
  div.className = 'ct-tool-event';
  div.innerHTML = '<span class="ct-tool-event-icon">⚙</span><strong>' +
    escapeHtml(title) + '</strong>' +
    (detail ? ' <span style="opacity:0.7">' + escapeHtml(detail) + '</span>' : '');
  container.appendChild(div);
  scrollOutputToBottom();
}

function updateTaskStatus(taskId, newStatus) {
  var task = state.tasks.find(function (t) { return t.id === taskId; });
  if (task) {
    task.status = newStatus;
    if (newStatus === 'completed' || newStatus === 'cancelled' || newStatus === 'error') {
      task.endTime = Date.now();
    }
  }
  renderTaskList();
  if (state.currentTaskId === taskId) {
    refreshTaskDetail(taskId);
  }
}

function renderOutput(taskId) {
  if (state.currentTaskId !== taskId) return;

  var output = state.taskOutputs[taskId];
  if (!output) return;

  var container = document.getElementById('outputContent');

  // 先找到所有 tool-event 元素
  var toolEvents = container.querySelectorAll('.ct-tool-event');

  // 找到或创建 Markdown 容器
  var mdContainer = container.querySelector('.ct-md-content');
  if (!mdContainer) {
    mdContainer = document.createElement('div');
    mdContainer.className = 'ct-md-content';
    container.appendChild(mdContainer);
  }

  // 渲染 Markdown
  if (typeof marked !== 'undefined') {
    mdContainer.innerHTML = marked.parse(output.text);
  } else {
    mdContainer.innerHTML = '<pre>' + escapeHtml(output.text) + '</pre>';
  }

  // 把 tool events 移到最前面（保持顺序）
  for (var i = toolEvents.length - 1; i >= 0; i--) {
    container.insertBefore(toolEvents[i], container.firstChild);
  }

  scrollOutputToBottom();
}

function scrollOutputToBottom() {
  var outputArea = document.getElementById('outputArea');
  outputArea.scrollTop = outputArea.scrollHeight;
}

// ---- UI 渲染 ----
function renderTaskList() {
  var container = document.getElementById('taskList');
  var empty = state.emptyStateEl;

  // 清空前先把 emptyState 从 container 里取出来，防止被 innerHTML='' 销毁
  if (empty && empty.parentNode === container) {
    container.removeChild(empty);
  }

  if (state.tasks.length === 0) {
    container.innerHTML = '';
    if (empty) {
      container.appendChild(empty);
      empty.style.display = 'block';
    }
    return;
  }

  if (empty) empty.style.display = 'none';
  container.innerHTML = '';

  state.tasks.forEach(function (task) {
    var card = document.createElement('div');
    card.className = 'ct-task-card' + (task.id === state.currentTaskId ? ' active' : '');
    card.setAttribute('data-task-id', task.id);

    var promptPreview = task.prompt.length > 50 ? task.prompt.substring(0, 50) + '...' : task.prompt;
    var timeStr = formatTime(task.startTime);

    card.innerHTML =
      '<div class="ct-task-card-header">' +
        createStatusBadge(task.status) +
      '</div>' +
      '<div class="ct-task-card-prompt">' + escapeHtml(task.name || promptPreview) + '</div>' +
      '<div class="ct-task-card-meta">' +
        '<span>' + timeStr + '</span>' +
        (task.skill ? '<span class="ct-task-card-skill">' + escapeHtml(task.skill) + '</span>' : '') +
      '</div>';

    card.addEventListener('click', function () {
      showTaskDetail(task.id);
    });

    container.appendChild(card);
  });
}

function showTaskDetail(taskId) {
  state.currentTaskId = taskId;

  document.getElementById('detailPlaceholder').style.display = 'none';
  document.getElementById('detailContent').style.display = 'flex';

  refreshTaskDetail(taskId);

  // 渲染已有的内存输出
  var outputContent = document.getElementById('outputContent');
  outputContent.innerHTML = '';

  var output = state.taskOutputs[taskId];
  if (output) {
    output.events.forEach(function (evt) {
      if (evt.event === 'text' || evt.event === 'text_delta' || evt.event === 'result') return;
      if (evt.event === 'init' || evt.event === 'tool_use' || evt.event === 'tool_start' ||
          evt.event === 'status' || evt.event === 'error' || evt.event === 'done') {
        var title = evt.event;
        if (evt.data && evt.data.name) title = '调用工具: ' + evt.data.name;
        if (evt.data && evt.data.status) title = '状态: ' + evt.data.status;
        if (evt.data && evt.data.error) title = '错误: ' + evt.data.error;
        appendToolEvent(taskId, title, '');
      }
    });
    renderOutput(taskId);
  }

  // 如果没有活跃的 SSE 连接（外部任务或页面刷新后的旧任务），主动订阅 /stream
  if (!state.activeReaders[taskId]) {
    subscribeToStream(taskId);
  }

  renderTaskList();
}

// 主动订阅任意任务的 SSE 流（支持历史回放）
function subscribeToStream(taskId) {
  if (state.activeReaders[taskId]) return; // 已有连接，跳过

  if (!state.taskOutputs[taskId]) {
    state.taskOutputs[taskId] = { text: '', events: [] };
  }

  fetch(API_BASE + '/' + taskId + '/stream')
    .then(function (response) {
      if (!response.ok) return; // 任务不存在等情况，静默处理
      startSSEReader(taskId, response);
    })
    .catch(function () {});
}

function refreshTaskDetail(taskId) {
  var task = state.tasks.find(function (t) { return t.id === taskId; });

  if (task) {
    fillTaskInfo(task);
  } else {
    fetch(API_BASE + '/' + taskId + '/status')
      .then(function (res) { return res.json(); })
      .then(function (data) { fillTaskInfo(data); })
      .catch(function () {});
  }
}

function fillTaskInfo(task) {
  document.getElementById('infoTaskId').textContent = task.id ? task.id.substring(0, 8) + '...' : '-';
  document.getElementById('infoTaskId').title = task.id || '';
  document.getElementById('infoStatus').innerHTML = createStatusBadge(task.status);
  document.getElementById('infoSkill').textContent = task.skill || '无';
  document.getElementById('infoWorkDir').textContent = task.workDir || '-';
  document.getElementById('infoPrompt').textContent = task.prompt || '-';
  document.getElementById('infoStartTime').textContent = task.startTime ? formatTime(task.startTime) : '-';

  var cancelBtn = document.getElementById('btnCancelTask');
  cancelBtn.style.display = (task.status === 'running' || task.status === 'pending') ? 'inline-flex' : 'none';

  // 续接按钮：已取消或报错，且有 sessionId 时显示
  var resumeBtn = document.getElementById('btnResumeTask');
  if (resumeBtn) {
    var canResume = (task.status === 'cancelled' || task.status === 'error') && !!task.sessionId;
    resumeBtn.style.display = canResume ? 'inline-flex' : 'none';
  }
  // 重新执行按钮：已取消或报错，且没有 sessionId 时显示
  var retryBtn = document.getElementById('btnRetryTask');
  if (retryBtn) {
    var canRetry = (task.status === 'cancelled' || task.status === 'error') && !task.sessionId;
    retryBtn.style.display = canRetry ? 'inline-flex' : 'none';
  }
}

function createStatusBadge(status) {
  var labels = {
    pending: '等待中',
    running: '运行中',
    completed: '已完成',
    cancelled: '已取消',
    error: '错误'
  };
  return '<span class="ct-status ct-status-' + status + '">' +
    '<span class="ct-status-dot"></span>' +
    (labels[status] || status) +
  '</span>';
}

function clearOutput() {
  var taskId = state.currentTaskId;
  if (taskId && state.taskOutputs[taskId]) {
    state.taskOutputs[taskId] = { text: '', events: [] };
  }
  document.getElementById('outputContent').innerHTML = '';
}

// ---- 弹窗 ----
function showModal() {
  document.getElementById('modalOverlay').style.display = 'flex';
  document.getElementById('inputPrompt').focus();
}

function hideModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

// ---- 通知 ----
function showToast(message, type) {
  type = type || 'info';
  var toast = document.createElement('div');
  toast.className = 'ct-toast ct-toast-' + type;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(function () {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(function () { toast.remove(); }, 300);
  }, 3000);
}

// ---- 工具函数 ----
function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  var d = new Date(timestamp);
  var pad = function (n) { return n < 10 ? '0' + n : n; };
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
