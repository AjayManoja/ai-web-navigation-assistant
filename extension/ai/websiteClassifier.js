// ai/websiteClassifier.js

function normalize(text) {
  if (!text) return "";

  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SITE_SIGNALS = {
  flight_booking: [
    "flight",
    "flights",
    "airline",
    "airport",
    "depart",
    "return",
    "traveller",
    "passenger",
    "multi city",
    "one way"
  ],
  train_booking: [
    "train",
    "trains",
    "rail",
    "railway",
    "station",
    "pnr",
    "coach",
    "berth",
    "quota",
    "irctc"
  ],
  ride_hailing: [
    "cab",
    "cabs",
    "taxi",
    "ride",
    "rides",
    "pickup",
    "drop",
    "dropoff",
    "ola",
    "uber"
  ],
  bus_booking: [
    "bus",
    "buses",
    "boarding point",
    "dropping point",
    "seat selection",
    "redbus"
  ],
  hotel_booking: [
    "hotel",
    "hotels",
    "check in",
    "check out",
    "room",
    "rooms",
    "guest",
    "guests",
    "stay"
  ],
  food_ordering: [
    "restaurant",
    "menu",
    "food",
    "add to cart",
    "order food",
    "dish"
  ],
  ecommerce: [
    "buy now",
    "add to cart",
    "product",
    "price",
    "wishlist",
    "checkout"
  ],
  banking: [
    "account",
    "transfer",
    "balance",
    "transaction",
    "netbanking",
    "ifsc",
    "upi"
  ]
};

const HOST_HINTS = {
  "irctc": "train_booking",
  "ixigo": "train_booking",
  "redrail": "train_booking",
  "indianrail": "train_booking",
  "ola": "ride_hailing",
  "uber": "ride_hailing",
  "rapido": "ride_hailing",
  "redbus": "bus_booking",
  "abhibus": "bus_booking",
  "makemytrip": "flight_booking",
  "skyscanner": "flight_booking",
  "goibibo": "flight_booking",
  "booking": "hotel_booking",
  "airbnb": "hotel_booking"
};

function getPageSignals() {
  let text = "";

  text += document.body.innerText || "";

  document.querySelectorAll("input").forEach(el => {
    text += " " + (el.placeholder || "");
  });

  document.querySelectorAll("button, a, [role='button']").forEach(el => {
    text += " " + (el.innerText || "");
  });

  document.querySelectorAll("meta").forEach(el => {
    text += " " + (el.content || "");
  });

  return normalize(text);
}

function scoreCategory(pageText, keywords) {
  let score = 0;

  keywords.forEach(word => {
    if (pageText.includes(word)) score += 5;
  });

  return score;
}

function resolveHostHint(hostname) {
  const host = normalize(hostname || "");

  for (const [token, siteType] of Object.entries(HOST_HINTS)) {
    if (host.includes(token)) return siteType;
  }

  return null;
}

function classifyWebsite() {
  const pageText = getPageSignals();
  const url = window.location.hostname.toLowerCase();
  const hostHint = resolveHostHint(url);

  let bestType = hostHint || "generic";
  let bestScore = hostHint ? 20 : 0;

  Object.keys(SITE_SIGNALS).forEach(type => {
    const score = scoreCategory(pageText, SITE_SIGNALS[type]);

    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  });

  const result = {
    siteType: bestType,
    url,
    confidence: bestScore,
    hostHint
  };

  console.log("Website Classification:", result);

  return result;
}
