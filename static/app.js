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

  let conversation = [];
  let activeRequestController = null;
  let activeRequestId = null;
  let isGenerating = false;

  // shared state for models panel (populated by loadModels)
  let _localModels = [];
  let _libraryModels = [];
  let _libraryLoaded = false;
  const MODEL_PREFERENCE_KEY = 'preferredModel';

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

  function startNewChat() {
    conversation = [];
    renderMessages();
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
    if (!text || isGenerating) return;

    input.value = "";
    resizeComposer();
    addMessage("user", text);
    conversation.push({ role: "user", content: text });

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

    const messageEl = createStreamingMessage();
    let fullContent = "";
    let receivedFirstChunk = false;
    let stoppedByUser = false;

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation, model, request_id: requestId }),
        signal: requestController.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showTyping(false);
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
              showTyping(false);
              messageEl.remove();
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
      setStatus("");
    } catch (err) {
      stoppedByUser = err && err.name === "AbortError";
      showTyping(false);
      if (!stoppedByUser) {
        messageEl.remove();
        addMessage("assistant", "Network error: " + err.message, true);
        setStatus("", "error");
      } else {
        if (!fullContent) messageEl.remove();
        if (fullContent) {
          conversation.push({ role: "assistant", content: fullContent });
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

  // ── Event listeners ───────────────────────────────────────────────────────

  form.addEventListener("submit", e => { e.preventDefault(); sendMessage(); });
  input.addEventListener("input", resizeComposer);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && shouldSendOnEnter()) {
      e.preventDefault();
      sendMessage();
    }
  });

  if (newChatBtn) newChatBtn.addEventListener("click", startNewChat);
  if (newChatBtnBottom) newChatBtnBottom.addEventListener("click", startNewChat);
  if (stopBtn) stopBtn.addEventListener("click", stopGeneration);

  // ── Models panel ─────────────────────────────────────────────────────────

  const modelsBtn    = document.getElementById('models-btn');
  const modelsPanel  = document.getElementById('models-panel');
  const modelsClose  = document.getElementById('models-close');
  const modelsSearch = document.getElementById('models-search');
  const modelsList   = document.getElementById('models-list');
  const localCount   = document.getElementById('local-count');
  const modelsTabs   = document.querySelectorAll('.models-tab');

  let _modelsTab = 'local';

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
    if (param) { const b = document.createElement('span'); b.className = 'badge badge-size'; b.textContent = param; badges.appendChild(b); }
    tags.forEach(t => { const b = document.createElement('span'); b.className = 'badge ' + t.cls; b.textContent = t.label; badges.appendChild(b); });

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
    card.appendChild(nameEl);
    card.appendChild(badges);
    card.appendChild(meta);
    return card;
  }

  function _buildLibraryCard(m) {
    const name = m.name || '';
    const isInstalled = _localModels.some(l => l.name.split(':')[0] === name.split(':')[0]);
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
    if (param) { const b = document.createElement('span'); b.className = 'badge badge-size'; b.textContent = param; badges.appendChild(b); }
    tags.forEach(t => { const b = document.createElement('span'); b.className = 'badge ' + t.cls; b.textContent = t.label; badges.appendChild(b); });

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

    card.appendChild(nameEl);
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

  function _renderModelsTab() {
    if (!modelsList) return;
    const q = (modelsSearch ? modelsSearch.value : '').toLowerCase().trim();

    modelsList.innerHTML = '';

    if (_modelsTab === 'local') {
      const filtered = _localModels.filter(m => !q || m.name.toLowerCase().includes(q));
      if (!filtered.length) {
        modelsList.innerHTML = '<div class="models-placeholder">' + (q ? 'No local models match.' : 'No local models found.') + '</div>';
        return;
      }
      filtered.forEach(m => modelsList.appendChild(_buildLocalCard(m)));
    } else {
      if (!_libraryLoaded) {
        modelsList.innerHTML = '<div class="models-placeholder">Loading library…</div>';
        return;
      }
      const filtered = _libraryModels.filter(m => !q || (m.name || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q));
      if (!filtered.length) {
        modelsList.innerHTML = '<div class="models-placeholder">' + (q ? 'No library models match.' : 'Library unavailable.') + '</div>';
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
    conversation = [];
    renderMessages();
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
