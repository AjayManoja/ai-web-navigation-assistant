// ui/voiceInput.js

let _voiceRecognition = null;
let _voiceSupported = false;
let _voiceListening = false;
let _voiceProcessing = false;
let _voiceFinalizing = false;
let _voiceLastTranscript = "";

function _getSpeechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isVoiceNavigationSupported() {
  return !!_getSpeechRecognitionCtor();
}

function isVoiceNavigationListening() {
  return _voiceListening;
}

function _syncVoiceUi() {
  if (typeof setMicButtonState === "function") {
    setMicButtonState({
      supported: _voiceSupported,
      listening: _voiceListening,
      processing: _voiceProcessing
    });
  }
}

function stopVoiceNavigation(options = {}) {
  const { silent = false } = options;

  if (_voiceRecognition) {
    try { _voiceRecognition.onresult = null; } catch (e) {}
    try { _voiceRecognition.onend = null; } catch (e) {}
    try { _voiceRecognition.onerror = null; } catch (e) {}
    try { _voiceRecognition.stop(); } catch (e) {}
  }

  _voiceListening = false;
  _voiceProcessing = false;
  _voiceFinalizing = false;
  _syncVoiceUi();

  if (!silent && typeof addMessage === "function") {
    addMessage("AI", "Voice input stopped.");
  }
}

function startVoiceNavigation() {
  const SpeechRecognitionCtor = _getSpeechRecognitionCtor();
  _voiceSupported = !!SpeechRecognitionCtor;
  _syncVoiceUi();

  if (!SpeechRecognitionCtor) {
    if (typeof addMessage === "function") {
      addMessage("AI", "Voice input isn't supported in this browser.");
    }
    return false;
  }

  if (_voiceListening || _voiceProcessing) {
    return true;
  }

  const input = document.getElementById("chatInput");
  const recognition = new SpeechRecognitionCtor();
  _voiceRecognition = recognition;
  _voiceLastTranscript = "";
  _voiceListening = true;
  _voiceProcessing = false;
  _voiceFinalizing = false;

  recognition.lang = "en-IN";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onstart = () => {
    _voiceListening = true;
    _voiceProcessing = false;
    _syncVoiceUi();
    if (input) input.placeholder = "Listening...";
  };

  recognition.onresult = (event) => {
    let interimTranscript = "";
    let finalTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0]?.transcript || "";
      if (event.results[i].isFinal) finalTranscript += transcript;
      else interimTranscript += transcript;
    }

    const combined = (finalTranscript || interimTranscript || "").trim();
    if (input && combined) input.value = combined;

    if (finalTranscript.trim()) {
      _voiceLastTranscript = finalTranscript.trim();
      _voiceFinalizing = true;
      _voiceListening = false;
      _voiceProcessing = true;
      _syncVoiceUi();
      if (input) input.placeholder = "Processing voice input...";
    }
  };

  recognition.onerror = (event) => {
    _voiceListening = false;
    _voiceProcessing = false;
    _syncVoiceUi();

    const inputEl = document.getElementById("chatInput");
    if (inputEl) inputEl.placeholder = "Ask anything";

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      if (typeof addMessage === "function") addMessage("AI", "Microphone access is blocked. Please allow mic access and try again.");
    } else if (event.error === "no-speech") {
      if (typeof addMessage === "function") addMessage("AI", "I couldn't hear anything. Please try again.");
    } else if (event.error !== "aborted") {
      if (typeof addMessage === "function") addMessage("AI", "Voice input ran into a problem. Please try again.");
    }
  };

  recognition.onend = () => {
    const transcript = (_voiceLastTranscript || "").trim();
    const inputEl = document.getElementById("chatInput");

    _voiceListening = false;

    if (_voiceFinalizing && transcript) {
      _voiceProcessing = true;
      _voiceFinalizing = false;
      _syncVoiceUi();

      const submitted = typeof submitAssistantQuery === "function"
        ? submitAssistantQuery(transcript)
        : false;

      _voiceProcessing = false;
      _syncVoiceUi();

      if (!submitted && typeof addMessage === "function") {
        addMessage("AI", "I heard you, but couldn't submit the request. Please try again.");
      }
    } else {
      _voiceProcessing = false;
      _voiceFinalizing = false;
      _syncVoiceUi();
    }

    _voiceLastTranscript = "";
    if (inputEl) inputEl.placeholder = "Ask anything";
  };

  try {
    recognition.start();
    _syncVoiceUi();
    return true;
  } catch (err) {
    _voiceListening = false;
    _voiceProcessing = false;
    _voiceFinalizing = false;
    _syncVoiceUi();
    if (typeof addMessage === "function") {
      addMessage("AI", "I couldn't start voice input. Please try again.");
    }
    return false;
  }
}

function toggleVoiceNavigation() {
  if (_voiceListening || _voiceProcessing) {
    stopVoiceNavigation({ silent: true });
    return;
  }
  startVoiceNavigation();
}

function initializeVoiceNavigation() {
  _voiceSupported = isVoiceNavigationSupported();
  _syncVoiceUi();
}
