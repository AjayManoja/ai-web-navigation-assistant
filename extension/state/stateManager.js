// ----------------------------------------------------
// GLOBAL AGENT STATE
// ----------------------------------------------------

const state = {

  goal: null,
  plan: null,
  currentPhase: 0,
  currentStep: 0,
  pageContext: null,
  chatHistory: [],

  // Phase-6 additions
  pageURL: null,
  retryCount: 0,
  maxRetries: 3,
  lastActionTime: null

};


// ----------------------------------------------------
// STATE HELPERS
// ----------------------------------------------------

function resetExecution(){

  state.currentPhase = 0
  state.currentStep = 0
  state.retryCount = 0

}


function recordAction(){

  state.lastActionTime = Date.now()

}


function incrementRetry(){

  state.retryCount += 1

}


function resetRetry(){

  state.retryCount = 0

}


// ----------------------------------------------------
// EXPOSE FUNCTIONS GLOBALLY
// ----------------------------------------------------

window.state = state
window.recordAction = recordAction
window.incrementRetry = incrementRetry
window.resetRetry = resetRetry
window.resetExecution = resetExecution