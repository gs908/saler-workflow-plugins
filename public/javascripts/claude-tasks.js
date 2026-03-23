/* ========================================
   Claude Code 任务管理 - 前端逻辑
   ======================================== */

const API_BASE = '/saler-plugins/api/claude';

// Skill 手动配置列表（按需修改）
const SKILLS = [
  { value: '', label: '-- 不指定 Skill --' },
  { value: 'video-report-generator', label: 'video-report-generator - 根据报告生成视频' },
  { value: 'deep-interview', label: 'Deep Interview - 深度需求采访' },
  { value: 'doc-coauthoring', label: 'Doc Coauthoring - 文档协作' },
  { value: 'planning-with-files', label: 'Planning - 文件规划' },
  { value: 'frontend-design', label: 'Frontend Design - 前端设计' },
  { value: 'webapp-testing', label: 'WebApp Testing - 应用测试' },
];

// 默认工作目录（按需修改）
const DEFAULT_WORK_DIR = 'C:/Users/18601/Desktop/workflow';

// 全局状态
const state = {
  tasks: [],
  currentTaskId: null,
  taskOutputs: {},     // taskId -> { text: '', events: [] }
  activeReaders: {},   // taskId -> ReadableStream reader
};

// ---- 初始化 ----
document.addEventListener('DOMContentLoaded', function () {
  initDropdowns();
  bindEvents();
  loadTasks(true);
});

function initDropdowns() {
  var skillSelect = document.getElementById('inputSkill');
  SKILLS.forEach(function (s) {
    var opt = document.createElement('option');
    opt.value = s.value;
    opt.textContent = s.label;
    skillSelect.appendChild(opt);
  });

  document.getElementById('inputWorkDir').value = DEFAULT_WORK_DIR;
}

function bindEvents() {
  document.getElementById('btnNewTask').addEventListener('click', showModal);
  document.getElementById('btnRefresh').addEventListener('click', function () { loadTasks(true); });
  document.getElementById('btnCloseModal').addEventListener('click', hideModal);
  document.getElementById('btnCancelModal').addEventListener('click', hideModal);
  document.getElementById('btnCancelTask').addEventListener('click', handleCancelTask);
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

  var prompt = document.getElementById('inputPrompt').value.trim();
  var workDir = document.getElementById('inputWorkDir').value.trim();
  var skill = document.getElementById('inputSkill').value;
  var filesInput = document.getElementById('inputFiles');

  if (!prompt || !workDir) {
    showToast('请填写任务描述和工作目录', 'error');
    return;
  }

  var formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('workDir', workDir);
  if (skill) formData.append('skill', skill);

  if (filesInput.files.length > 0) {
    for (var i = 0; i < filesInput.files.length; i++) {
      formData.append('files', filesInput.files[i]);
    }
  }

  hideModal();
  document.getElementById('newTaskForm').reset();

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

// ---- SSE 流式读取 ----
function startSSEReader(taskId, response) {
  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '';

  state.activeReaders[taskId] = reader;

  if (!state.taskOutputs[taskId]) {
    state.taskOutputs[taskId] = { text: '', events: [] };
  }

  showTaskDetail(taskId);

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
  var empty = document.getElementById('emptyState');

  if (state.tasks.length === 0) {
    container.innerHTML = '';
    container.appendChild(empty);
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
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
      '<div class="ct-task-card-prompt">' + escapeHtml(promptPreview) + '</div>' +
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

  // 渲染已有的输出
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

  renderTaskList();
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
