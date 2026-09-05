// lib/builds.mjs — static per-patch recommended-build snapshot (same philosophy as
// lib/champstats.mjs and lib/duosynergy.mjs: a curated, community-editable data file rather than
// a live API call).
//
// Source: https://b2c-api-cdn.deeplol.gg/champion/build (deeplol.gg's public soloq-build API,
// platform_id=KR, tier=Emerald+ — no auth/key required). Fetched 2026-09-05 via
// scripts/refresh-snapshots.mjs. Patch: 16.17 (the game_version sent in the request, derived
// from Data Dragon's current version at fetch time).
//
// Keyed by match-v5's internal championName (see lib/counters.mjs's header for the Wukong ->
// MonkeyKing style id quirks — same id space used here), then by Riot's teamPosition
// (TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY — deeplol.gg's own lane labels are Top/Jungle/Middle/Bot/
// Supporter/Aram; Aram is dropped since it's a different map/queue, not a Summoner's Rift role).
// Only the roles a champion's own deeplol.gg response actually lists are present — no role
// assumptions hardcoded here.
//
// Each role stores the single most-played build variant: keystone name, up to 2 core items
// (deeplol's own "main item" first, then the next distinct item from its build order), boots,
// skill-max order (Q/W/E, R excluded), and that variant's own win_rate/games — so a low-sample
// build isn't shown with false confidence. Rune/item ids are resolved to names via Data Dragon's
// item.json and runesReforged.json for this same patch; an id that patch doesn't recognize
// (e.g. a brand-new item) drops that whole role rather than storing a partial or wrong build —
// same "missing data -> no display, never a fabricated number" rule as champstats.mjs.
//
// 172 of 173 real champions matched, 234 champion+role builds total.
//
// Refresh cadence: once per patch, alongside champstats.mjs/duosynergy.mjs. Run
// `node scripts/refresh-snapshots.mjs` to regenerate all four files from their live sources.
export const PATCH = '16.17';

export const BUILDS = {
  Aatrox: {
    TOP: { keystone: "Conqueror", items: ["Spear of Shojin","Sundered Sky"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 51.8, games: 6495 },
  },
  Ahri: {
    MIDDLE: { keystone: "Electrocute", items: ["Malignance","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 51.6, games: 14905 },
  },
  Akali: {
    MIDDLE: { keystone: "Electrocute", items: ["Hextech Gunblade","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 50.6, games: 15945 },
    TOP: { keystone: "Electrocute", items: ["Hextech Gunblade","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 51, games: 6407 },
  },
  Akshan: {
    MIDDLE: { keystone: "Press the Attack", items: ["The Collector","Infinity Edge"], boots: "Berserker's Greaves", skillOrder: ["Q","E","W"], winRate: 53.5, games: 1026 },
  },
  Alistar: {
    UTILITY: { keystone: "Aftershock", items: ["Locket of the Iron Solari","Celestial Opposition"], boots: "Boots of Swiftness", skillOrder: ["Q","W","E"], winRate: 51.9, games: 6132 },
  },
  Ambessa: {
    JUNGLE: { keystone: "Conqueror", items: ["Profane Hydra","Voltaic Cyclosword"], boots: "Mercury's Treads", skillOrder: ["Q","E","W"], winRate: 48.7, games: 715 },
    TOP: { keystone: "Grasp of the Undying", items: ["Eclipse","Spear of Shojin"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 49.7, games: 8525 },
  },
  Amumu: {
    JUNGLE: { keystone: "Conqueror", items: ["Liandry's Torment","Sunfire Aegis"], boots: "Plated Steelcaps", skillOrder: ["E","Q","W"], winRate: 49.3, games: 1230 },
    UTILITY: { keystone: "Aftershock", items: ["Zeke's Convergence","Celestial Opposition"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 53.3, games: 748 },
  },
  Anivia: {
    MIDDLE: { keystone: "Electrocute", items: ["Rod of Ages","Archangel's Staff"], boots: "Sorcerer's Shoes", skillOrder: ["E","Q","W"], winRate: 51.9, games: 4724 },
    TOP: { keystone: "Deathfire Touch", items: ["Rod of Ages","Archangel's Staff"], boots: "Boots of Swiftness", skillOrder: ["E","Q","W"], winRate: 51.4, games: 1093 },
  },
  Annie: {
    MIDDLE: { keystone: "Electrocute", items: ["Malignance","Hextech Rocketbelt"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 50.8, games: 2410 },
  },
  Aphelios: {
    BOTTOM: { keystone: "Press the Attack", items: ["Hexoptics C44","Phantom Dancer"], boots: "Berserker's Greaves", skillOrder: ["Q","E","W"], winRate: 50.5, games: 5453 },
  },
  Ashe: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Hexoptics C44","Phantom Dancer"], boots: "Berserker's Greaves", skillOrder: ["W","Q","E"], winRate: 52, games: 9849 },
  },
  AurelionSol: {
    MIDDLE: { keystone: "Deathfire Touch", items: ["Rylai's Crystal Scepter","Liandry's Torment"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 54, games: 1607 },
  },
  Aurora: {
    MIDDLE: { keystone: "Electrocute", items: ["Luden's Echo","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 50.3, games: 2139 },
  },
  Azir: {
    MIDDLE: { keystone: "Press the Attack", items: ["Nashor's Tooth","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["W","Q","E"], winRate: 48.9, games: 2269 },
  },
  Bard: {
    UTILITY: { keystone: "Electrocute", items: ["Locket of the Iron Solari","Bloodsong"], boots: "Boots of Swiftness", skillOrder: ["Q","W","E"], winRate: 52, games: 7736 },
  },
  Belveth: {
    JUNGLE: { keystone: "Lethal Tempo", items: ["Kraken Slayer","Guinsoo's Rageblade"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 49.8, games: 2547 },
  },
  Blitzcrank: {
    UTILITY: { keystone: "Glacial Augment", items: ["Locket of the Iron Solari","Celestial Opposition"], boots: "Boots of Swiftness", skillOrder: ["Q","E","W"], winRate: 53.3, games: 11526 },
  },
  Brand: {
    UTILITY: { keystone: "Deathfire Touch", items: ["Rylai's Crystal Scepter","Zaz'Zak's Realmspike"], boots: "Sorcerer's Shoes", skillOrder: ["W","Q","E"], winRate: 51.7, games: 1327 },
  },
  Braum: {
    UTILITY: { keystone: "Guardian", items: ["Locket of the Iron Solari","Solstice Sleigh"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 55.2, games: 8242 },
  },
  Briar: {
    JUNGLE: { keystone: "Press the Attack", items: ["The Collector","Titanic Hydra"], boots: "Plated Steelcaps", skillOrder: ["W","Q","E"], winRate: 48.7, games: 2542 },
  },
  Caitlyn: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Hexoptics C44","Infinity Edge"], boots: "Berserker's Greaves", skillOrder: ["Q","W","E"], winRate: 49.5, games: 16645 },
  },
  Camille: {
    TOP: { keystone: "Grasp of the Undying", items: ["Trinity Force","Ravenous Hydra"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 53.1, games: 10194 },
    UTILITY: { keystone: "Hail of Blades", items: ["Sundered Sky","Bloodsong"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 50.4, games: 4942 },
  },
  Cassiopeia: {
    BOTTOM: { keystone: "Deathfire Touch", items: ["Blackfire Torch","Liandry's Torment"], boots: "Sorcerer's Shoes", skillOrder: ["E","Q","W"], winRate: 55.1, games: 877 },
    MIDDLE: { keystone: "Deathfire Touch", items: ["Rod of Ages","Archangel's Staff"], boots: "Boots of Swiftness", skillOrder: ["E","Q","W"], winRate: 50.5, games: 5835 },
    TOP: { keystone: "Deathfire Touch", items: ["Rod of Ages","Archangel's Staff"], boots: "Boots of Swiftness", skillOrder: ["E","Q","W"], winRate: 51.2, games: 775 },
  },
  Chogath: {
    JUNGLE: { keystone: "Hail of Blades", items: ["Heartsteel","Dead Man's Plate"], boots: "Boots of Swiftness", skillOrder: ["E","Q","W"], winRate: 51.5, games: 7568 },
    TOP: { keystone: "Grasp of the Undying", items: ["Heartsteel","Unending Despair"], boots: "Plated Steelcaps", skillOrder: ["E","Q","W"], winRate: 50.6, games: 1282 },
  },
  Corki: {
    BOTTOM: { keystone: "Conqueror", items: ["Essence Reaver","The Collector"], boots: "Gluttonous Greaves", skillOrder: ["Q","E","W"], winRate: 51.2, games: 5264 },
  },
  Darius: {
    TOP: { keystone: "Conqueror", items: ["Stridebreaker","Sterak's Gage"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 51.4, games: 2448 },
  },
  Diana: {
    JUNGLE: { keystone: "Conqueror", items: ["Dusk and Dawn","Riftmaker"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 49.9, games: 1887 },
    MIDDLE: { keystone: "Electrocute", items: ["Stormsurge","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 50.5, games: 2746 },
  },
  DrMundo: {
    TOP: { keystone: "Grasp of the Undying", items: ["Heartsteel","Warmog's Armor"], boots: "Boots of Swiftness", skillOrder: ["Q","E","W"], winRate: 51.8, games: 5758 },
  },
  Draven: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Bloodthirster","The Collector"], boots: "Berserker's Greaves", skillOrder: ["Q","W","E"], winRate: 52.6, games: 2397 },
  },
  Ekko: {
    JUNGLE: { keystone: "Dark Harvest", items: ["Dusk and Dawn","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 51.5, games: 5223 },
    MIDDLE: { keystone: "Hail of Blades", items: ["Dusk and Dawn","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 52, games: 2274 },
  },
  Elise: {
    JUNGLE: { keystone: "Dark Harvest", items: ["Stormsurge","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 50.3, games: 2573 },
    UTILITY: { keystone: "Electrocute", items: ["Stormsurge","Bloodsong"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 53.6, games: 931 },
  },
  Evelynn: {
    JUNGLE: { keystone: "Electrocute", items: ["Lich Bane","Rabadon's Deathcap"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 52.7, games: 3867 },
  },
  Ezreal: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Trinity Force","Manamune"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 47.7, games: 47010 },
  },
  Fiddlesticks: {
    JUNGLE: { keystone: "Electrocute", items: ["Malignance","Zhonya's Hourglass"], boots: "Sorcerer's Shoes", skillOrder: ["W","Q","E"], winRate: 47.5, games: 844 },
  },
  Fiora: {
    TOP: { keystone: "Press the Attack", items: ["Ravenous Hydra","Trinity Force"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 53.1, games: 4842 },
  },
  Fizz: {
    JUNGLE: { keystone: "Press the Attack", items: ["Dusk and Dawn","Nashor's Tooth"], boots: "Ionian Boots of Lucidity", skillOrder: ["W","E","Q"], winRate: 53.3, games: 3726 },
    MIDDLE: { keystone: "Electrocute", items: ["Blackfire Torch","Zhonya's Hourglass"], boots: "Sorcerer's Shoes", skillOrder: ["E","W","Q"], winRate: 51.5, games: 5091 },
  },
  Galio: {
    MIDDLE: { keystone: "Stormraider's Surge", items: ["Hextech Rocketbelt","Imperial Mandate"], boots: "Mercury's Treads", skillOrder: ["Q","W","E"], winRate: 51.6, games: 5029 },
    UTILITY: { keystone: "Aftershock", items: ["Locket of the Iron Solari","Celestial Opposition"], boots: "Plated Steelcaps", skillOrder: ["W","E","Q"], winRate: 54, games: 1601 },
  },
  Gangplank: {
    TOP: { keystone: "Deathfire Touch", items: ["Essence Reaver","The Collector"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 53.3, games: 13728 },
  },
  Garen: {
    TOP: { keystone: "Conqueror", items: ["Stridebreaker","Phantom Dancer"], boots: "Berserker's Greaves", skillOrder: ["E","Q","W"], winRate: 52.1, games: 8024 },
  },
  Gnar: {
    TOP: { keystone: "Lethal Tempo", items: ["Trinity Force","Black Cleaver"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 51.7, games: 4787 },
  },
  Gragas: {
    TOP: { keystone: "Stormraider's Surge", items: ["Rod of Ages","Winter's Approach"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 48.7, games: 1055 },
  },
  Graves: {
    JUNGLE: { keystone: "Dark Harvest", items: ["Hubris","The Collector"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 49.7, games: 12923 },
  },
  Gwen: {
    TOP: { keystone: "Conqueror", items: ["Riftmaker","Nashor's Tooth"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 51.9, games: 2941 },
  },
  Hecarim: {
    JUNGLE: { keystone: "Stormraider's Surge", items: ["Spear of Shojin","Black Cleaver"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 50.6, games: 9373 },
  },
  Heimerdinger: {
    TOP: { keystone: "Conqueror", items: ["Blackfire Torch","Liandry's Torment"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 54.2, games: 1427 },
  },
  Hwei: {
    MIDDLE: { keystone: "Arcane Comet", items: ["Blackfire Torch","Liandry's Torment"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 51.5, games: 6136 },
  },
  Illaoi: {
    TOP: { keystone: "Grasp of the Undying", items: ["Black Cleaver","Iceborn Gauntlet"], boots: "Plated Steelcaps", skillOrder: ["E","Q","W"], winRate: 50.4, games: 1331 },
  },
  Irelia: {
    MIDDLE: { keystone: "Conqueror", items: ["Blade of The Ruined King","Kraken Slayer"], boots: "Gluttonous Greaves", skillOrder: ["Q","W","E"], winRate: 51.2, games: 8775 },
    TOP: { keystone: "Conqueror", items: ["Blade of The Ruined King","Hullbreaker"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 52.4, games: 14606 },
  },
  Ivern: {
    JUNGLE: { keystone: "Summon Aery", items: ["Redemption","Moonstone Renewer"], boots: "Ionian Boots of Lucidity", skillOrder: ["E","Q","W"], winRate: 52.1, games: 568 },
  },
  Janna: {
    UTILITY: { keystone: "Summon Aery", items: ["Moonstone Renewer","Dream Maker"], boots: "Boots of Swiftness", skillOrder: ["E","W","Q"], winRate: 54.3, games: 725 },
  },
  JarvanIV: {
    JUNGLE: { keystone: "Conqueror", items: ["Sundered Sky","Black Cleaver"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 48.7, games: 10184 },
  },
  Jax: {
    JUNGLE: { keystone: "Lethal Tempo", items: ["Trinity Force","Sundered Sky"], boots: "Plated Steelcaps", skillOrder: ["W","E","Q"], winRate: 52, games: 2236 },
    TOP: { keystone: "Lethal Tempo", items: ["Trinity Force","Sundered Sky"], boots: "Plated Steelcaps", skillOrder: ["W","E","Q"], winRate: 52.4, games: 7286 },
  },
  Jayce: {
    JUNGLE: { keystone: "First Strike", items: ["Voltaic Cyclosword","Bastionbreaker"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 50, games: 7625 },
    MIDDLE: { keystone: "Stormraider's Surge", items: ["Youmuu's Ghostblade","Manamune"], boots: "Boots of Swiftness", skillOrder: ["Q","W","E"], winRate: 51.8, games: 1249 },
    TOP: { keystone: "Stormraider's Surge", items: ["Youmuu's Ghostblade","Manamune"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 50.4, games: 8073 },
  },
  Jhin: {
    BOTTOM: { keystone: "Fleet Footwork", items: ["Hubris","Phantom Dancer"], boots: "Boots of Swiftness", skillOrder: ["Q","W","E"], winRate: 51.4, games: 17586 },
  },
  Jinx: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Hexoptics C44","Runaan's Hurricane"], boots: "Berserker's Greaves", skillOrder: ["Q","W","E"], winRate: 53.4, games: 23590 },
  },
  KSante: {
    TOP: { keystone: "Grasp of the Undying", items: ["Iceborn Gauntlet","Unending Despair"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 48.8, games: 9900 },
  },
  Kaisa: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Kraken Slayer","Guinsoo's Rageblade"], boots: "Berserker's Greaves", skillOrder: ["Q","E","W"], winRate: 51.1, games: 64040 },
  },
  Kalista: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Statikk Shiv","Guinsoo's Rageblade"], boots: "Berserker's Greaves", skillOrder: ["E","Q","W"], winRate: 51.8, games: 8960 },
  },
  Karma: {
    UTILITY: { keystone: "Summon Aery", items: ["Echoes of Helia","Dream Maker"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 50.6, games: 7155 },
  },
  Karthus: {
    JUNGLE: { keystone: "Dark Harvest", items: ["Blackfire Torch","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 52, games: 3001 },
  },
  Kassadin: {
    MIDDLE: { keystone: "First Strike", items: ["Rod of Ages","Archangel's Staff"], boots: "Sorcerer's Shoes", skillOrder: ["E","W","Q"], winRate: 49.2, games: 1359 },
  },
  Katarina: {
    MIDDLE: { keystone: "Electrocute", items: ["Lich Bane","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 54.7, games: 7626 },
  },
  Kayle: {
    TOP: { keystone: "Lethal Tempo", items: ["Nashor's Tooth","Dusk and Dawn"], boots: "Boots of Swiftness", skillOrder: ["E","Q","W"], winRate: 49.9, games: 690 },
  },
  Kayn: {
    JUNGLE: { keystone: "Dark Harvest", items: ["Voltaic Cyclosword","Axiom Arc"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 51.7, games: 2584 },
  },
  Kennen: {
    TOP: { keystone: "Electrocute", items: ["Hextech Rocketbelt","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 51.7, games: 3859 },
  },
  Khazix: {
    JUNGLE: { keystone: "First Strike", items: ["Umbral Glaive","Voltaic Cyclosword"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 50.3, games: 5940 },
  },
  Kindred: {
    JUNGLE: { keystone: "Press the Attack", items: ["Kraken Slayer","The Collector"], boots: "Berserker's Greaves", skillOrder: ["Q","W","E"], winRate: 51.4, games: 2535 },
  },
  Kled: {
    TOP: { keystone: "Conqueror", items: ["Titanic Hydra","Black Cleaver"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 53.3, games: 2204 },
  },
  KogMaw: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Guinsoo's Rageblade","Navori Flickerblade"], boots: "Berserker's Greaves", skillOrder: ["W","Q","E"], winRate: 52.6, games: 1927 },
  },
  Leblanc: {
    MIDDLE: { keystone: "Electrocute", items: ["Luden's Echo","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["W","Q","E"], winRate: 51.5, games: 16623 },
    UTILITY: { keystone: "Electrocute", items: ["Luden's Echo","Zaz'Zak's Realmspike"], boots: "Sorcerer's Shoes", skillOrder: ["W","Q","E"], winRate: 50.6, games: 1868 },
  },
  LeeSin: {
    JUNGLE: { keystone: "Conqueror", items: ["Eclipse","Sundered Sky"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 52.2, games: 60313 },
  },
  Leona: {
    UTILITY: { keystone: "Aftershock", items: ["Locket of the Iron Solari","Celestial Opposition"], boots: "Plated Steelcaps", skillOrder: ["W","E","Q"], winRate: 52.9, games: 13619 },
  },
  Lillia: {
    JUNGLE: { keystone: "Conqueror", items: ["Liandry's Torment","Riftmaker"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 51.9, games: 8357 },
  },
  Lissandra: {
    MIDDLE: { keystone: "Electrocute", items: ["Malignance","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 52.5, games: 3521 },
  },
  Locke: {
    JUNGLE: { keystone: "Dark Harvest", items: ["Lich Bane","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 49.7, games: 1848 },
    MIDDLE: { keystone: "Electrocute", items: ["Lich Bane","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 51.8, games: 11870 },
  },
  Lucian: {
    BOTTOM: { keystone: "Press the Attack", items: ["Essence Reaver","Navori Flickerblade"], boots: "Gluttonous Greaves", skillOrder: ["Q","E","W"], winRate: 51.1, games: 28170 },
  },
  Lulu: {
    UTILITY: { keystone: "Summon Aery", items: ["Ardent Censer","Dream Maker"], boots: "Ionian Boots of Lucidity", skillOrder: ["E","W","Q"], winRate: 52.4, games: 18384 },
  },
  Lux: {
    MIDDLE: { keystone: "Arcane Comet", items: ["Luden's Echo","Stormsurge"], boots: "Sorcerer's Shoes", skillOrder: ["E","Q","W"], winRate: 50.5, games: 3279 },
    UTILITY: { keystone: "Arcane Comet", items: ["Luden's Echo","Zaz'Zak's Realmspike"], boots: "Sorcerer's Shoes", skillOrder: ["E","Q","W"], winRate: 51, games: 9699 },
  },
  Malphite: {
    MIDDLE: { keystone: "Arcane Comet", items: ["Malignance","Stormsurge"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 49.6, games: 681 },
    TOP: { keystone: "Arcane Comet", items: ["Sunfire Aegis","Thornmail"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 52.9, games: 5522 },
  },
  Malzahar: {
    MIDDLE: { keystone: "Deathfire Touch", items: ["Blackfire Torch","Liandry's Torment"], boots: "Sorcerer's Shoes", skillOrder: ["E","Q","W"], winRate: 50, games: 5783 },
  },
  Maokai: {
    JUNGLE: { keystone: "First Strike", items: ["Liandry's Torment","Imperial Mandate"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 49.4, games: 1682 },
    UTILITY: { keystone: "Aftershock", items: ["Locket of the Iron Solari","Solstice Sleigh"], boots: "Boots of Swiftness", skillOrder: ["Q","W","E"], winRate: 52.3, games: 2118 },
  },
  MasterYi: {
    JUNGLE: { keystone: "Lethal Tempo", items: ["Kraken Slayer","Guinsoo's Rageblade"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 48.7, games: 3374 },
  },
  Mel: {
    BOTTOM: { keystone: "Arcane Comet", items: ["Luden's Echo","Hextech Rocketbelt"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 48.6, games: 1255 },
    MIDDLE: { keystone: "Arcane Comet", items: ["Luden's Echo","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 45.9, games: 2243 },
    UTILITY: { keystone: "Arcane Comet", items: ["Luden's Echo","Zaz'Zak's Realmspike"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 45.3, games: 1213 },
  },
  Milio: {
    UTILITY: { keystone: "Summon Aery", items: ["Echoes of Helia","Dream Maker"], boots: "Ionian Boots of Lucidity", skillOrder: ["E","W","Q"], winRate: 51.9, games: 6424 },
  },
  MissFortune: {
    BOTTOM: { keystone: "Press the Attack", items: ["Bloodthirster","The Collector"], boots: "Boots of Swiftness", skillOrder: ["Q","W","E"], winRate: 50.5, games: 3871 },
  },
  MonkeyKing: {
    JUNGLE: { keystone: "Conqueror", items: ["Trinity Force","Sundered Sky"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 52.3, games: 14490 },
    TOP: { keystone: "Conqueror", items: ["Trinity Force","Black Cleaver"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 51.8, games: 1025 },
  },
  Mordekaiser: {
    TOP: { keystone: "Conqueror", items: ["Rylai's Crystal Scepter","Riftmaker"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 48.6, games: 3496 },
  },
  Morgana: {
    UTILITY: { keystone: "Arcane Comet", items: ["Liandry's Torment","Zaz'Zak's Realmspike"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 50.2, games: 2059 },
  },
  Naafiri: {
    JUNGLE: { keystone: "Conqueror", items: ["Voltaic Cyclosword","Black Cleaver"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 51.2, games: 13150 },
  },
  Nami: {
    UTILITY: { keystone: "Summon Aery", items: ["Echoes of Helia","Dream Maker"], boots: "Ionian Boots of Lucidity", skillOrder: ["W","E","Q"], winRate: 51.7, games: 2410 },
  },
  Nasus: {
    MIDDLE: { keystone: "Fleet Footwork", items: ["Trinity Force","Frozen Heart"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 52.6, games: 2253 },
    TOP: { keystone: "Fleet Footwork", items: ["Trinity Force","Frozen Heart"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 51.6, games: 9129 },
  },
  Nautilus: {
    UTILITY: { keystone: "Aftershock", items: ["Locket of the Iron Solari","Celestial Opposition"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 51.9, games: 25874 },
  },
  Neeko: {
    UTILITY: { keystone: "Arcane Comet", items: ["Hextech Rocketbelt","Celestial Opposition"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 50.4, games: 5071 },
  },
  Nidalee: {
    JUNGLE: { keystone: "Dark Harvest", items: ["Lich Bane","Hextech Rocketbelt"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 52.6, games: 11179 },
  },
  Nocturne: {
    JUNGLE: { keystone: "Conqueror", items: ["Experimental Hexplate","Stridebreaker"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 51.1, games: 4472 },
  },
  Nunu: {
    JUNGLE: { keystone: "Dark Harvest", items: ["Hextech Rocketbelt","Stormsurge"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 50.8, games: 798 },
    MIDDLE: { keystone: "Electrocute", items: ["Stormsurge","Hextech Rocketbelt"], boots: "Boots of Swiftness", skillOrder: ["Q","E","W"], winRate: 54.4, games: 1403 },
  },
  Olaf: {
    TOP: { keystone: "Conqueror", items: ["Stridebreaker","Experimental Hexplate"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 52.2, games: 6758 },
  },
  Orianna: {
    MIDDLE: { keystone: "Summon Aery", items: ["Blackfire Torch","Hextech Rocketbelt"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 49, games: 4788 },
  },
  Ornn: {
    TOP: { keystone: "Grasp of the Undying", items: ["Sunfire Aegis","Thornmail"], boots: "Plated Steelcaps", skillOrder: ["W","Q","E"], winRate: 50.7, games: 1484 },
  },
  Pantheon: {
    JUNGLE: { keystone: "Conqueror", items: ["Sundered Sky","Black Cleaver"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 48.1, games: 1669 },
    MIDDLE: { keystone: "Electrocute", items: ["Youmuu's Ghostblade","Voltaic Cyclosword"], boots: "Mercury's Treads", skillOrder: ["Q","W","E"], winRate: 54.5, games: 710 },
    TOP: { keystone: "Conqueror", items: ["Eclipse","Black Cleaver"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 53.9, games: 2551 },
    UTILITY: { keystone: "Press the Attack", items: ["Umbral Glaive","Bloodsong"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 48.3, games: 3131 },
  },
  Poppy: {
    JUNGLE: { keystone: "Stormraider's Surge", items: ["Sundered Sky","Dead Man's Plate"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 50.1, games: 811 },
    TOP: { keystone: "Grasp of the Undying", items: ["Sundered Sky","Winter's Approach"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 51.1, games: 1426 },
    UTILITY: { keystone: "Aftershock", items: ["Dead Man's Plate","Celestial Opposition"], boots: "Boots of Swiftness", skillOrder: ["Q","E","W"], winRate: 53.2, games: 2822 },
  },
  Pyke: {
    UTILITY: { keystone: "Hail of Blades", items: ["Umbral Glaive","Celestial Opposition"], boots: "Boots of Swiftness", skillOrder: ["Q","E","W"], winRate: 48.9, games: 11146 },
  },
  Qiyana: {
    JUNGLE: { keystone: "First Strike", items: ["Profane Hydra","Voltaic Cyclosword"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 49.4, games: 5792 },
    MIDDLE: { keystone: "Electrocute", items: ["Voltaic Cyclosword","Profane Hydra"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 54.3, games: 2361 },
  },
  Quinn: {
    JUNGLE: { keystone: "First Strike", items: ["Hubris","Edge of Night"], boots: "Gluttonous Greaves", skillOrder: ["Q","W","E"], winRate: 54.8, games: 533 },
    TOP: { keystone: "Electrocute", items: ["Profane Hydra","The Collector"], boots: "Berserker's Greaves", skillOrder: ["W","Q","E"], winRate: 55.5, games: 761 },
  },
  Rakan: {
    UTILITY: { keystone: "Guardian", items: ["Zeke's Convergence","Celestial Opposition"], boots: "Ionian Boots of Lucidity", skillOrder: ["W","E","Q"], winRate: 54.3, games: 5741 },
  },
  Rammus: {
    JUNGLE: { keystone: "Aftershock", items: ["Thornmail","Sunfire Aegis"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 52.9, games: 3196 },
  },
  RekSai: {
    JUNGLE: { keystone: "Conqueror", items: ["Stridebreaker","Spear of Shojin"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 54.1, games: 4710 },
  },
  Rell: {
    UTILITY: { keystone: "Aftershock", items: ["Zeke's Convergence","Celestial Opposition"], boots: "Ionian Boots of Lucidity", skillOrder: ["W","E","Q"], winRate: 54.6, games: 6652 },
  },
  Renata: {
    UTILITY: { keystone: "Guardian", items: ["Locket of the Iron Solari","Celestial Opposition"], boots: "Ionian Boots of Lucidity", skillOrder: ["E","W","Q"], winRate: 52.8, games: 1266 },
  },
  Renekton: {
    TOP: { keystone: "Conqueror", items: ["Eclipse","Black Cleaver"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 51.7, games: 6494 },
  },
  Rengar: {
    JUNGLE: { keystone: "Fleet Footwork", items: ["Umbral Glaive","Edge of Night"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 52.5, games: 1401 },
  },
  Riven: {
    TOP: { keystone: "Conqueror", items: ["Eclipse","Death's Dance"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 50.4, games: 1539 },
  },
  Rumble: {
    TOP: { keystone: "Deathfire Touch", items: ["Liandry's Torment","Bloodletter's Curse"], boots: "Boots of Swiftness", skillOrder: ["Q","E","W"], winRate: 51.4, games: 4668 },
  },
  Ryze: {
    MIDDLE: { keystone: "Deathfire Touch", items: ["Rod of Ages","Archangel's Staff"], boots: "Mercury's Treads", skillOrder: ["Q","E","W"], winRate: 48.6, games: 8936 },
    TOP: { keystone: "Deathfire Touch", items: ["Rod of Ages","Archangel's Staff"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 49.3, games: 1761 },
  },
  Samira: {
    BOTTOM: { keystone: "Conqueror", items: ["The Collector","Infinity Edge"], boots: "Gluttonous Greaves", skillOrder: ["Q","E","W"], winRate: 52.7, games: 5945 },
  },
  Sejuani: {
    JUNGLE: { keystone: "Aftershock", items: ["Heartsteel","Unending Despair"], boots: "Plated Steelcaps", skillOrder: ["W","Q","E"], winRate: 53.6, games: 2777 },
  },
  Senna: {
    UTILITY: { keystone: "Deathfire Touch", items: ["Black Cleaver","Bloodsong"], boots: "Boots of Swiftness", skillOrder: ["Q","W","E"], winRate: 53.8, games: 4675 },
  },
  Seraphine: {
    BOTTOM: { keystone: "Arcane Comet", items: ["Blackfire Torch","Archangel's Staff"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 55.3, games: 988 },
    UTILITY: { keystone: "Summon Aery", items: ["Echoes of Helia","Dream Maker"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","W","E"], winRate: 52.6, games: 8175 },
  },
  Sett: {
    TOP: { keystone: "Conqueror", items: ["Stridebreaker","Overlord's Bloodmail"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 52.1, games: 5176 },
  },
  Shaco: {
    JUNGLE: { keystone: "Hail of Blades", items: ["Voltaic Cyclosword","The Collector"], boots: "Boots of Swiftness", skillOrder: ["E","Q","W"], winRate: 48, games: 1991 },
    UTILITY: { keystone: "Arcane Comet", items: ["Blackfire Torch","Zaz'Zak's Realmspike"], boots: "Ionian Boots of Lucidity", skillOrder: ["W","E","Q"], winRate: 48.7, games: 716 },
  },
  Shen: {
    TOP: { keystone: "Grasp of the Undying", items: ["Titanic Hydra","Dusk and Dawn"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 54.2, games: 4230 },
    UTILITY: { keystone: "Aftershock", items: ["Protoplasm Harness","Celestial Opposition"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 51.5, games: 1084 },
  },
  Shyvana: {
    JUNGLE: { keystone: "Press the Attack", items: ["Kraken Slayer","Dusk and Dawn"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 50.6, games: 3999 },
  },
  Singed: {
    TOP: { keystone: "Deathfire Touch", items: ["Liandry's Torment","Rylai's Crystal Scepter"], boots: "Boots of Swiftness", skillOrder: ["Q","E","W"], winRate: 55, games: 3195 },
  },
  Sion: {
    TOP: { keystone: "Grasp of the Undying", items: ["Heartsteel","Unending Despair"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 49.6, games: 1634 },
  },
  Sivir: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Essence Reaver","Navori Flickerblade"], boots: "Berserker's Greaves", skillOrder: ["Q","W","E"], winRate: 50, games: 5901 },
  },
  Skarner: {
    JUNGLE: { keystone: "Grasp of the Undying", items: ["Heartsteel","Unending Despair"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 51.8, games: 2446 },
  },
  Smolder: {
    BOTTOM: { keystone: "Deathfire Touch", items: ["Essence Reaver","Black Cleaver"], boots: "Gluttonous Greaves", skillOrder: ["Q","W","E"], winRate: 52.2, games: 2353 },
  },
  Sona: {
    UTILITY: { keystone: "Summon Aery", items: ["Echoes of Helia","Dream Maker"], boots: "Ionian Boots of Lucidity", skillOrder: ["W","Q","E"], winRate: 56.1, games: 911 },
  },
  Soraka: {
    UTILITY: { keystone: "Summon Aery", items: ["Moonstone Renewer","Dream Maker"], boots: "Ionian Boots of Lucidity", skillOrder: ["W","Q","E"], winRate: 49.8, games: 4385 },
  },
  Swain: {
    BOTTOM: { keystone: "Conqueror", items: ["Malignance","Rylai's Crystal Scepter"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 54, games: 907 },
    UTILITY: { keystone: "Electrocute", items: ["Rylai's Crystal Scepter","Zaz'Zak's Realmspike"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 49.7, games: 2121 },
  },
  Sylas: {
    JUNGLE: { keystone: "Conqueror", items: ["Hextech Rocketbelt","Riftmaker"], boots: "Sorcerer's Shoes", skillOrder: ["W","E","Q"], winRate: 51.6, games: 28583 },
    MIDDLE: { keystone: "Conqueror", items: ["Hextech Rocketbelt","Riftmaker"], boots: "Ionian Boots of Lucidity", skillOrder: ["W","E","Q"], winRate: 49.5, games: 15122 },
    TOP: { keystone: "Conqueror", items: ["Hextech Rocketbelt","Riftmaker"], boots: "Ionian Boots of Lucidity", skillOrder: ["W","E","Q"], winRate: 51.3, games: 2195 },
    UTILITY: { keystone: "Electrocute", items: ["Hextech Rocketbelt","Zaz'Zak's Realmspike"], boots: "Sorcerer's Shoes", skillOrder: ["W","E","Q"], winRate: 48.2, games: 4407 },
  },
  Syndra: {
    BOTTOM: { keystone: "Arcane Comet", items: ["Blackfire Torch","Hextech Rocketbelt"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 51.2, games: 1331 },
    MIDDLE: { keystone: "Arcane Comet", items: ["Blackfire Torch","Hextech Rocketbelt"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 52.2, games: 8729 },
  },
  TahmKench: {
    UTILITY: { keystone: "Grasp of the Undying", items: ["Heartsteel","Solstice Sleigh"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 50.8, games: 1841 },
  },
  Taliyah: {
    JUNGLE: { keystone: "Dark Harvest", items: ["Blackfire Torch","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 52.6, games: 3645 },
    MIDDLE: { keystone: "Deathfire Touch", items: ["Blackfire Torch","Rylai's Crystal Scepter"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 50.7, games: 1363 },
  },
  Talon: {
    JUNGLE: { keystone: "First Strike", items: ["Youmuu's Ghostblade","Voltaic Cyclosword"], boots: "Ionian Boots of Lucidity", skillOrder: ["W","Q","E"], winRate: 51.5, games: 3807 },
    MIDDLE: { keystone: "Conqueror", items: ["Eclipse","Black Cleaver"], boots: "Mercury's Treads", skillOrder: ["W","Q","E"], winRate: 52.7, games: 3560 },
  },
  Taric: {
    UTILITY: { keystone: "Glacial Augment", items: ["Locket of the Iron Solari","Dream Maker"], boots: "Ionian Boots of Lucidity", skillOrder: ["E","Q","W"], winRate: 54.8, games: 870 },
  },
  Teemo: {
    TOP: { keystone: "Press the Attack", items: ["Statikk Shiv","Liandry's Torment"], boots: "Boots of Swiftness", skillOrder: ["E","Q","W"], winRate: 52, games: 4889 },
  },
  Thresh: {
    UTILITY: { keystone: "Aftershock", items: ["Locket of the Iron Solari","Solstice Sleigh"], boots: "Boots of Swiftness", skillOrder: ["Q","E","W"], winRate: 53.3, games: 23523 },
  },
  Tristana: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["The Collector","Navori Flickerblade"], boots: "Berserker's Greaves", skillOrder: ["E","Q","W"], winRate: 52.3, games: 7445 },
    MIDDLE: { keystone: "Lethal Tempo", items: ["Yun Tal Wildarrows","Navori Flickerblade"], boots: "Berserker's Greaves", skillOrder: ["E","Q","W"], winRate: 50.1, games: 690 },
  },
  Trundle: {
    JUNGLE: { keystone: "Press the Attack", items: ["Trinity Force","Dead Man's Plate"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 51.7, games: 1685 },
    TOP: { keystone: "Lethal Tempo", items: ["Ravenous Hydra","Trinity Force"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 49.7, games: 920 },
  },
  Tryndamere: {
    TOP: { keystone: "Hail of Blades", items: ["Ravenous Hydra","Phantom Dancer"], boots: "Berserker's Greaves", skillOrder: ["Q","E","W"], winRate: 55.2, games: 1791 },
  },
  TwistedFate: {
    MIDDLE: { keystone: "Arcane Comet", items: ["Rod of Ages","Lich Bane"], boots: "Boots of Swiftness", skillOrder: ["Q","W","E"], winRate: 51.5, games: 12247 },
  },
  Twitch: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["The Collector","Fiendhunter Bolts"], boots: "Berserker's Greaves", skillOrder: ["E","Q","W"], winRate: 51.7, games: 2387 },
  },
  Udyr: {
    JUNGLE: { keystone: "Press the Attack", items: ["Spear of Shojin","Experimental Hexplate"], boots: "Boots of Swiftness", skillOrder: ["Q","E","W"], winRate: 50.5, games: 426 },
  },
  Urgot: {
    TOP: { keystone: "Press the Attack", items: ["Black Cleaver","Sterak's Gage"], boots: "Plated Steelcaps", skillOrder: ["W","E","Q"], winRate: 52.7, games: 1694 },
  },
  Varus: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Statikk Shiv","Guinsoo's Rageblade"], boots: "Gluttonous Greaves", skillOrder: ["Q","W","E"], winRate: 49.8, games: 4408 },
    TOP: { keystone: "Press the Attack", items: ["Experimental Hexplate","Dusk and Dawn"], boots: "Plated Steelcaps", skillOrder: ["W","Q","E"], winRate: 46.4, games: 746 },
  },
  Vayne: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Blade of The Ruined King","Guinsoo's Rageblade"], boots: "Berserker's Greaves", skillOrder: ["Q","W","E"], winRate: 46, games: 1823 },
    TOP: { keystone: "Lethal Tempo", items: ["Experimental Hexplate","Essence Reaver"], boots: "Berserker's Greaves", skillOrder: ["Q","W","E"], winRate: 48.3, games: 4313 },
  },
  Veigar: {
    BOTTOM: { keystone: "First Strike", items: ["Rod of Ages","Archangel's Staff"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 56.3, games: 536 },
    MIDDLE: { keystone: "First Strike", items: ["Rod of Ages","Archangel's Staff"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 48.5, games: 936 },
  },
  Velkoz: {
    UTILITY: { keystone: "Arcane Comet", items: ["Luden's Echo","Zaz'Zak's Realmspike"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 53.9, games: 2513 },
  },
  Vex: {
    MIDDLE: { keystone: "Electrocute", items: ["Luden's Echo","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 53.1, games: 6855 },
  },
  Vi: {
    JUNGLE: { keystone: "Conqueror", items: ["Trinity Force","Sundered Sky"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 52.3, games: 14536 },
  },
  Viego: {
    JUNGLE: { keystone: "Conqueror", items: ["Kraken Slayer","The Collector"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 48, games: 14734 },
  },
  Viktor: {
    BOTTOM: { keystone: "Deathfire Touch", items: ["Blackfire Torch","Hextech Rocketbelt"], boots: "Sorcerer's Shoes", skillOrder: ["E","Q","W"], winRate: 51.6, games: 4600 },
    MIDDLE: { keystone: "Deathfire Touch", items: ["Blackfire Torch","Hextech Rocketbelt"], boots: "Sorcerer's Shoes", skillOrder: ["E","Q","W"], winRate: 50.8, games: 27511 },
  },
  Vladimir: {
    MIDDLE: { keystone: "Stormraider's Surge", items: ["Hextech Rocketbelt","Riftmaker"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 49.1, games: 1380 },
    TOP: { keystone: "Deathfire Touch", items: ["Hextech Rocketbelt","Riftmaker"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 48.8, games: 613 },
  },
  Volibear: {
    TOP: { keystone: "Lethal Tempo", items: ["Dusk and Dawn","Navori Flickerblade"], boots: "Ionian Boots of Lucidity", skillOrder: ["W","Q","E"], winRate: 48, games: 1455 },
  },
  Warwick: {
    JUNGLE: { keystone: "Lethal Tempo", items: ["Stridebreaker","Blade of The Ruined King"], boots: "Plated Steelcaps", skillOrder: ["W","Q","E"], winRate: 51, games: 1995 },
    TOP: { keystone: "Lethal Tempo", items: ["Kraken Slayer","Experimental Hexplate"], boots: "Plated Steelcaps", skillOrder: ["Q","W","E"], winRate: 55.8, games: 1730 },
  },
  Xayah: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Yun Tal Wildarrows","Navori Flickerblade"], boots: "Berserker's Greaves", skillOrder: ["E","W","Q"], winRate: 52.5, games: 7183 },
  },
  Xerath: {
    BOTTOM: { keystone: "Arcane Comet", items: ["Blackfire Torch","Horizon Focus"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 51.9, games: 2770 },
    MIDDLE: { keystone: "Arcane Comet", items: ["Luden's Echo","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 50.7, games: 6163 },
    UTILITY: { keystone: "Arcane Comet", items: ["Luden's Echo","Zaz'Zak's Realmspike"], boots: "Sorcerer's Shoes", skillOrder: ["Q","W","E"], winRate: 47.8, games: 5936 },
  },
  XinZhao: {
    JUNGLE: { keystone: "Conqueror", items: ["Sundered Sky","Black Cleaver"], boots: "Plated Steelcaps", skillOrder: ["W","E","Q"], winRate: 49.1, games: 4695 },
  },
  Yasuo: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Blade of The Ruined King","Immortal Shieldbow"], boots: "Berserker's Greaves", skillOrder: ["Q","E","W"], winRate: 50.8, games: 2484 },
    MIDDLE: { keystone: "Lethal Tempo", items: ["Blade of The Ruined King","Immortal Shieldbow"], boots: "Berserker's Greaves", skillOrder: ["Q","E","W"], winRate: 49.1, games: 8546 },
    TOP: { keystone: "Lethal Tempo", items: ["Blade of The Ruined King","Immortal Shieldbow"], boots: "Berserker's Greaves", skillOrder: ["Q","E","W"], winRate: 50.7, games: 5337 },
  },
  Yone: {
    MIDDLE: { keystone: "Lethal Tempo", items: ["Blade of The Ruined King","Immortal Shieldbow"], boots: "Berserker's Greaves", skillOrder: ["Q","E","W"], winRate: 49.9, games: 14210 },
    TOP: { keystone: "Lethal Tempo", items: ["Blade of The Ruined King","Immortal Shieldbow"], boots: "Berserker's Greaves", skillOrder: ["Q","E","W"], winRate: 51.4, games: 25012 },
  },
  Yorick: {
    TOP: { keystone: "Grasp of the Undying", items: ["Trinity Force","Spear of Shojin"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 51.4, games: 2267 },
  },
  Yunara: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Kraken Slayer","Runaan's Hurricane"], boots: "Gluttonous Greaves", skillOrder: ["Q","W","E"], winRate: 51.7, games: 31562 },
  },
  Yuumi: {
    UTILITY: { keystone: "Summon Aery", items: ["Mikael's Blessing","Dream Maker"], boots: null, skillOrder: ["Q","E","W"], winRate: 51.3, games: 5547 },
  },
  Zaahen: {
    TOP: { keystone: "Grasp of the Undying", items: ["Trinity Force","Stridebreaker"], boots: "Plated Steelcaps", skillOrder: ["Q","E","W"], winRate: 53, games: 2209 },
  },
  Zac: {
    JUNGLE: { keystone: "Conqueror", items: ["Hextech Rocketbelt","Sunfire Aegis"], boots: "Ionian Boots of Lucidity", skillOrder: ["E","W","Q"], winRate: 53, games: 5979 },
    TOP: { keystone: "Grasp of the Undying", items: ["Sunfire Aegis","Spirit Visage"], boots: "Plated Steelcaps", skillOrder: ["W","E","Q"], winRate: 51.8, games: 940 },
  },
  Zed: {
    JUNGLE: { keystone: "First Strike", items: ["Voltaic Cyclosword","Bastionbreaker"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 48.5, games: 4236 },
    MIDDLE: { keystone: "First Strike", items: ["Voltaic Cyclosword","Bastionbreaker"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 53.2, games: 10393 },
  },
  Zeri: {
    BOTTOM: { keystone: "Lethal Tempo", items: ["Yun Tal Wildarrows","Runaan's Hurricane"], boots: "Berserker's Greaves", skillOrder: ["Q","E","W"], winRate: 53.3, games: 11551 },
  },
  Ziggs: {
    BOTTOM: { keystone: "Arcane Comet", items: ["Luden's Echo","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 49.9, games: 3149 },
  },
  Zilean: {
    UTILITY: { keystone: "Summon Aery", items: ["Shurelya's Battlesong","Solstice Sleigh"], boots: "Ionian Boots of Lucidity", skillOrder: ["Q","E","W"], winRate: 51.5, games: 2268 },
  },
  Zoe: {
    MIDDLE: { keystone: "Electrocute", items: ["Luden's Echo","Lich Bane"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 52.2, games: 7353 },
    UTILITY: { keystone: "Electrocute", items: ["Luden's Echo","Zaz'Zak's Realmspike"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 49.9, games: 698 },
  },
  Zyra: {
    JUNGLE: { keystone: "Electrocute", items: ["Liandry's Torment","Shadowflame"], boots: "Sorcerer's Shoes", skillOrder: ["Q","E","W"], winRate: 53.8, games: 4760 },
    UTILITY: { keystone: "Arcane Comet", items: ["Liandry's Torment","Zaz'Zak's Realmspike"], boots: "Sorcerer's Shoes", skillOrder: ["E","Q","W"], winRate: 52.4, games: 2240 },
  },
};
