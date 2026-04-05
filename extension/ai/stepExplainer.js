// ai/stepExplainer.js

// Cache so we don't re-fetch same step twice
const explanationCache = {};
let _stepExplainerUnavailable = false;

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

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const explanation = data.explanation || "Follow the highlighted step to continue.";

    explanationCache[key] = explanation;
    _stepExplainerUnavailable = false;
    return explanation;

  } catch (err) {
    if (!_stepExplainerUnavailable) {
      console.warn("[stepExplainer] backend unavailable, using fallback explanations.");
      _stepExplainerUnavailable = true;
    }
    const fallback = "Follow the highlighted step to continue.";
    explanationCache[key] = fallback;
    return fallback;
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
