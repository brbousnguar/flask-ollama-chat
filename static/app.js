(function () {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("user-input");
  const messagesEl = document.getElementById("messages");
  const emptyState = document.getElementById("empty-state");
  const typingIndicator = document.getElementById("typing-indicator");
  const statusEl = document.getElementById("status");
  const sendBtn = document.getElementById("send-btn");
  const stopBtn = document.getElementById("stop-btn");
  const newChatBtn = document.getElementById("new-chat-btn");
  const newChatBtnBottom = document.getElementById("new-chat-btn-bottom");
  const modelSelect        = document.getElementById("model-select");
  const modelDropdownBtn   = document.getElementById("model-dropdown-btn");
  const modelDropdownList  = document.getElementById("model-dropdown-list");
  const modelDropdownCurrent = document.getElementById("model-dropdown-current");
  let _dropdownOpen = false;
  const inputRow = document.querySelector('.input-row');
  const historyList = document.getElementById("history-list");
  const downloadChatsBtn = document.getElementById("download-chats-btn");
  const newChatSidebarBtn = document.getElementById("new-chat-sidebar-btn");
  const memoryBtn = document.getElementById("memory-btn");
  const memoryPanel = document.getElementById("memory-panel");
  const memoryClose = document.getElementById("memory-close");
  const memoryInput = document.getElementById("memory-input");
  const memorySave = document.getElementById("memory-save");
  const memoryClear = document.getElementById("memory-clear");

  let conversation = [];
  let localSessions = [];
  let activeSessionId = null;
  let personalMemory = "";
  let activeRequestController = null;
  let activeRequestId = null;
  let isGenerating = false;

  // shared state for models panel (populated by loadModels)
  let _localModels = [];
  let _libraryModels = [];
  let _libraryLoaded = false;
  const MODEL_PREFERENCE_KEY = 'preferredModel';
  const CHAT_SESSIONS_KEY = 'localChatSessions';
  const ACTIVE_CHAT_SESSION_KEY = 'activeLocalChatSessionId';
  const PERSONAL_MEMORY_KEY = 'personalAssistantMemory';

  function genRequestId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    return 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  // ── Chat rendering ────────────────────────────────────────────────────────

  function renderMessages() {
    while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
    if (emptyState) messagesEl.appendChild(emptyState);
    if (!conversation.length) { showEmptyState(true); return; }
    showEmptyState(false);
    conversation.forEach((m, index) => {
      if (m.role === 'system') return;
      messagesEl.appendChild(createMessageNode(m.role, m.content, { index }));
    });
    scrollToBottom();
  }

  function canRewriteMessage(index) {
    return (
      index > 0 &&
      conversation[index] &&
      conversation[index].role === 'assistant' &&
      conversation[index - 1] &&
      conversation[index - 1].role === 'user'
    );
  }

  function genSessionId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    return 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  function cloneConversation(messages) {
    return (Array.isArray(messages) ? messages : [])
      .filter(message => message && typeof message.role === 'string' && typeof message.content === 'string')
      .map(message => ({ role: message.role, content: message.content }));
  }

  function getSessionTitle(messages) {
    const firstUserMessage = (messages || []).find(message => message.role === 'user' && message.content.trim());
    if (!firstUserMessage) return 'New Chat';
    const compact = firstUserMessage.content.replace(/\s+/g, ' ').trim();
    return compact.length > 34 ? compact.slice(0, 34).trimEnd() + '…' : compact;
  }

  function formatSessionTime(value) {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch (e) {
      return '';
    }
  }

  function persistLocalSessions() {
    try {
      localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(localSessions));
      if (activeSessionId) localStorage.setItem(ACTIVE_CHAT_SESSION_KEY, activeSessionId);
      else localStorage.removeItem(ACTIVE_CHAT_SESSION_KEY);
    } catch (e) {}
  }

  function loadPersonalMemory() {
    try {
      return (localStorage.getItem(PERSONAL_MEMORY_KEY) || '').trim();
    } catch (e) {
      return '';
    }
  }

  function savePersonalMemory(value) {
    personalMemory = (value || '').trim();
    try {
      if (personalMemory) localStorage.setItem(PERSONAL_MEMORY_KEY, personalMemory);
      else localStorage.removeItem(PERSONAL_MEMORY_KEY);
    } catch (e) {}
    updateMemoryButtonState();
  }

  function updateMemoryButtonState() {
    if (!memoryBtn) return;
    memoryBtn.classList.toggle('has-memory', !!personalMemory);
    memoryBtn.textContent = personalMemory ? 'Memory On' : 'Memory';
  }

  function openMemoryPanel() {
    if (!memoryPanel) return;
    memoryPanel.setAttribute('aria-hidden', 'false');
    if (memoryBtn) memoryBtn.setAttribute('aria-expanded', 'true');
    if (memoryInput) {
      memoryInput.value = personalMemory;
      memoryInput.focus();
      memoryInput.setSelectionRange(memoryInput.value.length, memoryInput.value.length);
    }
  }

  function closeMemoryPanel() {
    if (!memoryPanel) return;
    memoryPanel.setAttribute('aria-hidden', 'true');
    if (memoryBtn) memoryBtn.setAttribute('aria-expanded', 'false');
  }

  function renderHistoryList() {
    if (!historyList) return;
    historyList.innerHTML = '';

    if (!localSessions.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'Your browser-saved chats will appear here.';
      historyList.appendChild(empty);
      return;
    }

    localSessions.forEach(session => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'history-item' + (session.id === activeSessionId ? ' active' : '');
      item.dataset.sessionId = session.id;

      const title = document.createElement('span');
      title.className = 'history-item-title';
      title.textContent = session.title || 'New Chat';

      const meta = document.createElement('span');
      meta.className = 'history-item-meta';
      meta.textContent = formatSessionTime(session.updatedAt || session.createdAt);

      item.appendChild(title);
      item.appendChild(meta);
      historyList.appendChild(item);
    });
  }

  function syncCurrentSession() {
    if (!activeSessionId) return;
    const now = new Date().toISOString();
    const messages = cloneConversation(conversation);
    const existingIndex = localSessions.findIndex(session => session.id === activeSessionId);
    const base = existingIndex >= 0 ? localSessions[existingIndex] : { id: activeSessionId, createdAt: now };
    const nextSession = {
      id: base.id,
      createdAt: base.createdAt || now,
      updatedAt: now,
      title: getSessionTitle(messages),
      messages,
    };

    if (existingIndex >= 0) localSessions[existingIndex] = nextSession;
    else localSessions.unshift(nextSession);

    localSessions.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
    persistLocalSessions();
    renderHistoryList();
  }

  function createSession(options = {}) {
    const now = new Date().toISOString();
    activeSessionId = genSessionId();
    conversation = cloneConversation(options.messages || []);
    localSessions = localSessions.filter(session => session.id !== activeSessionId);
    localSessions.unshift({
      id: activeSessionId,
      title: getSessionTitle(conversation),
      createdAt: now,
      updatedAt: now,
      messages: cloneConversation(conversation),
    });
    persistLocalSessions();
    renderHistoryList();
    renderMessages();
  }

  function loadStoredSessions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CHAT_SESSIONS_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(session => ({
          id: session && session.id ? String(session.id) : genSessionId(),
          title: session && session.title ? String(session.title) : getSessionTitle(session && session.messages),
          createdAt: session && session.createdAt ? session.createdAt : new Date().toISOString(),
          updatedAt: session && session.updatedAt ? session.updatedAt : (session && session.createdAt ? session.createdAt : new Date().toISOString()),
          messages: cloneConversation(session && session.messages),
        }))
        .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
    } catch (e) {
      return [];
    }
  }

  function loadSession(sessionId) {
    const session = localSessions.find(item => item.id === sessionId);
    if (!session) return;
    activeSessionId = session.id;
    conversation = cloneConversation(session.messages);
    persistLocalSessions();
    renderHistoryList();
    renderMessages();
    resizeComposer();
    updateMessagesPadding();
    try { input.focus(); } catch (e) {}
  }

  function downloadStoredSessions() {
    if (!localSessions.length) {
      setStatus('No local chats to download', 'error');
      return;
    }

    const payload = {
      exported_at: new Date().toISOString(),
      active_session_id: activeSessionId,
      sessions: localSessions,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chat-sessions-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus('Downloaded local chats');
  }

  function createMessageNode(role, content, options = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-block ' + role;
    wrapper.setAttribute('role', 'listitem');

    const messageEl = document.createElement('div');
    messageEl.className = 'message ' + role + (options.isError ? ' error' : '');

    try {
      if (role === 'assistant' && !options.isError) messageEl.innerHTML = renderMessageContent(content);
      else messageEl.textContent = content;
    } catch (e) {
      messageEl.textContent = content;
    }

    wrapper.appendChild(messageEl);

    if (role === 'assistant' && !options.isError) {
      const actions = document.createElement('div');
      actions.className = 'message-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'message-action-btn';
      copyBtn.dataset.action = 'copy';
      copyBtn.dataset.content = content;
      copyBtn.textContent = 'Copy';
      actions.appendChild(copyBtn);

      if (typeof options.index === 'number' && canRewriteMessage(options.index)) {
        const rewriteBtn = document.createElement('button');
        rewriteBtn.type = 'button';
        rewriteBtn.className = 'message-action-btn';
        rewriteBtn.dataset.action = 'rewrite';
        rewriteBtn.dataset.index = String(options.index);
        rewriteBtn.textContent = 'Rewrite';
        actions.appendChild(rewriteBtn);
      }

      wrapper.appendChild(actions);
    }

    return wrapper;
  }

  // ── Custom model dropdown ─────────────────────────────────────────────────

  function _flagImg(origin) {
    if (!origin) return null;
    const img = document.createElement('img');
    img.src = 'https://flagcdn.com/16x12/' + origin.code + '.png';
    img.width = 16; img.height = 12;
    img.alt = origin.country; img.title = origin.country;
    img.className = 'model-flag';
    return img;
  }

  function _updateDropdownLabel(name) {
    if (!modelDropdownCurrent) return;
    modelDropdownCurrent.innerHTML = '';
    const origin = _countryFlag(name);
    const img = _flagImg(origin);
    if (img) modelDropdownCurrent.appendChild(img);
    modelDropdownCurrent.appendChild(document.createTextNode(name || 'Select model'));
  }

  function _openModelDropdown() {
    if (!modelDropdownList || _dropdownOpen) return;
    _dropdownOpen = true;
    modelDropdownList.hidden = false;
    if (modelDropdownBtn) modelDropdownBtn.setAttribute('aria-expanded', 'true');
  }

  function _closeModelDropdown() {
    if (!modelDropdownList || !_dropdownOpen) return;
    _dropdownOpen = false;
    modelDropdownList.hidden = true;
    if (modelDropdownBtn) modelDropdownBtn.setAttribute('aria-expanded', 'false');
  }

  function _selectModelDropdown(name) {
    if (modelSelect) { modelSelect.value = name; }
    _updateDropdownLabel(name);
    _savePreferredModel(name);
    // update active state in list
    if (modelDropdownList) {
      modelDropdownList.querySelectorAll('.model-dropdown-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.value === name);
      });
    }
    _closeModelDropdown();
    _renderModelsTab();
  }

  function _populateModelDropdown(models) {
    if (!modelDropdownList || !modelSelect) return;
    modelDropdownList.innerHTML = '';
    modelSelect.innerHTML = '';

    if (!models.length) {
      modelDropdownCurrent.textContent = 'No models found';
      return;
    }

    models.forEach(m => {
      const name = typeof m === 'string' ? m : (m.name || '');
      // hidden select option
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      modelSelect.appendChild(opt);

      // custom item
      const item = document.createElement('div');
      item.className = 'model-dropdown-item';
      item.setAttribute('role', 'option');
      item.dataset.value = name;
      const origin = _countryFlag(name);
      const img = _flagImg(origin);
      if (img) item.appendChild(img);
      item.appendChild(document.createTextNode(name));
      item.addEventListener('click', () => _selectModelDropdown(name));
      modelDropdownList.appendChild(item);
    });

    const preferredName = _resolvePreferredModel(models);
    _selectModelDropdown(preferredName);
  }

  if (modelDropdownBtn) {
    modelDropdownBtn.addEventListener('click', () => {
      _dropdownOpen ? _closeModelDropdown() : _openModelDropdown();
    });
  }
  document.addEventListener('click', e => {
    if (_dropdownOpen && modelDropdownBtn && !modelDropdownBtn.closest('.model-dropdown').contains(e.target)) {
      _closeModelDropdown();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _dropdownOpen) _closeModelDropdown();
  });

  // ── Model loading ─────────────────────────────────────────────────────────

  async function loadModels() {
    try {
      const res = await fetch("/models");
      const data = await res.json();
      const models = data.models || [];
      _populateModelDropdown(models);
      _localModels = models;
      if (localCount) localCount.textContent = _localModels.length;
    } catch (err) {
      if (modelDropdownCurrent) modelDropdownCurrent.textContent = 'Failed to load models';
    }
  }

  function _savePreferredModel(name) {
    try {
      localStorage.setItem(MODEL_PREFERENCE_KEY, name);
    } catch (e) {}
  }

  function _loadPreferredModel() {
    try {
      return localStorage.getItem(MODEL_PREFERENCE_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function _resolvePreferredModel(models) {
    const names = models.map(m => typeof m === 'string' ? m : (m.name || '')).filter(Boolean);
    const preferred = _loadPreferredModel();
    if (preferred && names.includes(preferred)) return preferred;
    return names[0] || '';
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function updateMessagesPadding() {
    try {
      if (!messagesEl || !inputRow) return;
      const h = inputRow.getBoundingClientRect().height;
      messagesEl.style.paddingBottom = Math.max(h + 12, 88) + 'px';
    } catch (e) {}
  }

  function resizeComposer() {
    try {
      if (!input) return;
      input.style.height = 'auto';
      const nextHeight = Math.min(input.scrollHeight, 180);
      input.style.height = nextHeight + 'px';
      input.style.overflowY = input.scrollHeight > 180 ? 'auto' : 'hidden';
      updateMessagesPadding();
    } catch (e) {}
  }

  function shouldSendOnEnter() {
    try {
      return !window.matchMedia('(pointer: coarse)').matches;
    } catch (e) {
      return true;
    }
  }

  function ensureScrolled() {
    try { messagesEl.scrollTop = messagesEl.scrollHeight; } catch (e) {}
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttribute(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderMessageContent(raw) {
    if (!raw) return '';
    let text = raw.replace(/<br\s*\/?\s*>/gi, '\n').replace(/\r\n/g, '\n');
    text = escapeHtml(text);

    text = text.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, language, code) => {
      const lang = (language || '').trim();
      const langAttr = lang ? ' data-language="' + escapeAttribute(lang) + '"' : '';
      const langLabel = lang ? '<div class="md-code-lang">' + escapeHtml(lang) + '</div>' : '';
      return '<pre class="md-code"' + langAttr + '>' + langLabel + '<code>' + code + '</code></pre>';
    });
    text = text.replace(/`([^`]+?)`/g, (_, code) =>
      '<code class="md-inline-code">' + code + '</code>');

    text = text.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, label, href) => '<a class="md-link" href="' + escapeAttribute(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
    );
    text = text.replace(
      /(^|[\s(])(https?:\/\/[^\s<]+)/g,
      (_, prefix, href) => prefix + '<a class="md-link" href="' + escapeAttribute(href) + '" target="_blank" rel="noopener noreferrer">' + href + '</a>'
    );

    text = text.replace(/^###\s*(.+)$/gm, '<h3 class="md-h3">$1</h3>');
    text = text.replace(/^##\s*(.+)$/gm, '<h4 class="md-h4">$1</h4>');
    text = text.replace(/^#\s*(.+)$/gm, '<h2 class="md-h2">$1</h2>');
    text = text.replace(/^\s*---+\s*$/gm, '<hr class="md-hr">');
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Tables
    {
      const linesArr = text.split('\n');
      const outLines = [];
      for (let i = 0; i < linesArr.length; i++) {
        const line = linesArr[i];
        if (line && line.indexOf('|') !== -1) {
          let j = i;
          const block = [];
          while (j < linesArr.length && linesArr[j] && linesArr[j].indexOf('|') !== -1) {
            block.push(linesArr[j].trim()); j++;
          }
          if (block.length >= 2) {
            const sep = block[1].replace(/\s/g, '');
            const isSep = /^[:\-|]+$/.test(sep);
            const cols = block[0].split('|').map(s => s.trim()).filter(Boolean);
            const rows = [];
            for (let k = isSep ? 2 : 1; k < block.length; k++) {
              const cleaned = block[k].split('|').map(s => s.trim());
              const filtered = cleaned.filter((_, idx) =>
                !(idx === 0 && cleaned[idx] === '') && !(idx === cleaned.length - 1 && cleaned[idx] === ''));
              if (filtered.length) rows.push(filtered);
            }
            let table = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
            cols.forEach(c => table += '<th>' + c + '</th>');
            table += '</tr></thead><tbody>';
            rows.forEach(r => {
              table += '<tr>';
              for (let ci = 0; ci < cols.length; ci++) table += '<td>' + (r[ci] || '') + '</td>';
              table += '</tr>';
            });
            table += '</tbody></table></div>';
            outLines.push(table);
            i = j - 1;
            continue;
          }
        }
        outLines.push(line);
      }
      text = outLines.join('\n');
    }

    text = text.replace(/(^|\n)(>\s?.+(\n>\s?.+)*)/g, function(_, pre, quoteBlock) {
      const content = quoteBlock
        .split('\n')
        .map(line => line.replace(/^>\s?/, ''))
        .join('<br>');
      return (pre || '') + '<blockquote class="md-blockquote">' + content + '</blockquote>';
    });

    text = text.replace(/(^|\n)([ \t]*[-\*] .+(\n[ \t]*[-\*] .+)*)/g, function(_, pre, listBlock) {
      const items = listBlock.trim().split('\n').map(l => l.replace(/^[-\*]\s?/, ''));
      return (pre || '') + '<ul class="md-ul">' + items.map(i => '<li>' + i + '</li>').join('') + '</ul>';
    });
    text = text.replace(/(^|\n)([ \t]*\d+\. .+(\n[ \t]*\d+\. .+)*)/g, function(_, pre, listBlock) {
      const items = listBlock.trim().split('\n').map(l => l.replace(/^\d+\.\s?/, ''));
      return (pre || '') + '<ol class="md-ol">' + items.map(i => '<li>' + i + '</li>').join('') + '</ol>';
    });

    const parts = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    return parts.map(p => {
      if (/^<(h2|h3|h4|pre|div|ul|ol|table|blockquote|hr)/.test(p)) return p;
      return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
  }

  function startNewChat() {
    const activeSession = localSessions.find(session => session.id === activeSessionId);
    if (activeSession && !(activeSession.messages && activeSession.messages.length)) {
      conversation = [];
      renderMessages();
      renderHistoryList();
      try { input.focus(); } catch (e) {}
      return;
    }

    createSession({ messages: [] });
    try { input.focus(); } catch (e) {}
  }

  function setStatus(text, type = "") {
    statusEl.textContent = text;
    statusEl.className = "status" + (type ? " " + type : "");
  }

  function showEmptyState(show) {
    if (emptyState) emptyState.classList.toggle("hidden", !show);
  }

  function showTyping(show) {
    typingIndicator.hidden = !show;
    typingIndicator.setAttribute("aria-hidden", show ? "false" : "true");
    if (show) scrollToBottom();
  }

  function setGeneratingState(generating) {
    isGenerating = generating;
    sendBtn.hidden = generating;
    stopBtn.hidden = !generating;
    input.disabled = generating;
    if (newChatBtn) newChatBtn.disabled = generating;
    if (newChatBtnBottom) newChatBtnBottom.disabled = generating;
  }

  async function stopGeneration() {
    if (!isGenerating) return;

    const requestId = activeRequestId;

    try {
      if (activeRequestController) activeRequestController.abort();
    } catch (e) {}

    activeRequestController = null;
    activeRequestId = null;
    setGeneratingState(false);
    showTyping(false);
    setStatus("Stopped");

    if (requestId) {
      fetch("/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      }).catch(() => {});
    }
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, content, isError = false) {
    showEmptyState(false);
    const node = createMessageNode(role, content, { isError });
    messagesEl.appendChild(node);
    scrollToBottom();
    return node;
  }

  function createStreamingMessage() {
    showEmptyState(false);
    const node = createMessageNode("assistant", "", {});
    messagesEl.appendChild(node);
    scrollToBottom();
    return {
      wrapper: node,
      content: node.querySelector(".message.assistant"),
    };
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}

    try {
      const temp = document.createElement('textarea');
      temp.value = text;
      temp.setAttribute('readonly', '');
      temp.style.position = 'absolute';
      temp.style.left = '-9999px';
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function rewriteAssistantMessage(index) {
    if (isGenerating || !canRewriteMessage(index)) return;
    conversation = conversation.slice(0, index);
    syncCurrentSession();
    renderMessages();
    await generateAssistantReply();
  }

  async function generateAssistantReply() {
    const model = modelSelect ? modelSelect.value : "";
    if (!model) {
      addMessage("assistant", "Please select a model.", true);
      return;
    }

    const requestController = new AbortController();
    const requestId = genRequestId();
    activeRequestController = requestController;
    activeRequestId = requestId;
    setGeneratingState(true);
    showTyping(true);
    setStatus("");

    const streamingMessage = createStreamingMessage();
    const messageEl = streamingMessage.content;
    let fullContent = "";
    let receivedFirstChunk = false;
    let stoppedByUser = false;

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversation,
          model,
          request_id: requestId,
          memory: personalMemory,
        }),
        signal: requestController.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showTyping(false);
        streamingMessage.wrapper.remove();
        addMessage("assistant", err.error || "Request failed", true);
        setStatus("", "error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const data = JSON.parse(payload);
            if (data.error) {
              showTyping(false);
              streamingMessage.wrapper.remove();
              addMessage("assistant", data.error, true);
              setStatus("", "error");
              return;
            }
            if (data.content) {
              if (!receivedFirstChunk) {
                receivedFirstChunk = true;
                showTyping(false);
              }
              fullContent += data.content;
              try { messageEl.innerHTML = renderMessageContent(fullContent); }
              catch (e) { messageEl.textContent = fullContent; }
              scrollToBottom();
            }
          } catch (_) {}
        }
      }

      conversation.push({ role: "assistant", content: fullContent });
      syncCurrentSession();
      renderMessages();
      setStatus("");
    } catch (err) {
      stoppedByUser = err && err.name === "AbortError";
      showTyping(false);
      if (!stoppedByUser) {
        streamingMessage.wrapper.remove();
        addMessage("assistant", "Network error: " + err.message, true);
        setStatus("", "error");
      } else {
        if (!fullContent) streamingMessage.wrapper.remove();
        if (fullContent) {
          conversation.push({ role: "assistant", content: fullContent });
          syncCurrentSession();
          renderMessages();
        }
      }
    } finally {
      activeRequestController = null;
      activeRequestId = null;
      setGeneratingState(false);
      showTyping(false);
      resizeComposer();
      input.focus();
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isGenerating) return;

    input.value = "";
    resizeComposer();
    addMessage("user", text);
    conversation.push({ role: "user", content: text });
    syncCurrentSession();
    await generateAssistantReply();
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  form.addEventListener("submit", e => { e.preventDefault(); sendMessage(); });
  input.addEventListener("input", resizeComposer);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && shouldSendOnEnter()) {
      e.preventDefault();
      sendMessage();
    }
  });
  messagesEl.addEventListener("click", async e => {
    const btn = e.target.closest(".message-action-btn");
    if (!btn) return;

    if (btn.dataset.action === "copy") {
      const ok = await copyToClipboard(btn.dataset.content || "");
      setStatus(ok ? "Copied response" : "Copy failed", ok ? "" : "error");
      return;
    }

    if (btn.dataset.action === "rewrite") {
      const index = Number(btn.dataset.index);
      if (!Number.isNaN(index)) rewriteAssistantMessage(index);
    }
  });
  if (historyList) {
    historyList.addEventListener("click", e => {
      const item = e.target.closest(".history-item");
      if (!item || isGenerating) return;
      loadSession(item.dataset.sessionId);
    });
  }

  if (newChatBtn) newChatBtn.addEventListener("click", startNewChat);
  if (newChatBtnBottom) newChatBtnBottom.addEventListener("click", startNewChat);
  if (newChatSidebarBtn) newChatSidebarBtn.addEventListener("click", startNewChat);
  if (downloadChatsBtn) downloadChatsBtn.addEventListener("click", downloadStoredSessions);
  if (stopBtn) stopBtn.addEventListener("click", stopGeneration);
  if (memoryBtn) memoryBtn.addEventListener("click", openMemoryPanel);
  if (memoryClose) memoryClose.addEventListener("click", closeMemoryPanel);
  if (memoryPanel) {
    memoryPanel.addEventListener("click", e => {
      if (e.target === memoryPanel) closeMemoryPanel();
    });
  }
  if (memorySave) {
    memorySave.addEventListener("click", () => {
      savePersonalMemory(memoryInput ? memoryInput.value : "");
      closeMemoryPanel();
      setStatus(personalMemory ? "Memory saved" : "Memory cleared");
    });
  }
  if (memoryClear) {
    memoryClear.addEventListener("click", () => {
      if (memoryInput) memoryInput.value = "";
      savePersonalMemory("");
      closeMemoryPanel();
      setStatus("Memory cleared");
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && memoryPanel && memoryPanel.getAttribute('aria-hidden') === 'false') {
      closeMemoryPanel();
    }
  });

  // ── Models panel ─────────────────────────────────────────────────────────

  const modelsBtn    = document.getElementById('models-btn');
  const modelsPanel  = document.getElementById('models-panel');
  const modelsClose  = document.getElementById('models-close');
  const modelsSearch = document.getElementById('models-search');
  const modelsList   = document.getElementById('models-list');
  const localCount   = document.getElementById('local-count');
  const modelsTabs   = document.querySelectorAll('.models-tab');
  const modelsSort   = document.getElementById('models-sort');
  const modelFilters = document.querySelectorAll('.models-filter');

  let _modelsTab = 'local';
  let _modelsFilter = 'all';

  function openModelsPanel() {
    if (!modelsPanel) return;
    modelsPanel.setAttribute('aria-hidden', 'false');
    if (modelsBtn) modelsBtn.classList.add('open');
    if (modelsSearch) { modelsSearch.value = ''; modelsSearch.focus(); }
    _renderModelsTab();
    if (_modelsTab === 'library' && !_libraryLoaded) _loadLibrary();
  }

  function closeModelsPanel() {
    if (!modelsPanel) return;
    modelsPanel.setAttribute('aria-hidden', 'true');
    if (modelsBtn) modelsBtn.classList.remove('open');
  }

  function _countryFlag(name) {
    const n = (name || '').toLowerCase().replace(/^[^/]*\//, ''); // strip namespace prefix
    // USA
    if (/^llama|^codellama/.test(n))            return { code: 'us', country: 'Meta · USA' };
    if (/^gemma|^codegemma/.test(n))            return { code: 'us', country: 'Google · USA' };
    if (/^phi\d|^phi:|^phi-/.test(n))           return { code: 'us', country: 'Microsoft · USA' };
    if (/^wizard|^orca(?![\w])/.test(n))        return { code: 'us', country: 'Microsoft · USA' };
    if (/^granite/.test(n))                     return { code: 'us', country: 'IBM · USA' };
    if (/^llava/.test(n))                       return { code: 'us', country: 'LLaVA · USA' };
    if (/^hermes|^openhermes|^nous/.test(n))    return { code: 'us', country: 'Nous Research · USA' };
    if (/^nemotron/.test(n))                    return { code: 'us', country: 'NVIDIA · USA' };
    if (/^arctic/.test(n))                      return { code: 'us', country: 'Snowflake · USA' };
    if (/^nomic/.test(n))                       return { code: 'us', country: 'Nomic · USA' };
    if (/^neural-chat/.test(n))                 return { code: 'us', country: 'Intel · USA' };
    if (/^bespoke/.test(n))                     return { code: 'us', country: 'Bespoke Labs · USA' };
    if (/^openelm/.test(n))                     return { code: 'us', country: 'Apple · USA' };
    if (/^grok/.test(n))                        return { code: 'us', country: 'xAI · USA' };
    if (/^dolphin/.test(n))                     return { code: 'us', country: 'Cognitive Computations · USA' };
    if (/^vicuna|^alpaca/.test(n))              return { code: 'us', country: 'UC Berkeley · USA' };
    if (/^tinyllama/.test(n))                   return { code: 'sg', country: 'TinyLlama · Singapore' };
    if (/^gpt-oss/.test(n))                     return { code: 'us', country: 'Microsoft · USA' };
    // France
    if (/^mistral|^mixtral|^codestral|^devstral|^magistral/.test(n)) return { code: 'fr', country: 'Mistral AI · France' };
    if (/^starcoder/.test(n))                   return { code: 'fr', country: 'BigCode · France' };
    if (/^zephyr|^smollm/.test(n))              return { code: 'fr', country: 'Hugging Face · France' };
    // China
    if (/^qwen/.test(n))                        return { code: 'cn', country: 'Alibaba · China' };
    if (/^deepseek/.test(n))                    return { code: 'cn', country: 'DeepSeek · China' };
    if (/^yi[-\d]/.test(n))                     return { code: 'cn', country: '01.AI · China' };
    if (/^internlm/.test(n))                    return { code: 'cn', country: 'Shanghai AI Lab · China' };
    if (/^baichuan/.test(n))                    return { code: 'cn', country: 'Baichuan AI · China' };
    if (/^glm|^codegeex/.test(n))               return { code: 'cn', country: 'Zhipu AI · China' };
    if (/^minicpm/.test(n))                     return { code: 'cn', country: 'ModelBest · China' };
    // Canada
    if (/^command|^aya/.test(n))                return { code: 'ca', country: 'Cohere · Canada' };
    // UAE
    if (/^falcon/.test(n))                      return { code: 'ae', country: 'TII · UAE' };
    // South Korea
    if (/^solar/.test(n))                       return { code: 'kr', country: 'Upstage · South Korea' };
    if (/^exaone/.test(n))                      return { code: 'kr', country: 'LG AI · South Korea' };
    // UK
    if (/^stablelm|^stable-code/.test(n))       return { code: 'gb', country: 'Stability AI · UK' };
    // Germany
    if (/^mxbai/.test(n))                       return { code: 'de', country: 'MixedBread · Germany' };
    return null;
  }

  function _modelTags(name) {
    const n = (name || '').toLowerCase();
    const tags = [];
    if (/vision|vl\b|-vl|vlm|llava|minicpm-v/.test(n)) tags.push({ label: 'Vision',   cls: 'badge-vision' });
    if (/coder|code|starcoder|deepseek-coder/.test(n))   tags.push({ label: 'Code',     cls: 'badge-code' });
    if (/math/.test(n))                                  tags.push({ label: 'Math',     cls: 'badge-math' });
    if (/instruct/.test(n))                              tags.push({ label: 'Instruct', cls: 'badge-instruct' });
    if (/embed/.test(n))                                 tags.push({ label: 'Embed',    cls: 'badge-embed' });
    return tags;
  }

  function _sizeLabel(bytes) {
    if (!bytes) return null;
    const gb = bytes / 1e9;
    return gb >= 1 ? gb.toFixed(1) + ' GB' : (bytes / 1e6).toFixed(0) + ' MB';
  }

  function _paramLabel(details, name) {
    if (details && details.parameter_size) return details.parameter_size;
    const m = (name || '').match(/:?(\d+\.?\d*)([bBmM])/);
    if (m) return m[1] + m[2].toUpperCase();
    return null;
  }

  function _buildLocalCard(m) {
    const isActive = m.name === (modelSelect ? modelSelect.value : '');
    const isPreferred = m.name === _loadPreferredModel();
    const tags = _modelTags(m.name);
    const origin = _countryFlag(m.name);
    const param = _paramLabel(m.details, m.name);
    const quant = m.details && m.details.quantization_level;
    const size  = _sizeLabel(m.size);

    const card = document.createElement('div');
    card.className = 'model-card' + (isActive ? ' is-active' : '');

    const nameEl = document.createElement('div');
    nameEl.className = 'model-card-name';
    if (origin) {
      const img = document.createElement('img');
      img.src = 'https://flagcdn.com/16x12/' + origin.code + '.png';
      img.width = 16; img.height = 12;
      img.alt = origin.country; img.title = origin.country;
      img.className = 'model-flag';
      nameEl.appendChild(img);
      nameEl.appendChild(document.createTextNode(m.name));
    } else {
      nameEl.textContent = m.name;
    }

    const badges = document.createElement('div');
    badges.className = 'model-badges';
    const instBadge = document.createElement('span');
    instBadge.className = 'badge badge-installed';
    instBadge.textContent = '✓ Installed';
    badges.appendChild(instBadge);
    if (isActive) { const b = document.createElement('span'); b.className = 'badge badge-current'; b.textContent = 'Current'; badges.appendChild(b); }
    if (isPreferred && !isActive) { const b = document.createElement('span'); b.className = 'badge badge-preferred'; b.textContent = 'Preferred'; badges.appendChild(b); }
    if (param) { const b = document.createElement('span'); b.className = 'badge badge-size'; b.textContent = param; badges.appendChild(b); }
    tags.forEach(t => { const b = document.createElement('span'); b.className = 'badge ' + t.cls; b.textContent = t.label; badges.appendChild(b); });

    if (origin) {
      const desc = document.createElement('div');
      desc.className = 'model-card-desc';
      desc.textContent = origin.country;
      card.appendChild(nameEl);
      card.appendChild(desc);
    } else {
      card.appendChild(nameEl);
    }

    const meta = document.createElement('div');
    meta.className = 'model-card-meta';
    const info = document.createElement('span');
    const parts = [];
    if (quant) parts.push(quant);
    if (size)  parts.push(size);
    info.textContent = parts.join(' · ');

    const useBtn = document.createElement('button');
    useBtn.className = 'model-card-select' + (isActive ? ' active-model' : '');
    useBtn.textContent = isActive ? 'Active' : 'Use';
    if (!isActive) {
      useBtn.addEventListener('click', () => {
        _selectModelDropdown(m.name);
        closeModelsPanel();
      });
    }

    meta.appendChild(info);
    meta.appendChild(useBtn);
    card.appendChild(badges);
    card.appendChild(meta);
    return card;
  }

  function _buildLibraryCard(m) {
    const name = m.name || '';
    const isInstalled = _localModels.some(l => l.name.split(':')[0] === name.split(':')[0]);
    const isPreferred = name === _loadPreferredModel();
    const tags = _modelTags(name);
    const origin = _countryFlag(name);
    const param = _paramLabel(m.details, name);
    const size  = _sizeLabel(m.size);

    const card = document.createElement('div');
    card.className = 'model-card' + (isInstalled ? ' is-active' : '');

    const nameEl = document.createElement('div');
    nameEl.className = 'model-card-name';
    if (origin) {
      const img = document.createElement('img');
      img.src = 'https://flagcdn.com/16x12/' + origin.code + '.png';
      img.width = 16; img.height = 12;
      img.alt = origin.country; img.title = origin.country;
      img.className = 'model-flag';
      nameEl.appendChild(img);
      nameEl.appendChild(document.createTextNode(name));
    } else {
      nameEl.textContent = name;
    }

    const badges = document.createElement('div');
    badges.className = 'model-badges';
    if (isInstalled) { const b = document.createElement('span'); b.className = 'badge badge-installed'; b.textContent = '✓ Installed'; badges.appendChild(b); }
    else { const b = document.createElement('span'); b.className = 'badge badge-size'; b.textContent = 'Available'; badges.appendChild(b); }
    if (isPreferred) { const b = document.createElement('span'); b.className = 'badge badge-preferred'; b.textContent = 'Preferred'; badges.appendChild(b); }
    if (param) { const b = document.createElement('span'); b.className = 'badge badge-size'; b.textContent = param; badges.appendChild(b); }
    tags.forEach(t => { const b = document.createElement('span'); b.className = 'badge ' + t.cls; b.textContent = t.label; badges.appendChild(b); });

    if (origin || m.description) {
      const desc = document.createElement('div');
      desc.className = 'model-card-desc';
      desc.textContent = [origin ? origin.country : '', m.description || ''].filter(Boolean).join(' • ');
      card.appendChild(nameEl);
      card.appendChild(desc);
    } else {
      card.appendChild(nameEl);
    }

    const meta = document.createElement('div');
    meta.className = 'model-card-meta';
    const info = document.createElement('span');
    const parts = [];
    if (size) parts.push(size);
    if (m.modified_at) {
      try { parts.push(new Date(m.modified_at).toLocaleDateString()); } catch(e) {}
    }
    info.textContent = parts.join(' · ');
    meta.appendChild(info);

    card.appendChild(badges);
    card.appendChild(meta);
    return card;
  }

  function _formatPulls(n) {
    if (!n) return '';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(n);
  }

  function _matchesModelFilter(model) {
    if (_modelsFilter === 'all') return true;
    const name = model.name || '';
    const tags = _modelTags(name).map(t => t.label.toLowerCase());
    if (_modelsFilter === 'light') {
      const bytes = Number(model.size || 0);
      const params = _paramLabel(model.details, name);
      if (bytes && bytes <= 8e9) return true;
      return !!(params && parseFloat(params) <= 8);
    }
    if (_modelsFilter === 'instruct') return tags.includes('instruct');
    return tags.includes(_modelsFilter);
  }

  function _sortModels(models) {
    const sorted = models.slice();
    const activeName = modelSelect ? modelSelect.value : '';
    const preferredName = _loadPreferredModel();
    const sortMode = modelsSort ? modelsSort.value : 'recommended';

    if (sortMode === 'name') {
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return sorted;
    }

    if (sortMode === 'size-asc') {
      sorted.sort((a, b) => Number(a.size || Number.MAX_SAFE_INTEGER) - Number(b.size || Number.MAX_SAFE_INTEGER));
      return sorted;
    }

    if (sortMode === 'size-desc') {
      sorted.sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
      return sorted;
    }

    if (_modelsTab === 'local') {
      sorted.sort((a, b) => {
        const scoreA = (a.name === activeName ? 4 : 0) + (a.name === preferredName ? 2 : 0);
        const scoreB = (b.name === activeName ? 4 : 0) + (b.name === preferredName ? 2 : 0);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return (a.name || '').localeCompare(b.name || '');
      });
      return sorted;
    }

    sorted.sort((a, b) => {
      const installedA = _localModels.some(l => l.name.split(':')[0] === (a.name || '').split(':')[0]) ? 1 : 0;
      const installedB = _localModels.some(l => l.name.split(':')[0] === (b.name || '').split(':')[0]) ? 1 : 0;
      if (installedA !== installedB) return installedB - installedA;
      return (a.name || '').localeCompare(b.name || '');
    });
    return sorted;
  }

  function _renderModelsTab() {
    if (!modelsList) return;
    const q = (modelsSearch ? modelsSearch.value : '').toLowerCase().trim();

    modelsList.innerHTML = '';

    if (_modelsTab === 'local') {
      const filtered = _sortModels(_localModels.filter(m => {
        const haystack = [m.name || '', _countryFlag(m.name || '')?.country || ''].join(' ').toLowerCase();
        return (!q || haystack.includes(q)) && _matchesModelFilter(m);
      }));
      if (!filtered.length) {
        modelsList.innerHTML = '<div class="models-placeholder">' + ((q || _modelsFilter !== 'all') ? 'No local models match these filters.' : 'No local models found.') + '</div>';
        return;
      }
      filtered.forEach(m => modelsList.appendChild(_buildLocalCard(m)));
    } else {
      if (!_libraryLoaded) {
        modelsList.innerHTML = '<div class="models-placeholder">Loading library…</div>';
        return;
      }
      const filtered = _sortModels(_libraryModels.filter(m => {
        const haystack = [m.name || '', m.description || '', _countryFlag(m.name || '')?.country || ''].join(' ').toLowerCase();
        return (!q || haystack.includes(q)) && _matchesModelFilter(m);
      }));
      if (!filtered.length) {
        modelsList.innerHTML = '<div class="models-placeholder">' + ((q || _modelsFilter !== 'all') ? 'No library models match these filters.' : 'Library unavailable.') + '</div>';
        return;
      }
      filtered.forEach(m => modelsList.appendChild(_buildLibraryCard(m)));
    }
  }

  async function _loadLibrary() {
    if (!modelsList) return;
    modelsList.innerHTML = '<div class="models-placeholder">Fetching from ollama.com…</div>';
    try {
      const q = modelsSearch ? modelsSearch.value : '';
      const res = await fetch('/models/library?q=' + encodeURIComponent(q));
      const data = await res.json();
      _libraryModels = data.models || [];
      _libraryLoaded = true;
    } catch (e) {
      _libraryModels = [];
      _libraryLoaded = true;
    }
    _renderModelsTab();
  }

  if (modelsBtn) modelsBtn.addEventListener('click', openModelsPanel);
  if (modelsClose) modelsClose.addEventListener('click', closeModelsPanel);
  if (modelsPanel) modelsPanel.addEventListener('click', e => { if (e.target === modelsPanel) closeModelsPanel(); });

  modelsTabs.forEach(tab => tab.addEventListener('click', function () {
    _modelsTab = this.dataset.tab;
    modelsTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === _modelsTab));
    if (_modelsTab === 'library' && !_libraryLoaded) {
      _loadLibrary();
    } else {
      _renderModelsTab();
    }
  }));

  if (modelsSearch) {
    modelsSearch.addEventListener('input', () => {
      if (_modelsTab === 'library' && !_libraryLoaded) return;
      _renderModelsTab();
    });
    modelsSearch.addEventListener('keydown', e => {
      if (e.key === 'Enter' && _modelsTab === 'library') {
        _libraryLoaded = false;
        _loadLibrary();
      }
    });
  }

  if (modelsSort) {
    modelsSort.addEventListener('change', _renderModelsTab);
  }

  modelFilters.forEach(filterBtn => filterBtn.addEventListener('click', function () {
    _modelsFilter = this.dataset.filter || 'all';
    modelFilters.forEach(btn => btn.classList.toggle('active', btn === this));
    _renderModelsTab();
  }));

  // ── Accessibility ─────────────────────────────────────────────────────────

  const accessBtn = document.getElementById('access-btn');
  const accessPanel = document.getElementById('access-panel');
  const accessClose = document.getElementById('access-close');
  const fontBtns = document.querySelectorAll('.font-btn');
  const themeBtns = document.querySelectorAll('.theme-btn');
  const weightBtns = document.querySelectorAll('.weight-btn');
  const accessReset = document.getElementById('access-reset');

  function applyAccessibility(settings) {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark', 'theme-sepia');
    if (settings.theme === 'dark') root.classList.add('theme-dark');
    if (settings.theme === 'light') root.classList.add('theme-light');
    if (settings.theme === 'sepia') root.classList.add('theme-sepia');

    const appEl = document.querySelector('.app');
    appEl.classList.remove('font-sm', 'font-md', 'font-lg');
    appEl.classList.add(settings.size ? ('font-' + settings.size) : 'font-md');

    appEl.classList.remove('weight-normal', 'weight-bold');
    appEl.classList.add(settings.weight === 'bold' ? 'weight-bold' : 'weight-normal');

    fontBtns.forEach(b => b.classList.toggle('active', b.dataset.size === settings.size));
    themeBtns.forEach(b => b.classList.toggle('active', b.dataset.theme === settings.theme));
    weightBtns.forEach(b => b.classList.toggle('active', b.dataset.weight === settings.weight));
  }

  function saveAccessibility(s) {
    try { localStorage.setItem('accessibility', JSON.stringify(s)); } catch (e) {}
  }
  function loadAccessibility() {
    try { return JSON.parse(localStorage.getItem('accessibility') || 'null'); } catch (e) { return null; }
  }

  if (accessBtn) accessBtn.addEventListener('click', () => {
    accessPanel.setAttribute('aria-hidden', 'false');
    accessBtn.setAttribute('aria-expanded', 'true');
  });
  if (accessClose) accessClose.addEventListener('click', () => {
    accessPanel.setAttribute('aria-hidden', 'true');
    accessBtn.setAttribute('aria-expanded', 'false');
  });
  if (accessPanel) accessPanel.addEventListener('click', e => {
    if (e.target === accessPanel) { accessPanel.setAttribute('aria-hidden', 'true'); accessBtn.setAttribute('aria-expanded', 'false'); }
  });

  fontBtns.forEach(b => b.addEventListener('click', function () {
    const s = Object.assign({}, loadAccessibility() || {}, { size: b.dataset.size || 'md' });
    applyAccessibility(s); saveAccessibility(s);
  }));
  themeBtns.forEach(b => b.addEventListener('click', function () {
    const s = Object.assign({}, loadAccessibility() || {}, { theme: b.dataset.theme || 'light' });
    applyAccessibility(s); saveAccessibility(s);
  }));
  weightBtns.forEach(b => b.addEventListener('click', function () {
    const s = Object.assign({}, loadAccessibility() || {}, { weight: b.dataset.weight || 'normal' });
    applyAccessibility(s); saveAccessibility(s);
  }));
  if (accessReset) accessReset.addEventListener('click', function () {
    const defaults = { size: 'md', theme: 'light', weight: 'normal' };
    applyAccessibility(defaults); saveAccessibility(defaults);
  });

  const saved = loadAccessibility();
  if (saved) applyAccessibility(saved);

  // ── Init ──────────────────────────────────────────────────────────────────

  async function initApp() {
    localSessions = loadStoredSessions();
    activeSessionId = localStorage.getItem(ACTIVE_CHAT_SESSION_KEY) || '';
    personalMemory = loadPersonalMemory();
    updateMemoryButtonState();

    if (!localSessions.length) {
      createSession({ messages: [] });
    } else if (activeSessionId && localSessions.some(session => session.id === activeSessionId)) {
      loadSession(activeSessionId);
    } else {
      loadSession(localSessions[0].id);
    }

    await loadModels();
    setTimeout(() => {
      resizeComposer();
      updateMessagesPadding();
      ensureScrolled();
      try { input.focus(); } catch (e) {}
    }, 120);
  }

  async function init() {
    await initApp();
  }

  init();

  // ── PWA / Service Worker ──────────────────────────────────────────────────

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => {
        reg.update().catch(() => {});
      }).catch(() => {});

    let reloadedByController = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloadedByController) return;
      reloadedByController = true;
      window.location.reload();
    });
  }

  let deferredPrompt = null;
  const installBtn = document.getElementById('install-btn');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) { installBtn.hidden = false; installBtn.classList.add('show'); }
    return false;
  });

  if (installBtn) {
    installBtn.addEventListener('click', async function () {
      if (!deferredPrompt) {
        alert('Use the browser menu to install this app.');
        return;
      }
      installBtn.disabled = true;
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') installBtn.hidden = true;
      else installBtn.disabled = false;
      deferredPrompt = null;
    });
  }

  window.addEventListener('resize', () => { resizeComposer(); updateMessagesPadding(); ensureScrolled(); });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => { resizeComposer(); updateMessagesPadding(); ensureScrolled(); }, 120);
  });
})();
