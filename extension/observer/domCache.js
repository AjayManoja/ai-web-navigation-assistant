// observer/domCache.js
// ✅ UPDATED: Full candidate discovery including div/span date pickers,
//             structure-based calendar_trigger detection, positionContext
//             attachment, and lowered size filter (10px instead of 20px).

let cachedElements = [];
let semanticNodes  = [];

function getSemanticNodes(){ return semanticNodes; }

// ─── VISIBILITY ───────────────────────────────────────────────────────────────
function isVisible(el){
  const style = window.getComputedStyle(el);
  return (
    style.display     !== "none"   &&
    style.visibility  !== "hidden" &&
    style.opacity     !== "0"      &&
    el.offsetParent   !== null
  );
}

function isInsideDropdown(el){
  return el.closest('[role="listbox"],[role="menu"],[role="dialog"],[role="option"],.autocomplete,.suggestions');
}

function isValidInput(el){
  if(el.tagName !== "INPUT") return true;
  const type = (el.type || "").toLowerCase();
  return !["checkbox","radio","hidden","submit","reset","file"].includes(type);
}

// ─── DATE PATTERN HELPERS ─────────────────────────────────────────────────────
// Matches formatted dates like 14/04/2026, 2026-04-14, Apr 14 2026, etc.
const DATE_PATTERN = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}[,\s]+\d{4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})\b/i;

const DATE_CLASS_KEYWORDS = [
  "date","calendar","datepicker","flatpickr","picker",
  "checkin","checkout","check-in","check-out",
  "departure","arrival","depart","return","travel"
];

function hasDateClass(el){
  const cls = [...(el.classList || [])].join(" ").toLowerCase();
  return DATE_CLASS_KEYWORDS.some(k => cls.includes(k));
}

function hasDateDataAttr(el){
  return ["data-date","data-datepicker","data-flatpickr","data-toggle","data-value"].some(a => el.hasAttribute(a));
}

function hasSiblingCalendarIcon(el){
  const parent = el.parentElement;
  if(!parent) return false;
  return !!(
    parent.querySelector("svg, .icon-calendar, .fa-calendar, [data-icon='calendar'], [class*='calendar' i], [class*='icon-date' i]")
  );
}

function elementShowsFormattedDate(el){
  const text = (el.innerText || el.textContent || el.value || "").trim();
  // ✅ FIX 5: cap at 30 chars — prevents long text blocks (paragraphs, banners)
  //    triggering date detection on a stray date mention inside them
  return DATE_PATTERN.test(text) && text.length < 30;
}

// ─── LABEL RESOLUTION ────────────────────────────────────────────────────────
function extractLabel(el){
  if(el.id){
    const label = document.querySelector(`label[for="${el.id}"]`);
    if(label) return label.innerText.trim();
  }
  if(el.parentElement){
    const parentText = el.parentElement.innerText;
    if(parentText && parentText.length < 80) return parentText.trim();
  }
  return "";
}

function resolveLabel(el){
  const labelledBy = el.getAttribute("aria-labelledby");
  if(labelledBy){
    const labelEl = document.getElementById(labelledBy);
    if(labelEl) return labelEl.innerText.trim();
  }
  const ariaLabel = el.getAttribute("aria-label");
  if(ariaLabel) return ariaLabel.trim();
  if(el.id){
    const label = document.querySelector(`label[for="${el.id}"]`);
    if(label) return label.innerText.trim();
  }
  if(el.placeholder) return el.placeholder.trim();
  const legend = el.closest("fieldset")?.querySelector("legend");
  if(legend) return legend.innerText.trim();

  let sibling = el.previousElementSibling;
  while(sibling){
    const tag = sibling.tagName.toLowerCase();
    if(["h1","h2","h3","h4","label","span","p","strong"].includes(tag)){
      const text = sibling.innerText.trim();
      if(text && text.length < 60) return text;
    }
    sibling = sibling.previousElementSibling;
  }
  const parent = el.closest("div, section, form");
  if(parent){
    const text = parent.innerText.trim();
    if(text && text.length < 60) return text;
  }
  return "";
}

function getContainerText(el){
  const container = el.closest("form, section, div");
  if(container) return (container.innerText || "").slice(0,120);
  return "";
}

function getPosition(el){
  const rect = el.getBoundingClientRect();
  return { x: rect.x, y: rect.y };
}

// ─── NEARBY TEXT ─────────────────────────────────────────────────────────────
function findNearbyText(el){
  const texts = [];
  const rect  = el.getBoundingClientRect();
  document.querySelectorAll("label,span,p,strong,div").forEach(node => {
    if(node.closest("#webguide-assistant")) return;
    const text = (node.innerText || "").trim();
    if(!text || text.length > 80) return;
    const r    = node.getBoundingClientRect();
    const dist = Math.sqrt((r.x-rect.x)**2 + (r.y-rect.y)**2);
    if(dist < 250) texts.push(text); // ✅ FIX 7: increased from 200 → 250 for better spatial context
  });
  return texts;
}

function findNeighborElements(el){
  const neighbors = [];
  const rect = el.getBoundingClientRect();
  document.querySelectorAll("input,textarea,select,button,[role='button']").forEach(other => {
    if(other === el) return;
    const r    = other.getBoundingClientRect();
    const dist = Math.sqrt((r.x-rect.x)**2 + (r.y-rect.y)**2);
    if(dist < 150) neighbors.push(other);
  });
  return neighbors;
}

// ─── STRUCTURAL ROLE DETECTION ───────────────────────────────────────────────
// ✅ UPDATED: Structure-based calendar_trigger detection.
//    A div/span is a calendar_trigger even without a label if it:
//      • shows a formatted date text, OR
//      • has a date-related CSS class, OR
//      • has a sibling calendar icon, OR
//      • has a data-date / data-datepicker attribute.
//    This fires BEFORE any text/label check so Skyscanner-style date boxes
//    are never missed.
function detectElementRole(el){
  const tag         = el.tagName.toLowerCase();
  const type        = (el.type  || "").toLowerCase();
  const role        = (el.getAttribute("role") || "").toLowerCase();
  const placeholder = (el.placeholder || "").toLowerCase();
  const aria        = (el.getAttribute("aria-label") || "").toLowerCase();
  const text        = (placeholder + " " + aria + " " + (el.innerText || "")).toLowerCase();

  // ── 1. Native date inputs ──────────────────────────────────────────────────
  if(tag === "input" && ["date","datetime-local","month","week"].includes(type))
    return "date_picker";

  // ── 2. Div/span structural calendar trigger (NO label needed) ─────────────
  if(["div","span","li","a"].includes(tag)){
    if(elementShowsFormattedDate(el))  return "calendar_trigger";
    if(hasDateClass(el))               return "calendar_trigger";
    if(hasDateDataAttr(el))            return "calendar_trigger";
    if(hasSiblingCalendarIcon(el))     return "calendar_trigger";
    // ✅ FIX 4: weak generic divs get no further classification — stops
    //    banners, headers, and nav links from entering the matching pipeline
    return "generic";
  }

  // ── 3. Readonly input inside a date-hinted container ──────────────────────
  if(tag === "input" && el.readOnly){
    const parentText = (el.closest("div,section,label,fieldset")?.innerText || "").toLowerCase();
    if(DATE_CLASS_KEYWORDS.some(k => parentText.includes(k))) return "calendar_trigger";
    if(hasSiblingCalendarIcon(el))     return "calendar_trigger";
    if(elementShowsFormattedDate(el))  return "calendar_trigger";
  }

  // ── 4. Input with date class / data attribute ─────────────────────────────
  if(tag === "input" && (hasDateClass(el) || hasDateDataAttr(el)))
    return "calendar_trigger";

  // ── 5. Combobox / autocomplete ────────────────────────────────────────────
  if(["combobox","listbox"].includes(role) ||
     el.getAttribute("autocomplete") === "off" ||
     el.getAttribute("aria-autocomplete") === "list")
    return "search_select";

  // ── 6. Counter / stepper ─────────────────────────────────────────────────
  const parent = el.parentElement;
  const isCounter =
    (tag === "input" && type === "number") ||
    (parent && parent.querySelector(
      'button[aria-label*="increase"],button[aria-label*="decrease"],' +
      'button[aria-label*="add"],button[aria-label*="remove"],' +
      'button[aria-label*="+"],button[aria-label*="-"]'
    ));
  if(isCounter) return "counter";

  // ── 7. Standard roles ─────────────────────────────────────────────────────
  if(tag === "select" || role === "combobox")       return "dropdown";
  if(type === "search" || placeholder.includes("search") || aria.includes("search"))
                                                     return "search_input";
  if(text.includes("date") || text.includes("depart") || text.includes("return"))
                                                     return "date_picker";
  if(tag === "input" && ["text","email","number","password"].includes(type))
                                                     return "text_input";
  if(type === "checkbox")                            return "checkbox";
  if(type === "radio")                               return "radio";
  if(tag === "button" || role === "button" || tag === "a") return "button";
  if(tag === "textarea" || el.getAttribute("contenteditable") === "true")
                                                     return "text_input";
  return "generic";
}

// ─── FIELD INPUT TYPE ────────────────────────────────────────────────────────
// ✅ UPDATED: Structure-first classification — formatted date text and
//    calendar icon checks happen BEFORE any label/text scan.
function detectFieldInputType(el){
  const tag  = el.tagName.toLowerCase();
  const type = (el.type  || "").toLowerCase();
  const role = (el.getAttribute("role") || "").toLowerCase();

  // ── Structure-first: formatted date content always = calendar_trigger ──
  if(elementShowsFormattedDate(el))  return "calendar_trigger";
  if(hasDateDataAttr(el))            return "calendar_trigger";
  if(hasSiblingCalendarIcon(el))     return "calendar_trigger";
  if(hasDateClass(el))               return "calendar_trigger";

  const label = (
    (el.getAttribute("aria-label") || "") + " " +
    (el.placeholder || "")                + " " +
    (el.innerText   || "")                + " " +
    (resolveLabel(el) || "")
  ).toLowerCase();

  // ── Native real inputs ───────────────────────────────────────────────────
  if(tag === "input" && !["button","submit","reset","image"].includes(type)){
    if(type === "date") return "date";
    return "real";
  }
  if(tag === "textarea")                              return "real";
  if(el.getAttribute("contenteditable") === "true")  return "real";

  // ── Label-based calendar trigger (fallback) ──────────────────────────────
  const calendarLabelKw = [
    "depart","travel date","check-in","checkin",
    "check out","checkout","return date","onward date"
  ];
  if(calendarLabelKw.some(k => label.includes(k)))   return "calendar_trigger";

  // ── Fake fields (div/span/li acting as inputs) ───────────────────────────
  if(["combobox","textbox","searchbox"].includes(role)) return "fake";
  if(["div","span","li"].includes(tag))               return "fake";

  // ── Buttons opening search panels ────────────────────────────────────────
  if(tag === "button" && (
    label.includes("from")   || label.includes("to")          ||
    label.includes("origin") || label.includes("destination") ||
    label.includes("city")   || label.includes("airport")     || label.includes("station")
  )) return "fake";

  return "real";
}

// ─── ACTIVE SECTION ──────────────────────────────────────────────────────────
function getActiveSection(){
  const activeCandidates = [
    ...document.querySelectorAll('[aria-selected="true"]'),
    ...document.querySelectorAll('.active[role="tab"]'),
    ...document.querySelectorAll('.selected[role="tab"]'),
    ...document.querySelectorAll('li.active'),
    ...document.querySelectorAll('button.active')
  ];
  for(const el of activeCandidates){
    const text = (el.innerText || "").trim().toLowerCase();
    if(text) return text;
  }
  return "unknown";
}

// ─── FORM GROUP DETECTION ─────────────────────────────────────────────────────
function detectFormGroups(){
  const groups   = [];
  const containers = [
    ...document.querySelectorAll("form"),
    ...document.querySelectorAll('[role="search"]'),
    ...document.querySelectorAll(".search-form,.booking-form,.search-widget")
  ];
  const seen = new Set();
  const uniqueContainers = containers.filter(c => {
    if(seen.has(c)) return false; seen.add(c); return true;
  });

  uniqueContainers.forEach((container, groupIndex) => {
    const fields = [];

    // ✅ EXPANDED: include date-like divs/spans in form group scan
    const interactives = container.querySelectorAll(
      'input, textarea, select, button,' +
      '[role="combobox"],[role="button"],[contenteditable="true"],' +
      '[class*="date" i],[class*="calendar" i],[class*="depart" i],' +
      '[class*="checkin" i],[class*="checkout" i],[class*="picker" i],' +
      '[data-date],[data-datepicker],[data-flatpickr]'
    );

    interactives.forEach(el => {
      if(!isVisible(el))                       return;
      if(el.closest("#webguide-assistant"))    return;
      if(!isValidInput(el))                    return;
      const rect = el.getBoundingClientRect();
      // ✅ LOWERED size filter from 20→10 so small date boxes aren't excluded
      if(rect.width < 10 || rect.height < 10)  return;

      const resolvedLabel = resolveLabel(el);
      const role          = detectElementRole(el);
      const inputType     = detectFieldInputType(el);

      let fieldName = "unknown";
      const combined = resolvedLabel.toLowerCase() + " " + (el.placeholder || "").toLowerCase()
                       + " " + (el.getAttribute("aria-label") || "").toLowerCase();

      if(combined.includes("from") || combined.includes("origin") || combined.includes("departure") || combined.includes("source"))
        fieldName = "ORIGIN";
      else if(combined.includes("to") || combined.includes("destination") || combined.includes("arrival"))
        fieldName = "DESTINATION";
      else if((combined.includes("depart") && combined.includes("date")) || combined.includes("travel date") || combined.includes("check-in") || combined.includes("checkin"))
        fieldName = "DATE";
      else if(combined.includes("return") || combined.includes("check-out") || combined.includes("checkout"))
        fieldName = "RETURN_DATE";
      else if(combined.includes("passenger") || combined.includes("traveller") || combined.includes("guest") || combined.includes("people"))
        fieldName = "PASSENGERS";
      else if(combined.includes("search") || (el.tagName === "BUTTON" && combined.includes("search")))
        fieldName = "SEARCH";
      else if(role === "button")
        fieldName = "BUTTON_" + (resolvedLabel || el.innerText || "").slice(0,20).toUpperCase().replace(/\s/g,"_");
      // ✅ NEW: if role resolved to a date type, mark it even without label text
      else if(role === "calendar_trigger" || role === "date_picker")
        fieldName = "DATE";

      fields.push({
        element: el, fieldName, role, resolvedLabel,
        placeholder: el.placeholder || "",
        ariaLabel: el.getAttribute("aria-label") || "",
        visible: isVisible(el),
        tag: el.tagName.toLowerCase(),
        index: semanticNodes.findIndex(n => n.element === el),
        inputType
      });
    });

    if(fields.length >= 2) groups.push({ groupIndex, container, fields, fieldCount: fields.length });
  });

  return groups;
}

// ─── RICH SNAPSHOT ────────────────────────────────────────────────────────────
function buildRichSnapshot(){
  const domain        = window.location.hostname;
  const activeSection = getActiveSection();
  const formGroups    = detectFormGroups();

  const confirmedFields  = [];
  const missingFieldNames = ["ORIGIN","DESTINATION","DATE","RETURN_DATE","PASSENGERS","SEARCH"];
  const foundFieldNames   = new Set();

  formGroups.forEach(group => {
    group.fields.forEach(field => {
      if(field.visible){
        confirmedFields.push({
          fieldName: field.fieldName, role: field.role, tag: field.tag,
          resolvedLabel: field.resolvedLabel, placeholder: field.placeholder,
          ariaLabel: field.ariaLabel, snapshotIndex: field.index,
          inputType: field.inputType
        });
        foundFieldNames.add(field.fieldName);
      }
    });
  });

  const missingFields = missingFieldNames.filter(n => !foundFieldNames.has(n));

  const snapshot = {
    domain, url: window.location.href, title: document.title,
    activeSection,
    formGroups: formGroups.map(g => ({
      groupIndex: g.groupIndex, fieldCount: g.fieldCount,
      fields: g.fields.map(f => ({
        fieldName: f.fieldName, role: f.role, tag: f.tag,
        resolvedLabel: f.resolvedLabel, placeholder: f.placeholder,
        ariaLabel: f.ariaLabel, visible: f.visible,
        snapshotIndex: f.index, inputType: f.inputType
      }))
    })),
    confirmedFields, missingFields
  };

  console.log("[RICH SNAPSHOT]", snapshot);
  return snapshot;
}

// ─── RELATIVE POSITION CONTEXT (FIX 3) ───────────────────────────────────────
// Returns labels of the nearest element to the left and right on the same row.
// Used by elementMatcher to understand "right of To" / "left of Return" clues.
function getRelativePositionContext(el){
  const rect = el.getBoundingClientRect();
  const all  = document.querySelectorAll("input, div, span, button");
  let left = null, right = null;

  all.forEach(other => {
    if (other === el) return;
    if (other.closest("#webguide-assistant")) return;
    const r = other.getBoundingClientRect();
    if (Math.abs(r.top - rect.top) < 40) {
      if (r.left < rect.left) {
        if (!left  || r.left > left.rect.left)  left  = { el: other, rect: r };
      } else {
        if (!right || r.left < right.rect.left) right = { el: other, rect: r };
      }
    }
  });

  return {
    leftLabel:  (left?.el?.innerText  || left?.el?.getAttribute("aria-label")  || "").trim().slice(0, 40),
    rightLabel: (right?.el?.innerText || right?.el?.getAttribute("aria-label") || "").trim().slice(0, 40)
  };
}

// ─── SEMANTIC NODE FACTORIES ──────────────────────────────────────────────────
function createSemanticElement(el){
  return {
    element: el, roleType: detectElementRole(el), label: extractLabel(el),
    placeholder: el.placeholder || "", ariaLabel: el.getAttribute("aria-label") || "",
    containerText: getContainerText(el)
  };
}

function createSemanticNode(el, index){
  let positionContext = null;
  if(typeof getElementPositionContext === "function"){
    positionContext = getElementPositionContext(el);
  }

  // ✅ FIX 1: compute date confidence so scorer can prefer strong date elements
  const showsDate = elementShowsFormattedDate(el);
  const hasIcon   = hasSiblingCalendarIcon(el);
  const hasClass  = hasDateClass(el);
  let dateConfidence = 0;
  if (showsDate) dateConfidence += 2;
  if (hasIcon)   dateConfidence += 1;
  if (hasClass)  dateConfidence += 1;

  // ✅ FIX 3: relative position context for left/right neighbour label resolution
  const relativePosition = getRelativePositionContext(el);

  return {
    id: index, element: el, tag: el.tagName.toLowerCase(),
    role: detectElementRole(el), label: resolveLabel(el),
    placeholder: el.placeholder || "", ariaLabel: el.getAttribute("aria-label") || "",
    containerText: getContainerText(el), nearbyText: findNearbyText(el),
    neighbors: [], position: getPosition(el), visible: isVisible(el),
    inputType: detectFieldInputType(el),
    positionContext,
    dateConfidence,   // ✅ FIX 1
    relativePosition  // ✅ FIX 3
  };
}

function removeDuplicateElements(elements){
  const seen = new Set();
  return elements.filter(el => {
    const key = (el.innerText || "") + (el.placeholder || "") + (el.id || "");
    if(seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// ─── MAIN SCAN ────────────────────────────────────────────────────────────────
// ✅ UPDATED: scanPageElements now collects div/span/li date-like elements
//    in addition to the standard interactive elements.
//    Size filter lowered from 20px → 10px.
function scanPageElements(){
  // Standard interactive elements
  let elements = [
    ...document.querySelectorAll("input"),
    ...document.querySelectorAll("textarea"),
    ...document.querySelectorAll("select"),
    ...document.querySelectorAll("button"),
    ...document.querySelectorAll("[role='button']"),
    ...document.querySelectorAll("[role='combobox']"),
    ...document.querySelectorAll("[role='option']"),
    ...document.querySelectorAll("[contenteditable='true']"),
  ];

  // ✅ NEW: Structural date-like div/span elements that standard selectors miss
  const dateStructuralEls = [
    ...document.querySelectorAll("[class*='date' i]"),
    ...document.querySelectorAll("[class*='calendar' i]"),
    ...document.querySelectorAll("[class*='depart' i]"),
    ...document.querySelectorAll("[class*='checkin' i]"),
    ...document.querySelectorAll("[class*='checkout' i]"),
    ...document.querySelectorAll("[class*='picker' i]"),
    ...document.querySelectorAll("[data-date]"),
    ...document.querySelectorAll("[data-datepicker]"),
    ...document.querySelectorAll("[data-flatpickr]"),
  ].filter(el => {
    const tag = el.tagName.toLowerCase();
    // Only include non-standard tags — standard ones already captured above
    return ["div","span","li","a"].includes(tag);
  });

  elements = [...elements, ...dateStructuralEls];
  elements = removeDuplicateElements(elements);

  // ✅ LOWERED size filter: 10px instead of 20px
  const sizeFilter = el => {
    const rect = el.getBoundingClientRect();
    return rect.width >= 10 && rect.height >= 10;
  };

  // ✅ FIX 2: filter out generic action buttons early — "Search now" / "Submit"
  //    buttons were winning the scoring pipeline before date fields could compete
  const genericButtonFilter = el => {
    if (el.tagName !== "BUTTON") return true;
    const text = (el.innerText || "").toLowerCase().trim();
    if (text === "search" || text.startsWith("search ")) return false;
    if (text === "submit" || text.startsWith("submit ")) return false;
    return true;
  };

  cachedElements = elements
    .filter(el => isVisible(el))
    .filter(el => !el.closest("#webguide-assistant"))
    .filter(sizeFilter)
    .filter(el => isValidInput(el))
    .filter(genericButtonFilter) // ✅ FIX 2
    .map(createSemanticElement);

  semanticNodes = [];
  elements
    .filter(el => isVisible(el))
    .filter(el => !el.closest("#webguide-assistant"))
    .filter(sizeFilter)
    .filter(genericButtonFilter) // ✅ FIX 2
    .forEach((el, index) => semanticNodes.push(createSemanticNode(el, index)));

  connectNodeNeighbors();
  buildElementGraph();

  // ✅ FIX 6: float calendar_trigger nodes to front — matcher encounters date
  //    fields before generic elements so position-based tiebreaks work correctly
  semanticNodes.sort((a, b) => {
    if (a.role === "calendar_trigger" && b.role !== "calendar_trigger") return -1;
    if (b.role === "calendar_trigger" && a.role !== "calendar_trigger") return 1;
    return 0;
  });

  console.log("[domCache] Legacy cachedElements:", cachedElements.length);
  console.log("[domCache] Semantic Nodes:", semanticNodes.length,
    "— date/calendar nodes:",
    semanticNodes.filter(n => n.role === "calendar_trigger" || n.role === "date_picker").length
  );
}

function getCachedElements(){ return cachedElements; }

// ─── ELEMENT GRAPH ────────────────────────────────────────────────────────────
let elementGraph = [];

function buildElementGraph(){
  elementGraph = [];
  getSemanticNodes().forEach(item => {
    const el = item.element;
    if(!el || !document.contains(el)) return;
    elementGraph.push({
      element: el, role: item.role, label: item.label,
      placeholder: item.placeholder, ariaLabel: item.ariaLabel,
      containerText: item.containerText, nearbyText: findNearbyText(el),
      neighbors: findNeighborElements(el),
      positionContext: item.positionContext  // ✅ NEW: carry through to graph
    });
  });
}

function connectNodeNeighbors(){
  semanticNodes.forEach(node => {
    const rect = node.element.getBoundingClientRect();
    node.neighbors = semanticNodes
      .filter(other => other !== node)
      .filter(other => {
        const r = other.element.getBoundingClientRect();
        return Math.sqrt((r.x-rect.x)**2 + (r.y-rect.y)**2) < 150;
      })
      .map(other => other.id);
  });
}

function getElementGraph(){ return elementGraph; }

// ─── buildDOMGraph (legacy) ───────────────────────────────────────────────────
function buildDOMGraph(){
  const graph  = [];
  const inputs = document.querySelectorAll("input, textarea, select");
  inputs.forEach(input => {
    const node  = { element: input, label: null, nearText: null, containerText: null };
    const label = document.querySelector(`label[for="${input.id}"]`);
    if(label) node.label = label.innerText.trim();
    const parent = input.closest("div, section, form");
    if(parent) node.containerText = parent.innerText.slice(0,120);
    graph.push(node);
  });
  return graph;
}

// ─── SEMANTIC DOM EXPORT ─────────────────────────────────────────────────────
function getSemanticDOM(){
  return semanticNodes.map(node => ({
    id: node.id, role: node.role, label: node.label,
    placeholder: node.placeholder, ariaLabel: node.ariaLabel,
    containerText: node.containerText, nearbyText: node.nearbyText,
    neighbors: node.neighbors, inputType: node.inputType,
    positionContext: node.positionContext  // ✅ NEW
  }));
}

// ─── GLOBAL EXPORTS ───────────────────────────────────────────────────────────
window.getSemanticNodes      = getSemanticNodes;
window.getSemanticDOM        = getSemanticDOM;
window.buildRichSnapshot     = buildRichSnapshot;
window.detectFormGroups      = detectFormGroups;
window.detectFieldInputType  = detectFieldInputType;
window.scanPageElements      = scanPageElements;
window.isVisible             = isVisible;