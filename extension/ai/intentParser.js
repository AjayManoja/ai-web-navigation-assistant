// ai/intentParser.js

// ─── SEMANTIC ALIAS MAP ───────────────────────────────────────────────────────
// Maps natural user phrases → canonical field keys + expected UI element type.
// DATE is now split into DEPART_DATE vs RETURN_DATE so similar fields are
// NEVER confused — position on screen is used to disambiguate when both exist.
const FIELD_SEMANTIC_ALIASES = {
  // Check-in / Check-out (hotel)
  "check in":       { fieldKey: "CHECKIN_DATE",  uiType: "date_picker" },
  "checkin":        { fieldKey: "CHECKIN_DATE",  uiType: "date_picker" },
  "check-in":       { fieldKey: "CHECKIN_DATE",  uiType: "date_picker" },
  "check out":      { fieldKey: "CHECKOUT_DATE", uiType: "date_picker" },
  "checkout":       { fieldKey: "CHECKOUT_DATE", uiType: "date_picker" },
  "check-out":      { fieldKey: "CHECKOUT_DATE", uiType: "date_picker" },

  // Departure date (always the FIRST / LEFT date on a travel form)
  "departure date": { fieldKey: "DEPART_DATE",   uiType: "date_picker" },
  "depart date":    { fieldKey: "DEPART_DATE",   uiType: "date_picker" },
  "departure":      { fieldKey: "DEPART_DATE",   uiType: "date_picker" },
  "depart":         { fieldKey: "DEPART_DATE",   uiType: "date_picker" },
  "outbound":       { fieldKey: "DEPART_DATE",   uiType: "date_picker" },
  "travel date":    { fieldKey: "DEPART_DATE",   uiType: "date_picker" },
  "start date":     { fieldKey: "DEPART_DATE",   uiType: "date_picker" },
  "onward date":    { fieldKey: "DEPART_DATE",   uiType: "date_picker" },
  "from date":      { fieldKey: "DEPART_DATE",   uiType: "date_picker" },
  "date":           { fieldKey: "DEPART_DATE",   uiType: "date_picker" },

  // Return date (always the SECOND / RIGHT date on a travel form)
  "return date":    { fieldKey: "RETURN_DATE",   uiType: "date_picker" },
  "return":         { fieldKey: "RETURN_DATE",   uiType: "date_picker" },
  "inbound":        { fieldKey: "RETURN_DATE",   uiType: "date_picker" },
  "back date":      { fieldKey: "RETURN_DATE",   uiType: "date_picker" },
  "end date":       { fieldKey: "RETURN_DATE",   uiType: "date_picker" },
  "come back":      { fieldKey: "RETURN_DATE",   uiType: "date_picker" },
  "coming back":    { fieldKey: "RETURN_DATE",   uiType: "date_picker" },

  // Location/search fields — autocomplete/combobox
  "from":           { fieldKey: "ORIGIN",        uiType: "search_select" },
  "origin":         { fieldKey: "ORIGIN",        uiType: "search_select" },
  "leaving from":   { fieldKey: "ORIGIN",        uiType: "search_select" },
  "flying from":    { fieldKey: "ORIGIN",        uiType: "search_select" },
  "depart from":    { fieldKey: "ORIGIN",        uiType: "search_select" },
  "source":         { fieldKey: "ORIGIN",        uiType: "search_select" },
  "to":             { fieldKey: "DESTINATION",   uiType: "search_select" },
  "destination":    { fieldKey: "DESTINATION",   uiType: "search_select" },
  "going to":       { fieldKey: "DESTINATION",   uiType: "search_select" },
  "arriving at":    { fieldKey: "DESTINATION",   uiType: "search_select" },
  "where":          { fieldKey: "DESTINATION",   uiType: "search_select" },
  "fly to":         { fieldKey: "DESTINATION",   uiType: "search_select" },

  // Counter / stepper fields
  "passengers":     { fieldKey: "PASSENGERS",    uiType: "counter" },
  "travellers":     { fieldKey: "PASSENGERS",    uiType: "counter" },
  "travelers":      { fieldKey: "PASSENGERS",    uiType: "counter" },
  "guests":         { fieldKey: "PASSENGERS",    uiType: "counter" },
  "rooms":          { fieldKey: "ROOMS",         uiType: "counter" },
  "adults":         { fieldKey: "ADULTS",        uiType: "counter" },
  "children":       { fieldKey: "CHILDREN",      uiType: "counter" },
  "kids":           { fieldKey: "CHILDREN",      uiType: "counter" },

  // Submit actions
  "search":         { fieldKey: "SEARCH",        uiType: "button" },
  "find":           { fieldKey: "SEARCH",        uiType: "button" },
  "book":           { fieldKey: "SUBMIT",        uiType: "button" },
  "submit":         { fieldKey: "SUBMIT",        uiType: "button" },
  "continue":       { fieldKey: "SUBMIT",        uiType: "button" },
};

// ─── SYNONYM CLUSTERS ─────────────────────────────────────────────────────────
const SYNONYM_CLUSTERS = {
  checkin:      ["checkin", "check in", "check-in", "arrival", "arrive", "ci"],
  checkout:     ["checkout", "check out", "check-out", "co"],
  depart_date:  ["departure", "depart", "departure date", "depart date", "outbound",
                 "travel date", "start date", "onward date", "from date", "date"],
  return_date:  ["return", "return date", "inbound", "back date", "end date",
                 "come back", "coming back"],
  origin:       ["from", "origin", "source", "flying from", "leaving from",
                 "depart from", "start city", "start location"],
  destination:  ["to", "destination", "arrival city", "going to", "arriving at",
                 "end city", "where", "fly to"],
  passengers:   ["passengers", "travellers", "travelers", "guests", "people", "pax"],
  adults:       ["adults", "adult", "grown ups"],
  children:     ["children", "child", "kids", "infant", "infants"],
  rooms:        ["rooms", "room", "accommodation"],
  search:       ["search", "find", "go", "look up"],
  submit:       ["submit", "book", "continue", "proceed", "confirm", "reserve"],
};

// Maps synonym cluster keys → fieldKey + uiType
const CLUSTER_META = {
  checkin:      { fieldKey: "CHECKIN_DATE",  uiType: "date_picker" },
  checkout:     { fieldKey: "CHECKOUT_DATE", uiType: "date_picker" },
  depart_date:  { fieldKey: "DEPART_DATE",   uiType: "date_picker" },
  return_date:  { fieldKey: "RETURN_DATE",   uiType: "date_picker" },
  origin:       { fieldKey: "ORIGIN",        uiType: "search_select" },
  destination:  { fieldKey: "DESTINATION",   uiType: "search_select" },
  passengers:   { fieldKey: "PASSENGERS",    uiType: "counter" },
  adults:       { fieldKey: "ADULTS",        uiType: "counter" },
  children:     { fieldKey: "CHILDREN",      uiType: "counter" },
  rooms:        { fieldKey: "ROOMS",         uiType: "counter" },
  search:       { fieldKey: "SEARCH",        uiType: "button" },
  submit:       { fieldKey: "SUBMIT",        uiType: "button" },
};

// ─── DATE FIELD POSITION DISAMBIGUATOR ───────────────────────────────────────
// When both DEPART_DATE and RETURN_DATE exist on the page (side by side), this
// uses DOM left-to-right order to decide which is which.
// Returns { departEl, returnEl } — either may be null if not found.
function disambiguateDateFields() {
  const dateCandidates = [];
  const all = document.querySelectorAll(
    "input[type='date'], input[type='text'][readonly], input[placeholder*='date' i], " +
    "[class*='date' i], [class*='calendar' i], [class*='checkin' i], [class*='departure' i]"
  );
  all.forEach(el => {
    if (!el || !document.body.contains(el)) return;
    if (el.closest("#webguide-assistant")) return;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    dateCandidates.push({ el, x: rect.left, y: rect.top });
  });

  // Sort left-to-right, top-to-bottom
  dateCandidates.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);

  return {
    departEl: dateCandidates[0]?.el || null,
    returnEl: dateCandidates[1]?.el || null,
  };
}

// Resolves a raw user phrase to its canonical field key and expected UI type.
// Priority: 1) exact alias  2) partial alias  3) synonym cluster  4) word overlap
function resolveSemanticAlias(phrase) {
  const norm = (phrase || "").toLowerCase().trim();
  if (!norm) return null;

  // 1. Exact alias map
  if (FIELD_SEMANTIC_ALIASES[norm]) return FIELD_SEMANTIC_ALIASES[norm];

  // 2. Partial match within alias map (longer keys win — sort by length desc)
  const aliasEntries = Object.entries(FIELD_SEMANTIC_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, meta] of aliasEntries) {
    if (norm.includes(alias) || alias.includes(norm)) return meta;
  }

  // 3. Synonym cluster match
  for (const [clusterKey, synonyms] of Object.entries(SYNONYM_CLUSTERS)) {
    for (const synonym of synonyms) {
      if (norm === synonym || norm.includes(synonym) || synonym.includes(norm)) {
        return CLUSTER_META[clusterKey] || null;
      }
    }
  }

  // 4. Individual word overlap (last resort)
  const normWords = norm.split(/\s+/);
  for (const [clusterKey, synonyms] of Object.entries(SYNONYM_CLUSTERS)) {
    for (const synonym of synonyms) {
      const synWords = synonym.split(/\s+/);
      const overlap = normWords.filter(w => w.length > 2 && synWords.includes(w));
      if (overlap.length > 0) return CLUSTER_META[clusterKey] || null;
    }
  }

  return null;
}

// Returns a human-readable explanation of what Norman understood from a phrase.
function explainSemanticAlias(phrase) {
  const alias = resolveSemanticAlias(phrase);
  if (!alias) return null;
  const typeLabels = {
    date_picker:   "a date picker",
    search_select: "a search / autocomplete field",
    counter:       "a number counter (+ / - buttons)",
    button:        "a button",
    text_input:    "a text input",
  };
  return `I understood "${phrase}" as ${typeLabels[alias.uiType] || alias.uiType} (${alias.fieldKey})`;
}

function parseIntent(query) {
  query = query.toLowerCase();

  const intent = { taskType: "unknown", entities: {} };

  if (query.includes("flight") || query.includes("train") || query.includes("bus") || query.includes("ticket"))
    intent.taskType = "travel_booking";
  if (query.includes("order") || query.includes("food") || query.includes("burger") || query.includes("pizza"))
    intent.taskType = "food_order";
  if (query.includes("buy") || query.includes("purchase") || query.includes("add to cart"))
    intent.taskType = "shopping";
  if (query.includes("search") || query.includes("find"))
    intent.taskType = "search";

  const locationMatch = query.match(/from\s+(\w+)\s+to\s+(\w+)/);
  if (locationMatch) {
    intent.entities.origin      = locationMatch[1];
    intent.entities.destination = locationMatch[2];
  }

  const dateMatch = query.match(/\b(\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|april))\b/i);
  if (dateMatch) intent.entities.date = dateMatch[0];

  const qtyMatch = query.match(/\b\d+\b/);
  if (qtyMatch) intent.entities.quantity = qtyMatch[0];

  // Semantic alias enrichment — try trigrams, bigrams, single words (longest wins)
  const words = query.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const trigram = words.slice(i, i + 3).join(" ");
    const bigram  = words.slice(i, i + 2).join(" ");
    const alias   = resolveSemanticAlias(trigram) ||
                    resolveSemanticAlias(bigram)  ||
                    resolveSemanticAlias(words[i]);
    if (alias) {
      intent.entities.fieldKey = intent.entities.fieldKey || alias.fieldKey;
      intent.entities.uiType   = intent.entities.uiType   || alias.uiType;
      break;
    }
  }

  console.log("Parsed Intent:", intent);
  return intent;
}

// Export
if (typeof module !== "undefined") {
  module.exports = {
    parseIntent, resolveSemanticAlias, explainSemanticAlias,
    disambiguateDateFields,
    FIELD_SEMANTIC_ALIASES, SYNONYM_CLUSTERS, CLUSTER_META
  };
}