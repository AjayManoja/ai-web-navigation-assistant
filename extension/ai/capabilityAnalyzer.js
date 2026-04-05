// ai/capabilityAnalyzer.js

// ----------------------------------------------------
// AI ENGINE FLAGS
// Groq = default planning engine (no key needed)
// Gemini = optional vision engine (key required)
// ----------------------------------------------------
const AI_ENGINES = {
  GROQ: {
    name: "groq",
    isDefault: true,
    requiresKey: false,
    role: "planning"
  },
  GEMINI: {
    name: "gemini",
    isDefault: false,
    requiresKey: true,
    role: "vision"
  }
};

function resolveEngine(taskType) {
  if (taskType === "vision") return AI_ENGINES.GEMINI;
  return AI_ENGINES.GROQ;
}

const SITE_LABELS = {
  flight_booking: "flight booking",
  train_booking: "train booking",
  ride_hailing: "taxi or cab booking",
  bus_booking: "bus booking",
  hotel_booking: "hotel booking",
  food_ordering: "food ordering",
  ecommerce: "shopping",
  banking: "banking"
};

const TRAVEL_MODE_TO_SITE = {
  flight: ["flight_booking"],
  train: ["train_booking"],
  taxi: ["ride_hailing"],
  cab: ["ride_hailing"],
  ride: ["ride_hailing"],
  bus: ["bus_booking"],
  hotel: ["hotel_booking"]
};

function analyzeCapability(intent, siteInfo) {
  const siteType = siteInfo?.siteType || "generic";
  const travelMode = intent?.entities?.travelMode || null;

  let allowed = false;
  let reason = "";

  switch (intent.taskType) {
    case "travel_booking": {
      if (travelMode && TRAVEL_MODE_TO_SITE[travelMode]) {
        const allowedSites = TRAVEL_MODE_TO_SITE[travelMode];

        if (allowedSites.includes(siteType)) {
          allowed = true;
        } else {
          const requested = travelMode === "ride" ? "taxi" : travelMode;
          const currentSite = SITE_LABELS[siteType] || "this website";
          reason = `This looks like a ${currentSite} website, so I can't book a ${requested} here.`;
        }
      } else if ([
        "flight_booking",
        "train_booking",
        "ride_hailing",
        "bus_booking",
        "hotel_booking"
      ].includes(siteType)) {
        allowed = true;
      } else {
        reason = "This website does not look like a travel booking site for that task.";
      }

      break;
    }

    case "food_order":
      if (siteType === "food_ordering") {
        allowed = true;
      } else {
        reason = "This website cannot order food.";
      }
      break;

    case "shopping":
      if (siteType === "ecommerce") {
        allowed = true;
      } else {
        reason = "Shopping actions are not supported on this website.";
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
    reason,
    siteType,
    travelMode
  };
}
