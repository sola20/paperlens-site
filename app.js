/* PaperLens 文献雷达 · 前端应用（原生 JS，无依赖） */

/* ================= 基础工具 ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- 静态镜像模式（GitHub Pages 只读版） ----------------
   构建时由 build_static.py 注入 window.PAPERLENS_STATIC=true，
   之后所有 /api 请求改由同目录的 data.json 在浏览器里应答，站点变成纯只读。 */
const STATIC_MODE = !!window.PAPERLENS_STATIC;
let STATIC_DB = null;

async function loadStaticDb() {
  if (STATIC_DB) return STATIC_DB;
  const res = await fetch('data.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('静态数据加载失败（HTTP ' + res.status + '）');
  STATIC_DB = await res.json();
  return STATIC_DB;
}

function localToday() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

const _has = (hay, needle) => String(hay || '').toLowerCase().includes(needle);

async function staticApi(path, opts = {}) {
  if ((opts.method || 'GET').toUpperCase() !== 'GET') {
    throw new Error('公网镜像是只读版本，收藏 / 评论 / 设置请在本机版操作');
  }
  const [p, qs] = path.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const db = await loadStaticDb();
  let m;

  if (p === '/papers') {
    let items = db.papers.slice();
    if (q.topic && q.topic !== 'all') items = items.filter((x) => String(x.topic_id) === String(q.topic));
    const kw = (q.q || '').trim().toLowerCase();
    if (kw) items = items.filter((x) => _has(x.title, kw) || _has(x.abstract, kw) || _has(x.authors_all, kw));
    const sort = q.sort || 'fetched';
    items.sort((a, b) => {
      if (sort === 'newest') return (b.published || '').localeCompare(a.published || '') || b.id - a.id;
      if (sort === 'oldest') return (a.published || '').localeCompare(b.published || '') || a.id - b.id;
      if (sort === 'title') return (a.title || '').localeCompare(b.title || '');
      return b.id - a.id;
    });
    const limit = Math.min(parseInt(q.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    const today = localToday();
    const topics = db.topics.map((t) => ({
      ...t,
      count: db.papers.filter((x) => x.topic_id === t.id).length,
      today_count: db.papers.filter((x) => x.topic_id === t.id && (x.fetched_at || '').slice(0, 10) === today).length,
    }));
    return {
      total: items.length,
      items: items.slice(offset, offset + limit),
      topics,
      all_total: db.papers.length,
      today_total: db.papers.filter((x) => (x.fetched_at || '').slice(0, 10) === today).length,
      offset, limit,
    };
  }
  if ((m = p.match(/^\/papers\/(\d+)$/))) {
    const hit = db.papers.find((x) => String(x.id) === m[1]);
    if (!hit) throw new Error('文献不存在');
    return { ...hit, comments: hit.comments || [] };
  }
  if (p === '/topics') {
    return db.topics.map((t) => ({
      ...t,
      paper_count: db.papers.filter((x) => x.topic_id === t.id).length,
      today_count: 0,
    }));
  }
  if (p === '/stats') return db.stats[String(q.days || 30)] || db.stats['30'];
  if (p === '/settings') {
    return {
      site_title: db.site_title,
      last_fetch_date: (db.generated_at || '').slice(0, 10),
      built_at: db.generated_at,
      static: true,
    };
  }
  if (p === '/logs') return [];
  if (p === '/desk') {
    return { favorites: [], comments: [], comment_total: 0, kpi: { fav_n: 0, read_n: 0, reading_n: 0 } };
  }
  if (p === '/sync/status') return { running: false, static: true };
  throw new Error('公网镜像不支持该操作，请在本机版使用');
}

async function api(path, opts = {}) {
  if (STATIC_MODE) return staticApi(path, opts);
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch('/api' + path, init);
  let json;
  try { json = await res.json(); } catch { throw new Error('服务返回异常（' + res.status + '）'); }
  if (!json.ok) throw new Error(json.error || '请求失败');
  return json.data;
}

let toastTimer = null;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'on ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2600);
}

function openModal({ title, body, foot = '', width = 520, onMount }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-mask"><div class="modal" style="max-width:${width}px">
    <div class="modal-head"><h3>${esc(title)}</h3><div class="x" data-close>&times;</div></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
  </div></div>`;
  const close = () => { root.innerHTML = ''; };
  root.onclick = (e) => { if (e.target.dataset.close !== undefined || e.target.classList.contains('modal-mask')) close(); };
  if (onMount) onMount(root, close);
  return close;
}

function confirmBox(title, text, okText = '确定') {
  return new Promise((resolve) => {
    const close = openModal({
      title, body: `<div style="font-size:12.5px;color:var(--ink-2);line-height:1.8">${text}</div>`,
      foot: `<button class="btn" data-close>取消</button><button class="btn accent" id="ok-btn">${esc(okText)}</button>`,
      onMount(root, closeFn) {
        root.querySelector('#ok-btn').onclick = () => { closeFn(); resolve(true); };
        root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => resolve(false)));
        root.querySelector('.modal-mask').addEventListener('click', (e) => { if (e.target.classList.contains('modal-mask')) resolve(false); });
      }
    });
  });
}

const fmtDate = (s) => (s || '').slice(5, 10).replace('-', '-');
const fmtFull = (s) => (s || '').slice(0, 16);

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板')).catch(() => fallbackCopy(text));
  } else fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('已复制到剪贴板'); } catch { toast('复制失败', 'err'); }
  document.body.removeChild(ta);
}

/* ================= 图标 ================= */
const I = {
  star: '<svg viewBox="0 0 24 24"><path d="M12 4.5l2.3 4.9 5.2.7-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2L4.5 10l5.2-.7z"/></svg>',
  pdf: '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 19h16"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4L10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  lang: '<svg viewBox="0 0 24 24"><path d="M4 7h10M9 4v3M6 7c0 4 3 7 7 8"/><path d="M12 20l4-9 4 9M13.5 17h5"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h13"/></svg>',
  back: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><path d="M3 7l9 6 9-6"/><rect x="3" y="5" width="18" height="14" rx="2"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 19h16"/></svg>',
};

/* ================= 状态 ================= */
const S = {
  page: 'feed',
  topics: [],
  settings: {},
  feed: { topic: 'all', q: '', sort: 'fetched', offset: 0, limit: 12, items: [], total: 0, busy: false },
  detailId: null,
  detailLang: 'orig',
  detailPaper: null,
  recipients: [],
  previewRecipient: null,
  llm: null,
  statsDays: 30,
  settingsDraft: null,
};

const NAV_NAME = { feed: '文献流', detail: '文献详情', topics: '主题订阅', mail: '邮件推送', stats: '统计分析', desk: '个人工作台', settings: '个人设置' };
const COLOR_MAP = { blue: 't-blue', green: 't-green', purple: 't-purple', amber: 't-amber', red: 't-red', gray: 't-gray' };

/* ================= 路由 ================= */
function go(page, params = {}) {
  S.page = page;
  if (page === 'detail' && params.id) S.detailId = params.id;
  $$('.nav-item').forEach((n) => n.classList.toggle('on', n.dataset.go === page));
  $('#crumb').textContent = NAV_NAME[page] || page;
  $('#sidebar').classList.remove('open');
  $('.scroll').scrollTop = 0;
  const renderers = {
    feed: renderFeed, detail: renderDetail, topics: renderTopics,
    mail: renderMail, stats: renderStats, desk: renderDesk, settings: renderSettings,
  };
  (renderers[page] || renderFeed)();
  location.hash = page === 'detail' ? `detail/${S.detailId}` : page;
}

/* ================= 文献流 ================= */
async function renderFeed() {
  const v = $('#view');
  v.innerHTML = `<div class="loading"><div class="spinner"></div>加载中…</div>`;
  try {
    const q = new URLSearchParams({
      topic: S.feed.topic, q: S.feed.q, sort: S.feed.sort,
      limit: S.feed.limit, offset: S.feed.offset,
    });
    const data = await api('/papers?' + q.toString());
    S.feed.items = S.feed.offset === 0 ? data.items : S.feed.items.concat(data.items);
    S.feed.total = data.total;
    S.feed.topics = data.topics;
    if (!S.topics.length) S.topics = data.topics;

    const chips = [`<div class="filter-chip ${S.feed.topic === 'all' ? 'on' : ''}" data-act="topic" data-id="all">全部主题 · ${data.all_total}</div>`]
      .concat(data.topics.filter(t => t.count > 0).map(t =>
        `<div class="filter-chip ${String(S.feed.topic) === String(t.id) ? 'on' : ''}" data-act="topic" data-id="${t.id}">${esc(shortName(t.name))} · ${t.count}</div>`))
      .join('');

    v.innerHTML = `
      <div class="page-head">
        <div>
          <h1>${S.feed.q ? '搜索结果' : '文献流'}</h1>
          <p>${S.feed.q ? `关键词「${esc(S.feed.q)}」共 ${S.feed.total} 篇` :
            `共 ${data.all_total} 篇 · 今日新增 ${data.today_total} 篇 · ${
              S.settings.static
                ? '镜像构建于 ' + esc((S.settings.built_at || '').slice(0, 16))
                : '上次抓取 ' + esc(S.settings.last_fetch_date || '尚未抓取')}`}</p>
        </div>
        <div class="spacer"></div>
        <button class="btn" data-act="export">${I.down}导出 BibTeX</button>
        ${STATIC_MODE ? '' : `<button class="btn primary" data-act="sync">${I.sync}立即同步</button>`}
      </div>
      <div class="toolbar">
        ${chips}
        ${S.feed.q ? `<div class="filter-chip on" data-act="clearq">搜索：${esc(S.feed.q)} ×</div>` : ''}
        <div class="select" style="margin-left:auto">
          <select id="sort-select">
            <option value="fetched" ${S.feed.sort === 'fetched' ? 'selected' : ''}>最新入库</option>
            <option value="newest" ${S.feed.sort === 'newest' ? 'selected' : ''}>提交时间新→旧</option>
            <option value="oldest" ${S.feed.sort === 'oldest' ? 'selected' : ''}>提交时间旧→新</option>
            <option value="title" ${S.feed.sort === 'title' ? 'selected' : ''}>标题排序</option>
          </select>
          <svg viewBox="0 0 24 24" style="position:absolute;right:8px;pointer-events:none"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>
      <div id="paper-list">${S.feed.items.map(paperCard).join('')}</div>
      ${S.feed.items.length === 0 ? emptyBox() : ''}
      ${S.feed.items.length < S.feed.total ? `<div style="text-align:center;padding:10px 0 24px">
        <button class="btn" data-act="more">加载更多（已显示 ${S.feed.items.length} / ${S.feed.total}）</button></div>`
        : S.feed.items.length ? `<div style="text-align:center;padding:14px;color:var(--ink-3);font-size:11.5px">已显示全部 ${S.feed.total} 篇</div>` : ''}
    `;
    const sel = $('#sort-select');
    if (sel) sel.onchange = () => { S.feed.sort = sel.value; S.feed.offset = 0; renderFeed(); };
    refreshNavBadges(data.all_total, data.today_total);
  } catch (err) {
    v.innerHTML = `<div class="empty"><div class="ico">⚠</div><h4>加载失败</h4><p>${esc(err.message)}</p></div>`;
  }
}

function shortName(n) {
  return n.replace(/与.*$/, '').replace(/及.*$/, '').slice(0, 6);
}

function emptyBox() {
  if (STATIC_MODE) {
    return `<div class="empty"><div class="ico">📄</div><h4>没有匹配的文献</h4>
      <p>换个关键词或主题再试试。</p></div>`;
  }
  return `<div class="empty"><div class="ico">📄</div><h4>还没有文献</h4>
    <p>先到「主题订阅」配置感兴趣的主题，然后点击右上角「立即同步」抓取最新文献。</p>
    <div style="margin-top:14px"><button class="btn accent" data-act="sync">${I.sync}立即抓取</button></div></div>`;
}

function paperCard(p) {
  const isNew = p.fetched_at && p.fetched_at.slice(0, 10) === new Date().toISOString().slice(0, 10);
  return `<article class="paper">
    <div class="paper-top">
      <span class="tag ${COLOR_MAP[p.topic_color] || 't-gray'}"><i></i>${esc(p.topic_name || '未分类')}</span>
      <span class="mono">arXiv:${esc(p.arxiv_id)}</span>
      <span class="paper-date">${isNew ? '<span class="new-dot"></span>今日 ' : ''}${esc(fmtDate(p.published || p.fetched_at))}</span>
      ${STATIC_MODE ? '' : `<div class="star ${p.is_favorite ? 'on' : ''}" data-act="fav" data-id="${p.id}" title="${p.is_favorite ? '取消收藏' : '收藏'}">${I.star}</div>`}
    </div>
    <h3 data-act="open" data-id="${p.id}">${esc(p.title)}</h3>
    <div class="authors">${esc(p.authors)}</div>
    <p class="abstract">${esc(p.abstract)}</p>
    <div class="paper-foot">
      <a class="chip-link pdf" href="${esc(p.pdf_url)}" target="_blank" rel="noopener">${I.pdf}PDF</a>
      <a class="chip-link" href="${esc(p.abs_url)}" target="_blank" rel="noopener">${I.link}arXiv</a>
      <span class="chip-link" data-act="lang">${I.lang}双语阅读</span>
      <span class="chip-link" data-act="summary" data-id="${p.id}">${I.list}内容概要</span>
      ${p.comment_count ? `<span class="chip-link off" data-act="open" data-id="${p.id}">💬 ${p.comment_count}</span>` : ''}
      <div class="cite-pill">${esc(citeApa(p))}<span class="copy" data-act="copy" data-text="${esc(citeApa(p))}">复制引用</span></div>
    </div>
  </article>`;
}

function citeApa(p) {
  const authors = (p.authors_all || p.authors || '').split(',').map(a => a.trim()).filter(Boolean);
  let names = 'Anonymous';
  if (authors.length === 1) names = authors[0];
  else if (authors.length <= 7) names = authors.slice(0, -1).join(', ') + ', & ' + authors[authors.length - 1];
  else names = authors.slice(0, 6).join(', ') + ', et al.';
  return `${names} (${(p.published || '').slice(0, 4) || 'n.d.'}). ${p.title}. arXiv:${p.arxiv_id}.`;
}

function refreshNavBadges(total, today) {
  const b = $('#nav-today');
  if (b) { b.textContent = today; b.style.display = today ? '' : 'none'; }
}

/* ================= 文献详情 ================= */
/* ---- 摘要 / 概要渲染（详情页与弹窗共用） ---- */
function abstractHtml(p, lang) {
  const orig = p.abstract || '';
  const zh = (p.abstract_zh || '').trim();
  const splitPara = (t) => String(t || '').split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);

  if (lang === 'zh' && zh) {
    return splitPara(zh).map((t) =>
      `<div class="para"><div class="orig" style="border-left:2px solid #E9DFD1;padding-left:11px">${esc(t)}</div></div>`).join('');
  }
  if (lang === 'both' && zh) {
    const a = splitPara(orig), b = splitPara(zh);
    return a.map((t, i) =>
      `<div class="para"><div class="orig">${esc(t)}</div>${b[i] ? `<div class="zh">${esc(b[i])}</div>` : ''}</div>`).join('');
  }
  if (lang !== 'orig' && !zh) {
    return `<div class="para"><div class="orig">${esc(orig)}</div></div>
      <div class="static-note" style="margin-top:10px">${I.lock}<span>这篇还没有译文，点击上方「中文」生成。</span></div>`;
  }
  return `<div class="para"><div class="orig">${esc(orig)}</div></div>`;
}

function summaryHtml(s, ready, modal = false) {
  const has = s && (s.direction || (s.innovations || []).length || s.conclusions);
  if (has) {
    const li = (s.innovations || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>';
    const kw = (s.keywords || []).map((k) => `<span class="sm-kw">${esc(k)}</span>`).join('');
    return `<div class="summary-box">
      <div class="sm-head">
        <span class="sm-label">内容概要</span>
        <span class="sm-badge">AI 生成</span>
        <span class="sm-hint">研究方向 / 方法创新点 / 主要结论</span>
      </div>
      <div class="sm-item"><b>研究方向</b><p>${esc(s.direction || '—')}</p></div>
      <div class="sm-item"><b>方法创新点</b><ul>${li}</ul></div>
      <div class="sm-item"><b>主要结论</b><p>${esc(s.conclusions || '—')}</p></div>
      <div class="sm-item"><b>局限与启示</b><p>${esc(s.limitations || '—')}</p></div>
      ${kw ? `<div class="sm-kws">${kw}</div>` : ''}
    </div>`;
  }
  if (ready) {
    return `<div class="summary-box">
      <div class="sm-head">
        <span class="sm-label">内容概要</span>
        <span class="sm-hint">由 AI 阅读标题与摘要后生成，约 3–8 秒</span>
        <button class="btn accent sm" style="margin-left:auto" data-act="gensummary">生成概要</button>
      </div>
      <div style="font-size:12px;color:var(--ink-3);line-height:1.8;margin-top:4px">
        包含研究方向、方法创新点、主要结论与局限，生成后写入本地库，不重复调用。
      </div>
    </div>`;
  }
  return `<div class="summary-box" style="opacity:.92">
    <div class="sm-head">
      <span class="sm-label">内容概要</span><span class="sm-badge off">未启用</span>
      <span class="sm-hint">需要配置 AI 服务</span>
      ${modal ? '' : `<a class="sm-link" data-go="settings">去设置 →</a>`}
    </div>
    <div style="font-size:12px;color:var(--ink-3);line-height:1.8;margin-top:4px">
      在「个人设置 → AI 服务」填写任意 OpenAI 兼容接口的 API Key 后即可使用。
    </div>
  </div>`;
}

async function renderDetail() {
  const v = $('#view');
  v.innerHTML = `<div class="loading"><div class="spinner"></div>加载文献…</div>`;
  try {
    const p = await api('/papers/' + S.detailId);
    S.detailPaper = p;
    const lang = S.detailLang || 'orig';
    const color = COLOR_MAP[p.topic_color] || 't-gray';
    v.innerHTML = `<div class="reader">
      <div>
        <div class="article">
          <div class="back" data-go="feed">${I.back}返回文献流</div>
          <div class="paper-top" style="margin-bottom:9px">
            <span class="tag ${color}"><i></i>${esc(p.topic_name || '未分类')}</span>
            <span class="mono">arXiv:${esc(p.arxiv_id)}</span>
            ${STATIC_MODE ? '' : `<div class="star ${p.is_favorite ? 'on' : ''}" data-act="fav" data-id="${p.id}">${I.star}</div>`}
          </div>
          <h2 class="art-title">${esc(p.title)}</h2>
          ${p.title_zh ? `<div class="art-title-zh">${esc(p.title_zh)}</div>` : ''}
          <div class="art-authors">${esc(p.authors_all || p.authors)}</div>
          <div class="art-meta">
            <span>提交 <b>${esc(p.published || '—')}</b></span>
            <span>${esc(p.categories || p.primary_cat)}</span>
            <span>入库 <b>${esc(fmtFull(p.fetched_at))}</b></span>
            <span>评论 <b>${p.comments.length}</b></span>
          </div>

          <div class="langbar">
            <div class="seg">
              ${[['orig', '原文'], ['zh', '中文'], ['both', '双语对照']].map(([v, t]) =>
                `<span class="${lang === v ? 'on' : ''}" data-act="lang" data-mode="${v}">${t}</span>`).join('')}
            </div>
            <div class="note">${p.llm_ready
              ? (p.abstract_zh
                ? '<i style="background:#4C7C59"></i>译文已缓存，切换不再调用'
                : '<i></i>点「中文」触发 AI 翻译（首次约 3–8 秒）')
              : '<i></i>未配置 AI 服务 · 仅显示原文'}</div>
          </div>

          ${!p.llm_ready ? `<div class="lang-lock" style="margin-bottom:16px">
            ${I.lock}
            <div><b>双语阅览与内容概要未启用。</b>在「个人设置 → AI 服务」填写 OpenAI 兼容接口（DeepSeek / 通义 / Kimi / OpenAI / 本地 Ollama 均可）后自动启用；不配置不影响文献浏览、收藏与推送。</div>
          </div>` : ''}

          ${summaryHtml(p.summary_json, p.llm_ready)}

          <div class="sec-h">Abstract · 摘要</div>
          ${abstractHtml(p, lang)}

          <div class="art-foot">
            <a class="chip-link pdf" href="${esc(p.pdf_url)}" target="_blank" rel="noopener">${I.pdf}下载 PDF</a>
            <a class="chip-link" href="${esc(p.abs_url)}" target="_blank" rel="noopener">${I.link}arXiv 原文</a>
            ${STATIC_MODE ? '' : `<span class="chip-link ${p.is_favorite ? 'off' : ''}" data-act="fav" data-id="${p.id}">${I.star}${p.is_favorite ? '已收藏' : '收藏'}</span>`}
            <span class="chip-link" data-act="copy" data-text="${esc(p.cite_gbt)}">复制引用</span>
            <span style="margin-left:auto" class="cite-pill">GB/T 7714</span>
          </div>

          <div class="sec-h" style="margin-top:26px">阅读评论 · ${p.comments.length}</div>
          <div class="cmt-list" id="cmt-list">${p.comments.length ? p.comments.map(cmtItem).join('') :
            `<div style="font-size:12px;color:var(--ink-3);padding:10px 0">${STATIC_MODE ? '公网镜像不提供评论，本机版可写阅读笔记。' : '还没有评论，写下你的第一条阅读笔记。'}</div>`}</div>
          ${STATIC_MODE ? `<div class="static-note">${I.lock}<span>收藏与评论是本地功能，请在本机版操作。公网镜像仅提供阅读与引用。</span></div>` : `<div class="cmt-input">
            <div class="cmt-av">研</div>
            <textarea id="cmt-box" placeholder="写下你的阅读评论…（Ctrl+Enter 发送）"></textarea>
            <button class="btn accent sm" style="height:64px;padding:0 16px;align-self:stretch" id="cmt-send">发表</button>
          </div>`}
        </div>
      </div>

      <div>
        <div class="side-card">
          <h5>文献信息</h5>
          <div class="kv"><span>来源</span><span>arXiv</span></div>
          <div class="kv"><span>分类</span><span>${esc(p.primary_cat || '—')}</span></div>
          <div class="kv"><span>提交日期</span><span>${esc(p.published || '—')}</span></div>
          <div class="kv"><span>更新时间</span><span>${esc(p.updated || '—')}</span></div>
          <div class="kv"><span>入库时间</span><span>${esc(fmtFull(p.fetched_at))}</span></div>
          <div class="kv"><span>全部作者</span><span style="max-width:120px">${(p.authors_all || '').split(',').length} 人</span></div>
        </div>
        <div class="side-card">
          <h5>快捷操作</h5>
          <div style="display:flex;flex-direction:column;gap:7px">
            ${STATIC_MODE ? '' : `<button class="btn sm" data-act="fav" data-id="${p.id}" style="justify-content:flex-start">${I.star}${p.is_favorite ? '取消收藏' : '收藏本文'}</button>`}
            <button class="btn sm" data-act="copy" data-text="${esc(p.cite_apa)}" style="justify-content:flex-start">复制 APA 引用</button>
            <button class="btn sm" data-act="copy" data-text="${esc(p.cite_gbt)}" style="justify-content:flex-start">复制 GB/T 7714</button>
            ${STATIC_MODE ? '' : `<button class="btn sm" data-act="state" data-id="${p.id}" data-state="read" style="justify-content:flex-start">标记为已读</button>`}
          </div>
        </div>
        ${STATIC_MODE ? '' : `<div class="side-card" style="background:#FBFAF6">
          <h5>我的批注</h5>
          <div style="font-size:11.5px;color:var(--ink-2);line-height:1.7">
            已记录 <b>${p.comments.length}</b> 条评论<br>
            <span style="color:var(--ink-3);font-size:10.5px">同步至个人工作台</span>
          </div>
        </div>`}
      </div>
    </div>`;

    const box = $('#cmt-box');
    const send = async () => {
      const text = box.value.trim();
      if (!text) return toast('评论内容不能为空', 'err');
      try {
        await api(`/papers/${p.id}/comments`, { method: 'POST', body: { content: text } });
        toast('评论已发布');
        renderDetail();
      } catch (e) { toast(e.message, 'err'); }
    };
    if (box) {
      $('#cmt-send').onclick = send;
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
    }
  } catch (err) {
    v.innerHTML = `<div class="empty"><div class="ico">⚠</div><h4>打开失败</h4><p>${esc(err.message)}</p>
      <div style="margin-top:12px"><button class="btn" data-go="feed">返回列表</button></div></div>`;
  }
}

function cmtItem(c) {
  return `<div class="cmt">
    <div class="cmt-av">研</div>
    <div class="cmt-bd">
      <div class="cmt-hd"><b>我</b><span>${esc(fmtFull(c.created_at))}</span>
        <span class="cmt-del" data-act="delcmt" data-id="${c.id}">删除</span></div>
      <div class="cmt-tx">${esc(c.content)}</div>
    </div>
  </div>`;
}

/* ================= 主题订阅 ================= */
async function renderTopics() {
  const v = $('#view');
  v.innerHTML = `<div class="loading"><div class="spinner"></div>加载中…</div>`;
  try {
    const topics = await api('/topics');
    S.topics = topics;
    const totalQuota = topics.filter(t => t.enabled).reduce((a, t) => a + t.daily_limit, 0);
    const s = S.settings;
    v.innerHTML = `
      <div class="page-head">
        <div><h1>主题订阅</h1>
          <p>每个主题独立配置关键词与抓取篇数，每日 ${esc(s.fetch_time || '08:00')} 自动拉取最新文献</p></div>
        <div class="spacer"></div>
        <button class="btn primary" data-act="newtopic">${I.plus}新建主题</button>
      </div>

      <div class="quota-bar"><div class="quota-inner">
        <div class="quota-sep">
          <div>
            <div class="lb" style="font-size:10.5px;color:var(--ink-3)">每日总拉取篇数</div>
            <div style="display:flex;align-items:baseline;gap:6px">
              <span style="font-family:var(--serif);font-size:23px;font-weight:600;line-height:1.25">${esc(s.fetch_total || 20)}</span>
              <span style="font-size:11px;color:var(--ink-3)">篇 / 天</span>
            </div>
          </div>
          <div class="step" style="height:24px" data-act="step-setting" data-key="fetch_total">
            <b style="width:22px;line-height:22px" data-delta="-1">−</b><span style="line-height:22px;padding:0 9px">${esc(s.fetch_total || 20)}</span><b style="width:22px;line-height:22px" data-delta="1">+</b>
          </div>
        </div>
        <div><div class="lb" style="font-size:10.5px;color:var(--ink-3)">抓取时间</div>
          <div style="font-size:12.5px;margin-top:3px">每日 ${esc(s.fetch_time || '08:00')}</div></div>
        <div><div class="lb" style="font-size:10.5px;color:var(--ink-3)">配额分配</div>
          <div class="select" style="height:25px;margin-top:2px;padding:0 8px;font-size:11.5px">
            <select id="alloc-select">
              <option value="topic" ${s.fetch_allocation === 'topic' ? 'selected' : ''}>按主题配额</option>
              <option value="auto" ${s.fetch_allocation === 'auto' ? 'selected' : ''}>自动均分</option>
            </select>
            <svg viewBox="0 0 24 24" style="width:10px;height:10px;position:absolute;right:6px;pointer-events:none"><path d="M6 9l6 6 6-6"/></svg>
          </div></div>
        <div><div class="lb" style="font-size:10.5px;color:var(--ink-3)">单主题上限</div>
          <div style="font-size:12.5px;margin-top:3px">${esc(s.fetch_max_per_topic || 10)} 篇</div></div>
        <div><div class="lb" style="font-size:10.5px;color:var(--ink-3)">提交时间范围</div>
          <div style="font-size:12.5px;margin-top:3px">近 ${esc(s.fetch_days || 7)} 天</div></div>
        <div style="margin-left:auto;text-align:right">
          <div class="lb" style="font-size:10.5px;color:var(--ink-3)">配额合计</div>
          <div style="font-size:12.5px;margin-top:3px"><b style="color:${totalQuota > Number(s.fetch_total || 20) ? 'var(--accent)' : 'var(--green)'};font-weight:600">${totalQuota}</b> / ${esc(s.fetch_total || 20)}</div>
        </div>
      </div></div>

      <div class="grid-2">${topics.map(topicCard).join('')}
        <div class="new-topic" data-act="newtopic"><span>+</span>新建订阅主题
          <div style="font-size:10.5px;opacity:.8">支持 arXiv 分类号或任意关键词组合</div></div>
      </div>

      <div class="card" style="margin-top:14px;padding:14px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <div style="font-size:12px;color:var(--ink-2)"><b style="font-weight:600">去重策略</b> · 以 arXiv ID 为唯一键，已入库文献不会重复同步；同一文献命中多个主题时保留首次归属</div>
        <button class="btn sm" data-act="sync" style="margin-left:auto">${I.sync}立即抓取</button>
      </div>`;

    const alloc = $('#alloc-select');
    if (alloc) alloc.onchange = async () => {
      await api('/settings', { method: 'POST', body: { fetch_allocation: alloc.value } });
      S.settings.fetch_allocation = alloc.value;
      toast('已切换分配方式');
    };
  } catch (err) {
    v.innerHTML = `<div class="empty"><div class="ico">⚠</div><h4>加载失败</h4><p>${esc(err.message)}</p></div>`;
  }
}

function topicCard(t) {
  const kws = (t.keywords || '').split(',').filter(Boolean);
  return `<div class="topic ${t.enabled ? '' : 'paused'}">
    <div class="topic-head">
      <span class="tag ${COLOR_MAP[t.color] || 't-gray'}"><i></i>${t.enabled ? '已启用' : '已暂停'}</span>
      <div class="switch ${t.enabled ? 'on' : ''}" data-act="toggletopic" data-id="${t.id}" data-on="${t.enabled ? 0 : 1}"
           style="margin-left:auto" title="${t.enabled ? '暂停' : '启用'}"></div>
    </div>
    <h4 style="font-size:13.5px;font-weight:600;line-height:1.5;margin-bottom:4px">${esc(t.name)}</h4>
    <div class="topic-sub">
      <span>${esc(t.categories || '—')}</span>
      <span style="margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-family:var(--sans)">
        每日<span class="step" data-act="steptopic" data-id="${t.id}">
          <b data-delta="-1">−</b><span>${t.daily_limit}</span><b data-delta="1">+</b></span>篇
      </span>
    </div>
    <div class="kw-row">${kws.slice(0, 6).map(k => `<span class="kw">${esc(k.trim())}</span>`).join('')}
      <span class="kw" style="border-style:dashed;color:var(--ink-3);cursor:pointer" data-act="edittopic" data-id="${t.id}">+ 编辑</span></div>
    <div class="topic-foot">累计 ${t.paper_count} 篇 · 今日 ${t.today_count || 0} 篇
      <span style="margin-left:auto;display:flex;gap:6px">
        <span class="btn sm" data-act="edittopic" data-id="${t.id}">编辑</span>
        <span class="btn sm danger" data-act="deltopic" data-id="${t.id}">删除</span>
      </span>
    </div>
  </div>`;
}

function topicForm(t = {}) {
  const colors = ['blue', 'green', 'purple', 'amber', 'red'];
  return `<div class="field"><label>主题名称</label>
      <input class="input" id="f-name" value="${esc(t.name || '')}" placeholder="例如：大模型推理与思维链"></div>
    <div class="field"><label>关键词（逗号分隔，命中任一即抓取）</label>
      <input class="input" id="f-kw" value="${esc(t.keywords || '')}" placeholder="chain-of-thought, reasoning"></div>
    <div class="field"><label>arXiv 分类（逗号分隔）</label>
      <input class="input" id="f-cat" value="${esc(t.categories || '')}" placeholder="cs.CL, cs.AI">
      <div class="desc">常用：cs.CL 计算语言学 / cs.AI 人工智能 / cs.LG 机器学习 / cs.CV 计算机视觉 / cs.IR 信息检索 / cs.MA 多智能体</div></div>
    <div class="two">
      <div class="field"><label>每日抓取篇数</label><input class="input" id="f-limit" type="number" min="0" max="50" value="${t.daily_limit ?? 5}"></div>
      <div class="field"><label>标签颜色</label>
        <div class="seg" id="f-color">${colors.map(c => `<span class="${(t.color || 'blue') === c ? 'on' : ''}" data-c="${c}">${c}</span>`).join('')}</div>
      </div>
    </div>`;
}

function bindColorSeg(root) {
  $$('#f-color span', root).forEach(sp => sp.onclick = () => {
    $$('#f-color span', root).forEach(x => x.classList.remove('on'));
    sp.classList.add('on');
  });
}

/* ================= 邮件推送 ================= */
async function renderMail() {
  const v = $('#view');
  v.innerHTML = `<div class="loading"><div class="spinner"></div>加载中…</div>`;
  try {
    const [s, logs, recs] = await Promise.all([
      api('/settings'), api('/logs?type=mail&limit=8'), api('/recipients'),
    ]);
    S.settings = s;
    S.recipients = recs;
    const configured = !!(s.mail_user && s.mail_auth_code_masked);
    const pickId = (S.previewRecipient && recs.some(r => r.id === S.previewRecipient))
      ? S.previewRecipient : (recs[0] ? recs[0].id : null);
    S.previewRecipient = pickId;
    let preview = { subject: '（还没有收件人）', html: '', count: 0, pref: '' };
    try {
      preview = await api('/mail/preview' + (pickId ? '?recipient=' + pickId : ''));
    } catch (e) { preview = { subject: '预览失败：' + e.message, html: '', count: 0 }; }
    const enabledN = recs.filter(r => r.enabled).length;
    const aiReady = !!(S.llm && S.llm.ready);

    v.innerHTML = `
      <div class="page-head">
        <div><h1>邮件每日推送</h1>
          <p>每个收件人按自己关注的文献偏好，收到不同的精选邮件</p></div>
        <div class="spacer"></div>
        <button class="btn" data-act="mailtest">发送测试邮件</button>
        <button class="btn accent" data-act="mailsave">保存配置</button>
      </div>

      ${configured ? '' : `<div class="form-note" style="margin-bottom:14px">
        <b>尚未配置发件邮箱。</b>请先到 <a data-go="settings" style="color:#8E6A1C;text-decoration:underline;cursor:pointer">个人设置</a> 填写 QQ 邮箱账号与 SMTP 授权码，否则无法发送。
      </div>`}

      <div class="mail-layout">
        <div>
          <div class="panel" style="margin-bottom:11px">
            <div class="panel-head"><h4>收件人 · ${recs.length} 位</h4>
              <span class="hint">已启用 ${enabledN} 位</span></div>
            <div class="panel-body" style="padding-top:10px">
              ${recs.length ? recs.map(recipientCard).join('') : `
                <div style="font-size:11.5px;color:var(--ink-3);line-height:1.8;padding:6px 0 10px">
                  还没有收件人。添加后可为每位收件人单独设置关注的主题与关键词，推送时各发各的。
                </div>`}
              <button class="btn" data-act="addrecipient" style="width:100%;justify-content:center;margin-top:4px">
                ${I.plus}添加收件人
              </button>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><h4>推送时间与内容</h4>
              <span class="hint">${configured ? '发件：' + esc(s.mail_user) : '未配置发件邮箱'}</span></div>
            <div class="panel-body">
              <div class="two">
                <div class="field"><label>发送时间</label><input class="input" id="m-time" type="time" value="${esc(s.mail_time || '08:30')}"></div>
                <div class="field"><label>无匹配时回溯（天）</label>
                  <input class="input" id="m-fallback" type="number" min="0" max="60" value="${esc(s.mail_fallback_days || 0)}">
                  <div class="desc">0 = 不补发；大于 0 时当日无匹配则发近 N 天符合偏好的</div>
                </div>
              </div>
              <div class="toggle-row" style="margin-top:0">
                <div class="switch ${s.mail_enabled === '1' ? 'on' : ''}" id="m-enabled" data-val="${s.mail_enabled === '1' ? 1 : 0}"></div>
                <span>${s.mail_enabled === '1' ? '已开启，每天自动发送' : '已关闭'}</span>
              </div>
              <div class="toggle-row">
                <div class="switch ${s.mail_include_abstract === '1' ? 'on' : ''}" id="m-abs" data-val="${s.mail_include_abstract === '1' ? 1 : 0}"></div>
                包含摘要（截断 200 字）
              </div>
              <div class="toggle-row" ${aiReady ? '' : 'style="opacity:.55"'}>
                <div class="switch ${s.mail_include_summary === '1' && aiReady ? 'on' : ''}" id="m-sum" data-val="${s.mail_include_summary === '1' ? 1 : 0}"></div>
                包含 AI 速读概要${aiReady ? '' : '（需配置 AI 服务）'}
              </div>
              <div class="toggle-row">
                <div class="switch ${s.mail_only_new === '1' ? 'on' : ''}" id="m-onlynew" data-val="${s.mail_only_new === '1' ? 1 : 0}"></div>
                无匹配文献时不发送
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="panel">
            <div class="panel-head"><h4>邮件预览</h4>
              <div style="margin-left:auto;display:flex;align-items:center;gap:7px">
                <div class="select" style="width:150px">
                  <select id="preview-pick">
                    ${recs.map(r => `<option value="${r.id}" ${r.id === pickId ? 'selected' : ''}>${esc(r.name || r.email)}</option>`).join('') || '<option>无收件人</option>'}
                  </select>
                  <svg viewBox="0 0 24 24" style="position:absolute;right:8px;pointer-events:none"><path d="M6 9l6 6 6-6"/></svg>
                </div>
              </div>
            </div>
            <div style="padding:0 16px 8px;font-size:10.5px;color:var(--ink-3);line-height:1.6">
              ${esc(preview.pref || '全部主题')} · 今日命中 <b style="color:var(--ink-2)">${preview.count}</b> 篇${preview.fallback ? '（近 N 天兜底）' : ''}
            </div>
            <div class="mail-preview">
              <div class="mail-win">
                <div class="mail-chrome">
                  <div class="mail-sub">${esc(preview.subject)}</div>
                  <div class="mail-meta">
                    <span>发件人 <b style="color:var(--ink-2);font-weight:500">${esc(s.mail_user || '未配置')}</b></span>
                    <span>收件人 <b style="color:var(--ink-2);font-weight:500">${esc((preview.recipient && preview.recipient.email) || '—')}</b></span>
                  </div>
                </div>
                <iframe class="mail-frame" id="mail-frame" sandbox="allow-same-origin"></iframe>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:11px;padding:13px 16px">
            <div style="font-size:11.5px;color:var(--ink-3);margin-bottom:8px">最近发送记录</div>
            ${logs.length ? logs.map(l => `<div class="rank" style="padding:6px 0">
              <span class="tag ${l.status === 'success' ? 't-green' : l.status === 'skipped' ? 't-amber' : 't-red'}" style="font-size:10px">${
                l.status === 'success' ? '成功' : l.status === 'skipped' ? '跳过' : '失败'}</span>
              <span style="font-size:11.5px;color:var(--ink-2)">${esc(fmtFull(l.sent_at))} · ${l.count} 篇 · ${esc((l.recipients || '').slice(0, 30))}</span>
              <span class="ct" style="margin-left:auto">${esc(l.message ? l.message.slice(0, 24) : '')}</span>
            </div>`).join('') : '<div style="font-size:11.5px;color:var(--ink-3);padding:6px 0">暂无发送记录</div>'}
          </div>
        </div>
      </div>`;

    const frame = $('#mail-frame');
    if (frame) frame.srcdoc = preview.html || '<div style="padding:30px;font-family:sans-serif;color:#918C82;font-size:13px">暂无内容可预览</div>';
    bindToggles(v);
    const pick = $('#preview-pick');
    if (pick) pick.onchange = () => { S.previewRecipient = Number(pick.value); renderMail(); };
    $('#m-enabled')?.addEventListener('click', () => {
      setTimeout(() => {
        const on = $('#m-enabled').classList.contains('on');
        $('#m-enabled').nextElementSibling.textContent = on ? '已开启，每天自动发送' : '已关闭';
      }, 0);
    });
  } catch (err) {
    v.innerHTML = `<div class="empty"><div class="ico">⚠</div><h4>加载失败</h4><p>${esc(err.message)}</p></div>`;
  }
}

function recipientCard(r) {
  const chips = [
    ...(r.topic_names || []).slice(0, 3).map(n => `<span class="rc-chip t">${esc(n)}</span>`),
    ...(r.keyword_list || []).slice(0, 4).map(k => `<span class="rc-chip k">${esc(k)}</span>`),
    ...(r.category_list || []).slice(0, 3).map(c => `<span class="rc-chip c">${esc(c)}</span>`),
  ].join('');
  return `<div class="recipient ${r.enabled ? '' : 'off'}">
    <div class="rc-top">
      <b>${esc(r.name || r.email)}</b>
      ${r.name ? `<span class="rc-mail">${esc(r.email)}</span>` : ''}
      <div class="switch ${r.enabled ? 'on' : ''}" data-act="togglerecip" data-id="${r.id}" style="margin-left:auto"></div>
    </div>
    <div class="rc-pref">${chips || '<span class="rc-chip all">全部主题（未设偏好）</span>'}</div>
    <div class="rc-foot">
      <span>每封 ${r.daily_count} 篇${r.include_summary ? ' · 附概要' : ''}</span>
      <a data-act="previewrecip" data-id="${r.id}">预览</a>
      <a data-act="editrecip" data-id="${r.id}">编辑</a>
      <a data-act="delrecip" data-id="${r.id}" style="color:#B0472A">删除</a>
    </div>
  </div>`;
}

function recipientForm(r = {}) {
  const ids = r.topic_id_list || [];
  return `
    <div class="field"><label>收件邮箱</label>
      <input class="input" id="r-email" value="${esc(r.email || '')}" placeholder="name@qq.com"></div>
    <div class="field"><label>备注名称（可选）</label>
      <input class="input" id="r-name" value="${esc(r.name || '')}" placeholder="例如：导师 / 实验室师兄"></div>
    <div class="field"><label>感兴趣的主题（不选 = 全部主题）</label>
      <div class="pick-row" id="r-topics">
        ${(S.topics.length ? S.topics : []).map(t => `<span class="pick ${ids.includes(t.id) ? 'on' : ''}" data-id="${t.id}">${esc(t.name)}</span>`).join('')}
      </div>
    </div>
    <div class="field"><label>关键词（逗号分隔，命中标题或摘要即推荐）</label>
      <input class="input" id="r-kw" value="${esc((r.keyword_list || []).join(','))}" placeholder="reasoning, RAG, agent">
    </div>
    <div class="field"><label>arXiv 分类（可选）</label>
      <input class="input" id="r-cat" value="${esc((r.category_list || []).join(','))}" placeholder="cs.CL,cs.CV">
    </div>
    <div class="two">
      <div class="field" style="margin-bottom:0"><label>每封包含篇数</label>
        <input class="input" id="r-count" type="number" min="1" max="50" value="${esc(r.daily_count || 10)}"></div>
      <div class="field" style="margin-bottom:0"><label>附 AI 速读概要</label>
        <div class="toggle-row" style="margin-top:8px"><div class="switch ${r.include_summary === 0 ? '' : 'on'}" id="r-sum" data-val="${r.include_summary === 0 ? 0 : 1}"></div>
        <span style="font-size:11.5px;color:var(--ink-3)">需已配置 AI 服务</span></div>
      </div>
    </div>`;
}

function openRecipientModal(r) {
  const isNew = !r;
  openModal({
    title: isNew ? '添加收件人' : '编辑收件人', width: 580,
    body: recipientForm(r || {}),
    foot: `<button class="btn" data-close>取消</button>
      <button class="btn accent" id="save-rec">${isNew ? '添加' : '保存'}</button>`,
    onMount(root, closeFn) {
      bindToggles(root);
      $$('#r-topics .pick', root).forEach(p => p.onclick = () => p.classList.toggle('on'));
      root.querySelector('#save-rec').onclick = async () => {
        const topicIds = $$('#r-topics .pick.on', root).map(p => Number(p.dataset.id));
        const body = {
          email: root.querySelector('#r-email').value.trim(),
          name: root.querySelector('#r-name').value.trim(),
          topic_ids: topicIds,
          keywords: root.querySelector('#r-kw').value.trim(),
          categories: root.querySelector('#r-cat').value.trim(),
          daily_count: Number(root.querySelector('#r-count').value || 10),
          include_summary: String(root.querySelector('#r-sum').dataset.val) === '1',
          enabled: isNew ? true : !!r.enabled,
        };
        if (!body.email || body.email.indexOf('@') < 0) return toast('请填写有效邮箱', 'err');
        try {
          if (isNew) await api('/recipients', { method: 'POST', body });
          else await api('/recipients/' + r.id, { method: 'PUT', body });
          closeFn();
          toast(isNew ? '收件人已添加' : '已保存');
          renderMail();
        } catch (e) { toast(e.message, 'err'); }
      };
    },
  });
}

function bindToggles(root) {
  $$('.switch[data-val]', root).forEach(sw => sw.addEventListener('click', () => {
    const on = sw.dataset.val === '1' ? 0 : 1;
    sw.dataset.val = on;
    sw.classList.toggle('on', !!on);
  }));
}

/* ================= 统计分析 ================= */
async function renderStats() {
  const v = $('#view');
  v.innerHTML = `<div class="loading"><div class="spinner"></div>统计中…</div>`;
  try {
    const d = await api('/stats?days=' + S.statsDays);
    const k = d.kpi;
    const weekDelta = k.week_now - k.week_prev;
    const maxTopic = Math.max(...d.topic_dist.map(t => t.count), 1);
    v.innerHTML = `
      <div class="page-head">
        <div><h1>统计分析</h1>
          <p>基于本地库 ${k.total} 篇文献的入库趋势、主题分布与作者分析</p></div>
        <div class="spacer"></div>
        <div class="select">
          <select id="days-select">
            ${[7, 30, 90].map(n => `<option value="${n}" ${S.statsDays === n ? 'selected' : ''}>近 ${n} 天</option>`).join('')}
          </select>
          <svg viewBox="0 0 24 24" style="position:absolute;right:8px;pointer-events:none"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <button class="btn" data-act="export">${I.down}导出报表</button>
      </div>

      <div class="kpi-row">
        <div class="kpi"><div class="lb">本地文献总量</div><div class="vl">${k.total}</div>
          <div class="df ${weekDelta < 0 ? 'down' : ''}">${weekDelta >= 0 ? '▲' : '▼'} ${Math.abs(weekDelta)} 篇 · 近 7 天</div></div>
        <div class="kpi"><div class="lb">今日新增</div><div class="vl">${k.today}</div>
          <div class="df muted">本周共 ${k.week_now} 篇</div></div>
        <div class="kpi"><div class="lb">日均入库</div><div class="vl">${k.avg_per_day}</div>
          <div class="df muted">有新增的日均值</div></div>
        <div class="kpi"><div class="lb">去重拦截</div><div class="vl">${k.dedup_skipped}</div>
          <div class="df muted">重复率 ${k.dedup_rate}%</div></div>
      </div>

      <div class="chart-grid">
        <div class="chart-box">
          <h4>每日入库趋势<span class="legend"><span><i style="background:#2E4A57"></i>入库</span><span><i style="background:#C8B79C"></i>7日均线</span></span></h4>
          <div class="sub">近 ${S.statsDays} 天 · 单位：篇</div>
          ${lineChart(d.trend)}
        </div>
        <div class="chart-box">
          <h4>各主题文献占比</h4><div class="sub">累计 ${k.total} 篇</div>
          ${donutChart(d.topic_dist)}
        </div>
      </div>

      <div class="chart-grid g3">
        <div class="chart-box">
          <h4>主题文献量</h4><div class="sub">按累计数量排序</div>
          <div class="bars">
            ${d.topic_dist.length ? d.topic_dist.map(t => `<div class="bar-row">
              <span class="nm" title="${esc(t.name)}">${esc(t.name)}</span>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, t.count / maxTopic * 100)}%"></div></div>
              <span class="vv">${t.count}</span></div>`).join('') : '<div style="font-size:12px;color:var(--ink-3)">暂无数据</div>'}
          </div>
        </div>
        <div class="chart-box">
          <h4>高频作者 Top 8</h4><div class="sub">出现文献数</div>
          <div class="rank-list">
            ${d.top_authors.length ? d.top_authors.map((a, i) => `<div class="rank">
              <span class="no">${i + 1}</span><span class="nm" title="${esc(a.name)}">${esc(a.name)}</span>
              <span class="ct">${a.count}</span></div>`).join('') : '<div style="font-size:12px;color:var(--ink-3)">暂无数据</div>'}
          </div>
          ${STATIC_MODE ? '' : `<h4 style="margin-top:16px">我的使用</h4>
          <div class="rank-list">
            <div class="rank"><span class="nm" style="flex:1">收藏</span><span class="ct">${k.favorite}</span></div>
            <div class="rank" style="border-bottom:0"><span class="nm" style="flex:1">已读</span><span class="ct">${k.read}</span></div>
          </div>`}
        </div>
        <div class="chart-box">
          <h4>关键词热度</h4><div class="sub">标题与摘要词频</div>
          <div class="cloud">${d.keywords.length ? d.keywords.map(w => {
            const sz = 11 + Math.min(10, Math.round(w.count / (d.keywords[0].count || 1) * 9));
            return `<span style="font-size:${sz}px;${sz > 17 ? 'font-weight:600' : ''}" title="${esc(w.word)} · ${w.count} 次">${esc(w.word)}</span>`;
          }).join('') : '<div style="font-size:12px;color:var(--ink-3)">暂无数据</div>'}</div>
        </div>
      </div>`;

    const sel = $('#days-select');
    if (sel) sel.onchange = () => { S.statsDays = Number(sel.value); renderStats(); };
  } catch (err) {
    v.innerHTML = `<div class="empty"><div class="ico">⚠</div><h4>统计失败</h4><p>${esc(err.message)}</p></div>`;
  }
}

/* ---- 折线图 ---- */
function lineChart(trend) {
  const W = 660, H = 210, PL = 34, PR = 14, PT = 14, PB = 26;
  const n = trend.length;
  const maxV = Math.max(...trend.map(t => t.count), 4);
  const step = Math.ceil(maxV / 4) || 1;
  const top = step * 4;
  const x = i => PL + i * (W - PL - PR) / Math.max(1, n - 1);
  const y = v => H - PB - v * (H - PT - PB) / top;
  const ma = trend.map((_, i) => {
    const s = Math.max(0, i - 6);
    const seg = trend.slice(s, i + 1);
    return seg.reduce((a, b) => a + b.count, 0) / seg.length;
  });
  const path = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${path(trend.map(t => t.count))} L${x(n - 1).toFixed(1)},${H - PB} L${PL},${H - PB} Z`;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = step * i;
    grid += `<line x1="${PL}" y1="${y(v)}" x2="${W - PR}" y2="${y(v)}" stroke="#EFEBE3"/>`;
    grid += `<text x="${PL - 7}" y="${y(v) + 3.5}" text-anchor="end" font-size="9.5" fill="#918C82" font-family="ui-monospace,monospace">${v}</text>`;
  }
  const labelEvery = Math.max(1, Math.ceil(n / 7));
  trend.forEach((t, i) => {
    if (i % labelEvery === 0 || i === n - 1) {
      grid += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="#918C82" font-family="ui-monospace,monospace">${t.date.slice(5)}</text>`;
    }
  });
  const dots = trend.map((t, i) => t.count
    ? `<circle cx="${x(i)}" cy="${y(t.count)}" r="2.4" fill="#fff" stroke="#2E4A57" stroke-width="1.4"><title>${t.date}：${t.count} 篇</title></circle>` : '').join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
    <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2E4A57" stop-opacity=".16"/>
      <stop offset="100%" stop-color="#2E4A57" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#ga)"/>
    <path d="${path(trend.map(t => t.count))}" fill="none" stroke="#2E4A57" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="${path(ma)}" fill="none" stroke="#C8B79C" stroke-width="1.5" stroke-dasharray="4 3"/>
    ${dots}
  </svg>`;
}

/* ---- 环形图 ---- */
function donutChart(items) {
  const total = items.reduce((a, b) => a + b.count, 0);
  if (!total) return '<div style="font-size:12px;color:var(--ink-3);padding:30px 0;text-align:center">暂无数据</div>';
  const palette = { blue: '#2E4A57', green: '#4C7285', purple: '#7C9BA8', amber: '#B0472A', red: '#C98A6E', gray: '#D8D2C5' };
  const cx = 78, cy = 100, R = 60, r = 40;
  let a0 = -Math.PI / 2, s = '';
  const list = items.slice(0, 7);
  list.forEach(it => {
    const ang = it.count / total * Math.PI * 2;
    const a1 = a0 + ang;
    const large = ang > Math.PI ? 1 : 0;
    const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1), [x2, y2] = p(r, a1), [x3, y3] = p(r, a0);
    s += `<path d="M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}
      L${x2.toFixed(2)},${y2.toFixed(2)} A${r},${r} 0 ${large} 0 ${x3.toFixed(2)},${y3.toFixed(2)} Z"
      fill="${palette[it.color] || '#D8D2C5'}" stroke="#fff" stroke-width="1.5"><title>${esc(it.name)}：${it.count}</title></path>`;
    a0 = a1;
  });
  s += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="19" font-family="Georgia,serif" font-weight="600" fill="#191714">${total}</text>`;
  s += `<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="9" fill="#918C82">篇文献</text>`;
  list.forEach((it, i) => {
    const ly = 20 + i * 26;
    s += `<rect x="152" y="${ly - 7}" width="7" height="7" rx="1.5" fill="${palette[it.color] || '#D8D2C5'}"/>`;
    s += `<text x="165" y="${ly}" font-size="10.5" fill="#5B574F">${esc(it.name.length > 7 ? it.name.slice(0, 7) + '…' : it.name)}</text>`;
    s += `<text x="262" y="${ly}" text-anchor="end" font-size="10" fill="#918C82" font-family="ui-monospace,monospace">${(it.count / total * 100).toFixed(0)}%</text>`;
  });
  return `<svg viewBox="0 0 268 200" style="width:100%;height:auto;display:block">${s}</svg>`;
}

/* ================= 个人工作台 ================= */
async function renderDesk() {
  const v = $('#view');
  v.innerHTML = `<div class="loading"><div class="spinner"></div>加载中…</div>`;
  try {
    const d = await api('/desk');
    const fav = d.favorites;
    const folders = d.folders || [];
    v.innerHTML = `
      <div class="page-head">
        <div><h1>个人工作台</h1>
          <p>收藏 ${fav.length} 篇 · 已读 ${d.kpi.read_n || 0} 篇 · 我的评论 ${d.comment_total} 条 · 在阅 ${d.kpi.reading_n || 0} 篇</p></div>
        <div class="spacer"></div>
        <button class="btn" data-act="exportnotes">导出我的批注</button>
      </div>

      <div class="kpi-row">
        <div class="kpi"><div class="lb">${I.star.replace('<svg', '<svg width="11" height="11" style="fill:#D9A953;stroke:#BE8B31"')}收藏文献</div>
          <div class="vl">${fav.length}</div><div class="df muted">点击星标即可收藏</div></div>
        <div class="kpi"><div class="lb">已读</div><div class="vl">${d.kpi.read_n || 0}</div>
          <div class="df muted">在阅 ${d.kpi.reading_n || 0} 篇</div></div>
        <div class="kpi"><div class="lb">我的评论</div><div class="vl">${d.comment_total}</div>
          <div class="df muted">全部阅读批注</div></div>
        <div class="kpi"><div class="lb">收藏夹</div><div class="vl">${folders.length || 1}</div>
          <div class="df muted">${esc((folders[0] || {}).folder || '默认收藏')}</div></div>
      </div>

      <div class="desk-grid">
        <div class="panel">
          <div class="panel-head"><h4>我的收藏</h4><span class="hint">共 ${fav.length} 篇 · 按最近收藏</span></div>
          <div class="panel-body" style="padding:12px 16px 4px">
            ${fav.length ? fav.map(savedItem).join('') : `<div class="empty" style="padding:40px 10px">
              <div class="ico">${I.star}</div><h4>还没有收藏</h4><p>在文献流或详情页点击星标，即可收藏到这里。</p></div>`}
          </div>
        </div>

        <div>
          <div class="panel" style="margin-bottom:11px">
            <div class="panel-head"><h4>我的阅读评论</h4><span class="hint">${d.comment_total} 条</span></div>
            <div class="panel-body" style="padding:12px 16px 2px">
              ${d.comments.length ? `<div class="tl">${d.comments.slice(0, 12).map((c, i) => `<div class="tl-item ${i < 2 ? 'hot' : ''}">
                <div class="tl-d">${esc(fmtFull(c.created_at))}</div>
                <div class="tl-t" data-act="open" data-id="${c.paper_id}">${esc((c.paper_title || '').slice(0, 46))}</div>
                <div class="tl-c">${esc(c.content)}</div>
              </div>`).join('')}</div>` : `<div class="empty" style="padding:34px 10px"><div class="ico">💬</div>
                <h4>还没有评论</h4><p>打开任意文献，写下你的阅读笔记。</p></div>`}
            </div>
          </div>

          <div class="side-card" style="background:#FBFAF6">
            <h5>阅读状态</h5>
            <div class="kv"><span>已读</span><span>${d.kpi.read_n || 0} 篇</span></div>
            <div class="kv"><span>在阅</span><span>${d.kpi.reading_n || 0} 篇</span></div>
            <div class="kv"><span>收藏转评论率</span><span>${fav.length ? Math.round(d.comment_total / fav.length * 100) : 0}%</span></div>
          </div>
        </div>
      </div>`;
  } catch (err) {
    v.innerHTML = `<div class="empty"><div class="ico">⚠</div><h4>加载失败</h4><p>${esc(err.message)}</p></div>`;
  }
}

function savedItem(p) {
  const stars = '★'.repeat(p.rating || 0) + '☆'.repeat(5 - (p.rating || 0));
  return `<div class="saved">
    <div class="star on" data-act="fav" data-id="${p.id}" style="margin-left:0">${I.star}</div>
    <div class="bd">
      <h5 data-act="open" data-id="${p.id}">${esc(p.title)}</h5>
      <div class="mt">
        <span class="tag ${COLOR_MAP[p.topic_color] || 't-gray'}" style="font-size:10px">${esc(p.topic_name || '未分类')}</span>
        <span>${esc(fmtDate(p.published))}</span>
        ${p.comment_count ? `<span>评论 ${p.comment_count}</span>` : ''}
        <span style="color:${p.read_state === 'read' ? 'var(--green)' : 'var(--ink-3)'}">${p.read_state === 'read' ? '已读' : p.read_state === 'reading' ? '在阅' : '未读'}</span>
        <span class="rate">${stars}</span>
      </div>
    </div>
  </div>`;
}

/* ================= 个人设置 ================= */
async function renderSettings() {
  const v = $('#view');
  v.innerHTML = `<div class="loading"><div class="spinner"></div>加载中…</div>`;
  try {
    const [s, llmst] = await Promise.all([api('/settings'), api('/llm/status')]);
    S.settings = s;
    S.llm = llmst;
    s.llm_summary_n = llmst.paper_summary_n;
    s.llm_translated_n = llmst.paper_translated_n;
    const aiReady = llmst.ready;
    const hasCode = !!s.mail_auth_code_masked;
    v.innerHTML = `
      <div class="page-head">
        <div><h1>个人设置</h1><p>发件邮箱、抓取策略与站点偏好</p></div>
        <div class="spacer"></div>
        <button class="btn accent" data-act="savesettings">保存设置</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:13px" class="settings-grid">
        <div>
        <div class="panel">
          <div class="panel-head"><h4>发件邮箱（QQ 邮箱）</h4>
            <span class="hint">${hasCode ? '已配置授权码' : '未配置'}</span></div>
          <div class="panel-body">
            <div class="form-note">
              <b>如何获取授权码：</b>登录 QQ 邮箱网页版 → 设置 → 账户 → 开启「POP3/SMTP 服务」→ 生成授权码（16 位）。
              授权码不是 QQ 密码，仅用于第三方客户端发信。
            </div>
            <div class="field"><label>QQ 邮箱账号</label>
              <input class="input" id="s-mail-user" value="${esc(s.mail_user || '')}" placeholder="yourname@qq.com">
            </div>
            <div class="field"><label>SMTP 授权码</label>
              <input class="input" id="s-mail-code" type="password" placeholder="${hasCode ? '已保存：' + esc(s.mail_auth_code_masked) + '（留空则不修改）' : '请输入 16 位授权码'}">
              <div class="desc">${hasCode ? '已保存授权码，如需更换请直接输入新的授权码覆盖。' : '首次使用必须填写，否则无法发送邮件。'}</div>
            </div>
            <div class="two">
              <div class="field"><label>SMTP 服务器</label><input class="input" id="s-mail-host" value="${esc(s.mail_host || 'smtp.qq.com')}"></div>
              <div class="field"><label>端口</label><input class="input" id="s-mail-port" value="${esc(s.mail_port || '465')}"></div>
            </div>
            <button class="btn" data-act="mailtest" style="width:100%;justify-content:center">${I.mail}发送测试邮件验证配置</button>
          </div>
        </div>

        <div class="panel" style="margin-top:13px">
          <div class="panel-head"><h4>AI 服务（双语翻译 · 内容概要）</h4>
            <span class="hint">${aiReady ? '已启用 · 模型 ' + esc(s.llm_model || '') : '未启用（AI 功能自动关闭）'}</span></div>
          <div class="panel-body">
            <div class="form-note">
              填写任意 <b>OpenAI 兼容接口</b>即可启用：DeepSeek、通义千问、Kimi、OpenAI、本地 Ollama 都可以。
              不填写或不启用时，双语与概要按钮会提示「未启用」，其余功能（浏览 / 收藏 / 推送）不受影响。
            </div>
            <div class="toggle-row" style="margin-top:0;margin-bottom:12px">
              <div class="switch ${s.llm_enabled === '1' ? 'on' : ''}" id="s-llm-on" data-val="${s.llm_enabled === '1' ? 1 : 0}"></div>
              <span>启用 AI 功能</span>
              <span style="margin-left:auto;font-size:10.5px;color:var(--ink-3)">已翻译 ${s.llm_translated_n || 0} 篇 · 已生成概要 ${s.llm_summary_n || 0} 篇</span>
            </div>
            <div class="field"><label>接口地址（Base URL）</label>
              <input class="input" id="s-llm-base" value="${esc(s.llm_base_url || '')}" placeholder="https://api.deepseek.com/v1">
              <div class="desc">填到 /v1 为止，系统会自动拼接 /chat/completions</div>
            </div>
            <div class="two">
              <div class="field"><label>模型名称</label>
                <input class="input" id="s-llm-model" value="${esc(s.llm_model || '')}" placeholder="deepseek-chat"></div>
              <div class="field"><label>超时（秒）</label>
                <input class="input" id="s-llm-timeout" type="number" min="10" max="300" value="${esc(s.llm_timeout || '60')}"></div>
            </div>
            <div class="field"><label>API Key</label>
              <input class="input" id="s-llm-key" type="password" placeholder="${s.llm_api_key_masked ? '已保存：' + esc(s.llm_api_key_masked) + '（留空则不修改）' : 'sk-...'}">
              <div class="desc">仅保存在本地数据库，不会上传到任何第三方。</div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn" data-act="llmtest" style="flex:1;justify-content:center">测试连接</button>
              <button class="btn" data-act="batchsummary" style="flex:1;justify-content:center">补生成概要</button>
            </div>
          </div>
        </div>
        </div>

        <div>
          <div class="panel" style="margin-bottom:13px">
            <div class="panel-head"><h4>抓取策略</h4></div>
            <div class="panel-body">
              <div class="two">
                <div class="field"><label>每日抓取时间</label><input class="input" id="s-fetch-time" type="time" value="${esc(s.fetch_time || '08:00')}"></div>
                <div class="field"><label>每日总篇数</label><input class="input" id="s-fetch-total" type="number" min="1" max="200" value="${esc(s.fetch_total || 20)}"></div>
              </div>
              <div class="two">
                <div class="field"><label>单主题上限</label><input class="input" id="s-fetch-max" type="number" min="1" max="50" value="${esc(s.fetch_max_per_topic || 10)}"></div>
                <div class="field"><label>提交时间范围（天）</label><input class="input" id="s-fetch-days" type="number" min="1" max="180" value="${esc(s.fetch_days || 7)}"></div>
              </div>
              <div class="field" style="margin-bottom:0"><label>配额分配方式</label>
                <div class="seg" id="s-alloc">
                  <span class="${s.fetch_allocation !== 'auto' ? 'on' : ''}" data-v="topic">按主题配额</span>
                  <span class="${s.fetch_allocation === 'auto' ? 'on' : ''}" data-v="auto">自动均分</span>
                </div>
              </div>
            </div>
          </div>

          <div class="panel" style="margin-bottom:13px">
            <div class="panel-head"><h4>数据与状态</h4></div>
            <div class="panel-body">
              <div class="kv"><span>数据库文件</span><span>data/paperlens.db</span></div>
              <div class="kv"><span>上次抓取日期</span><span>${esc(s.last_fetch_date || '尚未抓取')}</span></div>
              <div class="kv"><span>上次推送日期</span><span>${esc(s.last_mail_date || '尚未推送')}</span></div>
              <div style="display:flex;gap:8px;margin-top:12px">
                <button class="btn sm" data-act="sync" style="flex:1;justify-content:center">${I.sync}立即抓取</button>
                <button class="btn sm" data-act="mailsave" style="flex:1;justify-content:center">保存并发送</button>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><h4>AI 能力状态</h4>
              <span class="hint">${aiReady ? '运行中' : '未启用'}</span></div>
            <div class="panel-body" style="font-size:11.5px;color:var(--ink-2);line-height:1.9">
              <div style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start">
                <span class="tag ${aiReady ? 't-green' : 't-amber'}" style="font-size:10px;flex:0 0 auto">${aiReady ? '可用' : '待配置'}</span>
                <span><b>双语阅览</b> · 标题与摘要段落级翻译，译文入库缓存，重复查看不消耗额度</span>
              </div>
              <div style="display:flex;gap:8px;align-items:flex-start">
                <span class="tag ${aiReady ? 't-green' : 't-amber'}" style="font-size:10px;flex:0 0 auto">${aiReady ? '可用' : '待配置'}</span>
                <span><b>内容概要</b> · 研究方向 / 方法创新点 / 主要结论 / 局限，可附在推送邮件中</span>
              </div>
              <div class="kv" style="margin-top:10px"><span>已翻译文献</span><span>${s.llm_translated_n} 篇</span></div>
              <div class="kv"><span>已生成概要</span><span>${s.llm_summary_n} 篇</span></div>
              ${aiReady ? '' : '<div style="margin-top:10px;color:var(--ink-3);font-size:10.5px">在左栏填写接口地址与 API Key 并启用后，上述能力立即生效。</div>'}
            </div>
          </div>
        </div>
      </div>`;

    $$('#s-alloc span', v).forEach(sp => sp.onclick = () => {
      $$('#s-alloc span', v).forEach(x => x.classList.remove('on'));
      sp.classList.add('on');
    });
    bindToggles(v);
  } catch (err) {
    v.innerHTML = `<div class="empty"><div class="ico">⚠</div><h4>加载失败</h4><p>${esc(err.message)}</p></div>`;
  }
}

/* ================= 事件 ================= */
const ACTIONS = {
  async fav(el) {
    const id = el.dataset.id;
    const on = !el.classList.contains('on');
    try {
      await api(`/papers/${id}/favorite`, { method: 'POST', body: { on } });
      el.classList.toggle('on', on);
      toast(on ? '已收藏' : '已取消收藏');
      if (S.page === 'desk') renderDesk();
    } catch (e) { toast(e.message, 'err'); }
  },
  open(el) { go('detail', { id: el.dataset.id }); },
  topic(el) {
    S.feed.topic = el.dataset.id;
    S.feed.offset = 0;
    renderFeed();
  },
  clearq() {
    S.feed.q = '';
    $('#global-search').value = '';
    S.feed.offset = 0;
    renderFeed();
  },
  more() { S.feed.offset += S.feed.limit; renderFeed(); },
  copy(el) { copyText(el.dataset.text || ''); },
  async delcmt(el) {
    const ok = await confirmBox('删除评论', '确定要删除这条评论吗？删除后不可恢复。', '删除');
    if (!ok) return;
    await api('/comments/' + el.dataset.id, { method: 'DELETE' });
    toast('已删除');
    renderDetail();
  },
  async state(el) {
    await api(`/papers/${el.dataset.id}/state`, { method: 'POST', body: { state: el.dataset.state } });
    toast('已标记');
  },
  async lang(el) {
    const mode = el.dataset.mode || 'orig';
    const p = S.detailPaper;
    if (mode !== 'orig' && p && !p.llm_ready) {
      toast('未配置 AI 服务，请到「个人设置 → AI 服务」启用', 'err');
      return;
    }
    S.detailLang = mode;
    if (mode !== 'orig' && p && !(p.abstract_zh || '').trim()) {
      toast('正在翻译，请稍候…');
      try {
        await api(`/papers/${p.id}/translate`, { method: 'POST' });
        toast('翻译完成');
      } catch (e) {
        toast(e.message, 'err');
        S.detailLang = 'orig';
      }
    }
    renderDetail();
  },
  async gensummary(el) {
    const id = (S.page === 'detail' && S.detailId) || el.dataset.id;
    const old = el.innerHTML;
    el.disabled = true;
    el.textContent = '生成中…';
    try {
      await api(`/papers/${id}/summary`, { method: 'POST' });
      toast('概要已生成');
      if (S.page === 'detail') renderDetail();
    } catch (e) {
      toast(e.message, 'err');
      el.disabled = false;
      el.innerHTML = old;
    }
  },
  async summary(el) {
    const id = el.dataset.id;
    let p;
    try { p = await api('/papers/' + id); } catch (e) { return toast(e.message, 'err'); }
    if (!p.summary_json) {
      if (!p.llm_ready) return toast('未配置 AI 服务，请到「个人设置 → AI 服务」启用', 'err');
      toast('正在生成概要，约 3–8 秒…');
      try {
        await api(`/papers/${id}/summary`, { method: 'POST' });
        p = await api('/papers/' + id);
        toast('概要已生成');
      } catch (e) { return toast(e.message, 'err'); }
    }
    openModal({
      title: '内容概要', width: 640,
      body: `<div style="font-size:11.5px;color:var(--ink-3);margin-bottom:10px;line-height:1.7">
        <b style="color:var(--ink-2)">${esc(p.title)}</b></div>${summaryHtml(p.summary_json, p.llm_ready, true)}`,
      foot: `<button class="btn" data-close>关闭</button>
        <a class="btn accent" href="#detail/${p.id}" data-close onclick="setTimeout(()=>go('detail',{id:${p.id}}),0)">打开全文</a>`,
    });
  },
  newtopic() {
    const close = openModal({
      title: '新建订阅主题', width: 560,
      body: topicForm({}),
      foot: `<button class="btn" data-close>取消</button><button class="btn accent" id="save-topic">创建主题</button>`,
      onMount(root, closeFn) {
        bindColorSeg(root);
        root.querySelector('#save-topic').onclick = async () => {
          const body = {
            name: root.querySelector('#f-name').value.trim(),
            keywords: root.querySelector('#f-kw').value.trim(),
            categories: root.querySelector('#f-cat').value.trim(),
            daily_limit: Number(root.querySelector('#f-limit').value || 5),
            color: (root.querySelector('#f-color .on') || { dataset: { c: 'blue' } }).dataset.c,
            enabled: true,
          };
          if (!body.name) return toast('请填写主题名称', 'err');
          try {
            await api('/topics', { method: 'POST', body });
            closeFn(); toast('主题已创建'); renderTopics();
          } catch (e) { toast(e.message, 'err'); }
        };
      }
    });
  },
  edittopic(el) {
    const t = S.topics.find(x => String(x.id) === String(el.dataset.id));
    if (!t) return;
    openModal({
      title: '编辑主题', width: 560,
      body: topicForm(t),
      foot: `<button class="btn" data-close>取消</button><button class="btn accent" id="save-topic">保存</button>`,
      onMount(root, closeFn) {
        bindColorSeg(root);
        root.querySelector('#save-topic').onclick = async () => {
          const body = {
            name: root.querySelector('#f-name').value.trim(),
            keywords: root.querySelector('#f-kw').value.trim(),
            categories: root.querySelector('#f-cat').value.trim(),
            daily_limit: Number(root.querySelector('#f-limit').value || 0),
            color: (root.querySelector('#f-color .on') || { dataset: { c: 'blue' } }).dataset.c,
            enabled: !!t.enabled,
          };
          if (!body.name) return toast('请填写主题名称', 'err');
          try {
            await api('/topics/' + t.id, { method: 'PUT', body });
            closeFn(); toast('已保存'); renderTopics();
          } catch (e) { toast(e.message, 'err'); }
        };
      }
    });
  },
  async toggletopic(el) {
    const t = S.topics.find(x => String(x.id) === String(el.dataset.id));
    if (!t) return;
    await api('/topics/' + t.id, {
      method: 'PUT',
      body: { name: t.name, keywords: t.keywords, categories: t.categories, daily_limit: t.daily_limit, color: t.color, enabled: el.dataset.on === '1' },
    });
    renderTopics();
  },
  async deltopic(el) {
    const t = S.topics.find(x => String(x.id) === String(el.dataset.id));
    const ok = await confirmBox('删除主题', `确定删除「${esc(t ? t.name : '')}」吗？<br>已抓取的文献会保留，但不再归属该主题。`, '删除');
    if (!ok) return;
    await api('/topics/' + el.dataset.id, { method: 'DELETE' });
    toast('已删除'); renderTopics();
  },
  async steptopic(el) {
    const delta = Number(el.dataset.delta);
    const t = S.topics.find(x => String(x.id) === String(el.dataset.id));
    if (!t) return;
    const next = Math.max(0, Math.min(50, Number(t.daily_limit) + delta));
    await api('/topics/' + t.id, {
      method: 'PUT',
      body: { name: t.name, keywords: t.keywords, categories: t.categories, daily_limit: next, color: t.color, enabled: !!t.enabled },
    });
    renderTopics();
  },
  async 'step-setting'(el) {
    const key = el.dataset.key;
    const delta = Number(el.dataset.delta);
    const cur = Number(S.settings[key] || 20);
    const next = Math.max(1, Math.min(200, cur + delta));
    await api('/settings', { method: 'POST', body: { [key]: next } });
    S.settings[key] = next;
    renderTopics();
  },
  async sync() {
    try {
      const r = await api('/sync', { method: 'POST', body: { background: true } });
      toast(r.message || '已开始同步');
      pollSync();
    } catch (e) { toast(e.message, 'err'); }
  },
  async mailsave() {
    const body = {};
    const g = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
    if (g('m-time') !== undefined) body.mail_time = g('m-time');
    if (g('m-fallback') !== undefined) body.mail_fallback_days = g('m-fallback');
    const sw = id => ($(id) && String($(id).dataset.val) === '1') ? '1' : '0';
    if ($('#m-enabled')) body.mail_enabled = sw('#m-enabled');
    if ($('#m-abs')) body.mail_include_abstract = sw('#m-abs');
    if ($('#m-sum')) body.mail_include_summary = sw('#m-sum');
    if ($('#m-onlynew')) body.mail_only_new = sw('#m-onlynew');
    try {
      await api('/settings', { method: 'POST', body });
      S.settings = await api('/settings');
      toast('配置已保存');
    } catch (e) { toast(e.message, 'err'); }
  },
  addrecipient() { openRecipientModal(null); },
  editrecip(el) {
    const r = S.recipients.find(x => String(x.id) === String(el.dataset.id));
    if (r) openRecipientModal(r);
  },
  async delrecip(el) {
    const r = S.recipients.find(x => String(x.id) === String(el.dataset.id));
    const ok = await confirmBox('删除收件人', `确定不再向 <b>${esc(r ? r.email : '')}</b> 推送邮件吗？`, '删除');
    if (!ok) return;
    try {
      await api('/recipients/' + el.dataset.id, { method: 'DELETE' });
      toast('已删除');
      renderMail();
    } catch (e) { toast(e.message, 'err'); }
  },
  async togglerecip(el) {
    const r = S.recipients.find(x => String(x.id) === String(el.dataset.id));
    if (!r) return;
    const on = !el.classList.contains('on');
    try {
      await api('/recipients/' + r.id, {
        method: 'PUT',
        body: {
          email: r.email, name: r.name, topic_ids: r.topic_ids, keywords: r.keywords,
          categories: r.categories, daily_count: r.daily_count,
          include_summary: !!r.include_summary, enabled: on,
        },
      });
      renderMail();
    } catch (e) { toast(e.message, 'err'); }
  },
  previewrecip(el) {
    S.previewRecipient = Number(el.dataset.id);
    renderMail();
  },
  async savesettings() {
    const body = {
      mail_user: $('#s-mail-user').value.trim(),
      mail_host: $('#s-mail-host').value.trim(),
      mail_port: $('#s-mail-port').value.trim(),
      fetch_time: $('#s-fetch-time').value,
      fetch_total: $('#s-fetch-total').value,
      fetch_max_per_topic: $('#s-fetch-max').value,
      fetch_days: $('#s-fetch-days').value,
      fetch_allocation: ($('#s-alloc .on') || { dataset: { v: 'topic' } }).dataset.v,
      llm_base_url: $('#s-llm-base').value.trim(),
      llm_model: $('#s-llm-model').value.trim(),
      llm_timeout: $('#s-llm-timeout').value,
      llm_enabled: $('#s-llm-on').dataset.val === '1' ? '1' : '0',
    };
    const code = $('#s-mail-code').value.trim();
    if (code) body.mail_auth_code = code;
    const key = $('#s-llm-key').value.trim();
    if (key) body.llm_api_key = key;
    try {
      await api('/settings', { method: 'POST', body });
      S.settings = await api('/settings');
      toast('设置已保存');
      renderSettings();
    } catch (e) { toast(e.message, 'err'); }
  },
  async llmtest() {
    await ACTIONS.savesettings();
    toast('正在测试 AI 接口…');
    try {
      const r = await api('/llm/test', { method: 'POST', body: {} });
      if (r.ok) toast(`AI 接口可用（${r.model}）`);
      else toast('连接失败：' + r.reason, 'err');
    } catch (e) { toast(e.message, 'err'); }
  },
  async batchsummary() {
    if (!S.llm || !S.llm.ready) return toast('请先配置并启用 AI 服务', 'err');
    toast('正在为最近的文献补生成概要…');
    try {
      const r = await api('/summary/batch', { method: 'POST', body: { limit: 5 } });
      if (r.stopped) return toast(r.errors[0] || 'AI 服务未就绪', 'err');
      toast(`本次生成 ${r.done} 篇${r.errors.length ? '，' + r.errors[0] : ''}，剩余 ${r.remaining} 篇`);
      renderSettings();
    } catch (e) { toast(e.message, 'err'); }
  },
  async mailtest() {
    // 先保存当前设置页的字段，再发送
    if (S.page === 'settings') await ACTIONS.savesettings();
    if (S.page === 'mail') await ACTIONS.mailsave();
    toast('正在发送测试邮件…');
    try {
      const r = await api('/mail/send', { method: 'POST', body: { force: true } });
      if (r.sent) toast(`测试邮件已发送（${r.count} 篇）`);
      else toast('发送失败：' + r.reason, 'err');
    } catch (e) { toast(e.message, 'err'); }
  },
  async export() {
    try {
      const d = await api('/papers?limit=100&sort=fetched');
      const lines = d.items.map(p => {
        const authors = (p.authors_all || '').split(',').map(a => a.trim()).filter(Boolean).join(' and ');
        const key = (p.authors_all || '').split(',')[0].replace(/[^A-Za-z]/g, '') + (p.published || '').slice(0, 4) + p.arxiv_id.replace('.', '');
        return `@article{${key},
  title   = {${p.title}},
  author  = {${authors}},
  journal = {arXiv preprint arXiv:${p.arxiv_id}},
  year    = {${(p.published || '').slice(0, 4)}},
  url     = {${p.abs_url}}
}`;
      }).join('\n\n');
      downloadText('paperlens_papers.bib', lines);
      toast(`已导出 ${d.items.length} 条 BibTeX`);
    } catch (e) { toast(e.message, 'err'); }
  },
  async exportnotes() {
    try {
      const d = await api('/desk');
      const lines = d.comments.map(c => `[${fmtFull(c.created_at)}] ${c.paper_title}\n  ${c.content}\n`);
      downloadText('paperlens_notes.txt', lines.join('\n') || '暂无批注');
      toast('批注已导出');
    } catch (e) { toast(e.message, 'err'); }
  },
};

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ---- 全局点击委托 ---- */
document.addEventListener('click', (e) => {
  const navEl = e.target.closest('[data-go]');
  if (navEl && !e.target.closest('[data-act]')) {
    e.preventDefault();
    go(navEl.dataset.go);
    return;
  }
  const stepBtn = e.target.closest('.step b[data-delta]');
  if (stepBtn) {
    const host = stepBtn.closest('[data-act]');
    if (host && ACTIONS[host.dataset.act]) {
      ACTIONS[host.dataset.act]({ dataset: { ...host.dataset, delta: stepBtn.dataset.delta } });
      return;
    }
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'fav' && e.target.closest('a')) return;
  if (ACTIONS[act]) { e.preventDefault(); ACTIONS[act](el); }
});

/* ---- 搜索 ---- */
function initSearch() {
  const input = $('#global-search');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      S.feed.q = input.value.trim();
      S.feed.offset = 0;
      if (S.page !== 'feed') go('feed'); else renderFeed();
    }, 420);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      S.feed.q = input.value.trim();
      S.feed.offset = 0;
      if (S.page !== 'feed') go('feed'); else renderFeed();
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault(); input.focus(); input.select();
    }
  });
}

/* ---- 同步轮询 ---- */
let pollTimer = null;
async function pollSync() {
  clearTimeout(pollTimer);
  try {
    const st = await api('/sync/status');
    const state = $('#sync-state');
    const text = $('#sync-text');
    if (st.running) {
      state.classList.add('busy');
      text.textContent = '正在同步文献…';
      $('#btn-sync').classList.add('spin');
      pollTimer = setTimeout(pollSync, 2000);
    } else {
      state.classList.remove('busy');
      text.textContent = '自动同步已就绪';
      $('#btn-sync').classList.remove('spin');
      if (st.last_result) {
        const r = st.last_result;
        if (r.error) toast('同步异常：' + r.error, 'err');
        else toast(`同步完成：新增 ${r.fetched} 篇，跳过重复 ${r.skipped} 篇`);
        if (S.page === 'feed' || S.page === 'stats' || S.page === 'topics') {
          S.feed.offset = 0;
          ({ feed: renderFeed, stats: renderStats, topics: renderTopics })[S.page]();
        }
      }
    }
    const meta = $('#sync-meta');
    if (meta) meta.textContent = `下次抓取 ${S.settings.fetch_time || '08:00'} · ${S.topics.filter(t => t.enabled).length || '—'} 个主题`;
  } catch { /* 静默 */ }
}

/* ---- 初始化 ---- */
/* ================= 静态镜像：界面裁剪 ================= */
function setupStaticUi() {
  ['topics', 'mail', 'desk', 'settings'].forEach((k) => {
    const el = document.querySelector(`.nav-item[data-go="${k}"]`);
    if (el) el.remove();
  });
  ['#btn-sync', '#btn-mail'].forEach((s) => { const el = $(s); if (el) el.remove(); });
  document.querySelectorAll('.nav-label').forEach((lb) => {
    let next = lb.nextElementSibling, has = false;
    while (next && !next.classList.contains('nav-label')) {
      if (next.classList.contains('nav-item')) { has = true; break; }
      next = next.nextElementSibling;
    }
    if (!has) lb.remove();
  });
  const bar = document.createElement('div');
  bar.className = 'static-bar';
  bar.innerHTML = `<b>只读镜像</b><span>数据构建于 ${esc(window.PAPERLENS_BUILT || '—')} · 收录 ${window.PAPERLENS_COUNT || 0} 篇</span>
    <span class="sp"></span><span class="dim">收藏 / 评论 / 邮件推送在本机完整版中提供</span>`;
  const main = document.querySelector('.main');
  main.insertBefore(bar, main.querySelector('.scroll'));
  const st = $('#sync-text'); if (st) st.textContent = '静态镜像';
  const meta = $('#sync-meta'); if (meta) meta.textContent = '每日自动构建';
  const av = $('#avatar'); if (av) av.onclick = () => toast('完整版在本机运行，可收藏与评论');
}

async function boot() {
  initSearch();
  $('#menu-btn').onclick = () => $('#sidebar').classList.toggle('open');
  if (!STATIC_MODE) {
    $('#btn-sync').onclick = () => ACTIONS.sync();
    $('#btn-mail').onclick = () => ACTIONS.mailtest();
    $('#avatar').onclick = () => go('settings');
  } else {
    setupStaticUi();
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#sidebar') && !e.target.closest('#menu-btn')) $('#sidebar').classList.remove('open');
  });

  try { S.settings = await api('/settings'); } catch { S.settings = {}; }
  try { S.topics = await api('/topics'); } catch { S.topics = []; }
  try { S.llm = await api('/llm/status'); } catch { S.llm = null; }

  const nav = $('#nav-cmt');
  if (nav) {
    if (STATIC_MODE) nav.style.display = 'none';
    else nav.textContent = S.topics.reduce((a, t) => a + (t.today_count || 0), 0) || '0';
  }

  const hash = location.hash.replace('#', '');
  if (hash.startsWith('detail/')) { S.detailId = hash.split('/')[1]; go('detail', { id: S.detailId }); }
  else if (NAV_NAME[hash] && !(STATIC_MODE && ['topics', 'mail', 'desk', 'settings'].includes(hash))) go(hash);
  else go('feed');

  if (!STATIC_MODE) {
    pollSync();
    setInterval(pollSync, 60000);
  }
}

boot();
