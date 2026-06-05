const DAILY_KEY = "slamGuesserSimple.daily.v1";

/* ---- Data freshness gating ----------------------------
   Results are current through AO 2026. Later 2026 slams
   are hidden until the constants below are updated. */
const DATA_FRESHNESS_YEAR = "2026";
const DATA_FRESHNESS_HIDE_SLAMS = ["FrenchOpen", "Wimbledon", "USOpen"];
const DATA_FRESHNESS_LABEL = "Results through AO 2026";
const DATA_FRESHNESS_LABEL_SHORT = "Results thru AO ’26";

/* ---- Daily result storage -----------------------------
   Records each completed daily so revisits show the
   finished state instead of letting the user re-play.
   Shape:
     {
       "2026-05-28": {
         "standard": { player, wrong, outcome, gaveUp },
         "hard":     { player, wrong, outcome, gaveUp }
       },
       ...
     }
   Auto-prunes to ~last 7 days to avoid unbounded growth. */

function getDailyResults() {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDailyResult(date, mode, result) {
  try {
    const all = getDailyResults();
    if (!all[date]) all[date] = {};
    all[date][mode] = result;

    // Prune: keep only the most recent 2 dates. Only today matters now
    // for the "you've already played today" restore, but we keep yesterday
    // too as a small buffer for timezone-edge cases.
    const dates = Object.keys(all).sort();
    while (dates.length > 2) {
      delete all[dates.shift()];
    }

    localStorage.setItem(DAILY_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota errors */
  }
}

function getDailyResult(date, mode) {
  const all = getDailyResults();
  return all?.[date]?.[mode] || null;
}

/* ---- Per-day game history (week strip) ----------------
   One localStorage entry per day, never overwritten (first play wins).
   Key:   slamGrid.dayResult.YYYY-MM-DD
   Value: { date, dayOfWeek, round, outcome, guesses, player } */

const DAY_RESULT_KEY_PREFIX = "slamGrid.dayResult.";

function getDayResult(dateIso) {
  try {
    const raw = localStorage.getItem(DAY_RESULT_KEY_PREFIX + dateIso);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDayResult(result) {
  try {
    if (localStorage.getItem(DAY_RESULT_KEY_PREFIX + result.date)) return;
    localStorage.setItem(DAY_RESULT_KEY_PREFIX + result.date, JSON.stringify(result));
  } catch {
    /* ignore quota errors */
  }
}

function getMondayOfWeek(dateIso) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const daysFromMon = (date.getDay() + 6) % 7;
  const mon = new Date(y, m - 1, d - daysFromMon);
  return [
    mon.getFullYear(),
    String(mon.getMonth() + 1).padStart(2, "0"),
    String(mon.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDaysToIso(dateIso, n) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getWeekResults(todayIso) {
  const monday = getMondayOfWeek(todayIso);
  return Array.from({ length: 7 }, (_, i) => getDayResult(addDaysToIso(monday, i)));
}

function isChampionThisWeek(today) {
  if (dayOfWeekIndex(today) !== 6) return false;
  return getWeekResults(today).every((r) => r && r.outcome === "won");
}

/* ------------------------------------------------------- */

/* Restore a saved daily — either finished (locked, share enabled) or
   in-progress (mid-round wrong-count, hints visible, can keep guessing).
   Returns true if a restoration was performed, false otherwise. */
function maybeRestoreFinishedDaily() {
  const saved = getDailyResult(game.date, game.mode);
  if (!saved) return false;

  // Historical play is immutable. If we have a snapshot of the player as
  // they existed when the user played this date, replay against THAT,
  // regardless of how the live rotation has changed since (added players,
  // re-shuffled pool, etc.).
  if (saved.playerSnapshot) {
    game.current = saved.playerSnapshot;
    game.previous = saved.playerSnapshot.name;
    render();
  } else {
    if (!game.current || saved.player !== game.current.name) return false;
  }

  // Reset the round state to match the saved state
  game.wrong = saved.wrong;
  game.lastOutcome = saved.outcome;
  game.gaveUp = !!saved.gaveUp;

  const inProgress = !!saved.inProgress && saved.outcome === null;

  // Rebuild hint cards (gender appears at wrong>=1, nation at wrong>=2,
  // answer/correct/give-up at the very end — for finished rounds only).
  const panel = document.getElementById("hintPanel");
  panel.innerHTML = "";

  if (saved.wrong >= 1) {
    const g = document.createElement("div");
    const genderClass = (game.current.gender || "").toLowerCase();
    g.className = `hint-card gender-card ${genderClass}`;
    g.textContent = `👤 Gender: ${game.current.gender}`;
    panel.appendChild(g);
  }
  if (saved.wrong >= 2) {
    const n = document.createElement("div");
    n.className = "hint-card nation-card";
    const flag = nationalityToFlag(game.current.nationality);
    n.textContent = `${flag} ${game.current.nationality}`;
    panel.appendChild(n);
  }

  if (inProgress) {
    // Mid-round: leave the input/buttons enabled so the user can keep
    // guessing. No banner, no answer reveal.
    game.locked = false;
    document.getElementById("guessBtn").disabled = false;
    document.getElementById("giveUpBtn").disabled = false;
    document.getElementById("shareBtn").disabled = true;
    updateUI();
    return true;
  }

  // Finished round — append the outcome card
  if (saved.outcome === "win") {
    const a = document.createElement("div");
    a.className = "hint-card correct-card";
    a.textContent = `✅ Correct: ${game.current.name}`;
    panel.appendChild(a);
  } else if (saved.gaveUp) {
    const a = document.createElement("div");
    a.className = "hint-card answer-card";
    a.textContent = `🏳️ Gave Up: ${game.current.name}`;
    panel.appendChild(a);
  } else {
    const a = document.createElement("div");
    a.className = "hint-card answer-card";
    a.textContent = `❌ Answer: ${game.current.name}`;
    panel.appendChild(a);
  }

  // Show a small "already played" banner so the state is explicit
  const banner = document.createElement("div");
  banner.className = "hint-card already-played-card";
  banner.textContent = "🕘 You've already played today's game";
  panel.insertBefore(banner, panel.firstChild);

  // Lock the input/buttons via the same end-of-round flow
  game.locked = true;
  document.getElementById("guessBtn").disabled = true;
  document.getElementById("giveUpBtn").disabled = true;
  document.getElementById("shareBtn").disabled = false;

  revealCountdown();

  updateUI();
  return true;
}

/* ------------------------------------------------------- */

function todayLocal() {
  // YYYY-MM-DD in the user's local timezone
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ========================================================= */

let game = {
  players: [],
  guessPool: [],
  current: null,
  previous: null,
  wrong: 0,
  locked: false,
  selectedSuggestion: false,
  suggestionIndex: -1,
  suggestionItems: [],
  lockProgressHints: false,
  roundHistory: [],
  currentRoundResult: null,
  day: 0,
  lastOutcome: null,

  mode: "standard",
  playType: "daily", // single play type — no practice mode in this build
  date: null,
};
/* HIGHLIGHT HELPERS — no-ops since there's no play toggle */

function highlightPlayButtons() {
  /* no-op */
}
function setPlayType() {
  /* no-op */
}

/* URL SYNC
   Wordle-style clean URL: state lives in localStorage and in memory,
   not in the URL. Shared links can still pre-seed state via ?date= or
   ?play= (handled in load()), but the URL is never *written* back.
   This function exists as a no-op so existing call sites still work. */

function syncURL() {
  /* no-op — see comment above */
}

/* SEED REBUILD */

function rebuildSeed() {
  game.seed = `${game.mode}-${game.date}`;
}

/* =========================================================
   DAILY ROTATION — Fisher-Yates with a stable seed
   =========================================================
   Per-mode deterministic schedule. Walks through every player in
   shuffled order before any repeats. Cycle length = pool size:
     Standard ≈ 328 days, Winners ≈ 100, Hard ≈ 233.

   Bump SHUFFLE_SEED to reshuffle the rotation. Note: any change to
   the player pool (adding/removing players) will shift the schedule. */

const SHUFFLE_SEED = "slam-guesser-simple-v1";
const ROTATION_EPOCH = "2026-01-01"; // day 0 of the rotation

// Lightweight integer hash for strings (32-bit, deterministic).
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h;
}

// Mulberry32 — a good small PRNG seeded by an integer.
function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic shuffle of an array (Fisher-Yates with a seeded RNG).
function shuffleStable(arr, seedStr) {
  const out = arr.slice();
  const rand = mulberry32(hashStr(seedStr));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Cache the shuffled order per mode so we don't redo the work each round.
const shuffleCache = {};

function getRotationFor(mode, pool) {
  // Cache key combines mode + a hash of the pool contents (first 16
  // player names). Different day-of-week buckets all happen to be
  // size 51 but contain different players — keying only on length
  // would cause Monday's bucket shuffle to be reused for Tuesday.
  const fingerprint = pool.slice(0, 16).map((p) => p.name).join("|");
  const key = `${mode}:${pool.length}:${hashStr(fingerprint)}`;
  if (!shuffleCache[key]) {
    shuffleCache[key] = shuffleStable(pool, `${SHUFFLE_SEED}:${mode}:${pool.length}`);
  }
  return shuffleCache[key];
}

// Whole-day delta between two YYYY-MM-DD strings (b - a). Negative if a > b.
function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}

// Day-index for the rotation. Can be negative (pre-epoch) — we wrap via
// the safe modulo below.
function rotationDayIndex(dateIso) {
  return daysBetween(ROTATION_EPOCH, dateIso);
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

// Pick today's (or any date's) player for the given mode + pool.
// Manual overrides (loaded from daily_overrides.json) take precedence,
// but only when the named player is actually in the eligible pool.
// If the override is missing or invalid, fall back to the auto-pick so
// the game never breaks on stale overrides.
function pickRotationPlayer(mode, dateIso, pool) {
  if (!pool || pool.length === 0) return null;

  const overrideName = getDailyOverride(dateIso, mode);
  if (overrideName) {
    const match = pool.find((p) => p.name === overrideName);
    if (match) {
      return match;
    }
    // Stale or invalid override — log once and fall through.
    console.warn(
      `[overrides] ${dateIso} ${mode} → "${overrideName}" not in eligible pool, falling back to auto-pick.`
    );
  }

  const order = getRotationFor(mode, pool);
  const i = mod(rotationDayIndex(dateIso), order.length);
  return order[i];
}

/* =========================================================
   DIFFICULTY BUCKETING — Mon (easy) → Sun (hard)
   =========================================================
   Each player has an `autoScore` (notability + recency) computed by the
   admin/builder tools and baked into players_328.json. We rank all
   eligible players by autoScore descending and split into 7 equal
   buckets. Bucket 0 → Monday, bucket 6 → Sunday.

   Players with a `manualDay` field override the auto-bucket and play
   on that specific day-of-week.

   Filter is per-date: given today's date, return only the subset of
   players who belong to today's day-of-week. The seeded rotation then
   picks among that subset. */

const DAY_NAMES_RUNTIME = [
  "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday",
];
const DAY_LABELS = ["R1", "R2", "R3", "R4", "QF", "SF", "F"];

// Day index for a YYYY-MM-DD string (0=Mon, 6=Sun).
function dayOfWeekIndex(dateIso) {
  const [y, m, d] = dateIso.split("-").map(Number);
  // JS Date: 0=Sun..6=Sat. Convert to 0=Mon..6=Sun.
  const js = new Date(y, m - 1, d).getDay();
  return (js + 6) % 7;
}

// Returns the subset of `pool` assigned to the day-of-week of `dateIso`.
function filterToDayBucket(pool, dateIso) {
  const todayIdx = dayOfWeekIndex(dateIso);
  const todayName = DAY_NAMES_RUNTIME[todayIdx];

  // First: anyone manually assigned to today is in today's bucket.
  const manuals = pool.filter((p) => p.manualDay === todayName);

  // For everyone else (no manualDay), rank by autoScore desc and bucket
  // into 7 equal slices.
  const auto = pool.filter((p) => !p.manualDay);
  auto.sort((a, b) => (b.autoScore ?? 0) - (a.autoScore ?? 0));

  const per = Math.ceil(auto.length / 7);
  const start = todayIdx * per;
  const end = Math.min(start + per, auto.length);
  const autoForToday = auto.slice(start, end);

  // If nothing matches (e.g., autoScore missing on all players because
  // an older players.json predates the admin update), fall back to the
  // full pool so the game still works.
  const combined = [...manuals, ...autoForToday];
  return combined.length > 0 ? combined : pool;
}

/* =========================================================
   DAILY OVERRIDES — loaded once from daily_overrides.json
   =========================================================
   File shape:
     { "overrides": {
         "2026-06-15": { "standard": "Roger Federer" },
         "2026-06-20": { "winners": "Serena Williams" }
     } }
   The file is optional. If missing or invalid, the game falls back to
   pure auto-pick for every date. */

let dailyOverrides = {}; // { "YYYY-MM-DD": { mode: "Player Name" } }

function getDailyOverride(dateIso, mode) {
  return dailyOverrides?.[dateIso]?.[mode] || null;
}

async function loadDailyOverrides() {
  try {
    const res = await fetch("./daily_overrides_simple.json");
    if (!res.ok) return; // file just isn't there — silent
    const data = await res.json();
    const raw =
      data?.overrides && typeof data.overrides === "object"
        ? data.overrides
        : typeof data === "object"
          ? data
          : {};
    dailyOverrides = raw || {};
  } catch {
    // missing file, parse error, or CORS issue — silently use no overrides
    dailyOverrides = {};
  }
}

/* MODE — single-mode game; these are kept as no-ops so the rest of the
   code still calls them without conditionals. */

function highlightModeButtons() {
  /* no-op: no toggle in single-mode build */
}
function updateModeNote() {
  /* no-op: no mode descriptor needed */
}
function setMode() {
  /* no-op: there's only one mode here */
}

/* CALENDAR REMOVED — daily mode is now "today only".
   These stubs exist because setPlayType() and other places call them. */

function updateDateUI() {
  /* no-op: no calendar in this build */
}
function closeDatePopover() {
  /* no-op: no popover */
}

/* DAILY PUZZLE SYSTEM */

/* PLAY TYPE */

function getPlayType() {
  return "daily"; // single play type
}

/* MODE */

function getMode() {
  // Single-mode game. Any URL "mode" param is ignored.
  return "standard";
}

/* TODAY */

function getTodayString() {
  // Use the user's LOCAL date. Using toISOString() here would return UTC,
  // which can be a day ahead in the evening for US users and shift the
  // daily seed/puzzle a day earlier than expected.
  return todayLocal();
}

/* DATE */

function getRequestedDate() {
  // Daily is "today only" in this simplified build. No past-date access.
  return getTodayString();
}

/* LOAD */

async function load() {
  const res = await fetch("./players_328.json");

  game.players = await res.json();

  const res2 = await fetch("./guess_pool_328.json");

  game.guessPool = await res2.json();

  buildGuessPoolIndex();

  // Load manual daily overrides — optional file. If missing or invalid,
  // the game proceeds with pure auto-picks.
  await loadDailyOverrides();

  // URL STATE
  game.playType = getPlayType();
  game.mode = getMode();
  game.date = getRequestedDate();

  highlightModeButtons();
  highlightPlayButtons();
  updateDateUI();

  rebuildSeed();

  next();

  // After honoring any shared-link params (?date=, ?play=), clear them
  // so the URL stays clean Wordle-style for the rest of the session.
  if (window.location.search) {
    history.replaceState(null, "", window.location.pathname);
  }
}

/* RESET HINTS */

function clearHints() {
  document.getElementById("hintPanel").innerHTML = "";
}

/* MESSAGE */

function showMessage(text) {
  const panel = document.getElementById("hintPanel");

  const div = document.createElement("div");

  div.className = "hint-card invalid-card";

  div.textContent = text;

  panel.appendChild(div);

  setTimeout(() => div.remove(), 2000);
}

/* FLAGS */

function nationalityToFlag(nation) {
  const map = {
    Australia: "🇦🇺",
    Austria: "🇦🇹",
    Argentina: "🇦🇷",
    Belarus: "🇧🇾",
    Belgium: "🇧🇪",
    Brazil: "🇧🇷",
    Bulgaria: "🇧🇬",
    Canada: "🇨🇦",
    Chile: "🇨🇱",
    China: "🇨🇳",
    Croatia: "🇭🇷",
    "Czech Republic": "🇨🇿",
    Denmark: "🇩🇰",
    Estonia: "🇪🇪",
    Finland: "🇫🇮",
    France: "🇫🇷",
    Germany: "🇩🇪",
    Greece: "🇬🇷",
    Hungary: "🇭🇺",
    India: "🇮🇳",
    Italy: "🇮🇹",
    Japan: "🇯🇵",
    Kazakhstan: "🇰🇿",
    Latvia: "🇱🇻",
    Mexico: "🇲🇽",
    Netherlands: "🇳🇱",
    "New Zealand": "🇳🇿",
    Norway: "🇳🇴",
    Poland: "🇵🇱",
    Portugal: "🇵🇹",
    Romania: "🇷🇴",
    Russia: "🇷🇺",
    Serbia: "🇷🇸",
    Slovakia: "🇸🇰",
    Slovenia: "🇸🇮",
    "South Africa": "🇿🇦",
    "South Korea": "🇰🇷",
    Spain: "🇪🇸",
    Sweden: "🇸🇪",
    Switzerland: "🇨🇭",
    Tunisia: "🇹🇳",
    Turkey: "🇹🇷",
    Ukraine: "🇺🇦",
    "United Kingdom": "🇬🇧",
    "United States": "🇺🇸",
    USA: "🇺🇸",
    US: "🇺🇸",
  };

  return map[nation] || "";
}

/* SEEDING */

function seededRandom(seed) {
  // Hash the FULL seed string into an initial state. (Previously used
  // only seed.length and the first character, which meant every daily
  // seed in a given mode produced the same player every day.)
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  }
  let x = Math.sin(hash) * 10000;

  return function () {
    x = Math.sin(x) * 10000;
    return x - Math.floor(x);
  };
}

/* NEXT PLAYER */

function next() {
  game.wrong = 0;
  game.locked = false;
  game.selectedSuggestion = false;
  game.hintLocked = false;
  game.lockProgressHints = false;
  game.gaveUp = false;

  const shareBtn = document.getElementById("shareBtn");

  shareBtn.disabled = true;

  game.lastOutcome = null;

  document.getElementById("guessBtn").disabled = false;
  document.getElementById("giveUpBtn").disabled = false;

  document.getElementById("guess").value = "";

  hideSuggestions();
  clearHints();

  // Eligibility flow:
  //   1. Take the top-N players by autoScore (default 300).
  //   2. ADD any below-cut players who have a manualDay (Mon-Sun) override
  //      — admin force-included them.
  //   3. REMOVE any player whose manualDay === "excluded" — admin force-
  //      excluded them despite high score.
  //
  // The 144 below-cut players are still in `game.players` for autocomplete
  // matching; the eligibility filter is just about who can be picked.
  const TOP_N = 300;
  const sortedByScore = game.players
    .slice()
    .sort((a, b) => (b.autoScore ?? 0) - (a.autoScore ?? 0));
  const topN = sortedByScore.slice(0, TOP_N);
  const topNSet = new Set(topN.map((p) => p.name));

  // Below-cut players with a Mon-Sun override get force-included.
  const forceIncluded = sortedByScore.slice(TOP_N).filter(
    (p) => p.manualDay && p.manualDay !== "excluded"
  );

  // Anything explicitly excluded gets dropped.
  let eligiblePlayers = [...topN, ...forceIncluded].filter(
    (p) => p.manualDay !== "excluded"
  );

  // Day-of-week difficulty bucket — Mon = easiest, Sun = hardest. Each
  // player is assigned to one day, either via manualDay override or via
  // auto-ranking by autoScore. We filter the eligible pool to today's
  // bucket so the rotation picks only from players assigned to today.
  eligiblePlayers = filterToDayBucket(eligiblePlayers, game.date);

  // SAFETY CHECK
  if (!eligiblePlayers.length) {
    showMessage("No eligible players");
    return;
  }

  let p = pickRotationPlayer(game.mode, game.date, eligiblePlayers);

  game.current = p;
  game.previous = p.name;

  // If this date has a saved result, we're about to restore — skip the
  // career-reveal animation since the user has already seen the table.
  game._skipReveal = !!getDailyResult(game.date, game.mode);

  render();
  updateUI();

  // If the user already finished today's puzzle, replay the finished state
  // instead of letting them guess again.
  maybeRestoreFinishedDaily();
}

/* GUESS */

function guess() {
  if (game.locked) return;

  const input = document.getElementById("guess");
  const val = input.value.trim();

  if (!val) {
    showMessage("⚠️ Please select a player");
    return;
  }

  if (!game.selectedSuggestion) {
    showMessage("⚠️ Choose a player from the dropdown");
    return;
  }

  const target = game.current.name.toLowerCase();
  const guessLower = val.toLowerCase();

  const ok = guessLower === target || guessLower === target.split(" ").pop();

  if (ok) {
    game.lastOutcome = "win";
    game.lockProgressHints = true; // only block gender/nation hints

    showHints(true);

    endRound();
  } else {
    game.wrong++;
    showHints(false);

    if (game.wrong >= 3) {
      game.lastOutcome = "lose";
      endRound();
    } else {
      // Mid-round: persist the in-progress state so a refresh restores it.
      saveDailyResult(game.date, game.mode, {
        player: game.current.name,
        playerSnapshot: game.current,
        wrong: game.wrong,
        outcome: null,
        gaveUp: false,
        inProgress: true,
      });
    }

    updateUI();
  }

  // Clear the input after a processed guess (win or wrong) so the player
  // has a fresh box for their next attempt. Early-return validation cases
  // above bail before this point and preserve what the user typed.
  input.value = "";
  game.selectedSuggestion = false;

  hideSuggestions();
}

/* GIVE UP */

function giveUp() {
  if (game.locked) return;
  // Show the confirmation dialog instead of giving up immediately.
  const dlg = document.getElementById("giveUpDialog");
  if (dlg && typeof dlg.showModal === "function") {
    dlg.showModal();
  } else {
    // Fallback if <dialog> isn't supported
    confirmGiveUp();
  }
}

function confirmGiveUp() {
  // Close the dialog if it's open
  const dlg = document.getElementById("giveUpDialog");
  if (dlg && dlg.open) dlg.close();

  if (game.locked) return;

  game.lastOutcome = "lose";
  game.gaveUp = true;

  const panel = document.getElementById("hintPanel");

  const a = document.createElement("div");
  a.className = "hint-card answer-card";
  a.textContent = `🏳️ Gave Up: ${game.current.name}`;

  panel.appendChild(a);

  endRound();
}

// "win" or "lose"
function setOutcome(type) {
  game.lastOutcome = type; // "win" or "lose"
}

/* HINTS */

function showHints(correct) {
  const panel = document.getElementById("hintPanel");

  // ❌ only block progressive hints (gender/nation)
  if (!game.lockProgressHints) {
    if (game.wrong === 1) {
      const g = document.createElement("div");
      const genderClass = (game.current.gender || "").toLowerCase();
      g.className = `hint-card gender-card ${genderClass}`;
      g.textContent = `👤 Gender: ${game.current.gender}`;
      panel.appendChild(g);
    }

    if (game.wrong === 2) {
      const n = document.createElement("div");
      n.className = "hint-card nation-card";

      const flag = nationalityToFlag(game.current.nationality);

      n.textContent = `${flag} ${game.current.nationality}`;
      panel.appendChild(n);
    }
  }

  // ✅ ALWAYS allow final answer reveal
  if (correct) {
    const a = document.createElement("div");
    a.className = "hint-card correct-card";
    a.textContent = `✅ Correct: ${game.current.name}`;
    panel.appendChild(a);
  }

  if (game.wrong >= 3 && !correct) {
    const a = document.createElement("div");
    a.className = "hint-card answer-card";
    a.textContent = `❌ Answer: ${game.current.name}`;
    panel.appendChild(a);
  }
}

/* END ROUND */

function endRound() {
  // record result BEFORE locking next round
  if (game.current) {
    game.roundHistory.push({
      player: game.current.name,
      result: game.wrong >= 3 ? "fail" : game.wrong === 0 ? "correct" : "partial",
    });
  }

  // Persist the finished daily round so revisits restore it on refresh.
  if (game.current) {
    saveDailyResult(game.date, game.mode, {
      player: game.current.name,
      // Full snapshot of the player as they existed at play time. Future
      // pool updates can reshuffle the schedule freely; revisits to this
      // date will replay against this snapshot, not the current rotation.
      playerSnapshot: game.current,
      wrong: game.wrong,
      outcome: game.lastOutcome,
      gaveUp: !!game.gaveUp,
    });
    // Per-day history for the week strip (first attempt only)
    const histOutcome = game.lastOutcome === "win" ? "won" : game.gaveUp ? "gave-up" : "missed";
    saveDayResult({
      date: game.date,
      dayOfWeek: DAY_NAMES_RUNTIME[dayOfWeekIndex(game.date)],
      round: ROUND_BY_DAY[dayOfWeekIndex(game.date)].round,
      outcome: histOutcome,
      guesses: game.lastOutcome === "win" ? game.wrong + 1 : game.wrong,
      player: game.current.name,
    });
    paintRoundButton();
  }

  game.locked = true;

  document.getElementById("guessBtn").disabled = true;
  document.getElementById("giveUpBtn").disabled = true;
  document.getElementById("shareBtn").disabled = false;

  updateUI();

  if (game.gaveUp) {
    // Give-up has no modal — reveal the countdown immediately since
    // there's no other dismissal beat to wait for.
    revealCountdown();
  } else {
    // For win/loss, open the modal first. The countdown stays hidden
    // until the user closes the modal — that dismissal becomes the
    // "see you tomorrow" reveal moment.
    openResultModal();
  }
}

function populateWeekStrip(containerEl) {
  if (!containerEl) return;
  const todayIso = game.date || todayLocal();
  const weekResults = getWeekResults(todayIso);
  const todayIdx = dayOfWeekIndex(todayIso);

  containerEl.innerHTML = "";

  weekResults.forEach((result, i) => {
    const cell = document.createElement("div");
    cell.className = "week-cell";

    if (result) {
      cell.classList.add(
        result.outcome === "won" ? "is-won" :
        result.outcome === "gave-up" ? "is-gave-up" : "is-missed"
      );
    } else if (i === todayIdx) {
      cell.classList.add("is-today");
    } else if (i < todayIdx) {
      cell.classList.add("is-past-unplayed");
    } else {
      cell.classList.add("is-future");
    }

    const labelEl = document.createElement("span");
    labelEl.className = "week-cell-label";
    labelEl.textContent = DAY_LABELS[i];
    cell.appendChild(labelEl);

    const markerEl = document.createElement("span");
    markerEl.className = "week-cell-marker";
    if (result) {
      markerEl.textContent =
        result.outcome === "won" ? "✅" :
        result.outcome === "gave-up" ? "🏳️" : "❌";
    }
    cell.appendChild(markerEl);

    containerEl.appendChild(cell);
  });
}

// Open the round-end modal. "Winner" (lime glow) on a correct
// guess, "Missed" (orange border) after 3 wrong. Give-ups skip
// the modal entirely — the user already conceded; no celebration needed.
function openResultModal() {
  // No modal on give-up
  if (game.gaveUp) return;

  const dlg = document.getElementById("resultDialog");
  if (!dlg || typeof dlg.showModal !== "function") return;

  const won = game.lastOutcome === "win";

  // Border treatment via class on the dialog itself
  dlg.classList.remove("is-win", "is-loss");
  dlg.classList.add(won ? "is-win" : "is-loss");

  // Outcome label — emoji + word, both colored by parent state
  const outcome = document.getElementById("resultOutcome");
  outcome.classList.remove("is-win", "is-loss");
  outcome.classList.add(won ? "is-win" : "is-loss");
  const champion = won && isChampionThisWeek(game.date || todayLocal());
  outcome.textContent = champion ? "🏆 Champion" : won ? "Winner" : "Missed It";

  // Player name with country flag to the right
  const playerEl = document.getElementById("resultPlayer");
  playerEl.innerHTML = "";
  if (game.current) {
    const nameSpan = document.createElement("span");
    nameSpan.textContent = game.current.name;
    playerEl.appendChild(nameSpan);

    const flag = nationalityToFlag(game.current.nationality);
    if (flag) {
      const flagSpan = document.createElement("span");
      flagSpan.className = "result-flag";
      flagSpan.textContent = flag;
      playerEl.appendChild(flagSpan);
    }
  }

  dlg.showModal();
  populateWeekStrip(document.getElementById("resultWeekStrip"));
}

// Gentle reveal of the courtside countdown clock — only appears after the
// user's round is over. Lives at the bottom of the page as a "see you
// tomorrow" moment, not a constant fixture.
function revealCountdown() {
  const el = document.getElementById("countdown");
  if (!el) return;
  if (!el.hasAttribute("hidden") && el.classList.contains("is-visible")) return;
  el.hidden = false;
  // Force a frame so the transition runs from opacity 0 → 1.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add("is-visible"));
  });
}

/* AUTOCOMPLETE (CHANGED ONLY SOURCE) */

/* Strip diacritics for fuzzy autocomplete matching ("Alex" should find
   "Àlex Corretja"). Built once after the guess pool loads. */
function deaccent(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

let guessPoolIndex = []; // [{ display: "Àlex Corretja", search: "alex corretja" }]

function buildGuessPoolIndex() {
  guessPoolIndex = game.guessPool.map((name) => ({
    display: name,
    search: deaccent(name).toLowerCase(),
  }));
}

function updateSuggestions() {
  game.suggestionIndex = -1;
  game.suggestionItems = [];

  game.selectedSuggestion = false;

  const rawInput = document.getElementById("guess").value;
  const input = deaccent(rawInput).toLowerCase();

  const box = document.getElementById("suggestions");

  if (input.length < 3) {
    box.style.display = "none";
    return;
  }

  // Match against the deaccented index, return the original display name.
  const matches = guessPoolIndex
    .filter((p) => p.search.includes(input))
    .slice(0, 8)
    .map((p) => p.display);

  box.innerHTML = "";
  matches.forEach((m) => {
    const div = document.createElement("div");
    div.className = "suggestion";
    div.textContent = m;

    div.dataset.index = game.suggestionItems.length;

    game.suggestionItems.push(div);

    div.onclick = () => {
      document.getElementById("guess").value = m;
      game.selectedSuggestion = true;
      box.style.display = "none";
    };

    box.appendChild(div);
  });

  box.style.display = matches.length ? "block" : "none";
}

function hideSuggestions() {
  document.getElementById("suggestions").style.display = "none";
}
function updateHighlight() {
  const items = game.suggestionItems;

  for (let i = 0; i < items.length; i++) {
    if (i === game.suggestionIndex) {
      items[i].style.background = "#1e293b";
      items[i].style.color = "white";

      const box = document.getElementById("suggestions");

      const item = items[i];

      const itemTop = item.offsetTop;
      const itemBottom = itemTop + item.offsetHeight;

      const boxTop = box.scrollTop;
      const boxBottom = boxTop + box.offsetHeight;

      if (itemTop < boxTop) {
        box.scrollTop = itemTop;
      }

      if (itemBottom > boxBottom) {
        box.scrollTop = itemBottom - box.offsetHeight;
      }
    } else {
      items[i].style.background = "";
      items[i].style.color = "";
    }
  }
}

/* SHARE */

/* =========================================================
   SHARE — spoiler-free, emoji-forward summary
   =========================================================
   Reveals effort (guesses used) and mode, never the player.
   Format:
     🎾 Slam Grid — Daily 2026-05-27 · Standard
     ✅ Solved in 2/3
     🔴 🟢 ⚪
     https://...
*/

function buildShareLines() {
  const won = game.lastOutcome === "win";
  const wrong = game.wrong;
  const guessNum = won ? wrong + 1 : null;

  // Header — friendly date ("May 28")
  let tag = "";
  if (game.date) {
    const [y, m, d] = game.date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    tag = dt.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  }
  const header = `Slam Grid — ${tag}`;

  // Balls row — a tennis ball for each used attempt (right or wrong),
  // ⚪ for unused. Ends in ✅ on a win or ❌ on a loss/give-up.
  // "Used" = the slot was filled by a guess (correct or not). When the
  // round ends in a win, the final correct guess counts as used; when
  // it ends in a loss or give-up, the wrong guesses count as used.
  const attemptsUsed = won ? guessNum : wrong;
  const balls = [];
  for (let i = 0; i < 3; i++) {
    balls.push(i < attemptsUsed ? "🎾" : "⚪");
  }
  balls.push(won ? " ✅" : " ❌");
  const ballsLine = balls.join("");

  // Career stat line — count of W / F / SF / QF across the player's slams.
  let statLine = null;
  if (game.current && game.current.slams) {
    const counts = { W: 0, F: 0, SF: 0, QF: 0 };
    for (const t of Object.values(game.current.slams)) {
      for (const r of Object.values(t)) {
        if (counts[r] !== undefined) counts[r]++;
      }
    }
    const parts = [];
    if (counts.W) parts.push(`${counts.W} 🟩`);
    if (counts.F) parts.push(`${counts.F} 🟪`);
    if (counts.SF) parts.push(`${counts.SF} 🟨`);
    if (counts.QF) parts.push(`${counts.QF} 🟧`);
    if (parts.length) statLine = parts.join("  ");
  }

  return { header, ballsLine, statLine };
}

function share() {
  // Daily is "today only" — recipients of a shared link will see their own
  // today, not the sharer's. Always share the bare URL.
  const url = `${window.location.origin}${window.location.pathname}`;

  const { header, ballsLine, statLine } = buildShareLines();

  const text = [header, ballsLine, statLine].filter(Boolean).join("\n");
  const fullText = `${text}\n\n${url}`;

  if (navigator.share) {
    navigator
      .share({
        title: "🎾 Slam Grid",
        text,
        url,
      })
      .catch(() => {});
    return;
  }

  navigator.clipboard
    .writeText(fullText)
    .then(() => showMessage("📋 Copied!"))
    .catch(() => showMessage("Couldn't copy"));
}

/* CLASS MAP */

function cls(v) {
  if (!v) return "";

  if (v === "W") return "W";
  if (v === "F") return "F";
  if (v === "SF") return "SF";
  if (v === "QF") return "QF";

  if (v === "4R") return "R4";
  if (v === "3R") return "R3";
  if (v === "2R") return "R2";
  if (v === "1R") return "R1";

  if (v === "A") return "A";
  if (v === "NH") return "NH";

  if (v === "Q1") return "Q1";
  if (v === "Q2") return "Q2";
  if (v === "Q3") return "Q3";

  if (v.includes("Q")) return "Q";

  return "";
}

/* Display label for a result value. Data uses "4R/3R/2R/1R" historically
   (Wikipedia convention), but the rest of the product talks about rounds
   as "R1/R2/R3/R4" (Slam Grid convention, matches the difficulty chart).
   This is a display-only flip — the underlying data stays untouched. */
function displayResult(v) {
  if (v === "4R") return "R4";
  if (v === "3R") return "R3";
  if (v === "2R") return "R2";
  if (v === "1R") return "R1";
  return v;
}

/* RENDER */

function render() {
  const p = game.current;

  const slams = Object.keys(p.slams || {});

  const years = [...new Set(slams.flatMap((s) => Object.keys(p.slams?.[s] || {})))]
    .map(Number)
    .sort((a, b) => a - b)
    .map(String);

  const hasFresh = slams.some((s) => {
    const v = p.slams?.[s]?.[DATA_FRESHNESS_YEAR];
    return v && v !== "A" && v !== "NH";
  });

  let html = "<thead><tr><th>Slam</th>";

  years.forEach((y) => {
    html += `<th>${y}</th>`;
  });

  html += "</tr></thead><tbody>";

  // Display labels for the slam column. Backend keys stay as
  // AustralianOpen/FrenchOpen/Wimbledon/USOpen for data continuity.
  const SLAM_LABELS = {
    AustralianOpen: "Australian Open",
    FrenchOpen: "French Open",
    Wimbledon: "Wimbledon",
    USOpen: "US Open",
  };

  for (let rowIdx = 0; rowIdx < slams.length; rowIdx++) {
    const slam = slams[rowIdx];
    const label = SLAM_LABELS[slam] || slam;
    html += `<tr><td class="slam">${label}</td>`;

    for (let colIdx = 0; colIdx < years.length; colIdx++) {
      const y = years[colIdx];
      const v = p.slams?.[slam]?.[y] || "";
      const gated =
        y === DATA_FRESHNESS_YEAR &&
        DATA_FRESHNESS_HIDE_SLAMS.includes(slam) &&
        v !== "A" &&
        v !== "NH" &&
        v !== "";
      const displayV = gated ? "" : v;
      html += `<td class="${cls(displayV)} reveal-cell" data-row="${rowIdx}" data-col="${colIdx}">${displayResult(displayV)}</td>`;
    }

    html += "</tr>";
  }

  html += "</tbody>";

  document.getElementById("table").innerHTML = html;

  const existingFoot = document.getElementById("freshnessFoot");
  if (existingFoot) existingFoot.remove();
  if (hasFresh) {
    const foot = document.createElement("p");
    foot.id = "freshnessFoot";
    foot.className = "freshness-foot";
    foot.innerHTML =
      `<span class="freshness-long">${DATA_FRESHNESS_LABEL}</span>` +
      `<span class="freshness-short">${DATA_FRESHNESS_LABEL_SHORT}</span>`;
    document.querySelector(".table-footer").append(foot);
  }

  // Trigger the column-by-column reveal animation. Skipped on restores
  // (the user has already seen this player), only fires on fresh rounds.
  if (!game._skipReveal) {
    // Pre-mark cells as hidden immediately so the gray plate is in place
    // even if the actual reveal is deferred (e.g. how-to modal is open).
    const cells = document.querySelectorAll("#table .reveal-cell");
    cells.forEach((c) => c.classList.add("is-hidden"));

    const howTo = document.getElementById("howToDialog");
    const howToOpen = howTo && howTo.open;
    const willShowHowTo = !localStorage.getItem("slamGuesserSimple.seenHowTo.v1");

    if (howToOpen || willShowHowTo) {
      // Defer the reveal until the modal is closed.
      game._pendingReveal = { cols: years.length, rows: slams.length };
    } else {
      animateReveal(years.length, slams.length);
    }
  }

  // After the table updates, refresh the "scroll for full career" hint
  // (runs on next frame so layout is settled).
  requestAnimationFrame(updateScrollHint);
}

/* Reveal animation: each cell stamps in one at a time. Order is
   column-by-column (left → right), top-to-bottom within each column.
   Boom, boom, boom — each slam result lands like a stamp. */
function animateReveal(numCols, numRows) {
  const STAGGER_MS = 350; // per-cell beat

  const cells = document.querySelectorAll("#table .reveal-cell");
  cells.forEach((c) => c.classList.add("is-hidden"));

  void document.getElementById("table").offsetWidth;

  const wrap = document.querySelector(".table-wrap");

  cells.forEach((cell) => {
    const row = parseInt(cell.dataset.row, 10);
    const col = parseInt(cell.dataset.col, 10);
    const order = col * numRows + row;
    const delay = order * STAGGER_MS;
    setTimeout(() => {
      cell.classList.remove("is-hidden");
      cell.classList.add("is-stamping");
      // Auto-scroll: keep the next column in view, but don't scroll once
      // we've reached the last column (nowhere meaningful to go, and the
      // smooth-scroll engine causes a visible bump at the edge).
      if (wrap && col < numCols - 1) {
        const wrapRect = wrap.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const RIGHT_MARGIN = 40;
        if (cellRect.right > wrapRect.right - RIGHT_MARGIN) {
          const overflow = cellRect.right - (wrapRect.right - RIGHT_MARGIN);
          const maxScroll = wrap.scrollWidth - wrap.clientWidth;
          const target = Math.min(wrap.scrollLeft + overflow, maxScroll);
          if (target > wrap.scrollLeft + 1) {
            wrap.scrollTo({ left: target, behavior: "smooth" });
          }
        }
      }
      setTimeout(() => cell.classList.remove("is-stamping"), 350);
    }, delay);
  });
}

function updateScrollHint() {
  const wrap = document.querySelector(".table-wrap");
  const hint = document.getElementById("scrollHint");
  if (!wrap || !hint) return;
  // Allow 2px of slack for sub-pixel rounding.
  const needsScroll = wrap.scrollWidth > wrap.clientWidth + 2;
  hint.hidden = !needsScroll;
}

// Recompute on resize (orientation change, window resize, etc.)
window.addEventListener("resize", () => {
  clearTimeout(window.__scrollHintTimer);
  window.__scrollHintTimer = setTimeout(updateScrollHint, 80);
});

/* UI */

function updateUI() {
  // Drive the three pip dots. Each pip "fills" once its index is <= wrong.
  // We use used-1 / used-2 / used-3 classes to escalate the color as the
  // count climbs, applied to ALL filled pips so the row visually intensifies.
  const wrong = game.wrong;
  const pips = [
    document.getElementById("pip1"),
    document.getElementById("pip2"),
    document.getElementById("pip3"),
  ];

  for (let i = 0; i < pips.length; i++) {
    const p = pips[i];
    if (!p) continue;
    p.classList.remove("used-1", "used-2", "used-3");
    if (i < wrong) {
      // pick the class matching the current total wrong count
      p.classList.add(`used-${Math.min(wrong, 3)}`);
    }
  }
}

/* EVENTS */

document.getElementById("guess").addEventListener("input", updateSuggestions);

document.getElementById("guess").addEventListener("keydown", (e) => {
  const box = document.getElementById("suggestions");

  if (box.style.display === "block") {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      game.suggestionIndex = Math.min(
        game.suggestionIndex + 1,
        game.suggestionItems.length - 1
      );

      updateHighlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      game.suggestionIndex = Math.max(game.suggestionIndex - 1, 0);

      updateHighlight();
    } else if (e.key === "Enter") {
      if (game.suggestionIndex >= 0) {
        e.preventDefault();
        game.suggestionItems[game.suggestionIndex].click();
      } else {
        guess();
      }
    }
  } else {
    if (e.key === "Enter") guess();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".controls")) {
    hideSuggestions();
  }
});

// First-visit onboarding: open the how-to-play dialog once.
function maybeShowFirstTimeHowTo() {
  const KEY = "slamGuesserSimple.seenHowTo.v1";
  try {
    if (localStorage.getItem(KEY)) return;
    const dlg = document.getElementById("howToDialog");
    if (dlg && typeof dlg.showModal === "function") {
      dlg.showModal();
      localStorage.setItem(KEY, "1");
    }
  } catch {
    /* ignore */
  }
}

// Countdown to the next local midnight (when the next daily grid drops).
// Drives both the digital readout (H:MM) and the analog clock hands.
// Reloads the page once midnight passes so the new day's puzzle loads.
function startCountdown() {
  const el = document.getElementById("countdownTime");
  if (!el) return;
  const handHour = document.getElementById("handHour");
  const handMinute = document.getElementById("handMinute");

  // Remember the date this page loaded on. When the local date changes
  // (i.e. midnight passes), reload so today's grid loads.
  const startDate = new Date().toDateString();

  function tick() {
    const now = new Date();

    // Date-rollover check — fires reliably at midnight even though `ms`
    // never goes negative (we always compute the *next* upcoming midnight).
    if (now.toDateString() !== startDate) {
      window.location.reload();
      return;
    }

    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0
    );
    const ms = tomorrow - now;
    // Ceiling minutes — if any seconds remain in the current minute,
    // round up. Avoids the misleading "00:00" display while there are
    // still 0-59 seconds left until the new grid drops.
    const totalMinutes = Math.ceil(ms / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    // Digital: HH:MM (always 2-digit hour for steady spacing)
    el.textContent = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");

    // Analog: show the actual current local time (like the courtside clock).
    if (handHour && handMinute) {
      const localH = now.getHours() % 12;
      const localM = now.getMinutes();
      const localS = now.getSeconds();
      const hourAngle = localH * 30 + localM * 0.5;
      const minAngle = localM * 6 + localS * 0.1;
      handHour.setAttribute("transform", `rotate(${hourAngle} 50 50)`);
      handMinute.setAttribute("transform", `rotate(${minAngle} 50 50)`);
    }
  }
  tick();
  setInterval(tick, 1000);
}

// Each day-of-week maps to a round (R1-R4 → QF → SF → F) styled to
// match the in-game result-cell palette + a difficulty-gradient halo.
// Kept in sync with the chart pills defined in index.html.
const ROUND_BY_DAY = [
  // 0=Mon ... 6=Sun
  { round: "R1", halo: "#a5e85a", fill: "#3b82f6", text: "#ffffff" },
  { round: "R2", halo: "#ccea4f", fill: "#3b82f6", text: "#ffffff" },
  { round: "R3", halo: "#fde047", fill: "#3b82f6", text: "#ffffff" },
  { round: "R4", halo: "#fdcd5c", fill: "#3b82f6", text: "#ffffff" },
  { round: "QF", halo: "#fdb168", fill: "#fdba74", text: "#7c2d12" },
  { round: "SF", halo: "#dc7a3f", fill: "#fde047", text: "#713f12" },
  { round: "F",  halo: "#b8512a", fill: "#c084fc", text: "#2e1065" },
];

function todayDayIndex() {
  // 0=Mon..6=Sun. JS native getDay() is 0=Sun..6=Sat — shift it.
  return (new Date().getDay() + 6) % 7;
}

function paintRoundButton() {
  const halo = document.getElementById("roundBtnHalo");
  const fill = document.getElementById("roundBtnFill");
  const label = document.getElementById("roundBtnLabel");
  if (!halo || !fill || !label) return;
  if (isChampionThisWeek(game.date || todayLocal())) {
    halo.style.background = "#a5e85a";
    fill.style.background = "#16a34a";
    fill.style.color = "#ffffff";
    label.textContent = "W";
    return;
  }
  const r = ROUND_BY_DAY[todayDayIndex()];
  halo.style.background = r.halo;
  fill.style.background = r.fill;
  fill.style.color = r.text;
  label.textContent = r.round;
}

function openDifficultyDialog() {
  const dlg = document.getElementById("difficultyDialog");
  if (!dlg || typeof dlg.showModal !== "function") return;

  const todayIdx = todayDayIndex();
  const todayIso = game.date || todayLocal();
  const weekResults = getWeekResults(todayIso);
  const champion = isChampionThisWeek(todayIso);

  document.querySelectorAll(".diff-pill").forEach((el) => {
    const dayIdx = parseInt(el.dataset.day, 10);
    el.classList.toggle("is-today", dayIdx === todayIdx);

    const prev = el.querySelector(".diff-outcome");
    if (prev) prev.remove();

    // Sunday pill: switch to green W on championship, restore to purple F otherwise
    const haloEl = el.querySelector(".diff-halo");
    const fillEl = el.querySelector(".diff-fill");
    if (dayIdx === 6 && haloEl && fillEl) {
      if (champion) {
        haloEl.style.background = "#a5e85a";
        fillEl.style.background = "#16a34a";
        fillEl.style.color = "#ffffff";
        fillEl.textContent = "W";
        const trophy = document.createElement("div");
        trophy.className = "diff-outcome";
        trophy.textContent = "🏆";
        el.appendChild(trophy);
        return;
      } else {
        haloEl.style.background = "#b8512a";
        fillEl.style.background = "#c084fc";
        fillEl.style.color = "#2e1065";
        fillEl.textContent = "F";
      }
    }

    const result = weekResults[dayIdx];
    if (!result) return;

    const marker = document.createElement("div");
    marker.className = "diff-outcome";
    if (result.outcome === "won") {
      marker.textContent = "✅";
      marker.classList.add("is-won");
    } else if (result.outcome === "gave-up") {
      marker.textContent = "🏳️";
    } else {
      marker.textContent = "❌";
    }
    el.appendChild(marker);
  });

  dlg.showModal();
}

load().then(() => {
  maybeShowFirstTimeHowTo();
  startCountdown();
  paintRoundButton();
  // Reveal the page. One animation frame after marking ready so the
  // browser flushes the initial paint with everything already in its
  // final state — fades in cleanly instead of snapping.
  requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
  });
});

// Safety fallback: if `load()` errors or never resolves (offline, missing
// JSON, etc.), still reveal the page after 2s so the user isn't staring
// at a blank screen forever.
setTimeout(() => {
  document.body.classList.add("is-ready");
}, 2000);

// When the how-to dialog closes, if there's a pending reveal animation
// (deferred because the modal was open), play it now.
document.addEventListener("DOMContentLoaded", () => {
  const howTo = document.getElementById("howToDialog");
  if (howTo) {
    howTo.addEventListener("close", () => {
      if (game && game._pendingReveal) {
        const { cols, rows } = game._pendingReveal;
        game._pendingReveal = null;
        animateReveal(cols, rows);
      }
    });
  }

  // When the result modal closes, fade in the countdown clock. This is
  // the "see you tomorrow" beat — held back until the user dismisses
  // the result so it has its own moment instead of competing with the
  // modal's reveal.
  const result = document.getElementById("resultDialog");
  if (result) {
    result.addEventListener("close", () => {
      revealCountdown();
      paintRoundButton();
    });
  }

  // Round-of-day button → open the difficulty chart modal
  const roundBtn = document.getElementById("roundBtn");
  if (roundBtn) {
    roundBtn.addEventListener("click", openDifficultyDialog);
  }
});
