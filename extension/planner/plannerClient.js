// planner/plannerClient.js

// ----------------------------------------------------
// LEGACY DOM SUMMARY (Kept for fallback/reference)
// ----------------------------------------------------
function buildPageSummary(){
    const inputs = [...document.querySelectorAll("input,textarea,select")]
        .map(el => {
            return {
                tag: el.tagName.toLowerCase(),
                type: el.type || "",
                name: el.name || "",
                id: el.id || "",
                placeholder: el.placeholder || "",
                aria: el.getAttribute("aria-label") || ""
            };
        });

    const buttons = [...document.querySelectorAll("button,[role=button],input[type=submit]")]
        .map(el => {
            return {
                text: (el.innerText || el.value || "").trim(),
                id: el.id || "",
                name: el.name || ""
            };
        });

    const links = [...document.querySelectorAll("a")]
        .map(el => {
            return {
                text: (el.innerText || "").trim(),
                href: el.href || ""
            };
        });

    return {
        url: location.href,
        title: document.title,
        inputs,
        buttons,
        links
    };
}

// ----------------------------------------------------
// ✅ NEW: SNAPSHOT CONTEXT BUILDER
// Replaces buildSemanticContext()
// Builds rich snapshot + loads saved user feedback
// ----------------------------------------------------

function buildSnapshotContext(){

    // 1. Build rich snapshot from DOM
    const richSnapshot = buildRichSnapshot();

    // 2. Load saved user feedback for this domain
    const domain = window.location.hostname;
    let savedFeedback = {};

    try {
        const raw = localStorage.getItem("norman_field_memory");
        if(raw){
            const allMemory = JSON.parse(raw);
            savedFeedback = allMemory[domain] || {};
        }
    } catch(e){
        console.warn("[plannerClient] Could not load saved feedback:", e);
    }

    // 3. Merge saved feedback into snapshot
    // Mark fields as "known from user feedback" so LLM trusts them
    if(Object.keys(savedFeedback).length > 0){
        Object.keys(savedFeedback).forEach(fieldName => {
            const feedback = savedFeedback[fieldName];

            // check if this field is already confirmed in snapshot
            const alreadyConfirmed = richSnapshot.confirmedFields.some(
                f => f.fieldName === fieldName
            );

            // if not confirmed by DOM but we have feedback — add it
            if(!alreadyConfirmed && feedback.userDescription){
                richSnapshot.confirmedFields.push({
                    fieldName,
                    role: "user_described",
                    resolvedLabel: feedback.userDescription,
                    source: "user_feedback",
                    confirmedAt: feedback.confirmedAt
                });

                // remove from missing list
                richSnapshot.missingFields = richSnapshot.missingFields.filter(
                    f => f !== fieldName
                );
            }
        });
    }

    console.log("[buildSnapshotContext] Final snapshot:", richSnapshot);
    console.log("[buildSnapshotContext] Saved feedback:", savedFeedback);

    return { richSnapshot, savedFeedback };
}

// ----------------------------------------------------
// PLANNER API REQUEST (updated)
// ----------------------------------------------------

let _plannerBackendWarned = false;

async function requestPlan(goal, pageContext, conversationHistory, siteInfo, intent){
    
    // 1. Build rich snapshot context (replaces old semanticContext)
    const { richSnapshot, savedFeedback } = buildSnapshotContext();
    
    // 2. Debug logging
    console.log("[requestPlan] Rich Snapshot:", richSnapshot);

    // 3. Send to backend
    try {
        const res = await fetch("http://localhost:5000/plan", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                goal,
                pageContext,
                siteInfo: siteInfo || null,
                intent: intent || null,
                richSnapshot,
                savedFeedback,
                conversationHistory: conversationHistory || []
            })
        });

        const plan = await res.json();

        if (!res.ok) {
            return {
                error: plan?.error || "planner_failed",
                message: plan?.message || "Planner request failed."
            };
        }

        return plan;
    } catch (err) {
        if (!_plannerBackendWarned) {
            console.warn("[plannerClient] backend unavailable:", err);
            _plannerBackendWarned = true;
        }
        return {
            error: "backend_unreachable",
            message: "I couldn't reach the planner server. Please make sure backend/server.js is running on port 5000."
        };
    }
}
