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
      // show selected model name in the badge when available, otherwise show count
      if (modelSelect && modelSelect.value) {
        if (modelBadge) modelBadge.textContent = modelSelect.value;
      } else if (!modelBadge) {
        // noop
      } else if (models.length === 0) {
        modelBadge.textContent = "No models";
      } else {
        modelBadge.textContent = models.length + " model" + (models.length > 1 ? "s" : "");
      }

      if (models.length === 0) {
        modelSelect.innerHTML = '<option value="">No models found</option>';
        return;
      }

      models.forEach(function (name) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        modelSelect.appendChild(opt);
      });

      // choose first model by default if none selected
      if (!modelSelect.value && models.length) {
        modelSelect.value = models[0];
      }

      // populate modal list for mobile picker
      if (modelModalList) {
        modelModalList.innerHTML = "";
        models.forEach(function (name) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "model-option";
          btn.setAttribute('data-model-name', name);
          btn.textContent = name;
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
              messageEl.textContent = fullContent;
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

  loadModels();
  if (emptyState) showEmptyState(true);
  // update padding and scroll on load
  setTimeout(function () { updateMessagesPadding(); ensureScrolled(); try { input.focus(); } catch (e) {} }, 120);

  // adjust on resize/orientation change
  window.addEventListener('resize', function () { updateMessagesPadding(); ensureScrolled(); });
  window.addEventListener('orientationchange', function () { setTimeout(function(){ updateMessagesPadding(); ensureScrolled(); }, 120); });
})();
