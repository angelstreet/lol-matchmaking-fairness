// lib/counters.mjs — static champion lane-counter matrix.
//
// Heuristic matchup knowledge, patch-agnostic, PRs welcome. Every champion below is keyed (and
// counters listed) by match-v5's internal championName id, NOT the display name shown in-client
// — these differ for a handful of champions with punctuation/spacing in their display name:
//   Wukong -> MonkeyKing        Renata Glasc -> Renata        Nunu & Willump -> Nunu
//   Kai'Sa -> Kaisa             Bel'Veth -> Belveth           Cho'Gath -> Chogath
//   Kha'Zix -> Khazix           LeBlanc -> Leblanc            Dr. Mundo -> DrMundo
//   Jarvan IV -> JarvanIV       Master Yi -> MasterYi         Miss Fortune -> MissFortune
//   Twisted Fate -> TwistedFate Xin Zhao -> XinZhao           Aurelion Sol -> AurelionSol
//   Tahm Kench -> TahmKench     Rek'Sai -> RekSai              Kog'Maw -> KogMaw
//   Vel'Koz -> Velkoz           K'Sante -> KSante
//
// Each entry is well-known LANE counters (the champions that tend to beat this champion 1v1 in
// lane, per established community/competitive matchup knowledge) — not a full symmetric matrix,
// not patch-tuned, and deliberately conservative rather than exhaustive. Good enough to nudge a
// fairness verdict, not a substitute for an actual matchup guide.
// A matchup only ever lists ONE direction here — if X counters Y, Y does NOT also list X as a
// counter, even if the two champions' kits look like they'd threaten each other both ways. 32
// bidirectional pairs were pruned to one direction each (or dropped from both sides entirely when
// genuinely too close to call) after a real game showed the "countered" chip firing on both
// laners at once for a mutual pair — see git history for the full pair-by-pair list. A few champs
// (e.g. Quinn, Varus, Malzahar) ended up with noticeably shorter lists than the rest as a direct
// result — that's the correct outcome of removing the wrong-direction half of a pair, not
// something to pad back up artificially. netCounter() below is still the defensive backstop if a
// future edit accidentally reintroduces a mutual pair.
export const COUNTERS = {
  Aatrox: ['Vayne', 'Fiora', 'Camille', 'Jax', 'Riven', 'Gnar'],
  Ahri: ['Yasuo', 'Galio', 'Zed', 'Talon', 'Fizz'],
  Akali: ['Lissandra', 'Pantheon', 'Galio', 'Diana', 'Ahri'],
  Akshan: ['Draven', 'Sivir', 'Xerath', 'Ziggs', 'Corki'],
  Alistar: ['Morgana', 'Nautilus', 'Bard', 'Xerath', 'Velkoz'],
  Ambessa: ['Zed', 'Talon', 'Renekton', 'Pantheon'],
  Amumu: ['Warwick', 'Shyvana', 'Hecarim', 'Nunu'],
  Anivia: ['Yasuo', 'Zed', 'Fizz', 'Kassadin', 'Katarina'],
  Annie: ['Malzahar', 'Kassadin', 'Fizz'],
  Aphelios: ['Zed', 'Talon', 'Khazix', 'Rengar'],
  Ashe: ['Draven', 'Kaisa', 'Zeri', 'Tristana'],
  AurelionSol: ['Yasuo', 'Zed', 'Fizz', 'LeeSin'],
  Aurora: ['Zed', 'Talon', 'Renekton', 'Pantheon'],
  Azir: ['Zed', 'Yasuo', 'Fizz', 'Leblanc'],
  Bard: ['Blitzcrank', 'Pyke', 'Leona', 'Nautilus'],
  Belveth: ['LeeSin', 'Kindred', 'Nidalee', 'XinZhao'],
  Blitzcrank: ['Morgana', 'Lulu', 'Nami', 'Karma', 'Braum'],
  Brand: ['Yasuo', 'Zed', 'Fizz', 'Kassadin'],
  Braum: ['Zyra', 'Xerath', 'Brand', 'Velkoz'],
  Briar: ['Rammus', 'Poppy', 'Sejuani', 'Zac'],
  Caitlyn: ['Kaisa', 'Samira', 'Zeri'],
  Camille: ['Poppy', 'Malphite', 'Gnar', 'Renekton'],
  Cassiopeia: ['Yasuo', 'Kassadin', 'Zed', 'LeeSin'],
  Chogath: ['Renekton', 'Riven', 'Fiora', 'Darius'],
  Corki: ['Yasuo', 'Zed', 'Ahri', 'Leblanc'],
  Darius: ['Vayne', 'Quinn', 'Kayle', 'Teemo', 'Jax'],
  Diana: ['Lissandra', 'Galio', 'Malzahar', 'Chogath'],
  DrMundo: ['Vayne', 'Illaoi', 'Fiora', 'Darius'],
  Draven: ['Caitlyn', 'Varus', 'Corki'],
  Ekko: ['Diana', 'JarvanIV', 'LeeSin', 'Nocturne'],
  Elise: ['LeeSin', 'Nidalee', 'XinZhao'],
  Evelynn: ['LeeSin', 'Elise', 'Nidalee', 'Sejuani'],
  Ezreal: ['Draven', 'Kaisa', 'Samira', 'Lucian'],
  Fiddlesticks: ['LeeSin', 'XinZhao', 'Warwick', 'Shyvana'],
  Fiora: ['Poppy', 'Malphite', 'Gnar', 'Rumble'],
  Fizz: ['Lissandra', 'Yasuo', 'Kassadin', 'Diana'],
  Galio: ['Gangplank', 'Vladimir', 'Kassadin', 'Fizz'],
  Gangplank: ['Renekton', 'Darius', 'Riven', 'Camille'],
  Garen: ['Vayne', 'Quinn', 'Kayle', 'Teemo', 'Darius'],
  Gnar: ['Jayce', 'Kennen', 'Quinn', 'Vayne'],
  Gragas: ['LeeSin', 'Kassadin', 'Diana', 'JarvanIV'],
  Graves: ['Nidalee', 'Kindred', 'Ekko'],
  Gwen: ['Gangplank', 'Kennen', 'Quinn', 'Teemo'],
  Hecarim: ['Sejuani', 'Zac', 'Poppy', 'Rammus'],
  Heimerdinger: ['Zed', 'Talon', 'Yasuo', 'LeeSin'],
  Hwei: ['Zed', 'Yasuo', 'Talon', 'Fizz'],
  Illaoi: ['Gangplank', 'Jayce', 'Vayne', 'Quinn'],
  Irelia: ['Poppy', 'Malphite', 'Renekton', 'Pantheon', 'Jax'],
  Ivern: ['LeeSin', 'Elise', 'Nidalee', 'XinZhao'],
  Janna: ['Zyra', 'Brand'],
  JarvanIV: ['Olaf', 'Skarner', 'Sejuani'],
  Jax: ['Gnar', 'Kennen', 'Fiora', 'Vayne'],
  Jayce: ['Renekton', 'Camille', 'Riven', 'Darius'],
  Jhin: ['Draven', 'Kaisa', 'Samira', 'Tristana'],
  Jinx: ['Draven', 'Kaisa', 'Samira', 'Tristana'],
  Kaisa: ['Xerath', 'Ziggs', 'Draven', 'Varus'],
  Kalista: ['Leona', 'Nautilus', 'Thresh', 'Blitzcrank'],
  Karma: ['Zed', 'Talon', 'Yasuo', 'Fizz'],
  Karthus: ['LeeSin', 'Kindred', 'Nidalee', 'XinZhao'],
  Kassadin: ['Yasuo', 'Zed', 'Ahri', 'Leblanc'],
  Katarina: ['Malzahar', 'Diana', 'Galio', 'Yasuo', 'LeeSin'],
  Kayle: ['Renekton', 'Riven', 'Camille'],
  Kayn: ['Sejuani', 'Zac', 'JarvanIV', 'Rammus'],
  Kennen: ['Renekton', 'Darius', 'Riven'],
  Khazix: ['Vi', 'Sejuani', 'JarvanIV', 'Rammus'],
  Kindred: ['LeeSin', 'Elise', 'Zac', 'JarvanIV'],
  Kled: ['Vayne', 'Quinn', 'Kayle', 'Jayce'],
  KogMaw: ['Draven', 'Kaisa', 'Samira', 'Zeri'],
  KSante: ['Jayce', 'Gangplank', 'Vayne', 'Quinn'],
  Leblanc: ['Malzahar', 'Yasuo', 'Galio'],
  LeeSin: ['JarvanIV', 'Sejuani', 'Zac', 'Poppy'],
  Leona: ['Morgana', 'Zyra', 'Xerath', 'Janna'],
  Lillia: ['JarvanIV', 'Elise', 'LeeSin', 'Sejuani'],
  Lissandra: ['Yasuo', 'Kassadin'],
  Lucian: ['Caitlyn', 'Xerath', 'Ziggs', 'Varus'],
  Lulu: ['Zyra', 'Xerath', 'Brand', 'Morgana'],
  Lux: ['Zed', 'Yasuo', 'Talon', 'Fizz'],
  Malphite: ['Vayne', 'DrMundo', 'Renekton', 'Illaoi'],
  Malzahar: ['Fizz', 'Kassadin'],
  Maokai: ['Fiora', 'Vayne', 'DrMundo', 'Illaoi'],
  MasterYi: ['Rammus', 'Malzahar', 'Sejuani', 'Poppy', 'JarvanIV'],
  Mel: ['Zed', 'Talon', 'Yasuo', 'Fizz'],
  Milio: ['Zyra', 'Xerath', 'Brand', 'Velkoz'],
  MissFortune: ['Draven', 'Kaisa', 'Samira', 'Zeri'],
  MonkeyKing: ['Jayce', 'Gangplank', 'Vayne', 'Quinn'],
  Mordekaiser: ['Vayne', 'Quinn', 'Gangplank', 'Jayce'],
  Morgana: ['Yasuo', 'Zed', 'Kassadin', 'Fizz'],
  Naafiri: ['Malzahar', 'Lissandra', 'Galio', 'Diana'],
  Nami: ['Zyra', 'Xerath', 'Brand', 'Morgana'],
  Nasus: ['Kennen', 'Vayne', 'Quinn', 'Jayce'],
  Nautilus: ['Morgana', 'Xerath', 'Janna'],
  Neeko: ['Zed', 'Talon', 'Yasuo', 'Fizz'],
  Nidalee: ['LeeSin', 'JarvanIV'],
  Nilah: ['Draven', 'Xerath', 'Ziggs', 'Varus'],
  Nocturne: ['Sejuani', 'Rammus', 'Poppy', 'JarvanIV'],
  Nunu: ['LeeSin', 'Kindred', 'Nidalee', 'XinZhao'],
  Olaf: ['Poppy', 'Malphite', 'Gnar', 'Vayne'],
  Orianna: ['Zed', 'Yasuo', 'Talon', 'Fizz'],
  Ornn: ['Jayce', 'Gangplank', 'Vayne', 'Quinn'],
  Pantheon: ['Vayne', 'Quinn', 'Jayce', 'Kennen'],
  Poppy: ['Jayce', 'Vayne', 'Quinn', 'Gangplank'],
  Pyke: ['Morgana', 'Zyra', 'Xerath', 'Janna'],
  Qiyana: ['Malzahar', 'Lissandra', 'Galio', 'Diana'],
  Quinn: ['DrMundo'],
  Rakan: ['Xerath', 'Zyra', 'Brand', 'Morgana'],
  Rammus: ['Fiora', 'Vayne', 'DrMundo', 'Illaoi'],
  RekSai: ['Sejuani', 'JarvanIV', 'Zac', 'Rammus'],
  Rell: ['Xerath', 'Zyra', 'Morgana', 'Janna'],
  Renata: ['Xerath', 'Zyra', 'Brand', 'Morgana'],
  Renekton: ['Vayne', 'Quinn', 'Gnar'],
  Rengar: ['JarvanIV', 'Sejuani', 'Zac', 'Nunu'],
  Riven: ['Malphite', 'Poppy', 'Vayne', 'Illaoi'],
  Rumble: ['Jayce', 'Gangplank', 'Vayne', 'Quinn'],
  Ryze: ['Zed', 'Ahri', 'LeeSin', 'Kassadin'],
  Samira: ['Draven', 'Xerath', 'Ziggs', 'Varus'],
  Sejuani: ['Kindred', 'Nidalee', 'Ekko'],
  Senna: ['Draven', 'Kaisa', 'Samira', 'Zeri'],
  Seraphine: ['Leona', 'Nautilus', 'Pyke', 'Blitzcrank'],
  Sett: ['Vayne', 'Quinn', 'Jayce', 'Kennen'],
  Shaco: ['JarvanIV', 'Sejuani', 'Rammus', 'Zac'],
  Shen: ['Jayce', 'Vayne', 'Quinn', 'Gnar'],
  Shyvana: ['Sejuani', 'JarvanIV', 'Zac', 'Rammus'],
  Singed: ['Vayne', 'Quinn', 'Jayce', 'Kennen'],
  Sion: ['Jayce', 'Vayne', 'Quinn', 'Gnar'],
  Sivir: ['Draven', 'Kaisa', 'Samira', 'Zeri'],
  Skarner: ['Kindred', 'Nidalee', 'Graves', 'Ekko'],
  Smolder: ['Draven', 'Kaisa', 'Samira', 'Lucian'],
  Sona: ['Leona', 'Pyke', 'Blitzcrank', 'Nautilus'],
  Soraka: ['Leona', 'Pyke', 'Blitzcrank', 'Nautilus'],
  Swain: ['Zed', 'Yasuo', 'Talon', 'Fizz'],
  Sylas: ['Malzahar', 'Yasuo', 'Kassadin', 'Galio'],
  Syndra: ['Zed', 'Yasuo', 'Talon', 'Kassadin'],
  TahmKench: ['Jayce', 'Vayne', 'Quinn', 'Gnar'],
  Taliyah: ['Malzahar', 'LeeSin', 'JarvanIV', 'Zed'],
  Talon: ['Malzahar', 'Lissandra', 'Galio', 'Diana'],
  Taric: ['Xerath', 'Zyra', 'Brand', 'Morgana'],
  Teemo: ['Renekton', 'Riven', 'Camille', 'Pantheon', 'Irelia'],
  Thresh: ['Morgana', 'Zyra', 'Xerath', 'Janna'],
  Tristana: ['Xerath', 'Ziggs', 'Caitlyn', 'Varus'],
  Trundle: ['Vayne', 'Quinn', 'Jayce', 'Gnar'],
  Tryndamere: ['Vayne', 'Quinn', 'Jayce', 'Kennen'],
  TwistedFate: ['Zed', 'Yasuo', 'Talon', 'Fizz'],
  Twitch: ['Draven', 'Kaisa', 'Samira', 'Zeri'],
  Udyr: ['Kindred', 'Nidalee', 'Graves', 'Ekko'],
  Urgot: ['Jayce', 'Vayne', 'Quinn', 'Gnar'],
  Varus: ['Zeri'],
  Vayne: ['Caitlyn', 'Draven', 'Quinn', 'Corki', 'Ashe'],
  Veigar: ['Zed', 'Yasuo', 'Talon', 'Fizz'],
  Velkoz: ['Zed', 'Yasuo', 'Talon', 'LeeSin'],
  Vex: ['Malzahar', 'Annie', 'Galio', 'Diana'],
  Vi: ['Kindred', 'Nidalee', 'Graves', 'Ekko'],
  Viego: ['Sejuani', 'JarvanIV', 'Zac', 'Rammus'],
  Viktor: ['Zed', 'Yasuo', 'Kassadin', 'LeeSin'],
  Vladimir: ['Zed', 'Ahri', 'LeeSin', 'Talon'],
  Volibear: ['Jayce', 'Vayne', 'Quinn', 'Gnar'],
  Warwick: ['Sejuani', 'JarvanIV', 'Zac', 'Rammus', 'Lillia'],
  Xayah: ['Draven', 'Kaisa', 'Samira', 'Zeri'],
  Xerath: ['Zed', 'Yasuo', 'Talon', 'LeeSin'],
  XinZhao: ['Kindred', 'Nidalee', 'Graves', 'Ekko'],
  Yasuo: ['Annie', 'Malzahar', 'Pantheon', 'Renekton'],
  Yone: ['Malphite', 'Poppy', 'Pantheon', 'Renekton', 'Annie'],
  Yorick: ['Jayce', 'Vayne', 'Quinn', 'Gnar'],
  Yuumi: ['Blitzcrank', 'Pyke', 'Leona', 'Nautilus'],
  Zac: ['Nidalee', 'Graves', 'Ekko'],
  Zed: ['Malzahar', 'Lissandra', 'Galio', 'Diana'],
  Zeri: ['Xerath', 'Ziggs', 'Draven'],
  Ziggs: ['Zed', 'Yasuo', 'Talon', 'LeeSin'],
  Zilean: ['Leona', 'Pyke', 'Blitzcrank', 'Nautilus'],
  Zoe: ['Malzahar', 'Lissandra', 'Galio', 'Diana'],
  Zyra: ['Zed', 'Talon', 'LeeSin'],
};

// A flat 8-point GA penalty when `champ` is on the receiving end of a known lane counter from
// `oppChamp` — deliberately coarse (matchup severity isn't modeled, just "is this a known bad
// matchup or not") to match the rest of the fairness engine's heuristic style.
export function counterPenalty(champ, oppChamp) {
  return COUNTERS[champ]?.includes(oppChamp) ? 8 : 0;
}

// The single source of truth for "who, if anyone, is the net-countered side of this lane" — every
// consumer (engine lane math, the "countered" chip, lane-tooltip differentiators) must go through
// this instead of calling counterPenalty(a,b) and counterPenalty(b,a) separately, so they can
// never disagree with each other. Most COUNTERS entries are one-directional (A beats B doesn't
// imply B beats A), but a handful are curated in both directions — for a head-to-head lane that's
// a wash, not a double penalty, so it resolves to "neither side is countered" here rather than
// wrongly flagging both. Returns the countered champ's name, or null if neither (or both) are.
export function netCounter(aChamp, bChamp) {
  const aCountered = counterPenalty(aChamp, bChamp) > 0; // b counters a
  const bCountered = counterPenalty(bChamp, aChamp) > 0; // a counters b
  if (aCountered === bCountered) return null; // neither, or mutual -> cancels out
  return aCountered ? aChamp : bChamp;
}
