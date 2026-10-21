# CLAUDE.md

This repository holds two things:

- **Portfolio site** (root: `src/`, `package.json`, root `wrangler.toml`): React/Vite, built to `dist/`. Leave it alone unless asked.
- **SoundRoute / Parrot** (`soundtrack/`, `supabase/soundroute.sql`, `tests/soundroute/`): a static web app, no build step. **Most work happens here.**

For SoundRoute, read `SOUNDROUTE.md` first: decisions, architecture, data model, progress, and the next phases (4–7) with acceptance criteria.

Working rules for SoundRoute:

- Work on the `v2` branch; never push straight to `main`. After pushing, the user rebuilds the `soundroute-preview` Worker in Cloudflare and tests on an iPhone.
- Keep `soundtrack/` a plain static site (ES modules, no bundler). External scripts come from `cdn.jsdelivr.net`.
- Only the Supabase publishable key goes in code. Never a secret / service_role key.
- Database changes go in `supabase/soundroute.sql` and must stay safe to re-run. The user pastes it into the Supabase SQL Editor.
- The user writes in Chinese: reply in Chinese. The app's UI text stays in English.
- Before handing over, run `tests/soundroute/run.py` (see `SOUNDROUTE.md` §7) and `node --check` on changed files.
