(function () {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("user-input");
  const messagesEl = document.getElementById("messages");
  const emptyState = document.getElementById("empty-state");
  const typingIndicator = document.getElementById("typing-indicator");
  const statusEl = document.getElementById("status");
  const sendBtn = document.getElementById("send-btn");

  let conversation = [];

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
        body: JSON.stringify({ messages: conversation }),
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

  if (emptyState) showEmptyState(true);
  input.focus();
})();
