// details-modal.js
// Simple modal open/close logic. Attach event listeners to the Show Details button and close buttons.
// Close on Escape and clicking outside modal.

document.addEventListener('DOMContentLoaded', function () {
  const openBtn = document.getElementById('showDetailsBtn');
  const backdrop = document.getElementById('dm-backdrop');
  const closeBtn = document.getElementById('dm-close');
  const closeBottom = document.getElementById('dm-close-bottom');
  const saveBtn = document.getElementById('dm-save');

  if (!backdrop) return;

  function openModal() {
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    // optionally focus first field
    const first = backdrop.querySelector('input, textarea, select, button');
    if (first) first.focus();
    // prevent body scroll behind modal
    document.documentElement.style.overflow = 'hidden';
  }

  function closeModal() {
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    // return focus to show button
    if (openBtn) openBtn.focus();
  }

  // open on button click
  if (openBtn) openBtn.addEventListener('click', function (e) {
    e.preventDefault();
    openModal();
  });

  // close on cross
  if (closeBtn) closeBtn.addEventListener('click', function (e) {
    e.preventDefault();
    closeModal();
  });

  // close on bottom close button
  if (closeBottom) closeBottom.addEventListener('click', function (e) {
    e.preventDefault();
    closeModal();
  });

  // save (example) — currently just close; wire to real save as needed
  if (saveBtn) saveBtn.addEventListener('click', function (e) {
    e.preventDefault();
    // Example: read values
    // const from = document.getElementById('dm-from').value;
    // const to = document.getElementById('dm-to').value;
    // const desc = document.getElementById('dm-desc').value;
    // TODO: send to server or store locally
    closeModal();
  });

  // close when clicking outside the modal content
  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop) closeModal();
  });

  // close on Esc
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) {
      closeModal();
    }
  });
});
