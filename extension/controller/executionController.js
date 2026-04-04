// executionController.js
// ✅ UPDATED: Universal Click Engine integrated (universalClickEngine.js)
//             fireClickChain → universalFire
//             handleClickDate → fully replaced
//             isCalendarOpen → fully replaced
//             All Gemini logic preserved as bonus-only
//             All feedback loop logic preserved

let currentPhase    = 0;
let currentStep     = 0;
let currentPlan     = null;
let currentElement  = null;
let currentStepId   = 0;
let executionRunning = false;
let typingTimer     = null;

// ─── SAVE EXECUTION STATE ─────────────────────────────────────────────────────
function saveExecutionState() {
    if (!window.sessionManager) return;
    const session = window.sessionManager.getSession();
    if (!session) return;
    session.currentPhase = currentPhase;
    session.currentStep  = currentStep;
    window.sessionManager.save();
}

function recordAction(actionType = "unknown", target = "", result = "success") {
    if (!window.sessionManager) return;
    window.sessionManager.logAction({ action: actionType, target, result });
}

// ─── UTILITY ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── INTERRUPT ────────────────────────────────────────────────────────────────
function interruptExecution() {
    console.log("[INTERRUPT] Stopping current execution for plan update");
    if (currentElement) { currentElement.style.boxShadow = ""; currentElement = null; }
    if (typingTimer)    { clearTimeout(typingTimer); typingTimer = null; }
    currentPlan      = null;
    currentPhase     = 0;
    currentStep      = 0;
    currentStepId    = 0;
    executionRunning = false;
    if (typeof clearFieldLocks === "function") clearFieldLocks();
    if (typeof clearMemory     === "function") clearMemory();
    if (window.sessionManager)  window.sessionManager.interrupt();
    if (typeof window._clearAllCommitted === "function") window._clearAllCommitted();
    console.log("[INTERRUPT] Execution cleared. Ready for new plan.");
}

// ─── GET GEMINI KEY ───────────────────────────────────────────────────────────
function getGeminiKey() {
    return new Promise((resolve) => {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get("norman_gemini_key", (result) => resolve(result.norman_gemini_key || null));
        } else {
            try { resolve(localStorage.getItem("norman_gemini_key") || null); } catch(e) { resolve(null); }
        }
    });
}

// ─── GET USER PROFILE ─────────────────────────────────────────────────────────
function getUserProfile() {
    return new Promise((resolve) => {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get("norman_user_profile", (result) => resolve(result.norman_user_profile || {}));
        } else {
            resolve({});
        }
    });
}

// ─── PAGE CHECK ───────────────────────────────────────────────────────────────
async function checkPageCapability(goal) {
    const geminiKey = await getGeminiKey();
    if (!geminiKey) return;
    try {
        const res = await fetch("http://localhost:5000/page-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ goal, pageUrl: window.location.href, pageTitle: document.title, geminiKey })
        });
        const data = await res.json();
        if (data.canComplete === false) {
            addMessage("AI", `⚠️ ${data.reason}`);
            if (data.suggestedSite) addMessage("AI", `💡 Try visiting ${data.suggestedSite} instead — it's better suited for this task.`);
            return false;
        }
        return true;
    } catch (err) {
        console.warn("[PAGE CHECK] failed:", err);
        return true;
    }
}

// ─── HANDLE UPLOADED FILE ─────────────────────────────────────────────────────
async function handlePromptUpload(upload, userMessage) {
    const geminiKey = await getGeminiKey();
    if (!geminiKey) {
        addMessage("AI", "🔒 Document reading needs a Gemini API key. Go to ⋮ Settings to add one and unlock this feature.");
        return;
    }
    addMessage("AI", `📖 Reading your ${upload.isPdf ? "document" : "screenshot"}...`);
    try {
        const res = await fetch("http://localhost:5000/read-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                base64: upload.base64, mediaType: upload.mediaType,
                fileName: upload.fileName, pageUrl: window.location.href,
                pageTitle: document.title, geminiKey
            })
        });
        const data = await res.json();
        if (data.error === "no_key") { addMessage("AI", data.message); return; }
        if (!data.extractedFields || data.extractedFields.length === 0) {
            addMessage("AI", `I read the file but couldn't find any form data in it. ${data.summary || ""}`);
            return;
        }
        addMessage("AI", `📋 Found: ${data.summary}`);
        addMessage("AI", `I'll now fill in the fields I found — ${data.extractedFields.map(f => f.fieldName).join(", ")}.`);
        const steps = data.extractedFields.map(f => {
            const target = f.fieldName.toLowerCase();
            let action = "type";
            if (["origin","destination","from","to","city","location","hotel"].some(k => target.includes(k))) action = "search_select";
            else if (["date","checkin","checkout","departure","depart","return"].some(k => target.includes(k))) action = "click_date";
            return { action, target: f.fieldName, value: f.value };
        });
        const combinedGoal = userMessage ? `${userMessage} — using data from uploaded file` : `Fill form using data from ${upload.fileName}`;
        if (window.sessionManager) {
            window.sessionManager.start(combinedGoal);
            window.sessionManager.startNewChatSession();
            if (typeof saveChatToHistory === "function") saveChatToHistory(combinedGoal);
        }
        startExecution({ phases: [{ name: "Fill from uploaded file", steps }] });
    } catch (err) {
        console.error("[HANDLE UPLOAD ERROR]", err);
        addMessage("AI", "I had trouble reading that file. Please try again or describe what you need.");
    }
}

// ─── ACTION INTENT RESOLUTION ─────────────────────────────────────────────────
function resolveActionIntent(step) {
    if (!step || !step.target) return step;
    const target = step.target.toLowerCase();

    if (step.action === "click") {
        if (target.includes("search"))                                        step.intent = "SUBMIT_SEARCH";
        else if (target.includes("submit") || target.includes("continue"))   step.intent = "SUBMIT_FORM";
        else if (target.includes("login")  || target.includes("sign in"))    step.intent = "LOGIN_ACTION";
    }
    if (step.action === "type") {
        if (target.includes("from") || target.includes("origin"))            step.intent = "INPUT_ORIGIN";
        else if (target.includes("to") || target.includes("destination"))    step.intent = "INPUT_DESTINATION";
        else if (target.includes("date"))                                    step.intent = "INPUT_DATE";
    }

    if (!step.fieldKey || !step.uiType) {
        if (typeof resolveSemanticAlias === "function") {
            const alias = resolveSemanticAlias(step.target);
            if (alias) {
                step.fieldKey = step.fieldKey || alias.fieldKey;
                step.uiType   = step.uiType   || alias.uiType;
                if (alias.uiType === "date_picker" || alias.uiType === "calendar_trigger") {
                    if (step.action !== "click_date") {
                        console.log("[INTENT] auto-upgrading action to click_date for", step.target);
                        step.action = "click_date";
                    }
                }
                if (alias.uiType === "search_select" && step.action === "type") {
                    console.log("[INTENT] auto-upgrading action to search_select for", step.target);
                    step.action = "search_select";
                }
            }
        }
    }
    return step;
}

// ─── ENSURE INPUT READY ───────────────────────────────────────────────────────
function ensureInputReady(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") return element;
    element.click();
    const container = element.closest("div,section,form") || document.body;
    const input     = container.querySelector("input, textarea");
    return input || element;
}

// ─── RESOLVE FIELD KEY ────────────────────────────────────────────────────────
function resolveFieldKey(target) {
    if (!target) return null;
    const t = target.toLowerCase();
    if (t.includes("origin") || t.includes("from"))                          return "ORIGIN";
    if (t.includes("destination") || t.includes("to"))                       return "DESTINATION";
    if (t.includes("return"))                                                 return "RETURN_DATE";
    if (t.includes("depart") || t.includes("departure") || t.includes("outbound")) return "DEPART_DATE";
    if (t.includes("date"))                                                   return "DATE";
    if (t.includes("passenger") || t.includes("traveller"))                  return "PASSENGERS";
    if (t.includes("search"))                                                 return "SEARCH";
    return target.toUpperCase().replace(/\s/g, "_");
}

// ─── RE-SCAN WITH DESCRIPTION ─────────────────────────────────────────────────
function reScanWithDescription(description, uiTypeHint) {
    if (!description) return null;
    const desc = description.toLowerCase().trim();

    const candidates = document.querySelectorAll(
        "input, textarea, select, button, [role='combobox'], [role='button'], [contenteditable='true']," +
        "div[class*='date' i], span[class*='date' i], div[class*='depart' i]," +
        "div[class*='calendar' i], div[class*='picker' i]," +
        "[data-date], [data-datepicker]"
    );

    if (uiTypeHint && typeof detectElementRole === "function") {
        let bestByRole = null, bestRoleScore = -1;
        for (const el of candidates) {
            if (el.closest("#webguide-assistant")) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) continue;
            const elRole = detectElementRole(el);
            let roleScore = 0;
            if (elRole === uiTypeHint)                                                roleScore = 2;
            if (uiTypeHint === "date_picker"      && elRole === "calendar_trigger")   roleScore = 2;
            if (uiTypeHint === "calendar_trigger" && elRole === "date_picker")        roleScore = 2;
            if (uiTypeHint === "search_select"    && elRole === "search_select")      roleScore = 2;
            if (roleScore > bestRoleScore) { bestRoleScore = roleScore; bestByRole = el; }
        }
        if (bestByRole && bestRoleScore >= 2) {
            console.log("[RE-SCAN ROLE MATCH]", uiTypeHint, bestByRole);
            return bestByRole;
        }
    }

    for (const el of candidates) {
        if (el.closest("#webguide-assistant")) continue;
        const elText = [
            el.innerText || "", el.placeholder || "",
            el.getAttribute("aria-label") || "",
            el.getAttribute("aria-labelledby") ? (document.getElementById(el.getAttribute("aria-labelledby"))?.innerText || "") : "",
            el.value || "", el.name || "", el.id || "",
            [...(el.classList||[])].join(" ")
        ].join(" ").toLowerCase();
        const descWords  = desc.split(/\s+/).filter(w => w.length > 2);
        const matchCount = descWords.filter(word => elText.includes(word)).length;
        if (matchCount >= Math.ceil(descWords.length * 0.5)) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) continue;
            console.log("[RE-SCAN MATCH]", el, "matchCount:", matchCount);
            return el;
        }
    }
    return null;
}

// ─── RE-SCAN WITH SPATIAL DESCRIPTION ────────────────────────────────────────
function reScanWithSpatial(description) {
    if (!description) return null;
    const desc = description.toLowerCase().trim();

    const wantRight  = desc.includes("right");
    const wantLeft   = desc.includes("left");
    const wantTop    = desc.includes("top")    || desc.includes("above");
    const wantBottom = desc.includes("bottom") || desc.includes("below");
    const wantCenter = desc.includes("center") || desc.includes("middle");

    if (!wantRight && !wantLeft && !wantTop && !wantBottom && !wantCenter) return null;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let refEl = null;
    const refMatch = desc.match(/(?:from|of|next to|beside|after)\s+([a-z]+)/);
    if (refMatch) {
        const refWord  = refMatch[1];
        const allNodes = document.querySelectorAll("label, span, div, p, strong, input, button");
        for (const node of allNodes) {
            if (node.closest("#webguide-assistant")) continue;
            const nodeText = (node.innerText || node.placeholder || node.getAttribute("aria-label") || "").toLowerCase();
            if (nodeText.includes(refWord) && isVisible(node)) { refEl = node; break; }
        }
    }

    const allInputs = document.querySelectorAll(
        "input, textarea, select, [role='combobox'], [role='textbox'], button," +
        "div[class*='date' i], span[class*='date' i], div[class*='depart' i]," +
        "div[class*='calendar' i], div[class*='picker' i]," +
        "[data-date], [data-datepicker]"
    );
    let bestEl = null, bestScore = 0;

    for (const el of allInputs) {
        if (el.closest("#webguide-assistant")) continue;
        if (!isVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) continue;

        let score = 0;
        const cx = rect.left + rect.width  / 2;
        const cy = rect.top  + rect.height / 2;

        if (wantRight  && cx > vw * 0.5) score += 10;
        if (wantLeft   && cx < vw * 0.5) score += 10;
        if (wantTop    && cy < vh * 0.4) score += 10;
        if (wantBottom && cy > vh * 0.6) score += 10;
        if (wantCenter && cx > vw * 0.3 && cx < vw * 0.7) score += 8;

        if (refEl) {
            const refRect = refEl.getBoundingClientRect();
            const refCx = refRect.left + refRect.width  / 2;
            const refCy = refRect.top  + refRect.height / 2;
            const dist  = Math.sqrt((cx-refCx)**2 + (cy-refCy)**2);
            if (dist < 400) score += 15;
            if (dist < 200) score += 10;
            if (wantRight  && cx > refCx) score += 20;
            if (wantLeft   && cx < refCx) score += 20;
            if (wantBottom && cy > refCy) score += 20;
            if (wantTop    && cy < refCy) score += 20;
        }
        if (score > bestScore) { bestScore = score; bestEl = el; }
    }

    if (bestEl && bestScore >= 10) {
        console.log("[SPATIAL RESCAN MATCH]", bestScore, desc, bestEl);
        return bestEl;
    }
    return null;
}

// ─── CALL VISION API (Gemini) ─────────────────────────────────────────────────
async function callVisionAPI(fieldName, imageBase64, mediaType, userDescription) {
    const apiKey = await getGeminiKey();
    if (!apiKey) {
        console.warn("[VISION] No Gemini API key found.");
        addMessage("AI", "I need a Gemini API key to analyse screenshots. Tap ⋮ and add your key to unlock this feature.");
        return null;
    }
    addMessage("AI", "📷 Analysing your screenshot to find the field...");
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { inline_data: { mime_type: mediaType || "image/png", data: imageBase64 } },
                            { text: `I am trying to find the "${fieldName}" field on this webpage screenshot.\n${userDescription ? `The user described it as: "${userDescription}"\n` : ""}Look at the screenshot carefully and describe the element I should interact with. Be specific about:\n1. What text or label it shows\n2. Its color or visual style\n3. Where it is on the page (left/right/center, top/bottom)\n4. What is immediately next to it\nKeep your answer to 2-3 sentences maximum.` }
                        ]
                    }],
                    generationConfig: { maxOutputTokens: 300 }
                })
            }
        );
        const data = await response.json();
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            console.warn("[VISION] Empty response from Gemini — continuing with internal logic");
            return null;
        }
        const description = data.candidates[0].content.parts.filter(p => p.text).map(p => p.text).join(" ").trim();
        console.log("[VISION] Gemini description:", description);
        return description;
    } catch (err) {
        console.error("[VISION API ERROR]", err);
        console.warn("[VISION] Gemini failed — continuing without vision hints");
        return null;
    }
}

// ─── CALL GEMINI VISION FIELD ─────────────────────────────────────────────────
async function callGeminiVisionField(fieldName, imageBase64, mediaType) {
    const geminiKey = await getGeminiKey();
    if (!geminiKey) return null;
    try {
        const res = await fetch("http://localhost:5000/gemini-vision-field", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                fieldName, imageBase64, mediaType: mediaType || "image/png",
                geminiKey, pageUrl: window.location.href, pageTitle: document.title
            })
        });
        if (!res.ok) { console.warn("[GEMINI VISION FIELD] HTTP error:", res.status); return null; }
        let data;
        try { data = await res.json(); } catch(parseErr) {
            console.warn("[GEMINI VISION FIELD] JSON parse failed:", parseErr); return null;
        }
        if (!data || !data.hints) {
            console.warn("[GEMINI VISION FIELD] empty or missing hints — scoring continues without Gemini");
            return null;
        }
        return data.hints;
    } catch (err) {
        console.warn("[GEMINI VISION FIELD] request failed, proceeding without Gemini:", err);
        return null;
    }
}

// ─── GEMINI RETRY LOOP ────────────────────────────────────────────────────────
function _tryGeminiRetry(step, fieldKey, domain) {
    return new Promise((resolve) => {
        const chat = document.getElementById("chatMessages");
        if (!chat) { resolve(null); return; }

        const existing     = document.getElementById("norman-gemini-retry-ui");
        if (existing)      existing.remove();
        const oldFileInput = document.getElementById("norman-gemini-retry-file");
        if (oldFileInput)  oldFileInput.remove();
        const staleDone    = document.getElementById("norman-done-continue");
        if (staleDone)     staleDone.remove();

        const fileInput = document.createElement("input");
        fileInput.type = "file"; fileInput.accept = "image/*";
        fileInput.style.cssText = "opacity:0;position:fixed;width:0;height:0;";
        fileInput.id = "norman-gemini-retry-file";
        document.body.appendChild(fileInput);

        const card = document.createElement("div");
        card.id        = "norman-gemini-retry-ui";
        card.className = "msg ai-msg";
        card.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-left:3px solid #6366f1;background:rgba(99,102,241,0.08);border-radius:8px;";
        card.innerHTML = `
          <div style="font-size:13px;font-weight:500;color:#c4b5fd;">📷 Can you share a screenshot of the current page?</div>
          <div style="font-size:12px;color:#7c6faa;margin-bottom:2px;">I'll use it to find the <b>${step.target}</b> field automatically.</div>
          <div id="norman-gemini-retry-preview-wrap" style="display:none;position:relative;">
            <img id="norman-gemini-retry-preview" style="width:100%;max-height:110px;object-fit:cover;border-radius:6px;border:1px solid #6366f1;"/>
            <button id="norman-gemini-retry-img-remove" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.55);color:white;border:none;border-radius:50%;width:20px;height:20px;font-size:10px;cursor:pointer;line-height:1;">✕</button>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button id="norman-gemini-retry-upload" style="padding:7px 14px;background:linear-gradient(135deg,#6366f1,#4338ca);color:white;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;">📎 Upload Screenshot</button>
            <button id="norman-gemini-retry-skip" style="padding:7px 14px;background:none;border:1px solid rgba(139,92,246,0.3);color:#a78bfa;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;">Skip</button>
          </div>`;
        chat.appendChild(card);
        chat.scrollTop = chat.scrollHeight;

        let resolved = false;
        function done(result) { if (resolved) return; resolved = true; resolve(result); }

        const uploadBtn = document.getElementById("norman-gemini-retry-upload");
        if (uploadBtn) uploadBtn.addEventListener("click", () => fileInput.click());

        fileInput.addEventListener("change", () => {
            const file = fileInput.files[0];
            if (!file) return;
            const imgMediaType = file.type || "image/png";
            const reader = new FileReader();
            reader.onload = async (e) => {
                const imgBase64 = e.target.result.split(",")[1];
                const wrap = document.getElementById("norman-gemini-retry-preview-wrap");
                const img  = document.getElementById("norman-gemini-retry-preview");
                if (wrap && img) { img.src = e.target.result; wrap.style.display = "block"; }
                if (uploadBtn)   { uploadBtn.textContent = "🔍 Analysing..."; uploadBtn.disabled = true; }

                addMessage("AI", "Looking for the field on your page...");

                const hints = await callGeminiVisionField(step.target, imgBase64, imgMediaType);
                card.remove(); fileInput.remove();

                if (hints) {
                    step._geminiHints = hints;
                    console.log("[GEMINI RETRY] hints attached to step as scoring bonus:", hints);
                }

                const found = await (typeof findBestInput === "function" ? findBestInput(step) : Promise.resolve(null));
                const finalFound = found ||
                    (hints && typeof findElementByGeminiHints === "function" ? findElementByGeminiHints(hints) : null);

                if (finalFound) {
                    let resolvedSelector = null;
                    if (finalFound.id)                              resolvedSelector = `#${finalFound.id}`;
                    else if (finalFound.getAttribute("data-testid")) resolvedSelector = `[data-testid="${finalFound.getAttribute("data-testid")}"]`;
                    else if (finalFound.name)                       resolvedSelector = `[name="${finalFound.name}"]`;
                    else if (hints && hints.cssSelector)            resolvedSelector = hints.cssSelector;
                    const description = (hints && (hints.nearbyText || hints.ariaLabel || hints.visualDescription)) || step.target;
                    if (window.sessionManager) window.sessionManager.saveFieldMemory(domain, fieldKey, description, resolvedSelector);
                    delete step._geminiHints;
                    console.log("[GEMINI RETRY] ✅ element found via scoring+Gemini bonus — continuing silently");
                    done(finalFound);
                } else {
                    delete step._geminiHints;
                    console.log("[GEMINI RETRY] hints exhausted — falling back to manual flow");
                    done(null);
                }
            };
            reader.readAsDataURL(file);
            fileInput.value = "";
        });

        const skipBtn = document.getElementById("norman-gemini-retry-skip");
        if (skipBtn) skipBtn.addEventListener("click", () => { card.remove(); fileInput.remove(); done(null); });
    });
}

// ─── HANDLE FEEDBACK LOOP ─────────────────────────────────────────────────────
async function handleFeedbackLoop(step) {
    const fieldKey = resolveFieldKey(step.target);
    const domain   = window.location.hostname;

    if (step._feedbackAsked) {
        console.log("[FEEDBACK LOOP] already asked once — going to manual instruction");
        await _callFeedbackPlan(step, domain, step._lastUserDescription || "");
        return;
    }

    if (typeof explainSemanticAlias === "function") {
        const explanation = explainSemanticAlias(step.target);
        if (explanation) {
            console.log("[FEEDBACK LOOP] semantic understanding:", explanation);
            addMessage("AI", `🧠 ${explanation} — but I couldn't find it by text alone. Let me try harder...`);
        }
    }

    if (step._closestFallback && step._closestFallbackScore > 8) {
        const guessLabel = step._closestFallbackLabel || step.target;
        const guessEl    = step._closestFallback;

        const alreadyRejected = window.sessionManager && typeof window.sessionManager.isRejected === "function"
            ? window.sessionManager.isRejected(guessEl) : false;

        if (!alreadyRejected) {
            addMessage("AI", `🔍 I couldn't find "${step.target}" exactly, but I found something nearby: **"${guessLabel}"** — is that the one?`);
            if (typeof showConfirmationButtons === "function") {
                const confirmed = await new Promise(resolve => {
                    showConfirmationButtons(guessEl, () => resolve(true), () => resolve(false));
                });
                if (confirmed) {
                    addMessage("AI", `Got it — using "${guessLabel}" as the ${step.target} field.`);
                    _saveAndContinue(step, fieldKey, domain, guessEl, guessLabel);
                    return;
                }
                if (window.sessionManager && typeof window.sessionManager.rejectElement === "function") {
                    window.sessionManager.rejectElement(guessEl);
                    console.log("[BLACKLIST] element rejected by user:", guessEl);
                }
                delete step._closestFallback;
                delete step._closestFallbackLabel;
                delete step._closestFallbackScore;
                addMessage("AI", "No problem — let me look harder.");
            } else {
                _saveAndContinue(step, fieldKey, domain, guessEl, guessLabel);
                return;
            }
        } else {
            delete step._closestFallback;
            delete step._closestFallbackLabel;
            delete step._closestFallbackScore;
        }
    }

    const geminiKey = await getGeminiKey();
    if (geminiKey) {
        const foundViaGemini = await _tryGeminiRetry(step, fieldKey, domain);
        if (foundViaGemini) {
            _saveAndContinue(step, fieldKey, domain, foundViaGemini, `gemini-resolved:${step.target}`);
            return;
        }
        console.log("[FEEDBACK LOOP] Gemini retry failed — proceeding to user feedback");
    }

    step._feedbackAsked = true;

    if (typeof showFeedbackInput === "function") {
        showFeedbackInput(step.target, async (userDescription, imageBase64, mediaType) => {
            console.log("[FEEDBACK] description:", userDescription, "hasImage:", !!imageBase64);
            step._lastUserDescription = userDescription;

            let visionDescription = null;
            if (imageBase64) visionDescription = await callVisionAPI(step.target, imageBase64, mediaType, userDescription);

            let found = null;
            const combinedDesc = [userDescription, visionDescription].filter(Boolean).join(" ");

            if (combinedDesc) {
                found = reScanWithDescription(combinedDesc, step.uiType);
                if (found) console.log("[FEEDBACK MERGE] matched via combined description");
            }
            if (!found && combinedDesc) {
                found = reScanWithSpatial(combinedDesc);
                if (found) console.log("[FEEDBACK MERGE] matched via spatial description");
            }

            if (found) {
                const isRej = window.sessionManager && typeof window.sessionManager.isRejected === "function"
                    ? window.sessionManager.isRejected(found) : false;

                if (isRej) {
                    console.log("[FEEDBACK] match found but element is rejected — going to manual");
                    await _callFeedbackPlan(step, domain, combinedDesc);
                    return;
                }

                if (typeof showConfirmationButtons === "function") {
                    showConfirmationButtons(found,
                        () => { _saveAndContinue(step, fieldKey, domain, found, combinedDesc || step.target); },
                        () => {
                            if (window.sessionManager && typeof window.sessionManager.rejectElement === "function") {
                                window.sessionManager.rejectElement(found);
                            }
                            console.log("[FEEDBACK] user rejected found element — going to manual instruction");
                            _callFeedbackPlan(step, domain, combinedDesc);
                        }
                    );
                } else {
                    _saveAndContinue(step, fieldKey, domain, found, combinedDesc || step.target);
                }
            } else {
                addMessage("AI", "I could see it in your description but couldn't locate it in the page. Let me give you manual instructions...");
                _callFeedbackPlan(step, domain, combinedDesc || "");
            }
        });
    } else {
        console.warn("[FEEDBACK LOOP] showFeedbackInput not available");
        addMessage("AI", `I couldn't find the ${step.target} field. Please fill it in manually.`);
        if (typeof showDoneContinueButton === "function") showDoneContinueButton(() => nextStep());
    }
}

function _saveAndContinue(step, fieldKey, domain, found, description) {
    let resolvedSelector = null;
    if (found.id)                              resolvedSelector = `#${found.id}`;
    else if (found.getAttribute("data-testid")) resolvedSelector = `[data-testid="${found.getAttribute("data-testid")}"]`;
    else if (found.name)                       resolvedSelector = `[name="${found.name}"]`;

    if (window.sessionManager) {
        window.sessionManager.saveFieldMemory(domain, fieldKey, description, resolvedSelector);
        if (typeof window.sessionManager.saveCorrectionPattern === "function")
            window.sessionManager.saveCorrectionPattern(domain, step.target, fieldKey, resolvedSelector);
    }
    if (typeof commitElement === "function" && fieldKey) {
        commitElement(fieldKey, found);
        console.log("[COMMIT LOCKED]", fieldKey, found);
    }
    addMessage("AI", "Found it — continuing from here!");
    currentElement = found;
    found.style.boxShadow = "0 0 0 4px red";
    found.scrollIntoView({ behavior: "smooth", block: "center" });
    found.focus();
    if (step.action === "type" && step.value) {
        const input = ensureInputReady(found);
        currentElement = input;
        setTimeout(() => { simulateTyping(input, step.value); recordAction("type", step.target, step.value); setTimeout(() => nextStep(), 600); }, 300);
        return;
    }
    if (step.action === "click") {
        recordAction("click", step.target, "clicked");
        setTimeout(() => nextStep(), 300);
        return;
    }
    if (step.action === "search_select") { found.style.boxShadow = ""; handleSearchSelect(step); return; }
    if (step.action === "click_date")    { found.style.boxShadow = ""; handleClickDate(step);    return; }
    nextStep();
}

async function _callFeedbackPlan(step, domain, userDescription) {
    try {
        let richSnapshot = null, savedFeedback = {};
        if (typeof buildRichSnapshot === "function") richSnapshot = buildRichSnapshot();
        await new Promise((resolve) => {
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get("norman_field_memory", (result) => {
                    const allMemory = result["norman_field_memory"];
                    if (allMemory) savedFeedback = allMemory[domain] || {};
                    resolve();
                });
            } else {
                try { const raw = localStorage.getItem("norman_field_memory"); if (raw) { const allMemory = JSON.parse(raw); savedFeedback = allMemory[domain] || {}; } } catch(e) {}
                resolve();
            }
        });
        const session = window.sessionManager?.getSession();
        const goal    = session?.mergedGoal || session?.goal || "";
        const res = await fetch("http://localhost:5000/feedback-plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ goal, failedStep: step, userDescription, richSnapshot, savedFeedback })
        });
        const data = await res.json();
        addMessage("AI", data.instruction || `Please fill in "${step.value || step.target}" manually.`);
        if (typeof showDoneContinueButton === "function") showDoneContinueButton(() => nextStep());
    } catch (err) {
        console.error("[FEEDBACK PLAN ERROR]", err);
        const fallback = step.value
            ? `I couldn't find the field. Please fill in "${step.value}" in the ${step.target} field manually.`
            : `I couldn't find the ${step.target} field. Please fill it in manually.`;
        addMessage("AI", fallback);
        if (typeof showDoneContinueButton === "function") showDoneContinueButton(() => nextStep());
    }
}

// ─── WAIT FOR ELEMENT ─────────────────────────────────────────────────────────
function waitForElement(selector, timeoutMs) {
    timeoutMs = timeoutMs || 1500;
    return new Promise((resolve) => {
        const start = Date.now();
        const check = setInterval(() => {
            try { const el = document.querySelector(selector); if (el && isVisible(el)) { clearInterval(check); resolve(el); return; } } catch(e) {}
            if (Date.now() - start > timeoutMs) { clearInterval(check); resolve(null); }
        }, 80);
    });
}

// ─── SELECT BEST OPTION ───────────────────────────────────────────────────────
function selectBestOption(value) {
    if (!value) return false;
    const normValue = value.toLowerCase().trim();
    const optionSelectors = [
        '[role="option"]','[role="listbox"] li','[role="listbox"] div',
        '[role="listbox"] span','ul[role="listbox"] li',
        '.autocomplete li','.autocomplete-item','.suggestions li',
        '.suggestion-item','.dropdown-list li','.dropdown li',
        '.search-results li','.search-list li','.city-list li',
        '.airport-list li','.station-list li','[data-suggestion]','[aria-selected]'
    ];
    for (const selector of optionSelectors) {
        let options;
        try { options = document.querySelectorAll(selector); } catch(e) { continue; }
        for (const option of options) {
            if (option.closest("#webguide-assistant")) continue;
            if (!isVisible(option)) continue;
            const text = (option.innerText || option.textContent || "").toLowerCase().trim();
            if (!text) continue;
            const firstWord = normValue.split(" ")[0];
            if (text.includes(normValue) || normValue.includes(text.split("\n")[0].trim()) || (firstWord.length > 2 && text.includes(firstWord))) {
                console.log("[SELECT BEST OPTION]", selector, text);
                option.click();
                return true;
            }
        }
    }
    return false;
}

// ─── VERIFY FIELD FILLED ──────────────────────────────────────────────────────
function verifyFieldFilled(el, expectedValue) {
    if (!el || !expectedValue) return false;
    const expected = (expectedValue || "").toLowerCase().trim().split(" ")[0];
    const val = [el.value||"",el.innerText||"",el.textContent||"",el.getAttribute("data-value")||"",el.getAttribute("value")||""].join(" ").toLowerCase().trim();
    const filled = val.includes(expected);
    console.log("[VERIFY FIELD]", filled, "expected:", expected, "got:", val.slice(0,50));
    return filled;
}

// ─── DOM FINGERPRINT ──────────────────────────────────────────────────────────
function getDOMFingerprint() {
    let fp = "";
    document.querySelectorAll("input, select, textarea").forEach(el => { fp += (el.value || "") + "|"; });
    document.querySelectorAll('[role="combobox"], [role="textbox"]').forEach(el => { fp += (el.innerText || el.textContent || "") + "|"; });
    return fp;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIVERSAL CLICK ENGINE
// Works across React (16/17/18), Vue 2/3, Angular, Svelte, Alpine, vanilla JS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── UNIVERSAL FIRE ───────────────────────────────────────────────────────────
// Tries every known interaction method. Replaces old fireClickChain.
function universalFire(el) {
    if (!el) return false;

    try { el.scrollIntoView({ block: "center", behavior: "instant" }); } catch(e) {}
    try { el.focus({ preventScroll: true }); } catch(e) {}

    const rect = el.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;
    const eventInit = {
        bubbles: true, cancelable: true, view: window,
        clientX: cx, clientY: cy,
        screenX: cx, screenY: cy,
        pageX: cx + window.scrollX, pageY: cy + window.scrollY
    };

    // Method 1: Full pointer + mouse chain (vanilla, jQuery, most CSS frameworks)
    ["pointerover","pointerenter","mouseover","mouseenter",
     "pointermove","mousemove","pointerdown","mousedown",
     "pointerup","mouseup","click"].forEach(type => {
        try {
            const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
            el.dispatchEvent(new Ctor(type, { ...eventInit, pointerId: 1 }));
        } catch(e) {
            try { el.dispatchEvent(new MouseEvent(type, eventInit)); } catch(e2) {}
        }
    });

    // Method 2: React Fiber — direct onClick invocation
    // React 17+ uses a single root listener; individual node events don't bubble
    // to it correctly in content scripts. We invoke the fiber's onClick directly.
    let reactFired = false;
    try {
        const fiberKey = Object.keys(el).find(k =>
            k.startsWith("__reactFiber")           ||  // React 17+
            k.startsWith("__reactInternalInstance") ||  // React 16
            k.startsWith("_reactFiber")             ||  // some bundlers
            k.startsWith("__reactProps")                // React 18 fast-path
        );
        if (fiberKey) {
            if (fiberKey.startsWith("__reactProps")) {
                // React 18 direct props shortcut
                const props = el[fiberKey];
                if (props && typeof props.onClick === "function") {
                    props.onClick({
                        preventDefault: ()=>{}, stopPropagation: ()=>{},
                        target: el, currentTarget: el,
                        clientX: cx, clientY: cy, bubbles: true, type: "click"
                    });
                    reactFired = true;
                }
            } else {
                // Walk fiber return chain — onClick may be on a parent fiber node
                let fiber = el[fiberKey];
                let depth = 0;
                while (fiber && depth < 30) {
                    const props = fiber.memoizedProps || fiber.pendingProps;
                    if (props && typeof props.onClick === "function") {
                        props.onClick({
                            preventDefault: ()=>{}, stopPropagation: ()=>{},
                            target: el, currentTarget: el,
                            clientX: cx, clientY: cy, bubbles: true, type: "click",
                            nativeEvent: { target: el }
                        });
                        reactFired = true;
                        break;
                    }
                    fiber = fiber.return;
                    depth++;
                }
            }
        }
    } catch(e) {
        console.warn("[UNIVERSAL FIRE] React fiber invoke failed:", e.message);
    }

    // Method 3: Vue 2 / Vue 3
    let vueFired = false;
    try {
        const vueInst = el.__vue__ || el.__vueParentComponent;
        if (vueInst) {
            const emit = vueInst.emit || (vueInst.$ && vueInst.$.emit);
            if (typeof emit === "function") { emit("click", { target: el, clientX: cx, clientY: cy }); vueFired = true; }
            if (!vueFired && typeof vueInst.$emit === "function") { vueInst.$emit("click", { target: el, clientX: cx, clientY: cy }); vueFired = true; }
        }
    } catch(e) { console.warn("[UNIVERSAL FIRE] Vue invoke failed:", e.message); }

    // Method 4: Angular zone-based event listeners
    let angularFired = false;
    try {
        const ngListeners = el.__zone_symbol__clickfalse || el.__zone_symbol__click;
        if (ngListeners && Array.isArray(ngListeners)) {
            ngListeners.forEach(listener => {
                if (typeof listener.callback === "function") {
                    listener.callback({ target: el, clientX: cx, clientY: cy, type: "click" });
                    angularFired = true;
                }
            });
        }
    } catch(e) { console.warn("[UNIVERSAL FIRE] Angular invoke failed:", e.message); }

    // Method 5: Alpine.js
    try {
        const alpineData = el._x_dataStack && el._x_dataStack[0];
        if (alpineData && typeof alpineData.click === "function") {
            alpineData.click({ target: el });
        }
    } catch(e) {}

    // Method 6: Native .click() — synchronous, last resort
    try { el.click(); } catch(e) {}

    console.log("[UNIVERSAL FIRE] ✓", el.tagName,
        (el.className || "").toString().slice(0, 40),
        "| react:", reactFired, "vue:", vueFired, "angular:", angularFired);
    return true;
}

// ─── FIND CALENDAR CONTAINER ──────────────────────────────────────────────────
// Scopes all calendar queries — avoids matching page content like hero banners.
function findCalendarContainer() {
    const selectors = [
        '[role="dialog"]:not(#webguide-assistant)',
        '.react-datepicker-popper', '.react-datepicker', '.react-calendar',
        '.flatpickr-calendar', '.pika-single',
        '.DayPicker', '[class*="DayPicker"]:not([class*="Day"])',
        '.MuiDateCalendar-root', '.MuiPickersCalendar-root',
        '.ant-picker-dropdown', '.ant-picker-panel-container',
        '.bp3-datepicker', '.bp4-datepicker', '.bp5-datepicker',
        '[class*="BpkCalendar" i]', '[class*="bpk-calendar" i]',
        '[class*="CalendarContainer" i]', '[class*="calendarContainer" i]',
        '[class*="calendar-container" i]', '[class*="DatePicker" i]:not(input)',
        '[class*="datepicker" i]:not(input)',
        '[class*="calendar-popup" i]', '[class*="calendar-modal" i]',
        '[class*="picker-panel" i]', '[class*="date-panel" i]',
        '[role="grid"]',
    ];
    for (const sel of selectors) {
        try {
            const els = [...document.querySelectorAll(sel)];
            const visible = els.find(el => {
                if (el.closest("#webguide-assistant")) return false;
                const r = el.getBoundingClientRect();
                return r.width > 50 && r.height > 50;
            });
            if (visible) return visible;
        } catch(e) {}
    }
    return null;
}

// ─── IS CALENDAR OPEN ─────────────────────────────────────────────────────────
// Replaces old isCalendarOpen(). Scoped to calendar container.
function isCalendarOpen() {
    return !!findCalendarContainer();
}

// ─── NAVIGATE TO TARGET MONTH ─────────────────────────────────────────────────
// Universal bidirectional month navigation. Reads ONLY from calendar container.
async function navigateToTargetMonth(targetDate, calContainer) {
    const targetMonth      = targetDate.toLocaleString("default", { month: "long" }).toLowerCase();
    const targetMonthShort = targetDate.toLocaleString("default", { month: "short" }).toLowerCase();
    const targetYear       = targetDate.getFullYear().toString();
    const targetTs         = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1).getTime();

    const monthNames = ["january","february","march","april","may","june",
                        "july","august","september","october","november","december"];

    const headerSelectors = [
        '[class*="MonthLabel" i]', '[class*="month-label" i]',
        '[class*="CalendarHeader" i]', '[class*="calendar-header" i]',
        '[class*="monthHeader" i]', '[class*="month-header" i]',
        '[class*="navigation" i] [class*="label" i]',
        '[class*="caption" i]', 'caption',
        '.DayPicker-Caption', '.react-datepicker__current-month',
        '.react-calendar__navigation__label', '.flatpickr-current-month',
        '.pika-title', '[aria-live="polite"]',
        '.MuiPickersCalendarHeader-label', '.ant-picker-header-view',
        'h2', 'h3',
    ];

    function readCalendarText(container) {
        const scope = container || document;
        for (const sel of headerSelectors) {
            try {
                const els = [...scope.querySelectorAll(sel)];
                const text = els.map(e => e.innerText || e.textContent || "").join(" ").toLowerCase().trim();
                if (text.length > 1) return text;
            } catch(e) {}
        }
        return (container ? container.innerText : "").toLowerCase().slice(0, 400);
    }

    function parseShownDate(text) {
        let shownMonthIdx = -1;
        for (let m = 0; m < 12; m++) {
            if (text.includes(monthNames[m])) { shownMonthIdx = m; break; }
        }
        if (shownMonthIdx === -1) return null;
        const yearMatch = text.match(/\b(20\d\d)\b/);
        const shownYear = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
        return new Date(shownYear, shownMonthIdx, 1).getTime();
    }

    const prevSelectors = [
        '[aria-label*="previous month" i]', '[aria-label*="prev month" i]',
        '[aria-label*="previous" i]', '[aria-label*="go back" i]',
        '[aria-label*="last month" i]', '[aria-label*="back" i]',
        '[class*="PrevMonth" i]', '[class*="prev-month" i]',
        '[class*="NavPrev" i]', '[class*="nav-prev" i]',
        '[class*="PreviousMonth" i]', '[class*="previous-month" i]',
        '.DayPicker-NavButton--prev', '.flatpickr-prev-month',
        '.react-datepicker__navigation--previous',
        '.react-calendar__navigation__prev-button',
        '.pika-prev', '[data-testid*="prev"]', '[data-direction="previous"]',
        '[data-action="prev"]',
        'button[class*="prev" i]:not([class*="next" i])',
    ];

    const nextSelectors = [
        '[aria-label*="next month" i]', '[aria-label*="go forward" i]',
        '[aria-label*="forward" i]', '[aria-label*="next" i]',
        '[class*="NextMonth" i]', '[class*="next-month" i]',
        '[class*="NavNext" i]', '[class*="nav-next" i]',
        '.DayPicker-NavButton--next', '.flatpickr-next-month',
        '.react-datepicker__navigation--next',
        '.react-calendar__navigation__next-button',
        '.pika-next', '[data-testid*="next"]', '[data-direction="next"]',
        '[data-action="next"]',
        'button[class*="next" i]:not([class*="prev" i])',
    ];

    function findNavButton(selList, container) {
        const scope = container || document;
        for (const sel of selList) {
            try {
                const el = scope.querySelector(sel);
                if (el && !el.closest("#webguide-assistant")) {
                    const r = el.getBoundingClientRect();
                    if (r.width > 5 && r.height > 5) return el;
                }
            } catch(e) {}
        }
        // Fallback: leftmost/rightmost visible button in calendar
        try {
            const btns = [...(container || document).querySelectorAll("button")].filter(b => {
                if (b.closest("#webguide-assistant")) return false;
                const r = b.getBoundingClientRect();
                return r.width > 5 && r.height > 5;
            });
            if (btns.length >= 2) {
                btns.sort((a,b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
                return selList === prevSelectors ? btns[0] : btns[btns.length - 1];
            }
        } catch(e) {}
        return null;
    }

    const MAX_NAV = 36;
    for (let i = 0; i < MAX_NAV; i++) {
        const container = calContainer || findCalendarContainer();
        const calText   = readCalendarText(container);

        const monthOk = calText.includes(targetMonth) || calText.includes(targetMonthShort);
        const yearOk  = calText.includes(targetYear);
        if (monthOk && yearOk) {
            console.log("[NAV] ✓ target month visible:", targetMonth, targetYear);
            return true;
        }

        const shownTs = parseShownDate(calText);
        if (shownTs === null) {
            console.warn("[NAV] cannot parse shown month — trying next");
            const nextBtn = findNavButton(nextSelectors, container);
            if (!nextBtn) return false;
            universalFire(nextBtn);
            await sleep(450);
            continue;
        }

        const goBack = targetTs < shownTs;
        const btn    = findNavButton(goBack ? prevSelectors : nextSelectors, container);
        if (!btn) {
            console.warn("[NAV] no", goBack ? "prev" : "next", "button found");
            return false;
        }
        console.log("[NAV] going", goBack ? "◀ prev" : "▶ next",
            "| shown:", new Date(shownTs).toDateString(),
            "| target:", targetMonth, targetYear);
        universalFire(btn);
        await sleep(450);
    }
    console.warn("[NAV] hit max navigation attempts");
    return false;
}

// ─── FIND CALENDAR CELLS ──────────────────────────────────────────────────────
function findCalendarCells(container) {
    const cellSelectors = [
        '[role="gridcell"]', '[role="cell"]',
        '.react-datepicker__day', '.react-calendar__tile',
        '.DayPicker-Day', '.flatpickr-day', '.pika-button', '.CalendarDay',
        '.MuiPickersDay-root',
        '.ant-picker-cell', '.ant-picker-cell-inner',
        '[class*="bpk-calendar-date" i]',
        '[class*="CalendarDate" i]', '[class*="calendar-date" i]',
        '[class*="calendarDay" i]', '[class*="CalendarDay" i]',
        '[class*="day-cell" i]', '[class*="DayCell" i]',
        '[class*="date-cell" i]', '[class*="DateCell" i]',
        'td[data-date]', 'td[data-day]', 'td.day', 'td[class*="day" i]',
        '[role="grid"] button', '[role="grid"] [tabindex]',
    ];

    const scope = container || document;
    const seen  = new Set();
    const cells = [];

    for (const sel of cellSelectors) {
        try {
            const found = [...scope.querySelectorAll(sel)];
            if (!found.length) continue;
            found.forEach(el => {
                if (!seen.has(el) && !el.closest("#webguide-assistant")) {
                    seen.add(el);
                    cells.push(el);
                }
            });
            if (cells.length > 5) break;
        } catch(e) {}
    }
    return cells;
}

// ─── IS CELL DISABLED ────────────────────────────────────────────────────────
// Only blocks EXPLICITLY disabled cells — never visual-only styling.
function isCellDisabled(cell) {
    if (cell.getAttribute("aria-disabled") === "true")   return true;
    if (cell.tagName === "BUTTON" && cell.disabled)       return true;
    if (cell.hasAttribute("disabled"))                    return true;
    const cls = (cell.className || "").toLowerCase();
    return [
        "flatpickr-disabled",
        "daypicker-day--disabled",
        "react-datepicker__day--disabled",
        "react-datepicker__day--outside-month",
        "muipickersday-disabled",
    ].some(d => cls.includes(d));
}

// ─── CELL BELONGS TO TARGET MONTH ────────────────────────────────────────────
// Dual-panel fix: walks up DOM to find the panel's own month header.
function cellBelongsToTargetMonth(cell, targetDate) {
    const targetMonth      = targetDate.toLocaleString("default", { month: "long" }).toLowerCase();
    const targetMonthShort = targetDate.toLocaleString("default", { month: "short" }).toLowerCase();
    const targetYear       = targetDate.getFullYear().toString();

    let node = cell.parentElement;
    for (let depth = 0; depth < 10; depth++) {
        if (!node || node === document.body) break;
        const headerCandidates = [
            '[class*="MonthLabel" i]', '[class*="month-label" i]',
            '[class*="CalendarHeader" i]', '[class*="caption" i]',
            '.DayPicker-Caption', '.react-datepicker__current-month',
            'caption', 'h2', 'h3',
        ];
        for (const sel of headerCandidates) {
            try {
                const h = node.querySelector(sel);
                if (h) {
                    const t = (h.innerText || h.textContent || "").toLowerCase();
                    const hasMonth = t.includes(targetMonth) || t.includes(targetMonthShort);
                    const hasYear  = t.includes(targetYear);
                    if (hasMonth && hasYear) return true;
                    if (t.length > 3) return false;
                }
            } catch(e) {}
        }
        node = node.parentElement;
    }
    return true; // can't determine — allow it
}

// ─── CELL MATCHES DATE ────────────────────────────────────────────────────────
// Handles all formats: "9", "09", "9th", "Apr 9", "9 April 2026", data-date ISO
function cellMatchesDate(cell, targetDate) {
    const targetDay        = targetDate.getDate().toString();
    const targetMonth      = targetDate.toLocaleString("default", { month: "long" }).toLowerCase();
    const targetMonthShort = targetDate.toLocaleString("default", { month: "short" }).toLowerCase();
    const targetYear       = targetDate.getFullYear().toString();
    const targetMonthNum   = (targetDate.getMonth() + 1).toString().padStart(2, "0");

    const rawText   = (cell.innerText || cell.textContent || "").trim().replace(/\s+/g, " ");
    const numTokens = rawText.match(/\b\d{1,2}\b/g);
    if (!numTokens) return false;

    const dayMatches = numTokens.some(t => t.replace(/^0/,"") === targetDay);
    if (!dayMatches) return false;

    const ariaLabel = (cell.getAttribute("aria-label") || "").toLowerCase();
    const dataDate  = (cell.getAttribute("data-date")  || "").toLowerCase();
    const titleAttr = (cell.getAttribute("title")      || "").toLowerCase();
    const dataDay   = (cell.getAttribute("data-day")   || "").toLowerCase();
    const combined  = `${ariaLabel} ${dataDate} ${titleAttr} ${dataDay}`;
    const hasDigitMetadata = /\d/.test(combined);

    if (hasDigitMetadata) {
        // Exact ISO data-date match
        if (dataDate.match(/\d{4}-\d{2}-\d{2}/)) {
            const expected = `${targetYear}-${targetMonthNum}-${targetDay.padStart(2,"0")}`;
            return dataDate.includes(expected);
        }

        const hasMonth =
            combined.includes(targetMonth)             ||
            combined.includes(targetMonthShort)        ||
            combined.includes(`-${targetMonthNum}-`)   ||
            combined.includes(`/${targetMonthNum}/`)   ||
            combined.includes(`${targetMonthNum}-`)    ||
            // Ordinal: "9th", "1st", "2nd", "3rd"
            combined.includes(targetDay + "th")        ||
            combined.includes(targetDay + "st")        ||
            combined.includes(targetDay + "nd")        ||
            combined.includes(targetDay + "rd");

        const hasYear = combined.includes(targetYear);
        return hasMonth || hasYear;
    }

    // No metadata — trust panel-ancestor check (done by caller)
    return true;
}

// ─── VERIFY DATE SELECTED ────────────────────────────────────────────────────
// 4 signals: calendar closed, selected cell visible, input updated, trigger updated
function verifyDateSelected(targetDate, dateEl) {
    const targetDay        = targetDate.getDate().toString();
    const targetMonth      = targetDate.toLocaleString("default", { month: "long" }).toLowerCase();
    const targetMonthShort = targetDate.toLocaleString("default", { month: "short" }).toLowerCase();
    const targetMonthNum   = (targetDate.getMonth() + 1).toString().padStart(2, "0");
    const targetYear       = targetDate.getFullYear().toString();

    // Signal 1: calendar closed
    if (!isCalendarOpen()) { console.log("[VERIFY] ✓ calendar closed"); return true; }

    // Signal 2: selected cell visible
    const selectedSelectors = [
        '[aria-selected="true"]', '[aria-pressed="true"]',
        '.react-datepicker__day--selected', '.react-calendar__tile--active',
        '.DayPicker-Day--selected', '.flatpickr-day.selected',
        '.pika-button.is-selected', '.CalendarDay__selected',
        '[class*="isSelected" i]', '[class*="is-selected" i]',
        '[class*="selected" i][role="gridcell"]',
        '[class*="selected" i][role="cell"]',
        '[class*="active" i][role="gridcell"]',
        '[class*="bpk-calendar-date--selected" i]',
        '.MuiPickersDay-selected', '.ant-picker-cell-selected',
    ];
    for (const sel of selectedSelectors) {
        try {
            const el = document.querySelector(sel);
            if (el && !el.closest("#webguide-assistant")) {
                console.log("[VERIFY] ✓ selected cell visible:", sel);
                return true;
            }
        } catch(e) {}
    }

    // Signal 3: any date input now contains target date
    const dateInputSelectors = [
        'input[type="text"]', 'input[readonly]', 'input[type="date"]',
        '[class*="depart" i]', '[class*="Depart" i]',
        '[class*="date" i] input', '[class*="Date" i] input',
        '[class*="checkin" i]', '[class*="checkout" i]',
        '[class*="departure" i]', '[class*="return" i]',
    ];
    for (const sel of dateInputSelectors) {
        try {
            const inputs = [...document.querySelectorAll(sel)];
            for (const inp of inputs) {
                if (inp.closest("#webguide-assistant")) continue;
                const val = (inp.value || inp.innerText || inp.textContent || "").toLowerCase();
                if (val.includes(targetDay) &&
                    (val.includes(targetMonth) || val.includes(targetMonthShort) ||
                     val.includes(targetMonthNum) || val.includes(targetYear))) {
                    console.log("[VERIFY] ✓ date input updated:", val);
                    return true;
                }
            }
        } catch(e) {}
    }

    // Signal 4: trigger element text updated
    if (dateEl) {
        const triggerText = (dateEl.value || dateEl.innerText || dateEl.textContent || "").toLowerCase();
        if (triggerText.includes(targetDay) &&
            (triggerText.includes(targetMonth) || triggerText.includes(targetMonthShort) || triggerText.includes(targetMonthNum))) {
            console.log("[VERIFY] ✓ trigger element text updated");
            return true;
        }
    }

    return false;
}

// ─── HANDLE CLICK DATE (Universal) ───────────────────────────────────────────
// Full replacement using Universal Click Engine.
async function handleClickDate(step) {
    console.log("[CLICK DATE v2]", step.target, step.value);

    step.action   = "click_date";
    step.fieldKey = step.fieldKey || resolveFieldKey(step.target);

    // ── Parse target date ─────────────────────────────────────────────────
    let targetDate = null;
    const dateFormats = [
        step.value,
        // Strip ordinal suffixes: "18th May 2026" → "18 May 2026"
        (step.value || "").replace(/(\d+)(st|nd|rd|th)/gi, "$1"),
    ];
    for (const fmt of dateFormats) {
        try {
            const d = new Date(fmt);
            if (!isNaN(d.getTime())) { targetDate = d; break; }
        } catch(e) {}
    }

    if (!targetDate || isNaN(targetDate.getTime())) {
        console.warn("[CLICK DATE v2] cannot parse date:", step.value);
        addMessage("AI", `Please select "${step.value}" in the calendar.`);
        if (typeof showDoneContinueButton === "function") showDoneContinueButton(() => nextStep());
        return;
    }

    const targetDay        = targetDate.getDate().toString();
    const targetMonth      = targetDate.toLocaleString("default", { month: "long" }).toLowerCase();
    const targetMonthShort = targetDate.toLocaleString("default", { month: "short" }).toLowerCase();
    const targetYear       = targetDate.getFullYear().toString();
    console.log("[CLICK DATE v2] parsed target:", targetDay, targetMonth, targetYear);

    // ── Find the date trigger element ─────────────────────────────────────
    let dateEl = null;
    if (typeof findBestInput === "function") dateEl = await findBestInput(step);

    if (!dateEl) {
        const sweepSel = [
            "[class*='depart' i]","[class*='departure' i]","[class*='date' i]",
            "[class*='calendar' i]","[class*='picker' i]",
            "[data-date]","[data-datepicker]","input[readonly]"
        ].join(",");
        const candidates = [...document.querySelectorAll(sweepSel)].filter(el => {
            if (el.closest("#webguide-assistant")) return false;
            const r = el.getBoundingClientRect();
            return r.width >= 10 && r.height >= 10;
        });
        if (candidates.length) {
            dateEl = step.fieldKey === "RETURN_DATE"
                ? candidates[candidates.length - 1]
                : candidates[0];
        }
    }

    if (!dateEl) {
        console.warn("[CLICK DATE v2] no date trigger found — feedback");
        await handleFeedbackLoop(step);
        return;
    }

    // ── Highlight trigger ─────────────────────────────────────────────────
    if (currentElement) currentElement.style.boxShadow = "";
    currentElement = dateEl;
    dateEl.style.boxShadow = "0 0 0 4px #6366f1";
    dateEl.scrollIntoView({ behavior: "smooth", block: "center" });

    // ── Resolve inner clickable (for container divs) ───────────────────────
    function resolveInnerTarget(el) {
        if (!el) return el;
        const tag = el.tagName.toLowerCase();
        if (["button","input","a"].includes(tag)) return el;
        const inner = el.querySelector('button, [role="button"], [tabindex="0"], input, a');
        return (inner && isVisible(inner)) ? inner : el;
    }
    const clickTarget = resolveInnerTarget(dateEl);

    // ── Clear stale date if already filled ────────────────────────────────
    async function clearExistingDate() {
        const parent = dateEl.closest("div,section,form") || dateEl.parentElement;
        if (!parent) return;
        const clearBtn = parent.querySelector(
            '[aria-label*="clear" i],[aria-label*="remove" i],[aria-label*="close" i],' +
            '[data-testid*="clear"],[class*="clear" i],[class*="remove" i],button[type="reset"]'
        );
        if (clearBtn && isVisible(clearBtn)) {
            console.log("[CLICK DATE v2] clearing existing date");
            universalFire(clearBtn);
            await sleep(400);
        }
    }

    // ── Open calendar (up to 3 attempts) — SKIP if already open ──────────
    let calendarOpen = isCalendarOpen();

    if (!calendarOpen) {
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt === 1) await clearExistingDate();
            universalFire(attempt === 2 ? dateEl : clickTarget);
            await sleep(attempt === 0 ? 700 : 900);
            calendarOpen = isCalendarOpen();
            if (calendarOpen) break;
            console.log(`[CLICK DATE v2] open attempt ${attempt + 1} — calendar not open yet`);
        }
    } else {
        console.log("[CLICK DATE v2] calendar already open — skipping open phase");
    }

    if (!calendarOpen) {
        console.warn("[CLICK DATE v2] calendar never opened — feedback");
        dateEl.style.boxShadow = "";
        await handleFeedbackLoop(step);
        return;
    }

    const calContainer = findCalendarContainer();
    console.log("[CLICK DATE v2] calendar open ✓, container:",
        (calContainer?.className || "").toString().slice(0, 40));

    // ── Navigate to correct month ─────────────────────────────────────────
    await navigateToTargetMonth(targetDate, calContainer);
    await sleep(350);

    // ── Find and click the date cell ──────────────────────────────────────
    const freshContainer = findCalendarContainer();
    const cells          = findCalendarCells(freshContainer);
    const anyHasMeta     = cells.some(c =>
        /\d/.test(c.getAttribute("aria-label") || "") ||
        /\d/.test(c.getAttribute("data-date")  || "") ||
        /\d/.test(c.getAttribute("title")      || "") ||
        /\d/.test(c.getAttribute("data-day")   || "")
    );

    let clicked = false;
    for (const cell of cells) {
        if (isCellDisabled(cell)) continue;
        if (!cellMatchesDate(cell, targetDate)) continue;
        if (!anyHasMeta && !cellBelongsToTargetMonth(cell, targetDate)) continue;

        const label = cell.getAttribute("aria-label") ||
                      cell.getAttribute("data-date")  ||
                      cell.innerText?.trim();
        console.log("[CLICK DATE v2] ✓ clicking cell:", label);

        universalFire(cell);
        clicked = true;
        await sleep(350);

        // Apply/Done button (Skyscanner, some MUI pickers)
        const applyBtn = document.querySelector(
            '[aria-label*="apply" i],[aria-label*="done" i],[aria-label*="confirm" i],' +
            'button[class*="apply" i],button[class*="done" i],button[class*="confirm" i],' +
            '[data-testid*="apply"],[class*="ApplyButton" i],[class*="apply-button" i]'
        );
        if (applyBtn && isVisible(applyBtn)) {
            console.log("[CLICK DATE v2] clicking Apply button");
            universalFire(applyBtn);
            await sleep(500);
        }
        break;
    }

    // ── Verify success ────────────────────────────────────────────────────
    await sleep(600);
    dateEl.style.boxShadow = "";

    if (!clicked) {
        console.warn("[CLICK DATE v2] no matching cell found — feedback");
        await handleFeedbackLoop(step);
        return;
    }

    const success = verifyDateSelected(targetDate, dateEl);
    if (success) {
        console.log("[CLICK DATE v2] ✅ date selection confirmed");
        recordAction("click_date", step.target, step.value);
        if (typeof lockField === "function") lockField(dateEl);
        nextStep();
    } else {
        // Final attempt: Apply button may still be present
        const applyFinal = document.querySelector(
            'button[class*="apply" i],button[class*="done" i],[class*="ApplyButton" i]'
        );
        if (applyFinal && isVisible(applyFinal)) {
            universalFire(applyFinal);
            await sleep(600);
            if (verifyDateSelected(targetDate, dateEl)) {
                console.log("[CLICK DATE v2] ✅ confirmed after final Apply");
                recordAction("click_date", step.target, step.value);
                if (typeof lockField === "function") lockField(dateEl);
                nextStep();
                return;
            }
        }
        console.warn("[CLICK DATE v2] verification failed — feedback");
        await handleFeedbackLoop(step);
    }
}

// ─── HANDLE SEARCH SELECT ─────────────────────────────────────────────────────
async function handleSearchSelect(step) {
    console.log("[SEARCH SELECT]", step.target, step.value);
    let outerEl = null;
    if (typeof findBestInput === "function") outerEl = await findBestInput(step);
    if (!outerEl) {
        console.log("[SEARCH SELECT] outer element not found");
        await handleFeedbackLoop(step);
        return;
    }
    if (currentElement) currentElement.style.boxShadow = "";
    currentElement = outerEl;
    outerEl.style.boxShadow = "0 0 0 4px red";
    outerEl.scrollIntoView({ behavior: "smooth", block: "center" });

    let targetInput = outerEl;
    if (typeof resolveRealInput === "function") {
        targetInput = await resolveRealInput(outerEl) || outerEl;
    } else {
        outerEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        outerEl.click();
        await sleep(400);
        const possible = ensureInputReady(outerEl);
        if (possible !== outerEl) targetInput = possible;
    }

    currentElement = targetInput;
    targetInput.focus();
    try { targetInput.value = ""; } catch(e) {}
    const before = getDOMFingerprint();
    simulateTyping(targetInput, step.value);
    await sleep(500);

    let selected = false;
    for (let i = 0; i < 2; i++) {
        selected = selectBestOption(step.value);
        if (selected) break;
        await sleep(400);
    }
    if (!selected) {
        const firstWord = (step.value || "").split(" ")[0];
        if (firstWord && firstWord !== step.value) {
            targetInput.focus();
            try { targetInput.value = ""; } catch(e) {}
            simulateTyping(targetInput, firstWord);
            await sleep(500);
            for (let i = 0; i < 2; i++) {
                selected = selectBestOption(step.value);
                if (selected) break;
                await sleep(400);
            }
        }
    }

    await sleep(700);
    const after = getDOMFingerprint();
    if (before === after && !selected) {
        console.log("[VERIFY FAILED - SEARCH_SELECT] DOM unchanged after typing+selection");
        outerEl.style.boxShadow = "";
        await handleFeedbackLoop(step);
        return;
    }

    const filled = verifyFieldFilled(outerEl, step.value) || verifyFieldFilled(targetInput, step.value);
    if (filled || selected) {
        console.log("[SEARCH SELECT] success");
        if (typeof lockField       === "function") lockField(outerEl);
        if (typeof rememberElement === "function") rememberElement(step.target, outerEl);
        recordAction("search_select", step.target, step.value);
        const domain   = window.location.hostname;
        const fieldKey = resolveFieldKey(step.target);
        if (window.sessionManager && fieldKey) {
            let resolvedSelector = null;
            if (outerEl.id)                              resolvedSelector = `#${outerEl.id}`;
            else if (outerEl.getAttribute("data-testid")) resolvedSelector = `[data-testid="${outerEl.getAttribute("data-testid")}"]`;
            window.sessionManager.saveFieldMemory(domain, fieldKey, step.target, resolvedSelector);
        }
        outerEl.style.boxShadow = "";
        nextStep();
    } else {
        outerEl.style.boxShadow = "";
        await handleFeedbackLoop(step);
    }
}

// ─── START EXECUTION ──────────────────────────────────────────────────────────
async function startExecution(plan) {
    currentPlan = plan;
    if (window.sessionManager) {
        const session = window.sessionManager.getSession();
        if (session) { session.lastPlan = plan; window.sessionManager.save(); }
    }
    const session = window.sessionManager?.getSession();
    if (window.sessionManager && plan?.phases && session?.pendingSteps.length === 0) {
        plan.phases.forEach(phase => {
            phase.steps.forEach(step => window.sessionManager.addStep(step.target || JSON.stringify(step)));
        });
    }
    if (typeof clearFieldLocks === "function") clearFieldLocks();
    if (executionRunning) { console.log("[EXECUTION LOCK] Plan already running"); return; }
    executionRunning = true;
    console.log("===== PLAN RECEIVED ====="); console.log(plan);
    const goal = session?.mergedGoal || session?.goal || "";
    if (goal && typeof saveChatToHistory === "function") saveChatToHistory(goal);
    currentPhase = 0; currentStep = 0;
    if (typeof enrichPlanWithExplanations === "function") {
        enrichPlanWithExplanations(plan).then(() => {
            if (typeof addMessage === "function") addMessage("AI", "Nice choice — let's get this done step by step.");
            if (typeof showPlan   === "function") showPlan(plan);
            setTimeout(() => highlightCurrentStep(), 300);
        });
    } else {
        setTimeout(() => highlightCurrentStep(), 300);
    }
}

// ─── HIGHLIGHT STEP ───────────────────────────────────────────────────────────
async function highlightCurrentStep() {
    if (typeof detectPageChange === "function") detectPageChange();
    if (!currentPlan) return;
    const phase = currentPlan.phases[currentPhase];
    if (!phase) return;
    const step = phase.steps[currentStep];
    if (!step) return;

    console.log("===== STEP START ====="); console.log("STEP:", step);
    if (currentElement) currentElement.style.boxShadow = "";

    const stepId = ++currentStepId;
    step._stepId = stepId;

    // Clear per-step feedback state on each fresh step
    delete step._feedbackAsked;
    delete step._lastUserDescription;

    if (step.action === "search_select") { await handleSearchSelect(step); return; }
    if (step.action === "click_date")    { await handleClickDate(step);    return; }

    let element = null;
    if (typeof findBestInput === "function") element = await findBestInput(step);

    if (!element) {
        console.log("[MATCH FAILED]", step.target);
        await handleFeedbackLoop(step);
        return;
    }
    console.log("[MATCH SUCCESS]", element);

    if (step._lowConfidence && typeof showConfirmationButtons === "function") {
        const score  = step._matchScore      || 0;
        const ratio  = step._matchConfidence || 1;
        console.log("[LOW CONFIDENCE] asking user to confirm element, score:", score, "ratio:", ratio.toFixed(2));
        addMessage("AI", `I found a likely match for "${step.target}" — does this look right?`);
        const domain   = window.location.hostname;
        const fieldKey = resolveFieldKey(step.target);
        const confirmed = await new Promise(resolve => {
            showConfirmationButtons(element,
                () => resolve(true),
                () => {
                    if (window.sessionManager && typeof window.sessionManager.rejectElement === "function")
                        window.sessionManager.rejectElement(element);
                    resolve(false);
                }
            );
        });
        if (!confirmed) { delete step._lowConfidence; await handleFeedbackLoop(step); return; }
        _saveAndContinue(step, fieldKey, domain, element, step.target);
        return;
    }
    delete step._lowConfidence;
    currentElement = element;
    if (typeof rememberElement === "function") rememberElement(step.target, element);
    element.style.boxShadow = "0 0 0 4px red";
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.focus();
    if (step.action === "type" && step.value) {
        console.log("[TYPING]", step.value);
        const input = ensureInputReady(element);
        currentElement = input;
        setTimeout(() => { simulateTyping(input, step.value); recordAction("type", step.target, step.value); }, 300);
    }
    if (step.action === "click") {
        console.log("[CLICK STEP]", step.target);
        recordAction("click", step.target, "clicked");
    }
}

// ─── NEXT STEP ────────────────────────────────────────────────────────────────
function nextStep() {
    if (!currentPlan) return;
    const phase = currentPlan.phases[currentPhase];
    if (!phase) return;
    currentStep++;
    saveExecutionState();
    if (currentStep >= phase.steps.length) { currentPhase++; currentStep = 0; saveExecutionState(); }
    if (currentPhase >= currentPlan.phases.length) {
        window.__executionResumed = false;
        console.log("===== EXECUTION COMPLETE =====");
        if (typeof addMessage === "function") addMessage("AI", "✅ All done! The task has been completed successfully.");
        if (window.sessionManager) {
            const session = window.sessionManager.getSession();
            if (session) {
                session.status = "completed"; window.sessionManager.save();
                const completedGoal = session.mergedGoal || session.goal || "";
                if (completedGoal && typeof saveChatToHistory === "function") saveChatToHistory(completedGoal);
            }
        }
        currentPlan = null; executionRunning = false;
        if (currentElement) { currentElement.style.boxShadow = ""; currentElement = null; }
        return;
    }
    setTimeout(() => highlightCurrentStep(), 300);
}

// ─── STEP COMPLETION DETECTION ────────────────────────────────────────────────
function detectStepCompletion(e) {
    if (!currentPlan || !currentElement) return;
    const phase = currentPlan.phases[currentPhase];
    if (!phase) return;
    const step = phase.steps[currentStep];
    if (!step) return;
    if (step.action === "search_select" || step.action === "click_date") return;
    resolveActionIntent(step);
    const target = e.target;
    if (!(currentElement instanceof Node)) return;
    if (target !== currentElement && !currentElement.contains(target)) return;
    if (step._stepId !== currentStepId) return;
    if (e.type === "input" && step.action === "type") {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            const value = currentElement.value || "";
            if (value.trim().length > 0) {
                console.log("[STEP COMPLETE] typing finished");
                if (typeof lockField === "function") lockField(currentElement);
                if (window.sessionManager) window.sessionManager.completeStep(step.target || "typing step");
                nextStep();
            }
        }, 500);
    }
    if (e.type === "click" && step.action === "click") {
        console.log("[STEP COMPLETE] click detected");
        if (typeof lockField === "function") lockField(currentElement);
        if (window.sessionManager) window.sessionManager.completeStep(step.target || "click step");
        nextStep();
    }
}

// ─── TYPING SIMULATION ────────────────────────────────────────────────────────
function simulateTyping(element, text) {
    element.focus();
    try { element.value = ""; } catch(e) {}
    for (const char of text) {
        try { element.value += char; } catch(e) {}
        element.dispatchEvent(new KeyboardEvent("keydown",  { bubbles: true, key: char }));
        element.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, key: char }));
        element.dispatchEvent(new Event("input",            { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent("keyup",    { bubbles: true, key: char }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
    try {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
        if (nativeSetter && nativeSetter.set) {
            nativeSetter.set.call(element, text);
            element.dispatchEvent(new Event("input", { bubbles: true }));
        }
    } catch(e) {}
    setTimeout(() => selectDropdownOption(text), 600);
}

// ─── DROPDOWN SELECTION (legacy fallback) ─────────────────────────────────────
function selectDropdownOption(value) {
    const options = document.querySelectorAll('[role="option"],[role="listbox"] li,.autocomplete li,.suggestions li');
    for (const option of options) {
        const text = option.innerText || "";
        if (text.toLowerCase().includes(value.toLowerCase())) {
            console.log("[DROPDOWN SELECT]", text);
            option.click();
            if (currentElement) {
                if (typeof lockField === "function") lockField(currentElement);
                nextStep();
            }
            return true;
        }
    }
    return false;
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────────
document.addEventListener("input", detectStepCompletion, true);
document.addEventListener("click", detectStepCompletion, true);