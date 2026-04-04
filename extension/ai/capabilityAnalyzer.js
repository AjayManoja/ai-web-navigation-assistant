// ai/capabilityAnalyzer.js

// ----------------------------------------------------
// AI ENGINE FLAGS
// Groq = default planning engine (no key needed)
// Gemini = optional vision engine (key required)
// ----------------------------------------------------
const AI_ENGINES = {
  GROQ: {
    name: "groq",
    isDefault: true,       // ✅ Groq handles ALL task planning by default
    requiresKey: false,    // no key needed — uses server-side GROQ_API_KEY
    role: "planning"       // exclusively owns plan generation
  },
  GEMINI: {
    name: "gemini",
    isDefault: false,      // optional — only activated when user has saved a key
    requiresKey: true,     // user must add key via ⋮ Settings
    role: "vision"         // exclusively handles visual field detection
  }
};

// Returns which engine should handle a given task type.
// "planning" always goes to Groq. "vision" goes to Gemini (if key present).
function resolveEngine(taskType) {
  if (taskType === "vision") return AI_ENGINES.GEMINI;
  return AI_ENGINES.GROQ; // default for planning, chat, explain, feedback-plan
}

function analyzeCapability(intent, siteInfo){

let allowed = false;
let reason = "";


switch(intent.taskType){

case "travel_booking":

if(
siteInfo.siteType === "travel_booking" ||
siteInfo.siteType === "railway_booking"
){
allowed = true;
}else{
reason = "This website does not support travel booking.";
}

break;


case "food_order":

if(siteInfo.siteType === "food_ordering"){
allowed = true;
}else{
reason = "This website cannot order food.";
}

break;


case "shopping":

if(siteInfo.siteType === "ecommerce"){
allowed = true;
}else{
reason = "Shopping actions not supported on this website.";
}

break;


case "search":

allowed = true;
break;


default:

allowed = true;

}


return {
allowed,
reason
};

}