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
