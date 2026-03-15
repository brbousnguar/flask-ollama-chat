(function () {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("user-input");
  const messagesEl = document.getElementById("messages");
  const emptyState = document.getElementById("empty-state");
  const typingIndicator = document.getElementById("typing-indicator");
  const statusEl = document.getElementById("status");
  const sendBtn = document.getElementById("send-btn");
  const newChatBtn = document.getElementById("new-chat-btn");
  const modelSelect = document.getElementById("model-select");
  const modelBadge = document.getElementById("model-badge");
  const modelModal = document.getElementById("model-modal");
  const modelModalList = document.getElementById("model-modal-list");
  const modelModalClose = document.getElementById("model-modal-close");
  const inputRow = document.querySelector('.input-row');
  const authModal = document.getElementById('auth-modal');
  const authError = document.getElementById('auth-error');
  const registerForm = document.getElementById('register-form');
  const loginForm = document.getElementById('login-form');
  const userBox = document.getElementById('user-box');
  const userName = document.getElementById('user-name');
  const logoutBtn = document.getElementById('logout-btn');

  let conversation = [];
  let currentThreadId = null;
  let currentUser = null;

  function genId() {
    return 't_' + Math.random().toString(36).slice(2, 9);
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  function setAuthError(message) {
    if (!authError) return;
    if (!message) { authError.hidden = true; authError.textContent = ''; return; }
    authError.hidden = false;
    authError.textContent = message;
  }

  function toggleAuthModal(show) {
    if (!authModal) return;
    authModal.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  function updateUserUi() {
    if (!userBox || !userName) return;
    if (!currentUser) { userBox.hidden = true; userName.textContent = ''; return; }
    userName.textContent = currentUser.name;
    userBox.hidden = false;
  }

  async function getCurrentUser() {
    try {
      const res = await fetch('/auth/me');
      const data = await res.json();
      if (data && data.authenticated && data.user) {
        currentUser = data.user;
        updateUserUi();
        toggleAuthModal(false);
        setAuthError('');
        return true;
      }
    } catch (e) {}
    currentUser = null;
    updateUserUi();
    toggleAuthModal(true);
    return false;
  }

  // ── Thread persistence (single thread, no history UI) ────────────────────

  function saveThread() {
    if (!currentThreadId) return;
    fetch('/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: currentThreadId,
        title: 'Chat',
        messages: conversation,
        created_at: new Date().toISOString(),
      }),
    }).then(res => {
      if (res.status === 401) {
        currentUser = null;
        updateUserUi();
        toggleAuthModal(true);
      }
    }).catch(() => {});
  }

  async function loadLatestThread() {
    return fetch('/threads').then(async res => {
      if (res.status === 401) { toggleAuthModal(true); return false; }
      return res.json();
    }).then(async data => {
      if (!data || !data.days || !data.days.length) return false;
      const latestDay = data.days[0];
      if (!latestDay.threads || !latestDay.threads.length) return false;
      // pick the most recent thread
      const meta = latestDay.threads[latestDay.threads.length - 1];
      try {
        const r = await fetch(`/threads/${encodeURIComponent(latestDay.date)}/${encodeURIComponent(meta.id)}`);
        if (!r.ok) return false;
        const tdata = await r.json();
        currentThreadId = tdata.id;
        conversation = (tdata.messages || []).filter(m => m.role !== 'system');
        return conversation.length > 0;
      } catch (e) { return false; }
    }).catch(() => false);
  }

  // ── Chat rendering ────────────────────────────────────────────────────────

  function renderMessages() {
    while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
    if (emptyState) messagesEl.appendChild(emptyState);
    if (!conversation.length) { showEmptyState(true); return; }
    showEmptyState(false);
    conversation.forEach(m => {
      if (m.role === 'system') return;
      const div = document.createElement('div');
      div.className = 'message ' + (m.role === 'assistant' ? 'assistant' : 'user');
      div.setAttribute('role', 'listitem');
      try {
        if (m.role === 'assistant') div.innerHTML = renderMessageContent(m.content);
        else div.textContent = m.content;
      } catch (e) { div.textContent = m.content; }
      messagesEl.appendChild(div);
    });
    scrollToBottom();
  }

  // ── Model loading ─────────────────────────────────────────────────────────

  async function loadModels() {
    if (!modelSelect) return;
    try {
      const res = await fetch("/models");
      if (res.status === 401) {
        currentUser = null; updateUserUi(); toggleAuthModal(true); return;
      }
      const data = await res.json();
      const models = data.models || [];
      modelSelect.innerHTML = "";

      if (models.length === 0) {
        modelSelect.innerHTML = '<option value="">No models found</option>';
        if (modelBadge) modelBadge.textContent = "No models";
        return;
      }

      models.forEach(function (m) {
        const name = typeof m === 'string' ? m : (m.name || '');
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        modelSelect.appendChild(opt);
      });

      if (!modelSelect.value && models.length) {
        const firstName = typeof models[0] === 'string' ? models[0] : models[0].name;
        modelSelect.value = firstName;
        updateSelectedModelDisplay(firstName);
      }

      if (modelModalList) {
        modelModalList.innerHTML = "";
        models.forEach(function (m) {
          const name = typeof m === 'string' ? m : (m.name || '');
          const modified = (m && m.modified_at) ? m.modified_at : null;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "model-option";
          btn.setAttribute('data-model-name', name);
          btn.textContent = name;
          if (modified) {
            const meta = document.createElement('div');
            meta.className = 'model-meta';
            try { meta.textContent = 'updated: ' + new Date(modified).toLocaleString(); }
            catch (e) { meta.textContent = modified; }
            btn.appendChild(meta);
          }
          if (modelSelect && modelSelect.value === name) btn.classList.add('active');
          btn.addEventListener("click", function () {
            modelSelect.value = name;
            updateSelectedModelDisplay(name);
            closeModelModal();
          });
          modelModalList.appendChild(btn);
        });
      }
    } catch (err) {
      if (modelSelect) modelSelect.innerHTML = '<option value="">Failed to load models</option>';
      if (modelBadge) modelBadge.textContent = "Load failed";
    }
  }

  function updateSelectedModelDisplay(name) {
    if (!name) return;
    if (modelBadge) { modelBadge.textContent = name; modelBadge.classList.add('active'); }
    if (modelModalList) {
      modelModalList.querySelectorAll('[data-model-name]').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-model-name') === name);
      });
    }
  }

  if (modelSelect) {
    modelSelect.addEventListener('change', e => updateSelectedModelDisplay(e.target.value));
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function updateMessagesPadding() {
    try {
      if (!messagesEl || !inputRow) return;
      const h = inputRow.getBoundingClientRect().height;
      messagesEl.style.paddingBottom = Math.max(h + 12, 88) + 'px';
    } catch (e) {}
  }

  function ensureScrolled() {
    try { messagesEl.scrollTop = messagesEl.scrollHeight; } catch (e) {}
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderMessageContent(raw) {
    if (!raw) return '';
    let text = raw.replace(/<br\s*\/?\s*>/gi, '\n').replace(/\r\n/g, '\n');
    text = escapeHtml(text);

    text = text.replace(/```([\s\S]*?)```/g, (_, code) =>
      '<pre class="md-code"><code>' + escapeHtml(code) + '</code></pre>');
    text = text.replace(/`([^`]+?)`/g, (_, code) =>
      '<code class="md-inline-code">' + escapeHtml(code) + '</code>');

    text = text.replace(/^###\s*(.+)$/gm, '<h3 class="md-h3">$1</h3>');
    text = text.replace(/^##\s*(.+)$/gm, '<h4 class="md-h4">$1</h4>');
    text = text.replace(/^#\s*(.+)$/gm, '<h2 class="md-h2">$1</h2>');
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

    text = text.replace(/(^|\n)([ \t]*[-\*] .+(\n[ \t]*[-\*] .+)*)/g, function(_, pre, listBlock) {
      const items = listBlock.trim().split('\n').map(l => l.replace(/^[-\*]\s?/, ''));
      return (pre || '') + '<ul class="md-ul">' + items.map(i => '<li>' + i + '</li>').join('') + '</ul>';
    });

    const parts = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    return parts.map(p => {
      if (/^<(h2|h3|h4|pre|div|ul|table)/.test(p)) return p;
      return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
  }

  function openModelModal() {
    if (!modelModal) return;
    modelModal.setAttribute("aria-hidden", "false");
    const first = modelModal.querySelector("button");
    if (first) first.focus();
  }

  function closeModelModal() {
    if (!modelModal) return;
    modelModal.setAttribute("aria-hidden", "true");
  }

  function startNewChat() {
    currentThreadId = genId();
    conversation = [];
    renderMessages();
    saveThread();
    input.focus();
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
    if (show) scrollToBottom();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, content, isError = false) {
    showEmptyState(false);
    const div = document.createElement("div");
    div.className = "message " + (isError ? "error" : role);
    div.setAttribute("role", "listitem");
    div.textContent = content;
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  function createStreamingMessage() {
    showEmptyState(false);
    const div = document.createElement("div");
    div.className = "message assistant";
    div.setAttribute("role", "listitem");
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    addMessage("user", text);
    conversation.push({ role: "user", content: text });

    const model = modelSelect ? modelSelect.value : "";
    if (!model) {
      addMessage("assistant", "Please select a model.", true);
      return;
    }

    sendBtn.disabled = true;
    showTyping(true);
    setStatus("");

    const messageEl = createStreamingMessage();
    showTyping(false);
    let fullContent = "";

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation, model }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) { currentUser = null; updateUserUi(); toggleAuthModal(true); }
        messageEl.remove();
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
              messageEl.remove();
              addMessage("assistant", data.error, true);
              setStatus("", "error");
              return;
            }
            if (data.content) {
              fullContent += data.content;
              try { messageEl.innerHTML = renderMessageContent(fullContent); }
              catch (e) { messageEl.textContent = fullContent; }
              scrollToBottom();
            }
          } catch (_) {}
        }
      }

      conversation.push({ role: "assistant", content: fullContent });
      saveThread();
      setStatus("");
    } catch (err) {
      messageEl.remove();
      addMessage("assistant", "Network error: " + err.message, true);
      setStatus("", "error");
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  form.addEventListener("submit", e => { e.preventDefault(); sendMessage(); });

  if (newChatBtn) newChatBtn.addEventListener("click", startNewChat);

  if (modelBadge) {
    modelBadge.setAttribute("role", "button");
    modelBadge.addEventListener("click", openModelModal);
  }
  if (modelModalClose) modelModalClose.addEventListener("click", closeModelModal);
  if (modelModal) modelModal.addEventListener("click", e => { if (e.target === modelModal) closeModelModal(); });

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function () {
      await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
      conversation = [];
      currentThreadId = null;
      currentUser = null;
      updateUserUi();
      renderMessages();
      toggleAuthModal(true);
    });
  }

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
    const hasHistory = await loadLatestThread();
    if (!hasHistory) {
      currentThreadId = genId();
      conversation = [];
    }
    renderMessages();
    await loadModels();
    setTimeout(() => { updateMessagesPadding(); ensureScrolled(); try { input.focus(); } catch (e) {} }, 120);
  }

  async function init() {
    const authenticated = await getCurrentUser();
    if (!authenticated) return;
    await initApp();
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      setAuthError('');
      const name = document.getElementById('register-name').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      try {
        const res = await fetch('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setAuthError(data.error || 'Unable to create account'); return; }
        currentUser = data.user || null;
        updateUserUi();
        toggleAuthModal(false);
        conversation = []; currentThreadId = null;
        await initApp();
      } catch (err) { setAuthError('Network error while creating account'); }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      setAuthError('');
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      try {
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setAuthError(data.error || 'Unable to sign in'); return; }
        currentUser = data.user || null;
        updateUserUi();
        toggleAuthModal(false);
        conversation = []; currentThreadId = null;
        await initApp();
      } catch (err) { setAuthError('Network error while signing in'); }
    });
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

  window.addEventListener('resize', () => { updateMessagesPadding(); ensureScrolled(); });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => { updateMessagesPadding(); ensureScrolled(); }, 120);
  });
})();
