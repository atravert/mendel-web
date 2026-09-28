// Service worker: met l'application en cache pour qu'elle se lance sans
// reseau, une fois installee sur l'ecran d'accueil.
//
// VERSION: ne plus l'incrementer a la main. C'etait une source de bug reelle
// -- le cache est servi en priorite, donc un fichier modifie sans changer la
// version reste servi indefiniment et le correctif n'atteint jamais
// l'appareil. `tools/sync-cache-version.py` derive desormais la version de
// l'empreinte des fichiers precaches, et `make` echoue si elle n'est plus a
// jour. Changer un fichier change donc automatiquement le nom du cache, ce
// qui purge l'ancien a l'activation.
//
// PORTEE: ce fichier doit rester a la racine du site publie. Sur GitHub Pages
// un depot "mendel-web" est servi depuis /mendel-web/, donc sw.js doit y
// etre a la racine et non dans un sous-dossier.

const CACHE_VERSION = '82bc1169';

const CACHE_NAME = `mendel-${CACHE_VERSION}`;

// Chemins relatifs au lieu d'absolus: le site peut etre publie a la racine
// d'un domaine ou dans un sous-repertoire de projet.
// La musique de fond est mise en cache avec le reste: le premier lancement
// est un peu plus long, mais ensuite le quiz est completement hors-ligne, ce
// qui est le but d'une PWA installee. Elle pese 820 Ko en AAC mono 22 kHz
// contre 2,1 Mo en MP3 stereo dans l'app Android (voir tools/audio.py).
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/data.js',
  'js/quiz.js',
  'js/audio.js',
  'js/ui.js',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'audio/correct_01.wav',
  'audio/correct_02.wav',
  'audio/correct_03.wav',
  'audio/wrong_01.wav',
  'audio/wrong_02.wav',
  'audio/wrong_03.wav',
  'audio/quiz_arcade_theme.m4a',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // addAll est atomique: si un seul fichier manque, rien n'est mis en
      // cache, ce qui evite un etat a moitie installe.
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    // Cache d'abord: l'application est statique, la seule chose qui change
    // entre deux deploiements est la version du cache.
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Les reponses en erreur (404, 500) ne meritent pas d'entrer au
          // cache: on les laisse passer en echec.
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Hors-ligne et pas en cache: pour une navigation, on renvoie
          // l'ecran de depart plutot qu'une page d'erreur du navigateur.
          if (request.mode === 'navigate') return caches.match('index.html');
          return Response.error();
        });
    }),
  );
});
