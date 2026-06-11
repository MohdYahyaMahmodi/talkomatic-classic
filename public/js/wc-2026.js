// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  wc-2026.js — Talkomatic × World Cup 2026  (v4.1)                     ║
// ║                                                                       ║
// ║  v4.1 CHANGES:                                                        ║
// ║  • Theme auto-sync: enabling WC mode fetches themes/worldcup.css and  ║
// ║    injects it live; disabling removes it. The user's saved theme in   ║
// ║    IndexedDB is never touched — toggling off restores their choice.   ║
// ║  • Goal is DRAWN IN CODE (no goal-post.png needed): white post and    ║
// ║    crossbar in FRONT of the ball, crosshatch net BEHIND it, so the    ║
// ║    ball visually enters the goal. Real collisions: crossbar bounce,   ║
// ║    sloped-net roll-off, net catch + damping inside, goal-line score.  ║
// ║  • FIX: left panel "Go Chat" cutoff — panel height now accounts for   ║
// ║    the 48px ticker (was overflowing its clipped container).           ║
// ║                                                                       ║
// ║  ASSETS: images/futbol.png (ball) · themes/worldcup.css (theme)       ║
// ║  INSTALL: <script nonce="<%= nonce %>" src="js/wc-2026.js?v=4.1.0">   ║
// ║  REQUIRES: /api/v1/wc/games proxy route in server.js                  ║
// ╚═══════════════════════════════════════════════════════════════════════╝

(function () {
  "use strict";

  // ════════════════════════════════════════════════════════════════════
  // 1. CONFIG
  // ════════════════════════════════════════════════════════════════════

  const WC = {
    END_DATE: new Date("2026-07-21T00:00:00Z"),
    STORAGE_KEY: "wcModeEnabled",
    BALL_KEY: "wcBallEnabled",
    CONFETTI_KEY: "wcConfettiShown",
    LIVE_API_URL: "/api/v1/wc/games",
    LIVE_POLL_MS: 60000,
    MATCH_WINDOW_MS: 2.25 * 60 * 60 * 1000,
    FLAG_CDN: "https://flagcdn.com/w80/",
    BALL_IMG: "images/futbol.png",
    THEME_URL: "themes/worldcup.css?v=1.0.0",
  };

  // ════════════════════════════════════════════════════════════════════
  // 2. TEAMS / ALIASES
  // ════════════════════════════════════════════════════════════════════

  const TEAMS = {
    Mexico: { cc: "mx", code: "MEX" },
    "South Africa": { cc: "za", code: "RSA" },
    "South Korea": { cc: "kr", code: "KOR" },
    Czechia: { cc: "cz", code: "CZE" },
    Canada: { cc: "ca", code: "CAN" },
    "Bosnia & Herzegovina": { cc: "ba", code: "BIH" },
    USA: { cc: "us", code: "USA" },
    Paraguay: { cc: "py", code: "PAR" },
    Qatar: { cc: "qa", code: "QAT" },
    Switzerland: { cc: "ch", code: "SUI" },
    Brazil: { cc: "br", code: "BRA" },
    Morocco: { cc: "ma", code: "MAR" },
    Haiti: { cc: "ht", code: "HAI" },
    Scotland: { cc: "gb-sct", code: "SCO" },
    Australia: { cc: "au", code: "AUS" },
    Türkiye: { cc: "tr", code: "TUR" },
    Germany: { cc: "de", code: "GER" },
    Curaçao: { cc: "cw", code: "CUW" },
    Netherlands: { cc: "nl", code: "NED" },
    Japan: { cc: "jp", code: "JPN" },
    "Ivory Coast": { cc: "ci", code: "CIV" },
    Ecuador: { cc: "ec", code: "ECU" },
    Sweden: { cc: "se", code: "SWE" },
    Tunisia: { cc: "tn", code: "TUN" },
    Spain: { cc: "es", code: "ESP" },
    "Cape Verde": { cc: "cv", code: "CPV" },
    Belgium: { cc: "be", code: "BEL" },
    Egypt: { cc: "eg", code: "EGY" },
    "Saudi Arabia": { cc: "sa", code: "KSA" },
    Uruguay: { cc: "uy", code: "URU" },
    Iran: { cc: "ir", code: "IRN" },
    "New Zealand": { cc: "nz", code: "NZL" },
    France: { cc: "fr", code: "FRA" },
    Senegal: { cc: "sn", code: "SEN" },
    Iraq: { cc: "iq", code: "IRQ" },
    Norway: { cc: "no", code: "NOR" },
    Argentina: { cc: "ar", code: "ARG" },
    Algeria: { cc: "dz", code: "ALG" },
    Austria: { cc: "at", code: "AUT" },
    Jordan: { cc: "jo", code: "JOR" },
    Portugal: { cc: "pt", code: "POR" },
    "DR Congo": { cc: "cd", code: "COD" },
    England: { cc: "gb-eng", code: "ENG" },
    Croatia: { cc: "hr", code: "CRO" },
    Ghana: { cc: "gh", code: "GHA" },
    Panama: { cc: "pa", code: "PAN" },
    Uzbekistan: { cc: "uz", code: "UZB" },
    Colombia: { cc: "co", code: "COL" },
  };

  const ALIASES = {
    "korea republic": "South Korea",
    "republic of korea": "South Korea",
    korea: "South Korea",
    "united states": "USA",
    "united states of america": "USA",
    us: "USA",
    "bosnia and herzegovina": "Bosnia & Herzegovina",
    bosnia: "Bosnia & Herzegovina",
    turkey: "Türkiye",
    turkiye: "Türkiye",
    "czech republic": "Czechia",
    "cote d'ivoire": "Ivory Coast",
    "cabo verde": "Cape Verde",
    "ir iran": "Iran",
    curacao: "Curaçao",
    "congo dr": "DR Congo",
    "dr congo": "DR Congo",
    congo: "DR Congo",
    holland: "Netherlands",
  };

  const deaccent = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const _canonCache = new Map();

  function canonical(name) {
    if (!name) return null;
    if (TEAMS[name]) return name;
    if (_canonCache.has(name)) return _canonCache.get(name);
    const k = deaccent(String(name).trim().toLowerCase());
    let out = ALIASES[k] || null;
    if (!out)
      for (const t in TEAMS) {
        if (deaccent(t.toLowerCase()) === k) {
          out = t;
          break;
        }
      }
    _canonCache.set(name, out);
    return out;
  }
  const team = (n) => {
    const c = canonical(n);
    return c ? { name: c, ...TEAMS[c] } : null;
  };

  // ════════════════════════════════════════════════════════════════════
  // 3. FIXTURES — all 104 (PDT offset, rendered in viewer's local time)
  // ════════════════════════════════════════════════════════════════════

  const F = (t, home, away, g, venue) => ({ t, home, away, g, venue });

  const FIXTURES = [
    F(
      "2026-06-11T12:00:00-07:00",
      "Mexico",
      "South Africa",
      "A",
      "Estadio Azteca, Mexico City",
    ),
    F(
      "2026-06-11T19:00:00-07:00",
      "South Korea",
      "Czechia",
      "A",
      "Estadio Akron, Zapopan",
    ),
    F(
      "2026-06-12T12:00:00-07:00",
      "Canada",
      "Bosnia & Herzegovina",
      "B",
      "BMO Field, Toronto",
    ),
    F(
      "2026-06-12T18:00:00-07:00",
      "USA",
      "Paraguay",
      "D",
      "SoFi Stadium, Inglewood CA",
    ),
    F(
      "2026-06-13T12:00:00-07:00",
      "Qatar",
      "Switzerland",
      "B",
      "Levi's Stadium, Santa Clara CA",
    ),
    F(
      "2026-06-13T15:00:00-07:00",
      "Brazil",
      "Morocco",
      "C",
      "MetLife Stadium, East Rutherford NJ",
    ),
    F(
      "2026-06-13T18:00:00-07:00",
      "Haiti",
      "Scotland",
      "C",
      "Gillette Stadium, Foxborough MA",
    ),
    F(
      "2026-06-13T21:00:00-07:00",
      "Australia",
      "Türkiye",
      "D",
      "BC Place, Vancouver",
    ),
    F(
      "2026-06-14T10:00:00-07:00",
      "Germany",
      "Curaçao",
      "E",
      "NRG Stadium, Houston TX",
    ),
    F(
      "2026-06-14T13:00:00-07:00",
      "Netherlands",
      "Japan",
      "F",
      "AT&T Stadium, Arlington TX",
    ),
    F(
      "2026-06-14T16:00:00-07:00",
      "Ivory Coast",
      "Ecuador",
      "E",
      "Lincoln Financial Field, Philadelphia PA",
    ),
    F(
      "2026-06-14T19:00:00-07:00",
      "Sweden",
      "Tunisia",
      "F",
      "Estadio BBVA, Monterrey",
    ),
    F(
      "2026-06-15T09:00:00-07:00",
      "Spain",
      "Cape Verde",
      "H",
      "Mercedes-Benz Stadium, Atlanta GA",
    ),
    F(
      "2026-06-15T12:00:00-07:00",
      "Belgium",
      "Egypt",
      "G",
      "Lumen Field, Seattle WA",
    ),
    F(
      "2026-06-15T15:00:00-07:00",
      "Saudi Arabia",
      "Uruguay",
      "H",
      "Hard Rock Stadium, Miami Gardens FL",
    ),
    F(
      "2026-06-15T18:00:00-07:00",
      "Iran",
      "New Zealand",
      "G",
      "SoFi Stadium, Inglewood CA",
    ),
    F(
      "2026-06-16T12:00:00-07:00",
      "France",
      "Senegal",
      "I",
      "MetLife Stadium, East Rutherford NJ",
    ),
    F(
      "2026-06-16T15:00:00-07:00",
      "Iraq",
      "Norway",
      "I",
      "Gillette Stadium, Foxborough MA",
    ),
    F(
      "2026-06-16T18:00:00-07:00",
      "Argentina",
      "Algeria",
      "J",
      "Arrowhead Stadium, Kansas City MO",
    ),
    F(
      "2026-06-16T21:00:00-07:00",
      "Austria",
      "Jordan",
      "J",
      "Levi's Stadium, Santa Clara CA",
    ),
    F(
      "2026-06-17T10:00:00-07:00",
      "Portugal",
      "DR Congo",
      "K",
      "NRG Stadium, Houston TX",
    ),
    F(
      "2026-06-17T13:00:00-07:00",
      "England",
      "Croatia",
      "L",
      "AT&T Stadium, Arlington TX",
    ),
    F(
      "2026-06-17T16:00:00-07:00",
      "Ghana",
      "Panama",
      "L",
      "BMO Field, Toronto",
    ),
    F(
      "2026-06-17T19:00:00-07:00",
      "Uzbekistan",
      "Colombia",
      "K",
      "Estadio Azteca, Mexico City",
    ),
    F(
      "2026-06-18T09:00:00-07:00",
      "Czechia",
      "South Africa",
      "A",
      "Mercedes-Benz Stadium, Atlanta GA",
    ),
    F(
      "2026-06-18T12:00:00-07:00",
      "Switzerland",
      "Bosnia & Herzegovina",
      "B",
      "SoFi Stadium, Inglewood CA",
    ),
    F(
      "2026-06-18T15:00:00-07:00",
      "Canada",
      "Qatar",
      "B",
      "BC Place, Vancouver",
    ),
    F(
      "2026-06-18T18:00:00-07:00",
      "Mexico",
      "South Korea",
      "A",
      "Estadio Akron, Zapopan",
    ),
    F(
      "2026-06-19T12:00:00-07:00",
      "USA",
      "Australia",
      "D",
      "Lumen Field, Seattle WA",
    ),
    F(
      "2026-06-19T15:00:00-07:00",
      "Scotland",
      "Morocco",
      "C",
      "Gillette Stadium, Foxborough MA",
    ),
    F(
      "2026-06-19T17:30:00-07:00",
      "Brazil",
      "Haiti",
      "C",
      "Lincoln Financial Field, Philadelphia PA",
    ),
    F(
      "2026-06-19T20:00:00-07:00",
      "Türkiye",
      "Paraguay",
      "D",
      "Levi's Stadium, Santa Clara CA",
    ),
    F(
      "2026-06-20T10:00:00-07:00",
      "Netherlands",
      "Sweden",
      "F",
      "NRG Stadium, Houston TX",
    ),
    F(
      "2026-06-20T13:00:00-07:00",
      "Germany",
      "Ivory Coast",
      "E",
      "BMO Field, Toronto",
    ),
    F(
      "2026-06-20T17:00:00-07:00",
      "Ecuador",
      "Curaçao",
      "E",
      "Arrowhead Stadium, Kansas City MO",
    ),
    F(
      "2026-06-20T21:00:00-07:00",
      "Tunisia",
      "Japan",
      "F",
      "Estadio BBVA, Monterrey",
    ),
    F(
      "2026-06-21T09:00:00-07:00",
      "Spain",
      "Saudi Arabia",
      "H",
      "Mercedes-Benz Stadium, Atlanta GA",
    ),
    F(
      "2026-06-21T12:00:00-07:00",
      "Belgium",
      "Iran",
      "G",
      "SoFi Stadium, Inglewood CA",
    ),
    F(
      "2026-06-21T15:00:00-07:00",
      "Uruguay",
      "Cape Verde",
      "H",
      "Hard Rock Stadium, Miami Gardens FL",
    ),
    F(
      "2026-06-21T18:00:00-07:00",
      "New Zealand",
      "Egypt",
      "G",
      "BC Place, Vancouver",
    ),
    F(
      "2026-06-22T10:00:00-07:00",
      "Argentina",
      "Austria",
      "J",
      "AT&T Stadium, Arlington TX",
    ),
    F(
      "2026-06-22T14:00:00-07:00",
      "France",
      "Iraq",
      "I",
      "Lincoln Financial Field, Philadelphia PA",
    ),
    F(
      "2026-06-22T17:00:00-07:00",
      "Norway",
      "Senegal",
      "I",
      "MetLife Stadium, East Rutherford NJ",
    ),
    F(
      "2026-06-22T20:00:00-07:00",
      "Jordan",
      "Algeria",
      "J",
      "Levi's Stadium, Santa Clara CA",
    ),
    F(
      "2026-06-23T10:00:00-07:00",
      "Portugal",
      "Uzbekistan",
      "K",
      "NRG Stadium, Houston TX",
    ),
    F(
      "2026-06-23T13:00:00-07:00",
      "England",
      "Ghana",
      "L",
      "Gillette Stadium, Foxborough MA",
    ),
    F(
      "2026-06-23T16:00:00-07:00",
      "Panama",
      "Croatia",
      "L",
      "BMO Field, Toronto",
    ),
    F(
      "2026-06-23T19:00:00-07:00",
      "Colombia",
      "DR Congo",
      "K",
      "Estadio Akron, Zapopan",
    ),
    F(
      "2026-06-24T12:00:00-07:00",
      "Switzerland",
      "Canada",
      "B",
      "BC Place, Vancouver",
    ),
    F(
      "2026-06-24T12:00:00-07:00",
      "Bosnia & Herzegovina",
      "Qatar",
      "B",
      "Lumen Field, Seattle WA",
    ),
    F(
      "2026-06-24T15:00:00-07:00",
      "Scotland",
      "Brazil",
      "C",
      "Hard Rock Stadium, Miami Gardens FL",
    ),
    F(
      "2026-06-24T15:00:00-07:00",
      "Morocco",
      "Haiti",
      "C",
      "Mercedes-Benz Stadium, Atlanta GA",
    ),
    F(
      "2026-06-24T18:00:00-07:00",
      "Czechia",
      "Mexico",
      "A",
      "Estadio Azteca, Mexico City",
    ),
    F(
      "2026-06-24T18:00:00-07:00",
      "South Africa",
      "South Korea",
      "A",
      "Estadio BBVA, Monterrey",
    ),
    F(
      "2026-06-25T13:00:00-07:00",
      "Curaçao",
      "Ivory Coast",
      "E",
      "Lincoln Financial Field, Philadelphia PA",
    ),
    F(
      "2026-06-25T13:00:00-07:00",
      "Ecuador",
      "Germany",
      "E",
      "MetLife Stadium, East Rutherford NJ",
    ),
    F(
      "2026-06-25T16:00:00-07:00",
      "Japan",
      "Sweden",
      "F",
      "AT&T Stadium, Arlington TX",
    ),
    F(
      "2026-06-25T16:00:00-07:00",
      "Tunisia",
      "Netherlands",
      "F",
      "Arrowhead Stadium, Kansas City MO",
    ),
    F(
      "2026-06-25T19:00:00-07:00",
      "Türkiye",
      "USA",
      "D",
      "SoFi Stadium, Inglewood CA",
    ),
    F(
      "2026-06-25T19:00:00-07:00",
      "Paraguay",
      "Australia",
      "D",
      "Levi's Stadium, Santa Clara CA",
    ),
    F(
      "2026-06-26T12:00:00-07:00",
      "Norway",
      "France",
      "I",
      "Gillette Stadium, Foxborough MA",
    ),
    F(
      "2026-06-26T12:00:00-07:00",
      "Senegal",
      "Iraq",
      "I",
      "BMO Field, Toronto",
    ),
    F(
      "2026-06-26T16:00:00-07:00",
      "Uruguay",
      "Spain",
      "H",
      "Estadio Akron, Zapopan",
    ),
    F(
      "2026-06-26T17:00:00-07:00",
      "Cape Verde",
      "Saudi Arabia",
      "H",
      "NRG Stadium, Houston TX",
    ),
    F(
      "2026-06-26T20:00:00-07:00",
      "Egypt",
      "Iran",
      "G",
      "Lumen Field, Seattle WA",
    ),
    F(
      "2026-06-26T20:00:00-07:00",
      "New Zealand",
      "Belgium",
      "G",
      "BC Place, Vancouver",
    ),
    F(
      "2026-06-27T14:00:00-07:00",
      "Panama",
      "England",
      "L",
      "MetLife Stadium, East Rutherford NJ",
    ),
    F(
      "2026-06-27T14:00:00-07:00",
      "Croatia",
      "Ghana",
      "L",
      "Lincoln Financial Field, Philadelphia PA",
    ),
    F(
      "2026-06-27T16:30:00-07:00",
      "Colombia",
      "Portugal",
      "K",
      "Hard Rock Stadium, Miami Gardens FL",
    ),
    F(
      "2026-06-27T16:30:00-07:00",
      "DR Congo",
      "Uzbekistan",
      "K",
      "Mercedes-Benz Stadium, Atlanta GA",
    ),
    F(
      "2026-06-27T19:00:00-07:00",
      "Algeria",
      "Austria",
      "J",
      "Arrowhead Stadium, Kansas City MO",
    ),
    F(
      "2026-06-27T19:00:00-07:00",
      "Jordan",
      "Argentina",
      "J",
      "AT&T Stadium, Arlington TX",
    ),
    F(
      "2026-06-28T12:00:00-07:00",
      "Runner-up A",
      "Runner-up B",
      "R32",
      "SoFi Stadium, Inglewood CA",
    ),
    F(
      "2026-06-29T10:00:00-07:00",
      "Winner C",
      "Runner-up F",
      "R32",
      "NRG Stadium, Houston TX",
    ),
    F(
      "2026-06-29T13:30:00-07:00",
      "Winner E",
      "Best 3rd",
      "R32",
      "Gillette Stadium, Foxborough MA",
    ),
    F(
      "2026-06-29T18:00:00-07:00",
      "Winner F",
      "Runner-up C",
      "R32",
      "Estadio BBVA, Monterrey",
    ),
    F(
      "2026-06-30T10:00:00-07:00",
      "Runner-up E",
      "Runner-up I",
      "R32",
      "AT&T Stadium, Arlington TX",
    ),
    F(
      "2026-06-30T14:00:00-07:00",
      "Winner I",
      "Best 3rd",
      "R32",
      "MetLife Stadium, East Rutherford NJ",
    ),
    F(
      "2026-06-30T18:00:00-07:00",
      "Winner A",
      "Best 3rd",
      "R32",
      "Estadio Azteca, Mexico City",
    ),
    F(
      "2026-07-01T09:00:00-07:00",
      "Winner L",
      "Best 3rd",
      "R32",
      "Mercedes-Benz Stadium, Atlanta GA",
    ),
    F(
      "2026-07-01T13:00:00-07:00",
      "Winner G",
      "Best 3rd",
      "R32",
      "Lumen Field, Seattle WA",
    ),
    F(
      "2026-07-01T17:00:00-07:00",
      "Winner D",
      "Best 3rd",
      "R32",
      "Levi's Stadium, Santa Clara CA",
    ),
    F(
      "2026-07-02T12:00:00-07:00",
      "Winner H",
      "Runner-up J",
      "R32",
      "SoFi Stadium, Inglewood CA",
    ),
    F(
      "2026-07-02T16:00:00-07:00",
      "Runner-up K",
      "Runner-up L",
      "R32",
      "BMO Field, Toronto",
    ),
    F(
      "2026-07-02T20:00:00-07:00",
      "Winner B",
      "Best 3rd",
      "R32",
      "BC Place, Vancouver",
    ),
    F(
      "2026-07-03T11:00:00-07:00",
      "Runner-up D",
      "Runner-up G",
      "R32",
      "AT&T Stadium, Arlington TX",
    ),
    F(
      "2026-07-03T15:00:00-07:00",
      "Winner J",
      "Runner-up H",
      "R32",
      "Hard Rock Stadium, Miami Gardens FL",
    ),
    F(
      "2026-07-03T18:30:00-07:00",
      "Winner K",
      "Best 3rd",
      "R32",
      "Arrowhead Stadium, Kansas City MO",
    ),
    F(
      "2026-07-04T10:00:00-07:00",
      "Winner 73",
      "Winner 75",
      "R16",
      "NRG Stadium, Houston TX",
    ),
    F(
      "2026-07-04T14:00:00-07:00",
      "Winner 74",
      "Winner 77",
      "R16",
      "Lincoln Financial Field, Philadelphia PA",
    ),
    F(
      "2026-07-05T13:00:00-07:00",
      "Winner 76",
      "Winner 78",
      "R16",
      "MetLife Stadium, East Rutherford NJ",
    ),
    F(
      "2026-07-05T17:00:00-07:00",
      "Winner 79",
      "Winner 80",
      "R16",
      "Estadio Azteca, Mexico City",
    ),
    F(
      "2026-07-06T12:00:00-07:00",
      "Winner 83",
      "Winner 84",
      "R16",
      "AT&T Stadium, Arlington TX",
    ),
    F(
      "2026-07-06T17:00:00-07:00",
      "Winner 81",
      "Winner 82",
      "R16",
      "Lumen Field, Seattle WA",
    ),
    F(
      "2026-07-07T09:00:00-07:00",
      "Winner 86",
      "Winner 88",
      "R16",
      "Mercedes-Benz Stadium, Atlanta GA",
    ),
    F(
      "2026-07-07T13:00:00-07:00",
      "Winner 85",
      "Winner 87",
      "R16",
      "BC Place, Vancouver",
    ),
    F(
      "2026-07-09T13:00:00-07:00",
      "Winner 89",
      "Winner 90",
      "QF",
      "Gillette Stadium, Foxborough MA",
    ),
    F(
      "2026-07-10T12:00:00-07:00",
      "Winner 93",
      "Winner 94",
      "QF",
      "SoFi Stadium, Inglewood CA",
    ),
    F(
      "2026-07-11T14:00:00-07:00",
      "Winner 91",
      "Winner 92",
      "QF",
      "Hard Rock Stadium, Miami Gardens FL",
    ),
    F(
      "2026-07-11T18:00:00-07:00",
      "Winner 95",
      "Winner 96",
      "QF",
      "Arrowhead Stadium, Kansas City MO",
    ),
    F(
      "2026-07-14T12:00:00-07:00",
      "Winner 97",
      "Winner 98",
      "SF",
      "AT&T Stadium, Arlington TX",
    ),
    F(
      "2026-07-15T12:00:00-07:00",
      "Winner 99",
      "Winner 100",
      "SF",
      "Mercedes-Benz Stadium, Atlanta GA",
    ),
    F(
      "2026-07-18T14:00:00-07:00",
      "Loser 101",
      "Loser 102",
      "3RD",
      "Hard Rock Stadium, Miami Gardens FL",
    ),
    F(
      "2026-07-19T12:00:00-07:00",
      "Winner 101",
      "Winner 102",
      "FINAL",
      "MetLife Stadium, East Rutherford NJ",
    ),
  ].sort((a, b) => new Date(a.t) - new Date(b.t));

  const STAGES = {
    R32: "Round of 32",
    R16: "Round of 16",
    QF: "Quarterfinal",
    SF: "Semifinal",
    "3RD": "Third Place",
    FINAL: "FINAL",
  };
  const stageLabel = (g) => STAGES[g] || `Group ${g}`;

  // ════════════════════════════════════════════════════════════════════
  // 4. STATE
  // ════════════════════════════════════════════════════════════════════

  let enabled = localStorage.getItem(WC.STORAGE_KEY) !== "false";
  let ballEnabled = localStorage.getItem(WC.BALL_KEY) !== "false";
  let liveGames = null;
  let unmatchedNames = [];
  let lastScores = new Map();
  let panelOpen = false;
  let tickerKey = "",
    panelKey = "";
  let tickInterval = null,
    pollInterval = null;
  let goalCount = 0;
  let themeCSS = null;

  const now = () => new Date();
  const sunset = () => now() >= WC.END_DATE;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  window.WC_DEBUG = () => ({
    liveGames,
    unmatchedNames,
    liveMatch: getLiveMatch(),
    nextMatch: getNextMatch(),
    apiUrl: WC.LIVE_API_URL,
  });

  // ════════════════════════════════════════════════════════════════════
  // 5. THEME SYNC — injects themes/worldcup.css while WC mode is on.
  //    Never touches IndexedDB; the user's saved theme survives intact.
  // ════════════════════════════════════════════════════════════════════

  const WC_THEME_MARK = "WC2026-THEME";

  // Removes ANY copy of the WC theme injected by other code — e.g. if the
  // user applied worldcup.css on the themes page, lobby.js injects that
  // saved copy on every load. Detected via the marker comment, so make
  // sure themes/worldcup.css starts with:  /* WC2026-THEME */
  function purgeForeignWcTheme() {
    document.querySelectorAll("head style").forEach((st) => {
      if (
        st.id !== "wcThemeStyle" &&
        st.id !== "wcStyles" &&
        st.textContent.includes(WC_THEME_MARK)
      ) {
        st.remove();
      }
    });
  }

  async function syncTheme(on) {
    let el = document.getElementById("wcThemeStyle");
    if (!on) {
      if (el) el.remove();
      purgeForeignWcTheme(); // strip a saved copy from the themes page too
      return;
    }

    if (themeCSS == null) {
      try {
        const r = await fetch(WC.THEME_URL);
        themeCSS = r.ok ? await r.text() : "";
      } catch {
        themeCSS = "";
      }
    }
    if (!themeCSS) return;

    purgeForeignWcTheme(); // avoid duplicate copies underneath ours
    if (!el) {
      el = document.createElement("style");
      el.id = "wcThemeStyle";
      el.textContent = "/* " + WC_THEME_MARK + " */\n" + themeCSS;
    }
    // Appending (or re-appending) moves it to the end of <head>, so it
    // wins the cascade over lobby.css AND the IndexedDB-injected theme.
    document.head.appendChild(el);
  }

  // lobby.js injects the saved theme on DOMContentLoaded — re-assert after
  // load: keep WC theme on top while ON, strip saved copies while OFF
  window.addEventListener("load", () => {
    setTimeout(() => {
      if (enabled) syncTheme(true);
      else purgeForeignWcTheme();
    }, 80);
  });

  // ════════════════════════════════════════════════════════════════════
  // 6. STYLES — Talkomatic palette
  // ════════════════════════════════════════════════════════════════════

  function injectStyles() {
    if (document.getElementById("wcStyles")) return;
    const s = document.createElement("style");
    s.id = "wcStyles";
    s.textContent = `
      /* ════ TICKER ════════════════════════════════════════════════ */
      #wcTicker {
        position: fixed; top: 0; left: 0; right: 0; height: 48px;
        z-index: 5000; display: none; align-items: center; gap: 10px;
        padding: 0 14px; box-sizing: border-box;
        background: #000; border-bottom: 2px solid #ff9800;
        font-family: talkoSS, Arial, sans-serif; color: #fff;
      }
      body.wc-mode #wcTicker { display: flex; }
      body.wc-mode .container { height: calc(100vh - 48px); margin-top: 48px; }
      body.wc-mode .toggle-button { top: calc(23.5px + 48px); }
      /* FIX: panel was overflowing its clipped container by 48px,
         making the bottom (Go Chat) unreachable */
      body.wc-mode .left-panel { height: calc(100vh - 48px - 23px); }
      @media (max-width: 992px) {
        body.wc-mode .left-panel {
          height: 100%;
          padding-top: calc(60px + 48px);
        }
        body.wc-mode .hide-menu-button { top: 48px; }
      }

      .wc-badge {
        display: flex; align-items: center; gap: 8px; flex-shrink: 0;
        font-weight: bold; font-size: 14px; color: #ff9800; white-space: nowrap;
      }
      .wc-badge img { width: 22px; height: 22px; border-radius: 50%;
        animation: wcSpin 8s linear infinite; }
      @keyframes wcSpin { to { transform: rotate(360deg) } }
      .wc-badge .wc-label-sub { color: #fff; font-weight: normal; }

      .wc-center { flex: 1; display: flex; align-items: center;
        justify-content: center; gap: 10px; min-width: 0; overflow: hidden; }
      .wc-side { display: flex; align-items: center; gap: 7px; min-width: 0; }
      .wc-flag-img { width: 26px; height: 17px; object-fit: cover;
        border-radius: 2px; box-shadow: 0 0 0 1px #444; flex-shrink: 0; }
      .wc-team { font-weight: bold; font-size: 14px; color: #fff; white-space: nowrap; }
      .wc-score { font-weight: bold; font-size: 17px; color: #ff9800;
        font-variant-numeric: tabular-nums; letter-spacing: 1px;
        background: #1a1a1a; border: 1px solid #ff9800;
        padding: 3px 12px; border-radius: 5px; white-space: nowrap; }
      .wc-vs { color: #01ffff; font-size: 11px; font-weight: bold; letter-spacing: 1px; }
      .wc-live-pill { display: flex; align-items: center; gap: 6px; flex-shrink: 0;
        background: #1a1a1a; border: 1px solid #ff2222; border-radius: 4px; padding: 3px 9px; }
      .wc-live-dot { width: 8px; height: 8px; border-radius: 50%; background: #ff2222;
        box-shadow: 0 0 7px #ff2222; animation: wcPulse 1.3s ease-in-out infinite; }
      @keyframes wcPulse { 0%,100% { opacity:.35 } 50% { opacity:1 } }
      .wc-live-txt { color: #ff4444; font-weight: bold; font-size: 11px; letter-spacing: 1.5px; }
      .wc-min { color: #ffff00; font-size: 11px; font-weight: bold; font-variant-numeric: tabular-nums; }
      .wc-meta { color: #01ffff; font-size: 12px; white-space: nowrap; }
      .wc-count { font-weight: bold; font-size: 14px; color: #ffff00;
        font-variant-numeric: tabular-nums; letter-spacing: .5px;
        background: #1a1a1a; border: 1px solid #555;
        padding: 3px 10px; border-radius: 5px; white-space: nowrap; flex-shrink: 0; }

      .wc-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .wc-btn { background: #000; color: #fff; border: 1px solid #ff9800;
        padding: 6px 12px; border-radius: 5px; cursor: pointer; font-size: 12px;
        font-family: talkoSS, Arial, sans-serif; transition: all .2s ease;
        white-space: nowrap; font-weight: bold; }
      .wc-btn:hover { background: #ff9800; color: #000; }
      .wc-btn.wc-off { border-color: #616161; color: #ccc; font-weight: normal; }
      .wc-btn.wc-off:hover { background: #616161; color: #fff; }

      #wcReenable { position: fixed; bottom: 10px; left: 10px; z-index: 5000;
        display: none; background: #000; color: #ff9800; border: 1px solid #ff9800;
        border-radius: 5px; padding: 8px 14px; cursor: pointer;
        font-size: 12px; font-weight: bold;
        font-family: talkoSS, Arial, sans-serif; transition: all .2s ease; }
      #wcReenable:hover { background: #ff9800; color: #000; }

      /* ════ PANEL ═════════════════════════════════════════════════ */
      #wcPanel { position: fixed; top: 54px; right: 10px; z-index: 5001;
        width: 390px; max-width: calc(100vw - 16px); max-height: 76vh;
        overflow-y: auto; display: none;
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        border: 2px solid #ff9800; border-radius: 16px; padding: 18px;
        box-shadow: 0 10px 40px rgba(0,0,0,.6);
        font-family: talkoSS, Arial, sans-serif; }
      #wcPanel.show { display: block; animation: wcDrop .25s ease-out; }
      @keyframes wcDrop { from { opacity:0; transform: translateY(-12px) } to { opacity:1; transform:none } }
      #wcPanel::-webkit-scrollbar { width: 8px; }
      #wcPanel::-webkit-scrollbar-track { background: #202020; }
      #wcPanel::-webkit-scrollbar-thumb { background: #616161; border-radius: 4px; }
      #wcPanel::-webkit-scrollbar-thumb:hover { background: #ff9800; }

      .wc-sec-title { color: #ff9800; font-weight: bold; font-size: 14px;
        margin: 16px 0 10px; padding-bottom: 8px; border-bottom: 1px solid #444;
        display: flex; align-items: center; gap: 8px; }
      .wc-sec-title:first-child { margin-top: 0; }
      .wc-panel-sub { color: #999; font-size: 11px; margin: -2px 0 12px; }

      .wc-card { background: rgba(0,0,0,.4); border: 1px solid #444;
        border-radius: 10px; padding: 11px 13px; margin-bottom: 9px;
        transition: border-color .2s ease, transform .2s ease; }
      .wc-card:hover { border-color: #ff9800; transform: translateY(-2px); }
      .wc-card.live { border-color: #ff2222; box-shadow: 0 0 12px rgba(255,34,34,.2); }
      .wc-card-body { display: flex; align-items: center; gap: 12px; }
      .wc-card-teams { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
      .wc-trow { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .wc-trow .wc-flag-img { width: 22px; height: 14px; }
      .wc-tname { color: #fff; font-size: 13.5px; font-weight: bold;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wc-tname.tbd { color: #999; font-weight: normal; font-style: italic; }
      .wc-tscore { margin-left: auto; color: #ff9800; font-weight: bold;
        font-size: 16px; font-variant-numeric: tabular-nums; }
      .wc-card-side { display: flex; flex-direction: column; align-items: flex-end;
        gap: 5px; flex-shrink: 0; padding-left: 11px; border-left: 1px solid #444;
        min-width: 74px; }
      .wc-card-time { color: #ffff00; font-size: 12.5px; font-weight: bold; font-variant-numeric: tabular-nums; }
      .wc-card-date { color: #999; font-size: 10.5px; font-variant-numeric: tabular-nums; }
      .wc-card-ft { color: #999; font-size: 11px; font-weight: bold; letter-spacing: 1px; }
      .wc-card-live { display: flex; align-items: center; gap: 5px; }
      .wc-card-meta { margin-top: 9px; padding-top: 8px; border-top: 1px solid #333;
        display: flex; justify-content: space-between; align-items: center; gap: 8px;
        color: #999; font-size: 10.5px; }
      .wc-card-meta .wc-stage { color: #01ffff; font-weight: bold; }

      .wc-room-btn { background: #000; border: 1px solid #ff9800; color: #ff9800;
        border-radius: 5px; padding: 4px 10px; font-size: 10.5px; font-weight: bold;
        cursor: pointer; font-family: talkoSS, Arial, sans-serif;
        transition: all .2s ease; white-space: nowrap; }
      .wc-room-btn:hover { background: #ff9800; color: #000; }
      .wc-empty { color: #999; font-size: 13px; text-align: center; padding: 14px 0; line-height: 1.8; }
      .wc-panel-footer { margin-top: 14px; padding-top: 12px; border-top: 1px solid #444;
        display: flex; justify-content: space-between; align-items: center;
        color: #999; font-size: 10.5px; }

      .wc-loc-flag { width: 18px; height: 12px; object-fit: cover; border-radius: 2px;
        margin-left: 5px; vertical-align: -1px; box-shadow: 0 0 0 1px #444; }

      /* ════ BALL ══════════════════════════════════════════════════ */
      #wcBallWrap { position: fixed; z-index: 4500; left: 0; top: 0;
        will-change: transform; display: none; pointer-events: none; }
      body.wc-mode #wcBallWrap.on { display: block; }
      #wcBall { width: 56px; height: 56px; cursor: grab; pointer-events: auto;
        will-change: transform; user-select: none; -webkit-user-select: none;
        touch-action: none; border-radius: 50%; display: block;
        filter: drop-shadow(0 5px 8px rgba(0,0,0,.5)); -webkit-user-drag: none; }
      #wcBall.grabbed { cursor: grabbing; }
      #wcBallShadow { position: fixed; z-index: 4499; width: 46px; height: 11px;
        background: radial-gradient(ellipse, rgba(0,0,0,.5), transparent 70%);
        border-radius: 50%; pointer-events: none; display: none;
        will-change: transform, opacity; }
      body.wc-mode #wcBallShadow.on { display: block; }

      /* ════ GOAL — drawn in code, layered around the ball ═════════
         Net (z 4400) sits BEHIND the ball (z 4500); the white frame
         (z 4600) sits IN FRONT — the ball visually enters the goal. */
      #wcGoalBack { position: fixed; right: 0; bottom: 0; z-index: 4400;
        pointer-events: none; display: none; }
      body.wc-mode #wcGoalBack.on { display: block; }
      .wcg-net { position: absolute; inset: 0;
        background:
          repeating-linear-gradient(48deg, rgba(255,255,255,.30) 0 1.5px, transparent 1.5px 11px),
          repeating-linear-gradient(-48deg, rgba(255,255,255,.30) 0 1.5px, transparent 1.5px 11px);
        filter: drop-shadow(0 0 4px rgba(0,0,0,.35)); }
      .wcg-slope-edge { position: absolute; height: 3px;
        background: linear-gradient(90deg, #e8edf1, #b9c2c9);
        border-radius: 2px; transform-origin: left center;
        box-shadow: 0 1px 3px rgba(0,0,0,.4); }

      #wcGoalFront { position: fixed; right: 0; bottom: 0; z-index: 4600;
        pointer-events: none; display: none; }
      body.wc-mode #wcGoalFront.on { display: block; }
      .wcg-post { position: absolute; left: 0; top: 0; bottom: 0;
        background: linear-gradient(90deg, #ffffff, #c9d1d8);
        border-radius: 4px 4px 0 0; box-shadow: 2px 0 5px rgba(0,0,0,.45); }
      .wcg-bar { position: absolute; left: 0; top: 0;
        background: linear-gradient(#ffffff, #c9d1d8);
        border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,.45); }
      #wcGoalFront.shake { animation: wcNetShake .5s ease-in-out; }
      #wcGoalBack.shake .wcg-net { animation: wcNetWobble .55s ease-in-out; }
      @keyframes wcNetShake {
        0%,100% { transform: translateX(0) } 20% { transform: translateX(-3px) }
        40% { transform: translateX(3px) } 60% { transform: translateX(-2px) }
        80% { transform: translateX(1px) } }
      @keyframes wcNetWobble {
        0%,100% { transform: scaleX(1) } 25% { transform: scaleX(1.03) }
        55% { transform: scaleX(.985) } 80% { transform: scaleX(1.01) } }

      /* ════ GOOOAL! BANNER ════════════════════════════════════════ */
      #wcGoalBanner { position: fixed; top: 26%; left: 50%; z-index: 99998;
        transform: translateX(-50%); display: none; text-align: center;
        pointer-events: none; font-family: talkoSS, Arial, sans-serif; }
      #wcGoalBanner.show { display: block; animation: wcGoalIn 2.4s ease-out forwards; }
      .wc-goal-word { font-size: 72px; font-weight: bold; color: #ff9800;
        letter-spacing: 4px;
        text-shadow: 0 0 24px rgba(255,152,0,.8), 3px 3px 0 #000, -2px -2px 0 #000,
          2px -2px 0 #000, -2px 2px 0 #000; }
      .wc-goal-detail { margin-top: 6px; font-size: 22px; font-weight: bold; color: #fff;
        text-shadow: 2px 2px 0 #000, -1px -1px 0 #000; font-variant-numeric: tabular-nums; }
      @keyframes wcGoalIn {
        0% { opacity: 0; transform: translateX(-50%) scale(.4); }
        12% { opacity: 1; transform: translateX(-50%) scale(1.15); }
        20% { transform: translateX(-50%) scale(1); }
        80% { opacity: 1; }
        100% { opacity: 0; transform: translateX(-50%) scale(1) translateY(-14px); } }

      /* ════ MOBILE ════════════════════════════════════════════════ */
      @media (max-width: 760px) {
        #wcTicker { height: 44px; gap: 7px; padding: 0 8px; }
        body.wc-mode .container { height: calc(100vh - 44px); margin-top: 44px; }
        body.wc-mode .toggle-button { top: calc(23.5px + 44px); }
        body.wc-mode .left-panel { padding-top: calc(60px + 44px); }
        body.wc-mode .hide-menu-button { top: 44px; }
        .wc-badge .wc-label { display: none; }
        .wc-meta { display: none; }
        .wc-team { font-size: 12.5px; }
        .wc-flag-img { width: 22px; height: 14px; }
        .wc-score { font-size: 14px; padding: 2px 8px; }
        .wc-count { font-size: 12px; padding: 2px 7px; }
        .wc-btn { padding: 5px 9px; }
        .wc-btn .wc-btn-label { display: none; }
        #wcPanel { right: 8px; left: 8px; width: auto; top: 50px; }
        #wcBall { width: 48px; height: 48px; }
        .wc-goal-word { font-size: 48px; }
        .wc-goal-detail { font-size: 16px; }
      }
    `;
    document.head.appendChild(s);
  }

  // ════════════════════════════════════════════════════════════════════
  // 7. TIME HELPERS
  // ════════════════════════════════════════════════════════════════════

  const fmtTime = (d) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const fmtDay = (d) =>
    d.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  const localKick = (t) => {
    const d = new Date(t);
    return d.toDateString() === now().toDateString()
      ? `Today ${fmtTime(d)}`
      : `${fmtDay(d)} ${fmtTime(d)}`;
  };
  function countdown(t) {
    let ms = Math.max(0, new Date(t) - now());
    const h = Math.floor(ms / 36e5),
      m = Math.floor((ms % 36e5) / 6e4),
      s = Math.floor((ms % 6e4) / 1e3);
    if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }

  // ════════════════════════════════════════════════════════════════════
  // 8. LIVE API
  // ════════════════════════════════════════════════════════════════════

  async function pollLive() {
    if (!WC.LIVE_API_URL) return;
    try {
      const r = await fetch(WC.LIVE_API_URL, {
        headers: { Accept: "application/json" },
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      const games = Array.isArray(data?.games)
        ? data.games
        : Array.isArray(data)
          ? data
          : null;
      if (!games) throw new Error("unexpected payload");

      unmatchedNames = [];
      liveGames = games.map((g) => {
        const rawH = g.home_team_name_en || g.homeTeam || g.home_team_label;
        const rawA = g.away_team_name_en || g.visitingTeam || g.away_team_label;
        const home = canonical(rawH),
          away = canonical(rawA);
        if (rawH && !home) unmatchedNames.push(rawH);
        if (rawA && !away) unmatchedNames.push(rawA);
        return {
          home,
          away,
          hs: int(g.home_score),
          as: int(g.away_score),
          finished: truthy(g.finished),
          minute:
            g.time_elapsed && g.time_elapsed !== "0"
              ? String(g.time_elapsed).replace(/[^0-9+]/g, "")
              : null,
        };
      });
      if (unmatchedNames.length) {
        console.warn("[WC] unmatched team names from API:", [
          ...new Set(unmatchedNames),
        ]);
      }

      detectGoals();
      tickerKey = "";
      panelKey = "";
      renderTicker();
      if (panelOpen) renderPanel(true);
    } catch (e) {
      console.warn("[WC] live API unavailable:", e.message);
    }
  }

  const int = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  const truthy = (v) => v === true || v === "true" || v === "1" || v === 1;

  function apiFor(fix) {
    if (!liveGames) return null;
    const h = canonical(fix.home),
      a = canonical(fix.away);
    if (!h || !a) return null;
    return liveGames.find((g) => g.home === h && g.away === a) || null;
  }

  function detectGoals() {
    if (!liveGames) return;
    for (const g of liveGames) {
      if (!g.home || !g.away || g.hs == null) continue;
      const key = g.home + "|" + g.away;
      const cur = g.hs + "-" + g.as;
      const prev = lastScores.get(key);
      lastScores.set(key, cur);
      if (prev !== undefined && prev !== cur && !g.finished) {
        const th = team(g.home),
          ta = team(g.away);
        showGoalBanner(
          "GOOOAL!",
          `${th?.code || g.home} ${g.hs} – ${g.as} ${ta?.code || g.away}`,
        );
        burstConfetti(60);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 9. FIXTURE LOGIC
  // ════════════════════════════════════════════════════════════════════

  function isLiveFixture(f) {
    const api = apiFor(f);
    if (api?.finished) return false;
    const k = new Date(f.t);
    return now() >= k && now() - k < WC.MATCH_WINDOW_MS;
  }
  const getLiveMatch = () => FIXTURES.find(isLiveFixture) || null;
  const getNextMatch = () => {
    const t = now();
    return FIXTURES.find((f) => new Date(f.t) > t) || null;
  };
  const getTodayMatches = () => {
    const d = now().toDateString();
    return FIXTURES.filter((f) => new Date(f.t).toDateString() === d);
  };
  const getUpcoming = (n) => {
    const t = now(),
      today = t.toDateString();
    return FIXTURES.filter(
      (f) => new Date(f.t) > t && new Date(f.t).toDateString() !== today,
    ).slice(0, n);
  };

  // ════════════════════════════════════════════════════════════════════
  // 10. TICKER (stable DOM)
  // ════════════════════════════════════════════════════════════════════

  function flagHTML(name, cls) {
    const t = team(name);
    return t
      ? `<img class="${cls || "wc-flag-img"}" src="${WC.FLAG_CDN}${t.cc}.png" alt="${t.name}" loading="lazy">`
      : "";
  }

  function renderTicker() {
    const center = document.getElementById("wcCenter");
    if (!center) return;
    const live = getLiveMatch();
    const next = live ? null : getNextMatch();
    const key = live
      ? "L:" + live.home + "|" + live.away
      : next
        ? "N:" + next.home + "|" + next.away
        : "done";

    if (key !== tickerKey) {
      tickerKey = key;
      if (live) {
        center.innerHTML = `<span class="wc-live-pill"><span class="wc-live-dot"></span><span class="wc-live-txt">LIVE</span><span class="wc-min" id="wcMin"></span></span>
           <span class="wc-side">${flagHTML(live.home)}<span class="wc-team">${team(live.home)?.code || live.home}</span></span>
           <span class="wc-score" id="wcScore">0 – 0</span>
           <span class="wc-side">${flagHTML(live.away)}<span class="wc-team">${team(live.away)?.code || live.away}</span></span>`;
      } else if (next) {
        center.innerHTML = `<span class="wc-meta">NEXT</span>
           <span class="wc-side">${flagHTML(next.home)}<span class="wc-team">${team(next.home)?.code || next.home}</span></span>
           <span class="wc-vs">VS</span>
           <span class="wc-side">${flagHTML(next.away)}<span class="wc-team">${team(next.away)?.code || next.away}</span></span>
           <span class="wc-meta" id="wcKick"></span>
           <span class="wc-count" id="wcCd"></span>`;
      } else {
        center.innerHTML = `<span class="wc-meta">🏆 World Cup 2026 — what a tournament.</span>`;
      }
    }

    if (live) {
      const api = apiFor(live);
      const sc = document.getElementById("wcScore");
      const mn = document.getElementById("wcMin");
      if (sc)
        sc.textContent =
          api && api.hs != null ? `${api.hs} – ${api.as}` : "0 – 0";
      if (mn) mn.textContent = api?.minute ? api.minute + "'" : "";
    } else if (next) {
      const cd = document.getElementById("wcCd");
      const kick = document.getElementById("wcKick");
      if (cd) cd.textContent = "⏱ " + countdown(next.t);
      if (kick) kick.textContent = localKick(next.t);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 11. PANEL
  // ════════════════════════════════════════════════════════════════════

  function teamRow(name, score) {
    const t = team(name);
    return `<div class="wc-trow">${flagHTML(name)}<span class="wc-tname${t ? "" : " tbd"}">${t ? t.name : name}</span>${
      score != null ? `<span class="wc-tscore">${score}</span>` : ""
    }</div>`;
  }

  function matchCard(f) {
    const api = apiFor(f);
    const live = isLiveFixture(f);
    const finished = api?.finished;
    const hasScore = api && api.hs != null;

    let side;
    if (live) {
      side =
        `<div class="wc-card-live"><span class="wc-live-dot"></span><span class="wc-live-txt">LIVE</span></div>` +
        (api?.minute ? `<span class="wc-card-time">${api.minute}'</span>` : "");
    } else if (finished) {
      side = `<span class="wc-card-ft">FT</span>`;
    } else {
      const d = new Date(f.t);
      const isToday = d.toDateString() === now().toDateString();
      side =
        `<span class="wc-card-time">${fmtTime(d)}</span>` +
        `<span class="wc-card-date">${isToday ? `<span data-cd="${f.t}">${countdown(f.t)}</span>` : fmtDay(d)}</span>`;
    }

    const el = document.createElement("div");
    el.className = "wc-card" + (live ? " live" : "");
    el.innerHTML = `<div class="wc-card-body">
         <div class="wc-card-teams">
           ${teamRow(f.home, live || finished ? (hasScore ? api.hs : 0) : null)}
           ${teamRow(f.away, live || finished ? (hasScore ? api.as : 0) : null)}
         </div>
         <div class="wc-card-side">${side}</div>
       </div>
       <div class="wc-card-meta">
         <span><span class="wc-stage">${stageLabel(f.g)}</span> · ${f.venue}</span>
       </div>`;

    const btn = document.createElement("button");
    btn.className = "wc-room-btn";
    btn.textContent = "+ Match Room";
    btn.addEventListener("click", () => prefillMatchRoom(f));
    el.querySelector(".wc-card-meta").appendChild(btn);
    return el;
  }

  function renderPanel(force) {
    const list = document.getElementById("wcPanelList");
    if (!list) return;
    const today = getTodayMatches();
    const upcoming = getUpcoming(4);
    const key = today
      .map(
        (f) => f.t + (isLiveFixture(f) ? "L" : apiFor(f)?.finished ? "F" : "S"),
      )
      .join(",");

    if (key !== panelKey || force) {
      panelKey = key;
      list.innerHTML = "";
      if (today.length) {
        const lives = today.filter(isLiveFixture);
        const rest = today.filter((f) => !isLiveFixture(f));
        if (lives.length) {
          list.insertAdjacentHTML(
            "beforeend",
            `<div class="wc-sec-title">🔴 Live Now</div>`,
          );
          lives.forEach((f) => list.appendChild(matchCard(f)));
        }
        if (rest.length) {
          list.insertAdjacentHTML(
            "beforeend",
            `<div class="wc-sec-title">📅 Today</div>`,
          );
          rest.forEach((f) => list.appendChild(matchCard(f)));
        }
      } else {
        list.insertAdjacentHTML(
          "beforeend",
          `<div class="wc-empty">No matches today.</div>`,
        );
      }
      if (upcoming.length) {
        list.insertAdjacentHTML(
          "beforeend",
          `<div class="wc-sec-title">⏭ Coming Up</div>`,
        );
        upcoming.forEach((f) => list.appendChild(matchCard(f)));
      }
    } else {
      list.querySelectorAll("[data-cd]").forEach((el) => {
        el.textContent = countdown(el.dataset.cd);
      });
    }
  }

  function prefillMatchRoom(f) {
    const nameInput = document.querySelector(
      '#lobbyForm input[placeholder="Room Name"]',
    );
    const pub = document.querySelector(
      'input[name="roomType"][value="public"]',
    );
    const lay = document.querySelector(
      'input[name="roomLayout"][value="horizontal"]',
    );
    if (!nameInput) return;
    const h = team(f.home),
      a = team(f.away);
    nameInput.value =
      `${h ? h.code : f.home} vs ${a ? a.code : f.away} Watch-Along`.slice(
        0,
        25,
      );
    if (pub) pub.checked = true;
    if (lay) lay.checked = true;
    togglePanel(false);
    const lp = document.getElementById("leftPanel");
    if (lp && window.innerWidth <= 992) lp.classList.add("open");
    nameInput.scrollIntoView({ behavior: "smooth", block: "center" });
    nameInput.focus();
  }

  function togglePanel(force) {
    panelOpen = typeof force === "boolean" ? force : !panelOpen;
    const p = document.getElementById("wcPanel");
    if (!p) return;
    p.classList.toggle("show", panelOpen);
    if (panelOpen) {
      panelKey = "";
      renderPanel(true);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 12. UI BUILD
  // ════════════════════════════════════════════════════════════════════

  function buildUI() {
    if (document.getElementById("wcTicker")) return;

    const bar = document.createElement("div");
    bar.id = "wcTicker";
    bar.innerHTML = `<div class="wc-badge"><img src="${WC.BALL_IMG}" alt="⚽"><span class="wc-label">World Cup <span class="wc-label-sub">2026</span></span></div>
       <div class="wc-center" id="wcCenter"></div>
       <div class="wc-actions">
         <button class="wc-btn" id="wcMatchesBtn">📅<span class="wc-btn-label"> Matches</span></button>
         <button class="wc-btn wc-off" id="wcOffBtn" title="Turn off World Cup mode">✕</button>
       </div>`;
    document.body.appendChild(bar);

    const panel = document.createElement("div");
    panel.id = "wcPanel";
    panel.innerHTML = `<div class="wc-sec-title">⚽ World Cup 2026</div>
       <div class="wc-panel-sub">Kickoffs shown in your time · ${Intl.DateTimeFormat().resolvedOptions().timeZone || "local"}</div>
       <div id="wcPanelList"></div>
       <div class="wc-panel-footer">
         <span>Jun 11 – Jul 19 · USA · Canada · Mexico</span>
         <button class="wc-room-btn" id="wcBallToggle"></button>
       </div>`;
    document.body.appendChild(panel);

    document.getElementById("wcMatchesBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });
    document
      .getElementById("wcOffBtn")
      .addEventListener("click", () => setEnabled(false));
    document.addEventListener("click", (e) => {
      if (
        panelOpen &&
        !panel.contains(e.target) &&
        !e.target.closest("#wcMatchesBtn")
      )
        togglePanel(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && panelOpen) togglePanel(false);
    });

    const ballBtn = document.getElementById("wcBallToggle");
    ballBtn.addEventListener("click", () => setBallEnabled(!ballEnabled));
    updateBallToggleLabel();

    const pill = document.createElement("button");
    pill.id = "wcReenable";
    pill.textContent = "⚽ World Cup Mode";
    pill.addEventListener("click", () => setEnabled(true));
    document.body.appendChild(pill);

    const banner = document.createElement("div");
    banner.id = "wcGoalBanner";
    banner.innerHTML = `<div class="wc-goal-word" id="wcGoalWord">GOOOAL!</div><div class="wc-goal-detail" id="wcGoalDetail"></div>`;
    document.body.appendChild(banner);
  }

  function updateBallToggleLabel() {
    const b = document.getElementById("wcBallToggle");
    if (b) b.textContent = ballEnabled ? "⚽ Ball ON" : "⚽ Ball OFF";
  }

  function showGoalBanner(word, detail) {
    const banner = document.getElementById("wcGoalBanner");
    if (!banner) return;
    document.getElementById("wcGoalWord").textContent = word;
    document.getElementById("wcGoalDetail").textContent = detail || "";
    banner.classList.remove("show");
    void banner.offsetWidth;
    banner.classList.add("show");
    setTimeout(() => banner.classList.remove("show"), 2500);
  }

  // ════════════════════════════════════════════════════════════════════
  // 13. LOBBY FLAGS
  // ════════════════════════════════════════════════════════════════════

  function decorateFlags(root) {
    if (!enabled) return;
    (root || document).querySelectorAll(".users-detail div").forEach((div) => {
      if (div.querySelector(".wc-loc-flag")) return;
      const text = div.textContent;
      const idx = text.lastIndexOf("/ ");
      if (idx === -1) return;
      const t = team(text.slice(idx + 2).trim());
      if (!t) return;
      const img = document.createElement("img");
      img.className = "wc-loc-flag";
      img.src = WC.FLAG_CDN + t.cc + ".png";
      img.alt = t.name;
      img.loading = "lazy";
      div.appendChild(img);
    });
  }

  function watchRoomList() {
    const list = document.getElementById("dynamicRoomList");
    if (!list) return;
    new MutationObserver(() => decorateFlags(list)).observe(list, {
      childList: true,
      subtree: true,
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // 14. GOAL — drawn in code with real geometry.
  //
  //   Side view, opening faces LEFT. Anchored bottom-right:
  //
  //        barX0      barX1
  //          ═══════════╗            ← crossbar (solid, bounces)
  //          ║          ╲
  //   (open) ║           ╲  net      ← sloped net (roll-off from above,
  //          ║            ╲             contains the ball from inside)
  //          ║   NET       ╲
  //   ───────╨──────────────╲──────  ← floor
  //        front post     screen edge
  //
  //   Ball z-index sits BETWEEN net (behind) and frame (front), so it
  //   visually goes INTO the goal. Score = crossing the goal line
  //   (front post plane) below the crossbar.
  // ════════════════════════════════════════════════════════════════════

  const Goal = {
    back: null,
    front: null,
    built: false,

    dims() {
      const m = innerWidth <= 760;
      return {
        H: m ? 104 : 140, // opening height (floor → crossbar)
        BAR: m ? 46 : 64, // crossbar length (roof depth)
        W: m ? 132 : 178, // total goal footprint width
        T: 7, // frame thickness
      };
    },

    // Absolute geometry in viewport coordinates
    geom() {
      const d = this.dims();
      const floor = innerHeight;
      const x0 = innerWidth - d.W; // goal line / front post x
      return {
        ...d,
        floor,
        x0,
        barY: floor - d.H, // crossbar top surface y
        barX1: x0 + d.BAR, // where the roof ends, slope begins
        slopeX2: innerWidth - 3, // slope reaches the floor near edge
      };
    },

    // Net "ceiling" height at a given x (crossbar roof, then slope down)
    ceilingAt(x) {
      const g = this.geom();
      if (x <= g.barX1) return g.barY;
      const f = clamp((x - g.barX1) / (g.slopeX2 - g.barX1), 0, 1);
      return g.barY + f * (g.floor - g.barY);
    },

    build() {
      if (this.built) return;
      this.built = true;

      this.back = document.createElement("div");
      this.back.id = "wcGoalBack";
      const net = document.createElement("div");
      net.className = "wcg-net";
      const edge = document.createElement("div");
      edge.className = "wcg-slope-edge";
      this.back.appendChild(net);
      this.back.appendChild(edge);
      document.body.appendChild(this.back);

      this.front = document.createElement("div");
      this.front.id = "wcGoalFront";
      const post = document.createElement("div");
      post.className = "wcg-post";
      const bar = document.createElement("div");
      bar.className = "wcg-bar";
      this.front.appendChild(post);
      this.front.appendChild(bar);
      document.body.appendChild(this.front);

      this.layout();
      addEventListener("resize", () => this.layout());
    },

    layout() {
      if (!this.built) return;
      const g = this.geom();

      // Back container covers the whole goal footprint
      this.back.style.width = g.W + "px";
      this.back.style.height = g.H + "px";

      // Net clipped to: roof region + the sloped back down to the floor
      const net = this.back.querySelector(".wcg-net");
      net.style.clipPath = `polygon(0px 0px, ${g.BAR}px 0px, ${g.W - 3}px ${g.H}px, 0px ${g.H}px)`;

      // White edge along the slope (hypotenuse) for definition
      const edge = this.back.querySelector(".wcg-slope-edge");
      const dx = g.W - 3 - g.BAR,
        dy = g.H;
      const len = Math.hypot(dx, dy);
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      edge.style.width = len + "px";
      edge.style.left = g.BAR + "px";
      edge.style.top = "0px";
      edge.style.transform = `rotate(${ang}deg)`;

      // Front frame
      this.front.style.width = g.W + "px";
      this.front.style.height = g.H + "px";
      const post = this.front.querySelector(".wcg-post");
      post.style.width = g.T + "px";
      const bar = this.front.querySelector(".wcg-bar");
      bar.style.width = g.BAR + g.T + "px";
      bar.style.height = g.T + "px";
    },

    show(on) {
      if (!this.built) this.build();
      this.back.classList.toggle("on", on);
      this.front.classList.toggle("on", on);
    },

    shake() {
      [this.front, this.back].forEach((el) => {
        el.classList.remove("shake");
        void el.offsetWidth;
        el.classList.add("shake");
      });
    },
  };

  // ════════════════════════════════════════════════════════════════════
  // 15. BALL — drag & flick + goal collisions
  // ════════════════════════════════════════════════════════════════════

  const Ball = {
    wrap: null,
    el: null,
    shadow: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    G: 0.55,
    BOUNCE: 0.7,
    AIR: 0.997,
    FLOOR_F: 0.96,
    raf: null,
    dragging: false,
    grabDX: 0,
    grabDY: 0,
    samples: [],
    inGoal: false,
    lastGoalAt: 0,

    size() {
      return innerWidth <= 760 ? 48 : 56;
    },
    bounds() {
      const top = document.body.classList.contains("wc-mode")
        ? innerWidth <= 760
          ? 44
          : 48
        : 0;
      const S = this.size();
      return { top, right: innerWidth - S, bottom: innerHeight - S, left: 0 };
    },

    create() {
      if (this.wrap) return;
      this.wrap = document.createElement("div");
      this.wrap.id = "wcBallWrap";
      this.el = document.createElement("img");
      this.el.id = "wcBall";
      this.el.src = WC.BALL_IMG;
      this.el.alt = "Soccer ball — drag and throw me!";
      this.el.title = "Drag and throw me ⚽";
      this.el.draggable = false;
      this.wrap.appendChild(this.el);
      document.body.appendChild(this.wrap);

      this.shadow = document.createElement("div");
      this.shadow.id = "wcBallShadow";
      document.body.appendChild(this.shadow);

      this.el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.el.setPointerCapture(e.pointerId);
        this.dragging = true;
        this.el.classList.add("grabbed");
        this.grabDX = e.clientX - this.x;
        this.grabDY = e.clientY - this.y;
        this.vx = this.vy = 0;
        this.samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
        this.wake();
      });

      this.el.addEventListener("pointermove", (e) => {
        if (!this.dragging) return;
        const b = this.bounds();
        this.x = clamp(e.clientX - this.grabDX, b.left, b.right);
        this.y = clamp(e.clientY - this.grabDY, b.top, b.bottom);
        const t = performance.now();
        this.samples.push({ x: e.clientX, y: e.clientY, t });
        while (this.samples.length > 2 && t - this.samples[0].t > 120)
          this.samples.shift();
      });

      const release = (e) => {
        if (!this.dragging) return;
        this.dragging = false;
        this.el.classList.remove("grabbed");
        const s = this.samples;
        const first = s[0],
          last = s[s.length - 1];
        const dt = Math.max(1, last.t - first.t);
        const dx = last.x - first.x,
          dy = last.y - first.y;
        const moved = Math.hypot(dx, dy);

        if (moved < 6 && dt < 220) {
          const bx = this.x + this.size() / 2,
            by = this.y + this.size() / 2;
          let kx = bx - e.clientX,
            ky = by - e.clientY;
          const d = Math.hypot(kx, ky) || 1;
          this.vx = (kx / d) * 9 + (Math.random() - 0.5) * 4;
          this.vy = -13 - Math.random() * 4;
        } else {
          this.vx = clamp((dx / dt) * 16.7, -30, 30);
          this.vy = clamp((dy / dt) * 16.7, -32, 26);
        }
        this.wake();
      };
      this.el.addEventListener("pointerup", release);
      this.el.addEventListener("pointercancel", release);

      addEventListener("resize", () => this.wake());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.stop();
        else if (this.visible()) this.wake();
      });
    },

    visible() {
      return (
        this.wrap?.classList.contains("on") &&
        document.body.classList.contains("wc-mode")
      );
    },

    show(on) {
      if (!this.wrap) this.create();
      this.wrap.classList.toggle("on", on);
      this.shadow.classList.toggle("on", on);
      Goal.show(on);
      if (on) {
        this.x = innerWidth * 0.3;
        this.y = -this.size() - 10;
        this.vx = 1 + Math.random() * 2;
        this.vy = 2;
        this.rot = 0;
        this.wake();
      } else this.stop();
    },

    // ── Goal physics ──
    goalPhysics(prevX, prevY) {
      const g = Goal.geom();
      const S = this.size(),
        r = S / 2;
      const cx = this.x + r,
        cy = this.y + r;
      const prevCx = prevX + r,
        prevCy = prevY + r;

      // 1) CROSSBAR — solid from above and (within the mouth) from below
      const barTop = g.barY - g.T / 2,
        barBot = g.barY + g.T / 2;
      const overBarSpan = cx > g.x0 - r * 0.4 && cx < g.barX1 + r * 0.4;
      if (overBarSpan) {
        // landing on top of the bar
        if (this.vy > 0 && prevCy + r <= barTop + 2 && cy + r >= barTop) {
          this.y = barTop - S;
          this.vy = -this.vy * this.BOUNCE;
          this.vx *= 0.92;
          if (Math.abs(this.vy) < 1.4) this.vy = 0;
          return;
        }
        // hitting the underside from inside the goal
        if (
          this.vy < 0 &&
          prevCy - r >= barBot - 2 &&
          cy - r <= barBot &&
          cx > g.x0
        ) {
          this.y = barBot;
          this.vy = -this.vy * 0.45;
        }
      }

      // 2) SLOPED NET — thrown on top: bounce/roll down the slope
      if (cx > g.barX1 && cx < g.slopeX2) {
        const ceil = Goal.ceilingAt(cx);
        const ballBot = cy + r;
        const prevBot = prevCy + r;
        if (
          this.vy > 0 &&
          prevBot <= ceil + 3 &&
          ballBot >= ceil &&
          prevCy < ceil
        ) {
          // soft bounce + push down-slope (toward the back wall)
          this.y = ceil - S;
          this.vy = -this.vy * 0.35;
          this.vx = Math.abs(this.vx) * 0.5 + 1.6;
        }
      }

      // 3) INSIDE THE GOAL — net containment + score detection
      const insideMouth = cx > g.x0 + g.T && cy > g.barY + g.T;
      if (insideMouth) {
        // can't poke up through the sloped net from inside:
        // keep the ball's TOP edge at or below the net line
        if (cx > g.barX1) {
          const ceil = Goal.ceilingAt(cx) + g.T;
          if (this.y < ceil) {
            this.y = ceil;
            if (this.vy < 0) this.vy = Math.abs(this.vy) * 0.3;
          }
        }
        // net friction — the ball gets "caught"
        this.vx *= 0.965;
        this.vy *= 0.985;

        // SCORE: crossed the goal line into the mouth
        if (
          !this.inGoal &&
          prevCx <= g.x0 + g.T &&
          performance.now() - this.lastGoalAt > 2500
        ) {
          this.inGoal = true;
          this.lastGoalAt = performance.now();
          goalCount++;
          showGoalBanner("GOOOAL!", goalCount > 1 ? `⚽ ×${goalCount}` : "⚽");
          burstConfetti(50);
          Goal.shake();
          this.vx *= 0.35; // net catches it
        }
      } else if (cx < g.x0 - r) {
        this.inGoal = false; // fully left the goal → can score again
      }
    },

    step() {
      const b = this.bounds();
      const S = this.size();

      if (this.dragging) {
        this.renderFrame(b, S);
        this.raf = requestAnimationFrame(() => this.step());
        return;
      }

      const prevX = this.x,
        prevY = this.y;

      this.vy += this.G;
      this.vx *= this.AIR;
      this.x += this.vx;
      this.y += this.vy;
      this.rot += this.vx * 2.2;

      if (this.x < b.left) {
        this.x = b.left;
        this.vx = -this.vx * this.BOUNCE;
      }
      if (this.x > b.right) {
        this.x = b.right;
        this.vx = -this.vx * this.BOUNCE;
      }
      if (this.y < b.top) {
        this.y = b.top;
        this.vy = -this.vy * this.BOUNCE;
      }
      if (this.y > b.bottom) {
        this.y = b.bottom;
        this.vy = -this.vy * this.BOUNCE;
        this.vx *= this.FLOOR_F;
        if (Math.abs(this.vy) < 1.4) this.vy = 0;
      }

      this.goalPhysics(prevX, prevY);
      this.renderFrame(b, S);

      if (
        this.vy === 0 &&
        Math.abs(this.vx) < 0.08 &&
        this.y >= b.bottom - 0.5
      ) {
        this.raf = null;
        return;
      }
      // also sleep when resting on the crossbar
      if (this.vy === 0 && Math.abs(this.vx) < 0.08) {
        this.raf = null;
        return;
      }
      this.raf = requestAnimationFrame(() => this.step());
    },

    renderFrame(b, S) {
      this.wrap.style.transform = `translate(${this.x}px, ${this.y}px)`;
      this.el.style.transform = `rotate(${this.rot}deg)`;
      const hFrac = Math.min(1, Math.max(0, (b.bottom - this.y) / 380));
      this.shadow.style.transform = `translate(${this.x + (S - 46) / 2}px, ${b.bottom + S - 7}px) scale(${1 - hFrac * 0.5})`;
      this.shadow.style.opacity = String(0.9 - hFrac * 0.65);
    },

    wake() {
      if (!this.raf && this.visible() && !document.hidden) {
        this.raf = requestAnimationFrame(() => this.step());
      }
    },
    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
    },
  };

  function setBallEnabled(on) {
    ballEnabled = on;
    localStorage.setItem(WC.BALL_KEY, String(on));
    Ball.show(on && enabled);
    updateBallToggleLabel();
  }

  // ════════════════════════════════════════════════════════════════════
  // 16. CONFETTI
  // ════════════════════════════════════════════════════════════════════

  function burstConfetti(count) {
    const colors = ["#ff9800", "#ffff00", "#01ffff", "#ffffff", "#f57c00"];
    const c = document.createElement("div");
    c.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:99997;overflow:hidden;";
    document.body.appendChild(c);
    const pieces = [];
    for (let i = 0; i < (count || 60); i++) {
      const el = document.createElement("div");
      const size = 6 + Math.random() * 9;
      el.style.cssText = `position:absolute;width:${size}px;height:${size * 0.6}px;background:${colors[i % colors.length]};border-radius:2px;left:0;top:0;`;
      c.appendChild(el);
      pieces.push({
        el,
        x: Math.random() * innerWidth,
        y: -20 - Math.random() * 120,
        sp: 2.5 + Math.random() * 4.5,
        dr: (Math.random() - 0.5) * 3,
        rot: 0,
        rs: (Math.random() - 0.5) * 12,
      });
    }
    let frame;
    (function anim() {
      let alive = false;
      for (const p of pieces) {
        p.y += p.sp;
        p.x += p.dr;
        p.rot += p.rs;
        if (p.y < innerHeight + 40) alive = true;
        p.el.style.transform = `translate(${p.x}px,${p.y}px) rotate(${p.rot}deg)`;
        p.el.style.opacity = Math.max(0, 1 - p.y / innerHeight);
      }
      if (alive) frame = requestAnimationFrame(anim);
      else c.remove();
    })();
    setTimeout(() => {
      cancelAnimationFrame(frame);
      c.remove();
    }, 6000);
  }

  function welcomeConfetti() {
    if (sessionStorage.getItem(WC.CONFETTI_KEY)) return;
    sessionStorage.setItem(WC.CONFETTI_KEY, "1");
    burstConfetti(70);
  }

  // ════════════════════════════════════════════════════════════════════
  // 17. ENABLE / TIMERS / INIT
  // ════════════════════════════════════════════════════════════════════

  function setEnabled(on) {
    enabled = on;
    localStorage.setItem(WC.STORAGE_KEY, String(on));
    document.body.classList.toggle("wc-mode", on);
    const pill = document.getElementById("wcReenable");
    if (pill) pill.style.display = on || sunset() ? "none" : "block";

    syncTheme(on);

    if (on) {
      tickerKey = "";
      renderTicker();
      decorateFlags(document);
      startTimers();
      Ball.show(ballEnabled);
      welcomeConfetti();
    } else {
      togglePanel(false);
      stopTimers();
      Ball.show(false);
      document.querySelectorAll(".wc-loc-flag").forEach((f) => f.remove());
    }
  }

  function startTimers() {
    stopTimers();
    tickInterval = setInterval(() => {
      renderTicker();
      if (panelOpen) renderPanel();
    }, 1000);
    if (WC.LIVE_API_URL) {
      pollLive();
      pollInterval = setInterval(pollLive, WC.LIVE_POLL_MS);
    }
  }
  function stopTimers() {
    if (tickInterval) clearInterval(tickInterval);
    if (pollInterval) clearInterval(pollInterval);
    tickInterval = pollInterval = null;
  }

  function init() {
    if (sunset()) return;
    injectStyles();
    buildUI();
    watchRoomList();
    setEnabled(enabled);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
