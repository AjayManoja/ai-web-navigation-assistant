(function () {
  class SessionManager {
    constructor() {
      this.key = "agent_session";
      this.fieldMemoryKey = "norman_field_memory";
      this.session = this.load() || this.createEmpty();
      this._rejectedElements = new Set();
      // Per-session score weight adjustments — { fieldKey → multiplier }
      // Increases after each user correction so the right signal wins faster.
      this._scoreWeights = {};
    }

    createEmpty() {
      return {
        goal: null,
        mergedGoal: null,
        conversationHistory: [],
        currentStep: 0,
        currentPhase: 0,
        completedSteps: [],
        pendingSteps: [],
        history: [],
        lastAction: null,
        lastPlan: null,
        status: "idle"
      };
    }

    load() {
      try {
        return JSON.parse(localStorage.getItem(this.key));
      } catch {
        return null;
      }
    }

    save() {
      localStorage.setItem(this.key, JSON.stringify(this.session));
    }

    // preserve conversation history across task starts
    start(goal) {
      const prevHistory = this.session.conversationHistory || [];
      this.session = this.createEmpty();
      this.session.goal = goal;
      this.session.mergedGoal = goal;
      this.session.conversationHistory = prevHistory;
      this.session.status = "running";
      this._currentChatId = null;
      // Reset per-session state
      this._rejectedElements = new Set();
      this._scoreWeights = {};
      // Clear committed element registry for fresh task
      if (typeof window._clearAllCommitted === "function") window._clearAllCommitted();
      this.save();
    }

    addToHistory(role, text) {
      if (!this.session.conversationHistory) {
        this.session.conversationHistory = [];
      }
      this.session.conversationHistory.push({
        role,  // "user" or "assistant"
        text,
        timestamp: Date.now()
      });
      // keep last 10 messages only
      if (this.session.conversationHistory.length > 10) {
        this.session.conversationHistory = this.session.conversationHistory.slice(-10);
      }
      this.save();
    }

    //get full conversation history
    getHistory() {
      return this.session.conversationHistory || [];
    }

    //update merged/refined goal
    updateGoal(goal) {
      this.session.goal = goal;
      this.session.mergedGoal = goal;
      this.save();
    }

    // interrupt current execution for plan update
    interrupt() {
      this.session.status = "interrupted";
      this.session.currentPhase = 0;
      this.session.currentStep = 0;
      this.session.lastPlan = null;
      this.session.pendingSteps = [];
      this.save();
    }

    addStep(step) {
      this.session.pendingSteps.push(step);
      this.save();
    }

    completeStep(step) {
      this.session.completedSteps.push(step);
      this.session.currentStep++;
      this.save();
    }

    logAction(action) {
      this.session.history.push({
        ...action,
        timestamp: Date.now()
      });
      this.session.lastAction = action;
      this.save();
    }

    getSession() {
      return this.session;
    }

    reset() {
      localStorage.removeItem(this.key);
      this.session = this.createEmpty();

      // FIX 5: clear all per-session state so stale memory never bleeds across tasks
      this._rejectedElements = new Set();
      this._scoreWeights = {};

      if (typeof window._clearAllCommitted === "function") {
        window._clearAllCommitted();
      }

      console.log("[SESSION RESET COMPLETE]");
    }

    // ============================================
    // CHAT HISTORY METHODS (last 5 chats)
    // Key: norman_chat_history
    // Each entry: { id, title, messages[], timestamp }
    // ============================================

    saveChatSession(title, messages) {
      if (!title) return;
      const chatKey = "norman_chat_history";
      chrome.storage.local.get(chatKey, (result) => {
        try {
          let history = result[chatKey] || [];
          // Remove duplicate entry with same id if updating current session
          const id = this._currentChatId || Date.now();
          this._currentChatId = id;
          history = history.filter(c => c.id !== id);
          history.unshift({ id, title, messages: messages || [], timestamp: Date.now() });
          // Keep only latest 5
          chrome.storage.local.set({ [chatKey]: history.slice(0, 5) });
        } catch (e) {
          console.warn("[sessionManager] saveChatSession failed:", e);
        }
      });
    }

    loadChatHistory(callback) {
      chrome.storage.local.get("norman_chat_history", (result) => {
        callback(result.norman_chat_history || []);
      });
    }

    deleteChatSession(id, callback) {
      chrome.storage.local.get("norman_chat_history", (result) => {
        try {
          const history = (result.norman_chat_history || []).filter(c => c.id !== id);
          chrome.storage.local.set({ norman_chat_history: history }, () => {
            if (typeof callback === "function") callback(history);
          });
        } catch (e) {
          console.warn("[sessionManager] deleteChatSession failed:", e);
        }
      });
    }

    clearAllChatHistory(callback) {
      chrome.storage.local.set({ norman_chat_history: [] }, () => {
        if (typeof callback === "function") callback();
      });
    }

    startNewChatSession() {
      this._currentChatId = null;
    }

    // ============================================
    // NEW: PERSISTENT FIELD MEMORY METHODS
    // Saves per-domain field knowledge from user
    // Storage: norman_field_memory → { domain → { FIELD → { ... } } }
    // FIX 1: migrated from localStorage to chrome.storage.local
    // ============================================

    // Save a field description + resolved selector for a domain
    saveFieldMemory(domain, fieldName, userDescription, resolvedSelector) {
      chrome.storage.local.get(this.fieldMemoryKey, (result) => {
        try {
          let allMemory = result[this.fieldMemoryKey] || {};

          if (!allMemory[domain]) {
            allMemory[domain] = {};
          }

          allMemory[domain][fieldName] = {
            userDescription: userDescription || "",
            resolvedSelector: resolvedSelector || null,
            confirmedAt: Date.now()
          };

          chrome.storage.local.set({ [this.fieldMemoryKey]: allMemory }, () => {
            console.log("[FIELD MEMORY SAVED]", domain, fieldName, allMemory[domain][fieldName]);
          });
        } catch (e) {
          console.warn("[sessionManager] saveFieldMemory failed:", e);
        }
      });
    }

    //Get saved field memory for a specific domain + field
    getFieldMemory(domain, fieldName, callback) {
      chrome.storage.local.get(this.fieldMemoryKey, (result) => {
        try {
          const allMemory = result[this.fieldMemoryKey] || {};
          const domainMemory = allMemory[domain];
          if (!domainMemory) return callback(null);
          callback(domainMemory[fieldName] || null);
        } catch (e) {
          console.warn("[sessionManager] getFieldMemory failed:", e);
          callback(null);
        }
      });
    }

    //Get all saved field memory for a domain
    getDomainMemory(domain, callback) {
      chrome.storage.local.get(this.fieldMemoryKey, (result) => {
        try {
          const allMemory = result[this.fieldMemoryKey] || {};
          callback(allMemory[domain] || {});
        } catch (e) {
          console.warn("[sessionManager] getDomainMemory failed:", e);
          callback({});
        }
      });
    }

    // Clear a specific field from memory (used when selector goes stale)
    clearFieldMemory(domain, fieldName) {
      chrome.storage.local.get(this.fieldMemoryKey, (result) => {
        try {
          const allMemory = result[this.fieldMemoryKey] || {};
          if (allMemory[domain] && allMemory[domain][fieldName]) {
            delete allMemory[domain][fieldName];
            chrome.storage.local.set({ [this.fieldMemoryKey]: allMemory }, () => {
              console.log("[FIELD MEMORY CLEARED]", domain, fieldName);
            });
          }
        } catch (e) {
          console.warn("[sessionManager] clearFieldMemory failed:", e);
        }
      });
    }

    //Clear all field memory for a domain
    clearDomainMemory(domain) {
      chrome.storage.local.get(this.fieldMemoryKey, (result) => {
        try {
          const allMemory = result[this.fieldMemoryKey] || {};
          if (allMemory[domain]) {
            delete allMemory[domain];
            chrome.storage.local.set({ [this.fieldMemoryKey]: allMemory }, () => {
              console.log("[FIELD MEMORY DOMAIN CLEARED]", domain);
            });
          }
        } catch (e) {
          console.warn("[sessionManager] clearDomainMemory failed:", e);
        }
      });
    }

    // ============================================
    // PER-SESSION REJECTION BLACKLIST
    // Any element the user rejects is immediately blacklisted for this session.
    // isRejected() is checked BEFORE scoring so the same element is never offered twice.
    // ============================================

    rejectElement(element) {
      if (!element) return;
      // Store a stable key: prefer id, then name, then position hash
      const key = element.id
        ? `#${element.id}`
        : element.name
          ? `[name="${element.name}"]`
          : `__el_${Math.round(element.getBoundingClientRect().left)}_${Math.round(element.getBoundingClientRect().top)}`;
      this._rejectedElements.add(key);
      // Also store the element reference directly for same-session checks
      this._rejectedElements.add(element);

      // FIX 2: hard flag directly on DOM node — scoring systems can skip instantly
      //    without hitting the Set lookup at all
      try { element.__normanRejected = true; } catch(e) {}

      console.log("[REJECTION BLACKLIST] added:", key);

      // ✅ FIX 4: delegate eviction to named method for consistency
      this.removeCommittedIfRejected(element);
    }

    // ✅ FIX 4: named method — called by rejectElement and usable externally
    removeCommittedIfRejected(element) {
      if (!element) return;
      if (typeof window._evictCommitted === "function") {
        window._evictCommitted(element);
        console.log("[SYNC] removed committed element due to rejection");
      }
    }

    isRejected(element) {
      if (!element) return false;

      // Direct reference (fastest — same-session, pre-re-render)
      if (this._rejectedElements.has(element)) return true;

      // ✅ FIX 2 hard flag — set directly on DOM node at rejection time
      if (element.__normanRejected === true) return true;

      // ID / name based (survives re-render if attributes unchanged)
      if (element.id && this._rejectedElements.has(`#${element.id}`)) return true;
      if (element.name && this._rejectedElements.has(`[name="${element.name}"]`)) return true;

      // ✅ FIX 1: positional fallback — survives re-renders where id/name are absent
      try {
        const rect = element.getBoundingClientRect();
        const posKey = `__el_${Math.round(rect.left)}_${Math.round(rect.top)}`;
        if (this._rejectedElements.has(posKey)) return true;
      } catch(e) {}

      return false;
    }

    clearRejections() {
      this._rejectedElements = new Set();
    }

    // ============================================
    // PER-SESSION SCORE WEIGHT LEARNING
    // After each user correction, boost the weight for the signal type that
    // would have found the correct element — so the next similar field is
    // found confidently without asking the user again.
    // ============================================

    boostScoreWeight(fieldKey, signalType, amount = 1.5) {
      // FIX 3: guard against bad input
      if (!fieldKey || !signalType) return;

      const key = `${fieldKey}:${signalType}`;
      this._scoreWeights[key] = (this._scoreWeights[key] || 1.0) * amount;

      // FIX 3: clamp to prevent runaway scoring that overpowers correct elements
      if (this._scoreWeights[key] > 3.0) {
        this._scoreWeights[key] = 3.0;
      }

      console.log("[SCORE WEIGHT BOOST]", key, "→", this._scoreWeights[key]);
    }

    getScoreWeight(fieldKey, signalType) {
      const key = `${fieldKey}:${signalType}`;
      return this._scoreWeights[key] || 1.0;
    }

    // FIX 6: debug visibility — call window.sessionManager.getDebugState() in console
    //    to inspect why an element keeps being selected or a weight is imbalanced
    getDebugState() {
      return {
        rejectedCount:    this._rejectedElements.size,
        scoreWeights:     { ...this._scoreWeights },
        sessionStatus:    this.session?.status || "unknown",
        currentGoal:      this.session?.mergedGoal || this.session?.goal || null,
      };
    }

    // ============================================
    // CORRECTION PATTERN LEARNING (persistent across sessions)
    // ============================================
    // When the user says "wrong field, use this one", store the correction
    // so the same mismatch is never repeated on this domain.
    // Storage key: norman_correction_patterns
    // Shape: { domain → { "user phrase" → { fieldKey, resolvedSelector, confirmedAt } } }
    // ============================================

    saveCorrectionPattern(domain, userPhrase, fieldKey, resolvedSelector) {
      const corrKey = "norman_correction_patterns";
      chrome.storage.local.get(corrKey, (result) => {
        try {
          let patterns = result[corrKey] || {};
          if (!patterns[domain]) patterns[domain] = {};
          const normPhrase = (userPhrase || "").toLowerCase().trim();
          patterns[domain][normPhrase] = {
            fieldKey,
            resolvedSelector: resolvedSelector || null,
            confirmedAt: Date.now(),
          };
          chrome.storage.local.set({ [corrKey]: patterns }, () => {
            console.log("[CORRECTION PATTERN SAVED]", domain, normPhrase, "→", fieldKey);
          });
        } catch (e) {
          console.warn("[sessionManager] saveCorrectionPattern failed:", e);
        }
      });
    }

    // Look up a stored correction pattern for a phrase on this domain.
    // Returns { fieldKey, resolvedSelector } or null.
    getCorrectionPattern(domain, userPhrase, callback) {
      const corrKey = "norman_correction_patterns";
      chrome.storage.local.get(corrKey, (result) => {
        try {
          const patterns = result[corrKey] || {};
          const domainPatterns = patterns[domain] || {};
          const normPhrase = (userPhrase || "").toLowerCase().trim();

          // Exact match first
          if (domainPatterns[normPhrase]) return callback(domainPatterns[normPhrase]);

          // Partial match — if any saved phrase is contained in the query or vice versa
          for (const [savedPhrase, meta] of Object.entries(domainPatterns)) {
            if (normPhrase.includes(savedPhrase) || savedPhrase.includes(normPhrase)) {
              return callback(meta);
            }
          }
          callback(null);
        } catch (e) {
          console.warn("[sessionManager] getCorrectionPattern failed:", e);
          callback(null);
        }
      });
    }

    // Get all correction patterns for a domain (for debug / UI display)
    getAllCorrectionPatterns(domain, callback) {
      chrome.storage.local.get("norman_correction_patterns", (result) => {
        try {
          const patterns = result["norman_correction_patterns"] || {};
          callback(patterns[domain] || {});
        } catch (e) {
          callback({});
        }
      });
    }

    // Clear correction patterns for a domain (e.g. when the user resets)
    clearCorrectionPatterns(domain) {
      chrome.storage.local.get("norman_correction_patterns", (result) => {
        try {
          const patterns = result["norman_correction_patterns"] || {};
          delete patterns[domain];
          chrome.storage.local.set({ "norman_correction_patterns": patterns });
        } catch (e) {
          console.warn("[sessionManager] clearCorrectionPatterns failed:", e);
        }
      });
    }

  }
  window.sessionManager = new SessionManager();
})();
