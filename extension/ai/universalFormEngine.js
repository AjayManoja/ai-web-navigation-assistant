let universalForms = []

const FIELD_SYNONYMS = {

ORIGIN: [
"from",
"origin",
"departure",
"depart",
"leaving",
"flying from",
"starting point",
"source",
"pickup"
],

DESTINATION: [
"to",
"destination",
"arrival",
"going",
"drop",
"dropoff",
"arrival city",
"where to"
],

DATE: [
"date",
"departure date",
"travel date",
"depart date",
"when"
],

RETURN_DATE: [
"return",
"return date",
"back date",
"coming back"
],

PASSENGERS: [
"passenger",
"passengers",
"traveller",
"travellers",
"people",
"guests"
]

}


function normalize(text){

if(!text) return ""

return text
.toLowerCase()
.replace(/[^a-z0-9 ]/g," ")
.replace(/\s+/g," ")
.trim()

}


function extractLabel(el){

if(el.id){

const label = document.querySelector(`label[for="${el.id}"]`)

if(label) return label.innerText

}

const prev = el.previousElementSibling

if(prev && prev.innerText){
return prev.innerText
}

if(el.parentElement){

const text = el.parentElement.innerText

if(text && text.length < 80)
return text

}

return ""

}


function getNearbyText(el){

let text = ""

const rect = el.getBoundingClientRect()

const nodes = document.querySelectorAll("label,span,div,p,strong")

nodes.forEach(node=>{

const r = node.getBoundingClientRect()

const dx = Math.abs(r.x - rect.x)
const dy = Math.abs(r.y - rect.y)

if(dx < 300 && dy < 150){

text += " " + node.innerText

}

})

return text

}


function scoreRole(text, synonyms){

text = normalize(text)

let score = 0

synonyms.forEach(word => {

if(text.includes(word)){

score += 5

}

const tokens = text.split(" ")

tokens.forEach(token => {

if(token.startsWith(word.slice(0,4))){
score += 1
}

})

})

return score

}


function classifyFieldRole(el){

const text = normalize(

(el.placeholder || "") +
(el.getAttribute("aria-label") || "") +
(el.name || "") +
(el.id || "") +
extractLabel(el) +
getNearbyText(el)

)

let bestRole = "TEXT_INPUT"
let bestScore = 0

Object.keys(FIELD_SYNONYMS).forEach(role => {

const score = scoreRole(text, FIELD_SYNONYMS[role])

if(score > bestScore){

bestScore = score
bestRole = role

}

})

return bestRole

}


function classifyButtonRole(el){

const text = normalize(

(el.innerText || "") +
(el.getAttribute("aria-label") || "")

)

if(text.includes("search"))
return "SEARCH_BUTTON"

if(text.includes("book"))
return "BOOK_BUTTON"

if(text.includes("submit"))
return "SUBMIT_BUTTON"

if(text.includes("continue"))
return "CONTINUE_BUTTON"

return "BUTTON"

}


function detectUniversalForms(){

universalForms = []

const containers = document.querySelectorAll("form")

containers.forEach(container => {

const inputs = container.querySelectorAll("input, textarea, select")

if(inputs.length < 2) return

const form = {
container: container,
fields: [],
buttons: []
}

inputs.forEach(input => {

const role = classifyFieldRole(input)

form.fields.push({
element: input,
role: role
})

})

const buttons = container.querySelectorAll("button, [role='button'], a")

buttons.forEach(btn => {

const role = classifyButtonRole(btn)

form.buttons.push({
element: btn,
role: role
})

})

if(form.fields.length > 1){

universalForms.push(form)

}

})

console.log("[Universal Forms Detected]", universalForms)

}


function getUniversalForms(){

return universalForms

}