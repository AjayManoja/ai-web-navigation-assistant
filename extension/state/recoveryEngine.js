// ----------------------------------------------------
// STEP FAILURE RECOVERY
// ----------------------------------------------------

function handleStepFailure(step){

console.warn("[RECOVERY] step failed:", step)

incrementRetry()

if(state.retryCount <= state.maxRetries){

console.log("[RECOVERY] retrying step", state.retryCount)

return "retry"

}

console.error("[RECOVERY] max retries reached")

return "abort"

}


// ----------------------------------------------------
// PAGE NAVIGATION DETECTION
// ----------------------------------------------------

function detectPageChange(){

const currentURL = location.href

if(state.pageURL !== currentURL){

console.log("[PAGE CHANGE DETECTED]")

state.pageURL = currentURL

resetRetry()

return true

}

return false

}


// ----------------------------------------------------
// GLOBAL EXPORT
// ----------------------------------------------------

window.handleStepFailure = handleStepFailure
window.detectPageChange = detectPageChange