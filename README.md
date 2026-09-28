# Mendel — Quiz de chimie (version web)

La version web de l'application **Quizz pour ma Zou** : 62 éléments chimiques
et 20 ions polyatomiques, en saisie libre, dans le navigateur et en PWA
installable — donc sans passer par les stores.

Aucune dépendance, aucune étape de build : du HTML, du CSS et du JavaScript
natif, servis tels quels.

---

## Lancer en local

```sh
cd mendel-web
make serve      # http://localhost:8000
```

`http://localhost` est un contexte dit « sécurisé », donc le service worker
s'y installe comme en production. C'est indispensable pour tester le
hors-ligne ; ouvrir `index.html` par `file://` ne suffit pas.

## Vérifier

```sh
make            # syntaxe + tests + cohérence des fichiers
```

Trois contrôles, tous exécutables sans rien installer :

| Commande | Ce qu'elle fait |
|---|---|
| `make syntax` | Analyse lexicale des `.js` : chaînes non fermées, commentaires infinis, regex mal fermées. Remplace `node --check`, absent de la machine. |
| `make test` | 176 assertions sur la logique et sur l'interface, exécutées dans le JavaScriptCore d'Apple. |
| `make verify` | Compare le code aux fichiers réels : entrées du précache, icônes du manifeste, imports, identifiants du DOM. |
| `make cache-version` | Recalcule `CACHE_VERSION` dans `sw.js` d'après l'empreinte des fichiers précachés. |

## Régénérer

```sh
make data       # js/data.js depuis mendel-ios/.../QuizModel.swift
make icons      # icônes PWA depuis le logo 1024 de l'app iOS
make audio      # thème compressé depuis mendel-droid/.../quiz_arcade_theme.mp3
make cache-version   # CACHE_VERSION de sw.js, dérivée du contenu précaché
```

Les sources restent dans les applications natives voisines, que ce dépôt ne
modifie pas. `mendel-web` est donc un dépôt autonome, mais `make data` et
`make audio` attendent que `mendel-ios/` et `mendel-droid/` soient présents à
ses côtés. Pour pointer ailleurs :

```sh
MENDEL_SWIFT=/chemin/vers/QuizModel.swift make data
MENDEL_THEME=/chemin/vers/quiz_arcade_theme.mp3 make audio
```

Les deux artefacts générés (`js/data.js` et `audio/quiz_arcade_theme.m4a`) sont
versionnés ici : un clone reste utilisable même sans les applications natives,
seule la régénération devient impossible.

`js/data.js` est **généré** : ne pas l'éditer à la main, corriger la source
native puis relancer `make data`. Le script applique aussi le correctif du
numéro atomique du krypton (voir plus bas).

`audio/quiz_arcade_theme.m4a` est lui aussi **généré**. Le `.mp3` de
l'app Android fait 2,1 Mo en stéréo ; `tools/audio.py` l'analyse avant de
recompresser, et trois mesures dictent les réglages :

- ses deux canaux sont **identiques au bit près** (différence mesurée : 0,0 dB).
  Le stéréo ne coûtait rien en information et deux fois le débit. Passer en
  mono est gratuit.
- il se termine par **3,8 s de silence** encodés à plein débit. Les couper ne
  coûte rien.
- au-delà de 22 kHz il ne reste rien (−98 dB). La Nyquist à 44,1 kHz
  transporte du vide.

Reste le débit, qui est le seul vrai levier sur la taille. Mesuré :

| Réglage | Taille | Corrélation | SNR |
|---|---|---|---|
| 44100 Hz / 96 kbit/s | 1,2 Mo | 0,966 | 15,6 dB |
| 32000 Hz / 64 kbit/s | 818 Ko | 0,982 | 15,5 dB |
| **22050 Hz / 64 kbit/s** | **820 Ko** | **0,995** | **22,4 dB** |
| 22050 Hz / 48 kbit/s | 622 Ko | 0,988 | 18,3 dB |

Le résultat contre-intuitif : **à taille égale, 22,05 kHz bat 44,1 kHz de
7 dB**. Le filtre anti-repli d'`afconvert` retire les aigus durs, là où le
codec gaspillait ses bits. Rééchantillonner en moins n'est donc pas un
compromis, c'est un gain.

Le résultat retenu est 2,5 fois plus léger **et** mesuré plus fidèle que
l'original. L'encodeur n'est pas déterministe — deux exécutions de
`make audio` diffèrent de 0,27 échantillon sur 32767, soit 78 dB de SNR,
cinquante-cinq fois la perte du codec elle-même. Régénérer est donc sûr, mais
le fichier n'est pas reproductible à l'octet près : ne pas s'étonner d'un
différent dans git.

Conséquence à connaître : le thème étant précaché, sa non-déterminisme se
propage dans `CACHE_VERSION`. Régénérer le thème change donc le nom du cache,
et redemande 820 Ko aux utilisateurs déjà installés. **Ne pas lancer
`make audio` au hasard** ; le faire seulement quand le thème change vraiment.

Ces chiffres viennent d'un proxy (corrélation et rapport signal/bruit en
large bande), pas d'un test d'écoute. **Le seul juge reste l'oreille**, sur
un téléphone, à 25 % du volume. `make audio-ladder` rejoue la mesure.

---

## Structure

```
mendel-web/
├── index.html              les trois écrans
├── manifest.webmanifest    installation, nom, couleur de barre
├── sw.js                   précache, cache-first, version dérivée du contenu
├── css/style.css
├── js/
│   ├── data.js             GÉNÉRÉ — éléments, ions, 79 phrases de retour
│   ├── quiz.js             génération des séries, correction, mise en forme
│   ├── audio.js            musique + effets
│   └── ui.js               collage avec le DOM
├── audio/                  6 effets .wav + le thème .m4a compressé
├── icons/
└── tools/                  scripts de vérification et de génération
```

Le découpage sépare ce qui se teste (logique pure) de ce qui ne se teste pas
aisément (le DOM). `quiz.js` ne connaît ni le DOM ni le son, ce qui permet de
le couvrir à fond.

---

## Ce qui change par rapport aux applications natives

Le comportement est celui des deux apps, à trois exceptions — toutes
corrigées ici parce qu'elles faisaient vraiment perdre des points.

**1. Le symbole d'un élément est comparé sans tenir compte de la casse.**
Android comparait en égalité stricte (`MainActivity.kt:211`) : « fe » et
« FE » étaient comptés faux. iOS aggravait le problème en forçant la
majuscule complète (`.textInputAutocapitalization(.characters)`,
`QuizView.swift:34`), ce qui transformait « fe » en « FE », impossible à
trouver. Ici la casse est ignorée.

**2. Les formules d'ions tolèrent les vrais indices et exposants.**
`normalizeFormula` (`MainActivity.kt:302`) ne retirait que l'espace et `^`.
Mais les claviers de téléphone produisent volontiers `ClO₃⁻` avec de vrais
caractères Unicode, qui était refusé. Ici les indices et exposants Unicode
sont convertis en ASCII avant comparaison, et la casse est ignorée.

**3. Numéro atomique du krypton.** La source iOS déclare `Kr` en position 35
alors qu'il vaut 36 (le 35 est le brome, déjà déclaré). Sans effet sur le
quiz, qui n'affiche jamais le numéro, mais faux dès que la donnée fait
autorité. Corrigé dans `tools/extract-data.py`.

Deux ajustements d'ergonomie, dans le même sens :

- **Barre de symboles** quand la réponse attendue est une formule : `^`, `-`,
  `+`, `(` et `)` sont absents de la plupart des claviers de téléphone.
- **Valider reste inactif tant que le champ est vide**, comme sur iOS. Sur
  Android, valider vide consommait un point.

Les formules sont affichées avec de vrais `<sub>`/`<sup>` plutôt qu'avec les
caractères Unicode de `prettyFormula` : le texte reste sélectionnable et se
copie correctement, et la mise en forme est nette.

Les 7 ions commentés dans `QuizGenerator.kt` (Hypoiodite, Periodate,
Manganate, Hydrogénocarbonate, Phosphite, Arséniate, Iodite) restent
commentés : la liste iOS, plus courte, fait référence.

---

## Déployer sur GitHub Pages

Le dépôt est autonome : il vit dans `mendel-web/`, hors des applications
natives, et celles-ci ne sont jamais publiées. Il est rattaché à
`git@github.com:atravert/mendel-web.git`.

Publier une modification revient à :

```sh
cd /Users/arnaud/src/mendel/mendel-web
make                          # vert obligatoire, et CACHE_VERSION a jour
git commit -am "..."
git push
```

GitHub Pages republie automatiquement à chaque `push` sur `main`. La première
publication demande une à deux minutes.

Le dépôt doit être **public** : GitHub Pages n'est disponible que sur les
dépôts publics avec un compte gratuit. En privé, il faut GitHub Pro.

Dans Settings → Pages → Source : *Deploy from a branch*, branche `main`,
dossier `/ (root)`. Le `.nojekyll` est déjà là, il empêche GitHub Pages de
passer le site dans Jekyll.

Le site est servi depuis **`https://atravert.github.io/mendel-web/`**. Toutes
les chemins étant relatifs et le `.nojekyll` présent, cela fonctionne sans
configuration, y compris pour la portée du service worker.

Il n'y a **rien à faire à chaque déploiement** pour purger l'ancien cache.
`CACHE_VERSION` n'est plus incrémenté à la main : `tools/sync-cache-version.py`
la dérive de l'empreinte SHA-256 des 20 fichiers précachés, et `make` échoue
si elle n'est plus à jour.

C'est une correction d'un bug réel, pas une commodité. Le service worker sert
le cache en priorité, sans revalidation réseau : un fichier modifié sans que le
nom du cache change reste servi **indéfiniment** sur l'appareil de l'utilisateur.
Cela s'est déjà produit ici — un correctif d'affichage des commentaires avait
été livré sans incrémentation de version, et il n'atteignait personne. Le
symptôme est trompeur, parce que tout le reste fonctionne et que les tests
passent.

Le seul piège qui subsiste est de modifier un fichier précaché et de pousser
sans avoir lancé `make`. Le garde-fou est là pour le transformer en échec rouge
plutôt qu'en silence.

---

## Limites connues

Aucun test ne tourne dans un vrai navigateur sur cette machine : Safari est le
seul navigateur installé et `safaridriver` exige l'activation de
l'automatisation distante dans ses réglages. `tools/tests/dom-stub.js` fournit
un DOM minimal pour couvrir la machine à états de l'interface — score,
garde-fous, navigation, barre de symboles — mais **ni la mise en page, ni le
clavier réel, ni le son, ni le service worker** ne sont vérifiés
automatiquement. Ces points sont à confirmer à la main sur un téléphone.

`tools/check-js.py` est un analyseur lexical, pas un parseur. Il distingue
regex et division par heuristique sur le caractère précédent : il peut se
tromper sur du JavaScript exotique, ce qui n'apparaît pas ici.
