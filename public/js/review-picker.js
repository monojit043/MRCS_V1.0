// Turns a plain <select id="pickerId"></select> into a searchable, Excel-style
// combobox (type to filter, click/Enter to pick) — same pattern used for the
// Assign Leads "Select Review" picker. The <select> stays in the DOM (hidden)
// as the source of truth, so external "change" listeners keep working unchanged.
async function initReviewPicker(pickerId, onSelect) {
  const picker = document.getElementById(pickerId);
  if (!picker) return;

  const wrap = document.createElement("div");
  wrap.className = "combo-wrap";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "combo-input";
  searchInput.autocomplete = "off";
  searchInput.placeholder = "Search or select a review…";

  const caret = document.createElement("span");
  caret.className = "combo-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.innerHTML = "&#9662;";

  // Appended to <body> and positioned via getBoundingClientRect (not a normal
  // in-flow child of .combo-wrap) so it can't be visually occluded by a sibling
  // .form-card later in the DOM sharing the same stacking-context z-index.
  const dropdown = document.createElement("div");
  dropdown.className = "combo-dropdown";
  dropdown.style.display = "none";

  picker.parentNode.insertBefore(wrap, picker);
  wrap.appendChild(searchInput);
  wrap.appendChild(caret);
  wrap.appendChild(picker);
  document.body.appendChild(dropdown);
  picker.style.display = "none";

  function positionDropdown() {
    const rect = searchInput.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${rect.width}px`;
  }

  let reviewList = [];

  try {
    const data = await apiFetch("/api/initiation/dropdown");
    reviewList = data.options || [];
    picker.innerHTML = '<option value="">— Select Model Review —</option>';
    reviewList.forEach(opt => {
      const el = document.createElement("option");
      el.value = `${opt.job_no}|${opt.unit_no}|${opt.stage}`;
      el.textContent = `${opt.job_no}  /  ${opt.unit_no}  /  ${opt.stage}`;
      picker.appendChild(el);
    });
  } catch (err) {
    picker.innerHTML = '<option value="">— No reviews available —</option>';
  }

  function formatLabel(opt) {
    return `${opt.job_no} / ${opt.unit_no} / ${opt.stage}`;
  }

  function renderDropdown(filterText) {
    const term = (filterText || "").trim().toLowerCase();
    const matches = reviewList.filter(opt =>
      !term || `${opt.job_no} ${opt.unit_no} ${opt.stage}`.toLowerCase().includes(term)
    );
    dropdown.innerHTML = matches.length
      ? matches.map(opt => `
          <div class="combo-item" data-value="${opt.job_no}|${opt.unit_no}|${opt.stage}">
            ${formatLabel(opt)}
          </div>
        `).join("")
      : `<div class="combo-empty">No matching reviews</div>`;
    positionDropdown();
    dropdown.style.display = "block";
    wrap.classList.add("combo-wrap--open");
  }

  function closeDropdown() {
    dropdown.style.display = "none";
    wrap.classList.remove("combo-wrap--open");
  }

  function selectReview(value, label) {
    picker.value = value;
    searchInput.value = label || "";
    closeDropdown();
    picker.dispatchEvent(new Event("change"));
  }

  function openDropdown() {
    // Always show the full list on open — a previously-selected label
    // (e.g. "A100 / 100 / 90%") isn't a valid filter term against the
    // "job unit stage" match string, so reusing it here found nothing.
    renderDropdown("");
    searchInput.select();
  }

  searchInput.addEventListener("input", () => renderDropdown(searchInput.value));

  // "focus" alone misses the case where the field is already focused (e.g.
  // right after picking an item) — a same-element click doesn't re-fire focus,
  // so binding "click" too keeps re-opening working without a page reload.
  searchInput.addEventListener("focus", openDropdown);
  searchInput.addEventListener("click", openDropdown);

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = dropdown.querySelector(".combo-item");
      if (first) selectReview(first.dataset.value, first.textContent.trim());
    } else if (e.key === "Escape") {
      closeDropdown();
      searchInput.blur();
    }
  });

  // Revert to the confirmed selection (or blank) if the user clicks/tabs away
  // without picking an item from the dropdown.
  searchInput.addEventListener("blur", () => {
    setTimeout(() => {
      closeDropdown();
      const [jobNo, unitNo, stage] = (picker.value || "").split("|");
      const match = reviewList.find(o => o.job_no === jobNo && o.unit_no === unitNo && o.stage === stage);
      searchInput.value = match ? formatLabel(match) : "";
    }, 150);
  });

  dropdown.addEventListener("mousedown", (e) => {
    const item = e.target.closest(".combo-item");
    if (!item) return;
    e.preventDefault(); // keep focus/blur timing predictable
    selectReview(item.dataset.value, item.textContent.trim());
  });

  // Belt-and-suspenders: since the dropdown lives in document.body (not
  // nested under this panel), it isn't auto-hidden if the panel is switched
  // away from without the input naturally blurring first (e.g. a non-focusable
  // nav element). A stray click anywhere outside closes it.
  document.addEventListener("click", (e) => {
    if (dropdown.style.display === "none") return;
    if (wrap.contains(e.target) || dropdown.contains(e.target)) return;
    closeDropdown();
  });

  picker.addEventListener("change", () => {
    const [jobNo = "", unitNo = "", stage = ""] =
      picker.value ? picker.value.split("|") : [];
    if (typeof onSelect === "function") onSelect(jobNo, unitNo, stage);
  });
}
