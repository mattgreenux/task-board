// The task board: shows Next Steps, the backlog and the feature ideas as three
// lists, and saves changes back to the Markdown files on GitHub as one commit.
// How it works and why: README.md, and docs/Task-Board.md in TimeRush.

import { parseList, serializeList, itemToText, textToItem } from './lists.js';

// Each list lives in one file. `section` is the "## " heading it sits under
// (null: the file's first list). `marker` and `indent` are how items and their
// notes are written in that file.
const LISTS = [
  { key: 'next', name: 'Next Steps', file: 'TODO.md', section: 'Next Steps', marker: '1. ', indent: '   ', numbered: true },
  { key: 'backlog', name: 'Backlog', file: 'BACKLOG.md', section: null, marker: '- ', indent: '  ' },
  { key: 'ideas', name: 'Feature ideas', file: 'IDEAS.md', section: 'Feature ideas', marker: '- ', indent: '  ' },
];
const listByKey = Object.fromEntries(LISTS.map((l) => [l.key, l]));

const API = 'https://api.github.com';

// ---------------------------------------------------------------------------
// Saved settings. localStorage keeps small values in this browser between
// visits; it can be unavailable (e.g. private browsing), hence the try/catch.

function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
function writeStore(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not saved; the board still works for this visit.
  }
}

// The repo whose lists the board edits. It's a different repo from the one the
// page is published from, so it's fixed here rather than taken from the page's
// address. It can be changed in Settings.
const DEFAULT_REPO = { owner: 'mattgreenux', repo: 'TimeRush', branch: 'main' };

let settings = { ...DEFAULT_REPO, ...readStore('taskboard:settings', {}) };
let token = readStore('taskboard:token', '');
const draftKey = () => `taskboard:draft:${settings.owner}/${settings.repo}/${settings.branch}`;

// ---------------------------------------------------------------------------
// State. `files` holds each file as last loaded from GitHub; `lists` holds the
// items as currently edited. A file needs saving when rebuilding it from the
// edited items gives different text.

let state = null; // { headSha, files: { name: { sha, text } }, lists: { key: { parsed?, error?, items } }, log: [] }
let nextId = 1;
let detailsOpen = readStore('taskboard:details', true); // notes show until switched off

const withId = (item) => ({ ...item, id: nextId++ });

function buildFile(list) {
  const { parsed, items } = state.lists[list.key];
  return serializeList({ before: parsed.before, after: parsed.after, items }, list);
}

function changedLists() {
  if (!state) return [];
  return LISTS.filter((l) => !state.lists[l.key].error && buildFile(l) !== state.files[l.file].text);
}

function findItem(id) {
  for (const list of LISTS) {
    const items = state.lists[list.key].items;
    const index = items.findIndex((it) => it.id === id);
    if (index >= 0) return { list, items, index, item: items[index] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// GitHub API

class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// `as` picks the answer: 'json', a file's contents as 'text' or a 'blob' (for
// images), or a Markdown file turned into a web page by GitHub ('html').
const ACCEPT = {
  json: 'application/vnd.github+json',
  text: 'application/vnd.github.raw+json',
  blob: 'application/vnd.github.raw+json',
  html: 'application/vnd.github.html+json',
};
async function gh(path, { method = 'GET', body, as = 'json' } = {}) {
  const headers = {
    Accept: ACCEPT[as],
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const repoPath = `/repos/${settings.owner}/${settings.repo}`;
  let response;
  try {
    response = await fetch(API + repoPath + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store', // always ask GitHub, never reuse an old answer
    });
  } catch {
    throw new GitHubError(0, "Couldn't reach GitHub. Check your connection and try again.");
  }
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.json()).message ?? '';
    } catch {
      // No details in the response.
    }
    throw new GitHubError(response.status, detail);
  }
  if (as === 'json') return response.json();
  return as === 'blob' ? response.blob() : response.text();
}

function explain(error, writing = false) {
  if (!(error instanceof GitHubError)) return `Something went wrong: ${error.message}`;
  if (error.status === 0) return error.message;
  if (error.status === 401) return "GitHub didn't accept your token. It may have expired: make a new one in Settings.";
  if (error.status === 403 && /rate limit/i.test(error.message)) {
    return "GitHub's limit for visitors without a token was reached. Add your token in Settings.";
  }
  if (writing && (error.status === 403 || error.status === 404)) {
    return 'Your token can read but not save. Give it “Contents: Read and write” for this repository.';
  }
  if (error.status === 403 || error.status === 404) {
    // GitHub answers 404 rather than 403 for a private repo the token can't see.
    return `Couldn't open ${settings.owner}/${settings.repo} (branch ${settings.branch}). Check the names in Settings, and that your token has access to this repository.`;
  }
  return `GitHub said: ${error.status} ${error.message}`;
}

// Reads the three files as they are in the branch's latest commit.
async function fetchSnapshot() {
  const ref = await gh(`/git/ref/heads/${encodeURIComponent(settings.branch)}`);
  const commit = await gh(`/git/commits/${ref.object.sha}`);
  const tree = await gh(`/git/trees/${commit.tree.sha}`);
  const files = {};
  await Promise.all(LISTS.map(async (list) => {
    const entry = tree.tree.find((e) => e.path === list.file);
    if (!entry) throw new GitHubError(404, `${list.file} is missing`);
    files[list.file] = { sha: entry.sha, text: await gh(`/git/blobs/${entry.sha}`, { as: 'text' }) };
  }));
  return { headSha: ref.object.sha, files };
}

// ---------------------------------------------------------------------------
// Loading

async function load() {
  hideBanner();
  // The lists live in a private repo, so GitHub won't show them without a
  // token. Ask for one instead of showing GitHub's error.
  if (!token) {
    state = null;
    render();
    return;
  }
  setBusy(true);
  try {
    const snapshot = await fetchSnapshot();
    state = { ...snapshot, lists: {}, log: [] };
    for (const list of LISTS) {
      try {
        const parsed = parseList(snapshot.files[list.file].text, list.section);
        state.lists[list.key] = { parsed, items: parsed.items.map(withId) };
      } catch (error) {
        state.lists[list.key] = { error: error.message, items: [] };
      }
    }
    restoreDraft();
  } catch (error) {
    state = null;
    showBanner(explain(error), 'error', { label: 'Settings', action: () => openSettings() });
  }
  setBusy(false);
  render();
}

// Unsaved edits are kept in this browser, so a phone reloading the page in
// the background doesn't lose them. They're only restored onto the same file
// versions they were made on; otherwise the user can copy them out.
function saveDraft() {
  if (!state) return;
  if (changedLists().length === 0) {
    writeStore(draftKey(), undefined);
    return;
  }
  writeStore(draftKey(), {
    shas: Object.fromEntries(LISTS.map((l) => [l.file, state.files[l.file].sha])),
    lists: Object.fromEntries(LISTS.map((l) => [l.key, state.lists[l.key].items.map(({ title, details }) => ({ title, details }))])),
    log: state.log,
  });
}

function restoreDraft() {
  const draft = readStore(draftKey(), null);
  if (!draft) return;
  const sameFiles = LISTS.every((l) => draft.shas?.[l.file] === state.files[l.file].sha && !state.lists[l.key].error);
  if (sameFiles) {
    for (const list of LISTS) state.lists[list.key].items = draft.lists[list.key].map(withId);
    state.log = draft.log ?? [];
    showBanner('Your unsaved changes from last time are back. Save them when you’re ready.', 'info');
    return;
  }
  showBanner('The lists changed on GitHub since your last unsaved edits, so those edits weren’t applied.', 'warning', {
    label: 'Show them',
    action: () => showText({
      heading: 'Your unsaved edits',
      message: 'These are your lists as you left them. Copy anything you want to keep, then redo it here.',
      text: draftAsText(draft),
      secondary: { label: 'Discard them', action: () => { writeStore(draftKey(), undefined); hideBanner(); } },
    }),
  });
}

function draftAsText(draft) {
  return LISTS.map((list) => {
    const items = draft.lists?.[list.key] ?? [];
    return `## ${list.name}\n\n${serializeList({ before: [], after: [], items }, list)}`;
  }).join('\n\n');
}

// ---------------------------------------------------------------------------
// Saving: one commit for all changed files, made through GitHub's "Git data"
// API (create a tree of files, then a commit, then move the branch to it).

async function save() {
  const changed = changedLists();
  if (changed.length === 0) return;
  if (!token) {
    openSettings('Add a GitHub token to save your changes.');
    return;
  }
  setBusy(true);
  try {
    // Try twice in case someone else commits in the second between steps.
    for (let attempt = 0; ; attempt++) {
      const ref = await gh(`/git/ref/heads/${encodeURIComponent(settings.branch)}`);
      const latestSha = ref.object.sha;
      const latest = await gh(`/git/commits/${latestSha}`);

      if (latestSha !== state.headSha) {
        // Someone (usually Claude) committed since we loaded. That's fine as
        // long as they didn't change the files we're about to write.
        const tree = await gh(`/git/trees/${latest.tree.sha}`);
        const conflicts = changed.filter((l) => tree.tree.find((e) => e.path === l.file)?.sha !== state.files[l.file].sha);
        if (conflicts.length > 0) {
          showConflict(conflicts);
          return;
        }
      }

      const contents = Object.fromEntries(changed.map((l) => [l.file, buildFile(l)]));
      const tree = await gh('/git/trees', {
        method: 'POST',
        body: {
          base_tree: latest.tree.sha,
          tree: changed.map((l) => ({ path: l.file, mode: '100644', type: 'blob', content: contents[l.file] })),
        },
      });
      const commit = await gh('/git/commits', {
        method: 'POST',
        body: { message: commitMessage(), tree: tree.sha, parents: [latestSha] },
      });
      try {
        // force: false makes GitHub refuse if the branch moved meanwhile.
        await gh(`/git/refs/heads/${encodeURIComponent(settings.branch)}`, {
          method: 'PATCH',
          body: { sha: commit.sha, force: false },
        });
      } catch (error) {
        if (error.status === 422 && attempt === 0) continue;
        throw error;
      }

      state.headSha = commit.sha;
      for (const list of changed) {
        state.files[list.file] = { sha: tree.tree.find((e) => e.path === list.file).sha, text: contents[list.file] };
        state.lists[list.key].parsed = parseList(contents[list.file], list.section);
      }
      state.log = [];
      saveDraft();
      showBanner('Saved.', 'success', { label: 'View commit', href: commit.html_url });
      break;
    }
  } catch (error) {
    showBanner(explain(error, true), 'error');
  } finally {
    setBusy(false);
    render();
  }
}

function showConflict(conflicts) {
  const names = conflicts.map((l) => l.file).join(' and ');
  showText({
    heading: 'Changed on GitHub',
    message: `${names} changed on GitHub after you opened the board (probably in a Claude session), so saving would overwrite that. Your edits to it are below: copy them, reload, then redo them.`,
    text: conflicts.map((l) => `## ${l.name}\n\n${serializeList({ before: [], after: [], items: state.lists[l.key].items }, l)}`).join('\n\n'),
    secondary: { label: 'Reload from GitHub', action: discardAndReload },
  });
}

// The commit message lists what changed, so the history (and Claude) can tell
// what happened. Every message starts with "Task board:".
function commitMessage() {
  const ops = [...new Set(state.log)];
  if (ops.length === 0) return 'Task board: Update task lists';
  if (ops.length === 1) return `Task board: ${ops[0]}`;
  return `Task board: ${ops.length} changes to the task lists\n\n${ops.map((o) => `- ${o}`).join('\n')}`;
}

const short = (title) => {
  const plain = title.replace(/`/g, '');
  return `"${plain.length > 50 ? `${plain.slice(0, 49)}…` : plain}"`;
};

// ---------------------------------------------------------------------------
// Changes. Each one updates the items, notes what happened for the commit
// message, keeps the draft and redraws.

function changed(op) {
  if (op) state.log.push(op);
  saveDraft();
  render();
}

function moveItem(id, toKey, toIndex) {
  const from = findItem(id);
  if (!from) return;
  from.items.splice(from.index, 1);
  const target = state.lists[toKey].items;
  target.splice(Math.max(0, Math.min(toIndex, target.length)), 0, from.item);
  if (from.list.key !== toKey) {
    changed(`Move ${short(from.item.title)} from ${from.list.name} to ${listByKey[toKey].name}`);
  } else if (from.index !== toIndex) {
    changed(`Reorder ${from.list.name}`);
  } else {
    render();
  }
}

// ---------------------------------------------------------------------------
// Drawing. The whole board is redrawn after each change; with a few dozen
// items that's instant and keeps the code simple.

const $ = (id) => document.getElementById(id);

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// A file's page on GitHub. `path` may end in "#heading".
function githubUrl(path) {
  const [file, hash] = path.split('#');
  const encoded = file.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${settings.owner}/${settings.repo}/blob/${encodeURIComponent(settings.branch)}/${encoded}${hash ? `#${hash}` : ''}`;
}
const isMarkdown = (path) => /\.md$/i.test(path.split('#')[0]);

// Enough Markdown for these lists: `code`, **bold**, *italic* and [links].
// Paths to files in `code` and links to files in the repo point to the file on
// GitHub; Markdown files open in the doc viewer instead (`data-doc`, see
// "Reading docs" below), keeping the GitHub address for ⌘-click.
function inline(text) {
  const link = (href, label) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>`;
  const repoLink = (path, label) => isMarkdown(path)
    ? `<a href="${escapeHtml(githubUrl(path))}" data-doc="${escapeHtml(path)}">${label}</a>`
    : link(githubUrl(path), label);
  return text.split(/(`[^`]+`)/).map((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      const code = part.slice(1, -1);
      const html = `<code>${escapeHtml(code)}</code>`;
      return /^[\w./-]+\.md$/.test(code) ? repoLink(code, html) : html;
    }
    return escapeHtml(part)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
        if (/^https?:\/\//.test(href)) return link(href, label);
        if (/^[\w./-]+(#[\w-]*)?$/.test(href)) {
          const path = resolvePath('', href);
          if (path) return repoLink(path, label);
        }
        return label;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  }).join('');
}

function renderDetails(details) {
  return details.filter((d) => d !== '').map((line) => {
    const depth = Math.floor((line.length - line.trimStart().length) / 2);
    const text = line.trim();
    const bullet = /^[-*+]\s+/.test(text);
    const body = bullet ? text.replace(/^[-*+]\s+/, '') : text;
    return `<li class="${bullet ? 'bullet' : 'plain'}" style="--depth:${depth}">${inline(body)}</li>`;
  }).join('');
}

function renderCard(item, index, list) {
  const notes = item.details.filter((d) => d !== '').length;
  return `
    <li class="card" data-id="${item.id}">
      <button class="handle" type="button" aria-label="Drag to move" title="Drag to move">
        <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></g></svg>
      </button>
      <div class="card-main">
        <div class="card-title" role="button" tabindex="0" data-edit="${item.id}">
          ${list.numbered ? `<span class="number">${index + 1}.</span> ` : ''}${inline(item.title)}
        </div>
        ${notes > 0 && detailsOpen ? `<ul class="details">${renderDetails(item.details)}</ul>` : ''}
        ${notes > 0 && !detailsOpen ? `<span class="note-count">${notes} ${notes === 1 ? 'note' : 'notes'}</span>` : ''}
      </div>
    </li>`;
}

function render() {
  const title = `Task Board - ${settings.repo}`;
  document.title = title;
  $('page-title').textContent = title;
  const changes = changedLists();
  $('save-button').disabled = changes.length === 0 || busy;
  $('reload-button').disabled = busy;

  if (!state) {
    if (!token) {
      $('board').innerHTML = `
        <div class="welcome">
          <h2>Add your token to see your lists</h2>
          <p>The lists are in ${escapeHtml(settings.owner)}/${escapeHtml(settings.repo)}, a private repository, so the board needs a GitHub token to read and save them. Settings explains how to make one.</p>
          <button class="btn primary" type="button" data-open-settings>Open Settings</button>
        </div>`;
    } else if (!busy) {
      $('board').innerHTML = '';
    }
    return;
  }

  $('board').innerHTML = LISTS.map((list) => {
    const { items, error } = state.lists[list.key];
    const edited = changes.includes(list);
    const body = error
      ? `<p class="list-error"><strong>Can't show this list:</strong> ${escapeHtml(error)} Fix ${list.file} (or ask Claude to), then reload.</p>`
      : `<ol class="items" data-list="${list.key}">${items.map((it, i) => renderCard(it, i, list)).join('')}</ol>
         ${items.length === 0 ? '<p class="empty">Nothing here. Drag items in or add one.</p>' : ''}`;
    return `
      <section class="column" data-list="${list.key}" aria-label="${list.name}">
        <div class="column-head">
          <h2>${list.name} <span class="count">${items.length}</span></h2>
          ${edited ? '<span class="edited" title="Unsaved changes">Edited</span>' : ''}
          ${error ? '' : `<button class="btn small" type="button" data-add="${list.key}">+ Add</button>`}
        </div>
        ${body}
      </section>`;
  }).join('');
}

let busy = false;
function setBusy(value) {
  busy = value;
  $('board').setAttribute('aria-busy', String(value));
  document.body.classList.toggle('busy', value);
  render();
}

function showBanner(message, kind, action) {
  const banner = $('banner');
  banner.className = `banner ${kind}`;
  banner.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (action?.href) {
    banner.insertAdjacentHTML('beforeend', `<a href="${escapeHtml(action.href)}" target="_blank" rel="noopener">${escapeHtml(action.label)}</a>`);
  } else if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link';
    button.textContent = action.label;
    button.addEventListener('click', action.action);
    banner.append(button);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', hideBanner);
  banner.append(close);
  banner.hidden = false;
}
function hideBanner() {
  $('banner').hidden = true;
}

// ---------------------------------------------------------------------------
// The editor sheet, for editing or adding one item. Items are moved by
// dragging, and deleted by Claude or in the Markdown files.

let editing = null; // { id } for an existing item, or { newIn: listKey }

function openEditor(target) {
  editing = target;
  const found = target.id ? findItem(target.id) : null;
  const listKey = found ? found.list.key : target.newIn;
  $('editor-heading').textContent = found ? 'Edit item' : `New item`;
  $('editor-text').value = found ? itemToText(found.item) : '';
  $('editor-warning').hidden = !(listKey === 'next' && !found);
  $('editor').showModal();
  if (!found) $('editor-text').focus();
}

function applyEditor() {
  const item = textToItem($('editor-text').value);
  if (!item) return;
  const found = editing.id ? findItem(editing.id) : null;

  // New items go where they're usually wanted: last in Next Steps (an ordered
  // plan), first in the other lists. Dragging moves them from there.
  if (!found) {
    const listKey = editing.newIn;
    const added = withId(item);
    if (listKey === 'next') state.lists[listKey].items.push(added);
    else state.lists[listKey].items.unshift(added);
    changed(`Add ${short(added.title)} to ${listByKey[listKey].name}`);
    return;
  }

  if (itemToText(found.item) === itemToText(item)) return;
  found.item.title = item.title;
  found.item.details = item.details;
  changed(`Edit ${short(item.title)}`);
}

// ---------------------------------------------------------------------------
// Settings and the copyable-text sheet

function openSettings(message) {
  $('details-toggle').checked = detailsOpen;
  $('settings-token').value = token;
  $('settings-owner').value = settings.owner;
  $('settings-repo').value = settings.repo;
  $('settings-branch').value = settings.branch;
  if (typeof message === 'string') showBanner(message, 'info');
  $('settings-dialog').showModal();
}

function applySettings() {
  const next = {
    owner: $('settings-owner').value.trim() || settings.owner,
    repo: $('settings-repo').value.trim() || settings.repo,
    branch: $('settings-branch').value.trim() || settings.branch,
  };
  const tokenChanged = $('settings-token').value.trim() !== token;
  token = $('settings-token').value.trim();
  writeStore('taskboard:token', token || undefined);
  const repoChanged = JSON.stringify(next) !== JSON.stringify({ owner: settings.owner, repo: settings.repo, branch: settings.branch });
  settings = next;
  writeStore('taskboard:settings', next);
  // A removed token hides the lists again; a new one may see different repos.
  if (repoChanged || !state || (tokenChanged && !token)) load();
  else hideBanner();
}

let textSecondary = null;
function showText({ heading, message, text, secondary }) {
  $('text-heading').textContent = heading;
  $('text-message').textContent = message;
  $('text-content').value = text;
  textSecondary = secondary ?? null;
  $('text-secondary').hidden = !secondary;
  $('text-secondary').textContent = secondary?.label ?? '';
  $('text-dialog').showModal();
}

function discardAndReload() {
  writeStore(draftKey(), undefined);
  load();
}

// ---------------------------------------------------------------------------
// Reading docs. Links to Markdown files in the repo open here, full screen,
// rather than on GitHub: the repo is private, and a web app added to an
// iPhone's Home Screen opens outside links in a browser that isn't signed in
// to GitHub. GitHub turns the Markdown into a web page, the same way (and with
// the same removal of unsafe HTML) as on github.com, and the page adjusts its
// links: to other docs they open here, to headings they scroll.

// A path inside the repo, from a link in the file at `dir` (e.g. "docs/").
// Null if the link points outside the repo.
function resolvePath(dir, href) {
  let decoded;
  try {
    decoded = decodeURI(href);
  } catch {
    decoded = href;
  }
  const [file, hash] = decoded.split('#');
  const parts = [];
  for (const part of ((file.startsWith('/') ? '' : dir) + file).split('/')) {
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else if (part !== '.' && part !== '') {
      parts.push(part);
    }
  }
  if (parts.length === 0) return null;
  return parts.join('/') + (hash ? `#${hash}` : '');
}

const contentsPath = (file) =>
  `/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(settings.branch)}`;

let docHistory = []; // paths of the docs opened since the viewer opened, the one showing last
let docRequest = 0; // ignores answers to requests made before the latest one

async function showDoc(path) {
  const [file, hash] = path.split('#');
  $('doc-title').textContent = file.split('/').pop();
  $('doc-title').title = file;
  $('doc-github').href = githubUrl(path);
  $('doc-back').hidden = docHistory.length < 2;
  const body = $('doc-body');
  body.innerHTML = '<p class="loading">Loading…</p>';
  body.scrollTop = 0;
  if (!$('doc-viewer').open) $('doc-viewer').showModal();
  const request = ++docRequest;
  try {
    const html = await gh(contentsPath(file), { as: 'html' });
    if (request !== docRequest) return;
    body.replaceChildren(prepareDoc(html, file));
    if (hash) scrollToHeading(hash);
  } catch (error) {
    if (request !== docRequest) return;
    const message = error instanceof GitHubError && error.status === 404
      ? `${file} isn't on ${settings.branch}. It may have been renamed or deleted.`
      : explain(error);
    body.innerHTML = `<p class="list-error">${escapeHtml(message)}</p>`;
  }
}

function openDoc(path) {
  docHistory.push(path);
  showDoc(path);
}

function docBack() {
  docHistory.pop();
  showDoc(docHistory.at(-1));
}

// Adjusts GitHub's page for the viewer. A <template> holds it while that
// happens: nothing in one runs or loads until it's added to the page.
function prepareDoc(html, file) {
  const dir = file.slice(0, file.lastIndexOf('/') + 1);
  const template = document.createElement('template');
  template.innerHTML = html;
  const page = template.content;
  // GitHub puts each heading's id on a link icon beside it; move the id to the
  // heading and drop the icon.
  for (const icon of page.querySelectorAll('a.anchor')) {
    const heading = icon.parentElement?.querySelector('.heading-element') ?? icon.parentElement;
    if (heading && icon.id) heading.id = icon.id;
    icon.remove();
  }
  for (const a of page.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      a.dataset.heading = href.slice(1);
      continue;
    }
    a.target = '_blank';
    a.rel = 'noopener';
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) continue; // a full address
    const path = resolvePath(dir, href);
    if (!path) continue;
    a.href = githubUrl(path);
    if (isMarkdown(path)) {
      a.dataset.doc = path;
      a.removeAttribute('target');
    }
  }
  // Paths to Markdown files in `code` open in the viewer too, as on the board.
  // Like the lists, docs write them from the repo's top folder.
  for (const code of page.querySelectorAll('code')) {
    const path = code.textContent;
    if (code.closest('a, pre') || !/^[\w./-]+\.md$/.test(path)) continue;
    const a = document.createElement('a');
    a.href = githubUrl(path);
    a.dataset.doc = path;
    code.replaceWith(a);
    a.append(code);
  }
  // Images in a private repo need the token, so fetch them with it.
  for (const img of page.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(src)) continue;
    img.removeAttribute('src');
    const path = resolvePath(dir, src);
    if (path) loadImage(img, path.split('#')[0]);
  }
  return page;
}

async function loadImage(img, file) {
  try {
    const url = URL.createObjectURL(await gh(contentsPath(file), { as: 'blob' }));
    img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    img.src = url;
  } catch {
    img.alt = img.alt || `Couldn't load ${file}`;
  }
}

function scrollToHeading(hash) {
  let id = hash;
  try {
    id = decodeURIComponent(hash);
  } catch {
    // Not encoded.
  }
  const body = $('doc-body');
  const target = body.querySelector(`[id="${CSS.escape(`user-content-${id}`)}"], [id="${CSS.escape(id)}"]`);
  target?.scrollIntoView({ block: 'start' });
}

// ---------------------------------------------------------------------------
// Dragging. Built on pointer events, which cover mouse, touch and pen alike.
// Only the handle starts a drag, so the rest of the card scrolls normally on a
// phone. A floating copy ("ghost") follows the finger while a gap
// ("placeholder") shows where the item will land. On a phone the lists are
// stacked, so dragging to another list means dragging up or down the page.

let drag = null;

function startDrag(event, handle) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  const card = handle.closest('.card');
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.style.width = `${rect.width}px`;
  document.body.append(ghost);
  const placeholder = document.createElement('li');
  placeholder.className = 'placeholder';
  placeholder.style.height = `${rect.height}px`;
  card.after(placeholder);
  card.classList.add('dragging');
  document.body.classList.add('is-dragging');

  drag = {
    id: Number(card.dataset.id), card, ghost, placeholder, handle,
    offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
    x: event.clientX, y: event.clientY, frame: 0,
  };
  handle.setPointerCapture(event.pointerId);
  moveGhost();
  drag.frame = requestAnimationFrame(autoScroll);
}

function moveGhost() {
  drag.ghost.style.transform = `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`;
}

function updatePlaceholder() {
  const under = document.elementFromPoint(drag.x, drag.y);
  if (!under) return;

  const column = under.closest('.column');
  const listEl = column?.querySelector('.items');
  if (!listEl) return;
  const cards = [...listEl.querySelectorAll('.card:not(.dragging)')];
  const before = cards.find((c) => {
    const r = c.getBoundingClientRect();
    return drag.y < r.top + r.height / 2;
  });
  if (before) {
    if (before.previousElementSibling !== drag.placeholder) before.before(drag.placeholder);
  } else if (listEl.lastElementChild !== drag.placeholder) {
    listEl.append(drag.placeholder);
  }
}

// Scrolls the page while the finger is near the top or bottom edge.
function autoScroll() {
  if (!drag) return;
  const edge = 80;
  const top = document.querySelector('.sticky').getBoundingClientRect().bottom;
  let speed = 0;
  if (drag.y < top + edge) speed = -Math.ceil((top + edge - drag.y) / 6);
  else if (drag.y > innerHeight - edge) speed = Math.ceil((drag.y - (innerHeight - edge)) / 6);
  if (speed !== 0) {
    scrollBy(0, speed);
    updatePlaceholder();
  }
  drag.frame = requestAnimationFrame(autoScroll);
}

function onDragMove(event) {
  if (!drag) return;
  drag.x = event.clientX;
  drag.y = event.clientY;
  moveGhost();
  updatePlaceholder();
}

function endDrag(event) {
  if (!drag) return;
  const { id, placeholder, ghost, card, frame } = drag;
  cancelAnimationFrame(frame);
  ghost.remove();
  document.body.classList.remove('is-dragging');
  drag = null;

  const listEl = placeholder.parentElement;
  if (event.type === 'pointercancel' || !listEl) {
    render();
    return;
  }
  // Count the cards above the gap, not counting the one being dragged.
  let index = 0;
  for (const el of listEl.children) {
    if (el === placeholder) break;
    if (el.classList.contains('card') && el !== card) index++;
  }
  moveItem(id, listEl.dataset.list, index);
}

// ---------------------------------------------------------------------------
// Wiring up the buttons

document.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('.handle');
  if (handle && state && !busy) startDrag(event, handle);
});
document.addEventListener('pointermove', onDragMove);
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

document.addEventListener('click', (event) => {
  const heading = event.target.closest('a[data-heading]');
  if (heading) {
    event.preventDefault();
    scrollToHeading(heading.dataset.heading);
    return;
  }
  // ⌘-, Ctrl- or Shift-click still opens the doc on GitHub.
  const doc = event.target.closest('a[data-doc]');
  if (doc && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
    event.preventDefault();
    openDoc(doc.dataset.doc);
    return;
  }
  if (event.target.closest('a')) return;
  const edit = event.target.closest('[data-edit]');
  if (edit) openEditor({ id: Number(edit.dataset.edit) });
  const add = event.target.closest('[data-add]');
  if (add) openEditor({ newIn: add.dataset.add });
  if (event.target.closest('[data-open-settings]')) openSettings();
});

document.addEventListener('keydown', (event) => {
  if (event.target.closest?.('a')) return; // Enter on a link follows it
  const edit = event.target.closest?.('[data-edit]');
  if (edit && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openEditor({ id: Number(edit.dataset.edit) });
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'details-toggle') {
    detailsOpen = event.target.checked;
    writeStore('taskboard:details', detailsOpen);
    render();
  }
});

$('save-button').addEventListener('click', save);
$('reload-button').addEventListener('click', () => {
  if (changedLists().length > 0 && !confirm('Reload from GitHub and throw away your unsaved changes?')) return;
  discardAndReload();
});
$('settings-button').addEventListener('click', () => openSettings());

$('editor').addEventListener('close', () => {
  if ($('editor').returnValue === 'done') applyEditor();
  $('editor').returnValue = '';
  editing = null;
});

$('settings-forget').addEventListener('click', () => {
  $('settings-token').value = '';
});
$('settings-dialog').addEventListener('close', () => {
  if ($('settings-dialog').returnValue === 'save') applySettings();
  $('settings-dialog').returnValue = '';
});

$('text-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('text-content').value);
    $('text-copy').textContent = 'Copied';
  } catch {
    $('text-content').select();
  }
  setTimeout(() => { $('text-copy').textContent = 'Copy'; }, 1500);
});
$('text-secondary').addEventListener('click', () => {
  $('text-dialog').close();
  textSecondary?.action();
});

$('doc-back').addEventListener('click', docBack);
$('doc-close').addEventListener('click', () => $('doc-viewer').close());
$('doc-viewer').addEventListener('close', () => {
  docHistory = [];
  docRequest++;
  $('doc-body').replaceChildren();
});

// Warn before leaving the page with unsaved changes.
addEventListener('beforeunload', (event) => {
  if (changedLists().length > 0) event.preventDefault();
});

load();
