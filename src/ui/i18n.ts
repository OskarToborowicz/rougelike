/**
 * Localisation.
 *
 * One flat dictionary per language, keyed by dotted strings. `t()` is read at the
 * moment a string is *shown*, never cached — static tables (boons, hammers,
 * classes, upgrades) expose their text through getters so switching language
 * mid-run re-reads everything on the next frame instead of needing a reload.
 *
 * English is the source of truth: a key missing from another language falls back
 * to English rather than showing the raw key.
 */

export type Lang = 'en' | 'pl';

export const LANGS: Lang[] = ['en', 'pl'];

/** What the language picker shows for each option. */
export const LANG_LABEL: Record<Lang, string> = {
  en: 'English',
  pl: 'Polski',
};

type Vars = Record<string, string | number>;

const EN = {
  // ------------------------------------------------------------- menu
  'menu.sub.title': 'a co-op descent · up to four shades',
  'menu.play': 'PLAY',
  'menu.shore': 'THE SHORE · {obols} ◆',
  'menu.options': 'OPTIONS',
  'menu.controls': 'CONTROLS',
  'menu.sub.setup': 'choose your shade',
  'menu.field.name': 'name',
  'menu.field.relay': 'relay',
  'menu.field.code': 'code',
  'menu.code.placeholder': 'CODE',
  'menu.playSolo': 'PLAY SOLO',
  'menu.host': 'HOST ONLINE',
  'menu.join': 'JOIN WITH CODE',
  'menu.back': 'BACK',
  'menu.online': 'online',
  'menu.needCode': 'Enter the four-letter code from your host.',
  'menu.defaultName': 'Shade',
  'menu.descend': 'DESCEND',

  // ----------------------------------------------------------- shrine
  'shrine.sub': 'the shore',
  'shrine.won': 'THE DESCENT ENDS',
  'shrine.died': 'YOU HAVE DIED',
  'shrine.depth': 'Chamber reached',
  'shrine.kills': 'Foes felled',
  'shrine.earned': 'Obols earned',
  'shrine.purse': '{obols} ◆  ·  deepest {deepest}  ·  {runs} runs',
  'shrine.max': 'MAX',
  'shrine.again': 'DESCEND AGAIN',

  // ---------------------------------------------------------- options
  'options.sub': 'options',
  'options.sound': 'Sound',
  'options.music': 'Music',
  'options.damageNumbers': 'Damage numbers',
  'options.shadows': 'Shadows',
  'options.quality': 'Quality',
  'options.quality.low': 'LOW',
  'options.quality.medium': 'MEDIUM',
  'options.quality.high': 'HIGH',
  'options.shake': 'Screen shake',
  'options.zoom': 'Camera distance',
  'options.language': 'Language',
  'options.reset': 'RESET TO DEFAULTS',
  'options.on': 'ON',
  'options.off': 'OFF',

  // --------------------------------------------------------- controls
  'controls.sub': 'controls',
  'controls.move': 'Move',
  'controls.move.how': 'W A S D  ·  left stick',
  'controls.aim': 'Aim',
  'controls.aim.how': 'Mouse  ·  right stick',
  'controls.attack': 'Attack',
  'controls.attack.how': 'Left mouse  ·  A',
  'controls.special': 'Special',
  'controls.special.how': 'Right mouse  ·  X',
  'controls.cast': 'Cast',
  'controls.cast.how': 'Q  ·  Y',
  'controls.call': 'Call',
  'controls.call.how': 'F  ·  RB — when the gauge is full',
  'controls.dash': 'Dash',
  'controls.dash.how': 'Space  ·  B',
  'controls.pause': 'Pause',
  'controls.pause.how': 'Escape  ·  Start',
  'controls.touch': 'Touch',
  'controls.touch.how':
    'Left thumb moves · right thumb aims and fires · buttons bottom-right',
  'controls.p2': 'Player two',
  'controls.p2.how': 'Connect a second gamepad — joins instantly',

  // ------------------------------------------------------------ pause
  'pause.sub': 'paused',
  'pause.resume': 'RESUME',
  'pause.abandon': 'ABANDON RUN',

  // ------------------------------------------------------------- room
  'room.sub.host': 'share this code',
  'room.sub.guest': 'joined room',
  'room.copy': 'click to copy',
  'room.waiting': 'waiting for the host to begin…',
  'room.slot.open': 'open',

  // ------------------------------------------------------------- net
  'net.connecting': 'connecting…',
  'net.waitingHost': 'connected — waiting for the host',
  'net.full': 'that room is full — four shades is the limit',
  'net.lostHost': 'lost the host — the run is over',

  // ----------------------------------------------------------- banners
  'banner.joins': '{name} joins',
  'banner.playerTwo': 'Player Two',
  'banner.vitality': 'Vitality',
  'banner.cleared': 'Chamber Cleared',
  'banner.choosePath': 'Choose Your Path',
  'banner.died': 'You Have Died',
  'banner.chamber': 'Chamber {n}',

  // --------------------------------------------------------------- hud
  'hud.hint':
    'WASD move · LMB attack · RMB special · Q cast · F call · SPACE dash · pad 2 joins as player two',
  'hud.room': '{region} · Chamber {n}',
  'hud.downed': 'DOWNED — {pct}%  (stand close to revive)',
  'hud.press': 'press {n}',
  'hud.boss': 'BOSS',
  'hud.chooseDoor': 'Choose a door',
  'hud.seat': 'P{n} · {cls}',

  // -------------------------------------------------------- wave label
  'wave.cleared': 'CLEARED',
  'wave.boss': 'BOSS',
  'wave.n': 'Wave {i} / {n}',

  // -------------------------------------------------------- card rounds
  'round.hammer': 'HAMMER',
  'round.empower': 'EMPOWER',
  'round.sub.boon': 'A boon for {seat}',
  'round.sub.hammer': 'A weapon upgrade for {seat}',
  'round.sub.pom': 'Strengthen a boon of {seat}',

  // ------------------------------------------------------------- rooms
  'rooms.combat': 'CHAMBER',
  'rooms.elite': 'ELITE',
  'rooms.horde': 'HORDE',
  'rooms.boss': 'BOSS',

  // ----------------------------------------------------------- rewards
  'reward.boon': 'BOON OF {god}',
  'reward.pom': 'EMPOWER A BOON',
  'reward.vitality': 'VITALITY',
  'reward.hammer': 'WEAPON HAMMER',

  // -------------------------------------------------------------- gods
  'god.Aphrodite': 'Aphrodite',
  'god.Ares': 'Ares',
  'god.Zeus': 'Zeus',
  'god.Poseidon': 'Poseidon',
  'god.Artemis': 'Artemis',
  /** The god's name as it reads after "boon of" — English needs no change. */
  'god.of.Aphrodite': 'APHRODITE',
  'god.of.Ares': 'ARES',
  'god.of.Zeus': 'ZEUS',
  'god.of.Poseidon': 'POSEIDON',
  'god.of.Artemis': 'ARTEMIS',

  // ------------------------------------------------------------ biomes
  'biome.tartarus': 'TARTARUS',
  'biome.asphodel': 'ASPHODEL',
  'biome.elysium': 'ELYSIUM',

  // ------------------------------------------------------------ bosses
  'boss.erinys': 'ERINYS · SCOURGE OF TARTARUS',
  'boss.hydra': 'BONE HYDRA · JAWS OF ASPHODEL',
  'boss.champion': 'CHAMPIONS OF ELYSIUM',

  // ----------------------------------------------------------- classes
  'class.warrior.name': 'WARRIOR',
  'class.warrior.title': 'Ares-sworn',
  'class.warrior.blurb':
    'Blade and dash. Toughest of the three, and the only one who heals by closing in.',
  'class.archer.name': 'MARKSMAN',
  'class.archer.title': 'Artemis-sworn',
  'class.archer.blurb':
    'Crossbow bolts that punch through a line. Fragile and fastest on foot, but every shot costs a reload.',
  'class.mage.name': 'MAGE',
  'class.mage.title': 'Zeus-sworn',
  'class.mage.blurb':
    'Slow, heavy orbs that burst on impact. Weakest body, largest hits.',

  // ------------------------------------------------------------- boons
  'boon.zeus-attack.name': 'Lightning Strike',
  'boon.zeus-attack.desc':
    'Your Attack deals +40% damage and Shocks: a jolt arcs to nearby foes.',
  'boon.poseidon-dash.name': 'Tidal Dash',
  'boon.poseidon-dash.desc':
    'Your Dash damages and knocks back foes you pass through.',
  'boon.artemis-crit.name': "Hunter's Mark",
  'boon.artemis-crit.desc': '+15% critical chance on everything.',
  'boon.ares-special.name': 'Slicing Shot',
  'boon.ares-special.desc':
    'Your Special deals +55% damage and inflicts Doom: it detonates a beat later.',
  'boon.aphro-cast.name': 'Crush Shot',
  'boon.aphro-cast.desc':
    'Your Cast deals +60% damage and makes foes Weak: they hit for 40% less.',
  'boon.zeus-passive.name': 'Storm Sandals',
  'boon.zeus-passive.desc': '+12% movement speed.',
  'boon.ares-life.name': 'Blood Frenzy',
  'boon.ares-life.desc': 'Heal 4% of damage you deal.',
  'boon.artemis-ammo.name': 'Deadly Volley',
  'boon.artemis-ammo.desc': '+2 Cast ammo.',

  // ----------------------------------------------------------- hammers
  'hammer.slot.ATTACK': 'ATTACK',
  'hammer.slot.SPECIAL': 'SPECIAL',
  'hammer.slot.CAST': 'CAST',
  'hammer.heavy-strike.name': 'Heavy Strike',
  'hammer.heavy-strike.desc': 'Your Attack deals +30% damage and reaches 20% further.',
  'hammer.swift-strike.name': 'Swift Strike',
  'hammer.swift-strike.desc': 'Your Attack winds up and recovers 30% faster.',
  'hammer.relentless.name': 'Relentless Edge',
  'hammer.relentless.desc': 'Your Attack deals +15% damage and heals 3% of it back.',
  'hammer.twin-special.name': 'Twin Strike',
  'hammer.twin-special.desc': 'Your Special fires a second time, a beat later.',
  'hammer.brutal-special.name': 'Brutal Special',
  'hammer.brutal-special.desc': 'Your Special deals +70% damage.',
  'hammer.piercing-cast.name': 'Piercing Cast',
  'hammer.piercing-cast.desc': 'Your Cast punches through 3 more foes.',
  'hammer.shattering-cast.name': 'Shattering Cast',
  'hammer.shattering-cast.desc':
    'Your Cast bursts on impact, damaging everything nearby.',
  'hammer.twin-cast.name': 'Double Charge',
  'hammer.twin-cast.desc': '+2 Cast ammo and +35% Cast damage.',

  // ---------------------------------------------------------- upgrades
  'meta.vigour.name': 'Vigour',
  'meta.vigour.desc': '+{n} maximum health.',
  'meta.edge.name': 'Whetted Edge',
  'meta.edge.desc': '+{n}% damage with everything.',
  'meta.swiftness.name': 'Swiftness',
  'meta.swiftness.desc': '+{n}% movement speed.',
  'meta.reserve.name': 'Deep Reserve',
  'meta.reserve.desc': '+{n} Cast ammo.',
  'meta.fortune.name': "Charon's Favour",
  'meta.fortune.desc': '+{n}% obols earned.',
  'meta.zeal.name': 'Zeal',
  'meta.zeal.desc': 'Begin each run with the Call gauge {n}% full.',
  'meta.hunter.name': "Hunter's Eye",
  'meta.hunter.desc': '+{n}% critical chance.',
  'meta.secondwind.name': 'Second Wind',
  'meta.secondwind.desc': 'Once per run, survive a killing blow at 35% health.',

  // ------------------------------------------------------ touch buttons
  'touch.dash': 'DASH',
  'touch.special': 'SPEC',
  'touch.cast': 'CAST',
  'touch.call': 'CALL',

  // ------------------------------------------------------------- title
  'page.title': 'STYX — co-op descent',
};

export type Key = keyof typeof EN;

const PL: Partial<Record<Key, string>> = {
  // ------------------------------------------------------------- menu
  'menu.sub.title': 'kooperacyjne zejście · do czterech cieni',
  'menu.play': 'GRAJ',
  'menu.shore': 'BRZEG · {obols} ◆',
  'menu.options': 'OPCJE',
  'menu.controls': 'STEROWANIE',
  'menu.sub.setup': 'wybierz swój cień',
  'menu.field.name': 'imię',
  'menu.field.relay': 'serwer',
  'menu.field.code': 'kod',
  'menu.code.placeholder': 'KOD',
  'menu.playSolo': 'GRAJ SOLO',
  'menu.host': 'ZAŁÓŻ GRĘ',
  'menu.join': 'DOŁĄCZ KODEM',
  'menu.back': 'WSTECZ',
  'menu.online': 'sieć',
  'menu.needCode': 'Wpisz czteroliterowy kod od gospodarza.',
  'menu.defaultName': 'Cień',
  'menu.descend': 'ZEJDŹ',

  // ----------------------------------------------------------- shrine
  'shrine.sub': 'brzeg',
  'shrine.won': 'ZEJŚCIE DOBIEGA KOŃCA',
  'shrine.died': 'ŚMIERĆ',
  'shrine.depth': 'Osiągnięta komnata',
  'shrine.kills': 'Pokonani wrogowie',
  'shrine.earned': 'Zdobyte obole',
  'shrine.purse': '{obols} ◆  ·  najgłębiej {deepest}  ·  prób: {runs}',
  'shrine.max': 'MAKS',
  'shrine.again': 'ZEJDŹ ZNÓW',

  // ---------------------------------------------------------- options
  'options.sub': 'opcje',
  'options.sound': 'Dźwięk',
  'options.music': 'Muzyka',
  'options.damageNumbers': 'Liczby obrażeń',
  'options.shadows': 'Cienie',
  'options.quality': 'Jakość',
  'options.quality.low': 'NISKA',
  'options.quality.medium': 'ŚREDNIA',
  'options.quality.high': 'WYSOKA',
  'options.shake': 'Wstrząsy ekranu',
  'options.zoom': 'Odległość kamery',
  'options.language': 'Język',
  'options.reset': 'PRZYWRÓĆ DOMYŚLNE',
  'options.on': 'WŁ',
  'options.off': 'WYŁ',

  // --------------------------------------------------------- controls
  'controls.sub': 'sterowanie',
  'controls.move': 'Ruch',
  'controls.move.how': 'W A S D  ·  lewa gałka',
  'controls.aim': 'Celowanie',
  'controls.aim.how': 'Mysz  ·  prawa gałka',
  'controls.attack': 'Atak',
  'controls.attack.how': 'Lewy przycisk myszy  ·  A',
  'controls.special': 'Specjał',
  'controls.special.how': 'Prawy przycisk myszy  ·  X',
  'controls.cast': 'Czar',
  'controls.cast.how': 'Q  ·  Y',
  'controls.call': 'Zew',
  'controls.call.how': 'F  ·  RB — gdy wskaźnik jest pełny',
  'controls.dash': 'Unik',
  'controls.dash.how': 'Spacja  ·  B',
  'controls.pause': 'Pauza',
  'controls.pause.how': 'Escape  ·  Start',
  'controls.touch': 'Dotyk',
  'controls.touch.how':
    'Lewy kciuk porusza · prawy celuje i strzela · przyciski w prawym dolnym rogu',
  'controls.p2': 'Drugi gracz',
  'controls.p2.how': 'Podłącz drugi pad — dołącza natychmiast',

  // ------------------------------------------------------------ pause
  'pause.sub': 'pauza',
  'pause.resume': 'WRÓĆ DO GRY',
  'pause.abandon': 'PORZUĆ PRÓBĘ',

  // ------------------------------------------------------------- room
  'room.sub.host': 'udostępnij ten kod',
  'room.sub.guest': 'dołączono do pokoju',
  'room.copy': 'kliknij, aby skopiować',
  'room.waiting': 'czekanie, aż gospodarz zacznie…',
  'room.slot.open': 'wolne',

  // ------------------------------------------------------------- net
  'net.connecting': 'łączenie…',
  'net.waitingHost': 'połączono — czekanie na gospodarza',
  'net.full': 'ten pokój jest pełny — limit to cztery cienie',
  'net.lostHost': 'utracono gospodarza — próba zakończona',

  // ----------------------------------------------------------- banners
  'banner.joins': '{name} dołącza',
  'banner.playerTwo': 'Drugi gracz',
  'banner.vitality': 'Witalność',
  'banner.cleared': 'Komnata oczyszczona',
  'banner.choosePath': 'Wybierz drogę',
  'banner.died': 'Śmierć',
  'banner.chamber': 'Komnata {n}',

  // --------------------------------------------------------------- hud
  'hud.hint':
    'WASD ruch · LPM atak · PPM specjał · Q czar · F zew · SPACJA unik · pad 2 dołącza jako drugi gracz',
  'hud.room': '{region} · Komnata {n}',
  'hud.downed': 'POWALONY — {pct}%  (podejdź, by wskrzesić)',
  'hud.press': 'wciśnij {n}',
  'hud.boss': 'BOSS',
  'hud.chooseDoor': 'Wybierz drzwi',

  // -------------------------------------------------------- wave label
  'wave.cleared': 'OCZYSZCZONO',
  'wave.n': 'Fala {i} / {n}',

  // -------------------------------------------------------- card rounds
  'round.hammer': 'MŁOT',
  'round.empower': 'WZMOCNIENIE',
  'round.sub.boon': 'Dar dla {seat}',
  'round.sub.hammer': 'Ulepszenie broni dla {seat}',
  'round.sub.pom': 'Wzmocnij dar gracza {seat}',

  // ------------------------------------------------------------- rooms
  'rooms.combat': 'KOMNATA',
  'rooms.elite': 'ELITA',
  'rooms.horde': 'HORDA',

  // ----------------------------------------------------------- rewards
  'reward.boon': 'DAR {god}',
  'reward.pom': 'WZMOCNIJ DAR',
  'reward.vitality': 'WITALNOŚĆ',
  'reward.hammer': 'MŁOT BRONI',

  // -------------------------------------------------------------- gods
  'god.Aphrodite': 'Afrodyta',
  'god.Ares': 'Ares',
  'god.Poseidon': 'Posejdon',
  'god.Artemis': 'Artemida',
  // Dopełniacz — "DAR AFRODYTY".
  'god.of.Aphrodite': 'AFRODYTY',
  'god.of.Ares': 'ARESA',
  'god.of.Zeus': 'ZEUSA',
  'god.of.Poseidon': 'POSEJDONA',
  'god.of.Artemis': 'ARTEMIDY',

  // ------------------------------------------------------------ biomes
  'biome.tartarus': 'TARTAR',
  'biome.asphodel': 'ASFODEL',
  'biome.elysium': 'ELIZJUM',

  // ------------------------------------------------------------ bosses
  'boss.erinys': 'ERYNIA · BICZ TARTARU',
  'boss.hydra': 'KOŚCIANA HYDRA · PASZCZE ASFODELU',
  'boss.champion': 'CZEMPIONI ELIZJUM',

  // ----------------------------------------------------------- classes
  'class.warrior.name': 'WOJOWNIK',
  'class.warrior.title': 'Zaprzysiężony Aresowi',
  'class.warrior.blurb':
    'Ostrze i unik. Najwytrzymalszy z trójki i jedyny, który leczy się, wchodząc w zwarcie.',
  'class.archer.name': 'STRZELEC',
  'class.archer.title': 'Zaprzysiężony Artemidzie',
  'class.archer.blurb':
    'Bełty kuszy przebijające całą linię wrogów. Kruchy i najszybszy, ale każdy strzał kosztuje przeładowanie.',
  'class.mage.name': 'MAG',
  'class.mage.title': 'Zaprzysiężony Zeusowi',
  'class.mage.blurb':
    'Powolne, ciężkie kule wybuchające przy trafieniu. Najsłabsze ciało, największe ciosy.',

  // ------------------------------------------------------------- boons
  'boon.zeus-attack.name': 'Uderzenie Pioruna',
  'boon.zeus-attack.desc':
    'Twój Atak zadaje +40% obrażeń i Poraża: wyładowanie przeskakuje na pobliskich wrogów.',
  'boon.poseidon-dash.name': 'Przypływowy Unik',
  'boon.poseidon-dash.desc':
    'Twój Unik rani i odrzuca wrogów, przez których przebiegasz.',
  'boon.artemis-crit.name': 'Znak Łowczyni',
  'boon.artemis-crit.desc': '+15% szansy na trafienie krytyczne każdym atakiem.',
  'boon.ares-special.name': 'Tnący Strzał',
  'boon.ares-special.desc':
    'Twój Specjał zadaje +55% obrażeń i nakłada Zgubę: detonuje się chwilę później.',
  'boon.aphro-cast.name': 'Miażdżący Strzał',
  'boon.aphro-cast.desc':
    'Twój Czar zadaje +60% obrażeń i Osłabia wrogów: biją o 40% słabiej.',
  'boon.zeus-passive.name': 'Sandały Burzy',
  'boon.zeus-passive.desc': '+12% szybkości ruchu.',
  'boon.ares-life.name': 'Krwawy Szał',
  'boon.ares-life.desc': 'Leczysz 4% zadanych obrażeń.',
  'boon.artemis-ammo.name': 'Zabójcza Salwa',
  'boon.artemis-ammo.desc': '+2 ładunki Czaru.',

  // ----------------------------------------------------------- hammers
  'hammer.slot.ATTACK': 'ATAK',
  'hammer.slot.SPECIAL': 'SPECJAŁ',
  'hammer.slot.CAST': 'CZAR',
  'hammer.heavy-strike.name': 'Ciężki Cios',
  'hammer.heavy-strike.desc': 'Twój Atak zadaje +30% obrażeń i sięga o 20% dalej.',
  'hammer.swift-strike.name': 'Chyży Cios',
  'hammer.swift-strike.desc': 'Twój Atak zamachuje się i kończy o 30% szybciej.',
  'hammer.relentless.name': 'Nieustępliwe Ostrze',
  'hammer.relentless.desc': 'Twój Atak zadaje +15% obrażeń i leczy 3% z nich.',
  'hammer.twin-special.name': 'Bliźniaczy Cios',
  'hammer.twin-special.desc': 'Twój Specjał uderza po raz drugi, chwilę później.',
  'hammer.brutal-special.name': 'Brutalny Specjał',
  'hammer.brutal-special.desc': 'Twój Specjał zadaje +70% obrażeń.',
  'hammer.piercing-cast.name': 'Przebijający Czar',
  'hammer.piercing-cast.desc': 'Twój Czar przebija 3 wrogów więcej.',
  'hammer.shattering-cast.name': 'Druzgocący Czar',
  'hammer.shattering-cast.desc':
    'Twój Czar wybucha przy trafieniu, raniąc wszystko wokół.',
  'hammer.twin-cast.name': 'Podwójny Ładunek',
  'hammer.twin-cast.desc': '+2 ładunki Czaru i +35% obrażeń Czaru.',

  // ---------------------------------------------------------- upgrades
  'meta.vigour.name': 'Wigor',
  'meta.vigour.desc': '+{n} maksymalnego zdrowia.',
  'meta.edge.name': 'Naostrzone Ostrze',
  'meta.edge.desc': '+{n}% obrażeń ze wszystkiego.',
  'meta.swiftness.name': 'Rączość',
  'meta.swiftness.desc': '+{n}% szybkości ruchu.',
  'meta.reserve.name': 'Głęboka Rezerwa',
  // Phrased around the number rather than after it: Polish would need three
  // different forms of "ładunek" for +1, +2 and +5.
  'meta.reserve.desc': 'Ładunki Czaru: +{n}.',
  'meta.fortune.name': 'Łaska Charona',
  'meta.fortune.desc': '+{n}% zdobywanych oboli.',
  'meta.zeal.name': 'Zapał',
  'meta.zeal.desc': 'Zaczynaj każdą próbę ze wskaźnikiem Zewu pełnym w {n}%.',
  'meta.hunter.name': 'Oko Łowcy',
  'meta.hunter.desc': '+{n}% szansy na trafienie krytyczne.',
  'meta.secondwind.name': 'Drugi Oddech',
  'meta.secondwind.desc':
    'Raz na próbę przeżywasz śmiertelny cios z 35% zdrowia.',

  // ------------------------------------------------------ touch buttons
  'touch.dash': 'UNIK',
  'touch.special': 'SPEC',
  'touch.cast': 'CZAR',
  'touch.call': 'ZEW',

  // ------------------------------------------------------------- title
  'page.title': 'STYX — kooperacyjne zejście',
};

const DICTS: Record<Lang, Partial<Record<Key, string>>> = { en: EN, pl: PL };

/** Anything not obviously Polish gets English. */
function detect(): Lang {
  const tags = navigator.languages?.length
    ? navigator.languages
    : [navigator.language ?? 'en'];
  return tags.some((l) => l.toLowerCase().startsWith('pl')) ? 'pl' : 'en';
}

const KEY = 'styx.lang';

function load(): Lang {
  try {
    const stored = localStorage.getItem(KEY) as Lang | null;
    if (stored && LANGS.includes(stored)) return stored;
  } catch {
    /* private mode; fall through to detection */
  }
  return detect();
}

let current: Lang = load();
document.documentElement.lang = current;

export const language = () => current;

const listeners = new Set<() => void>();

/**
 * Anything that renders once and then sits on screen — the HUD's hint line, a
 * seat's name — has to be told. Screens that rebuild on every visit do not.
 */
export function onLanguageChange(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setLanguage(lang: Lang) {
  if (lang === current) return;
  current = lang;
  document.documentElement.lang = lang;
  document.title = t('page.title');
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* private mode; the choice just will not be remembered */
  }
  for (const cb of listeners) cb();
}

/** `{name}` placeholders are filled from `vars`. */
export function t(key: Key, vars?: Vars): string {
  const raw = DICTS[current][key] ?? EN[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  );
}

document.title = t('page.title');
