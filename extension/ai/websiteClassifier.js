// ai/websiteClassifier.js

function normalize(text){

if(!text) return ""

return text
.toLowerCase()
.replace(/[^a-z0-9 ]/g," ")
.replace(/\s+/g," ")
.trim()

}


const SITE_SIGNALS = {

travel_booking: [
"flight",
"flights",
"departure",
"arrival",
"depart",
"return",
"traveller",
"passenger",
"airline",
"airport",
"trip"
],

railway_booking: [
"train",
"pnr",
"rail",
"station",
"platform",
"coach",
"irctc"
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

}


// --------------------------------
// TEXT EXTRACTION
// --------------------------------

function getPageSignals(){

let text = ""

text += document.body.innerText || ""

document.querySelectorAll("input").forEach(el=>{
text += " " + (el.placeholder || "")
})

document.querySelectorAll("button").forEach(el=>{
text += " " + (el.innerText || "")
})

document.querySelectorAll("meta").forEach(el=>{
text += " " + (el.content || "")
})

return normalize(text)

}


// --------------------------------
// SCORE CALCULATOR
// --------------------------------

function scoreCategory(pageText, keywords){

let score = 0

keywords.forEach(word=>{

if(pageText.includes(word))
score += 5

})

return score

}


// --------------------------------
// WEBSITE CLASSIFIER V2
// --------------------------------

function classifyWebsite(){

const pageText = getPageSignals()

const url = window.location.hostname.toLowerCase()

let bestType = "generic"
let bestScore = 0

Object.keys(SITE_SIGNALS).forEach(type=>{

const score = scoreCategory(pageText, SITE_SIGNALS[type])

if(score > bestScore){

bestScore = score
bestType = type

}

})

const result = {
siteType: bestType,
url: url
}

console.log("Website Classification:", result)

return result

}