console.log("AI Assistant loaded");

function initializeAssistant(){
  createAssistantUI();
  if (typeof initializeVoiceNavigation === "function") initializeVoiceNavigation();
  scanPageElements();
  if(typeof detectForms === "function") detectForms();
  if(typeof detectUniversalForms === "function") detectUniversalForms();
  startDOMObserver();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", initializeAssistant);
} else {
  initializeAssistant();
}


// ------------------------------------
// ✅ NEW: ASK NORMAN (chat endpoint)
// Decides: clarify / ready / refine
// ------------------------------------

async function askNorman(message, conversationHistory) {
  try {
    const res = await fetch("http://localhost:5000/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, conversationHistory })
    });
    return await res.json();
  } catch(err) {
    console.error("askNorman failed:", err);
    // fallback: treat as ready with original message
    return { type: "ready", text: "Let me plan that for you.", mergedGoal: message };
  }
}


// ------------------------------------
// PREVENT DUPLICATE PLANNER CALLS
// ------------------------------------

let planning = false;


// ------------------------------------
// ✅ UPDATED: MAIN INPUT HANDLER
// Now handles multi-turn + interrupt
// ------------------------------------

listenUserInput(async (query) => {

  // ✅ Step 1: Save user message to conversation history
  if (window.sessionManager) {
    window.sessionManager.addToHistory("user", query);
  }

  // ✅ Step 2: If execution is running → interrupt and refine
  if (executionRunning) {
    console.log("[INTERRUPT] New input received during execution");
    interruptExecution();
    addMessage("AI", "Got it — updating the plan with your new input...");
  }

  // ✅ Step 3: Prevent overlapping planner calls
  if (planning) {
    console.log("Planner already running...");
    return;
  }

  planning = true;

  try {

    // ✅ Step 4: Get conversation history
    const conversationHistory = window.sessionManager?.getHistory() || [];

    // ✅ Step 5: Ask Norman what to do (clarify / ready / refine)
    const chatResponse = await askNorman(query, conversationHistory);

    console.log("NORMAN RESPONSE:", chatResponse);

    if (!chatResponse) {
      addMessage("AI", "Sorry, I had trouble understanding. Please try again.");
      return;
    }

    // ✅ Step 6: Save Norman's response to history
    if (window.sessionManager && chatResponse.text) {
      window.sessionManager.addToHistory("assistant", chatResponse.text);
    }

    // ✅ Step 7: If Norman needs clarification → show question and STOP
    if (chatResponse.type === "clarify") {
      addMessage("AI", chatResponse.text);
      return;
    }

    // ✅ Step 8: Use merged goal for planning
    const mergedGoal = chatResponse.mergedGoal || query;

    // ✅ Step 9: Update session with merged goal
    if (window.sessionManager) {
      window.sessionManager.start(mergedGoal); // resets plan, keeps history
      window.sessionManager.updateGoal(mergedGoal);
    }

    // ✅ Step 10: Check if site supports this task
    const siteInfo = classifyWebsite();
    const intent = parseIntent(mergedGoal);
    const capability = analyzeCapability(intent, siteInfo);

    if (!capability.allowed) {
      addMessage("AI", capability.reason || "This task cannot be performed on this website.");
      return;
    }

    // ✅ Step 11: Show Norman's ready message
    if (chatResponse.text) {
      addMessage("AI", chatResponse.text);
    }

    // ✅ Step 12: Generate plan with merged goal + conversation context
    const pageContext = extractPageContext();
    const plan = await requestPlan(mergedGoal, pageContext, conversationHistory, siteInfo, intent);

    console.log("PLAN RECEIVED:", plan);

    if (plan && plan.error) {
      addMessage("AI", plan.message || "I couldn't generate a valid plan for this page.");
      return;
    }

    if (!plan || !plan.phases || !Array.isArray(plan.phases)) {
      console.warn("Planner returned an unusable plan shape:", plan);
      addMessage("AI", "Sorry, I couldn't generate a valid plan.");
      return;
    }

    // ✅ Step 13: Execute
    startExecution(plan);

  } catch(err) {
    console.error("Planner request failed:", err);
    addMessage("AI", "Planner failed. Please try again.");
  } finally {
    // ✅ FIXED: always release the lock — no matter which path exits
    planning = false;
  }

});
