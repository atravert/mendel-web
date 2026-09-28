// Son: musique de fond et effets de reponse.
//
// Deux APIs, volontairement. La musique passe par un <audio>: c'est un
// fichier de 2,1 Mo, autant le laisser streamer plutot que de le decoder en
// entier. Les effets, eux, passent par la Web Audio API: ils sont courts
// (~30 Ko) et doivent sortir sans la moindre latence, ce que SoundPool
// d'Android et AVAudioPlayer d'iOS font nativement et que le Web Audio fait
// igualement en rejouant un AudioBuffer deja en memoire.
//
// Contrainte des navigateurs: aucun son ne peut demarrer sans geste
// utilisateur. unlock() doit donc etre appele depuis un gestionnaire
// d'evenement, pas dans une promesse ni dans un setTimeout.

const STORAGE_KEY = 'mendel.sound';

// Niveaux de lecture. Le telephone est le volume maitre, et l'application ne
// doit jamais obliger a le bouger: un seul reglage "normal" doit convenir aux
// deux flux. Ce qui compte entre ces deux constantes n'est pas leur rapport,
// mais l'ecart de niveau REEL qu'elles produisent -- et il se mesure sur les
// fichiers, pas sur les constantes elles-memes.
//
// Mesure (`make audio-levels`): le theme est a -23,7 dBFS RMS, les effets a
// -11,3 en moyenne. Les sources sont deja a des niveaux voisins, il n'y a donc
// pas de raison de les regler tres differemment. Un rapport de 20 entre les
// constantes -- 0,08 contre 0,8 -- paraissait raisonnable et produisait 32 dB
// reels: la musique etait inaudible, tandis que les effets sortaient a -1,9
// dBFS de pic, presque a l'ecretage. Il fallait alors baisser le telephone
// pour les effets et le remonter pour la musique. Aucun reglage ne convenait.
//
// Ensuite, deux essais a l'oreille, dans l'autre sens, qui disent la meme
// chose: 0,45 puis 0,25 de musique, toujours « trop fort ». L'ecart reels passe
// de 13 a 18 dB, puis 22, et la musique domine encore. Ces deux bornes valent
// mieux que la plage 8-20 dB qu'on s'etait fixee: elle venait d'un principe
// general, alors que 0,45 et 0,25 sont des verites d'oreille, mesurees sur ce
// telephone. D'ou 0,15: la musique descend sous le seuil d'audition courante
// de l'oreille, et ne subsiste plus que comme une presence de fond -- ce qui
// est le role du theme. L'effet garde 0,5, dont le pic a -6 dBFS est sain:
// l'ecart qui le separerait de la musique est tel qu'il faudrait baisser le
// telephone pour l'entendre.
//
// Rejouer `make audio-levels` apres toute modification de ces deux nombres. Si
// ce reglage ne convient toujours pas, la suite n'est pas un nouveau tirage au
// sort: c'est un bouton de volume dans l'application.
const MUSIC_VOLUME = 0.15;
const EFFECT_VOLUME = 0.5;   // ramene les pics a -6 dBFS: plus d'ecretage a la lecture

const CORRECT_SAMPLES = ['correct_01', 'correct_02', 'correct_03'];
const WRONG_SAMPLES = ['wrong_01', 'wrong_02', 'wrong_03'];
// AAC dans un conteneur MPEG-4 plutot que MP3: tous les navigateurs cibles le
// lisent, et l'encodeur livre avec macOS suffit (pas de dependance a
// installer). Le fichier est mono 22 kHz, 820 Ko au lieu de 2,1 Mo en stereo.
// Voir tools/audio.py pour la mesure qui a justifie ces reglages.
const MUSIC_PATH = 'audio/quiz_arcade_theme.m4a';
const SFX_PATH = 'audio/';

// Comme les deux natives: jamais deux fois le meme effet d'affilee.
let lastCorrectIndex = -1;
let lastWrongIndex = -1;

let context = null;
const buffers = { correct: new Map(), wrong: new Map() };
let samplesRequested = false;

let music = null;
let musicBlocked = false;

function readPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'on';
  } catch (error) {
    // Mode navigation privee ou cookies refuses: on garde le son active.
    return true;
  }
}

function writePreference(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch (error) {
    // Sans stockage, la preference ne survivra pas a la fermeture, mais
    // l'application reste utilisable.
  }
}

let enabled = readPreference();

export function isEnabled() {
  return enabled;
}

// ---------------------------------------------------------------------------
// Reperage
// ---------------------------------------------------------------------------

function ensureContext() {
  if (context) return context;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

function decode(arrayBuffer) {
  return new Promise((resolve, reject) => {
    ensureContext().decodeAudioData(arrayBuffer, resolve, reject);
  });
}

/**
 * Telecharge et decode les six effets. Volontairement non bloquant: le quiz
 * demarre sans attendre, et un effet manquant ne casse rien.
 */
function loadSamples() {
  if (samplesRequested) return;
  samplesRequested = true;

  const all = [
    ...CORRECT_SAMPLES.map((name) => ['correct', name]),
    ...WRONG_SAMPLES.map((name) => ['wrong', name]),
  ];

  for (const [group, name] of all) {
    fetch(SFX_PATH + name + '.wav')
      .then((response) => {
        if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
        return response.arrayBuffer();
      })
      .then((buffer) => decode(buffer))
      .then((decoded) => buffers[group].set(name, decoded))
      .catch((error) => console.warn('effet indisponible', name, error));
  }
}

// ---------------------------------------------------------------------------
// Lecture des effets
// ---------------------------------------------------------------------------

function playFrom(group, names) {
  if (!enabled) return;

  const ctx = ensureContext();
  if (!ctx || ctx.state === 'suspended') return;

  // Anti-repetition, comme SoundManager.playRandom (SoundManager.kt:95) et
  // SoundManager.playRandom (SoundManager.swift:93).
  const last = group === 'correct' ? lastCorrectIndex : lastWrongIndex;
  let index = Math.floor(Math.random() * names.length);
  if (names.length > 1 && index === last) {
    index = (index + 1) % names.length;
  }

  // Un effet pas encore charge ne se joue pas: mieux vaut un silence de
  // temps en temps que de le laisser croire que le son est casse.
  const buffer = buffers[group].get(names[index]);
  if (!buffer) return;

  if (group === 'correct') lastCorrectIndex = index;
  else lastWrongIndex = index;

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = EFFECT_VOLUME;
  source.buffer = buffer;
  source.connect(gain).connect(ctx.destination);
  source.start();
}

export function playCorrect() {
  playFrom('correct', CORRECT_SAMPLES);
}

export function playWrong() {
  playFrom('wrong', WRONG_SAMPLES);
}

// ---------------------------------------------------------------------------
// Musique
// ---------------------------------------------------------------------------

function ensureMusic() {
  if (music) return music;
  music = new Audio(MUSIC_PATH);
  music.loop = true;
  music.volume = MUSIC_VOLUME;
  music.preload = 'auto';
  return music;
}

export function startMusic() {
  if (!enabled || musicBlocked) return;
  const player = ensureMusic();

  // unlock() est appele a chaque appui utilisateur: inutile de relancer une
  // musique qui tourne deja.
  if (!player.paused) return;

  // play() renvoie une promesse qui se rejette si le navigateur refuse de
  // demarrer sans geste utilisateur. On ne boucle pas les refus: unlock()
  // retentera au prochain appui.
  const attempt = player.play();
  if (attempt && typeof attempt.catch === 'function') {
    attempt
      .then(() => { musicBlocked = false; })
      .catch(() => { musicBlocked = true; });
  }
}

export function pauseMusic() {
  if (music) music.pause();
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * A appeler depuis un gestionnaire d'evenement utilisateur (pointerdown),
 * au tout premier appui: sans cela le contexte audio reste suspendu et le
 * navigateur refuse toute lecture.
 */
export function unlock() {
  const ctx = ensureContext();
  if (ctx && ctx.state === 'suspended') ctx.resume();
  loadSamples();
  musicBlocked = false;
  if (enabled) startMusic();
}

export function setEnabled(value) {
  enabled = Boolean(value);
  writePreference(enabled);
  if (enabled) {
    unlock();
  } else {
    pauseMusic();
    if (context && context.state === 'running') context.suspend();
  }
  return enabled;
}

export function toggle() {
  return setEnabled(!enabled);
}

// La musique suit la visibilite, comme onPause/onStop cote natif.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseMusic();
    else if (enabled) startMusic();
  });
}
