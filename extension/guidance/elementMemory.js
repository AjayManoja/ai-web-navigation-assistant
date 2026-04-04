// guidance/elementMemory.js

const elementMemory = new Map();

function rememberElement(target, element){

if(!target || !element) return;

elementMemory.set(target.toLowerCase(), element);

}

function recallElement(target){

if(!target) return null;

const el = elementMemory.get(target.toLowerCase());

if(!el) return null;

if(!document.contains(el)) return null;

return el;

}

function clearMemory(){

elementMemory.clear();

}

function debugMemory(){

console.log("Agent Memory:", elementMemory);

}
