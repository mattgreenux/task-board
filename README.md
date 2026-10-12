# task-board

A web page for reading and editing TimeRush's task lists from a desktop or a phone: <https://mattgreenux.github.io/task-board/>.

It shows three lists side by side (one at a time on a phone, with tabs), read from Markdown files in the private [TimeRush](https://github.com/mattgreenux/TimeRush) repo:

| Board list | Where it lives in TimeRush |
| :--- | :--- |
| Next Steps | `TODO.md` › `## Next Steps` |
| Backlog | `BACKLOG.md` (its first list) |
| Feature ideas | `IDEAS.md` › `## Feature ideas` |

You can edit items, drag them to reorder, and move them between lists. Save commits every changed file to TimeRush's `main` branch as one commit, and refuses to overwrite a file that changed on GitHub since the page loaded. How to use it, how saving and clashes work, and the Markdown rules the board relies on are in TimeRush's `docs/Task-Board.md`.

The page is plain HTML, CSS and JavaScript with no libraries and no server. It's in its own public repo because GitHub Pages is only free for public repos; the page holds no task data (only code), and the lists stay private in TimeRush.

## Setup

1. **Publish the page (once).** In this repo on GitHub: Settings › Pages › Build and deployment › Source: **GitHub Actions**. Then Actions › Deploy task board › **Run workflow**. After a minute the board is at the address above. Later changes to `site/` publish automatically when they reach `main`.
2. **Make a token (once, or when it expires).** TimeRush is private, so the board needs a token even to show the lists. Open [GitHub › New fine-grained token](https://github.com/settings/personal-access-tokens/new):
   - Name: e.g. "Task board". Expiration: pick a date (you make a new token when it expires).
   - Repository access: **Only select repositories** › **TimeRush** (the repo with the lists, not task-board).
   - Permissions › Repository permissions › **Contents: Read and write**.
   - Generate it and copy it (GitHub shows it only once).
3. **On each device:** open the board, tap **Open Settings** (or ⚙︎), paste the token and tap **Save settings**.

The token is stored only in the browser it was entered in (`localStorage`). Anyone who gets it can change TimeRush until it expires, so revoke it on GitHub (Settings › Developer settings › Personal access tokens) if a device is lost. The repo the board edits (mattgreenux/TimeRush, branch `main`) can be changed in Settings.

## Files

| Path | What it is |
| :--- | :--- |
| `site/index.html`, `site/style.css` | The page and its look |
| `site/app.js` | Loading, editing, dragging and saving through the GitHub API |
| `site/lists.js` | Reads one list out of a Markdown file and writes it back, leaving the rest of the file untouched |
| `test/lists.test.js` | Tests for `lists.js` |
| `test/fixtures/` | Snapshots of TimeRush's `TODO.md`, `BACKLOG.md` and `IDEAS.md` that the tests read and write back. Copy the real files over if their format changes |
| `.github/workflows/pages.yml` | Publishes `site/` to GitHub Pages |

## Tests

Needs [Node](https://nodejs.org) 18 or later. From this folder:

```sh
npm test
```

There's nothing to install first: the tests use Node's built-in test runner.

To try the page on your computer, serve the `site/` folder with any static web server (for example `python3 -m http.server -d site 8000`, then open <http://localhost:8000>). Opening `index.html` straight from the disk doesn't work, because browsers don't load JavaScript modules from `file://` pages. It still edits the real TimeRush lists.
