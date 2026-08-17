# Slam Grid

Daily tennis-themed Wordle-like game. Live at https://cgingold.github.io/slam-guesser-daily-game/

## What it is
Each day shows a tennis pro's Grand Slam result grid. The user guesses who it is in 3 tries. Hints reveal after wrong guesses (gender, then country).

## Project structure
- `index.html` / `style.css` / `game.js` — the deployed game
- `players.json` — 836 player records (career data + autoScore + optional manualDay + optional hint)
- `guess_pool.json` — autocomplete pool
- `daily_overrides_simple.json` — manual date→player overrides
- Icons + manifest at root
- `tools/` (gitignored) — admin + universe builder, not deployed
- `logos/` (gitignored) — source SVGs
- `z_Old/` (gitignored) — archive

## Difficulty system
Monday → Sunday increases in difficulty, mirroring R1 → Final of a slam.
Mon=R1, Tue=R2, Wed=R3, Thu=R4, Fri=QF, Sat=SF, Sun=F.

Players are ranked by `autoScore` (computed in admin/builder, baked into the JSON). Top 500 are eligible. The top 500 split into 7 day-of-week buckets of ~71 each. `manualDay` field on a player overrides the auto-bucket. `manualDay: "excluded"` removes them entirely.

## Score formula (in admin + universe builder)
W=9, F=6, SF=4, QF=2.5, R4=1.3, R3=1.1, R2=0.8, R1=0.6, Q2=0.4, Q1=0.3, recency=1.8 × (max_year - 1970). No US multiplier. Q3/Q tokens are unweighted (0).

## Conventions
- Data stores results as "1R/2R/3R/4R" (Wikipedia convention)
- UI displays them as "R1/R2/R3/R4" (via displayResult() in game.js)
- All formatting decisions live in style.css (do not inline styles)
- Markup is in index.html, dialogs included
- game.js is all logic — no build step, plain JS

## Don't
- Don't commit `tools/`, `logos/`, or `z_Old/` (they're in .gitignore)
- Don't add a build step — keep it static-files-only for GitHub Pages
- Don't reproduce copyrighted material in any output