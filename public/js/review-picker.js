async function initReviewPicker(pickerId, onSelect) {
  const picker = document.getElementById(pickerId);
  if (!picker) return;

  try {
    const data = await apiFetch("/api/initiation/dropdown");
    picker.innerHTML = '<option value="">— Select Model Review —</option>';
    (data.options || []).forEach(opt => {
      const el = document.createElement("option");
      el.value = `${opt.job_no}|${opt.unit_no}|${opt.stage}`;
      el.textContent = `${opt.job_no}  /  ${opt.unit_no}  /  ${opt.stage}`;
      picker.appendChild(el);
    });
  } catch (err) {
    picker.innerHTML = '<option value="">— No reviews available —</option>';
  }

  picker.addEventListener("change", () => {
    const [jobNo = "", unitNo = "", stage = ""] =
      picker.value ? picker.value.split("|") : [];
    if (typeof onSelect === "function") onSelect(jobNo, unitNo, stage);
  });
}
