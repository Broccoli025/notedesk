// 主窗口逻辑
const $ = (sel) => document.querySelector(sel);

const state = {
  notes: [],
  filter: { type: 'all', value: null }, // all | source | tag
  query: '',
  selectedId: null,
  mode: 'preview', // edit | preview
  dirty: false,
  saveTimer: null,
  settings: null,
  kind: 'note', // 当前编辑笔记的类型
  syncTimer: null, // 文档模式回写 Markdown 的防抖
  zone: 'notes', // notes | tasks | docs 三个工作区
  doc: null, // 当前打开的外部 Markdown 文件
  docFiles: [], // 打开的文件夹里的 Markdown 文件
  docFolder: '', // 打开的文件夹路径
  recent: [], // 最近打开过的文件
  panes: { sidebar: false, list: false }, // 左栏 / 中栏是否折叠
  noteTarget: null, // 正在编辑批注的 <mark> 元素
  limitHours: 5,
};

const el = {
  list: $('#list'),
  search: $('#search'),
  navSources: $('#nav-sources'),
  navTags: $('#nav-tags'),
  navTasks: $('#nav-tasks'),
  navAll: $('#nav-all'),
  countAll: $('#count-all'),
  editor: $('#editor'),
  editorEmpty: $('#editor-empty'),
  title: $('#f-title'),
  source: $('#f-source'),
  tags: $('#f-tags'),
  url: $('#f-url'),
  conversation: $('#f-conversation'),
  content: $('#f-content'),
  kindNote: $('#kind-note'),
  kindTask: $('#kind-task'),
  taskFields: $('#task-fields'),
  status_: $('#f-status'),
  resume: $('#f-resume'),
  countdown: $('#countdown'),
  btnResumePrompt: $('#btn-resume-prompt'),
  formatBar: $('#format-bar'),
  noteMeta: $('#note-meta'),
  fileRow: $('#file-row'),
  fPath: $('#f-path'),
  paneNotes: $('#pane-notes'),
  paneTasks: $('#pane-tasks'),
  paneDocs: $('#pane-docs'),
  navFolder: $('#nav-folder'),
  navRecent: $('#nav-recent'),
  folderTitle: $('#docs-folder-title'),
  btnDelete: $('#btn-delete'),
  btnReveal: $('#btn-reveal'),
  fmtBlock: $('#fmt-block'),
  btnToggleDone: $('#btn-toggle-done'),
  preview: $('#preview'),
  status: $('#status'),
  modeEdit: $('#mode-edit'),
  modePreview: $('#mode-preview'),
  btnOpenUrl: $('#btn-open-url'),
};

const SOURCE_LABEL = { claude: 'Claude', gpt: 'GPT', gemini: 'Gemini', other: '其他' };

// ---------- 数据 ----------
async function reload({ keepSelection = true } = {}) {
  state.notes = await window.api.listNotes();
  if (keepSelection && state.selectedId && !state.notes.some((n) => n.id === state.selectedId)) {
    state.selectedId = null;
  }
  // 没有选中项时默认打开列表第一条（文稿区不自动选，避免覆盖用户打开的文件）
  if (!state.selectedId && !state.dirty && state.zone !== 'docs') {
    const first = filteredNotes()[0];
    if (first) state.selectedId = first.id;
  }
  renderSidebar();
  renderList();
  if (!state.dirty && !editorHasFocus()) renderEditor();
}

function filteredNotes() {
  const q = state.query.trim().toLowerCase();
  return state.notes.filter((n) => {
    if (state.filter.type === 'source' && n.source !== state.filter.value) return false;
    if (state.filter.type === 'tag' && !n.tags.includes(state.filter.value)) return false;
    if (state.filter.type === 'task' && !(n.kind === 'task' && n.status === state.filter.value)) return false;
    // 「笔记」分区不混入任务，任务有自己的工作区
    if (state.zone === 'notes' && n.kind === 'task') return false;
    if (!q) return true;
    return (
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q)) ||
      n.url.toLowerCase().includes(q) ||
      (n.conversation || '').toLowerCase().includes(q)
    );
  });
}

function selected() {
  if (state.doc && state.doc.id === state.selectedId) return state.doc;
  return state.notes.find((n) => n.id === state.selectedId) || null;
}

function isExternal() {
  const n = selected();
  return !!(n && n.external);
}

// ---------- 渲染：侧栏 ----------
function renderSidebar() {
  el.paneNotes.classList.toggle('hidden', state.zone !== 'notes');
  el.paneTasks.classList.toggle('hidden', state.zone !== 'tasks');
  el.paneDocs.classList.toggle('hidden', state.zone !== 'docs');
  $('#zone-notes').classList.toggle('active', state.zone === 'notes');
  $('#zone-tasks').classList.toggle('active', state.zone === 'tasks');
  $('#zone-docs').classList.toggle('active', state.zone === 'docs');
  // 文稿分区没有"新建笔记/新建任务"的概念
  $('#btn-new').classList.toggle('hidden', state.zone === 'docs');
  $('#btn-new-task').classList.toggle('hidden', state.zone === 'docs');
  if (state.zone === 'docs') { renderDocsPane(); return; }

  el.countAll.textContent = state.notes.filter((n) => n.kind !== 'task').length;
  el.navAll.classList.toggle('active', state.filter.type === 'all');

  const bySource = {};
  const byTag = {};
  for (const n of state.notes) {
    bySource[n.source] = (bySource[n.source] || 0) + 1;
    for (const t of n.tags) byTag[t] = (byTag[t] || 0) + 1;
  }

  const tasks = state.notes.filter((n) => n.kind === 'task');
  const activeCount = tasks.filter((n) => n.status === 'active').length;
  const doneCount = tasks.length - activeCount;
  el.navTasks.innerHTML = '';
  el.navTasks.appendChild(
    navItem({
      icon: '<span>⏳</span>',
      label: '进行中',
      count: activeCount,
      active: state.filter.type === 'task' && state.filter.value === 'active',
      onClick: () => { state.zone = 'tasks'; setFilter('task', 'active'); },
    })
  );
  if (doneCount > 0) {
    el.navTasks.appendChild(
      navItem({
        icon: '<span>✅</span>',
        label: '已完成',
        count: doneCount,
        active: state.filter.type === 'task' && state.filter.value === 'done',
        onClick: () => { state.zone = 'tasks'; setFilter('task', 'done'); },
      })
    );
  }

  el.navSources.innerHTML = '';
  for (const s of ['claude', 'gpt', 'gemini', 'other']) {
    if (!bySource[s]) continue;
    el.navSources.appendChild(
      navItem({
        icon: `<span class="dot ${s}"></span>`,
        label: SOURCE_LABEL[s],
        count: bySource[s],
        active: state.filter.type === 'source' && state.filter.value === s,
        onClick: () => setFilter('source', s),
      })
    );
  }

  el.navTags.innerHTML = '';
  const tags = Object.keys(byTag).sort((a, b) => byTag[b] - byTag[a] || a.localeCompare(b, 'zh'));
  if (tags.length === 0) {
    el.navTags.innerHTML = '<div class="nav-item" style="color: var(--text-3)">暂无标签</div>';
  }
  for (const t of tags) {
    el.navTags.appendChild(
      navItem({
        icon: '<span style="color: var(--text-3)">#</span>',
        label: t,
        count: byTag[t],
        active: state.filter.type === 'tag' && state.filter.value === t,
        onClick: () => setFilter('tag', t),
      })
    );
  }
}

function renderDocsPane() {
  // 当前文件夹
  el.navFolder.innerHTML = '';
  if (state.docFolder) {
    const name = state.docFolder.split('/').filter(Boolean).pop() || state.docFolder;
    const item = navItem({
      icon: '<span>🗂</span>',
      label: name,
      count: state.docFiles.length,
      active: true,
      onClick: () => refreshFolder(),
    });
    item.title = state.docFolder;
    el.navFolder.appendChild(item);
    const close = navItem({ icon: '<span>✕</span>', label: '关闭文件夹', count: '', active: false, onClick: closeFolder });
    el.navFolder.appendChild(close);
    el.folderTitle.classList.remove('hidden');
  } else {
    el.folderTitle.classList.add('hidden');
  }

  // 最近打开
  el.navRecent.innerHTML = '';
  if (state.recent.length === 0) {
    el.navRecent.innerHTML = '<div class="pane-tip">还没有打开过文件。</div>';
  }
  for (const file of state.recent) {
    const name = file.split('/').pop();
    const item = navItem({
      icon: '<span>📄</span>',
      label: name,
      count: '',
      active: state.doc && state.doc.path === file,
      onClick: () => openDocFile(file),
    });
    item.title = file;
    el.navRecent.appendChild(item);
  }
}

function navItem({ icon, label, count, active, onClick }) {
  const div = document.createElement('div');
  div.className = 'nav-item' + (active ? ' active' : '');
  div.innerHTML = `${icon}<span class="label"></span><span class="count">${count}</span>`;
  div.querySelector('.label').textContent = label;
  div.addEventListener('click', onClick);
  return div;
}

function setFilter(type, value = null) {
  state.filter = { type, value };
  renderSidebar();
  renderList();
}

// ---------- 渲染：列表 ----------
function renderList() {
  if (state.zone === 'docs') return renderDocList();
  const notes = filteredNotes();
  el.list.innerHTML = '';
  if (notes.length === 0) {
    el.list.innerHTML = `<div class="empty">${state.query ? '没有匹配的笔记' : '还没有笔记<br/>按 ⌘N 新建一条'}</div>`;
    return;
  }
  for (const n of notes) {
    const item = document.createElement('div');
    item.className = 'note-item' + (n.id === state.selectedId ? ' active' : '');
    item.innerHTML = `
      <div class="title"></div>
      <div class="snippet"></div>
      <div class="meta">
        <span class="badge ${n.source}">${SOURCE_LABEL[n.source]}</span>
        ${n.kind === 'task' ? '<span class="badge task">任务</span><span class="task-state"></span>' : ''}
        <span class="date">${formatDate(n.updated)}</span>
        <span class="conv"></span>
        <span class="tags"></span>
      </div>`;
    item.querySelector('.title').textContent = n.title;
    if (n.conversation) item.querySelector('.conv').textContent = `💬 ${n.conversation}`;
    if (n.kind === 'task') {
      const st = item.querySelector('.task-state');
      const info = taskStateText(n);
      st.textContent = info.text;
      st.classList.toggle('due', info.due);
    }
    item.querySelector('.snippet').textContent = snippet(n.content);
    const tagsEl = item.querySelector('.tags');
    for (const t of n.tags.slice(0, 4)) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = t;
      tagsEl.appendChild(chip);
    }
    item.addEventListener('click', () => selectNote(n.id));
    el.list.appendChild(item);
  }
}

function renderDocList() {
  const q = state.query.trim().toLowerCase();
  const files = state.docFiles.filter((f) => !q || f.fileName.toLowerCase().includes(q) || (f.relDir || '').toLowerCase().includes(q));
  el.list.innerHTML = '';
  if (!state.docFolder) {
    el.list.innerHTML = '<div class="empty">用左侧「打开文件…」打开单个 Markdown 文件，<br/>或「打开文件夹…」把整个目录列在这里。</div>';
    return;
  }
  if (files.length === 0) {
    el.list.innerHTML = `<div class="empty">${q ? '没有匹配的文件' : '这个文件夹里没有 Markdown 文件'}</div>`;
    return;
  }
  for (const f of files) {
    const item = document.createElement('div');
    const active = state.doc && state.doc.path === f.path;
    item.className = 'note-item' + (active ? ' active' : '');
    item.innerHTML = `<div class="title"></div><div class="meta"><span class="date">${formatDate(f.updated)}</span><span class="conv"></span></div>`;
    item.querySelector('.title').textContent = f.fileName;
    item.querySelector('.conv').textContent = f.relDir ? `📁 ${f.relDir}` : '';
    item.title = f.path;
    item.addEventListener('click', () => openDocFile(f.path));
    el.list.appendChild(item);
  }
}

function snippet(content) {
  return String(content || '')
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/[#>*`_\-\[\]()!]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

// 任务状态文字：进行中 + 倒计时 / 可以继续了 / 已完成
function taskStateText(n) {
  if (n.status === 'done') return { text: '已完成', due: false };
  if (!n.resumeAt) return { text: '进行中', due: false };
  const ms = new Date(n.resumeAt).getTime() - Date.now();
  if (ms <= 0) return { text: '✅ 可以继续了', due: true };
  return { text: `⏳ ${formatDuration(ms)}后恢复`, due: false };
}

function formatDuration(ms) {
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('zh-CN', sameYear ? { month: 'numeric', day: 'numeric' } : { year: 'numeric', month: 'numeric', day: 'numeric' });
}

// ---------- 渲染：编辑区 ----------
async function selectNote(id) {
  if (state.syncTimer) syncFromDoc();
  if (state.dirty) await flushSave();
  state.selectedId = id;
  state.mode = 'preview';
  renderList();
  renderEditor();
}

function renderEditor() {
  const n = selected();
  if (!n) {
    el.editor.classList.add('hidden');
    el.editorEmpty.classList.remove('hidden');
    return;
  }
  el.editorEmpty.classList.add('hidden');
  el.editor.classList.remove('hidden');

  const ext = !!n.external;
  el.noteMeta.classList.toggle('hidden', ext);
  el.fileRow.classList.toggle('hidden', !ext);
  el.btnDelete.classList.toggle('hidden', ext);
  el.btnReveal.classList.toggle('hidden', ext);
  el.title.readOnly = ext; // 外部文件的标题就是文件名，改名要在 Finder 里做
  if (ext) {
    const cut = n.path.lastIndexOf('/');
    el.fPath.innerHTML = '<span class="dir"></span><span class="base"></span>';
    el.fPath.querySelector('.dir').textContent = cut > 0 ? n.path.slice(0, cut) : '';
    el.fPath.querySelector('.base').textContent = cut > 0 ? n.path.slice(cut) : n.path;
    el.fPath.title = n.path;
  }

  el.title.value = n.title;
  el.source.value = n.source;
  el.tags.value = n.tags.join(', ');
  el.url.value = n.url;
  el.conversation.value = n.conversation || '';
  el.content.value = n.content;
  state.kind = n.kind || 'note';
  el.status_.value = n.status || 'active';
  el.resume.value = toLocalInput(n.resumeAt);
  applyKind();
  el.btnOpenUrl.classList.toggle('hidden', ext);
  el.btnOpenUrl.disabled = !n.url;
  el.status.textContent = ext
    ? `修改于 ${new Date(n.updated).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : `创建于 ${new Date(n.created).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  applyMode();
}

function applyKind() {
  const isTask = state.kind === 'task' && !isExternal();
  el.kindNote.classList.toggle('active', !isTask);
  el.kindTask.classList.toggle('active', isTask);
  el.taskFields.classList.toggle('hidden', !isTask);
  el.btnResumePrompt.classList.toggle('hidden', !isTask);
  el.btnToggleDone.classList.toggle('hidden', !isTask);
  el.btnToggleDone.textContent = el.status_.value === 'done' ? '↺ 重新开启' : '✓ 标记完成';
  updateCountdown();
}

function updateCountdown() {
  if (state.kind !== 'task') { el.countdown.textContent = ''; return; }
  const resumeAt = fromLocalInput(el.resume.value);
  if (!resumeAt || el.status_.value === 'done') { el.countdown.textContent = ''; return; }
  const ms = new Date(resumeAt).getTime() - Date.now();
  el.countdown.textContent = ms <= 0 ? '✅ 已到时间，可以继续了' : `⏳ ${formatDuration(ms)}后恢复，到点通知你`;
}

async function setKind(kind) {
  state.kind = kind;
  if (kind === 'task' && !el.content.value.trim()) {
    // 先离开文档模式，避免随后的回写用空文档覆盖掉模板
    if (state.mode !== 'edit') { state.mode = 'edit'; applyMode(); }
    el.content.value = await window.api.taskTemplate();
  }
  applyKind();
  markDirty();
}

function applyMode() {
  const edit = state.mode === 'edit'; // edit = Markdown 源码，preview = 文档所见即所得
  el.modeEdit.classList.toggle('active', edit);
  el.modePreview.classList.toggle('active', !edit);
  el.content.classList.toggle('hidden', !edit);
  el.preview.classList.toggle('hidden', edit);
  el.formatBar.classList.toggle('hidden', edit);
  if (!edit) {
    renderDocView();
  } else {
    el.content.focus();
  }
}

// 把 Markdown 渲染进可编辑的文档区
function renderDocView() {
  el.preview.innerHTML = window.api.renderMarkdown(el.content.value);
  el.preview.setAttribute('contenteditable', 'true');
  el.preview.spellcheck = false;
  // 悬停就能看到批注内容
  el.preview.querySelectorAll('mark[data-note]').forEach((m) => { m.title = m.getAttribute('data-note'); });
}

// 文档区内容回写成 Markdown
function syncFromDoc() {
  clearTimeout(state.syncTimer);
  state.syncTimer = null;
  if (state.mode !== 'preview') return;
  const md = window.api.htmlToMarkdown(el.preview.innerHTML);
  if (md === el.content.value) return;
  el.content.value = md;
  markDirty();
}

// 光标是否停在编辑区，用于避免外部刷新打断输入
function editorHasFocus() {
  const a = document.activeElement;
  return a === el.content || el.preview.contains(a);
}

function setMode(mode) {
  if (mode !== state.mode) syncFromDoc(); // 离开文档模式前先把改动回写成 Markdown
  state.mode = mode;
  applyMode();
}

// ---------- 保存 ----------
function markDirty() {
  state.dirty = true;
  el.status.textContent = '正在编辑…';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, 600);
}

async function flushSave() {
  clearTimeout(state.saveTimer);
  if (state.syncTimer) syncFromDoc();
  if (!state.dirty || !state.selectedId) return;
  const cur = selected();
  if (cur && cur.external) {
    state.dirty = false;
    const res = await window.api.docsWrite({ path: cur.path, content: el.content.value, frontmatter: cur.frontmatter });
    if (res.ok) {
      cur.content = el.content.value;
      cur.updated = res.updated;
      el.status.textContent = `已保存 ${new Date(res.updated).toLocaleTimeString('zh-CN')}`;
      const row = state.docFiles.find((f) => f.path === cur.path);
      if (row) { row.updated = res.updated; renderList(); }
    } else {
      state.dirty = true;
      el.status.textContent = `保存失败：${res.error}`;
    }
    return;
  }

  const payload = {
    id: state.selectedId,
    title: el.title.value,
    source: el.source.value,
    tags: el.tags.value,
    url: el.url.value.trim(),
    conversation: el.conversation.value.trim(),
    content: el.content.value,
    kind: state.kind,
    status: el.status_.value,
    resumeAt: state.kind === 'task' ? fromLocalInput(el.resume.value) : '',
  };
  state.dirty = false;
  const saved = await window.api.saveNote(payload);
  const idx = state.notes.findIndex((n) => n.id === saved.id);
  if (idx >= 0) state.notes[idx] = saved;
  else state.notes.unshift(saved);
  state.notes.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  el.btnOpenUrl.disabled = !saved.url;
  el.status.textContent = `已保存 ${new Date(saved.updated).toLocaleTimeString('zh-CN')}`;
  renderSidebar();
  renderList();
}

async function newNote() {
  if (state.dirty) await flushSave();
  const saved = await window.api.saveNote({
    title: '',
    source: state.filter.type === 'source' ? state.filter.value : 'claude',
    tags: state.filter.type === 'tag' ? [state.filter.value] : [],
    url: '',
    content: '',
  });
  state.notes.unshift(saved);
  state.selectedId = saved.id;
  state.mode = 'edit';
  renderSidebar();
  renderList();
  renderEditor();
  el.title.focus();
}

// ---------- 导出 Word ----------
async function exportCurrent() {
  const n = selected();
  if (!n) return;
  if (state.dirty) await flushSave();
  const res = n.external
    ? await window.api.docsExportDocx({ title: n.title, content: el.content.value, source: 'other', tags: [], url: '' })
    : await window.api.exportDocx([n.id]);
  if (res.ok) el.status.textContent = '已导出 Word 文档';
  else if (res.error) el.status.textContent = `导出失败：${res.error}`;
}

async function exportList() {
  if (state.zone === 'docs') { el.status.textContent = '文稿分区请逐个导出'; return; }
  const ids = filteredNotes().map((n) => n.id);
  if (ids.length === 0) return;
  if (state.dirty) await flushSave();
  const res = await window.api.exportDocx(ids);
  if (res.ok) el.status.textContent = `已导出 ${res.count} 条笔记`;
  else if (res.error) el.status.textContent = `导出失败：${res.error}`;
}

async function newTask() {
  if (state.dirty) await flushSave();
  const saved = await window.api.saveNote({
    title: '',
    source: 'gpt',
    tags: [],
    url: '',
    content: await window.api.taskTemplate(),
    kind: 'task',
    status: 'active',
    resumeAt: '',
  });
  state.notes.unshift(saved);
  state.selectedId = saved.id;
  state.mode = 'edit';
  renderSidebar();
  renderList();
  renderEditor();
  el.title.focus();
}

async function copyResumePrompt() {
  const n = selected();
  if (!n) return;
  if (state.dirty) await flushSave();
  const ok = await window.api.copyResumePrompt(n.id);
  el.status.textContent = ok ? '接续提示已复制，去新对话里粘贴即可' : '复制失败';
}

function toggleDone() {
  el.status_.value = el.status_.value === 'done' ? 'active' : 'done';
  applyKind();
  markDirty();
}

function plusLimit() {
  el.resume.value = toLocalInput(new Date(Date.now() + state.limitHours * 3600 * 1000).toISOString());
  if (el.status_.value === 'done') el.status_.value = 'active';
  applyKind();
  markDirty();
}

async function deleteCurrent() {
  const n = selected();
  if (!n) return;
  if (n.external) { el.status.textContent = '外部文件请在 Finder 里删除'; return; }
  if (!confirm(`删除「${n.title}」？文件会移到废纸篓。`)) return;
  state.dirty = false;
  clearTimeout(state.saveTimer);
  await window.api.deleteNote(n.id);
  state.selectedId = null;
  await reload();
}

// ---------- 左栏 / 中栏折叠 ----------
const PANES_KEY = 'notedesk.panes';

function loadPanes() {
  try {
    const v = JSON.parse(localStorage.getItem(PANES_KEY) || '{}');
    return { sidebar: !!v.sidebar, list: !!v.list };
  } catch {
    return { sidebar: false, list: false }; // 读不到就用默认，不影响使用
  }
}

function applyPanes() {
  const app = document.querySelector('.app');
  app.classList.toggle('hide-sidebar', state.panes.sidebar);
  app.classList.toggle('hide-list', state.panes.list);
  $('#toggle-sidebar').classList.toggle('on', !state.panes.sidebar);
  $('#toggle-list').classList.toggle('on', !state.panes.list);
}

function togglePane(which) {
  state.panes[which] = !state.panes[which];
  try { localStorage.setItem(PANES_KEY, JSON.stringify(state.panes)); } catch { /* 无痕模式等场景忽略 */ }
  applyPanes();
}

// ---------- 高亮与批注 ----------

function currentRange() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  return el.preview.contains(r.commonAncestorContainer) ? r : null;
}

// 光标所在的 mark（没有选中文字时用）
function markAtCaret() {
  const r = currentRange();
  if (!r) return null;
  let n = r.commonAncestorContainer;
  if (n.nodeType === 3) n = n.parentNode;
  return n && n.closest ? n.closest('mark') : null;
}

/**
 * 把选区包进 <mark>，返回新建或命中的 mark 列表。
 * 不走 execCommand：Chromium 会把 <mark> 改写成带内联样式的 <span>，
 * 回写 Markdown 时又会被当成无意义的 span 剥掉。这里直接改 DOM。
 * 跨段落的选区按文本节点逐段加高亮，而不是硬套一个 mark。
 */
function wrapRangeInMarks(range, color) {
  const walker = document.createTreeWalker(el.preview, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (range.intersectsNode(n) && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  // 先把切分位置全部算好，再动 DOM，免得改一处让后面的偏移失效
  const jobs = nodes
    .map((node) => ({
      node,
      start: node === range.startContainer ? range.startOffset : 0,
      end: node === range.endContainer ? range.endOffset : node.nodeValue.length,
    }))
    .filter((j) => j.start < j.end);

  const marks = [];
  for (const { node, start, end } of jobs) {
    const parentMark = node.parentNode && node.parentNode.closest ? node.parentNode.closest('mark') : null;
    if (parentMark) {
      // 已经是高亮，只换颜色
      if (color && color !== 'yellow') parentMark.setAttribute('data-color', color);
      else parentMark.removeAttribute('data-color');
      marks.push(parentMark);
      continue;
    }
    let target = node;
    if (start > 0) target = target.splitText(start);
    if (end - start < target.nodeValue.length) target.splitText(end - start);
    const mark = document.createElement('mark');
    if (color && color !== 'yellow') mark.setAttribute('data-color', color);
    target.parentNode.insertBefore(mark, target);
    mark.appendChild(target);
    marks.push(mark);
  }
  return marks;
}

/**
 * 合并紧挨着的同色同批注 mark。
 * 段落里原本就有高亮时，选区会被切成好几个文本节点，不合并的话
 * Markdown 里会留下一串零碎的 <mark>，看着乱也不好再编辑。
 */
function mergeAdjacentMarks(root) {
  for (const m of [...root.querySelectorAll('mark')]) {
    if (!m.isConnected) continue;
    for (;;) {
      let gap = null;
      let next = m.nextSibling;
      // 两个 mark 之间只隔着空白时，把空白一并并进来
      if (next && next.nodeType === 3 && !next.nodeValue.trim()) { gap = next; next = next.nextSibling; }
      if (!next || next.nodeName !== 'MARK') break;
      if (next.getAttribute('data-color') !== m.getAttribute('data-color')) break;
      if (next.getAttribute('data-note') !== m.getAttribute('data-note')) break;
      if (gap) m.appendChild(gap);
      while (next.firstChild) m.appendChild(next.firstChild);
      next.remove();
    }
  }
  root.normalize();
}

/** 对当前选区或光标所在高亮应用颜色，返回涉及的 mark 列表 */
function markCurrentSelection(color) {
  const r = currentRange();
  if (!r || r.collapsed) {
    const existing = markAtCaret();
    if (!existing) return [];
    if (color && color !== 'yellow') existing.setAttribute('data-color', color);
    else existing.removeAttribute('data-color');
    return [existing];
  }
  const marks = wrapRangeInMarks(r, color);
  mergeAdjacentMarks(el.preview);
  const alive = marks.filter((m) => m.isConnected);
  if (alive.length) {
    // 高亮完把选区落在最后一段上，方便接着加批注
    const sel = window.getSelection();
    sel.removeAllRanges();
    const nr = document.createRange();
    nr.selectNodeContents(alive[alive.length - 1]);
    sel.addRange(nr);
  }
  return alive;
}

function applyHighlight(color) {
  if (state.mode !== 'preview') { el.status.textContent = '请切到「文档」标签页再高亮'; return; }
  const marks = markCurrentSelection(color);
  if (marks.length === 0) { el.status.textContent = '请先选中要高亮的文字'; return; }
  syncFromDoc();
}

function clearHighlight() {
  const r = currentRange();
  if (!r) { el.status.textContent = '请先把光标放到文档里'; return; }
  const marks = [...el.preview.querySelectorAll('mark')].filter((m) => (r.collapsed ? m.contains(r.commonAncestorContainer) : r.intersectsNode(m)));
  if (marks.length === 0) { el.status.textContent = '这里没有高亮'; return; }
  marks.forEach((m) => m.replaceWith(...m.childNodes));
  mergeAdjacentMarks(el.preview);
  syncFromDoc();
}

const noteModal = $('#note-modal');

function openNoteEditor(mark) {
  state.noteTarget = mark;
  $('#note-quote').textContent = mark.textContent;
  $('#note-text').value = mark.getAttribute('data-note') || '';
  $('#note-modal-title').textContent = mark.hasAttribute('data-note') ? '编辑批注' : '添加批注';
  $('#note-delete').classList.toggle('hidden', !mark.hasAttribute('data-note'));
  noteModal.classList.remove('hidden');
  $('#note-text').focus();
}

function startNote() {
  if (state.mode !== 'preview') { el.status.textContent = '请切到「文档」标签页再批注'; return; }
  const marks = markCurrentSelection('yellow');
  if (marks.length === 0) { el.status.textContent = '请先选中要批注的文字'; return; }
  if (marks.length > 1) el.status.textContent = '选区跨了多段，批注加在第一段上';
  openNoteEditor(marks[0]);
}

function closeNoteEditor() {
  noteModal.classList.add('hidden');
  state.noteTarget = null;
}

function saveNote() {
  const mark = state.noteTarget;
  if (!mark) return closeNoteEditor();
  const text = $('#note-text').value.trim();
  if (text) mark.setAttribute('data-note', text);
  else mark.removeAttribute('data-note');
  mark.title = text;
  closeNoteEditor();
  syncFromDoc();
}

function deleteNote() {
  const mark = state.noteTarget;
  if (mark) { mark.removeAttribute('data-note'); mark.removeAttribute('title'); }
  closeNoteEditor();
  syncFromDoc();
}

// ---------- 工作区切换 ----------
async function setZone(zone) {
  if (state.zone === zone) return;
  if (state.syncTimer) syncFromDoc();
  if (state.dirty) await flushSave();
  state.zone = zone;
  state.query = '';
  el.search.value = '';
  el.search.placeholder = zone === 'docs' ? '搜索文件名…' : '搜索标题、内容、标签…';
  if (zone === 'notes') {
    state.filter = { type: 'all', value: null };
    const first = filteredNotes()[0];
    state.selectedId = first ? first.id : null;
  } else if (zone === 'tasks') {
    state.filter = { type: 'task', value: 'active' };
    const first = filteredNotes()[0];
    state.selectedId = first ? first.id : null;
  } else {
    state.selectedId = state.doc ? state.doc.id : null;
  }
  renderSidebar();
  renderList();
  renderEditor();
}

// ---------- 文稿：打开本机 Markdown 文件 ----------
async function loadDocsState() {
  const st = await window.api.docsState();
  state.recent = st.recentFiles || [];
  if (st.lastFolder && !state.docFolder) {
    const res = await window.api.docsListFolder(st.lastFolder);
    if (res.ok) { state.docFolder = res.dir; state.docFiles = res.files; }
  }
  if (state.zone === 'docs') { renderSidebar(); renderList(); }
}

async function openDocFile(file) {
  if (state.syncTimer) syncFromDoc();
  if (state.dirty) await flushSave();
  const res = await window.api.docsRead(file);
  if (!res.ok) { el.status.textContent = `打开失败：${res.error}`; console.error('打开失败', res.error); return; }
  state.doc = res.doc;
  state.selectedId = res.doc.id;
  state.zone = 'docs';
  state.mode = 'preview';
  el.search.placeholder = '搜索文件名…';
  const st = await window.api.docsState();
  state.recent = st.recentFiles || [];
  renderSidebar();
  renderList();
  renderEditor();
}

async function chooseDocFile() {
  const file = await window.api.docsOpenDialog();
  if (file) await openDocFile(file);
}

async function chooseDocFolder() {
  const dir = await window.api.docsOpenFolderDialog();
  if (!dir) return;
  const res = await window.api.docsListFolder(dir);
  if (!res.ok) { el.status.textContent = `读取失败：${res.error}`; return; }
  state.docFolder = res.dir;
  state.docFiles = res.files;
  state.zone = 'docs';
  el.search.placeholder = '搜索文件名…';
  renderSidebar();
  renderList();
}

async function refreshFolder() {
  if (!state.docFolder) return;
  const res = await window.api.docsListFolder(state.docFolder);
  if (res.ok) { state.docFiles = res.files; renderSidebar(); renderList(); }
}

function closeFolder() {
  state.docFolder = '';
  state.docFiles = [];
  renderSidebar();
  renderList();
}

// ---------- 设置 ----------
const modal = $('#settings-modal');
async function openSettings() {
  state.settings = await window.api.getSettings();
  $('#s-dir').value = state.settings.notesDir;
  $('#s-shortcut').value = state.settings.shortcut || '';
  $('#s-limit').value = state.settings.limitHours || 5;
  $('#s-error').textContent = '';
  modal.classList.remove('hidden');
}
function closeSettings() {
  modal.classList.add('hidden');
}
$('#s-choose').addEventListener('click', async () => {
  const dir = await window.api.chooseDir();
  if (dir) $('#s-dir').value = dir;
});
$('#s-open-dir').addEventListener('click', () => window.api.openNotesDir());
$('#s-close').addEventListener('click', closeSettings);
$('#s-save').addEventListener('click', async () => {
  const res = await window.api.setSettings({
    notesDir: $('#s-dir').value,
    shortcut: $('#s-shortcut').value.trim(),
    limitHours: Number($('#s-limit').value) || 5,
  });
  state.limitHours = Number($('#s-limit').value) || 5;
  $('#btn-plus-limit').textContent = `+${state.limitHours}h`;
  if (res.error) {
    $('#s-error').textContent = res.error;
    $('#s-shortcut').value = res.shortcut || '';
    return;
  }
  closeSettings();
  await reload();
});
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeSettings();
});

// ---------- 事件绑定 ----------
$('#toggle-sidebar').addEventListener('click', () => togglePane('sidebar'));
$('#toggle-list').addEventListener('click', () => togglePane('list'));

for (const dot of document.querySelectorAll('.hl-dot')) {
  dot.addEventListener('mousedown', (e) => e.preventDefault()); // 保住文档里的选区
  dot.addEventListener('click', () => applyHighlight(dot.dataset.color));
}
$('#fmt-note').addEventListener('mousedown', (e) => e.preventDefault());
$('#fmt-note').addEventListener('click', startNote);
$('#fmt-hl-clear').addEventListener('mousedown', (e) => e.preventDefault());
$('#fmt-hl-clear').addEventListener('click', clearHighlight);

$('#note-save').addEventListener('click', saveNote);
$('#note-cancel').addEventListener('click', closeNoteEditor);
$('#note-delete').addEventListener('click', deleteNote);
noteModal.addEventListener('click', (e) => { if (e.target === noteModal) closeNoteEditor(); });
$('#note-text').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveNote(); }
});

// 双击带批注的高亮，直接打开批注
el.preview.addEventListener('dblclick', (e) => {
  const mark = e.target.closest && e.target.closest('mark');
  if (mark && mark.hasAttribute('data-note')) { e.preventDefault(); openNoteEditor(mark); }
});

$('#zone-notes').addEventListener('click', () => setZone('notes'));
$('#zone-tasks').addEventListener('click', () => setZone('tasks'));
$('#zone-docs').addEventListener('click', () => setZone('docs'));
$('#docs-open-file').addEventListener('click', chooseDocFile);
$('#docs-open-folder').addEventListener('click', chooseDocFolder);
$('#docs-clear-recent').addEventListener('click', async (e) => {
  e.stopPropagation();
  await window.api.docsClearRecent();
  state.recent = [];
  renderSidebar();
});
$('#btn-doc-reveal').addEventListener('click', () => {
  const n = selected();
  if (n && n.path) window.api.docsReveal(n.path);
});

el.navAll.addEventListener('click', () => setFilter('all'));
el.search.addEventListener('input', () => {
  state.query = el.search.value;
  renderList();
});
$('#btn-new').addEventListener('click', newNote);
$('#btn-new-task').addEventListener('click', newTask);
el.kindNote.addEventListener('click', () => setKind('note'));
el.kindTask.addEventListener('click', () => setKind('task'));
el.btnResumePrompt.addEventListener('click', copyResumePrompt);
el.btnToggleDone.addEventListener('click', toggleDone);
$('#btn-plus-limit').addEventListener('click', plusLimit);
$('#btn-clear-resume').addEventListener('click', () => { el.resume.value = ''; applyKind(); markDirty(); });
el.status_.addEventListener('change', applyKind);
el.resume.addEventListener('change', updateCountdown);
$('#btn-capture').addEventListener('click', () => window.api.openCapture());
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-delete').addEventListener('click', deleteCurrent);
$('#btn-export').addEventListener('click', exportCurrent);
$('#btn-reveal').addEventListener('click', () => state.selectedId && window.api.revealNote(state.selectedId));
el.btnOpenUrl.addEventListener('click', () => {
  const n = selected();
  if (n && n.url) window.api.openExternal(n.url);
});
el.modeEdit.addEventListener('click', () => setMode('edit'));
el.modePreview.addEventListener('click', () => setMode('preview'));

for (const input of [el.title, el.source, el.tags, el.url, el.conversation, el.content, el.status_, el.resume]) {
  input.addEventListener('input', markDirty);
  input.addEventListener('change', markDirty);
}
// ---------- 文档模式：像 Word 一样直接编辑 ----------

// 输入后防抖回写 Markdown
el.preview.addEventListener('input', () => {
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(() => { state.syncTimer = null; syncFromDoc(); }, 400);
});

// contenteditable 里链接不会自己跳转，手动交给系统浏览器
el.preview.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (a) {
    e.preventDefault();
    window.api.openExternal(a.getAttribute('href'));
  }
});

// 粘贴时只取纯文本，避免把网页样式带进来
el.preview.addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text/plain');
  if (text === undefined || text === null) return;
  e.preventDefault();
  document.execCommand('insertText', false, text);
});

function exec(cmd, value) {
  el.preview.focus();
  document.execCommand('styleWithCSS', false, false); // 生成 <b>/<i> 而不是 span 样式
  document.execCommand(cmd, false, value);
  syncFromDoc();
  refreshFormatState();
}

// 工具条按钮高亮与当前段落样式同步
function refreshFormatState() {
  if (state.mode !== 'preview') return;
  for (const btn of el.formatBar.querySelectorAll('.fmt-btn[data-cmd]')) {
    const cmd = btn.dataset.cmd;
    let on = false;
    try { on = document.queryCommandState(cmd); } catch { on = false; }
    btn.classList.toggle('on', on);
  }
  let block = 'p';
  try {
    const v = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
    if (['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(v)) block = v;
  } catch { /* 部分环境不支持查询 */ }
  el.fmtBlock.value = block;
}

el.preview.addEventListener('keyup', refreshFormatState);
el.preview.addEventListener('mouseup', refreshFormatState);

for (const btn of el.formatBar.querySelectorAll('.fmt-btn[data-cmd]')) {
  // mousedown 阻止默认，避免点击按钮时丢失文档里的选区
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => exec(btn.dataset.cmd));
}

el.fmtBlock.addEventListener('change', () => {
  const v = el.fmtBlock.value;
  exec('formatBlock', v === 'p' ? '<p>' : `<${v}>`);
});

$('#fmt-code').addEventListener('mousedown', (e) => e.preventDefault());
$('#fmt-code').addEventListener('click', () => {
  const sel = window.getSelection();
  const text = sel && !sel.isCollapsed ? sel.toString() : '';
  if (!text) { el.status.textContent = '请先选中要变成代码的文字'; return; }
  exec('insertHTML', `<code>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</code>`);
});

$('#fmt-link').addEventListener('mousedown', (e) => e.preventDefault());
$('#fmt-link').addEventListener('click', () => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) { el.status.textContent = '请先选中要加链接的文字'; return; }
  const url = prompt('链接地址', 'https://');
  if (url) exec('createLink', url);
});

$('#fmt-hr').addEventListener('mousedown', (e) => e.preventDefault());
$('#fmt-hr').addEventListener('click', () => exec('insertHTML', '<hr>'));

// ⌘N / ⌘F / ⌘E / ⌘, / ⌘⇧E 由应用菜单的快捷键统一处理，这里只处理 Esc
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!noteModal.classList.contains('hidden')) closeNoteEditor();
    else if (!modal.classList.contains('hidden')) closeSettings();
    else if (document.activeElement === el.search) { el.search.value = ''; state.query = ''; renderList(); el.search.blur(); }
    else if (state.mode === 'edit') { flushSave(); setMode('preview'); }
  }
});

window.api.onNotesChanged(() => reload());
window.api.onNewNote(newNote);
window.api.onFocusSearch(() => { el.search.focus(); el.search.select(); });
window.api.onTogglePreview(() => selected() && setMode(state.mode === 'edit' ? 'preview' : 'edit'));
window.api.onOpenSettings(openSettings);
window.api.onExportCurrent(exportCurrent);
window.api.onExportList(exportList);
window.api.onNewTask(newTask);
window.api.onGotoZone((zone) => setZone(zone));
window.api.onTogglePane((which) => togglePane(which));
window.api.onDocsOpenFile(chooseDocFile);
window.api.onDocsOpenFolder(chooseDocFolder);
window.api.onOpenDoc((file) => openDocFile(file));
window.api.onSelectNote((id) => { state.filter = { type: 'all', value: null }; selectNote(id); });

// 每 30 秒刷新倒计时
setInterval(() => {
  if (state.notes.some((n) => n.kind === 'task' && n.status === 'active' && n.resumeAt)) {
    renderList();
    updateCountdown();
  }
}, 30000);

window.api.getSettings().then((st) => {
  state.limitHours = Number(st.limitHours) || 5;
  $('#btn-plus-limit').textContent = `+${state.limitHours}h`;
});
window.addEventListener('beforeunload', () => { if (state.syncTimer) syncFromDoc(); if (state.dirty) flushSave(); });

state.panes = loadPanes();
applyPanes();
reload();
loadDocsState();
