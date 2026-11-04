// 应用设置：存储目录、全局快捷键等。保存在 Electron 的 userData 目录下。
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// 应用早期叫 AI Notes，改名 Notedesk 后 userData 和默认笔记目录都变了。
// 下面两处兼容让老数据继续可用，不需要用户手动搬家。
const LEGACY_APP_NAME = 'AI Notes';

function legacySettingsPath() {
  return path.join(path.dirname(app.getPath('userData')), LEGACY_APP_NAME, 'settings.json');
}

function defaultNotesDir() {
  const docs = app.getPath('documents');
  const legacy = path.join(docs, LEGACY_APP_NAME);
  // 老目录还在就继续用它，避免改名后看到一个空笔记库
  try {
    if (fs.statSync(legacy).isDirectory()) return legacy;
  } catch {
    /* 老目录不存在，用新的 */
  }
  return path.join(docs, 'Notedesk');
}

function defaults() {
  return {
    notesDir: defaultNotesDir(),
    shortcut: 'CommandOrControl+Shift+S',
    limitHours: 5, // GPT 等服务的使用限额时长（小时），用于"任务"的恢复提醒
    recentFiles: [], // 「文稿」分区最近打开过的 Markdown 文件
    lastFolder: '', // 「文稿」分区上次打开的文件夹
  };
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function load() {
  // 新位置没有设置时，把改名前那份搬过来
  const saved = readJson(settingsPath()) || readJson(legacySettingsPath());
  return { ...defaults(), ...(saved || {}) };
}

function save(partial) {
  const next = { ...load(), ...partial };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { load, save, defaults };
