# CLAUDE.md

This repository holds two things:

- **Portfolio site** (root: `src/`, `package.json`, root `wrangler.toml`): React/Vite, built to `dist/`. Leave it alone unless asked.
- **SoundRoute / Parrot** (`soundtrack/`, `supabase/soundroute.sql`, `tests/soundroute/`): a static web app, no build step. **Most work happens here.**

For SoundRoute, read `SOUNDROUTE.md` first. §0 says where things stand and what to do next; the rest covers decisions, architecture, the data model, Supabase setup, the phone test checklist, deployment, tests and tunable settings.

Working rules for SoundRoute:

- Work on the `v2` branch; never push straight to `main`. After pushing, the user rebuilds the `soundroute-preview` Worker in Cloudflare and tests on an iPhone. Merging to `main` and deploying the live site happen only when the user asks.
- Keep `soundtrack/` a plain static site (ES modules, no bundler). External scripts come from `cdn.jsdelivr.net`.
- Only the Supabase publishable key goes in code. Never a secret / service_role key.
- Database changes go in `supabase/soundroute.sql` and must stay safe to re-run. The user pastes it into the Supabase SQL Editor.
- When changing Supabase calls in `cloud.js` / `supabase.js`, update `tests/soundroute/fake-supabase.js` to match.
- The user writes in Chinese: reply in Chinese. The app's UI text stays in English.
- Before handing over, run `node --check` on changed files and the tests in `SOUNDROUTE.md` §9 (`decide.test.mjs`, `run.py`, `share.py`, `polish.py`). Then update `SOUNDROUTE.md` §0 and §7 with what changed.
