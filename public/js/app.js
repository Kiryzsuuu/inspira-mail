// ── SIDEBAR TOGGLE ──
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebarOverlay');
const hamburger = document.getElementById('hamburger');
const sidebarClose = document.getElementById('sidebarClose');

function openSidebar() {
  if (sidebar) sidebar.classList.add('open');
  if (overlay) overlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('visible');
  document.body.style.overflow = '';
}
if (hamburger) hamburger.addEventListener('click', openSidebar);
if (sidebarClose) sidebarClose.addEventListener('click', closeSidebar);
if (overlay) overlay.addEventListener('click', closeSidebar);

// ── USER DROPDOWN ──
const userMenuWrap = document.getElementById('userMenuWrap');
const userMenuToggle = document.getElementById('userMenuToggle');
const userDropdown = document.getElementById('userDropdown');

if (userMenuToggle && userDropdown) {
  userMenuToggle.addEventListener('click', function(e) {
    e.stopPropagation();
    userDropdown.classList.toggle('open');
  });
  document.addEventListener('click', function(e) {
    if (userMenuWrap && !userMenuWrap.contains(e.target)) {
      userDropdown.classList.remove('open');
    }
  });
}

// ── FILTER TABS ──
function filterMails(btn, type) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.mail-item').forEach(item => {
    if (type === 'all') { item.style.display = ''; return; }
    if (type === 'unread') { item.style.display = item.dataset.read === 'false' ? '' : 'none'; return; }
    if (type === 'penting') { item.style.display = (item.dataset.tag === 'penting' || item.dataset.tag === 'urgent') ? '' : 'none'; return; }
  });
}

// ── MULTI SELECT DROPDOWNS ──
function toggleDropdown(id) {
  const input = document.getElementById(id + 'Input');
  const dropdown = document.getElementById(id + 'Dropdown');
  if (!input || !dropdown) return;
  const isOpen = dropdown.classList.contains('open');
  document.querySelectorAll('.multi-dropdown').forEach(d => d.classList.remove('open'));
  document.querySelectorAll('.multi-select-input').forEach(i => i.classList.remove('open'));
  if (!isOpen) {
    dropdown.classList.add('open');
    input.classList.add('open');
    const searchInput = dropdown.querySelector('input[type=text]');
    if (searchInput) searchInput.focus();
  }
}

function toggleTag(id, checkbox) {
  const tagsEl = document.getElementById(id + 'Tags');
  const placeholder = document.getElementById(id + 'Placeholder');
  if (!tagsEl) return;
  if (checkbox.checked) {
    const tag = document.createElement('span');
    tag.className = 'selected-tag';
    tag.dataset.value = checkbox.value;
    const label = checkbox.value.length > 30 ? checkbox.value.substring(0, 28) + '…' : checkbox.value;
    tag.innerHTML = label;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '×';
    btn.onclick = function(e) {
      e.stopPropagation();
      tag.remove();
      checkbox.checked = false;
      updatePlaceholder(id);
    };
    tag.appendChild(btn);
    tagsEl.appendChild(tag);
  } else {
    const existing = tagsEl.querySelector('[data-value="' + checkbox.value + '"]');
    if (existing) existing.remove();
  }
  updatePlaceholder(id);
}

function updatePlaceholder(id) {
  const tagsEl = document.getElementById(id + 'Tags');
  const placeholderEl = document.getElementById(id + 'Placeholder');
  if (!tagsEl || !placeholderEl) return;
  placeholderEl.style.display = tagsEl.children.length > 0 ? 'none' : '';
}

// Close dropdowns on outside click
document.addEventListener('click', function(e) {
  if (!e.target.closest('.multi-select-wrap')) {
    document.querySelectorAll('.multi-dropdown').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.multi-select-input').forEach(i => i.classList.remove('open'));
  }
});

// ── KEYBOARD SHORTCUTS ──
document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('searchInput')?.focus();
  }
  if (e.key === 'Escape') {
    closeSidebar();
    if (userDropdown) userDropdown.classList.remove('open');
    document.querySelectorAll('.multi-dropdown').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.multi-select-input').forEach(i => i.classList.remove('open'));
    document.getElementById('searchInput')?.blur();
  }
});

// ── MAIL CHECKBOX ──
document.querySelectorAll('.mail-checkbox').forEach(cb => {
  cb.addEventListener('change', function() {
    const item = this.closest('.mail-item');
    if (item) item.classList.toggle('selected', this.checked);
  });
});

// ── EDITOR TOOLBAR ──
document.querySelectorAll('.toolbar-btn').forEach(btn => {
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    const editor = document.getElementById('editorArea') || document.querySelector('.editor-area');
    if (!editor) return;
    editor.focus();
    const title = this.getAttribute('title');
    if (title === 'Bold') document.execCommand('bold');
    else if (title === 'Italic') document.execCommand('italic');
    else if (title === 'Underline') document.execCommand('underline');
    else if (title === 'Strikethrough') document.execCommand('strikeThrough');
    else if (title === 'Align Left') document.execCommand('justifyLeft');
    else if (title === 'Align Center') document.execCommand('justifyCenter');
    else if (title === 'Align Right') document.execCommand('justifyRight');
    else if (title === 'List') document.execCommand('insertUnorderedList');
  });
});

// ── FLASH MESSAGE AUTO-HIDE ──
const flash = document.querySelector('.flash-msg');
if (flash) {
  setTimeout(() => {
    flash.style.transition = 'opacity .5s';
    flash.style.opacity = '0';
    setTimeout(() => flash.remove(), 500);
  }, 4000);
}

// ── CUSTOM ALERT & CONFIRM (menggantikan native browser dialog) ──
(function () {
  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
  .im-dialog-bg {
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(7,24,64,.55); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    padding: 20px; animation: imFadeIn .15s ease;
  }
  @keyframes imFadeIn { from { opacity:0; } to { opacity:1; } }
  .im-dialog {
    background: #fff; border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,.22);
    width: 100%; max-width: 380px; overflow: hidden;
    animation: imSlideUp .18s cubic-bezier(.34,1.56,.64,1);
  }
  @keyframes imSlideUp { from { transform: translateY(12px) scale(.97); opacity:0; } to { transform: none; opacity:1; } }
  .im-dialog-header {
    padding: 20px 22px 0;
    display: flex; align-items: flex-start; gap: 12px;
  }
  .im-dialog-icon {
    width: 36px; height: 36px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; flex-shrink: 0;
  }
  .im-icon-info    { background: #eff6ff; color: #1a56a8; }
  .im-icon-warn    { background: #fff7ed; color: #d97706; }
  .im-icon-danger  { background: #fff1f2; color: #e11d48; }
  .im-icon-success { background: #f0fdf4; color: #16a34a; }
  .im-dialog-title { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 4px; font-family: inherit; }
  .im-dialog-msg   { font-size: 13.5px; color: #475569; line-height: 1.6; font-family: inherit; }
  .im-dialog-body  { padding: 10px 22px 20px; }
  .im-dialog-footer {
    padding: 0 22px 18px;
    display: flex; justify-content: flex-end; gap: 8px;
  }
  .im-btn {
    padding: 8px 20px; border-radius: 8px; font-size: 13.5px; font-weight: 500;
    cursor: pointer; border: none; transition: all .15s; font-family: inherit;
  }
  .im-btn-cancel { background: #f1f5f9; color: #475569; }
  .im-btn-cancel:hover { background: #e2e8f0; }
  .im-btn-ok     { background: #071840; color: #fff; }
  .im-btn-ok:hover { background: #0f3270; }
  .im-btn-danger { background: #e11d48; color: #fff; }
  .im-btn-danger:hover { background: #be123c; }
  `;
  document.head.appendChild(style);

  function iconSvg(type) {
    if (type === 'danger') return `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 7v4M10 13h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8.62 3.5L2 16h16L11.38 3.5a1.6 1.6 0 00-2.76 0z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    if (type === 'success') return `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 10l4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    if (type === 'warn') return `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5"/><path d="M10 7v3M10 13h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    return `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5"/><path d="M10 7v3M10 13h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }

  function createDialog({ title, message, type = 'info', buttons }) {
    return new Promise(resolve => {
      const bg = document.createElement('div');
      bg.className = 'im-dialog-bg';
      bg.innerHTML = `
        <div class="im-dialog" role="dialog" aria-modal="true">
          <div class="im-dialog-header">
            <div class="im-dialog-icon im-icon-${type}">${iconSvg(type)}</div>
            <div>
              <div class="im-dialog-title">${title}</div>
            </div>
          </div>
          <div class="im-dialog-body">
            <div class="im-dialog-msg">${message}</div>
          </div>
          <div class="im-dialog-footer" id="im-btns"></div>
        </div>`;

      const btnArea = bg.querySelector('#im-btns');
      buttons.forEach(btn => {
        const el = document.createElement('button');
        el.className = `im-btn ${btn.cls}`;
        el.textContent = btn.label;
        el.onclick = () => { bg.remove(); document.body.style.overflow = ''; resolve(btn.value); };
        btnArea.appendChild(el);
      });

      // Close on backdrop
      bg.addEventListener('click', e => {
        if (e.target === bg) { bg.remove(); document.body.style.overflow = ''; resolve(false); }
      });
      // ESC key
      const onKey = e => { if (e.key === 'Escape') { bg.remove(); document.body.style.overflow = ''; resolve(false); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);

      document.body.appendChild(bg);
      document.body.style.overflow = 'hidden';
      // Focus first button
      setTimeout(() => btnArea.querySelector('button')?.focus(), 50);
    });
  }

  // ── Public API ──
  window.showAlert = function (message, { title = 'Informasi', type = 'info' } = {}) {
    return createDialog({ title, message, type, buttons: [
      { label: 'Oke', cls: 'im-btn-ok', value: true }
    ]});
  };

  window.showConfirm = function (message, { title = 'Konfirmasi', type = 'warn', confirmLabel = 'Ya', cancelLabel = 'Batal' } = {}) {
    return createDialog({ title, message, type, buttons: [
      { label: cancelLabel, cls: 'im-btn-cancel', value: false },
      { label: confirmLabel, cls: type === 'danger' ? 'im-btn-danger' : 'im-btn-ok', value: true }
    ]});
  };

  // Override native alert/confirm as fallback
  window._nativeAlert = window.alert;
  window._nativeConfirm = window.confirm;
  window.alert = msg => window.showAlert(String(msg));
  // Note: native confirm is synchronous — pages using async confirm should call showConfirm() directly
})();
