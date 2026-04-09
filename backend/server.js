require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 5000;

const NORMAN_IDENTITY = `You are Norman, a smart and friendly AI web assistant built as a Chrome extension.

WHAT YOU CAN DO:
- Fill in forms, search fields, dropdowns, and date pickers on websites
- Click buttons and guide users step by step
- Remember fields across sessions for the same website
- Read screenshots and uploaded documents when Gemini is available
- Analyse whether the current page can satisfy the user's goal

WHAT YOU CANNOT DO:
- Access local OS files unless the user uploads them
- Handle CAPTCHAs, payment flows, or actions outside the current tab

BEHAVIOUR RULES:
- Be warm, concise, and honest
- If a task is impossible on the current page, say so clearly
- Never pretend to do something you cannot do`;

function simplifyContext(ctx) {
  if (!ctx) return {};
  return {
    inputs: (ctx.inputs?.slice(0, 6) || []).map(inp => ({
      type: inp.type || "text",
      placeholder: String(inp.placeholder || "").slice(0, 40),
      name: String(inp.name || "").slice(0, 30),
      id: String(inp.id || "").slice(0, 30),
      structuralRole: inp.structuralRole || "text_input"
    })),
    buttons: (ctx.buttons?.slice(0, 6) || []).map(btn => ({
      text: String(btn?.text || "").slice(0, 40)
    })),
    dropdowns: (ctx.dropdowns?.slice(0, 6) || []).map(drop => ({
      id: String(drop?.id || "").slice(0, 30),
      name: String(drop?.name || "").slice(0, 30),
      label: String(drop?.label || "").slice(0, 40)
    })),
    labels: (ctx.labels?.slice(0, 12) || []).map(label => String(label || "").slice(0, 40))
  };
}

function buildHistoryText(conversationHistory) {
  if (!conversationHistory?.length) return "";
  return conversationHistory
    .slice(-3)
    .map(h => `${h.role === "user" ? "User" : "Norman"}: ${String(h.text || "").slice(0, 120)}`)
    .join("\n");
}

function stripMarkdownFences(text = "") {
  return String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractFirstJsonObject(text = "") {
  const cleanText = stripMarkdownFences(text);
  const start = cleanText.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleanText.length; i++) {
    const char = cleanText[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return cleanText.slice(start, i + 1);
    }
  }
  return null;
}

function parseModelJson(text = "") {
  const direct = stripMarkdownFences(text);
  try {
    return JSON.parse(direct);
  } catch {}

  const extracted = extractFirstJsonObject(text);
  if (!extracted) throw new Error("No JSON object found in model response");
  return JSON.parse(extracted);
}

function extractRetryDelay(message = "") {
  const match = String(message).match(/Please try again in ([^.]*)/i);
  return match ? match[1].trim() : null;
}

function countMatches(text = "", regex) {
  const matches = String(text).match(regex);
  return matches ? matches.length : 0;
}

function detectInputLanguage(text = "") {
  const cleanText = String(text || "").trim();
  const kannadaChars = countMatches(cleanText, /[\u0C80-\u0CFF]/g);
  const latinChars = countMatches(cleanText, /[A-Za-z]/g);

  if (kannadaChars > 0 && latinChars === 0) return "kn";
  if (latinChars > 0 && kannadaChars === 0) return "en";
  if (kannadaChars > 0 && latinChars > 0) return "mixed";
  return "unknown";
}

function containsKannada(text = "") {
  return /[\u0C80-\u0CFF]/.test(String(text || ""));
}

function cleanTranslatedText(text = "") {
  return String(text || "")
    .replace(/^translation\s*:\s*/i, "")
    .replace(/^english\s*:\s*/i, "")
    .trim();
}

function translationLooksUsable(originalText = "", translatedText = "") {
  const original = String(originalText || "").trim();
  const translated = cleanTranslatedText(translatedText);
  if (!translated) return false;
  if (containsKannada(translated)) return false;
  if (translated === original && containsKannada(original)) return false;
  return true;
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

async function callLLM(messages, { temperature = 0, maxTokens } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages,
          temperature,
          ...(typeof maxTokens === "number" ? { max_tokens: maxTokens } : {})
        })
      });

      clearTimeout(timeout);
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          const retryDelay = extractRetryDelay(data?.error?.message);
          console.warn("[GROQ RATE LIMITED]", {
            attempt: attempt + 1,
            retryDelay,
            error: data?.error || data
          });
          return {
            rateLimited: true,
            retryDelay,
            userMessage: retryDelay
              ? `Groq rate limit reached. Please try again in about ${retryDelay}.`
              : "Groq rate limit reached. Please try again shortly."
          };
        }

        console.error("[GROQ ERROR]", {
          status: response.status,
          statusText: response.statusText,
          attempt: attempt + 1,
          error: data?.error || data
        });
        throw new Error(`Groq HTTP ${response.status}`);
      }

      if (!data?.choices?.[0]?.message?.content) {
        console.warn("[GROQ EMPTY/UNEXPECTED RESPONSE]", JSON.stringify(data, null, 2));
      }

      return data;
    } catch (err) {
      console.log("LLM CALL FAILED (retrying):", err);
    }
  }

  throw new Error("LLM failed after retries");
}

async function callGemini(geminiKey, parts, maxTokens = 500) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
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
  if (!response.ok) {
    throw new Error(`Gemini HTTP ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) return null;
  return data.candidates[0].content.parts.filter(p => p.text).map(p => p.text).join(" ").trim();
}

app.post("/translate", async (req, res) => {
  try {
    const {
      text,
      sourceLang = "auto",
      targetLang = "en",
      mode = "voice"
    } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: "Missing text" });
    }

    const cleanText = String(text).trim();
    const detectedLang = sourceLang === "auto" ? detectInputLanguage(cleanText) : sourceLang;

    if (detectedLang === "en") {
      console.log(`[TRANSLATE][${mode}] en->${targetLang} (passthrough)`);
      console.log("[TRANSLATE][ORIGINAL]", cleanText);
      console.log("[TRANSLATE][ENGLISH]", cleanText);
      return res.json({
        translatedText: cleanText,
        sourceLang: "en",
        targetLang,
        provider: "passthrough"
      });
    }

    const prompt = `Translate the following user request into natural English.

Rules:
- Source language may be Kannada or Kannada-English mixed text.
- Preserve intent, city names, dates, counts, and travel details accurately.
- If the text is already English, return it unchanged.
- Return ONLY JSON in this shape: {"translatedText":"..."}

Text: ${cleanText}`;

    let translatedText = cleanText;
    let provider = "passthrough";

    if (GEMINI_API_KEY) {
      try {
        const geminiResponse = await callGemini(GEMINI_API_KEY, [{ text: prompt }], 80);
        if (geminiResponse) {
          try {
            translatedText = cleanTranslatedText(parseModelJson(geminiResponse)?.translatedText || geminiResponse);
          } catch {
            translatedText = cleanTranslatedText(geminiResponse);
          }
          provider = "gemini";
        }
      } catch (geminiErr) {
        console.warn("[TRANSLATE] Gemini translation failed, falling back:", geminiErr.message);
      }
    }

    if ((!translationLooksUsable(cleanText, translatedText)) && GROQ_API_KEY) {
      const data = await callLLM([
        { role: "system", content: "You are a translation engine. Return ONLY valid JSON: {\"translatedText\":\"...\"}" },
        { role: "user", content: prompt }
      ], { maxTokens: 100 });

      if (!data?.rateLimited && data?.choices?.[0]?.message?.content) {
        try {
          translatedText = cleanTranslatedText(parseModelJson(data.choices[0].message.content)?.translatedText || data.choices[0].message.content);
        } catch {
          translatedText = cleanTranslatedText(data.choices[0].message.content);
        }
        provider = "groq";
      }
    }

    if (!translationLooksUsable(cleanText, translatedText)) {
      console.warn("[TRANSLATE] usable English translation not produced");
      translatedText = "";
      provider = "failed";
    }

    console.log(`[TRANSLATE][${mode}] ${detectedLang}->${targetLang}`);
    console.log("[TRANSLATE][ORIGINAL]", cleanText);
    console.log("[TRANSLATE][ENGLISH]", translatedText || "(translation failed)");

    return res.json({
      translatedText,
      sourceLang: detectedLang,
      targetLang,
      provider,
      success: Boolean(translatedText)
    });
  } catch (err) {
    console.error("TRANSLATE ERROR:", err);
    if (err?.stack) console.error(err.stack);
    return res.status(500).json({ error: "Translation failed" });
  }
});

app.post("/chat", async (req, res) => {
  const fallbackMessage = req.body?.message || "";

  try {
    const { message, conversationHistory, userName } = req.body;
    if (!message) return res.status(400).json({ error: "Missing message" });

    const historyText = buildHistoryText(conversationHistory);
    const nameNote = userName ? `The user's name is ${userName}.` : "";

    const prompt = `${nameNote}
${historyText ? `Recent context:\n${historyText}\n` : ""}Latest user message: "${message}"

Choose one:
- ready = clear task with enough info
- clarify = missing key detail like date/location/count
- refine = user updates an active task from recent context

Return ONLY JSON:
{"type":"ready|clarify|refine","text":"short reply","mergedGoal":"full goal or null"}`;

    const data = await callLLM([
      { role: "system", content: `${NORMAN_IDENTITY}\n\nReturn ONLY JSON.` },
      { role: "user", content: prompt }
    ], { maxTokens: 180 });

    if (data?.rateLimited) {
      return res.json({
        type: "ready",
        text: data.userMessage,
        mergedGoal: message
      });
    }

    if (!data?.choices?.[0]) {
      return res.json({ type: "ready", text: "Let me help you with that.", mergedGoal: message });
    }

    try {
      const parsed = parseModelJson(data.choices[0].message.content);
      return res.json(parsed);
    } catch (parseErr) {
      console.warn("CHAT JSON PARSE FAILED:", parseErr, data.choices[0].message.content);
      return res.json({ type: "ready", text: "Let me plan that for you.", mergedGoal: message });
    }
  } catch (err) {
    console.error("CHAT ERROR:", err);
    if (err?.stack) console.error(err.stack);
    return res.json({ type: "ready", text: "Let me help you with that.", mergedGoal: fallbackMessage });
  }
});

app.post("/plan", async (req, res) => {
  try {
    const { goal, pageContext, conversationHistory, richSnapshot, savedFeedback, siteInfo, intent } = req.body;
    if (!goal) return res.status(400).json({ error: "Missing goal" });

    const cleanContext = simplifyContext(pageContext);
    const historyText = buildHistoryText(conversationHistory);
    const siteType = siteInfo?.siteType || "unknown";
    const travelMode = intent?.entities?.travelMode || "unspecified";

    let snapshotText = "";
    if (richSnapshot?.confirmedFields?.length) {
      const fieldLines = richSnapshot.confirmedFields.slice(0, 8).map(f =>
        `- ${f.fieldName} (${f.role}, ${f.inputType || "?"}, "${f.resolvedLabel || f.ariaLabel || f.placeholder || ""}")`
      ).join("\n");
      snapshotText = `\nDetected fields:\n${fieldLines}`;
      if (richSnapshot.missingFields?.length) {
        snapshotText += `\nMissing fields: ${richSnapshot.missingFields.slice(0, 6).join(", ")}`;
      }
    }

    let feedbackText = "";
    if (savedFeedback && Object.keys(savedFeedback).length > 0) {
      const lines = Object.entries(savedFeedback)
        .slice(0, 6)
        .map(([k, v]) => `- ${k}: "${String(v.userDescription || "").slice(0, 50)}"`)
        .join("\n");
      feedbackText = `\nKnown user field hints:\n${lines}`;
    }

    const prompt = `${historyText ? `Conversation:\n${historyText}\n` : ""}Goal: ${goal}

Website:
- siteType: ${siteType}
- url: ${siteInfo?.url || "unknown"}
- hostHint: ${siteInfo?.hostHint || "none"}
- userTravelMode: ${travelMode}

Page context:
${JSON.stringify(cleanContext)}${snapshotText}${feedbackText}

Return ONLY valid JSON with:
{
  "phases": [{
    "name": "Phase name",
    "steps": [
      {"action":"search_select|click_date|type|click","target":"origin|destination|date|return_date|passengers|search","value":"..."}
    ]
  }]
}

Rules:
- use search_select for city/location fields
- use click_date for any travel/checkin/checkout date field
- use type only for plain text fields
- use click for buttons
- never use selectors or DOM ids
- if travel mode conflicts with siteType, return {"error":"site_mismatch","message":"short explanation"}`;

    const data = await callLLM([
      { role: "system", content: `${NORMAN_IDENTITY}\n\nYou are an AI web automation planner. Return ONLY JSON.` },
      { role: "user", content: prompt }
    ], { maxTokens: 420 });

    if (data?.rateLimited) {
      return res.json({ error: "rate_limit", message: data.userMessage });
    }

    if (!data?.choices?.[0]) {
      return res.json({ error: "Invalid response from LLM", raw: data });
    }

    let plan;
    try {
      plan = parseModelJson(data.choices[0].message.content);
    } catch (err) {
      return res.json({ error: "Model returned invalid JSON", raw: data.choices[0].message.content });
    }

    plan = normalizePlanShape(plan);
    return res.json(plan);
  } catch (err) {
    console.error("SERVER ERROR:", err);
    if (err?.stack) console.error(err.stack);
    return res.status(500).json({ error: "Planner failed" });
  }
});

app.post("/explain", async (req, res) => {
  try {
    const { step } = req.body;
    if (!step) return res.status(400).json({ error: "Missing step" });

    const prompt = `Step:
Action: ${step.action}
Target: ${step.target}
Value: ${step.value || ""}

Write ONE short friendly sentence (max 15 words). Return only the sentence.`;

    const data = await callLLM([
      { role: "system", content: `${NORMAN_IDENTITY}\n\nReturn only one sentence.` },
      { role: "user", content: prompt }
    ], { maxTokens: 40 });

    if (data?.rateLimited || !data?.choices?.[0]) {
      return res.json({ explanation: "Follow the highlighted step to continue." });
    }

    return res.json({ explanation: data.choices[0].message.content.trim() });
  } catch (err) {
    console.error("EXPLAIN ERROR:", err);
    if (err?.stack) console.error(err.stack);
    return res.status(500).json({ explanation: "Follow the highlighted step to continue." });
  }
});

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

    const prompt = `Goal: "${goal || "complete this task"}"
Missing field: ${failedStep.target}
Action: ${failedStep.action}
Value: ${failedStep.value || "unknown"}
User description: "${userDescription || "not described"}"
Snapshot: ${JSON.stringify(snapshotSummary)}
${feedbackSummary ? `Known fields: ${feedbackSummary}` : ""}

Write ONE short friendly instruction under 25 words. Return only the message.`;

    const data = await callLLM([
      { role: "system", content: `${NORMAN_IDENTITY}\n\nReturn only one short message.` },
      { role: "user", content: prompt }
    ], { maxTokens: 60 });

    if (data?.rateLimited || !data?.choices?.[0]) {
      const fallback = failedStep.value
        ? `I couldn't find the field. Please fill in "${failedStep.value}" manually.`
        : `I couldn't find the ${failedStep.target} field. Please fill it in manually.`;
      return res.json({ instruction: fallback });
    }

    return res.json({ instruction: data.choices[0].message.content.trim() });
  } catch (err) {
    console.error("FEEDBACK PLAN ERROR:", err);
    if (err?.stack) console.error(err.stack);
    const fallback = req.body?.failedStep?.value
      ? `I couldn't find the field. Please fill in "${req.body.failedStep.value}" manually.`
      : "I couldn't find that field. Please fill it in manually.";
    return res.status(500).json({ instruction: fallback });
  }
});

app.post("/page-check", async (req, res) => {
  try {
    const { goal, pageUrl, pageTitle, geminiKey } = req.body;

    if (!geminiKey) {
      return res.json({ canComplete: true, reason: "No Gemini key - skipping page check.", suggestedSite: null });
    }
    if (!goal) return res.status(400).json({ error: "Missing goal" });

    const prompt = `Goal: "${goal}"
Page: ${pageTitle || "unknown"} (${pageUrl || "unknown URL"})

Return ONLY JSON:
{"canComplete":true,"reason":"short reason","suggestedSite":null}`;

    const geminiResponse = await callGemini(geminiKey, [{ text: prompt }], 120);

    if (!geminiResponse) {
      return res.json({ canComplete: true, reason: "Page check inconclusive.", suggestedSite: null });
    }

    try {
      return res.json(parseModelJson(geminiResponse));
    } catch {
      return res.json({ canComplete: true, reason: geminiResponse, suggestedSite: null });
    }
  } catch (err) {
    console.error("PAGE CHECK ERROR:", err);
    if (err?.stack) console.error(err.stack);
    return res.json({ canComplete: true, reason: "Page check failed - proceeding anyway.", suggestedSite: null });
  }
});

app.post("/read-upload", async (req, res) => {
  try {
    const { base64, mediaType, fileName, pageUrl, pageTitle, geminiKey } = req.body;

    if (!geminiKey) {
      return res.status(400).json({
        error: "no_key",
        message: "Add a Gemini API key in Settings to enable document reading."
      });
    }
    if (!base64) return res.status(400).json({ error: "Missing file data" });

    const isPdf = mediaType === "application/pdf";
    const prompt = `The user uploaded a ${isPdf ? "PDF" : "image"} named "${fileName || "file"}".
They are on: ${pageTitle || "unknown"} (${pageUrl || "unknown URL"}).

Extract form-relevant data.
Return ONLY JSON:
{"extractedFields":[{"fieldName":"origin","value":"Delhi"}],"summary":"short summary"}`;

    const geminiResponse = await callGemini(geminiKey, [
      { inline_data: { mime_type: mediaType || "image/png", data: base64 } },
      { text: prompt }
    ], 400);

    if (!geminiResponse) {
      return res.json({ extractedFields: [], summary: "Could not read the file." });
    }

    try {
      return res.json(parseModelJson(geminiResponse));
    } catch {
      return res.json({ extractedFields: [], summary: geminiResponse });
    }
  } catch (err) {
    console.error("READ UPLOAD ERROR:", err);
    if (err?.stack) console.error(err.stack);
    return res.status(500).json({ extractedFields: [], summary: "Failed to read the file." });
  }
});

app.post("/groq-plan", async (req, res) => {
  req.url = "/plan";
  app._router.handle(req, res, () => {});
});

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

    const prompt = `Find the field "${fieldName}" on this page screenshot.
Page: ${pageTitle || "unknown"} (${pageUrl || "unknown URL"})

Return ONLY JSON:
{
  "cssSelector": null,
  "ariaLabel": null,
  "placeholderText": null,
  "visualDescription": "short description",
  "positionClue": "short position clue",
  "nearbyText": null,
  "elementType": "input|button|select|div|combobox|other",
  "structuralRole": "date_picker|calendar_trigger|search_select|counter|dropdown|text_input|button|checkbox|radio|UNKNOWN"
}`;

    const geminiResponse = await callGemini(geminiKey, [
      { inline_data: { mime_type: mediaType || "image/png", data: imageBase64 } },
      { text: prompt }
    ], 250);

    if (!geminiResponse) {
      return res.json({ hints: null, message: "Gemini could not analyse the screenshot." });
    }

    try {
      return res.json({ hints: parseModelJson(geminiResponse) });
    } catch {
      return res.json({
        hints: { visualDescription: geminiResponse, cssSelector: null, ariaLabel: null, nearbyText: null }
      });
    }
  } catch (err) {
    console.error("GEMINI VISION FIELD ERROR:", err);
    if (err?.stack) console.error(err.stack);
    return res.status(500).json({ hints: null, message: "Vision field detection failed." });
  }
});

app.listen(PORT, () => {
  console.log(`Planner server running on port ${PORT}`);
});
