# Rolling out Call Timeline to your Claude Team org

A step-by-step guide to getting the `call-timeline` plugin running for everyone in a Claude **Team** plan organization.

Claude Code installs plugins from **marketplaces** (git repos that list plugins). So the rollout is: publish this repo as a marketplace, then point people's Claude Code at it. How far you can push it depends on your role:

| You are… | You can… |
| --- | --- |
| Any Team member | Publish the marketplace, install it yourself, and make it auto-install for anyone working in a given repo (Steps 1–4). |
| Org **Owner / Primary Owner** | Push it to every Claude Code install in the org via server-managed settings (Step 5). |

If you're not an Owner, do Steps 1–4, then hand Step 5 to one.

---

## Step 1 — Push this repo to a shared git host

The repo currently has no remote. Create a repo your teammates can read (e.g. `<your-org>/call-timeline` on GitHub) and push:

```bash
git remote add origin git@github.com:<your-org>/call-timeline.git
git push -u origin main
```

Private repos are fine: Claude Code clones with each person's existing git credentials, so anyone who can `git clone` it can install it.

## Step 2 — Make the repo a marketplace

Add `.claude-plugin/marketplace.json` next to the existing `plugin.json`. The plugin lives at the repo root, so its source is `./`:

```json
{
  "name": "<your-org>-plugins",
  "owner": { "name": "<Your Org>" },
  "description": "Internal Claude Code plugins",
  "plugins": [
    {
      "name": "call-timeline",
      "source": "./",
      "description": "Live timeline pane of the skills, tools, MCP calls, subagents and model requests a session makes"
    }
  ]
}
```

Validate it, then commit and push:

```bash
claude plugin validate .
```

> If you expect to ship more plugins, put the marketplace in its own repo (e.g. `<your-org>/claude-plugins`) and reference this one with `"source": { "source": "github", "repo": "<your-org>/call-timeline" }` instead of `"./"`.

## Step 3 — Install it yourself

From a terminal:

```bash
claude plugin marketplace add <your-org>/call-timeline
```

```bash
claude plugin install call-timeline@<your-org>-plugins --scope user
```

Or inside a session: `/plugin marketplace add <your-org>/call-timeline`, then `/plugin install call-timeline@<your-org>-plugins`.

In the desktop app's Code tab: **+** → **Plugins** → **Manage plugins** → add the marketplace, then install.

Start a new session; the timeline pane should open on its own (or run `/timeline`).

## Step 4 — Turn it on for everyone in a project (no admin needed)

Commit this to `.claude/settings.json` in any repo your team works in. Anyone who opens that repo in Claude Code is prompted to trust the marketplace and gets the plugin:

```json
{
  "extraKnownMarketplaces": {
    "<your-org>-plugins": {
      "source": { "source": "github", "repo": "<your-org>/call-timeline" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "call-timeline@<your-org>-plugins": true
  }
}
```

`autoUpdate` is off by default for non-official marketplaces; setting it `true` means version bumps reach people without them running `claude plugin marketplace update`.

## Step 5 — Org-wide rollout (Owner / Primary Owner)

Server-managed settings push config to every Claude Code install signed in to the org.

1. Go to **claude.ai → Admin settings → Claude Code → Managed settings** (`https://claude.ai/admin-settings/claude-code`).
2. Add the same two keys from Step 4:

   ```json
   {
     "extraKnownMarketplaces": {
       "<your-org>-plugins": {
         "source": { "source": "github", "repo": "<your-org>/call-timeline" },
         "autoUpdate": true
       }
     },
     "enabledPlugins": {
       "call-timeline@<your-org>-plugins": true
     }
   }
   ```

3. Save. Clients pick it up at startup and refresh hourly.

Optional hardening an Owner may add at the same time:

- `strictKnownMarketplaces` — allowlist of marketplace sources (e.g. `{ "source": "github", "repo": "<your-org>/*" }`). If set, make sure it includes your marketplace.
- `blockedMarketplaces` — denylist of sources.

**Machines not signed in to the org** (CI, shared boxes) can get the same JSON via a file instead: `/Library/Application Support/ClaudeCode/managed-settings.json` (macOS), `/etc/claude-code/managed-settings.json` (Linux/WSL), `C:\Program Files\ClaudeCode\managed-settings.json` (Windows). Writing these needs admin rights on the machine, usually via MDM.

> Note: **claude.ai → Admin settings → Plugins** manages plugins for claude.ai chat and Cowork. It is not where Claude Code marketplace plugins are rolled out; use Managed settings above.

## Step 6 — Verify

On any teammate's machine:

- `/status` → the **Setting sources** line lists managed settings (Step 5) or the project settings (Step 4).
- `/plugin` → `call-timeline` shows as installed and enabled, at the version in `plugin.json`.
- A new session opens the timeline pane.

---

## Things specific to this plugin

- **It's a hooks module ("mod")**, not a plain command/skill plugin: `hooks/hooks.json` loads `hooks/register.tsx`, which runs inside Claude Code. If an Owner has set `allowManagedModsOnly` (or `allowManagedHooksOnly`) in managed settings, it will only load when it is enabled through managed settings (Step 5), not per-project or per-user.
- **Shipping updates:** bump `version` in `.claude-plugin/plugin.json`, push, and clients with `autoUpdate: true` pick it up. Others can run:

  ```bash
  claude plugin marketplace update <your-org>-plugins
  ```

- **Local data:** each user's past-session history lives in the plugin's local store, and exports go to `.claude/call-timeline/` in their project. Add `.claude/call-timeline/` to each project's `.gitignore` so exports aren't committed. Nothing is sent anywhere.

## References

- Create a marketplace: https://code.claude.com/docs/en/plugins/create-marketplace
- Marketplace schema: https://code.claude.com/docs/en/plugins/marketplace-reference
- Install & manage plugins: https://code.claude.com/docs/en/plugins/install
- Plugins in an organization: https://code.claude.com/docs/en/plugins/org
- Server-managed settings: https://code.claude.com/docs/en/server-managed-settings
- File-based managed settings: https://code.claude.com/docs/en/managed-settings
