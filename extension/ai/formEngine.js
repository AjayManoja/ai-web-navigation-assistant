// ai/formEngine.js
// ✅ UPDATED: detectForms now includes div/span-based date pickers,
//             assignSemanticRole maps depart/departure → DEPART_DATE,
//             resolveFieldLabel unchanged (already robust).

let detectedForms = [];

// ─── INTELLIGENT FIELD LABEL RESOLVER ────────────────────────────────────────
function resolveFieldLabel(input) {
    // 1. aria-label
    const aria = (input.getAttribute("aria-label") || "").trim();
    if (aria) return aria;

    // 2. aria-labelledby
    const labelledBy = input.getAttribute("aria-labelledby");
    if (labelledBy) {
        const labelEl = document.getElementById(labelledBy);
        if (labelEl) return (labelEl.innerText || "").trim();
    }

    // 3. Associated <label for="...">
    if (input.id) {
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) return (label.innerText || "").trim();
    }

    // 4. Wrapping <label>
    const parentLabel = input.closest("label");
    if (parentLabel) return (parentLabel.innerText || "").replace(input.value || "", "").trim();

    // 5. Placeholder
    if (input.placeholder) return input.placeholder.trim();

    // 6. Nearest visible text node (within 200px)
    const rect = input.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    let nearest = null, nearestDist = Infinity;
    document.querySelectorAll("label, span, p, div, strong, legend").forEach(node => {
        if (node === input || node.contains(input)) return;
        if (node.closest("#webguide-assistant")) return;
        const text = (node.innerText || "").trim();
        if (!text || text.length > 50) return;
        const nr   = node.getBoundingClientRect();
        const dist = Math.sqrt((cx - (nr.left + nr.width/2))**2 + (cy - (nr.top + nr.height/2))**2);
        if (dist < 200 && dist < nearestDist) { nearestDist = dist; nearest = text; }
    });
    if (nearest) return nearest;

    // 7. name or id as last resort
    return input.name || input.id || "";
}

// ─── SEMANTIC ROLE ASSIGNMENT ─────────────────────────────────────────────────
// ✅ UPDATED: now maps "depart" / "departure" → DEPART_DATE so the planner
//    fieldKey always matches what classifyDateFieldByPosition returns.
function assignSemanticRole(input) {
    const structural = (typeof detectElementRole === "function") ? detectElementRole(input) : null;
    const label      = resolveFieldLabel(input).toLowerCase();

    if (typeof resolveSemanticAlias === "function") {
        const alias = resolveSemanticAlias(label);
        if (alias) return alias.fieldKey;
    }

    // ── Structural date picker ───────────────────────────────────────────────
    if (structural === "date_picker" || structural === "calendar_trigger") {
        if (label.includes("return") || label.includes("back") || label.includes("checkout") || label.includes("check out"))
            return "CHECKOUT_DATE";
        if (label.includes("checkin") || label.includes("check in") || label.includes("check-in"))
            return "CHECKIN_DATE";
        // ✅ NEW: depart/departure → DEPART_DATE (not just generic DATE)
        if (label.includes("depart") || label.includes("departure") || label.includes("outbound") || label.includes("travel"))
            return "DEPART_DATE";
        return "DATE";
    }

    if (structural === "search_select" || structural === "combobox") {
        if (label.includes("from") || label.includes("origin") || label.includes("departure") || label.includes("source"))
            return "ORIGIN";
        if (label.includes("to") || label.includes("destination") || label.includes("arrival"))
            return "DESTINATION";
        return "SEARCH_SELECT";
    }

    if (structural === "counter") {
        if (label.includes("adult"))                          return "ADULTS";
        if (label.includes("child") || label.includes("kid")) return "CHILDREN";
        if (label.includes("room"))                           return "ROOMS";
        return "PASSENGERS";
    }

    // ── Plain text label keywords ────────────────────────────────────────────
    if (label.includes("from") || label.includes("origin"))                 return "ORIGIN";
    if (label.includes("to")   || label.includes("destination"))            return "DESTINATION";
    // ✅ NEW: depart before generic "date"
    if (label.includes("depart") || label.includes("departure"))            return "DEPART_DATE";
    if (label.includes("return"))                                            return "RETURN_DATE";
    if (label.includes("date"))                                              return "DATE";
    if (label.includes("passenger") || label.includes("traveller") || label.includes("guest"))
                                                                             return "PASSENGERS";
    if (label.includes("email"))                                             return "EMAIL";
    if (label.includes("phone") || label.includes("mobile"))                return "PHONE";
    if (label.includes("name"))    return label.includes("last") ? "LAST_NAME" : "NAME";
    if (label.includes("search"))                                            return "SEARCH_INPUT";

    if (typeof classifyElementRole === "function") return classifyElementRole(input);
    return "TEXT_INPUT";
}

// ─── DETECT FORMS ─────────────────────────────────────────────────────────────
// ✅ UPDATED: selector expanded to include div/span date pickers.
//    Any element classified as calendar_trigger by detectElementRole is now
//    included in form field detection even without a standard HTML label.
function detectForms(){
    detectedForms = [];
    const containers = document.querySelectorAll("form, section, div");

    containers.forEach(container => {
        // ✅ EXPANDED selector: includes div/span date-class elements
        const inputs = container.querySelectorAll(
            "input, select, textarea," +
            "[class*='date' i], [class*='calendar' i], [class*='depart' i]," +
            "[class*='checkin' i], [class*='checkout' i], [class*='picker' i]," +
            "[data-date], [data-datepicker], [data-flatpickr]"
        );

        if(inputs.length < 2) return;

        const form   = { container, fields: [] };
        const seen   = new Set();

        inputs.forEach(input => {
            if (seen.has(input)) return;
            seen.add(input);

            // Skip invisible or tiny elements
            if (typeof isVisible === "function" && !isVisible(input)) return;
            const rect = input.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) return;
            if (input.closest("#webguide-assistant")) return;

            const role           = assignSemanticRole(input);
            const structuralRole = (typeof detectElementRole === "function") ? detectElementRole(input) : "text_input";
            const resolvedLabel  = resolveFieldLabel(input);

            form.fields.push({
                element:       input,
                role,
                structuralRole,
                resolvedLabel,
            });
        });

        // Buttons
        const buttons = container.querySelectorAll("button, [role='button'], input[type='submit']");
        buttons.forEach(btn => {
            if (seen.has(btn)) return;
            seen.add(btn);
            const text = (btn.innerText || btn.value || btn.getAttribute("aria-label") || "").toLowerCase();
            let role = "BUTTON";
            if (text.includes("search") || text.includes("find"))             role = "SEARCH_BUTTON";
            else if (text.includes("submit") || text.includes("book") || text.includes("continue"))
                                                                               role = "SUBMIT_BUTTON";
            form.fields.push({ element: btn, role, resolvedLabel: text });
        });

        if(form.fields.length >= 3) detectedForms.push(form);
    });

    console.log("Detected Forms (intelligent):", detectedForms.map(f =>
        f.fields.map(field => ({
            role: field.role, label: field.resolvedLabel, structural: field.structuralRole
        }))
    ));
}

function getForms(){
    return detectedForms;
}