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
| `make test` | 261 assertions sur la logique et sur l'interface, exécutées dans le JavaScriptCore d'Apple. |
| `make verify` | Compare le code aux fichiers réels : entrées du précache, icônes du manifeste, imports, identifiants du DOM, barre de symboles, variables de viewport partagées entre le JS et le CSS. |
| `make cache-version` | Recalcule `CACHE_VERSION` dans `sw.js` d'après l'empreinte des fichiers précachés. |

Le harnais a deux extensions qui méritent d'être connues, parce qu'elles
rendent testable ce qui ne l'était pas :

- **`setTimeout` et `flushTimers()`.** Jsc n'a pas de boucle d'événements. Le
  focus reporté d'un tick — dont dépend l'ouverture du clavier sur iOS — était
  donc injouable, et le test aurait dû contourner le code testé pour passer.
- **`visualViewport` pilotable.** `setKeyboard`, `hideKeyboard` et `scrollTo`
  rejouent l'ouverture du clavier et le défilement du document. La hauteur et
  le décalage y sont **indépendants**, comme en réel : iOS peut lever le clavier
  sans faire défiler. Les relier l'un à l'autre — ce qu'un stub trop simple
  ferait — rendrait les deux variables redondantes, et une erreur de signe
  passerait.

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

Le volume de *lecture* est une autre affaire. Le téléphone est le volume
maître, et l'application ne doit jamais obliger à le bouger : il faut **un seul
réglage « normal » qui convienne à la musique et aux effets**. Ce qui compte
entre les deux constantes n'est pas leur rapport mais l'écart de niveau
réellement produit, et il se mesure sur les fichiers — `make audio-levels`,
qui lit `MUSIC_VOLUME` et `EFFECT_VOLUME` dans `js/audio.js` au lieu de
recopier des valeurs, et signale l'écrêtage comme le creux de boucle.

La mesure a changé le diagnostic. Les sources sont **déjà à des niveaux
voisins** — le thème à −23,7 dBFS RMS, les effets à −11,3 en moyenne. Il n'y
avait donc aucune raison de les régler vingt fois différemment. Un rapport de
20 entre les constantes (0,08 contre 0,8) paraissait raisonnable et produisait
**32 dB réels** : la musique inaudible, pendant que les effets sortaient à
−1,9 dBFS de pic, presque à l'écrêtage. Il fallait alors baisser le téléphone
pour les effets et le remonter pour la musique — aucun réglage ne convenait,
ce qui est exactement le symptôme décrit.

| | avant (0,08 / 0,8) | 0,45 / 0,5 | **0,15 / 0,5** |
|---|---|---|---|
| thème, RMS lu | −45,6 dBFS | −30,6 dBFS | **−40,2 dBFS** |
| effets, RMS lu | −13,2 dBFS | −17,3 dBFS | **−17,3 dBFS** |
| effets, pic lu | −1,9 dBFS | −6,0 dBFS | **−6,0 dBFS** |
| écart musique / effets | 32,3 dB (inutilisable) | 13,3 dB | **22,8 dB** |
| verdict à l'oreille | musique absente | « encore trop fort » | à écouter |

La mesure avait changé le diagnostic, mais elle ne suffisait pas : elle
expliquait pourquoi 0,08 / 0,8 ne marchait pas, elle ne pouvait pas dire à quel
niveau écouter. C'est l'oreille qui l'a dit, deux fois, dans le même sens —
0,45 puis 0,25 étaient encore « trop fort ». Ces deux bornes valent mieux que la
plage 8–20 dB qu'on s'était fixée au passage : elle sortait d'un principe
général (séparer un fond d'une information), alors que 0,45 et 0,25 sont des
vérités d'oreille, mesurées sur ce téléphone. **0,15** en découle : la musique
passe sous le seuil d'audition courante de l'oreille et ne subsiste plus que
comme une présence de fond, ce qui est le rôle d'un thème. L'écart de 22,8 dB
sort donc de la plage qu'on s'était donnée, volontairement.

`make audio-levels` ne qualifie plus cet écart d'anormal : un outil qui
qualifie d'anormal un écart que vous avez demandé de dépasser détruit la seule
information qui compte, à quel point on est déjà trop fort. Il se contente
d'afficher la mesure.

Les effets restent à 0,5 : leur pic à −6 dBFS est sain, et l'écart qui les
séparerait de la musique est tel qu'il faudrait baisser le téléphone pour les
entendre — ce qui est la seule chose que la demande interdit.

**Si ce réglage ne convient toujours pas, la suite n'est pas un nouveau tirage
au sort** : c'est un bouton de volume dans l'application, mémorisé comme le
réglage du son. Trois essais à l'oreille suffisent à prouver qu'une constante
n'est pas la bonne façon de régler un volume que l'utilisateur entend.

Deux réserves, mesurées et non corrigées :

- **Les trois `wrong_*.wav` sont écrêtés dans la source** (quelques
  échantillons contre 32767). La distorsion est inscrite dedans : aucun gain ne
  la redressera. Baisser le gain évite l'écrêtage *supplémentaire* à la
  lecture, rien de plus. Le fichier est celui de l'app Android, que ce dépôt ne
  modifie pas.
- **Le thème se termine par un fondu de 4,5 s, sans fondu de tête.** En
  boucle, le fond disparaît 4 s toutes les 104 s. L'oreille le perçoit comme un
  son irrégulier plutôt qu'une coupure, ce qui est exactement le genre de
  défaut qu'elle remarque sans pouvoir le nommer. Le corriger suppose de
  rogner la queue dans le `.m4a`, donc de refaire un fichier de 820 Ko : on
  vous le fera faire exprès, parce que le README le demande.

---

## Le clavier virtuel

« Le clavier reste toujours ouvert » est la demande qui a demandé le plus de
travail, et la moins visible : rien à l'écran ne montre si elle est tenue. Les
obstacles sont propres aux mobiles, aucun n'apparaît dans le code, et aucun ne
se verrait sur un écran de bureau.

**1. iOS n'ouvre pas le clavier sur un `focus()` synchrone.** Le champ est
réactivé (`disabled = false`) puis focalisé dans la même tâche ; iOS considère
qu'aucun geste utilisateur n'a demandé le clavier et ne le lève pas. Le champ
est focusable, le curseur y va, et rien ne s'affiche. Le focus est donc reporté
d'un tick — la seule parade connue à ce refus. Un jeton (`focusSequence`)
invalide le report quand l'écran a changé entre-temps, pour ne pas lever un
clavier sur une question qui n'est plus affichée.

**2. `interactive-widget=resizes-content` ne vaut que sur Chrome.** Sur iOS, le
viewport de mise en page **ne se rétrécit pas** quand le clavier monte. Le
contenu, centré verticalement dans la hauteur *pleine* de l'écran, se retrouve
donc à mi-hauteur du clavier, qui recouvre sa moitié basse : le bouton Valider
sort de l'écran. `syncViewport()` publie `visualViewport.height` en
`--app-height`, et `.shell` se dimensionne dessus. Un repli `100dvh` subsiste,
pour le premier rendu, qui précède l'exécution du script.

**3. Le centrage rendait le débordement inatteignable.** Corriger la hauteur
suffisait sur les grands écrans, et révélait un troisième problème, mesuré :
le contenu fait **503 px** (marge et encoches 40 + 59 + 34, quatre intervalles
de 16, progression 22, type 20, énoncé 53 sur une seule ligne, champ 48, barre
104, marge 12, bouton 48). L'iPhone 15 laisse 508 px une fois le clavier
ouvert : 4 px de marge, juste. Un iPhone SE n'en laisse que 407 — **96 px de
débordement**.

Or `.screen` centrait par `justify-content: center`, qui centre *aussi* un
contenu trop grand : le haut sortait du cadre sans qu'aucun défilement n'y
mène. Le centrage passe donc par des marges automatiques sur le premier et le
dernier enfant, qui se réduisent à zéro dès que ça déborde, plus
`overflow-y: auto`. Le contenu reste alors entierement atteignable.

**Ce qu'on a délibérément refusé de faire.** Rattraper le défilement d'iOS
(`visualViewport.offsetTop`, en `position: relative`) semblait le complément
naturel de `--app-height`. C'était surtout dangereux, et le calcul le montre
en deux cas :

- quand le contenu tient, le document est plus court que le viewport de mise
  en page : il ne défile pas, `offsetTop` vaut 0, le décalage ne fait rien ;
- quand il déborde, le défilement du document est le **seul** moyen
  d'atteindre la fin — l'annuler la rendrait inatteignable, sans rien gagner
  au passage.

Le décalage n'était donc utile que lorsqu'il ne pouvait rien, et nuisible
lorsqu'il pouvait quelque chose. Un test verrouille ce refus, pour qu'on ne le
réintroduise pas en croyant bien faire.

Les trois se vérifient sans téléphone. Le stub DOM expose un `visualViewport`
pilotable (`setKeyboard`, `hideKeyboard`, `scrollTo`) et un `documentElement`
qui enregistre les variables, et `js/ui.js` s'exécute réellement dans les tests
— sinon le chemin le plus fragile de l'application resterait non testé, ce
qu'est le risque classique d'un test qui s'exécute dans le vide.

`make verify` couvre en outre ce que ces tests ne peuvent pas voir :

- les noms publiés par le JS et consommés par le CSS **se répondent**, et
  gardent une valeur de repli. Ces noms n'existent que dans ces deux fichiers :
  un renommage d'un seul côté laisserait la suite verte et la mise en page
  cassée ;
- `.screen` ne centre pas par `justify-content`, et garde ses marges
  automatiques. Aucun test ne peut détecter la différence sur un contenu trop
  grand, et c'est précisément le cas réel sur un petit écran.
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

**1. La casse compte : `Fe` et `ClO₃⁻` se tapent tels quels.**

C'est le changement le plus visible, et il va à l'opposé de ce que les natives
faisaient. Android comparait en égalité stricte (`MainActivity.kt:211`) et
iOS forçait la majuscule complète (`.textInputAutocapitalization(.characters)`,
`QuizView.swift:34`), ce qui transformait « fe » en « FE », impossible à
trouver. Une version intermédiaire rendait la casse insensible, par prudence.

Ce n'était pas la bonne solution : une formule chimique n'a qu'une seule
graphie, et accepter « clo3- » apprend une faute. Ici la casse est vérifiée
pour les symboles d'éléments et les formules d'ions. Les **noms** restent
tolérants — on demande le nom de l'ion, pas sa graphie, et taper « nitrate »
au doigt ne doit pas être puni.

La saisie devient donc exigeante, et le clavier suit :
`autocapitalize="sentences"` l'ouvre en majuscule puis le laisse retomber seul
après le premier caractère. « Fe » et « ClO » s'écrivent donc naturellement ;
les majuscules suivantes restent à la main, avec la touche Maj.

**2. Les formules d'ions tolèrent les vrais indices et exposants.**
`normalizeFormula` (`MainActivity.kt:302`) ne retirait que l'espace et `^`.
Mais les claviers de téléphone produisent volontiers `ClO₃⁻` avec de vrais
caractères Unicode, qui était refusé. Ici les indices et exposants Unicode
sont convertis en ASCII avant comparaison.

**3. Numéro atomique du krypton.** La source iOS déclare `Kr` en position 35
alors qu'il vaut 36 (le 35 est le brome, déjà déclaré). Sans effet sur le
quiz, qui n'affiche jamais le numéro, mais faux dès que la donnée fait
autorité. Corrigé dans `tools/extract-data.py`.

Trois ajustements d'ergonomie, dans le même sens :

- **Barre de symboles** quand la réponse attendue est une formule, sur deux
  rangees. Les deux premières touches sont à *mode armé* — indice et exposant,
  dessinées en `123` en petit caractères — et remplacent `^`, qui n'est pas
  atteignable au doigt :

  | Touche | Effet |
  |---|---|
  | `₁₂₃` indice | la frappe suivante produit un indice : `4` devient `₄` |
  | `¹²³` exposant | la frappe suivante produit un exposant : `2` devient `²` |
  | `+` `-` `(` `)` | insérés au curseur, `+` et `-`honorent le mode armé |
  | `0` … `9` | tapés directement, ou en indice/exposant si un mode est armé |

  Le mode tient sur un chiffre, un `+` ou un `-` — c'est ce qui permet de
  taper une charge d'affilée (exposant, `2`, `-`) — et se quitte sur tout
  autre caractère, l'espace et les parenthèses comprises. Recliquer la touche
  armée la désarme aussi. Une touche armée reste allumée, faute de quoi on ne
  sait plus dans quel registre on tape après avoir levé le doigt.

  Les chiffres et les signes de la barre passent par la *même* traduction que
  la frappe clavier, sinon `+` et `-` seraient sourds au mode alors qu'ils
  servent presque toujours à écrire la charge. Avec la rangée de chiffres, une
  formule se compose entièrement au doigt, sans clavier du tout — c'est le
  trajet que couvrent les tests de bout en bout.

  Ces touches insèrent de l'Unicode et non de l'ASCII : avec `^` retiré du
  doigt, il faut un signe qui distingue la charge du corps de la formule. Un
  `⁻` en exposant ne peut être que la charge, là où `SO42-` se lirait
  « SO(quarante-deux) ». C'est aussi la forme qu'affichait déjà
  l'application, et celle que produisent les claviers de téléphone : les
  trois voies convergent, donc une formule se tape indifféremment aux trois.

  La rangée de dix chiffres ne peut pas tenir les 44 px de large recommandés
  par Apple sur un écran étroit. On garde les 48 px de haut et on réduit la
  police ; le clavier système reste là pour la saisie fine.

- **Valider reste inactif tant que le champ est vide**, comme sur iOS. Sur
  Android, valider vide consommait un point.

- **Plus de touche « clavier », et le clavier reste toujours ouvert.** Sa
  fonction était de fermer le clavier virtuel pour accéder à la barre et au
  bouton Valider, et d'empêcher qu'il se rouvre tout seul. iOS et Android
  savent déjà le fermer d'un geste, et laisser le champ reprendre le focus à
  chaque question est plus régulier : l'enchaînement ne dépend plus d'un
  état qu'on ne voit pas, et le défilement ne saute plus d'une question à
  l'autre.

  Rester ouvert se heurte à deux obstacles propres aux mobiles, tous deux
  traités, et tous deux vérifiables sans téléphone — voir
  [Le clavier virtuel](#le-clavier-virtuel) plus bas.

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

Ce que le simuleur de `visualViewport` **ne** couvre pas, et qu'il faut donc
regarder sur l'appareil : le comportement réel d'iOS — le refus de lever le
clavier sur un `focus()` différé d'un tick, et la valeur exacte de
`offsetTop` pendant le défilement. Le simulateur garantit que le code mesure,
réagit et publie correctement ; il ne peut pas garantir que le système
d'exploitation se comporte comme le suppose le commentaire. C'est la limite
qui reste, et elle ne se lève qu'avec un téléphone.

`tools/check-js.py` est un analyseur lexical, pas un parseur. Il distingue
regex et division par heuristique sur le caractère précédent : il peut se
tromper sur du JavaScript exotique, ce qui n'apparaît pas ici.

`tools/tests/dom-stub.js` déclare les touches de la barre de symboles à la
main : c'est un miroir maintenance de `index.html`, donc une source de dérive.
`tools/verify.py` compare les deux listes — contenu **et** ordre — et échoue si
elles divergent, pour que les tests ne puissent pas passer sur une barre qui
n'existe pas à l'écran.

Et `tools/verify.py` couvre les deux autres contrats qu'aucun test JS ne peut
voir, parce qu'ils sont écrits dans un autre langage :

- `--app-height` est un nom partagé entre `js/ui.js` et `css/style.css`, et
  aucun test ne le voit. `make verify` vérifie qu'il est publié d'un côté,
  consommé de l'autre, et qu'il garde une valeur de repli — sans quoi la page
  vaudrait zéro pixel de haut pendant le premier rendu.
- `.screen` ne centre pas par `justify-content` et garde ses marges
  automatiques. Les deux centrent ; un seul rend le débordement atteignable.

