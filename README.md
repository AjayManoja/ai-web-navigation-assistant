# 🤖 Norman AI

<p align="center">
  ✨ An AI browser assistant that turns a plain-English request into clicks, typing, and form filling.
</p>

<p align="center">
  <a href="#-what-is-norman">What is Norman?</a> •
  <a href="#-what-it-can-do">Features</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-how-it-works">How It Works</a> •
  <a href="#-under-the-hood">Under the Hood</a> •
  <a href="#-contributing">Contributing</a>
</p>

---

## 👋 What is Norman?

Filling out the same kinds of web forms over and over is tedious. Norman does it for you.

Tell it what you want, for example:

> *"Book a flight from Delhi to Mumbai on 15 April 2026"*

Norman reads the page, works out the steps, and carries them out in your browser tab. It types into fields, picks from autocomplete dropdowns, moves through date pickers, and clicks buttons, just as you would.

Norman has two parts:

- 🧩 A Chrome extension (Manifest V3). It shows the chat widget and acts on the page.
- 🖥️ A small Node.js server. It talks to the AI models that do the thinking.

## 🌟 What It Can Do

- 💬 Understands plain English. Describe your task the way you'd say it to a friend.
- 🙋 Asks when something is missing. No date or passenger count? Norman asks first, then acts.
- 🔍 Finds form fields on any site, including custom inputs built with React, Vue, Angular, and Alpine.js.
- ⚡ Carries out the task: text fields, dropdowns, date pickers, and buttons.
- 🖼️ Reads screenshots and PDFs. Upload a resume or a ticket, and Norman fills the form using its details (via Gemini Vision).
- ✅ Checks the site first. If the current website can't do what you asked, Norman tells you and suggests where to go instead.
- 🧠 Remembers each site. It learns from your corrections, so it gets faster and more accurate each time you use it.

## 🚀 Getting Started

⏱️ Setup takes about five minutes: start the server, load the extension, and you're ready.

### 🧰 What you'll need

- 🟢 Node.js v18 or later, with npm
- 🌐 Google Chrome, Microsoft Edge, or Brave
- 🔑 A [Groq API key](https://console.groq.com/) (required)
- 👁️ A [Google Gemini API key](https://aistudio.google.com/apikey) (optional, turns on the vision features)

### 1️⃣ Get the code

```bash
git clone https://github.com/AjayManoja/ai-web-navigation-assistant.git
cd ai-web-navigation-assistant
```

### 2️⃣ Start the backend

```bash
cd backend
npm install
```

Create a `.env` file inside the `backend/` folder:

```env
GROQ_API_KEY=gsk_your_groq_api_key_here
PORT=5000
```

Then start the server:

```bash
npm start
```

The server now runs at `http://localhost:5000`.

### 3️⃣ Load the extension

1. Open Chrome and go to `chrome://extensions/`.
2. Turn on Developer mode (top-right corner).
3. Click Load unpacked and select the `extension/` folder.

The Norman widget now appears in the bottom-right corner of every web page.

### 4️⃣ Add Gemini (optional)

To turn on screenshot analysis, PDF reading, and site checks, open the ⋮ menu on the widget, go to Settings, and paste in your Gemini API key.

### 5️⃣ Try it

Open a travel, shopping, or form-heavy site such as Google Flights, Booking.com, or Amazon, and type something like:

- ✈️ *"Book a flight from Delhi to Mumbai on 15 April 2026"*
- 🎧 *"Search for wireless headphones under $50"*
- 📄 *"Fill this form with the data from my resume"* (attach a PDF)

Norman asks about anything missing, plans the steps, and then does them.

## ⚙️ How It Works

Every request goes through the same four stages.

### 🗣️ Step 1: Understand the request

Your message goes to the backend's `/chat` endpoint. If an important detail is missing, such as a travel date, Norman asks a follow-up question. Once it has everything it needs, it combines the whole conversation into one clear goal.

### 🗺️ Step 2: Plan the steps

Norman takes a snapshot of the page, listing every interactive element with its label, role, and position. It sends the snapshot and your goal to the AI, which returns a step-by-step plan like this:

```json
{ "action": "search_select", "target": "origin", "value": "Delhi" }
```

### 🎯 Step 3: Find the right element

A plan step says "origin", but Norman still has to find the actual input box on the page. It tries ten strategies in order, from quickest to most thorough, and stops at the first one that works:

1. Elements already confirmed in this session
2. Selectors saved for this website from earlier visits
3. The page snapshot index
4. The session's element cache
5. Direct attributes: `id`, `name`, `placeholder`, `aria-label`
6. The field's `<label>` text
7. A fuzzy search across placeholders and aria labels
8. Scoring by word overlap, position, and surrounding context
9. Synonym matching (for example, "from" and "origin" mean the same field)
10. Screenshot analysis with Gemini Vision, or asking you to point it out

### 🖱️ Step 4: Carry it out

Modern web frameworks often ignore a plain `click()`. So Norman sends the full sequence of pointer and mouse events, and if that still doesn't work, it calls the framework's own handler directly:

| Framework | How Norman triggers the click |
|---|---|
| React | Calls `onClick` via `__reactFiber$` / `__reactProps$` |
| Vue 2 / 3 | Uses component emitters via `__vue__` / `__vueParentComponent` |
| Angular | Fires `__zone_symbol__click` listeners |
| Alpine.js | Invokes handlers through `_x_dataStack` |

### 🧠 And it keeps learning

Each time you use Norman, it saves what worked:

- 💾 Field memory: selectors that worked on each website, reused right away next time.
- 🚫 Rejection list: elements you said were wrong are skipped from then on.
- ✏️ Correction patterns: which of your phrases match which fields on each site.
- 📊 Adaptive scoring: how much weight to give structure versus position, adjusted from your feedback.

## 🔧 Under the Hood

This section is for anyone who wants to read or change the code.

### 🏗️ Architecture

```text
┌──────────────────────── Chrome Browser ────────────────────────┐
│                                                                │
│   Norman Widget  ◄──►  Content Scripts                         │
│                        (AI engine · observer · matcher ·       │
│                         planner · executor · state)            │
│                                                                │
└───────────────────────────────┬────────────────────────────────┘
                                │  HTTP (localhost:5000)
                                ▼
                       ┌──────────────────┐
                       │ Express Backend  │
                       └────┬────────┬────┘
                            ▼        ▼
                  Groq (Llama 3.3)  Gemini 1.5 Flash
                  chat & planning   vision & OCR
```

### 🛠️ Tech stack

| Part | Technology |
|---|---|
| Backend | Node.js (CommonJS), Express 5 |
| Chat and planning | Groq API, Llama 3.3 70B Versatile |
| Vision and OCR | Google Gemini 1.5 Flash |
| Extension | Chrome Manifest V3, vanilla JavaScript (ES6+), custom CSS |
| Storage | `chrome.storage.local`, falling back to `localStorage` |

### 📁 Project structure

```text
Norman AI/
├── backend/
│   ├── server.js                  # Express server, API endpoints, LLM calls
│   ├── package.json
│   └── routes/guide.js            # Placeholder route
│
└── extension/
    ├── manifest.json              # Extension config
    ├── content.js                 # Entry point, ties everything together
    ├── styles.css                 # Widget styling
    │
    ├── ai/                        # Understanding pages and intent
    │   ├── capabilityAnalyzer.js  #   Can this site do the task?
    │   ├── formEngine.js          #   Detects forms and inputs
    │   ├── intentParser.js        #   Pulls details (like dates) from requests
    │   ├── stepExplainer.js       #   Short explanations for each step
    │   ├── uiRoleClassifier.js    #   Recognises widget types
    │   ├── universalFormEngine.js #   Synonym-based field matching
    │   └── websiteClassifier.js   #   Site type (travel, food, etc.)
    │
    ├── controller/
    │   └── executionController.js #   Clicks, date pickers, dropdowns
    │
    ├── guidance/                  # Finding and highlighting elements
    │   ├── elementMatcher.js      #   The 10-step matching pipeline
    │   ├── elementMemory.js       #   Element cache
    │   ├── fieldLock.js           #   Stops refilling finished fields
    │   └── highlightEngine.js     #   Highlights and scrolls to elements
    │
    ├── observer/                  # Watching the page
    │   ├── domCache.js            #   Builds page snapshots
    │   └── pageObserver.js        #   Detects DOM and URL changes
    │
    ├── planner/
    │   └── plannerClient.js       #   Requests and merges plans
    │
    ├── state/                     # Sessions and recovery
    │   ├── recoveryEngine.js      #   Retries and page-change recovery
    │   ├── sessionManager.js      #   Saved sessions, field memory, blacklists
    │   └── stateManager.js        #   Current agent state
    │
    └── ui/
        └── assistantUI.js         #   Chat widget, uploads, settings
```

### 🔌 API endpoints

All endpoints accept `POST` with a JSON body.

| Endpoint | What it does | Model |
|---|---|---|
| `/chat` | Holds the conversation and asks follow-up questions | Groq |
| `/plan` | Turns a goal and page snapshot into steps | Groq |
| `/groq-plan` | Same as `/plan` | Groq |
| `/explain` | Explains a step in one short sentence | Groq |
| `/feedback-plan` | Gives manual instructions if an element can't be found | Groq |
| `/page-check` | Checks whether the site can do the task | Gemini |
| `/read-upload` | Extracts data from uploaded PDFs and images | Gemini |
| `/gemini-vision-field` | Finds hard-to-locate elements from a screenshot | Gemini |

<details>
<summary>Example: <code>/chat</code></summary>

Request:

```json
{
  "message": "I want to book a flight from Delhi to Mumbai",
  "conversationHistory": [],
  "userName": "Ajay"
}
```

Response:

```json
{
  "type": "clarify",
  "text": "Hey Ajay! I'd love to help with that. When are you looking to fly? And is this a one-way or round trip?",
  "mergedGoal": null
}
```

</details>

<details>
<summary>Example: <code>/plan</code></summary>

Request:

```json
{
  "goal": "Book a one-way flight from Delhi to Mumbai on 15 April 2026",
  "pageContext": "Google Flights - https://flights.google.com",
  "conversationHistory": [],
  "richSnapshot": { "...DOM snapshot..." }
}
```

Response:

```json
{
  "phases": [
    {
      "name": "Fill Flight Details",
      "steps": [
        { "action": "search_select", "target": "origin", "value": "Delhi" },
        { "action": "search_select", "target": "destination", "value": "Mumbai" },
        { "action": "click_date", "target": "date", "value": "15 Apr 2026" },
        { "action": "click", "target": "search" }
      ]
    }
  ]
}
```

</details>

## 🤝 Contributing

Ideas, bug reports, and pull requests are all welcome! 🎉

1. Fork the repository.
2. Create a branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "Add your feature"`
4. Push the branch: `git push origin feature/your-feature`
5. Open a pull request.

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/AjayManoja">Team Infinity</a>
</p>
