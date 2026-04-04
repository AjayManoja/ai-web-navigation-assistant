// ai/uiRoleClassifier.js
// ✅ UPDATED: Structure-first calendar_trigger detection for div/span elements,
//             classifyDateFieldByPosition broadened to catch div-based date pickers,
//             getElementPositionContext unchanged (already correct).

// ─── DATE PATTERN ─────────────────────────────────────────────────────────────
const _DATE_PATTERN_ROLE = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}[,\s]+\d{4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})\b/i;

const _DATE_CLASS_KW = [
    "date","calendar","datepicker","flatpickr","picker",
    "checkin","checkout","check-in","check-out",
    "departure","arrival","depart","return","travel"
];

function _hasDateClass(el){
    const cls = [...(el.classList||[])].join(" ").toLowerCase();
    return _DATE_CLASS_KW.some(k => cls.includes(k));
}

function _hasDateDataAttr(el){
    return ["data-date","data-datepicker","data-flatpickr","data-toggle","data-value"]
        .some(a => el.hasAttribute(a));
}

function _hasSiblingCalendarIcon(el){
    const parent = el.parentElement;
    if (!parent) return false;
    return !!(parent.querySelector(
        "svg, .icon-calendar, .fa-calendar, [data-icon='calendar']," +
        "[class*='calendar' i], [class*='icon-date' i]"
    ));
}

function _showsFormattedDate(el){
    const text = (el.innerText || el.textContent || el.value || "").trim();
    return _DATE_PATTERN_ROLE.test(text);
}

// ─── STRUCTURAL UI TYPE DETECTOR ─────────────────────────────────────────────
// ✅ UPDATED: Structure-first block for div/span/li/a.
//    These elements are classified as calendar_trigger purely from their
//    DOM structure (formatted date text, date class, calendar icon, data-attr)
//    — no label text needed. This is the key fix for Skyscanner-style pickers.
function detectElementRole(element) {
    if (!element) return "UNKNOWN";

    const tag     = element.tagName.toLowerCase();
    const type    = (element.type || "").toLowerCase();
    const role    = (element.getAttribute("role") || "").toLowerCase();
    const classList = [...(element.classList || [])].join(" ").toLowerCase();

    // ── 1. Native date inputs ──────────────────────────────────────────────
    if (tag === "input" && ["date","datetime-local","month","week"].includes(type))
        return "date_picker";

    // ── 2. ✅ Structure-first: div/span/li/a calendar trigger ───────────────
    //    Runs BEFORE any label/text check — these elements carry no label on
    //    travel sites but are unambiguously date pickers structurally.
    if (["div","span","li","a"].includes(tag)) {
        if (_showsFormattedDate(element))    return "calendar_trigger";
        if (_hasDateClass(element))          return "calendar_trigger";
        if (_hasDateDataAttr(element))       return "calendar_trigger";
        if (_hasSiblingCalendarIcon(element)) return "calendar_trigger";
    }

    // ── 3. Readonly input — calendar trigger detection ──────────────────────
    const dataAttrs    = _hasDateDataAttr(element);
    const hasDateClass = _hasDateClass(element);
    const isReadonly   = tag === "input" && element.readOnly;
    const parentText   = (element.closest("div,section,label,fieldset")?.innerText || "").toLowerCase();
    const parentHasDateHint = _DATE_CLASS_KW.some(k => parentText.includes(k));
    const hasSvgCal    = _hasSiblingCalendarIcon(element);

    if (dataAttrs || hasDateClass || (isReadonly && parentHasDateHint) || hasSvgCal)
        return "calendar_trigger";

    // ── 4. Input with formatted date value ─────────────────────────────────
    if (tag === "input" && _showsFormattedDate(element))
        return "calendar_trigger";

    // ── 5. Combobox / autocomplete ─────────────────────────────────────────
    if (
        role === "combobox" || role === "listbox" ||
        element.getAttribute("autocomplete") === "off" ||
        element.getAttribute("aria-autocomplete") === "list" ||
        classList.includes("autocomplete") ||
        classList.includes("typeahead")    ||
        classList.includes("combobox")
    ) return "search_select";

    // ── 6. Counter / stepper ───────────────────────────────────────────────
    const parent = element.parentElement;
    const isCounter =
        (tag === "input" && type === "number") ||
        (tag === "input" && classList.includes("counter")) ||
        (parent && parent.querySelector(
            'button[aria-label*="increase"],button[aria-label*="decrease"],' +
            'button[aria-label*="add"],button[aria-label*="remove"],' +
            'button[aria-label*="+"],button[aria-label*="-"]'
        ));
    if (isCounter) return "counter";

    // ── 7. Standard roles ──────────────────────────────────────────────────
    if (tag === "select") return "dropdown";
    if (tag === "textarea") return "text_input";

    if (tag === "input") {
        if (type === "checkbox") return "checkbox";
        if (type === "radio")    return "radio";
        return "text_input";
    }

    if (tag === "button" || role === "button") return "button";

    return "UNKNOWN";
}

// ─── POSITIONAL CONTEXT EXTRACTOR ────────────────────────────────────────────
// Returns spatial metadata: screen quadrant + nearest text neighbours.
// Used by scoreCandidate for "right of To" / "left of Search" matching.
function getElementPositionContext(element) {
    if (!element) return null;

    const rect = element.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;

    const vw = window.innerWidth  || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;

    const quadrant = {
        horizontal: cx < vw * 0.4 ? "left" : cx > vw * 0.6 ? "right" : "center",
        vertical:   cy < vh * 0.4 ? "top"  : cy > vh * 0.6 ? "bottom" : "middle",
    };

    const textNodes = [...document.querySelectorAll(
        "label, span, p, strong, h1, h2, h3, div"
    )].filter(n => {
        if (n.closest("#webguide-assistant")) return false;
        const style = window.getComputedStyle(n);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0 &&
               (n.innerText || "").trim().length > 0 &&
               (n.innerText || "").trim().length < 60;
    });

    let nearestLeft  = null, nearestRight  = null;
    let nearestAbove = null, nearestBelow  = null;
    let distLeft = Infinity, distRight = Infinity;
    let distAbove = Infinity, distBelow = Infinity;

    textNodes.forEach(n => {
        const nr   = n.getBoundingClientRect();
        const ncx  = nr.left + nr.width  / 2;
        const ncy  = nr.top  + nr.height / 2;
        const dist = Math.sqrt((cx - ncx)**2 + (cy - ncy)**2);
        if (dist < 5) return;
        const text = (n.innerText || "").trim();
        if (ncx < cx && dist < distLeft)  { distLeft  = dist; nearestLeft  = text; }
        if (ncx > cx && dist < distRight) { distRight = dist; nearestRight = text; }
        if (ncy < cy && dist < distAbove) { distAbove = dist; nearestAbove = text; }
        if (ncy > cy && dist < distBelow) { distBelow = dist; nearestBelow = text; }
    });

    return {
        quadrant,
        nearestLeft:  nearestLeft  || null,
        nearestRight: nearestRight || null,
        nearestAbove: nearestAbove || null,
        nearestBelow: nearestBelow || null,
        x: Math.round(cx),
        y: Math.round(cy),
    };
}

// ─── DATE FIELD POSITION CLASSIFIER ──────────────────────────────────────────
// Leftmost date field = DEPART_DATE. Rightmost = RETURN_DATE.
// ✅ UPDATED: selector list broadened to catch div/span-based date pickers
//    (Skyscanner, Google Flights, etc.) that don't use <input type="date">.
function classifyDateFieldByPosition(element) {
    if (!element) return "DATE";

    // ✅ BROADENED: includes div/span with date class names and data-* attrs
    const dateSelectors = [
        "input[type='date']",
        "input[type='text'][readonly]",
        "[class*='date' i]",
        "[class*='calendar' i]",
        "[class*='checkin' i]",
        "[class*='checkout' i]",
        "[class*='departure' i]",
        "[class*='depart' i]",
        "[class*='arrival' i]",
        "[class*='picker' i]",
        "[data-date]",
        "[data-datepicker]",
        "[data-flatpickr]",
    ].join(",");

    const allDateEls = [];
    try {
        document.querySelectorAll(dateSelectors).forEach(el => {
            if (!document.body.contains(el)) return;
            if (el.closest("#webguide-assistant")) return;
            const s = window.getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden") return;
            const r = el.getBoundingClientRect();
            // ✅ LOWERED threshold to 10px to match domCache filter
            if (r.width < 10 || r.height < 10) return;
            allDateEls.push({ el, x: r.left, y: r.top });
        });
    } catch(e) { return "DATE"; }

    if (allDateEls.length < 2) return "DATE";

    // Sort left → right (then top → bottom for ties within 20px vertical band)
    allDateEls.sort((a,b) => Math.abs(a.y - b.y) < 20 ? a.x - b.x : a.y - b.y);

    const thisRect = element.getBoundingClientRect();
    const idx = allDateEls.findIndex(d =>
        d.el === element ||
        (Math.abs(d.x - thisRect.left) < 5 && Math.abs(d.y - thisRect.top) < 5)
    );

    if (idx === 0) return "DEPART_DATE";
    if (idx >= 1)  return "RETURN_DATE";
    return "DATE";
}

// ─── LEGACY classifyElementRole (backward compat) ────────────────────────────
function classifyElementRole(element){
    const tag  = element.tagName.toLowerCase();
    const type = (element.type || "").toLowerCase();
    const role = (element.getAttribute("role") || "").toLowerCase();
    const text = (
        element.placeholder || element.name || element.id ||
        element.innerText   || element.getAttribute("aria-label") || ""
    ).toLowerCase();

    const structural = detectElementRole(element);
    if (structural === "date_picker"      || structural === "calendar_trigger") return "DATE_PICKER";
    if (structural === "search_select")   return "SEARCH_INPUT";
    if (structural === "counter")         return "COUNTER";
    if (structural === "dropdown")        return "DROPDOWN";

    if(tag === "input"){
        if(type === "date")      return "DATE_PICKER";
        if(type === "checkbox")  return "CHECKBOX";
        if(type === "radio")     return "RADIO";
        if(text.includes("search")) return "SEARCH_INPUT";
        return "TEXT_INPUT";
    }
    if(tag === "select")   return "DROPDOWN";
    if(tag === "textarea") return "TEXT_INPUT";
    if(tag === "button"){
        if(text.includes("search")) return "SEARCH_BUTTON";
        if(text.includes("submit")) return "SUBMIT_BUTTON";
        return "BUTTON";
    }
    if(role === "button") return "BUTTON";
    return "UNKNOWN";
}