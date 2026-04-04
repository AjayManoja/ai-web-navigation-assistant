// guidance/elementMatcher.js
// ✅ UPDATED: Full div/span candidate collection, DEPART_DATE position scoring,
//             positionContext wired through all scoring, progressive fallback
//             chain that never skips a step when candidates exist.

// ─── COMMITTED ELEMENT REGISTRY ──────────────────────────────────────────────
// Once Norman finds and confirms an element for a fieldKey, it is committed.
// findBestInput returns the committed element immediately — no re-scanning.
// Cleared on interruptExecution() / session start so each new task is fresh.
const _committedElements = new Map(); // fieldKey → element

function commitElement(fieldKey, element) {
    if (!fieldKey || !element) return;
    _committedElements.set(fieldKey, element);
    console.log("[COMMITTED] element locked for fieldKey:", fieldKey, element);
}

function getCommitted(fieldKey) {
    if (!fieldKey) return null;
    const el = _committedElements.get(fieldKey);
    if (!el) return null;
    // Stale check — element must still be in DOM and visible
    if (!document.contains(el) || !isVisible(el)) {
        _committedElements.delete(fieldKey);
        return null;
    }
    return el;
}

function clearAllCommitted() {
    _committedElements.clear();
    console.log("[COMMITTED] all commitments cleared");
}

// ✅ FIX 2: Evict a single element from the committed registry by reference.
//    Called by sessionManager.rejectElement so a rejected element is never
//    returned through the committed-shortcut in findBestInput.
function evictCommitted(element) {
    if (!element) return;
    for (const [key, el] of _committedElements.entries()) {
        if (el === element) {
            _committedElements.delete(key);
            console.log("[COMMITTED] evicted by rejection for fieldKey:", key);
        }
    }
}

// Expose so executionController can clear on interrupt
window._clearAllCommitted = clearAllCommitted;
// ✅ FIX 2: Expose evict so sessionManager.rejectElement can call it
window._evictCommitted = evictCommitted;

function normalize(text){
    if(!text) return "";
    return text.toLowerCase().replace(/[^a-z0-9 ]/g,"").trim();
}

function wordOverlapScore(a,b){
    const wordsA = normalize(a).split(" ");
    const wordsB = normalize(b).split(" ");
    let score = 0;
    wordsA.forEach(word=>{
        if(!word) return;
        if(wordsB.includes(word)) score += 3;
        if(normalize(b).includes(word)) score += 1;
    });
    return score;
}

function buildElementText(item){
    let text = "";
    text += " " + (item.label || "");
    text += " " + (item.placeholder || "");
    text += " " + (item.ariaLabel || "");
    text += " " + (item.containerText || "");
    const el = item.element;
    text += " " + (el.innerText || "");
    text += " " + (el.value || "");
    text += " " + (el.name || "");
    text += " " + (el.id || "");
    text += " " + (el.placeholder || "");
    // ✅ NEW: include class list so date/calendar class names score positively
    text += " " + ([...(el.classList||[])].join(" "));
    return text;
}

function matchFieldRole(target,role){
    const map = {
        ORIGIN:      ["from","origin","departure","flying from","leaving from"],
        DESTINATION: ["to","destination","arrival","going to"],
        DATE:        ["date","departure date","travel date","depart"],
        RETURN_DATE: ["return","return date","back date"],
        PASSENGERS:  ["passengers","travellers","people"]
    };
    const words = map[role] || [];
    const norm = normalize(target);
    return words.some(w=>norm.includes(w));
}

function findInputFromLabel(target){
    const labels = document.querySelectorAll("label");
    const normTarget = normalize(target);
    for(const label of labels){
        const text = normalize(label.innerText);
        if(!text.includes(normTarget)) continue;
        const forId = label.getAttribute("for");
        if(forId){
            const el = document.getElementById(forId);
            if(el && document.contains(el) && !isFieldLocked(el)) return el;
        }
        const parent = label.closest("div,form,section");
        if(parent){
            const input = parent.querySelector("input,textarea,select");
            if(input && !isFieldLocked(input)) return input;
        }
    }
    return null;
}

function spatialScore(element,target){
    const nodes = [...document.querySelectorAll("label,span,div,p,strong")];
    const normTarget = normalize(target);
    let bestDist = Infinity;
    nodes.forEach(node=>{
        if(node.closest("#webguide-assistant")) return;
        const text = normalize(node.innerText);
        if(!text.includes(normTarget)) return;
        const rect1 = node.getBoundingClientRect();
        const rect2 = element.getBoundingClientRect();
        const dist = Math.sqrt((rect1.x-rect2.x)**2 + (rect1.y-rect2.y)**2);
        if(dist < bestDist) bestDist = dist;
    });
    if(bestDist < 200) return 25;
    if(bestDist < 400) return 10;
    return 0;
}

// ✅ UPDATED: allows div/span calendar_trigger elements for click_date
function isCandidateForAction(step, element){
    if(!element) return false;
    if(!document.contains(element)) return false;
    if(isFieldLocked(element)) return false;
    if(element.closest("#webguide-assistant")) return false;
    if(element.offsetParent === null) return false;

    const roleType = typeof detectElementRole === "function"
        ? detectElementRole(element) : "generic";
    const tag = element.tagName.toLowerCase();

    if(step.action === "search_select") return true;

    // ✅ FIX 7: div/span/li/a only accepted for click_date if they have a date role —
    //    prevents banners, headers, and "Search now" buttons matching as date pickers
    if(step.action === "click_date"){
        if(roleType === "calendar_trigger" || roleType === "date_picker") return true;
        if(["div","span","li","a"].includes(tag)) {
            const elRole = typeof detectElementRole === "function"
                ? detectElementRole(element) : "";
            return elRole === "calendar_trigger" || elRole === "date_picker";
        }
        return true; // native inputs always allowed
    }

    if(step.action === "type"){
        const type = (element.type || "").toLowerCase();
        return (tag === "input" && !["checkbox","radio","button","submit"].includes(type))
            || tag === "textarea";
    }

    if(step.action === "click") return roleType === "button" || roleType === "dropdown";
    if(step.action === "select_date") return roleType === "date_picker";

    return true;
}

// ─── ALIAS VARIANT GENERATOR ──────────────────────────────────────────────────
function _getAliasVariants(fieldKey) {
    const VARIANTS = {
        DEPART_DATE:    ["depart","departure","depart date","outbound","travel date","going","fly out"],
        CHECKIN_DATE:   ["checkin","check in","checkin date","arrival","arrival date","ci"],
        CHECKOUT_DATE:  ["checkout","check out","checkout date","departure date","co"],
        DATE:           ["date","travel date","departure date","outbound"],
        RETURN_DATE:    ["return","return date","inbound","back date","coming back"],
        ORIGIN:         ["from","origin","departure","flying from","leaving from","source"],
        DESTINATION:    ["to","destination","arrival","going to","arriving at"],
        PASSENGERS:     ["passengers","travellers","guests","pax"],
        ADULTS:         ["adults","adult"],
        CHILDREN:       ["children","child","kids"],
        ROOMS:          ["rooms","room"],
        SEARCH:         ["search","find","go"],
        SUBMIT:         ["submit","book","continue","proceed"],
    };
    const key = (fieldKey || "").toUpperCase();
    return VARIANTS[key] || [normalize(fieldKey)];
}

function scoreCandidate(step, item){
    const el = item.element;

    // ── REJECTION BLACKLIST ──────────────────────────────────────────────────
    if (window.sessionManager && typeof window.sessionManager.isRejected === "function") {
        if (window.sessionManager.isRejected(el)) return -Infinity;
    }

    let score = 0;

    const elementText = buildElementText(item);
    const targetText  = normalize(step.target || "");

    score += wordOverlapScore(targetText, elementText) * 5;

    if(item.containerText){
        const ctx = normalize(item.containerText);
        if(ctx.includes(targetText)) score += 20;
        targetText.split(" ").forEach(word=>{ if(ctx.includes(word)) score += 5; });
    }

    if(item.label){       const label = normalize(item.label);       if(label.includes(targetText)) score += 15; }
    if(item.placeholder){ const ph    = normalize(item.placeholder); if(ph.includes(targetText))    score += 10; }
    if(item.ariaLabel){   const aria  = normalize(item.ariaLabel);   if(aria.includes(targetText))  score += 10; }

    if(item.nearbyText && Array.isArray(item.nearbyText)){
        item.nearbyText.forEach(text => {
            const normText = normalize(text);
            if(normText.includes(targetText)) score += 15;
            targetText.split(" ").forEach(word => { if(normText.includes(word)) score += 3; });
        });
    }

    score += spatialScore(el, step.target);

    const rect = el.getBoundingClientRect();
    if(rect.width > 0 && rect.height > 0) score += 5;
    if(rect.width < 350) score += 2;

    const tag = el.tagName.toLowerCase();
    if(step.action === "type" && (tag === "input" || tag === "textarea")) score += 10;
    
    if(step.action === "click") {
    const role = typeof detectElementRole === "function"
        ? detectElementRole(el) : "";

    if(tag === "button") score += 25;

    if(role === "button") score += 30;

    const text = (el.innerText || "").toLowerCase();
    if(text.includes("search") || text.includes("find")) score += 40;
    }
    

    const text = buildElementText(item).toLowerCase();

    if(step.action === "click" && step.target.toLowerCase().includes("search")){
        if(text.includes("traveller") || text.includes("cabin")) score -= 50;
    }

    if(step.action === "search_select"){
        const inputType = item.inputType || (typeof detectFieldInputType === "function" ? detectFieldInputType(el) : "real");
        if(inputType === "fake")       score += 20;
        if(el.getAttribute("role") === "combobox") score += 15;
        if(tag === "input")            score += 10;
    }

    if(step.action === "click_date"){
        const inputType = item.inputType || (typeof detectFieldInputType === "function" ? detectFieldInputType(el) : "real");
        if(inputType === "calendar_trigger") score += 30; // ✅ boosted
        if(inputType === "date")             score += 20;
        // ✅ NEW: structural bonus — div/span showing a formatted date
        const elRole = typeof detectElementRole === "function" ? detectElementRole(el) : "";
        if(elRole === "calendar_trigger")    score += 25;
        if(elRole === "date_picker")         score += 20;
    }

    if(item.neighbors && item.neighbors.length > 0){
        const targetWords = normalize(step.target || "").split(" ");
        item.neighbors.forEach(id => {
            const neighbor = getSemanticNodes()[id];
            if(!neighbor) return;
            const neighborText = normalize((neighbor.label||"") + (neighbor.placeholder||"") + (neighbor.containerText||""));
            targetWords.forEach(word => { if(neighborText.includes(word)) score += 8; });
        });
    }

    if(step.intent){
        if(step.intent.includes("DESTINATION") && item.role === "text_input") score += 10;
        if(step.intent.includes("SEARCH")      && item.role === "button")     score += 12;
    }

    // ── SEMANTIC ALIAS + STRUCTURAL ROLE BOOST ────────────────────────────────
    if (step.uiType && typeof detectElementRole === "function") {
        const elRole = detectElementRole(el);
        if (step.uiType === elRole)                                              score += 35;
        if (step.uiType === "date_picker"      && elRole === "calendar_trigger") score += 30;
        if (step.uiType === "calendar_trigger" && elRole === "date_picker")      score += 30;
        if (step.uiType === "search_select"    && elRole === "search_select")    score += 25;
        if (step.uiType === "counter"          && elRole === "counter")          score += 25;
    }

    // ── DATE FIELD POSITION DISAMBIGUATION ───────────────────────────────────
    // DEPART_DATE → leftmost date field. RETURN_DATE → rightmost.
    // ✅ UPDATED: also applies to div/span calendar_trigger candidates
    if (step.fieldKey === "DEPART_DATE" || step.fieldKey === "RETURN_DATE") {
        if (typeof classifyDateFieldByPosition === "function") {
            const posClass = classifyDateFieldByPosition(el);
            if (posClass === step.fieldKey) score += 50;      // strong match
            else if (posClass !== "DATE")   score -= 30;      // wrong position
        }
        // ✅ Cross-field confusion guard: if the opposite date field is already
        //    committed, penalise this element if it IS that committed element.
        //    This prevents Depart→Return switching mid-task.
        const oppositeKey = step.fieldKey === "DEPART_DATE" ? "RETURN_DATE" : "DEPART_DATE";
        const oppositeCommitted = getCommitted(oppositeKey);
        if (oppositeCommitted && oppositeCommitted === el) {
            score -= 80; // hard penalty: do not reuse the other date field
            console.log("[CROSS-FIELD GUARD] penalising committed opposite date field for:", step.fieldKey);
        }
    }

    // ── ALIAS TEXT EXPANSION BOOST ────────────────────────────────────────────
    if (step.fieldKey) {
        const aliasVariants = _getAliasVariants(step.fieldKey);
        const elTextNorm    = normalize(elementText);
        aliasVariants.forEach(alias => {
            if (elTextNorm.includes(alias)) score += 12;
        });
    }

    // ── SPATIAL POSITION HINT BOOST ──────────────────────────────────────────
    // ✅ UPDATED: uses positionContext from semanticNode (populated by domCache)
    //    Falls back to item.positionContext if available on item directly.
    const pc = item.positionContext || null;
    if (step.positionHint && pc) {
        const hint = step.positionHint.toLowerCase();
        if (hint.includes("right")  && pc.quadrant.horizontal === "right")  score += 30;
        if (hint.includes("left")   && pc.quadrant.horizontal === "left")   score += 30;
        if (hint.includes("top")    && pc.quadrant.vertical   === "top")    score += 25;
        if (hint.includes("bottom") && pc.quadrant.vertical   === "bottom") score += 25;
        const hintWords = hint.split(/\s+/).filter(w => w.length > 2);
        [pc.nearestLeft, pc.nearestRight, pc.nearestAbove, pc.nearestBelow].forEach(nbr => {
            if (!nbr) return;
            const nbrNorm = normalize(nbr);
            hintWords.forEach(w => { if (nbrNorm.includes(w)) score += 18; });
        });
        if (hint.includes("right") && pc.quadrant.horizontal === "left")  score -= 20;
        if (hint.includes("left")  && pc.quadrant.horizontal === "right") score -= 20;
    }

    // ── GEMINI HINT BONUS ─────────────────────────────────────────────────────
    // Additive only — never replaces scoring. If Gemini returns empty, continues normally.
    if (step._geminiHints) {
        const hints = step._geminiHints;
        if (hints.structuralRole) {
            const elRole = typeof detectElementRole === "function" ? detectElementRole(el) : "";
            if (hints.structuralRole === elRole) score += 20;
        }
        if (hints.cssSelector) {
            try {
                const matched = document.querySelector(hints.cssSelector);
                if (matched === el) score += 25;
            } catch(e) {}
        }
        if (hints.ariaLabel) {
            const aria = (el.getAttribute("aria-label") || "").toLowerCase();
            if (aria.includes(hints.ariaLabel.toLowerCase())) score += 20;
        }
        if (hints.nearbyText) {
            const nearby = normalize(hints.nearbyText);
            const elText = normalize(elementText);
            if (elText.includes(nearby)) score += 15;
        }
        if (hints.positionClue && pc) {
            const clue = hints.positionClue.toLowerCase();
            if (clue.includes("right") && pc.quadrant.horizontal === "right") score += 15;
            if (clue.includes("left")  && pc.quadrant.horizontal === "left")  score += 15;
            if (clue.includes("top")   && pc.quadrant.vertical   === "top")   score += 12;
        }
    }

    // ── SESSION SCORE WEIGHT MULTIPLIER ──────────────────────────────────────
    // ✅ FIX 3: Guard multiplier with rejection check. Previously the blacklist
    //    returned -Infinity but only if the element scored > 0 from other signals.
    //    A boost multiplier applied after that check could push a rejected element's
    //    score above the winner threshold. Now we hard-skip the multiplier entirely
    //    for any rejected element so -Infinity is always the final score.
    if (step.fieldKey && window.sessionManager && typeof window.sessionManager.getScoreWeight === "function") {
        const isRejectedEl = typeof window.sessionManager.isRejected === "function"
            ? window.sessionManager.isRejected(el) : false;
        if (!isRejectedEl) {
            const structBoost  = window.sessionManager.getScoreWeight(step.fieldKey, "structural");
            const spatialBoost = window.sessionManager.getScoreWeight(step.fieldKey, "spatial");
            if (structBoost > 1.0 && step.uiType && typeof detectElementRole === "function") {
                const elRole = detectElementRole(el);
                if (elRole === step.uiType) score *= structBoost;
            }
            if (spatialBoost > 1.0 && step.positionHint && pc) {
                score *= spatialBoost;
            }
        }
    }

    return score;
}

// ─── CLOSEST MATCH FALLBACK ───────────────────────────────────────────────────
function findClosestCandidates(step, topN = 3) {
    const elements   = getSemanticNodes();
    const candidates = [];
    elements.forEach(item => {
        const el = item.element;
        if (!el || !document.contains(el) || isFieldLocked(el) || !isCandidateForAction(step, el)) return;
        const score = scoreCandidate(step, item);
        if (score > 0) candidates.push({ element: el, score, label: item.label || item.placeholder || item.ariaLabel || "" });
    });
    candidates.sort((a,b) => b.score - a.score);
    return candidates.slice(0, topN);
}

function findElementBySelector(target){
    if(!target) return null;
    let el = document.getElementById(target);                              if(el) return el;
    el = document.querySelector(`[name="${target}"]`);                     if(el) return el;
    el = document.querySelector(`[placeholder="${target}"]`);             if(el) return el;
    el = document.querySelector(`[aria-label="${target}"]`);              if(el) return el;
    el = document.querySelector(`[data-testid="${target}"]`);             if(el) return el;
    el = document.querySelector(`[data-qa="${target}"]`);                 if(el) return el;
    return null;
}

// ✅ Async — reads from chrome.storage.local
async function findBySavedFeedback(step){
    try {
        const domain      = window.location.hostname;
        const targetLower = (step.target || "").toLowerCase();

        // ── Correction patterns first ──
        if (window.sessionManager && typeof window.sessionManager.getCorrectionPattern === "function") {
            const correction = await new Promise(resolve => {
                window.sessionManager.getCorrectionPattern(domain, step.target, resolve);
            });
            if (correction && correction.resolvedSelector) {
                const el = document.querySelector(correction.resolvedSelector);
                if (el && document.contains(el) && isVisible(el)) {
                    console.log("[CORRECTION PATTERN MATCH]", step.target, "→", correction.fieldKey, el);
                    return el;
                }
            }
        }

        const result = await new Promise((resolve) => {
            chrome.storage.local.get("norman_field_memory", resolve);
        });
        const allMemory = result["norman_field_memory"];
        if(!allMemory) return null;
        const domainMemory = allMemory[domain];
        if(!domainMemory) return null;

        let fieldKey = null;
        if (typeof resolveSemanticAlias === "function") {
            const alias = resolveSemanticAlias(step.target || "");
            if (alias) fieldKey = alias.fieldKey;
        }
        if (!fieldKey) {
            if(targetLower.includes("origin") || targetLower.includes("from"))             fieldKey = "ORIGIN";
            else if(targetLower.includes("destination") || targetLower.includes("to"))     fieldKey = "DESTINATION";
            else if(targetLower.includes("depart") && !targetLower.includes("return"))     fieldKey = "DEPART_DATE";
            else if(targetLower.includes("date") && !targetLower.includes("return"))       fieldKey = "DATE";
            else if(targetLower.includes("return"))                                        fieldKey = "RETURN_DATE";
            else if(targetLower.includes("passenger") || targetLower.includes("traveller")) fieldKey = "PASSENGERS";
            else if(targetLower.includes("search"))                                        fieldKey = "SEARCH";
        }

        if(!fieldKey || !domainMemory[fieldKey]) return null;
        const saved = domainMemory[fieldKey];

        if(saved.resolvedSelector){
            const el = document.querySelector(saved.resolvedSelector);
            if(el && document.contains(el) && isVisible(el)){
                console.log("[FEEDBACK MEMORY MATCH]", fieldKey, el);
                return el;
            } else {
                console.warn("[FEEDBACK MEMORY] stale selector, clearing:", fieldKey);
                delete saved.resolvedSelector;
                chrome.storage.local.set({ "norman_field_memory": allMemory });
            }
        }

        if(saved.userDescription){
            const descWords = normalize(saved.userDescription).split(" ").filter(w => w.length > 1);
            const threshold = descWords.length === 1 ? 1 : 2;
            const allEls = document.querySelectorAll(
                "input, textarea, select, button, [role='combobox'], [role='button'], div, span"
            );
            let bestEl = null, bestScore = 0;
            for(const el of allEls){
                if(!isVisible(el)) continue;
                const elText = normalize(
                    (el.innerText||"") + " " + (el.placeholder||"") + " " +
                    (el.getAttribute("aria-label")||"") + " " + (el.name||"") + " " + (el.id||"")
                );
                const matchCount = descWords.filter(w => elText.includes(w)).length;
                if(matchCount >= threshold && matchCount > bestScore){ bestScore = matchCount; bestEl = el; }
            }
            if(bestEl){
                console.log("[FEEDBACK DESCRIPTION MATCH]", fieldKey, bestEl, "score:", bestScore);
                return bestEl;
            }
        }
    } catch(e){ console.warn("[findBySavedFeedback] error:", e); }
    return null;
}

function findBySnapshotReference(step){
    if(step.snapshotIndex === undefined || step.snapshotIndex === null) return null;
    const nodes = getSemanticNodes();
    const node  = nodes[step.snapshotIndex];
    if(!node || !node.element || !document.contains(node.element)) return null;
    if(isFieldLocked(node.element) || !isVisible(node.element)) return null;
    console.log("[SNAPSHOT REFERENCE MATCH]", step.snapshotIndex, node.element);
    return node.element;
}

// ─── WAIT FOR INNER INPUT ─────────────────────────────────────────────────────
function waitForInnerInput(triggerEl, timeoutMs){
    return new Promise((resolve) => {
        const start = Date.now();
        const check = setInterval(() => {
            const searchContainers = [
                document.querySelector('[role="listbox"]'),
                document.querySelector('[role="dialog"]'),
                document.querySelector('[role="combobox"]'),
                document.querySelector('.autocomplete'),
                document.querySelector('.suggestions'),
                document.querySelector('.search-dropdown'),
                document.querySelector('.dropdown-open'),
                document.querySelector('.airport-search'),
                document.querySelector('.city-search'),
                document.querySelector('.station-search'),
                triggerEl ? triggerEl.closest("div,section,form") : null
            ].filter(Boolean);
            for(const container of searchContainers){
                const inputs = container.querySelectorAll(
                    "input[type='text'], input:not([type]), input[type='search'], input[type='tel']"
                );
                for(const input of inputs){
                    if(input === triggerEl) continue;
                    if(input.closest("#webguide-assistant")) continue;
                    if(!isVisible(input)) continue;
                    const rect = input.getBoundingClientRect();
                    if(rect.width < 10 || rect.height < 10) continue;
                    clearInterval(check);
                    console.log("[INNER INPUT FOUND]", input);
                    resolve(input);
                    return;
                }
            }
            if(Date.now() - start > timeoutMs){ clearInterval(check); resolve(null); }
        }, 80);
    });
}

// ─── RESOLVE REAL INPUT ───────────────────────────────────────────────────────
async function resolveRealInput(el){
    if(!el) return null;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || "").toLowerCase();
    if(
        (tag === "input" && !["button","submit","reset","image","checkbox","radio"].includes(type)) ||
        tag === "textarea" ||
        el.getAttribute("contenteditable") === "true"
    ) return el;
    console.log("[RESOLVE REAL INPUT] fake field detected, triggering:", el);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true }));
    const innerInput = await waitForInnerInput(el, 1500);
    if(innerInput){ console.log("[RESOLVE REAL INPUT] resolved:", innerInput); return innerInput; }
    return el;
}

// ─── GEMINI HINT DOM RETRY ────────────────────────────────────────────────────
function findElementByGeminiHints(hints) {
    if (!hints) return null;
    console.log("[GEMINI HINT RETRY]", hints);

    if (hints.cssSelector) {
        try {
            const el = document.querySelector(hints.cssSelector);
            if (el && document.contains(el) && isVisible(el)){
                console.log("[GEMINI HINT] matched via cssSelector:", hints.cssSelector, el);
                return el;
            }
        } catch(e) { console.warn("[GEMINI HINT] invalid cssSelector:", hints.cssSelector); }
    }

    if (hints.ariaLabel) {
        const el = document.querySelector(`[aria-label="${hints.ariaLabel}"]`);
        if (el && document.contains(el) && isVisible(el)) return el;
        const all = document.querySelectorAll("[aria-label]");
        for (const candidate of all) {
            if (candidate.closest("#webguide-assistant")) continue;
            if (!isVisible(candidate)) continue;
            const label = (candidate.getAttribute("aria-label") || "").toLowerCase();
            if (label.includes(hints.ariaLabel.toLowerCase())) return candidate;
        }
    }

    if (hints.placeholderText) {
        const el = document.querySelector(`[placeholder="${hints.placeholderText}"]`);
        if (el && document.contains(el) && isVisible(el)) return el;
        const inputs = document.querySelectorAll("input, textarea");
        for (const candidate of inputs) {
            if (!isVisible(candidate)) continue;
            const ph = (candidate.placeholder || "").toLowerCase();
            if (ph.includes(hints.placeholderText.toLowerCase())) return candidate;
        }
    }

    if (hints.nearbyText) {
        const normNearby = normalize(hints.nearbyText);
        const labelEls = document.querySelectorAll("label, span, div, p, strong, legend");
        for (const labelEl of labelEls) {
            if (labelEl.closest("#webguide-assistant")) continue;
            const text = normalize(labelEl.innerText || "");
            if (!text.includes(normNearby)) continue;
            const forId = labelEl.getAttribute("for");
            if (forId) {
                const associated = document.getElementById(forId);
                if (associated && isVisible(associated)) return associated;
            }
            const container = labelEl.closest("div, section, form, fieldset") || document.body;
            const nearbyInputs = container.querySelectorAll(
                "input, textarea, select, [role='combobox'], [role='textbox'], div[class*='date' i], span[class*='date' i]"
            );
            for (const ni of nearbyInputs) {
                if (ni.closest("#webguide-assistant")) continue;
                if (!isVisible(ni)) continue;
                const rect = ni.getBoundingClientRect();
                if (rect.width < 10 || rect.height < 10) continue;
                return ni;
            }
        }
    }

    if (hints.visualDescription) {
        const descWords = normalize(hints.visualDescription).split(" ").filter(w => w.length > 3);
        const candidates = document.querySelectorAll(
            "input, textarea, select, button, [role='combobox'], [role='button'], div, span"
        );
        let bestEl = null, bestScore = 0;
        for (const el of candidates) {
            if (el.closest("#webguide-assistant")) continue;
            if (!isVisible(el)) continue;
            const elText = normalize(
                (el.innerText||"") + " " + (el.placeholder||"") + " " +
                (el.getAttribute("aria-label")||"") + " " + (el.name||"") + " " + (el.id||"")
            );
            const score = descWords.filter(w => elText.includes(w)).length;
            if (score > bestScore) { bestScore = score; bestEl = el; }
        }
        if (bestEl && bestScore >= 2) return bestEl;
    }

    if (hints.positionClue) {
        const clue    = hints.positionClue.toLowerCase();
        const vw      = window.innerWidth;
        const vh      = window.innerHeight;
        const wantRight  = clue.includes("right");
        const wantLeft   = clue.includes("left");
        const wantTop    = clue.includes("top")    || clue.includes("above");
        const wantBottom = clue.includes("bottom") || clue.includes("below");
        const wantCenter = clue.includes("center") || clue.includes("middle");

        let refEl = null;
        const refMatch = clue.match(/(?:from|of|next to|beside|after)\s+([a-z]+)/);
        if (refMatch) {
            const refWord = refMatch[1];
            const allNodes = document.querySelectorAll("label, span, div, p, strong, input, button");
            for (const node of allNodes) {
                if (node.closest("#webguide-assistant")) continue;
                const nodeText = normalize(node.innerText || node.placeholder || node.getAttribute("aria-label") || "");
                if (nodeText.includes(refWord) && isVisible(node)) { refEl = node; break; }
            }
        }

        // ✅ UPDATED: include div/span in spatial search for date pickers
        const allInputs = document.querySelectorAll(
            "input, textarea, select, [role='combobox'], [role='textbox'], button," +
            "div[class*='date' i], span[class*='date' i], div[class*='depart' i], div[class*='calendar' i]"
        );
        let bestEl = null, bestScore = 0;
        for (const el of allInputs) {
            if (el.closest("#webguide-assistant")) continue;
            if (!isVisible(el)) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) continue;
            let score = 0;
            const cx = rect.left + rect.width / 2;
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
        if (bestEl && bestScore >= 10) return bestEl;
    }

    console.log("[GEMINI HINT RETRY] all strategies exhausted — no match");
    return null;
}

// ─── COLLECT ALL CANDIDATES ───────────────────────────────────────────────────
// ✅ NEW: Always builds a full candidate list before scoring — including
//    div/span calendar_trigger elements that standard selectors miss.
//    Called internally by findBestInput before the scoring phase.
function _collectAllCandidates(step) {
    const nodes      = getSemanticNodes();
    const candidates = [];
    const seen       = new Set();

    // Pass 1 — from semantic node cache (includes div/span added by updated domCache)
    nodes.forEach(item => {
        const el = item.element;
        if (!el || !document.contains(el) || isFieldLocked(el)) return;
        if (!isCandidateForAction(step, el)) return;
        seen.add(el);
        // ✅ FIX 3: tag x-position for date field position-priority sort
        if (step.fieldKey === "DEPART_DATE" || step.fieldKey === "RETURN_DATE") {
            item._x = el.getBoundingClientRect().left;
        }
        candidates.push(item);
    });

    // Pass 2 — ✅ structural date sweep (safety net for any missed div/span)
    //    Runs only for date-related steps so it doesn't bloat other actions.
    if (step.action === "click_date" || step.fieldKey === "DEPART_DATE" || step.fieldKey === "RETURN_DATE" || step.fieldKey === "DATE") {
        const dateSelectors = [
            "[class*='date' i]","[class*='calendar' i]","[class*='depart' i]",
            "[class*='checkin' i]","[class*='checkout' i]","[class*='picker' i]",
            "[data-date]","[data-datepicker]","[data-flatpickr]",
            "input[readonly]"
        ].join(",");

        document.querySelectorAll(dateSelectors).forEach(el => {
            if (seen.has(el)) return;
            if (!document.contains(el)) return;
            if (el.closest("#webguide-assistant")) return;
            if (!isVisible(el)) return;
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) return;
            seen.add(el);

            // Build a minimal item so scoreCandidate can work
            const positionContext = typeof getElementPositionContext === "function"
                ? getElementPositionContext(el) : null;
            const rect2 = el.getBoundingClientRect();
            const dateItem = {
                element:       el,
                role:          typeof detectElementRole      === "function" ? detectElementRole(el)      : "calendar_trigger",
                label:         typeof resolveLabel           === "function" ? resolveLabel(el)           : "",
                placeholder:   el.placeholder || "",
                ariaLabel:     el.getAttribute("aria-label") || "",
                containerText: typeof getContainerText       === "function" ? getContainerText(el)       : "",
                nearbyText:    typeof findNearbyText         === "function" ? findNearbyText(el)         : [],
                inputType:     typeof detectFieldInputType   === "function" ? detectFieldInputType(el)   : "calendar_trigger",
                positionContext,
                neighbors:     []
            };
            // ✅ FIX 3: tag x-position for date field position-priority sort
            if (step.fieldKey === "DEPART_DATE" || step.fieldKey === "RETURN_DATE") {
                dateItem._x = rect2.left;
            }
            candidates.push(dateItem);
        });
    }

    console.log(`[CANDIDATES] collected ${candidates.length} for step: ${step.target} (action: ${step.action})`);
    return candidates;
}

// ─── REJECTION HELPER ────────────────────────────────────────────────────────
// ✅ FIX 2: Single function used at every return point in findBestInput so a
//    rejected element can never slip through via memory, feedback, or fallback.
function isRejectedElement(el) {
    return !!(window.sessionManager &&
        typeof window.sessionManager.isRejected === "function" &&
        window.sessionManager.isRejected(el));
}

// ─── MAIN MATCHER ─────────────────────────────────────────────────────────────
// ✅ UPDATED: Uses _collectAllCandidates so the list is never empty due to
//    missing div/span elements. Progressive fallback — never skips a step
//    when any candidate exists.
async function findBestInput(step){
    if(!step){ console.warn("[MATCHER] Step undefined"); return null; }

    const target = step.target || "";

    // ── Semantic alias enrichment ──────────────────────────────────────────
    if (!step.fieldKey || !step.uiType) {
        if (typeof resolveSemanticAlias === "function") {
            const alias = resolveSemanticAlias(target);
            if (alias) {
                step.fieldKey = step.fieldKey || alias.fieldKey;
                step.uiType   = step.uiType   || alias.uiType;
                console.log("[MATCHER] semantic alias resolved:", target, "→", alias);
            }
        }
    }

    // Step -1 — COMMITTED ELEMENT (highest priority — Norman already decided)
    // If this field was committed earlier in this session, reuse it immediately.
    // No re-scoring, no re-scanning. Rejection takes priority over commitment.
    if (step.fieldKey) {
        const committed = getCommitted(step.fieldKey);
        if (committed) {
            const isRejected = isRejectedElement(committed);
            if (!isRejected) {
                console.log("[COMMITTED LOCKED - NO RESCAN]", step.fieldKey, committed);
                return committed; // 🚀 HARD LOCK — NEVER FALL BACK TO SCORING
            } else {
                _committedElements.delete(step.fieldKey);
                console.log("[COMMITTED CLEARED AFTER REJECTION]", step.fieldKey);
            }
        }
    }

    // Step 0 — SAVED FEEDBACK
    const feedbackMatch = await findBySavedFeedback(step);
    if(feedbackMatch && !isRejectedElement(feedbackMatch)){
        rememberElement(target, feedbackMatch);
        commitElement(step.fieldKey, feedbackMatch);
        return feedbackMatch;
    }

    // Step 0.5 — SNAPSHOT REFERENCE
    const snapshotMatch = findBySnapshotReference(step);
    if(snapshotMatch && !isRejectedElement(snapshotMatch)){
        rememberElement(target, snapshotMatch);
        commitElement(step.fieldKey, snapshotMatch);
        return snapshotMatch;
    }

    // Step 1 — MEMORY
    const remembered = recallElement(target);
    if(remembered && document.contains(remembered) && !isFieldLocked(remembered) && isCandidateForAction(step,remembered)){
        if (!isRejectedElement(remembered)) {
            console.log("[MEMORY MATCH]", remembered);
            // ✅ FIX 5: don't overwrite an existing commitment with memory
            if (!getCommitted(step.fieldKey)) {
                commitElement(step.fieldKey, remembered);
            }
            return remembered;
        }
    }

    // Step 2 — DIRECT SELECTOR
    const direct = findElementBySelector(target);
    if(direct && document.contains(direct) && !isRejectedElement(direct)){
        console.log("[DIRECT MATCH]",direct);
        rememberElement(target,direct);
        commitElement(step.fieldKey, direct);
        return direct;
    }

    // Step 3 — LABEL
    const labelMatch = findInputFromLabel(target);
    if(labelMatch && !isRejectedElement(labelMatch)){
        console.log("[LABEL MATCH]",labelMatch);
        rememberElement(target,labelMatch);
        commitElement(step.fieldKey, labelMatch);
        return labelMatch;
    }

    // Step 4 — PLACEHOLDER
    const inputs = document.querySelectorAll("input,textarea");
    for(const el of inputs){
        if(isFieldLocked(el)) continue;
        if(window.sessionManager && typeof window.sessionManager.isRejected === "function" && window.sessionManager.isRejected(el)) continue;
        const ph = (el.placeholder || "").toLowerCase();
        if(ph.includes(target.toLowerCase())){ console.log("[PLACEHOLDER MATCH]",el); rememberElement(target,el); commitElement(step.fieldKey, el); return el; }
    }

    // Step 5 — ARIA
    for(const el of inputs){
        if(window.sessionManager && typeof window.sessionManager.isRejected === "function" && window.sessionManager.isRejected(el)) continue;
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        if(aria.includes(target.toLowerCase())){ console.log("[ARIA MATCH]",el); rememberElement(target,el); commitElement(step.fieldKey, el); return el; }
    }

    // Step 6 — FULL CANDIDATE COLLECTION + SCORING
    // ✅ Uses _collectAllCandidates (includes div/span date pickers)
    const allCandidates = _collectAllCandidates(step);
    let candidates = [];
    allCandidates.forEach(item => {
        const el = item.element;
        if(!el || !document.contains(el) || isFieldLocked(el)) return;
        const score = scoreCandidate(step, item);
        if(score > 0) candidates.push({ element: el, score, item });
    });

    if(candidates.length > 0){
        // ✅ FIX 3: position-priority sort for date fields — score is tiebreaker only
        candidates.sort((a, b) => {
            if (step.fieldKey === "DEPART_DATE" || step.fieldKey === "RETURN_DATE") {
                if (a.item?._x !== undefined && b.item?._x !== undefined) {
                    return step.fieldKey === "DEPART_DATE"
                        ? a.item._x - b.item._x   // leftmost wins
                        : b.item._x - a.item._x;  // rightmost wins
                }
            }
            return b.score - a.score;
        });
        const best   = candidates[0];
        const second = candidates[1];

        // ✅ FIX 6: raised threshold 18 → 25 to prevent weak matches winning
        if(best.score > 25){
            const confidenceRatio   = second ? best.score / second.score : Infinity;
            step._matchConfidence   = confidenceRatio;
            step._matchScore        = best.score;

            if (confidenceRatio >= 2.0 || best.score >= 50) {
                console.log("[SEMANTIC MATCH HIGH CONFIDENCE]", best.score, "ratio:", confidenceRatio.toFixed(2), best.element);
                commitElement(step.fieldKey, best.element);
            } else {
                console.log("[SEMANTIC MATCH LOW CONFIDENCE]", best.score, "ratio:", confidenceRatio.toFixed(2), "— will ask confirmation");
                step._lowConfidence = true;
            }
            rememberElement(step.target, best.element);
            return best.element;
        }
    }

    // Step 7 — UNIVERSAL FORM ENGINE
    const universalForms = getUniversalForms() || [];
    for(const form of universalForms){
        for(const field of form.fields){
            const el = field.element;
            if(!el || !document.contains(el) || isFieldLocked(el)) continue;
            const targetLower = (step.target || "").toLowerCase();
            if(matchFieldRole(targetLower,"ORIGIN")      && field.role === "ORIGIN")      return el;
            if(matchFieldRole(targetLower,"DESTINATION") && field.role === "DESTINATION") return el;
            if((matchFieldRole(targetLower,"DATE") || targetLower.includes("depart")) && field.role === "DATE") return el;
            if(matchFieldRole(targetLower,"RETURN_DATE") && field.role === "RETURN_DATE") return el;
            if(matchFieldRole(targetLower,"PASSENGERS")  && field.role === "PASSENGERS")  return el;
        }
        for(const btn of form.buttons || []){
            const el = btn.element;
            if(!el || !document.contains(el) || isFieldLocked(el)) continue;
            if((step.target||"").toLowerCase().includes("search") && btn.role === "SEARCH_BUTTON") return el;
        }
    }

    // Step 8 — CLASSIC FORM ENGINE
    const forms = getForms();
    for(const form of forms){
        for(const field of form.fields){
            const el = field.element;
            if(!el || !document.contains(el) || isFieldLocked(el)) continue;
            if(step.action === "type" && field.role === "TEXT_INPUT"){
                const text = (el.placeholder||"") + (el.name||"") + (el.id||"") + (el.innerText||"");
                if(text.toLowerCase().includes((step.target||"").toLowerCase())) return el;
            }
            if(step.action === "click" && field.role === "BUTTON") return el;
        }
    }

    // Step 9 — CLOSEST MATCH FALLBACK
    // ✅ UPDATED: never returns null silently — always attaches a fallback
    //    suggestion so the feedback loop can ask "Did you mean X?" instead of
    //    skipping the step or looping on empty candidates.
    const closest = findClosestCandidates(step, 3);
    if (closest.length > 0 && closest[0].score > 5) {
        // ✅ FIX 4: skip any rejected element in the fallback list
        const bestGuess = closest.find(c => !isRejectedElement(c.element))?.element;
        if (!bestGuess) {
            console.warn("[MATCHER] all closest candidates are rejected for:", step.target);
            return null;
        }
        const guessLabel = closest.find(c => c.element === bestGuess)?.label || step.target;
        console.log("[CLOSEST MATCH FALLBACK] score:", closest[0].score, "label:", guessLabel, bestGuess);
        step._closestFallback      = bestGuess;
        step._closestFallbackLabel = guessLabel;
        step._closestFallbackScore = closest[0].score;
    } else {
        console.warn("[MATCHER] No candidates found at all for:", step.target,
            "— semantic nodes total:", getSemanticNodes().length);
    }

    return null;
}