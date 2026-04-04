let lockedFields = new Set();

function lockField(element){

if(!element) return;

lockedFields.add(element);

console.log("[FIELD LOCKED]", element);

}

function isFieldLocked(element){

return lockedFields.has(element);

}

function clearFieldLocks(){

lockedFields.clear();

}