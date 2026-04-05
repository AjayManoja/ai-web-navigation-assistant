// server.js

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" })); // ✅ increased limit for base64 file uploads
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 5000;

// ----------------------------------------------------
// NORMAN SELF-AWARE SYSTEM PROMPT
// Injected into every LLM call so Norman knows his capabilities
// ----------------------------------------------------
const NORMAN_IDENTITY = `You are Norman, a smart and friendly AI web assistant built as a Chrome extension.

WHAT YOU CAN DO:
- Fill in forms, search fields, dropdowns, and date pickers on any website
- Click buttons and navigate pages step by step
- Remember fields across sessions for the same website
- Read screenshots and images when the user has added a Gemini API key
- Read uploaded documents (PDF, images) and extract data to fill forms
- Analyse the current page and tell whether it can satisfy the user's goal
- Suggest better websites if the current page cannot complete the task
- Greet users by name and personalise responses

WHAT YOU CANNOT DO:
- Access the user's OS files without them uploading first
- Handle CAPTCHAs, login walls, or payment flows autonomously
- Work without a Gemini API key for image/document features (text-only mode without it)
- Take actions outside the current browser tab

BEHAVIOUR RULES:
- Always be warm, concise, and friendly
- If a task is impossible on the current page, say so clearly and suggest the right website
- Never pretend to do something you cannot do
- If the Gemini key is not set, explain that image/doc features are locked and how to unlock them`;

// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------
function simplifyContext(ctx) {
  if (!ctx) return {};
  return {
    // Preserve structuralRole on each input so the planner can reason about
    // element types (date_picker, calendar_trigger, search_select, counter)
    // rather than just matching text labels.
    inputs: (ctx.inputs?.slice(0, 10) || []).map(inp => ({
      type: inp.type || "text",
      placeholder: inp.placeholder || "",
      name: inp.name || "",
      id: inp.id || "",
      structuralRole: inp.structuralRole || "text_input"
    })),
    buttons: ctx.buttons?.slice(0, 10) || [],
    dropdowns: ctx.dropdowns?.slice(0, 10) || [],
    labels: ctx.labels?.slice(0, 20) || []
  };
}

function buildHistoryText(conversationHistory) {
  if (!conversationHistory || conversationHistory.length === 0) return "";
  return conversationHistory.slice(-6).map(h => `${h.role === "user" ? "User" : "Norman"}: ${h.text}`).join("\n");
}

function normalizePlanAction(action = "") {
  const normalized = String(action).toLowerCase().trim();

  if (["search_select", "select", "select_option", "autocomplete", "choose_location"].includes(normalized)) {
    return "search_select";
  }
  if (["click_date", "select_date", "pick_date", "pick_time", "set_time", "choose_time"].includes(normalized)) {
    return "click_date";
  }
  if (["type", "input", "enter"].includes(normalized)) {
    return "type";
  }
  if (["click", "tap", "press"].includes(normalized)) {
    return "click";
  }

  return normalized || "click";
}

function normalizePlanTarget(target = "") {
  const normalized = String(target).toLowerCase().trim();

  if (["pickup", "pickup_location", "pickup point", "pickup city", "from", "origin", "source"].includes(normalized)) {
    return "origin";
  }
  if (["drop", "drop_location", "drop point", "dropoff", "drop off", "to", "destination"].includes(normalized)) {
    return "destination";
  }
  if (["journey_date", "travel_date", "depart_date", "departure_date", "time", "date_time", "when", "schedule"].includes(normalized)) {
    return "date";
  }
  if (["return", "return_date", "inbound_date"].includes(normalized)) {
    return "return_date";
  }
  if (["travellers", "travelers", "guests", "riders", "passengers", "pax"].includes(normalized)) {
    return "passengers";
  }
  if (["find", "search", "book", "book_now", "continue", "submit", "see_rides"].includes(normalized)) {
    return "search";
  }

  return normalized;
}

function normalizePlanShape(rawPlan) {
  if (!rawPlan || typeof rawPlan !== "object") return rawPlan;
  if (rawPlan.error === "site_mismatch") return rawPlan;

  const phases = Array.isArray(rawPlan.phases)
    ? rawPlan.phases
    : Array.isArray(rawPlan.steps)
      ? [{ name: rawPlan.name || "Plan", steps: rawPlan.steps }]
      : [];

  return {
    phases: phases.map((phase, phaseIndex) => ({
      name: phase?.name || `Phase ${phaseIndex + 1}`,
      steps: Array.isArray(phase?.steps)
        ? phase.steps.map(step => ({
            action: normalizePlanAction(step?.action),
            target: normalizePlanTarget(step?.target),
            value: step?.value || ""
          }))
        : []
    }))
  };
}

async function callLLM(messages) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
        signal: controller.signal,
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, temperature: 0 })
      });
      clearTimeout(timeout);
      return await response.json();
    } catch (err) { console.log("LLM CALL FAILED (retrying):", err); }
  }
  throw new Error("LLM failed after retries");
}

// ✅ NEW: call Gemini vision API from server side
// Used for page-check (screenshot of page) and read-upload (user-uploaded file)
async function callGemini(geminiKey, parts, maxTokens = 500) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: maxTokens }
      })
    }
  );
  const data = await response.json();
  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) return null;
  return data.candidates[0].content.parts.filter(p => p.text).map(p => p.text).join(" ").trim();
}

// ----------------------------------------------------
// /chat — intent detection + clarification
// ✅ UPDATED: uses NORMAN_IDENTITY, greets user by name
// ----------------------------------------------------
app.post("/chat", async (req, res) => {
  try {
    const { message, conversationHistory, userName } = req.body;
    if (!message) return res.status(400).json({ error: "Missing message" });

    const historyText = buildHistoryText(conversationHistory);
    const nameNote = userName ? `The user's name is ${userName}. Address them personally when natural.` : "";

    const prompt = `${nameNote}

${historyText ? `Conversation so far:\n${historyText}\n` : ""}Latest user message: "${message}"

Your job is to decide what to do next:

CASE 1 — Task is CLEAR and has enough info:
→ Return type "ready" with a complete merged goal

CASE 2 — Task is INCOMPLETE (missing location, date, details, etc.):
→ Return type "clarify" and ask ONE short friendly question
→ Do NOT generate a plan yet

CASE 3 — User is REFINING or UPDATING a previous task:
→ Merge old context + new info
→ Return type "refine" with updated merged goal

Return ONLY valid JSON. No markdown. No explanation.

Example outputs:
{"type":"ready","text":"Great — let me plan this for you!","mergedGoal":"book a hotel in Mumbai under 5000"}
{"type":"clarify","text":"Sure — which city do you want to book the hotel in?","mergedGoal":null}
{"type":"refine","text":"Got it — updating the plan with your budget!","mergedGoal":"book a hotel in Mumbai under 5000"}`;

    const data = await callLLM([
      { role: "system", content: `${NORMAN_IDENTITY}\n\nReturn ONLY JSON.` },
      { role: "user", content: prompt }
    ]);

    if (!data.choices || !data.choices[0]) return res.json({ type: "ready", text: "Let me help you with that.", mergedGoal: message });
    let text = data.choices[0].message.content.trim().replace(/```json/g, "").replace(/```/g, "").trim();
    try { const parsed = JSON.parse(text); res.json(parsed); }
    catch { res.json({ type: "ready", text: "Let me plan that for you.", mergedGoal: message }); }
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.json({ type: "ready", text: "Let me help you with that.", mergedGoal: message });
  }
});

// ----------------------------------------------------
// /plan — generate execution plan
// ✅ UPDATED: uses NORMAN_IDENTITY in system prompt
// ----------------------------------------------------
app.post("/plan", async (req, res) => {
  try {
    const { goal, pageContext, conversationHistory, richSnapshot, savedFeedback, siteInfo, intent } = req.body;
    if (!goal) return res.status(400).json({ error: "Missing goal" });

    const cleanContext = simplifyContext(pageContext);
    const historyText = buildHistoryText(conversationHistory);
    const siteType = siteInfo?.siteType || "unknown";
    const travelMode = intent?.entities?.travelMode || "unspecified";

    let snapshotText = "";
    if (richSnapshot && richSnapshot.confirmedFields && richSnapshot.confirmedFields.length > 0) {
      const fieldLines = richSnapshot.confirmedFields.map(f =>
        `  - ${f.fieldName} (${f.role}, tag:${f.tag || "?"}, inputType:${f.inputType || "?"}, label:"${f.resolvedLabel || f.ariaLabel || f.placeholder || ""}")`
      ).join("\n");
      snapshotText = `\nDetected page fields:\n${fieldLines}`;
      if (richSnapshot.missingFields && richSnapshot.missingFields.length > 0) {
        snapshotText += `\nFields NOT found in DOM: ${richSnapshot.missingFields.join(", ")}`;
      }
    }

    let feedbackText = "";
    if (savedFeedback && Object.keys(savedFeedback).length > 0) {
      const lines = Object.entries(savedFeedback).map(([k, v]) => `  - ${k}: "${v.userDescription || ""}"`).join("\n");
      feedbackText = `\nUser has previously identified these fields:\n${lines}`;
    }

    const siteContextText = `
Current website context:
- siteType: ${siteType}
- url: ${siteInfo?.url || "unknown"}
- hostHint: ${siteInfo?.hostHint || "none"}
- userTravelMode: ${travelMode}
`;

    const prompt = `${historyText ? `Conversation context:\n${historyText}\n` : ""}
User goal:
${goal}

${siteContextText}

Page elements:
${JSON.stringify(cleanContext)}${snapshotText}${feedbackText}

Generate steps for interacting with this webpage.

IMPORTANT RULES:

Use ONLY these target names:
origin, destination, date, return_date, passengers, search

Use ONLY these action types:

"search_select"  → city, airport, station, hotel, location fields that show autocomplete dropdown
"click_date"     → departure date, return date, check-in, check-out, travel date fields (calendar pickers)
"type"           → plain text inputs only (name, email, promo code, simple text fields)
"click"          → buttons (Search, Submit, Book, etc.)

CRITICAL RULES FOR BOOKING SITES:
- ALWAYS use "search_select" for: origin, destination, from, to, city, airport, station
- ALWAYS use "click_date" for: departure date, return date, check-in, check-out, travel date
- NEVER use "type" for city/location or date fields on booking sites
- Do NOT use HTML ids, DOM selectors, or element names
- If "Detected page fields" are listed above, use their inputType to choose the correct action

TRAVEL DOMAIN RULES:
- Match the plan to the current website type.
- If siteType is "train_booking", plan for train journeys only. Use station-style semantics, not airports or flights.
- If siteType is "flight_booking", plan for flights only. Use airport/city travel semantics, not trains or taxis.
- If siteType is "ride_hailing", plan for taxi/cab rides only. Map pickup to target "origin", drop to target "destination", and time/when to target "date".
- If siteType is "bus_booking", plan for bus booking only.
- If siteType is "hotel_booking", plan for hotels only.
- If the user's requested travel mode conflicts with the current siteType, return:
{"error":"site_mismatch","message":"short friendly explanation"}

Return ONLY valid JSON. No markdown. No explanation.

Example for flight booking:
{
  "phases": [{
    "name": "Fill Flight Details",
    "steps": [
      {"action": "search_select", "target": "origin", "value": "Delhi"},
      {"action": "search_select", "target": "destination", "value": "Mumbai"},
      {"action": "click_date", "target": "date", "value": "15 Apr 2026"},
      {"action": "click", "target": "search"}
    ]
  }]
}

Example for taxi booking on a ride-hailing site:
{
  "phases": [{
    "name": "Fill Ride Details",
    "steps": [
      {"action": "search_select", "target": "origin", "value": "Sarjapur"},
      {"action": "search_select", "target": "destination", "value": "Basavanagudi"},
      {"action": "click_date", "target": "date", "value": "12 Apr 2025 10:30 AM"},
      {"action": "click", "target": "search"}
    ]
  }]
}`;

    const data = await callLLM([
      { role: "system", content: `${NORMAN_IDENTITY}\n\nYou are an AI web automation planner. Return ONLY JSON.` },
      { role: "user", content: prompt }
    ]);

    if (!data.choices || !data.choices[0]) return res.json({ error: "Invalid response from LLM", raw: data });
    let text = data.choices[0].message.content.replace(/```json/g, "").replace(/```/g, "").trim();
    let plan;
    try { plan = JSON.parse(text); } catch (err) { return res.json({ error: "Model returned invalid JSON", raw: text }); }
    plan = normalizePlanShape(plan);
    res.json(plan);
  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: "Planner failed" });
  }
});

// ----------------------------------------------------
// /explain — step explanation
// ✅ UPDATED: uses NORMAN_IDENTITY
// ----------------------------------------------------
app.post("/explain", async (req, res) => {
  try {
    const { step } = req.body;
    if (!step) return res.status(400).json({ error: "Missing step" });
    const prompt = `Given this step:
Action: ${step.action}
Target: ${step.target}
Value: ${step.value || ""}

Write ONE short, friendly sentence (max 15 words) that tells the user what to do and why.

Examples:
- "Go ahead and click Search — this will fetch available flights for you."
- "Type your departure city here so we can find the right routes."
- "Select your travel date to see available options."

Return ONLY the sentence. No JSON. No extra text.`;

    const data = await callLLM([
      { role: "system", content: `${NORMAN_IDENTITY}\n\nReturn only one sentence.` },
      { role: "user", content: prompt }
    ]);
    if (!data.choices || !data.choices[0]) return res.json({ explanation: "Follow the highlighted step to continue." });
    res.json({ explanation: data.choices[0].message.content.trim() });
  } catch (err) {
    console.error("EXPLAIN ERROR:", err);
    res.status(500).json({ explanation: "Follow the highlighted step to continue." });
  }
});

// ----------------------------------------------------
// /feedback-plan — manual instruction when field not found
// ✅ UPDATED: uses NORMAN_IDENTITY
// ----------------------------------------------------
app.post("/feedback-plan", async (req, res) => {
  try {
    const { goal, failedStep, userDescription, richSnapshot, savedFeedback } = req.body;
    if (!failedStep) return res.status(400).json({ error: "Missing failedStep" });

    const snapshotSummary = richSnapshot ? {
      domain: richSnapshot.domain,
      activeSection: richSnapshot.activeSection,
      confirmedFields: richSnapshot.confirmedFields || [],
      missingFields: richSnapshot.missingFields || []
    } : {};

    const feedbackSummary = savedFeedback
      ? Object.entries(savedFeedback).map(([field, data]) => `${field}: "${data.userDescription}"`).join(", ")
      : "";

    const prompt = `User goal: "${goal || "complete this web task"}"

Norman cannot find this field on the page:
- Field: ${failedStep.target}
- Action: ${failedStep.action}
- Value to fill: ${failedStep.value || "unknown"}

User described it as: "${userDescription || "not described"}"
Page snapshot: ${JSON.stringify(snapshotSummary)}
${feedbackSummary ? `Other known fields: ${feedbackSummary}` : ""}

Write ONE short friendly message (under 25 words) telling the user:
1. Norman couldn't find the field to highlight it
2. Exactly what value they need to fill in
3. Where to find it based on their description

Return ONLY the message text. No JSON. No extra text.`;

    const data = await callLLM([
      { role: "system", content: `${NORMAN_IDENTITY}\n\nReturn only one short message.` },
      { role: "user", content: prompt }
    ]);

    if (!data.choices || !data.choices[0]) {
      const fallback = failedStep.value
        ? `I couldn't find the field to highlight. Please fill in "${failedStep.value}" in the ${failedStep.target} field manually.`
        : `I couldn't find the ${failedStep.target} field. Please locate it and fill it in manually.`;
      return res.json({ instruction: fallback });
    }
    res.json({ instruction: data.choices[0].message.content.trim() });
  } catch (err) {
    console.error("FEEDBACK PLAN ERROR:", err);
    const fallback = req.body?.failedStep?.value
      ? `I couldn't find the field. Please fill in "${req.body.failedStep.value}" manually.`
      : "I couldn't find that field. Please fill it in manually.";
    res.status(500).json({ instruction: fallback });
  }
});

// ----------------------------------------------------
// ✅ NEW: /page-check
// Gemini analyses current page screenshot + user goal
// Returns: canComplete (bool), reason, suggestedSite (if not)
// Called by the extension before planning, when Gemini key is available
// ----------------------------------------------------
app.post("/page-check", async (req, res) => {
  try {
    const { goal, pageUrl, pageTitle, geminiKey } = req.body;

    if (!geminiKey) {
      // no Gemini key — skip check, proceed with planning
      return res.json({ canComplete: true, reason: "No Gemini key — skipping page check.", suggestedSite: null });
    }

    if (!goal) return res.status(400).json({ error: "Missing goal" });

    const prompt = `The user wants to: "${goal}"

They are currently on: ${pageTitle || "unknown page"} (${pageUrl || "unknown URL"})

Based only on the URL and page title, answer:
1. Can this website realistically complete the user's goal? (yes/no)
2. If no, what is ONE better website they should use instead? Give just the domain name (e.g. "booking.com").
3. Give a one-sentence reason.

Return ONLY valid JSON like this:
{"canComplete": true, "reason": "This is a flight booking site.", "suggestedSite": null}
or
{"canComplete": false, "reason": "Wikipedia is for reading, not booking.", "suggestedSite": "booking.com"}`;

    const parts = [{ text: prompt }];
    const geminiResponse = await callGemini(geminiKey, parts, 200);

    if (!geminiResponse) return res.json({ canComplete: true, reason: "Page check inconclusive.", suggestedSite: null });

    try {
      const clean = geminiResponse.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(clean);
      res.json(parsed);
    } catch {
      res.json({ canComplete: true, reason: geminiResponse, suggestedSite: null });
    }
  } catch (err) {
    console.error("PAGE CHECK ERROR:", err);
    res.json({ canComplete: true, reason: "Page check failed — proceeding anyway.", suggestedSite: null });
  }
});

// ----------------------------------------------------
// ✅ NEW: /read-upload
// Gemini reads a user-uploaded image or PDF (base64)
// Extracts structured data relevant to filling a form
// Returns extracted fields that the extension will use to fill the page
// ----------------------------------------------------
app.post("/read-upload", async (req, res) => {
  try {
    const { base64, mediaType, fileName, pageUrl, pageTitle, geminiKey } = req.body;

    if (!geminiKey) {
      return res.status(400).json({
        error: "no_key",
        message: "Add a Gemini API key in ⋮ Settings to enable document reading."
      });
    }

    if (!base64) return res.status(400).json({ error: "Missing file data" });

    const isPdf = mediaType === "application/pdf";

    const prompt = `The user has uploaded a ${isPdf ? "PDF document" : "screenshot/image"} named "${fileName || "file"}".
They are on the page: ${pageTitle || "unknown"} (${pageUrl || "unknown URL"}).

Extract ALL information from this ${isPdf ? "document" : "image"} that could be used to fill a web form.
Look for: names, dates, locations, cities, booking references, phone numbers, email addresses, passenger counts, prices, addresses, flight numbers, hotel names, or any other structured data.

Return ONLY valid JSON in this format:
{
  "extractedFields": [
    {"fieldName": "origin", "value": "Delhi"},
    {"fieldName": "destination", "value": "Mumbai"},
    {"fieldName": "date", "value": "15 Apr 2026"},
    {"fieldName": "passengers", "value": "2"},
    {"fieldName": "name", "value": "John Smith"}
  ],
  "summary": "One sentence describing what the document contains."
}

If nothing useful is found, return: {"extractedFields": [], "summary": "No form-relevant data found."}
Return ONLY the JSON. No markdown. No explanation.`;

    const parts = [
      { inline_data: { mime_type: mediaType || "image/png", data: base64 } },
      { text: prompt }
    ];

    const geminiResponse = await callGemini(geminiKey, parts, 600);

    if (!geminiResponse) {
      return res.json({ extractedFields: [], summary: "Could not read the file." });
    }

    try {
      const clean = geminiResponse.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(clean);
      res.json(parsed);
    } catch {
      res.json({ extractedFields: [], summary: geminiResponse });
    }
  } catch (err) {
    console.error("READ UPLOAD ERROR:", err);
    res.status(500).json({ extractedFields: [], summary: "Failed to read the file." });
  }
});

// ----------------------------------------------------
// ✅ NEW: /groq-plan
// Groq is the DEFAULT planning engine — no user key needed.
// This is a named alias for /plan so the client can explicitly
// route planning through Groq (AI_ENGINES.GROQ.role === "planning").
// Behaviour is identical to /plan; both use callLLM (Groq under the hood).
// Gemini is NEVER called here — planning is Groq-only.
// ----------------------------------------------------
app.post("/groq-plan", async (req, res) => {
  // Delegate entirely to the existing /plan logic
  req.url = "/plan";
  app._router.handle(req, res, () => {});
});

// ----------------------------------------------------
// ✅ NEW: /gemini-vision-field
// Gemini vision engine — ONLY called when:
//   1. A DOM element was NOT found by the normal matcher
//   2. The user has a Gemini key saved
//   3. The user has uploaded a screenshot of the current page
// Returns CSS selector hints, aria-label, visual description,
// position clue, and nearby text so the extension can retry
// the DOM search intelligently without asking the user again.
// The screenshot is used for this one call only — never stored.
// Groq is NEVER called here — vision is Gemini-only.
// ----------------------------------------------------
app.post("/gemini-vision-field", async (req, res) => {
  try {
    const { fieldName, imageBase64, mediaType, geminiKey, pageUrl, pageTitle } = req.body;

    if (!geminiKey) {
      return res.status(400).json({
        error: "no_key",
        message: "A Gemini API key is required for visual field detection."
      });
    }

    if (!fieldName || !imageBase64) {
      return res.status(400).json({ error: "Missing fieldName or imageBase64" });
    }

    const prompt = `You are helping a browser automation system find a specific DOM element on a webpage.

The field it cannot find is: "${fieldName}"
Page: ${pageTitle || "unknown"} (${pageUrl || "unknown URL"})

Look at the screenshot carefully and return hints that will help find this element in the DOM.

Return ONLY valid JSON with these fields (fill in what you can see, use null if unsure):
{
  "cssSelector": "a CSS selector guess e.g. input[placeholder='From'], [aria-label='Origin city'], #departureCity",
  "ariaLabel": "the aria-label text of the element if visible",
  "placeholderText": "placeholder text inside the input if visible",
  "visualDescription": "2-sentence description: color, shape, position on page",
  "positionClue": "IMPORTANT: describe using direction words — e.g. right side from To field, left of search button, below departure date, top right corner. Always include a direction word AND a nearby reference element.",
  "nearbyText": "exact text of the label or text immediately next to this element",
  "elementType": "input | button | select | div | combobox | other",
  "structuralRole": "What type of UI widget is this? Choose from: date_picker | calendar_trigger | search_select | counter | dropdown | text_input | button | checkbox | radio | UNKNOWN. A calendar_trigger is a readonly input or div that opens a date picker when clicked. A search_select is an autocomplete/combobox. A counter has +/- buttons. Use this to tell the system HOW this element behaves, not just what it looks like."
}

Return ONLY the JSON. No markdown. No explanation.`;

    const parts = [
      { inline_data: { mime_type: mediaType || "image/png", data: imageBase64 } },
      { text: prompt }
    ];

    const geminiResponse = await callGemini(geminiKey, parts, 400);

    if (!geminiResponse) {
      return res.json({ hints: null, message: "Gemini could not analyse the screenshot." });
    }

    try {
      const clean = geminiResponse.replace(/```json/g, "").replace(/```/g, "").trim();
      const hints = JSON.parse(clean);
      res.json({ hints });
    } catch {
      // Gemini returned text instead of JSON — still useful as a visual description
      res.json({ hints: { visualDescription: geminiResponse, cssSelector: null, ariaLabel: null, nearbyText: null } });
    }
  } catch (err) {
    console.error("GEMINI VISION FIELD ERROR:", err);
    res.status(500).json({ hints: null, message: "Vision field detection failed." });
  }
});

app.listen(PORT, () => { console.log(`Planner server running on port ${PORT}`); });
