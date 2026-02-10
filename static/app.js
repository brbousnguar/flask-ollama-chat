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

  let conversation = [];

  async function loadModels() {
    if (!modelSelect) return;
    try {
      const res = await fetch("/models");
      const data = await res.json();
      const models = data.models || [];
      modelSelect.innerHTML = "";

      // models may be array of {name, modified_at, size, details}
      // show selected model name in the badge when available, otherwise show count
      if (modelSelect && modelSelect.value) {
        if (modelBadge) modelBadge.textContent = modelSelect.value;
      } else if (!modelBadge) {
        // noop
      } else if (models.length === 0) {
        modelBadge.textContent = "No models";
      } else {
        // if models array contains objects, show first model name; otherwise show count
        if (typeof models[0] === 'object' && models[0].name) {
          modelBadge.textContent = models[0].name;
          modelBadge.classList.add('active');
        } else {
          modelBadge.textContent = models.length + " model" + (models.length > 1 ? "s" : "");
        }
      }

      if (models.length === 0) {
        modelSelect.innerHTML = '<option value="">No models found</option>';
        return;
      }

      models.forEach(function (m) {
        const name = typeof m === 'string' ? m : (m.name || '');
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (m && m.modified_at) opt.setAttribute('data-modified', m.modified_at);
        modelSelect.appendChild(opt);
      });

      // choose first model by default if none selected
      if (!modelSelect.value && models.length) {
        const firstName = typeof models[0] === 'string' ? models[0] : models[0].name;
        modelSelect.value = firstName;
        updateSelectedModelDisplay(firstName);
      }

      // populate modal list for mobile picker
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
            // show a friendly formatted date if possible
            try {
              const d = new Date(modified);
              meta.textContent = 'updated: ' + d.toLocaleString();
            } catch (e) {
              meta.textContent = modified;
            }
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
      modelSelect.innerHTML = '<option value="">Failed to load models</option>';
      if (modelBadge) modelBadge.textContent = "Load failed";
    }
  }

  function updateSelectedModelDisplay(name) {
    if (!name) return;
    // update badge
    if (modelBadge) {
      modelBadge.textContent = name;
      modelBadge.classList.add('active');
    }
    // update modal active state
    if (modelModalList) {
      const buttons = modelModalList.querySelectorAll('[data-model-name]');
      buttons.forEach(function (b) {
        if (b.getAttribute('data-model-name') === name) b.classList.add('active');
        else b.classList.remove('active');
      });
    }
  }

  // sync when the select changes
  if (modelSelect) {
    modelSelect.addEventListener('change', function (e) {
      const name = e.target.value;
      updateSelectedModelDisplay(name);
    });
  }

  // Ensure messages area has enough bottom padding so the fixed input doesn't overlap
  function updateMessagesPadding() {
    try {
      if (!messagesEl || !inputRow) return;
      const h = inputRow.getBoundingClientRect().height;
      messagesEl.style.paddingBottom = Math.max(h + 12, 88) + 'px';
    } catch (e) {}
  }

  // Keep messages scrolled to bottom when appropriate
  function ensureScrolled() {
    try { messagesEl.scrollTop = messagesEl.scrollHeight; } catch (e) {}
  }

  // Lightweight markdown-ish renderer: supports headings (###), bold ** **,
  // italics * *, inline code ``, code blocks ``` ```, lists, and tables (|).
  // Also tolerates <br> tags in model output by converting them to newlines first.
  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderMessageContent(raw) {
    if (!raw) return '';
    // Convert any explicit <br> tags to newlines so markdown renderer handles them
    let text = raw.replace(/<br\s*\/?\s*>/gi, '\n');

    // Normalize CRLF
    text = text.replace(/\r\n/g, '\n');

    // Escape HTML to avoid raw injection, we'll add back allowed tags
    text = escapeHtml(text);

    // Code blocks ``` ```
    text = text.replace(/```([\s\S]*?)```/g, function(_, code) {
      return '<pre class="md-code"><code>' + escapeHtml(code) + '</code></pre>';
    });

    // Inline code `code`
    text = text.replace(/`([^`]+?)`/g, function(_, code) {
      return '<code class="md-inline-code">' + escapeHtml(code) + '</code>';
    });

    // Headings ###
    text = text.replace(/^###\s*(.+)$/gm, '<h3 class="md-h3">$1</h3>');
    text = text.replace(/^##\s*(.+)$/gm, '<h4 class="md-h4">$1</h4>');
    text = text.replace(/^#\s*(.+)$/gm, '<h2 class="md-h2">$1</h2>');

    // Bold **text**
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Italic *text*
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Tables: detect contiguous blocks of lines containing '|' and render as a table.
    // This is more robust for outputs that lack a separator row or come in streaming chunks.
    {
      const linesArr = text.split('\n');
      const outLines = [];
      for (let i = 0; i < linesArr.length; i++) {
        const line = linesArr[i];
        if (line && line.indexOf('|') !== -1) {
          // start candidate block
          let j = i;
          const block = [];
          while (j < linesArr.length && linesArr[j] && linesArr[j].indexOf('|') !== -1) {
            block.push(linesArr[j].trim());
            j++;
          }

          if (block.length >= 2) {
            // determine if second line is a separator (---|:---|---)
            const sep = block[1].replace(/\s/g, '');
            const isSeparator = /^[:\-|]+$/.test(sep);

            const headerLine = block[0];
            const cols = headerLine.split('|').map(s => s.trim()).filter(Boolean);

            const rows = [];
            const rowStart = isSeparator ? 2 : 1;
            for (let k = rowStart; k < block.length; k++) {
              const cells = block[k].split('|').map(s => s.trim()).filter(() => true);
              // keep empty cells as empty strings but trim surrounding whitespace
              const cleaned = block[k].split('|').map(s => s.trim());
              // remove leading/trailing empty due to pipes
              const filtered = cleaned.filter((_, idx) => !(idx === 0 && cleaned[idx] === '') && !(idx === cleaned.length - 1 && cleaned[idx] === ''));
              if (filtered.length) rows.push(filtered);
            }

            // build table HTML
            let table = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
            cols.forEach(c => table += '<th>' + c + '</th>');
            table += '</tr></thead><tbody>';
            rows.forEach(r => {
              table += '<tr>';
              for (let ci = 0; ci < cols.length; ci++) {
                const cell = r[ci] !== undefined ? r[ci] : '';
                table += '<td>' + cell + '</td>';
              }
              table += '</tr>';
            });
            table += '</tbody></table></div>';

            outLines.push(table);
            i = j - 1;
            continue;
          }
          // not a table block, fall through and add line as-is
          outLines.push(line);
        } else {
          outLines.push(line);
        }
      }
      text = outLines.join('\n');
    }

    // Unordered lists: lines starting with - or *
    text = text.replace(/(^|\n)([ \t]*[-\*] .+(\n[ \t]*[-\*] .+)*)/g, function(_, pre, listBlock) {
      const items = listBlock.trim().split('\n').map(l => l.replace(/^[-\*]\s?/, ''));
      return (pre || '') + '<ul class="md-ul">' + items.map(i => '<li>' + i + '</li>').join('') + '</ul>';
    });

    // Paragraphs: split by two newlines
    const parts = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const html = parts.map(p => {
      // if already a block element (h2/h3/pre/table/ul) leave as is
      if (/^<(h2|h3|h4|pre|div|ul|table)/.test(p)) return p;
      // replace single newlines with <br>
      const withBreaks = p.replace(/\n/g, '<br>');
      return '<p>' + withBreaks + '</p>';
    }).join('\n');

    return html;
  }

  function openModelModal() {
    if (!modelModal) return;
    modelModal.setAttribute("aria-hidden", "false");
    // focus first option if exists
    const first = modelModal.querySelector("button");
    if (first) first.focus();
  }

  function closeModelModal() {
    if (!modelModal) return;
    modelModal.setAttribute("aria-hidden", "true");
  }

  function startNewChat() {
    conversation = [];
    setStatus("");
    showTyping(false);
    while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
    if (emptyState) messagesEl.appendChild(emptyState);
    showEmptyState(true);
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
    div.textContent = "";
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    addMessage("user", text);
    conversation.push({ role: "user", content: text });

    const model = modelSelect ? modelSelect.value : "";
    if (!model) {
      addMessage("assistant", "Please select a model from the dropdown.", true);
      setStatus("", "error");
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
        body: JSON.stringify({ messages: conversation, model: model }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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
              // Render markdown/HTML-like content safely
              try {
                messageEl.innerHTML = renderMessageContent(fullContent);
              } catch (e) {
                // fallback to plain text
                messageEl.textContent = fullContent;
              }
              scrollToBottom();
            }
          } catch (_) {}
        }
      }

      conversation.push({ role: "assistant", content: fullContent });
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

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    sendMessage();
  });

  if (newChatBtn) newChatBtn.addEventListener("click", startNewChat);
  if (modelBadge) {
    modelBadge.setAttribute("role", "button");
    modelBadge.addEventListener("click", openModelModal);
  }
  if (modelModalClose) modelModalClose.addEventListener("click", closeModelModal);
  if (modelModal) modelModal.addEventListener("click", function (e) {
    if (e.target === modelModal) closeModelModal();
  });

  // Accessibility panel logic
  const accessBtn = document.getElementById('access-btn');
  const accessPanel = document.getElementById('access-panel');
  const accessClose = document.getElementById('access-close');
  const fontBtns = document.querySelectorAll('.font-btn');
  const themeBtns = document.querySelectorAll('.theme-btn');
  const weightBtns = document.querySelectorAll('.weight-btn');
  const accessReset = document.getElementById('access-reset');

  function applyAccessibility(settings) {
    // settings: { size: 'md'|'sm'|'lg', theme: 'dark'|'light'|'sepia', weight: 'normal'|'bold' }
    const root = document.documentElement;
    // remove previous theme classes
    root.classList.remove('theme-light', 'theme-sepia');
    if (settings.theme === 'light') root.classList.add('theme-light');
    if (settings.theme === 'sepia') root.classList.add('theme-sepia');

    // font sizes on .app
    const appEl = document.querySelector('.app');
    appEl.classList.remove('font-sm','font-md','font-lg');
    appEl.classList.add(settings.size ? ('font-' + settings.size) : 'font-md');

    // weight
    appEl.classList.remove('weight-normal','weight-bold');
    appEl.classList.add(settings.weight === 'bold' ? 'weight-bold' : 'weight-normal');

    // update active buttons
    fontBtns.forEach(b => b.classList.toggle('active', b.dataset.size === settings.size));
    themeBtns.forEach(b => b.classList.toggle('active', b.dataset.theme === settings.theme));
    weightBtns.forEach(b => b.classList.toggle('active', b.dataset.weight === settings.weight));
  }

  function saveAccessibility(settings) {
    try { localStorage.setItem('accessibility', JSON.stringify(settings)); } catch(e){}
  }

  function loadAccessibility() {
    try { return JSON.parse(localStorage.getItem('accessibility') || 'null'); } catch(e) { return null; }
  }

  function openAccessPanel() {
    if (!accessPanel) return;
    accessPanel.setAttribute('aria-hidden','false');
    if (accessBtn) accessBtn.setAttribute('aria-expanded','true');
  }
  function closeAccessPanel() {
    if (!accessPanel) return;
    accessPanel.setAttribute('aria-hidden','true');
    if (accessBtn) accessBtn.setAttribute('aria-expanded','false');
  }

  if (accessBtn) accessBtn.addEventListener('click', openAccessPanel);
  if (accessClose) accessClose.addEventListener('click', closeAccessPanel);
  if (accessPanel) accessPanel.addEventListener('click', function(e){ if (e.target === accessPanel) closeAccessPanel(); });

  fontBtns.forEach(b => b.addEventListener('click', function(){
    const size = b.dataset.size || 'md';
    const settings = Object.assign({size:size}, loadAccessibility() || {});
    settings.size = size;
    applyAccessibility(settings);
    saveAccessibility(settings);
  }));

  themeBtns.forEach(b => b.addEventListener('click', function(){
    const theme = b.dataset.theme || 'dark';
    const settings = Object.assign({theme:theme}, loadAccessibility() || {});
    settings.theme = theme;
    applyAccessibility(settings);
    saveAccessibility(settings);
  }));

  weightBtns.forEach(b => b.addEventListener('click', function(){
    const weight = b.dataset.weight || 'normal';
    const settings = Object.assign({weight:weight}, loadAccessibility() || {});
    settings.weight = weight;
    applyAccessibility(settings);
    saveAccessibility(settings);
  }));

  if (accessReset) accessReset.addEventListener('click', function(){
    const defaults = { size: 'md', theme: 'dark', weight: 'normal' };
    applyAccessibility(defaults);
    saveAccessibility(defaults);
  });

  // Apply saved settings on load
  const saved = loadAccessibility();
  if (saved) applyAccessibility(saved);

  loadModels();
  if (emptyState) showEmptyState(true);
  // update padding and scroll on load
  setTimeout(function () { updateMessagesPadding(); ensureScrolled(); try { input.focus(); } catch (e) {} }, 120);

  // adjust on resize/orientation change
  window.addEventListener('resize', function () { updateMessagesPadding(); ensureScrolled(); });
  window.addEventListener('orientationchange', function () { setTimeout(function(){ updateMessagesPadding(); ensureScrolled(); }, 120); });
})();
