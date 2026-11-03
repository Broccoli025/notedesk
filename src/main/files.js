// 「文稿」分区：打开、读写本机任意 Markdown 文件（笔记库之外的文件）。
const fs = require('fs');
const path = require('path');

const MD_EXT = ['md', 'markdown', 'mdown', 'mkd', 'txt'];
const MAX_RECENT = 15;
const MAX_BYTES = 8 * 1024 * 1024; // 单个文件上限，避免误开巨大文件卡住界面

function isMarkdown(file) {
  return MD_EXT.includes(path.extname(file).slice(1).toLowerCase());
}

/**
 * 读取一个外部 Markdown 文件。
 * 文件若带 YAML frontmatter，原样留存在 frontmatter 字段里，
 * 编辑时只动正文，保存时再原封不动拼回去，避免丢失别的工具写的元数据。
 */
function readDoc(file) {
  const stat = fs.statSync(file);
  if (stat.size > MAX_BYTES) {
    throw new Error(`文件过大（${(stat.size / 1024 / 1024).toFixed(1)} MB），超过 8 MB 上限`);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  return {
    id: 'file:' + file,
    external: true,
    path: file,
    title: path.basename(file, path.extname(file)),
    fileName: path.basename(file),
    dir: path.dirname(file),
    frontmatter,
    content: body,
    created: stat.birthtime.toISOString(),
    updated: stat.mtime.toISOString(),
    // 让外部文件也能走笔记那套渲染和导出
    source: 'other',
    tags: [],
    url: '',
    conversation: '',
    kind: 'note',
    status: 'active',
    resumeAt: '',
  };
}

function writeDoc(file, body, frontmatter) {
  // frontmatter 与正文之间留一个空行，和常见编辑器的写法一致
  const head = frontmatter ? frontmatter.replace(/\n*$/, '\n') + '\n' : '';
  const text = head + String(body || '').replace(/\n*$/, '\n');
  fs.writeFileSync(file, text, 'utf8');
  return fs.statSync(file).mtime.toISOString();
}

// 只切掉文件开头合法的 --- ... --- 块，其余内容一律当正文
function splitFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { frontmatter: '', body: raw };
  return { frontmatter: raw.slice(0, m[0].length), body: raw.slice(m[0].length).replace(/^\n+/, '') };
}

/** 列出文件夹里的 Markdown 文件（含一层子目录，按修改时间倒序）。 */
function listFolder(dir, { depth = 1 } = {}) {
  const out = [];
  const walk = (d, level) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (level < depth && !['node_modules', '.git'].includes(e.name)) walk(full, level + 1);
      } else if (e.isFile() && isMarkdown(e.name)) {
        try {
          const st = fs.statSync(full);
          out.push({
            path: full,
            fileName: e.name,
            title: path.basename(e.name, path.extname(e.name)),
            relDir: path.relative(dir, path.dirname(full)),
            size: st.size,
            updated: st.mtime.toISOString(),
          });
        } catch {
          /* 读不到就跳过 */
        }
      }
    }
  };
  walk(dir, 0);
  out.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  return out;
}

// ---------- 最近打开 ----------
function pushRecent(list, file) {
  const next = [file, ...(list || []).filter((f) => f !== file)];
  return next.slice(0, MAX_RECENT);
}

/** 过滤掉已经不存在的历史记录 */
function pruneRecent(list) {
  return (list || []).filter((f) => {
    try {
      return fs.statSync(f).isFile();
    } catch {
      return false;
    }
  });
}

module.exports = { readDoc, writeDoc, listFolder, isMarkdown, pushRecent, pruneRecent, MD_EXT };
