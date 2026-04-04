// observer/pageObserver.js
// ✅ UPDATED: extractPageContext now includes div/span date pickers in inputs,
//             size filter aligned to 10px to match domCache/executionController.

let scanTimeout = null;
let lastURL     = location.href;
let lastDOMSize = 0;

// ─── START OBSERVER ───────────────────────────────────────────────────────────
function startDOMObserver(){
    const observer = new MutationObserver((mutations) => {
        let significantChange = false;
        mutations.forEach(mutation => {
            if (mutation.addedNodes   && mutation.addedNodes.length   > 0) significantChange = true;
            if (mutation.removedNodes && mutation.removedNodes.length > 0) significantChange = true;
        });
        if (!significantChange) return;
        debouncedScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
        if (location.href !== lastURL) {
            console.log("URL changed → reinitializing context");
            lastURL = location.href;
            fullPageRescan();
        }
    }, 1000);
}

// ─── DEBOUNCE SCAN ────────────────────────────────────────────────────────────
function debouncedScan(){
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
        const domSize = document.body.innerHTML.length;
        if (Math.abs(domSize - lastDOMSize) < 500) return;
        lastDOMSize = domSize;
        console.log("DOM changed → rescanning");
        fullPageRescan();
    }, 400);
}

// ─── FULL PAGE RESCAN ─────────────────────────────────────────────────────────
function fullPageRescan(){
    try {
        if (typeof scanPageElements      === "function") scanPageElements();
        if (typeof detectUniversalForms  === "function") detectUniversalForms();
    } catch(err) {
        console.warn("Observer rescan error:", err);
    }
    tryAutoResume();
}

// ─── PAGE CONTEXT EXTRACTION ──────────────────────────────────────────────────
// ✅ UPDATED: inputs sweep now also picks up div/span calendar_trigger elements
//    so the context sent to the planner/server includes date pickers that are
//    not standard <input> tags.
function extractPageContext(){
    const context = {
        inputs:      [],
        buttons:     [],
        dropdowns:   [],
        labels:      [],
        visibleText: []
    };

    function isVisible(el){
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
    }

    function getText(el){
        return (
            el.innerText     ||
            el.value         ||
            el.placeholder   ||
            el.getAttribute("aria-label") || ""
        ).trim();
    }

    // ── INPUTS (standard + structural date pickers) ──────────────────────────
    // ✅ EXPANDED: includes div/span with date-class names alongside native inputs
    const inputSelectors =
        "input, textarea," +
        "[class*='date' i], [class*='calendar' i], [class*='depart' i]," +
        "[class*='checkin' i], [class*='checkout' i], [class*='picker' i]," +
        "[data-date], [data-datepicker], [data-flatpickr]";

    document.querySelectorAll(inputSelectors).forEach(input => {
        if (!isVisible(input)) return;
        // ✅ LOWERED size filter to 10px (aligned with domCache)
        const rect = input.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return;
        if (input.closest("#webguide-assistant")) return;

        let structuralRole = "text_input";
        if (typeof detectElementRole === "function") {
            structuralRole = detectElementRole(input);
        }

        let positionContext = null;
        if (typeof getElementPositionContext === "function") {
            positionContext = getElementPositionContext(input);
        }

        let resolvedLabel = input.placeholder || input.getAttribute("aria-label") || input.name || "";
        if (typeof resolveFieldLabel === "function") {
            resolvedLabel = resolveFieldLabel(input) || resolvedLabel;
        }

        context.inputs.push({
            type:           input.type || "text",
            placeholder:    input.placeholder || "",
            name:           input.name || "",
            id:             input.id || "",
            tag:            input.tagName.toLowerCase(),
            structuralRole,
            resolvedLabel,
            positionContext,
        });
    });

    // ── DROPDOWNS ─────────────────────────────────────────────────────────────
    document.querySelectorAll("select, [role='listbox'], [role='combobox']").forEach(drop => {
        if (!isVisible(drop)) return;
        context.dropdowns.push({ id: drop.id || "", name: drop.name || "", label: getText(drop) });
    });

    // ── BUTTONS ───────────────────────────────────────────────────────────────
    document.querySelectorAll(
        "button, [role='button'], input[type='submit'], input[type='button'], a"
    ).forEach(btn => {
        if (!isVisible(btn)) return;
        const text = getText(btn);
        if (!text) return;
        context.buttons.push({ text });
    });

    // ── LABELS ────────────────────────────────────────────────────────────────
    document.querySelectorAll("label").forEach(label => {
        if (!isVisible(label)) return;
        const text = label.innerText.trim();
        if (text) context.labels.push(text);
    });

    // ── VISIBLE TEXT ──────────────────────────────────────────────────────────
    document.querySelectorAll("h1, h2, h3, p, span, strong").forEach(node => {
        if (!isVisible(node)) return;
        const text = node.innerText.trim();
        if (text.length > 0 && text.length < 80) context.visibleText.push(text);
    });

    return context;
}

// ─── AUTO RESUME ──────────────────────────────────────────────────────────────
function tryAutoResume(){
    if (!window.sessionManager) return;
    const session = window.sessionManager.getSession();
    if (!session || session.status !== "running") return;

    console.log("🔁 Resuming agent:", session.goal);
    console.log("SESSION STATE:", session);

    if (window.__agentRunning) return;
    window.__agentRunning = true;
    setTimeout(() => { window.__agentRunning = false; }, 3000);

    if (typeof startExecution === "function") {
        console.log("🚀 REAL RESUME STARTING");
        if (window.__executionResumed) return;
        window.__executionResumed = true;
        if (session.lastPlan) {
            if (window.executionRunning) {
                console.log("⛔ Execution already running, skipping resume");
                return;
            }
            startExecution(session.lastPlan);
        }
    }
}