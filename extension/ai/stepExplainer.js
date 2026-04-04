// ai/stepExplainer.js

// Cache so we don't re-fetch same step twice
const explanationCache = {};

async function fetchExplanation(step) {

  const key = `${step.action}_${step.target}_${step.value || ""}`;

  if (explanationCache[key]) {
    return explanationCache[key];
  }

  try {

    const response = await fetch("http://localhost:5000/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step })
    });

    const data = await response.json();
    const explanation = data.explanation || "Follow the highlighted step to continue.";

    explanationCache[key] = explanation;
    return explanation;

  } catch (err) {
    console.error("[stepExplainer] fetch failed:", err);
    return "Follow the highlighted step to continue.";
  }
}

// Enriches every step in the plan with an explanation field
async function enrichPlanWithExplanations(plan) {

  if (!plan || !plan.phases) return plan;

  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      step.explanation = await fetchExplanation(step);
    }
  }

  return plan;
}