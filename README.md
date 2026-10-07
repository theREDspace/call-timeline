# Call Timeline

A Claude Code plugin that adds a live **call-timeline** pane showing every skill, tool, MCP call, subagent and model request a session makes, in order, with timing, tokens, cost, status, arguments and results.

## Add it to your project

Commit this to `.claude/settings.json` at the root of your repo (merge the two keys in if the file already exists):

```json
{
  "extraKnownMarketplaces": {
    "redspace-plugins": {
      "source": { "source": "github", "repo": "theREDspace/call-timeline" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "call-timeline@redspace-plugins": true
  }
}
```

The settings tell Claude Code about the plugin, but they don't install it. Each person installs it once, from the repo root:

```bash
claude plugin install call-timeline@redspace-plugins --scope project
```

Then start a new Claude Code session in that repo, in the terminal or the desktop app's Code tab. The timeline pane opens on its own. If it doesn't, run `/call-timeline`.

When the folder is first trusted, Claude Code may ask to trust the `redspace-plugins` marketplace and install the plugin for you. That prompt often doesn't appear (in the desktop app, or in a folder you've already trusted), so run the install command anyway. If the plugin is already installed, the command does nothing.

You need read access to [theREDspace/call-timeline](https://github.com/theREDspace/call-timeline): Claude Code clones it with your own git credentials. `autoUpdate: true` brings in new versions without anyone running `claude plugin marketplace update`.

To check it's on, run `/plugin`: `call-timeline` should be listed as installed and enabled.

Optional: add `.claude/call-timeline/` to the project's `.gitignore` so exports don't get committed.

<details>
<summary>Just for you, in every project</summary>

```bash
claude plugin marketplace add theREDspace/call-timeline
```

```bash
claude plugin install call-timeline@redspace-plugins --scope user
```

</details>

To roll it out to the whole org through managed settings, see [TEAM_SETUP.md](TEAM_SETUP.md).

## Features

- **Timeline** of calls, grouped under the prompt that triggered them. Each prompt row shows its turn's true duration (from `turn.start` to `turn.complete`), call and step counts, tokens in→out, what the turn cost, context fill when it ended, errors, and how it ended if not with an answer (`interrupted`, `refused`, `API error`). Turns with no typed prompt (continuations, scheduled wake-ups) get a `(continuation)` row. Each call row shows start time, a **waterfall bar**, name, live elapsed time, and the call's key argument (command, file name, pattern, URL, …).
- **Model steps** (`≈`, gray): every model request is a row of its own, with model, input tokens (and how many were cached), output tokens and why it stopped (`→ tools`, `→ answer`, …). Open one for time to first token and generation time. Subagent steps nest under their Agent row, which shows the subagent's token total.
- **Waterfall bars**: each bar is placed where the row fell within its turn (`·` is the lead-in), so overlapping bars are parallel work. A model step's bar splits into waiting for the first token (`░`) and generating (`▇`), so the whole critical path is visible.
- **Result size**: each call records its result's full length; results over 2k characters are tagged `· 14k ch` on the row (yellow past 20k), so the calls bloating context stand out.
- **Loop detection**: identical calls (same name and arguments) within a turn are tagged `↻N`; the third identical failure raises a toast.
- **Color-coded kinds**: `★` skill (magenta), `●` tool (cyan), `◆` MCP (blue), `▲` subagent (yellow), `≈` model step (gray), `›` prompt.
- **Subagent grouping**: a subagent's calls are nested under the `▲` Agent row that started it, joined to it by tree connectors (`├─`, `└─`, `│`), so parallel and nested subagents stay apart. The group can be folded (`z`, or click `− N rows`). Filters and search keep the grouping: an Agent row the filter would hide stays, dimmed, above its matching calls. Calls whose Agent row is gone hang off a dashed `┆` line and are tagged with the subagent that ran them, e.g. `(subagent Explore)`.
- **Subagent focus**: `i` (or click `⊙ focus` on an Agent row) narrows the timeline and stats to one subagent and everything beneath it. Press `i` again, or **Show all**, to return.
- **Status**: running (green, counting up), ok, `error` (red), `denied` or `aborted` (yellow). Pressing Esc marks everything in flight `aborted` at once. Errors raise a toast (denials don't: you made them); the status line shows `⏵ N running` while calls are in flight.
- **Details**: expand a row to see its full arguments (pretty JSON) and the head of its result.
- **Search** across names, details, arguments and output.
- **Stats** view: per-name call count, total, average, p95 and max time, output (result characters for calls, output tokens for model steps), errors and denials. Follows the current filter and search; sortable.
- **Export** the timeline to Markdown or JSON (secrets already redacted).
- **History**: each session's timeline is saved after every turn; the last 10 sessions are kept and can be reopened read-only (`h`). Saved history keeps every row but not arguments or results.
- **Clear with undo**, and auto-follow of the newest row.
- **Hardening**: terminal escape sequences and bidi overrides are stripped, common secrets (API keys, tokens, JWTs, private keys, passwords, URL credentials) are redacted, and long values are capped before anything is stored.

## Opening the pane

The pane opens automatically when a session starts. To reopen it, run:

```
/call-timeline
```

`/call-timeline history` opens it on the list of past sessions.

## Exporting

```
/call-timeline export              # Markdown to .claude/call-timeline/timeline-<stamp>.md
/call-timeline export json         # JSON to .claude/call-timeline/timeline-<stamp>.json
/call-timeline export out/run.json # a path; .json writes JSON, anything else Markdown
```

`w` in the pane exports Markdown to the default location. While a past session is open, export writes that session.

## Keybindings

These hotkeys work while the timeline pane has focus.

### Views and filters

| Key | Action |
| --- | --- |
| `a` | Timeline: show **all** calls |
| `s` | Timeline: show **skills** only |
| `t` | Timeline: show **tools** only (built-in tools and subagents) |
| `m` | Timeline: show **MCP** calls only |
| `l` | Timeline: show **model** steps only |
| `e` | Timeline: show **errors** and denials only |
| `x` | Toggle between the **Stats** and timeline views |
| `h` | Toggle the **History** list of past sessions |
| `v` | Back to the **live** session (shown while viewing a past one) |
| `w` | **Export** the timeline as Markdown |

Filters and search apply to both views. Prompts always appear as separators in the timeline, whatever the filter.

### Stats view

| Key | Action |
| --- | --- |
| `r` | Cycle the **sort**: total, count, max, out, errors, name (the sorted column is underlined) |

### History view

| Key | Action |
| --- | --- |
| `j` / `k` | Select the next / previous session |
| `o` | **Open** the selected session (or click its date) |

### Navigating the timeline

These appear in the timeline view only.

| Key | Action |
| --- | --- |
| `j` | Select the **next** row |
| `k` | Select the **previous** row |
| `g` | Jump to the **top** (stops following new rows) |
| `b` | Jump to the **end** (resumes following new rows) |
| `o` | **Open** / close the selected row's details |
| `z` | **Fold** / unfold the selected subagent's calls |
| `i` | **Focus** on the selected subagent (or the one the selected call ran under); press again to show all |
| `y` | **Copy** the selected row's name, arguments and result to the clipboard |
| `f` | **Find**: focus the search field (not available on mobile, which has no text field) |

### Managing history

| Key | Action |
| --- | --- |
| `c` | **Clear** the timeline. The first press arms it (the button reads "Clear? press c again"); press `c` again within 5 seconds to clear. |
| `u` | **Undo** the last clear (only shown after a clear). Calls that finished after the clear come back finished. |

### Mouse and scrolling

- Click `▸` / `▾` beside a row to open or close its details.
- Click `⧉ copy` in an open row to copy that row.
- Scrolling up in the pane stops auto-follow; scrolling back to the bottom resumes it. Selecting the last row with `j` also resumes it.

## Layout

The plugin lives in `plugin/`, and the marketplace's `source` points there. Only that folder is installed, so the repo-root dev setup (`.mcp.json` with the GitNexus and fallow servers, `.claude/skills/`, `AGENTS.md`) stays out of other people's sessions. Keep anything users shouldn't get outside `plugin/`.

```
.claude-plugin/marketplace.json  Marketplace manifest; points at plugin/
plugin/                          Everything that ships to users (the plugin root)
  .claude-plugin/plugin.json   Plugin manifest
  hooks/hooks.json             Hook module list
  hooks/register.tsx           Entry: state atoms, the Host adapter over `$`, and thin hooks that delegate
  hooks/core/                  Pure logic over rows, no engine access
    events.ts                    Building rows from prompts, calls and model requests
    redact.ts                    Hardening: escape stripping, secret redaction, caps
    timeline.ts                  Every change to the row list (append, repeats, turns, interrupt, cap)
    layout.ts                    Subagent grouping, folding, focus, filters, search, tree connectors
    turns.ts                     Turn totals, summaries and waterfall bar geometry
    stats.ts                     Per-name aggregates and sorting for the Stats view
    export.ts                    Markdown/JSON export text and file naming
    format.ts                    Durations, sizes, money, colors and glyphs
  hooks/services/              Work that needs the engine, written against the Host port
    host.ts                      The Host interface: state cells plus the engine calls the plugin uses
    recorder.ts                  One function per engine event that records rows
    history.ts                   Saved sessions in the plugin's store
    exporter.ts, rows.ts         Writing exports; row writes that keep undo, status and scroll in step
  hooks/pane/                  The pane
    model.ts                     One snapshot of everything a draw reads
    controller.ts                Every press and hotkey's action
    draw.tsx, header.tsx, *-view.tsx   The drawing, one file per view
  types/index.d.ts             Event types and the plugin's state shape
  tests/                       `claude plugin test plugin`: core unit tests, service tests on a fake Host, engine tests
```

The engine reads every `$` call and state key off the hooks module, and follows `$` only into functions in the same file. So `register.tsx` is the one file that touches `$` or declares atoms; everything else gets a `Host` (closures built there), which also lets the services and pane controller be tested without an engine.

State (events, filter, view, selection, search, follow, folds, stats sort) lives in plugin atoms, so it survives hot reloads. Past sessions live in the plugin's store. The timeline keeps the most recent 800 rows, trimming whole turns so no row outlives its prompt.

## Developing locally

Requires Node 24.11+ (`.nvmrc`). Install the dev tools once:

```bash
npm install
```

### Run it in Claude Code from your checkout

Load the plugin straight from the working tree. Saving a file hot-reloads the hooks module (`register` runs again; state in atoms and the store survives).

**Terminal:** start Claude Code from the repo root with:

```bash
claude --plugin-dir plugin
```

The flag applies to that session only.

**Desktop app or another host that can't take flags:** add the folder to the `env` block of `~/.claude/settings.json`. Project settings are ignored for this.

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/call-timeline/plugin",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

`CLAUDE_CODE_PLUGIN_DIR_WATCH` turns on hot reload for long-lived hosts like the desktop app. Because this is user-level, the plugin loads in **every** session in every repo until you remove those lines.

Either way, the plugin shows in `claude plugin list` as `call-timeline@inline`. Don't also have the marketplace copy (`call-timeline@redspace-plugins`) enabled where you develop, or the hooks run twice and you get two panes. If a repo enables it in its `.claude/settings.json`, turn it off for yourself there with `claude plugin disable call-timeline@redspace-plugins --scope local`.

A hook that fails or a module that won't load is reported as a dim line in the transcript naming the plugin, event and reason. Run `claude --debug` for the full log.

### Check and test

| Command | What it does |
| --- | --- |
| `claude plugin validate plugin` | Reads the plugin manifest and hooks module the way the engine will and reports anything it would refuse (`claude plugin validate .` checks the marketplace manifest) |
| `npm test` | `claude plugin test plugin`: runs `plugin/tests/*.test.ts(x)` against the real engine |
| `npm run check` | Typecheck, lint and dead-code scan (`typecheck`, `lint`, `deadcode`) |

`plugin/tsconfig.json` extends `plugin/.claude-plugin/types/tsconfig.json`, which the engine writes, along with the API types, each time it loads the plugin. Load the plugin once (above) before `npm run typecheck` or editor type-checking will work. Both `plugin/.claude-plugin/types/` and `.claude/types/` are gitignored.

### Shipping a change

Bump `version` in `plugin/.claude-plugin/plugin.json` and merge to `main`. Installs with `autoUpdate: true` pick it up; see [TEAM_SETUP.md](TEAM_SETUP.md) for the rollout.
