// ui/assistantUI.js

// ----------------------------------------------------
// CHAT HISTORY HELPERS (delegate to sessionManager)
// ----------------------------------------------------
function saveChatToHistory(goalText) {
  if (!goalText) return;
  if (!window.sessionManager) return;
  // Collect current chat messages from the UI
  const msgEls = document.querySelectorAll("#chatMessages .msg");
  const messages = [];
  msgEls.forEach(el => {
    const role = el.classList.contains("user-msg") ? "USER" : "AI";
    messages.push({ role, text: el.textContent });
  });
  window.sessionManager.saveChatSession(goalText, messages);
}

function loadChatHistory(callback) {
  if (!window.sessionManager) return callback([]);
  window.sessionManager.loadChatHistory(callback);
}

function clearCurrentChat() {
  const chat = document.getElementById("chatMessages");
  if (chat) chat.innerHTML = "";
  if (window.sessionManager) {
    window.sessionManager.reset();
    window.sessionManager.startNewChatSession(); // ✅ reset chat session ID
  }
  if (typeof interruptExecution === "function") interruptExecution();
  addMessage("AI", "Fresh start! What would you like to do?");
}

// ----------------------------------------------------
// CREATE ASSISTANT UI
// ----------------------------------------------------
function createAssistantUI() {
  if (document.getElementById("webguide-assistant")) return;

  const panel = document.createElement("div");
  panel.id = "webguide-assistant";

  panel.innerHTML = `
  <div class="assistant-root">
    <div class="phone-shell">

      <!-- Top bar -->
      <div class="topbar">
        <button class="more-btn" title="Settings">⋮</button>
        <span id="norman-key-dot" title="Gemini API key status" style="
          display:inline-block;width:7px;height:7px;border-radius:50%;
          background:#6b5fa0;margin:0 2px;align-self:center;
          flex-shrink:0;transition:background 0.3s;
        "></span>
        <button class="expand-btn" id="norman-history-btn" title="Chat history / New chat" style="font-size:13px;"></button>
        <button class="close-btn">✕</button>
      </div>

      <!-- Settings slot -->
      <div id="norman-settings-slot" style="flex-shrink:0;padding:0 16px;display:none;"></div>

      <!-- History slot -->
      <div id="norman-history-slot" style="flex-shrink:0;padding:0 16px;display:none;"></div>

      <!-- Content -->
      <div class="content">
        <div class="greeting">
          <div class="hello-line">Hi, I'm Norman.</div>
          <div class="sub-line">How can I help you today?</div>
        </div>

        <div class="chips">
          <button class="chip">Help me to Complete a task</button>
          <button class="chip">Explain how this page works</button>
        </div>

        <div id="chatMessages" class="chat-messages"></div>

        <!-- Upload preview strip -->
        <div id="norman-upload-preview-strip" style="display:none;padding:6px 12px;background:rgba(99,102,241,0.08);border-top:1px solid rgba(139,92,246,0.2);align-items:center;gap:8px;">
          <span id="norman-upload-filename" style="font-size:11px;color:#a78bfa;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
          <button id="norman-upload-remove" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:13px;padding:0;">✕</button>
        </div>

        <!-- Input -->
        <div class="prompt-bar">
          <button class="prompt-icon prompt-plus" id="norman-prompt-plus" title="Upload file or screenshot"></button>
          <input id="chatInput" class="prompt-input" placeholder="Ask anything" />
          <button class="prompt-icon prompt-mic" id="norman-prompt-mic" title="Start voice input"></button>
          <button class="prompt-action" id="sendBtn"></button>
        </div>
      </div>
    </div>
  </div>
  `;

  document.documentElement.appendChild(panel);

  panel.querySelector(".close-btn").onclick = () => panel.remove();

  panel.querySelectorAll(".chip").forEach(btn => {
    btn.onclick = () => {
      const input = document.getElementById("chatInput");
      input.value = btn.innerText;
      input.focus();
    };
  });

  const moreBtn = panel.querySelector(".more-btn");
  if (moreBtn) moreBtn.addEventListener("click", () => showSettingsPanel());

  const historyBtn = document.getElementById("norman-history-btn");
  if (historyBtn) historyBtn.addEventListener("click", () => showHistoryPanel());

  _setupPromptPlusButton();
  _setupVoiceButton();

  setTimeout(() => { refreshKeyDot(); }, 100);
}

// ----------------------------------------------------
// PROMPT BAR + BUTTON — file/image/pdf upload
// ✅ FIX: appended to document.body, no stopPropagation
// ----------------------------------------------------
let _pendingUpload = null;
let _submitAssistantQuery = null;

function _setupVoiceButton() {
  const micBtn = document.getElementById("norman-prompt-mic");
  if (!micBtn) return;

  micBtn.addEventListener("click", () => {
    if (typeof toggleVoiceNavigation === "function") {
      toggleVoiceNavigation();
    } else {
      addMessage("AI", "Voice input isn't available right now.");
    }
  });
}

function _setupPromptPlusButton() {
  const plusBtn = document.getElementById("norman-prompt-plus");
  if (!plusBtn) return;

  const oldInput = document.getElementById("norman-prompt-file-input");
  if (oldInput) oldInput.remove();

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*,application/pdf";
  fileInput.style.cssText = "opacity:0;position:fixed;width:0;height:0;";
  fileInput.id = "norman-prompt-file-input";
  // ✅ FIX: must be in document.body for Chrome trusted gesture
  document.body.appendChild(fileInput);

  plusBtn.addEventListener("click", () => {
    // ✅ FIX: no stopPropagation / preventDefault
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(",")[1];
      _pendingUpload = { base64, mediaType: file.type || "image/png", fileName: file.name, isPdf };
      const strip = document.getElementById("norman-upload-preview-strip");
      const nameEl = document.getElementById("norman-upload-filename");
      if (strip && nameEl) {
        nameEl.textContent = (isPdf ? "📄 " : "🖼️ ") + file.name;
        strip.style.display = "flex";
      }
      plusBtn.textContent = isPdf ? "📄" : "📷";
    };
    reader.readAsDataURL(file);
    fileInput.value = "";
  });

  const removeBtn = document.getElementById("norman-upload-remove");
  if (removeBtn) removeBtn.addEventListener("click", () => _clearPendingUpload());
}

function _clearPendingUpload() {
  _pendingUpload = null;
  const strip = document.getElementById("norman-upload-preview-strip");
  if (strip) strip.style.display = "none";
  const plusBtn = document.getElementById("norman-prompt-plus");
  if (plusBtn) { plusBtn.textContent = ""; plusBtn.style.color = ""; }
}

function consumePendingUpload() {
  const upload = _pendingUpload;
  _clearPendingUpload();
  return upload;
}

// ----------------------------------------------------
// SETTINGS PANEL — Gemini key only (no user profile)
// ----------------------------------------------------
function showSettingsPanel() {
  const histSlot = document.getElementById("norman-history-slot");
  if (histSlot) { histSlot.innerHTML = ""; histSlot.style.display = "none"; }

  const slot = document.getElementById("norman-settings-slot");
  if (!slot) return;

  const existing = document.getElementById("norman-settings-panel");
  if (existing) { existing.remove(); slot.style.display = "none"; return; }

  const panel = document.createElement("div");
  panel.id = "norman-settings-panel";
  panel.style.cssText = "display:flex;flex-direction:column;gap:12px;padding:12px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(139,92,246,0.25);border-radius:12px;margin-bottom:10px;";

  panel.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:#c4b5fd;">⚙️ Norman Settings</div>

    <!-- Section 1: Gemini API Key -->
    <div style="display:flex;flex-direction:column;gap:7px;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(139,92,246,0.15);border-radius:8px;">
      <div style="font-size:12px;font-weight:600;color:#a78bfa;">🔑 Gemini API Key</div>
      <div style="font-size:11px;color:#7c6faa;line-height:1.5;">
        Unlocks: screenshot &amp; document reading, page intelligence, website suggestions.<br>
        Stored locally — never shared except directly with Google.
      </div>
      <div id="norman-key-active-banner" style="display:none;font-size:11px;color:#34d399;padding:5px 8px;background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);border-radius:6px;">
        ✅ Gemini key active — all features unlocked.
      </div>
      <div id="norman-key-locked-banner" style="display:none;font-size:11px;color:#f59e0b;padding:5px 8px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:6px;">
        🔒 No Gemini key — image &amp; page features locked. Add key to unlock.
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <input id="norman-api-key-input" type="password" placeholder="AIza..."
          style="flex:1;padding:7px 10px;border:1px solid rgba(139,92,246,0.35);border-radius:6px;font-size:12px;outline:none;background:rgba(255,255,255,0.06);color:#e8e0ff;font-family:'DM Sans',sans-serif;" />
        <button id="norman-api-key-save"
          style="padding:7px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:white;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;box-shadow:0 0 12px rgba(124,58,237,0.4);">Save</button>
      </div>
      <div id="norman-key-status" style="font-size:11px;display:none;"></div>
    </div>

    <button id="norman-settings-close"
      style="align-self:flex-start;background:none;border:none;font-size:11px;color:#6b5fa0;cursor:pointer;padding:0;text-decoration:underline;font-family:'DM Sans',sans-serif;">Close</button>
  `;

  slot.innerHTML = "";
  slot.appendChild(panel);
  slot.style.display = "block";

  // populate existing saved key
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get("norman_gemini_key", (result) => {
      const k = result.norman_gemini_key;
      const keyInput = document.getElementById("norman-api-key-input");
      const activeBanner = document.getElementById("norman-key-active-banner");
      const lockedBanner = document.getElementById("norman-key-locked-banner");
      if (k) {
        if (keyInput) keyInput.placeholder = `Replace key (current: ${k.slice(0,8)}...${k.slice(-4)})`;
        if (activeBanner) activeBanner.style.display = "block";
      } else {
        if (lockedBanner) lockedBanner.style.display = "block";
      }
    });
  }

  setTimeout(() => { const ki = document.getElementById("norman-api-key-input"); if (ki) ki.focus(); }, 80);

  // save Gemini key
  const saveKeyBtn = document.getElementById("norman-api-key-save");
  if (saveKeyBtn) {
    saveKeyBtn.addEventListener("click", () => {
      const keyInput = document.getElementById("norman-api-key-input");
      const statusEl = document.getElementById("norman-key-status");
      if (!keyInput) return;
      const key = keyInput.value.trim();
      if (!key.startsWith("AIza")) {
        if (statusEl) { statusEl.style.display = "block"; statusEl.style.color = "#f87171"; statusEl.textContent = "❌ Key must start with AIza..."; }
        return;
      }
      chrome.storage.local.set({ norman_gemini_key: key }, () => {
        if (statusEl) { statusEl.style.display = "block"; statusEl.style.color = "#34d399"; statusEl.textContent = "✅ Gemini key saved — all features unlocked!"; }
        keyInput.value = ""; keyInput.placeholder = "Saved ✓"; keyInput.style.borderColor = "#34d399";
        refreshKeyDot();
        setTimeout(() => { const p = document.getElementById("norman-settings-panel"); if (p) p.remove(); slot.style.display = "none"; }, 1800);
      });
    });
  }

  const closeBtn = document.getElementById("norman-settings-close");
  if (closeBtn) closeBtn.addEventListener("click", () => { panel.remove(); slot.style.display = "none"; });
}

// ----------------------------------------------------
// HISTORY PANEL — last 5 chats + New Chat + Clear All
// ----------------------------------------------------
function showHistoryPanel() {
  const settSlot = document.getElementById("norman-settings-slot");
  if (settSlot) { settSlot.innerHTML = ""; settSlot.style.display = "none"; }

  const slot = document.getElementById("norman-history-slot");
  if (!slot) return;

  const existing = document.getElementById("norman-history-panel");
  if (existing) { existing.remove(); slot.style.display = "none"; return; }

  const panel = document.createElement("div");
  panel.id = "norman-history-panel";
  panel.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(139,92,246,0.25);border-radius:12px;margin-bottom:10px;";

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="font-size:13px;font-weight:600;color:#c4b5fd;">💬 Chat History</div>
      <div style="display:flex;gap:6px;">
        <button id="norman-clear-all-btn" style="padding:5px 10px;background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Clear All</button>
        <button id="norman-new-chat-btn" style="padding:5px 12px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:white;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">+ New Chat</button>
      </div>
    </div>
    <div id="norman-history-list" style="display:flex;flex-direction:column;gap:5px;">
      <div style="font-size:11px;color:#6b5fa0;text-align:center;padding:8px 0;">Loading...</div>
    </div>
    <button id="norman-history-close"
      style="align-self:flex-start;background:none;border:none;font-size:11px;color:#6b5fa0;cursor:pointer;padding:0;text-decoration:underline;font-family:'DM Sans',sans-serif;">Close</button>
  `;

  slot.innerHTML = "";
  slot.appendChild(panel);
  slot.style.display = "block";

  const newChatBtn = document.getElementById("norman-new-chat-btn");
  if (newChatBtn) {
    newChatBtn.addEventListener("click", () => {
      panel.remove(); slot.style.display = "none";
      clearCurrentChat();
    });
  }

  const clearAllBtn = document.getElementById("norman-clear-all-btn");
  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
      if (!window.sessionManager) return;
      window.sessionManager.clearAllChatHistory(() => {
        const listEl = document.getElementById("norman-history-list");
        if (listEl) listEl.innerHTML = `<div style="font-size:11px;color:#6b5fa0;text-align:center;padding:8px 0;">No past chats yet.</div>`;
      });
    });
  }

  // ✅ Render history list with delete buttons
  function renderHistoryList(history) {
    const listEl = document.getElementById("norman-history-list");
    if (!listEl) return;
    if (!history || history.length === 0) {
      listEl.innerHTML = `<div style="font-size:11px;color:#6b5fa0;text-align:center;padding:8px 0;">No past chats yet.</div>`;
      return;
    }
    listEl.innerHTML = "";
    history.forEach((chat) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:6px;";

      const item = document.createElement("button");
      item.style.cssText = "display:flex;flex-direction:column;gap:2px;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid rgba(139,92,246,0.18);border-radius:7px;cursor:pointer;text-align:left;flex:1;min-width:0;";
      const date = new Date(chat.timestamp);
      const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      item.innerHTML = `
        <span style="font-size:12px;color:#e8e0ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:block;">${chat.title || chat.goal || "Untitled chat"}</span>
        <span style="font-size:10px;color:#6b5fa0;">${dateStr}</span>
      `;

      // ✅ Click → restore full conversation messages
      item.addEventListener("click", () => {
        panel.remove(); slot.style.display = "none";
        const chatEl = document.getElementById("chatMessages");
        if (chatEl) chatEl.innerHTML = "";
        if (window.sessionManager) {
          window.sessionManager.startNewChatSession();
          window.sessionManager._currentChatId = chat.id; // resume same session
        }
        if (chat.messages && chat.messages.length > 0) {
          chat.messages.forEach(m => addMessage(m.role, m.text));
        } else {
          addMessage("AI", `Resuming: "${chat.title || chat.goal}". What would you like to do next?`);
        }
      });

      // ✅ Delete button (❌)
      const delBtn = document.createElement("button");
      delBtn.textContent = "❌";
      delBtn.title = "Delete this chat";
      delBtn.style.cssText = "background:none;border:none;font-size:13px;cursor:pointer;padding:4px;flex-shrink:0;opacity:0.7;line-height:1;";
      delBtn.addEventListener("click", () => {
        if (!window.sessionManager) return;
        window.sessionManager.deleteChatSession(chat.id, (updatedHistory) => {
          renderHistoryList(updatedHistory);
        });
      });

      row.appendChild(item);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });
  }

  loadChatHistory((history) => renderHistoryList(history));

  const closeBtn = document.getElementById("norman-history-close");
  if (closeBtn) closeBtn.addEventListener("click", () => { panel.remove(); slot.style.display = "none"; });
}

// ----------------------------------------------------
// REFRESH KEY DOT
// ----------------------------------------------------
function refreshKeyDot() {
  const dot = document.getElementById("norman-key-dot");
  if (!dot) return;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get("norman_gemini_key", (result) => {
      dot.style.background = result.norman_gemini_key ? "#34d399" : "#6b5fa0";
      dot.title = result.norman_gemini_key ? "Gemini key active — all features on ✓" : "No Gemini key — tap ⋮ to unlock features";
    });
  }
}

// ----------------------------------------------------
// LISTEN USER INPUT
// ----------------------------------------------------
function listenUserInput(callback) {
  const waitForInput = setInterval(() => {
    const input = document.getElementById("chatInput");
    if (!input) return;
    clearInterval(waitForInput);
    _submitAssistantQuery = (query) => {
      if (!query || !query.trim()) return false;
      input.value = query.trim();
      handleSend(callback, input);
      return true;
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSend(callback, input); });
    const sendBtn = document.getElementById("sendBtn");
    if (sendBtn) sendBtn.addEventListener("click", () => handleSend(callback, input));
  }, 100);
}

function submitAssistantQuery(query) {
  if (typeof _submitAssistantQuery !== "function") return false;
  return _submitAssistantQuery(query);
}

function handleSend(callback, input) {
  const query = input.value.trim();
  const upload = consumePendingUpload();
  if (!query && !upload) return;
  input.value = "";
  if (query) addMessage("USER", query);
  if (upload) addMessage("USER", `📎 Attached: ${upload.fileName}`);
  callback(query, upload); // upload passed to main controller
}

// ----------------------------------------------------
// SHOW PLAN
// ----------------------------------------------------
function showPlan(plan) {
  const chat = document.getElementById("chatMessages");
  if (!chat) return;
  if (!plan || !plan.phases) { addMessage("AI", "Planner failed to generate steps."); return; }
  plan.phases.forEach(phase => {
    const phaseDiv = document.createElement("div");
    phaseDiv.className = "phase-title";
    phaseDiv.textContent = phase.name || "Phase";
    chat.appendChild(phaseDiv);
    phase.steps.forEach((step, index) => {
      const stepDiv = document.createElement("div");
      stepDiv.className = "step-card";
      let actionText = "";
      if (step.action === "type") actionText = `Type <b>"${step.value}"</b> into ${step.target}`;
      else if (step.action === "click") actionText = `Click <b>${step.target}</b>`;
      else if (step.action === "select") actionText = `Select <b>"${step.value || step.target}"</b> from ${step.target}`;
      else actionText = JSON.stringify(step);
      stepDiv.innerHTML = `
        <div class="step-title">${index + 1}. ${step.target || "Step"}</div>
        <div class="step-action">👉 ${actionText}</div>
        <div class="step-explanation">💡 ${step.explanation || ""}</div>
      `;
      chat.appendChild(stepDiv);
    });
  });
  chat.scrollTop = chat.scrollHeight;
}

// ----------------------------------------------------
// ADD MESSAGE
// ----------------------------------------------------
function addMessage(sender, text) {
  const chat = document.getElementById("chatMessages");
  if (!chat) return;
  const msg = document.createElement("div");
  msg.className = sender === "USER" ? "msg user-msg" : "msg ai-msg";
  msg.textContent = text;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}

function setMicButtonState(state = {}) {
  const micBtn = document.getElementById("norman-prompt-mic");
  if (!micBtn) return;

  const supported = state.supported !== false;
  const listening = !!state.listening;
  const processing = !!state.processing;

  micBtn.classList.toggle("voice-listening", listening);
  micBtn.classList.toggle("voice-processing", processing);
  micBtn.classList.toggle("voice-disabled", !supported);

  if (!supported) {
    micBtn.disabled = true;
    micBtn.title = "Voice input is not supported in this browser";
    return;
  }

  micBtn.disabled = false;
  if (listening) micBtn.title = "Stop voice input";
  else if (processing) micBtn.title = "Processing voice input";
  else micBtn.title = "Start voice input";
}

// ----------------------------------------------------
// SHOW FEEDBACK INPUT
// ✅ UPDATED: branches on Gemini key presence.
//   Gemini key present  → shows screenshot upload + text description
//   No Gemini key       → shows text description only (no screenshot UI)
// User never sees the internal retry logic — just this prompt.
// ----------------------------------------------------
function showFeedbackInput(fieldName, callback) {
  const chat = document.getElementById("chatMessages");
  if (!chat) return;

  const existing = document.getElementById("norman-feedback-ui");
  if (existing) existing.remove();

  const oldFileInput = document.getElementById("norman-img-file");
  if (oldFileInput) oldFileInput.remove();

  // ── Check Gemini key, then render the right UI ──
  const keyPromise = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local)
    ? new Promise(resolve => chrome.storage.local.get("norman_gemini_key", r => resolve(r.norman_gemini_key || null)))
    : Promise.resolve(null);

  keyPromise.then(geminiKey => {
    _renderFeedbackInput(fieldName, callback, chat, !!geminiKey);
  });
}

function _renderFeedbackInput(fieldName, callback, chat, hasGeminiKey) {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.cssText = "opacity:0;position:fixed;width:0;height:0;";
  fileInput.id = "norman-img-file";
  // ✅ FIX: document.body for trusted gesture
  document.body.appendChild(fileInput);

  const card = document.createElement("div");
  card.id = "norman-feedback-ui";
  card.className = "msg ai-msg";
  card.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-left:3px solid #f59e0b;background:rgba(245,158,11,0.08);border-radius:8px;";

  // ── Subtitle line differs based on Gemini key availability ──
  const screenshotHint = hasGeminiKey
    ? `Describe it below — or tap <b>+</b> to upload a screenshot and I'll find it visually.`
    : `Describe it in the box below and I'll try to locate it.`;

  // ── Screenshot upload section only shown when Gemini key is present ──
  const screenshotSection = hasGeminiKey ? `
    <div id="norman-img-preview-wrap" style="display:none;position:relative;">
      <img id="norman-img-preview" style="width:100%;max-height:110px;object-fit:cover;border-radius:6px;border:1px solid #fcd34d;"/>
      <button id="norman-img-remove" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.55);color:white;border:none;border-radius:50%;width:20px;height:20px;font-size:10px;cursor:pointer;line-height:1;">✕</button>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <button id="norman-feedback-plus" title="Upload screenshot" style="width:30px;height:30px;border-radius:6px;border:1px solid rgba(139,92,246,0.3);background:rgba(255,255,255,0.05);color:#a78bfa;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:bold;">+</button>
      <input id="norman-feedback-input" type="text" placeholder="Describe the field..."
        style="flex:1;padding:7px 10px;border:1px solid rgba(139,92,246,0.3);border-radius:6px;font-size:12px;outline:none;background:rgba(255,255,255,0.05);color:#e8e0ff;font-family:'DM Sans',sans-serif;" />
      <button id="norman-feedback-submit" style="padding:7px 14px;background:#f59e0b;color:white;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;">Try →</button>
    </div>
  ` : `
    <div style="display:flex;gap:6px;align-items:center;">
      <input id="norman-feedback-input" type="text" placeholder="Describe the field..."
        style="flex:1;padding:7px 10px;border:1px solid rgba(139,92,246,0.3);border-radius:6px;font-size:12px;outline:none;background:rgba(255,255,255,0.05);color:#e8e0ff;font-family:'DM Sans',sans-serif;" />
      <button id="norman-feedback-submit" style="padding:7px 14px;background:#f59e0b;color:white;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;">Try →</button>
    </div>
  `;

  card.innerHTML = `
    <div style="font-size:13px;font-weight:500;color:#fcd34d;">
      🔍 I couldn't find the <b>${fieldName}</b> field automatically.
    </div>
    <div style="font-size:12px;color:#a8956e;margin-bottom:2px;">
      ${screenshotHint}
    </div>
    ${screenshotSection}
    <button id="norman-feedback-skip" style="align-self:flex-start;background:none;border:none;font-size:11px;color:#6b5fa0;cursor:pointer;padding:0;text-decoration:underline;font-family:'DM Sans',sans-serif;">Skip this step</button>
  `;

  chat.appendChild(card);
  chat.scrollTop = chat.scrollHeight;

  let imgBase64 = null;
  let imgMediaType = "image/png";

  setTimeout(() => { const fi = document.getElementById("norman-feedback-input"); if (fi) fi.focus(); }, 100);

  const plusBtn = document.getElementById("norman-feedback-plus");
  if (plusBtn && hasGeminiKey) {
    plusBtn.addEventListener("click", () => {
      // ✅ FIX: no stopPropagation / preventDefault
      fileInput.click();
    });
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    imgMediaType = file.type || "image/png";
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      imgBase64 = dataUrl.split(",")[1];
      const wrap = document.getElementById("norman-img-preview-wrap");
      const img = document.getElementById("norman-img-preview");
      if (wrap && img) { img.src = dataUrl; wrap.style.display = "block"; }
      if (plusBtn) { plusBtn.textContent = "📷"; plusBtn.style.background = "rgba(245,158,11,0.15)"; plusBtn.style.borderColor = "#f59e0b"; }
    };
    reader.readAsDataURL(file);
  });

  const removeBtn = document.getElementById("norman-img-remove");
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      imgBase64 = null;
      fileInput.value = "";
      const wrap = document.getElementById("norman-img-preview-wrap");
      if (wrap) wrap.style.display = "none";
      if (plusBtn) { plusBtn.textContent = "+"; plusBtn.style.background = "rgba(255,255,255,0.05)"; plusBtn.style.borderColor = "rgba(139,92,246,0.3)"; }
    });
  }

  function handleFeedbackSubmit() {
    const feedbackInput = document.getElementById("norman-feedback-input");
    if (!feedbackInput) return;
    const description = feedbackInput.value.trim();
    if (!description && !imgBase64) {
      feedbackInput.style.borderColor = "#f87171";
      feedbackInput.placeholder = "Please describe or upload a screenshot";
      return;
    }
    if (description) addMessage("USER", description);
    else addMessage("USER", "📷 Uploaded a screenshot for field detection");
    card.remove();
    fileInput.remove();
    callback(description || "", imgBase64, imgMediaType);
  }

  const feedbackInput = document.getElementById("norman-feedback-input");
  if (feedbackInput) feedbackInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleFeedbackSubmit(); });

  const submitBtn = document.getElementById("norman-feedback-submit");
  if (submitBtn) submitBtn.addEventListener("click", handleFeedbackSubmit);

  const skipBtn = document.getElementById("norman-feedback-skip");
  if (skipBtn) {
    skipBtn.addEventListener("click", () => {
      card.remove();
      fileInput.remove();
      addMessage("AI", `Okay, skipping the ${fieldName} step. You can fill it in manually.`);
      if (typeof nextStep === "function") nextStep();
    });
  }
}

// ----------------------------------------------------
// SHOW DONE CONTINUE BUTTON
// ----------------------------------------------------
function showDoneContinueButton(onContinue) {
  const chat = document.getElementById("chatMessages");
  if (!chat) return;
  const existing = document.getElementById("norman-done-continue");
  if (existing) existing.remove();
  const wrapper = document.createElement("div");
  wrapper.id = "norman-done-continue";
  wrapper.style.cssText = "display:flex;align-items:center;gap:10px;margin:8px 0;padding:10px 12px;background:rgba(16,185,129,0.08);border-left:3px solid #10b981;border-radius:8px;";
  wrapper.innerHTML = `
    <div style="flex:1;font-size:12px;color:#6ee7b7;">✏️ Fill in the field above, then tap <b>Done</b> to continue.</div>
    <button id="norman-done-btn" style="padding:8px 18px;background:#10b981;color:white;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;">Done, Continue →</button>
  `;
  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
  const doneBtn = document.getElementById("norman-done-btn");
  if (doneBtn) {
    doneBtn.addEventListener("click", () => {
      wrapper.remove();
      addMessage("AI", "Got it — moving to the next step.");
      if (typeof onContinue === "function") onContinue();
    });
  }
}

// ----------------------------------------------------
// SHOW CONFIRMATION BUTTONS
// ----------------------------------------------------
function showConfirmationButtons(foundEl, onYes, onNo) {
  const chat = document.getElementById("chatMessages");
  if (!chat) return;
  const existing = document.getElementById("norman-confirm-ui");
  if (existing) existing.remove();
  if (foundEl) { foundEl.style.boxShadow = "0 0 0 4px #6366f1"; foundEl.style.outline = "2px dashed #6366f1"; foundEl.scrollIntoView({ behavior: "smooth", block: "center" }); }
  const wrapper = document.createElement("div");
  wrapper.id = "norman-confirm-ui";
  wrapper.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px 12px;background:rgba(99,102,241,0.08);border-left:3px solid #6366f1;border-radius:8px;margin:6px 0;";
  wrapper.innerHTML = `
    <div style="font-size:13px;font-weight:500;color:#c4b5fd;">🎯 Is this the field you meant?</div>
    <div style="font-size:12px;color:#7c6faa;">I've highlighted it in purple. Confirm if this is correct.</div>
    <div style="display:flex;gap:8px;">
      <button id="norman-confirm-yes" style="flex:1;padding:8px;background:#10b981;color:white;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">✅ Yes, that's it</button>
      <button id="norman-confirm-no" style="flex:1;padding:8px;background:#ef4444;color:white;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">❌ No, try again</button>
    </div>
  `;
  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
  const yesBtn = document.getElementById("norman-confirm-yes");
  if (yesBtn) {
    yesBtn.addEventListener("click", () => {
      wrapper.remove();
      if (foundEl) { foundEl.style.outline = ""; foundEl.style.boxShadow = "0 0 0 4px red"; }
      addMessage("AI", "Got it — using that field!");
      if (typeof onYes === "function") onYes();
    });
  }
  const noBtn = document.getElementById("norman-confirm-no");
  if (noBtn) {
    noBtn.addEventListener("click", () => {
      wrapper.remove();
      if (foundEl) { foundEl.style.outline = ""; foundEl.style.boxShadow = ""; }
      addMessage("AI", "No problem — can you describe it differently or upload another screenshot?");
      if (typeof onNo === "function") onNo();
    });
  }
}
