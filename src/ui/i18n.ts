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
  // -------------------------------------------------------------------- menu
  brand: 'ECUMENE',
  'menu.sub.title': 'the last council of the dead',
  'menu.kicker': 'the seven thrones stand empty',
  'menu.tagline': 'four shades · one descent',
  'menu.pantheons': 'seven pantheons · one table',
  'menu.play': 'DESCEND',
  'menu.shore': 'THE RELIQUARY',
  'menu.options': 'RITES',
  'menu.controls': 'THE CANON',
  'menu.sub.setup': 'choose your shade',
  'menu.field.name': 'name',
  'menu.field.relay': 'relay',
  'menu.field.code': 'code',
  'menu.code.placeholder': 'CODE',
  'menu.playSolo': 'DESCEND ALONE',
  'menu.host': 'OPEN A WAY',
  'menu.join': 'JOIN WITH CODE',
  'menu.back': 'BACK',
  // Not translated in any language: the word players already use for this.
  'menu.online': 'Co-op',
  'menu.needCode': 'Enter the four-letter code from your host.',
  'menu.defaultName': 'Shade',
  'menu.descend': 'DESCEND',

  // ---------------------------------------------------------------- reliquary
  'shrine.sub': 'the reliquary',
  'shrine.won': 'THE DESCENT ENDS',
  'shrine.died': 'YOU HAVE DIED',
  'shrine.depth': 'Chamber reached',
  'shrine.kills': 'Foes felled',
  'shrine.earned': 'Obols earned',
  'shrine.purse': '{obols} ◆  ·  deepest {deepest}  ·  {runs} runs',
  'shrine.max': 'MAX',
  'shrine.again': 'DESCEND AGAIN',

  // -------------------------------------------------------------------- rites
  'options.sub': 'rites',
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

  // ---------------------------------------------------------------- the canon
  'controls.sub': 'the canon',
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
  'controls.concord': 'Concord',
  'controls.concord.how': 'F, held with an ally whose gauge is also full',
  'controls.dash': 'Dash',
  'controls.dash.how': 'Space  ·  B',
  'controls.pause': 'Pause',
  'controls.pause.how': 'Escape  ·  Start',
  'controls.touch': 'Touch',
  'controls.touch.how':
    'Left thumb moves · right thumb aims and fires · buttons bottom-right',
  'controls.p2': 'Player two',
  'controls.p2.how': 'Connect a second gamepad — joins instantly',

  // -------------------------------------------------------------------- pause
  'pause.sub': 'paused',
  'pause.resume': 'RESUME',
  'pause.abandon': 'ABANDON RUN',

  // --------------------------------------------------------------------- room
  'room.sub.host': 'share this code',
  'room.sub.guest': 'joined room',
  'room.copy': 'click to copy',
  'room.waiting': 'waiting for the host to begin…',
  'room.slot.open': 'open',

  // ---------------------------------------------------------------------- net
  'net.connecting': 'connecting…',
  'net.waitingHost': 'connected — waiting for the host',
  'net.full': 'that room is full — four shades is the limit',
  'net.lostHost': 'lost the host — the run is over',

  // ------------------------------------------------------------------ banners
  'banner.joins': '{name} joins',
  'banner.playerTwo': 'Player Two',
  'banner.vitality': 'Vitality',
  'banner.cleared': 'Chamber Cleared',
  'banner.choosePath': 'Choose Your Path',
  'banner.died': 'You Have Died',
  'banner.chamber': 'Chamber {n}',
  'banner.concord': 'CONCORD',

  // ---------------------------------------------------------------------- hud
  'hud.hint':
    'WASD move · LMB attack · RMB special · Q cast · F call · SPACE dash · pad 2 joins as player two',
  'hud.room': '{region} · {n}',
  'hud.downed': 'the seal breaks',
  'hud.downedPct': '{pct}%',
  'hud.press': 'press {n}',
  'hud.boss': 'BOSS',
  'hud.chooseDoor': 'Choose a door',
  'hud.seat': 'P{n} · {cls}',
  'hud.sworn': '{cls} · sworn to {pantheon}',
  'hud.unsworn': '{cls} · unsworn',
  'hud.cast': 'cast',
  'hud.concord': 'CONCORD — HOLD F TOGETHER',

  // ------------------------------------------------------------- wave label
  'wave.cleared': 'CLEARED',
  'wave.boss': 'BOSS',
  'wave.n': 'Wave {i} / {n}',

  // ------------------------------------------------------------- card rounds
  'round.hammer': 'HAMMER',
  'round.empower': 'EMPOWER',
  'round.sub.boon': 'a boon for {seat}',
  'round.sub.hammer': 'a weapon upgrade for {seat}',
  'round.sub.pom': 'strengthen a boon of {seat}',
  'round.answersOver': '{god} answers over him',
  'round.spurned': '{pantheon} will not offer again this descent.',
  'round.choosing': '{name} is choosing',
  'round.chosen': '{name} has chosen',

  // -------------------------------------------------------------------- rooms
  'rooms.combat': 'CHAMBER',
  'rooms.elite': 'ELITE',
  'rooms.horde': 'HORDE',
  'rooms.boss': 'BOSS',

  // ------------------------------------------------------------------ rewards
  'reward.boon': 'BOON OF {pantheon}',
  'reward.pom': 'EMPOWER A BOON',
  'reward.vitality': 'VITALITY',
  'reward.hammer': 'WEAPON HAMMER',

  // --------------------------------------------------------- the seven thrones
  'pantheon.hellenic': 'hellenic',
  'pantheon.aesir': 'aesir',
  'pantheon.netjer': 'netjer',
  'pantheon.anunna': 'anunna',
  'pantheon.choir': 'the choir',
  'pantheon.legion': 'the legion',
  'pantheon.rodnova': 'rodnova',
  'pantheon.throne': '{name} · {n} throne',
  'throne.hellenic': 'first',
  'throne.aesir': 'second',
  'throne.netjer': 'third',
  'throne.anunna': 'fourth',
  'throne.choir': 'fifth',
  'throne.legion': 'sixth',
  'throne.rodnova': 'seventh',

  // -------------------------------------------------------------------- gods
  'god.zeus.name': 'ZEUS',
  'god.zeus.epithet': 'who answers thunder with thunder',
  'god.zeus.quote':
    '“You want the storm. Nobody has ever wanted what comes after it.”',
  'god.athena.name': 'ATHENA',
  'god.athena.epithet': 'who has never drawn first and has never lost',
  'god.athena.quote':
    '“I will not make you stronger. I will make you correct, which is worse for them.”',
  'god.odin.name': 'ODIN',
  'god.odin.epithet': 'who gave an eye to see one thing clearly',
  'god.odin.quote':
    '“I know how this ends. Take it anyway — knowing has never once helped.”',
  'god.skadi.name': 'SKADI',
  'god.skadi.epithet': 'who hunts the winter down',
  'god.skadi.quote':
    '“Cold is not cruelty. Cold is patience that stopped pretending.”',
  'god.loki.name': 'LOKI',
  'god.loki.epithet': 'who is owed a favour by everyone at this table',
  'god.loki.quote':
    '“Take it. I want to see what you do with it far more than I want you to win.”',
  'god.anubis.name': 'ANUBIS',
  'god.anubis.epithet': 'who weighs the heart against a feather',
  'god.anubis.quote':
    '“Yours is heavy. I am not telling you that to shame you.”',
  'god.sekhmet.name': 'SEKHMET',
  'god.sekhmet.epithet': 'whose mercy was an afterthought',
  'god.sekhmet.quote':
    '“They made me to end a plague. I found I preferred the work.”',
  'god.inanna.name': 'INANNA',
  'god.inanna.epithet': 'who went down and came back changed',
  'god.inanna.quote':
    '“I have stood where you are standing. I left something at every gate.”',
  'god.nergal.name': 'NERGAL',
  'god.nergal.epithet': 'who is the fever and the field it empties',
  'god.nergal.quote': '“Burn it. What grows back will be yours and not theirs.”',
  'god.michael.name': 'MICHAEL',
  'god.michael.epithet': 'who holds the scales and does not look at them',
  'god.michael.quote':
    '“I have weighed better than you and let them fall. Take the sword or take the mercy — you will not be offered both again.”',
  'god.belial.name': 'BELIAL',
  'god.belial.epithet': 'who is owed, and always collects',
  'god.belial.quote':
    '“He offered you a fair price. I am offering you the real one.”',
  'god.lilith.name': 'LILITH',
  'god.lilith.epithet': 'who left, and was called a monster for it',
  'god.lilith.quote':
    '“They will say you were given this. Let them. You and I know better.”',
  'god.morana.name': 'MORANA',
  'god.morana.epithet': 'who ends the year so it can begin',
  'god.morana.quote':
    '“I am not the end of you. I am only the winter you have to walk through.”',

  // ------------------------------------------------------------------- boons
  'boon.hel-attack.name': 'Lightning Strike',
  'boon.hel-attack.desc':
    'Your Attack deals +40% damage and Shocks: a jolt arcs to nearby foes.',
  'boon.hel-cast.name': 'Thunderhead',
  'boon.hel-cast.desc': 'Your Cast deals +55% damage and Shocks what it lands on.',
  'boon.hel-crit.name': 'Aegis-Eye',
  'boon.hel-crit.desc': '+15% critical chance with every attack.',
  'boon.hel-dash.name': 'Stormstep',
  'boon.hel-dash.desc': 'Your Dash damages and shoves aside foes you pass through.',
  'boon.aes-attack.name': 'Frostbite',
  'boon.aes-attack.desc':
    'Your Attack deals +35% damage and makes foes Weak: they hit for 40% less.',
  'boon.aes-special.name': 'Hammerfall',
  'boon.aes-special.desc':
    'Your Special deals +60% damage and leaves what survives it Weak.',
  'boon.aes-dash.name': 'Riding the Gale',
  'boon.aes-dash.desc': 'Your Dash damages and throws back everything it touches.',
  'boon.aes-move.name': 'Wind-Shod',
  'boon.aes-move.desc': '+14% movement speed.',
  'boon.net-cast.name': 'Weighing of the Heart',
  'boon.net-cast.desc':
    'Your Cast deals +60% damage and inflicts Doom: it detonates a beat later.',
  'boon.net-attack.name': "Devourer's Teeth",
  'boon.net-attack.desc': 'Your Attack deals +30% damage and inflicts Doom.',
  'boon.net-life.name': 'Ka Restored',
  'boon.net-life.desc': 'Heal 5% of the damage you deal.',
  'boon.net-ammo.name': 'Canopic Reserve',
  'boon.net-ammo.desc': '+2 Cast ammo.',
  'boon.anu-attack.name': 'Brand of the Descent',
  'boon.anu-attack.desc':
    'Your Attack deals +35% damage and sets what it strikes alight.',
  'boon.anu-special.name': 'Scorched Field',
  'boon.anu-special.desc':
    'Your Special deals +55% damage and sets everything it catches alight.',
  'boon.anu-fever.name': 'Fever',
  'boon.anu-fever.desc': '+10% damage with everything you have.',
  'boon.anu-cast.name': 'Furnace Bolt',
  'boon.anu-cast.desc': 'Your Cast deals +25% damage and bursts on impact.',
  'boon.cho-sword.name': 'Flaming Sword',
  'boon.cho-sword.desc':
    'Your Attack sets what it strikes alight. Burning foes take damage a beat at a time and light the ones they touch.',
  'boon.cho-scales.name': 'The Scales',
  'boon.cho-scales.desc':
    'Damage you take above a quarter of your health is halved — and the other half is dealt to whatever struck you.',
  'boon.cho-song.name': 'Choirsong',
  'boon.cho-song.desc': '+8% critical chance and +6% movement speed.',
  'boon.cho-cast.name': 'Annunciation',
  'boon.cho-cast.desc': 'Your Cast punches through 3 more foes.',
  'boon.leg-special.name': 'Slicing Shot',
  'boon.leg-special.desc':
    'Your Special deals +55% damage and inflicts Doom: it detonates a beat later.',
  'boon.leg-fallen.name': 'Worth More Fallen',
  'boon.leg-fallen.desc': 'Every ally who is down makes you 25% stronger.',
  'boon.leg-life.name': 'Blood Frenzy',
  'boon.leg-life.desc': 'Heal 4% of the damage you deal.',
  'boon.leg-attack.name': "Butcher's Rhythm",
  'boon.leg-attack.desc': 'Your Attack winds up and recovers 30% faster.',
  'boon.rod-move.name': 'Thunderstep',
  'boon.rod-move.desc': '+14% movement speed.',
  'boon.rod-ammo.name': 'Deadly Volley',
  'boon.rod-ammo.desc': '+2 Cast ammo.',
  'boon.rod-special.name': 'Twin Strike',
  'boon.rod-special.desc': 'Your Special fires a second time, a beat later.',
  'boon.rod-attack.name': 'Oakheart',
  'boon.rod-attack.desc': 'Your Attack deals +25% damage and reaches 20% further.',

  // ------------------------------------------------------------------ biomes
  'biome.tartarus': 'TARTARUS',
  'biome.asphodel': 'ASPHODEL',
  'biome.elysium': 'ELYSIUM',

  // ------------------------------------------------------------------ bosses
  'boss.erinys': 'ERINYS · SCOURGE OF TARTARUS',
  'boss.hydra': 'BONE HYDRA · JAWS OF ASPHODEL',
  'boss.champion': 'CHAMPIONS OF ELYSIUM',

  // ----------------------------------------------------------------- classes
  'class.warrior.name': 'WARRIOR',
  'class.warrior.title': 'blade-sworn',
  'class.warrior.blurb':
    'Blade and dash. Toughest of the three, and the only one who heals by closing in.',
  'class.archer.name': 'MARKSMAN',
  'class.archer.title': 'bolt-sworn',
  'class.archer.blurb':
    'Crossbow bolts that punch through a line. Fragile and fastest on foot, but every shot costs a reload.',
  'class.mage.name': 'MAGE',
  'class.mage.title': 'storm-sworn',
  'class.mage.blurb':
    'Slow, heavy orbs that burst on impact. Weakest body, largest hits.',

  // ----------------------------------------------------------------- hammers
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

  // ---------------------------------------------------------------- upgrades
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

  // ----------------------------------------------------------- touch buttons
  'touch.dash': 'DASH',
  'touch.special': 'SPEC',
  'touch.cast': 'CAST',
  'touch.call': 'CALL',

  // ------------------------------------------------------------------- title
  'page.title': 'ECUMENE — the last council of the dead',
};

export type Key = keyof typeof EN;

const PL: Partial<Record<Key, string>> = {
  // -------------------------------------------------------------------- menu
  'menu.sub.title': 'ostatnia rada umarłych',
  'menu.kicker': 'siedem tronów stoi pustych',
  'menu.tagline': 'cztery cienie · jedno zejście',
  'menu.pantheons': 'siedem panteonów · jeden stół',
  'menu.play': 'ZEJDŹ',
  'menu.shore': 'RELIKWIARZ',
  'menu.options': 'RYTY',
  'menu.controls': 'KANON',
  'menu.sub.setup': 'wybierz swój cień',
  'menu.field.name': 'imię',
  'menu.field.relay': 'serwer',
  'menu.field.code': 'kod',
  'menu.code.placeholder': 'KOD',
  'menu.playSolo': 'ZEJDŹ SAMOTNIE',
  'menu.host': 'OTWÓRZ PRZEJŚCIE',
  'menu.join': 'DOŁĄCZ KODEM',
  'menu.back': 'WSTECZ',
  'menu.online': 'Co-op',
  'menu.needCode': 'Wpisz czteroliterowy kod od gospodarza.',
  'menu.defaultName': 'Cień',
  'menu.descend': 'ZEJDŹ',

  // ---------------------------------------------------------------- reliquary
  'shrine.sub': 'relikwiarz',
  'shrine.won': 'ZEJŚCIE DOBIEGA KOŃCA',
  'shrine.died': 'ŚMIERĆ',
  'shrine.depth': 'Osiągnięta komnata',
  'shrine.kills': 'Pokonani wrogowie',
  'shrine.earned': 'Zdobyte obole',
  'shrine.purse': '{obols} ◆  ·  najgłębiej {deepest}  ·  prób: {runs}',
  'shrine.max': 'MAKS',
  'shrine.again': 'ZEJDŹ ZNÓW',

  // -------------------------------------------------------------------- ryty
  'options.sub': 'ryty',
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

  // ------------------------------------------------------------------- kanon
  'controls.sub': 'kanon',
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
  'controls.concord': 'Zgoda',
  'controls.concord.how': 'F, trzymane razem z sojusznikiem o pełnym wskaźniku',
  'controls.dash': 'Unik',
  'controls.dash.how': 'Spacja  ·  B',
  'controls.pause': 'Pauza',
  'controls.pause.how': 'Escape  ·  Start',
  'controls.touch': 'Dotyk',
  'controls.touch.how':
    'Lewy kciuk porusza · prawy celuje i strzela · przyciski w prawym dolnym rogu',
  'controls.p2': 'Drugi gracz',
  'controls.p2.how': 'Podłącz drugi pad — dołącza natychmiast',

  // -------------------------------------------------------------------- pauza
  'pause.sub': 'pauza',
  'pause.resume': 'WRÓĆ DO GRY',
  'pause.abandon': 'PORZUĆ PRÓBĘ',

  // -------------------------------------------------------------------- pokój
  'room.sub.host': 'udostępnij ten kod',
  'room.sub.guest': 'dołączono do pokoju',
  'room.copy': 'kliknij, aby skopiować',
  'room.waiting': 'czekanie, aż gospodarz zacznie…',
  'room.slot.open': 'wolne',

  // ---------------------------------------------------------------------- sieć
  'net.connecting': 'łączenie…',
  'net.waitingHost': 'połączono — czekanie na gospodarza',
  'net.full': 'ten pokój jest pełny — limit to cztery cienie',
  'net.lostHost': 'utracono gospodarza — próba zakończona',

  // ------------------------------------------------------------------ banery
  'banner.joins': '{name} dołącza',
  'banner.playerTwo': 'Drugi gracz',
  'banner.vitality': 'Witalność',
  'banner.cleared': 'Komnata oczyszczona',
  'banner.choosePath': 'Wybierz drogę',
  'banner.died': 'Śmierć',
  'banner.chamber': 'Komnata {n}',
  'banner.concord': 'ZGODA',

  // ---------------------------------------------------------------------- hud
  'hud.hint':
    'WASD ruch · LPM atak · PPM specjał · Q czar · F zew · SPACJA unik · pad 2 dołącza jako drugi gracz',
  'hud.room': '{region} · {n}',
  'hud.downed': 'pieczęć pęka',
  'hud.press': 'wciśnij {n}',
  'hud.boss': 'BOSS',
  'hud.chooseDoor': 'Wybierz drzwi',
  'hud.sworn': '{cls} · zaprzysiężony: {pantheon}',
  'hud.unsworn': '{cls} · niezaprzysiężony',
  'hud.cast': 'czar',
  'hud.concord': 'ZGODA — TRZYMAJCIE F RAZEM',

  // ------------------------------------------------------------------- fale
  'wave.cleared': 'OCZYSZCZONO',
  'wave.n': 'Fala {i} / {n}',

  // ------------------------------------------------------------------ oferta
  'round.hammer': 'MŁOT',
  'round.empower': 'WZMOCNIENIE',
  'round.sub.boon': 'dar dla {seat}',
  'round.sub.hammer': 'ulepszenie broni dla {seat}',
  'round.sub.pom': 'wzmocnij dar gracza {seat}',
  'round.answersOver': '{god} odpowiada ponad nim',
  'round.spurned': '{pantheon} nie złoży już oferty w tym zejściu.',
  'round.choosing': '{name} wybiera',
  'round.chosen': '{name} wybrał',

  // ------------------------------------------------------------------ komnaty
  'rooms.combat': 'KOMNATA',
  'rooms.elite': 'ELITA',
  'rooms.horde': 'HORDA',

  // ------------------------------------------------------------------ nagrody
  'reward.boon': 'DAR · {pantheon}',
  'reward.pom': 'WZMOCNIJ DAR',
  'reward.vitality': 'WITALNOŚĆ',
  'reward.hammer': 'MŁOT BRONI',

  // ---------------------------------------------------------- siedem tronów
  'pantheon.hellenic': 'hellenowie',
  'pantheon.aesir': 'asowie',
  'pantheon.netjer': 'neczer',
  'pantheon.anunna': 'anunnaki',
  'pantheon.choir': 'chór',
  'pantheon.legion': 'legion',
  'pantheon.rodnova': 'rodnowie',
  'pantheon.throne': '{name} · {n} tron',
  'throne.hellenic': 'pierwszy',
  'throne.aesir': 'drugi',
  'throne.netjer': 'trzeci',
  'throne.anunna': 'czwarty',
  'throne.choir': 'piąty',
  'throne.legion': 'szósty',
  'throne.rodnova': 'siódmy',

  // ----------------------------------------------------------------- bogowie
  'god.zeus.name': 'ZEUS',
  'god.zeus.epithet': 'ten, który odpowiada gromem na grom',
  'god.zeus.quote':
    '„Chcesz burzy. Nikt nigdy nie chciał tego, co przychodzi po niej.”',
  'god.athena.name': 'ATENA',
  'god.athena.epithet': 'ta, która nigdy nie uderza pierwsza i nigdy nie przegrywa',
  'god.athena.quote':
    '„Nie uczynię cię silniejszym. Uczynię cię słusznym, co dla nich jest gorsze.”',
  'god.odin.name': 'ODYN',
  'god.odin.epithet': 'ten, który oddał oko, by zobaczyć jedno wyraźnie',
  'god.odin.quote':
    '„Wiem, jak to się skończy. Bierz mimo to — wiedza jeszcze nikomu nie pomogła.”',
  'god.skadi.name': 'SKADI',
  'god.skadi.epithet': 'ta, która tropi zimę aż do końca',
  'god.skadi.quote':
    '„Chłód to nie okrucieństwo. Chłód to cierpliwość, która przestała udawać.”',
  'god.loki.name': 'LOKI',
  'god.loki.epithet': 'ten, któremu każdy przy tym stole jest coś winien',
  'god.loki.quote':
    '„Bierz. Znacznie bardziej chcę zobaczyć, co z tym zrobisz, niż żebyś wygrał.”',
  'god.anubis.name': 'ANUBIS',
  'god.anubis.epithet': 'ten, który waży serce naprzeciw pióru',
  'god.anubis.quote': '„Twoje jest ciężkie. Nie mówię tego, by cię zawstydzić.”',
  'god.sekhmet.name': 'SECHMET',
  'god.sekhmet.epithet': 'ta, której litość była dopiero drugą myślą',
  'god.sekhmet.quote':
    '„Stworzono mnie, by zakończyć zarazę. Okazało się, że wolę samą pracę.”',
  'god.inanna.name': 'INANNA',
  'god.inanna.epithet': 'ta, która zeszła i wróciła odmieniona',
  'god.inanna.quote':
    '„Stałam tam, gdzie ty teraz stoisz. Przy każdej bramie coś zostawiłam.”',
  'god.nergal.name': 'NERGAL',
  'god.nergal.epithet': 'ten, który jest gorączką i polem, które opróżnia',
  'god.nergal.quote': '„Spal to. Co odrośnie, będzie twoje, a nie ich.”',
  'god.michael.name': 'MICHAŁ',
  'god.michael.epithet': 'ten, który trzyma wagę i na nią nie patrzy',
  'god.michael.quote':
    '„Ważyłem lepszych od ciebie i pozwoliłem im upaść. Weź miecz albo weź litość — drugi raz nie dostaniesz obu.”',
  'god.belial.name': 'BELIAL',
  'god.belial.epithet': 'ten, któremu się należy i który zawsze ściąga dług',
  'god.belial.quote':
    '„On zaproponował ci uczciwą cenę. Ja proponuję prawdziwą.”',
  'god.lilith.name': 'LILITH',
  'god.lilith.epithet': 'ta, która odeszła i nazwano ją za to potworem',
  'god.lilith.quote':
    '„Powiedzą, że ci to dano. Niech mówią. Ty i ja wiemy lepiej.”',
  'god.morana.name': 'MARZANNA',
  'god.morana.epithet': 'ta, która kończy rok, by mógł się zacząć',
  'god.morana.quote':
    '„Nie jestem twoim końcem. Jestem tylko zimą, przez którą musisz przejść.”',

  // -------------------------------------------------------------------- dary
  'boon.hel-attack.name': 'Uderzenie Pioruna',
  'boon.hel-attack.desc':
    'Twój Atak zadaje +40% obrażeń i Poraża: wyładowanie przeskakuje na pobliskich wrogów.',
  'boon.hel-cast.name': 'Czoło Burzy',
  'boon.hel-cast.desc': 'Twój Czar zadaje +55% obrażeń i Poraża trafionego.',
  'boon.hel-crit.name': 'Oko Egidy',
  'boon.hel-crit.desc': '+15% szansy na trafienie krytyczne każdym atakiem.',
  'boon.hel-dash.name': 'Krok Burzy',
  'boon.hel-dash.desc': 'Twój Unik rani i rozrzuca wrogów, przez których przebiegasz.',
  'boon.aes-attack.name': 'Odmrożenie',
  'boon.aes-attack.desc':
    'Twój Atak zadaje +35% obrażeń i Osłabia wrogów: biją o 40% słabiej.',
  'boon.aes-special.name': 'Spadający Młot',
  'boon.aes-special.desc':
    'Twój Specjał zadaje +60% obrażeń, a to, co przetrwa, zostaje Osłabione.',
  'boon.aes-dash.name': 'Na Wichrze',
  'boon.aes-dash.desc': 'Twój Unik rani i odrzuca wszystko, czego dotknie.',
  'boon.aes-move.name': 'Wiatrem Obuty',
  'boon.aes-move.desc': '+14% szybkości ruchu.',
  'boon.net-cast.name': 'Ważenie Serca',
  'boon.net-cast.desc':
    'Twój Czar zadaje +60% obrażeń i nakłada Zgubę: detonuje się chwilę później.',
  'boon.net-attack.name': 'Zęby Pożeraczki',
  'boon.net-attack.desc': 'Twój Atak zadaje +30% obrażeń i nakłada Zgubę.',
  'boon.net-life.name': 'Przywrócone Ka',
  'boon.net-life.desc': 'Leczysz 5% zadanych obrażeń.',
  'boon.net-ammo.name': 'Zapas Kanopski',
  'boon.net-ammo.desc': '+2 ładunki Czaru.',
  'boon.anu-attack.name': 'Piętno Zejścia',
  'boon.anu-attack.desc': 'Twój Atak zadaje +35% obrażeń i podpala trafionego.',
  'boon.anu-special.name': 'Spalone Pole',
  'boon.anu-special.desc':
    'Twój Specjał zadaje +55% obrażeń i podpala wszystko, co obejmie.',
  'boon.anu-fever.name': 'Gorączka',
  'boon.anu-fever.desc': '+10% obrażeń ze wszystkiego, co masz.',
  'boon.anu-cast.name': 'Bełt z Pieca',
  'boon.anu-cast.desc': 'Twój Czar zadaje +25% obrażeń i wybucha przy trafieniu.',
  'boon.cho-sword.name': 'Płonący Miecz',
  'boon.cho-sword.desc':
    'Twój Atak podpala trafionego. Płonący wróg traci zdrowie takt po takcie i podpala tych, których dotknie.',
  'boon.cho-scales.name': 'Waga',
  'boon.cho-scales.desc':
    'Obrażenia większe niż ćwierć twojego zdrowia są o połowę mniejsze — a ta połowa wraca do tego, kto cię uderzył.',
  'boon.cho-song.name': 'Pieśń Chóru',
  'boon.cho-song.desc': '+8% szansy na trafienie krytyczne i +6% szybkości ruchu.',
  'boon.cho-cast.name': 'Zwiastowanie',
  'boon.cho-cast.desc': 'Twój Czar przebija 3 wrogów więcej.',
  'boon.leg-special.name': 'Tnący Strzał',
  'boon.leg-special.desc':
    'Twój Specjał zadaje +55% obrażeń i nakłada Zgubę: detonuje się chwilę później.',
  'boon.leg-fallen.name': 'Wart Więcej Poległy',
  'boon.leg-fallen.desc': 'Każdy powalony sojusznik czyni cię o 25% silniejszym.',
  'boon.leg-life.name': 'Krwawy Szał',
  'boon.leg-life.desc': 'Leczysz 4% zadanych obrażeń.',
  'boon.leg-attack.name': 'Rytm Rzeźnika',
  'boon.leg-attack.desc': 'Twój Atak zamachuje się i kończy o 30% szybciej.',
  'boon.rod-move.name': 'Krok Gromu',
  'boon.rod-move.desc': '+14% szybkości ruchu.',
  'boon.rod-ammo.name': 'Zabójcza Salwa',
  'boon.rod-ammo.desc': '+2 ładunki Czaru.',
  'boon.rod-special.name': 'Bliźniaczy Cios',
  'boon.rod-special.desc': 'Twój Specjał uderza po raz drugi, chwilę później.',
  'boon.rod-attack.name': 'Dębowe Serce',
  'boon.rod-attack.desc': 'Twój Atak zadaje +25% obrażeń i sięga o 20% dalej.',

  // ------------------------------------------------------------------ krainy
  'biome.tartarus': 'TARTAR',
  'biome.asphodel': 'ASFODEL',
  'biome.elysium': 'ELIZJUM',

  // ------------------------------------------------------------------ bossowie
  'boss.erinys': 'ERYNIA · BICZ TARTARU',
  'boss.hydra': 'KOŚCIANA HYDRA · PASZCZE ASFODELU',
  'boss.champion': 'CZEMPIONI ELIZJUM',

  // ------------------------------------------------------------------- klasy
  'class.warrior.name': 'WOJOWNIK',
  'class.warrior.title': 'zaprzysiężony ostrzu',
  'class.warrior.blurb':
    'Ostrze i unik. Najwytrzymalszy z trójki i jedyny, który leczy się, wchodząc w zwarcie.',
  'class.archer.name': 'STRZELEC',
  'class.archer.title': 'zaprzysiężony bełtowi',
  'class.archer.blurb':
    'Bełty kuszy przebijające całą linię wrogów. Kruchy i najszybszy, ale każdy strzał kosztuje przeładowanie.',
  'class.mage.name': 'MAG',
  'class.mage.title': 'zaprzysiężony burzy',
  'class.mage.blurb':
    'Powolne, ciężkie kule wybuchające przy trafieniu. Najsłabsze ciało, największe ciosy.',

  // ------------------------------------------------------------------- młoty
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

  // -------------------------------------------------------------- ulepszenia
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
  'meta.secondwind.desc': 'Raz na próbę przeżywasz śmiertelny cios z 35% zdrowia.',

  // --------------------------------------------------------- przyciski dotyku
  'touch.dash': 'UNIK',
  'touch.special': 'SPEC',
  'touch.cast': 'CZAR',
  'touch.call': 'ZEW',

  // ------------------------------------------------------------------- tytuł
  'page.title': 'ECUMENE — ostatnia rada umarłych',
};

const DICTS: Record<Lang, Partial<Record<Key, string>>> = { en: EN, pl: PL };

/** Anything not obviously Polish gets English. */
function detect(): Lang {
  const tags = navigator.languages?.length
    ? navigator.languages
    : [navigator.language ?? 'en'];
  return tags.some((l) => l.toLowerCase().startsWith('pl')) ? 'pl' : 'en';
}

// The save keys stay on the `styx.` prefix through the rename: they are storage,
// not copy, and changing them would silently orphan every existing reliquary.
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

/**
 * Roman numerals, for chamber numbers on the HUD banner. The design writes them
 * out — "CAMERA VII" — and a run never reaches a depth where this gets silly.
 */
const ROMAN: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function roman(n: number): string {
  let left = Math.max(0, Math.floor(n));
  let out = '';
  for (const [value, sign] of ROMAN) {
    while (left >= value) {
      out += sign;
      left -= value;
    }
  }
  return out || '—';
}

document.title = t('page.title');
