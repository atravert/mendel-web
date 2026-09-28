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
make            # tout
```

| Commande | Ce qu'elle fait |
|---|---|
| `make syntax` | Analyse lexicale des `.js` : chaînes non fermées, commentaires infinis, regex mal fermées. Remplace `node --check`, absent de la machine. Recherche aussi les caractères parasites d'une autre écriture dans les commentaires. |
| `make test` | 369 assertions sur la logique et sur l'interface, exécutées dans le JavaScriptCore d'Apple. |
| `make verify` | Compare le code aux fichiers réels : entrées du précache, icônes du manifeste, imports, identifiants du DOM, barre de symboles, variables de viewport partagées entre le JS et le CSS, ancrage du centrage, marge de l'indicateur d'accueil, chemins de confirmation, placement de l'icône du son, barre d'action, mode compact. |
| `make budget` | Recalcule le budget vertical **dans le CSS** et le compare au tableau écrit en clair dans la feuille. Échoue s'ils divergent. |
| `make cache-version` | Recalcule `CACHE_VERSION` dans `sw.js` d'après l'empreinte des fichiers précachés. |
| `make mutations` | Casse le code 21 fois, une mutation à la fois, et exige que chacune soit vue. Hors de `make` : chaque mutation lance une vérification complète. |
| `make online` | Le site publié sert-il la version locale ? Demande le réseau. |

Les cinq premiers n'utilisent que `python3` et le JavaScriptCore d'Apple.
`make mutations` ne demande rien de plus, mais reste **hors de `make`** parce
qu'il transforme un contrôle habituel en quelques minutes : c'est une
vérification de la vérification, pas du code. `make online` est hors de `make`
pour une autre raison : il demande le réseau, et une vérification de code ne
doit pas en dépendre.

**`make budget` mérite sa place dans la liste.** Le tableau du budget vertical
décrit `css/style.css` au pixel près, et il vit dans un commentaire — c'est-à-dire
un endroit qu'aucun outil ne relit. L'outil le recalcule et le confronte, donc il
ne peut pas redevenir faux en silence quand une valeur change. Le détail
s'affiche avec `python3 tools/budget.py --table`.

Le harnais a deux extensions qui méritent d'être connues, parce qu'elles
rendent testable ce qui ne l'était pas :

- **`visualViewport` pilotable.** `setKeyboard`, `hideKeyboard` et `scrollTo`
  rejouent l'ouverture du clavier et le défilement du document. La hauteur et
  le décalage y sont **indépendants**, comme en réel : iOS peut lever le clavier
  sans faire défiler. Les relier l'un à l'autre — ce qu'un stub trop simple
  ferait — rendrait les deux variables redondantes, et une erreur de signe
  passerait.
- **La propagation des événements.** `fire()` remonte le long des ancêtres,
  jusqu'au `document`. Les parades anti-prise de focus sont enregistrées sur le
  conteneur et non sur chaque bouton, et le filet de la touche retour écoute
  le `document` ; sans remontée elles ne seraient jamais appelées par un test,
  et une parade vérifiée dans le vide n'est pas vérifiée. Deux assertions
  veillent à ce que le harnais voie ce que voit un navigateur.

Et une absence, qui est une décision : **le harnais n'a aucune minuterie.**
Jsc n'en fournit pas, et surtout on n'en simule pas. Un `setTimeout` dans
`js/ui.js` poserait le focus à la prochaine tâche — hors du geste
utilisateur, donc sans effet sur le clavier réel — et le test le verrait
pourtant poser. C'est exactement le défaut que la
[section clavier](#le-clavier-virtuel) combat ; une minuterie dans le harnais
le rendrait invisible. Si une devient nécessaire, elle devra d'abord être
prouvée par un test qui échoue sans elle.

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

La demande, en une phrase : **le clavier est présent dès l'ouverture de la
série, et ne bouge plus jusqu'à la fin des réponses. Le curseur est dans le
champ dès la question posée, sans que l'utilisateur touche la case.**

Un navigateur ne lève le clavier virtuel qu'en réponse à un geste
utilisateur — c'est une règle de sécurité, pas une limite d'iOS. Toute la
difficulté est là : il faut donc que chaque apparition du clavier soit
consécutive à un vrai clic, et que rien ne l'interrompe ensuite.

### Les cinq causes du clavier qui bouge

Les quatre premières sont toutes dans le chemin *valider → suivant*, et aucune
ne se voyait sans téléphone. La cinquième est ailleurs : elle est dans la mise
en page, et elle se voyait à tous les coups.

**1. Le focus était volé au champ.** `validate()` finissait par
`nextButton.focus()`. Un bouton qui prend le focus vide le champ, le clavier
se ferme, le viewport repasse de 508 à 844 px, et toute la page se recentre.
Puis Suivant le rouvre, et l'écran saute une seconde fois : **deux sautes par
question**. C'est « le clavier bouge », au sens propre.

**2. Le champ était `disabled` après la validation.** Un élément `disabled`
est infocalisable : le focus le quitte sur-le-champ, le clavier se ferme. Même
symptôme, autre cause — et elle suffisait à elle seule. `readOnly` n'est pas
un remède : il garde le focus mais fait disparaître le clavier sur iOS.

`state.answered` verrouille déjà la réponse, et `validate()` s'y arrête. Ni
`disabled` ni `readOnly` n'ont donc leur place ici.

**3. Le focus était reporté d'un tick.** C'est le correctif que j'avais
ajouté au tours précédent, et il rendait les choses **pires**. Un
`setTimeout(..., 0)` sort du geste utilisateur : le champ est bien focus, le
curseur y entre, et le clavier ne se lève pas. Le report ne contourne pas la
règle, il la viole en disparaissant.

Le focus est donc **synchrone**, dans `renderQuestion()`. Chaque entrée dans
cette fonction passe par un clic — le bouton de série, Suivant, ou Une
nouvelle série — donc toujours par un geste. `startQuiz()` est entièrement
synchrone, ce qui est la condition à ne pas casser.

**4. Les boutons de l'écran de quiz prenaient le focus.** Un `pointerdown`
annulé sur le conteneur empêche le navigateur de transférer le focus, tout en
laissant le clic avoir lieu. La parade existait déjà pour la barre de
symboles ; elle a été étendue à Valider et Suivant.

**Le seul `blur()` de l'application est en fin de série.** Partout ailleurs,
le focus ne lâche pas. À la dernière question, en revanche, il doit lâcher :
laisser le focus dans un champ devenu invisible est un état que le navigateur
interprète mal, et le clavier resterait levé par-dessus l'écran de résultat.

**5. Le contenu était centré, donc l'ouverture du clavier le déplaçait.**
L'écran de quiz se centr verticalement dans la hauteur disponible. Or cette
hauteur passe de 844 à 508 px dès que le clavier se lève : le contenu se déplace
de la moitié de la différence, soit 168 px, vers le haut. C'est le « poussage »
signalé, et il tombe au moment précis où le joueur commence à lire sa question.

Ancrer l'écran de quiz **en haut** supprime le couplage : la position ne dépend
plus de la hauteur. Changer `--app-height` ne déplace plus ni l'énoncé, ni le
bloc de saisie, ni le bouton Valider. Ils restent à la même place, du premier
geste de la série au dernier.

Il restait 34 px à unforesevoir : la marge de l'indicateur d'accueil. Elle n'est
utile que **sans** clavier — le clavier la recouvre, elle devient du vide.
`syncViewport()` la déduit de la hauteur visible et pose `data-keyboard="open"`,
ce qui remet la marge à zéro.

Le seuil de 80 px départage le clavier de la barre d'adresse d'iOS, qui
rétracte la fenêtre de 90 px sans qu'aucun clavier n'existe à l'écran.

Le prix de l'ancrage : sans clavier, le contenu occupe le haut de l'écran et le
bas reste vide. C'est acceptable parce que le clavier ouvert est l'état normal
d'une série — c'est tout l'objet de la demande — et que l'état sans clavier
n'est visible que sur les deux autres écrans, qui restent centrés.

### Le budget vertical, et pourquoi il ne tenait pas

Ce paragraphe remplace une affirmation qui était fausse, et il faut la lire
avec cette histoire en tête.

Le CSS annonçait **469 px de contenu pour 508 px disponibles sur un iPhone 15**,
donc « l'énoncé, le champ et Valider tiennent ensemble à l'écran, avec 39 px
d'air ». Les deux nombres avaient le même défaut : ils étaient **calculés**.
Aucun n'avait été mesuré sur un appareil.

Et le 469 px ne décrivait que l'état **avant** réponse. Or les deux éléments
dont la disparition a été signalée — le bandeau de commentaire et le bouton
« Question suivante » — n'existent **qu'après** réponse, et ils étaient les
deux derniers enfants du flux, donc les deux premiers à sortir.

C'est la même faute que celle déjà commise sur la touche retour : **affirmer un
nombre dérivé d'un modèle de la plateforme au lieu de l'observer.**

#### Ce que l'appareil a réellement dit

Sur la série ions, clavier ouvert, dans un **onglet** Safari :

```
Il manque 114 px : 324 px de contenu pour 210 px visibles. Défilez pour lire le retour.
```

Les 324 px se décomposent **exactement**, et chaque terme se lit tel quel dans
la feuille de style :

| Terme | px | Où il est écrit |
|---|---:|---|
| `.progress-row` | 22 | `--progress-h` |
| `.rule` | 1 | `height: 1px` |
| `.question-type` | 20 | `14px` × interligne du `body` |
| `.prompt` | 53 | `clamp(30px, 11vw, 44px)` = 44, × 1.2 |
| `.answer-input` | 48 | `--tap` |
| `.symbol-bar` | 116 | `12 + 48 + 8 + 48` |
| quatre intervalles | 64 | `--gap: 16px` × 4 |
| **total** | **324** | |

Deux conséquences, et la première était un défaut de mon propre diagnostic.

**1. C'est l'état avant réponse.** Le bandeau annonçait pourtant « Défilez pour
lire le retour » — alors qu'aucun retour n'existe encore, et que c'est le
**champ** qui déborde. Le message décrivait un autre écran que celui qu'il
mesurait. `texteDebordement()` nomme désormais l'état, et le remède change avec
lui : le retour après réponse, le champ avant, et « Refermez la barre de
symboles » quand elle est déployée.

**2. Le 210 px se lisait avec le bandeau déjà à l'écran.** Le bandeau est enfant
de la coque, comme la zone d'action : il occupe donc de la place sur *celle* de
`.screen`, et la mesure suivante le comptait en déduction. **Un diagnostic qui
s'ajoute au défaut qu'il mesure se grossit lui-même**, et rien ne le refermait.
`mesurerDebordement()` le masque maintenant **avant** toute lecture. On ne peut
plus dire combien des 114 px rapportés étaient réels : la lecture ne le
permet pas. Ce qui est sûr, c'est que **324 px de contenu ne change pas** et que
la place disponible ne se lit bien que bandeau masqué.

**La barre de symboles en prenait 116 : plus de la moitié.** Ce n'était donc pas
un problème de mise en page, c'était un problème de **contenu** — et aucun
agencement n'aurait fait tenir 324 px dans 210 px sans rendre quelque chose.

#### Le budget, calculé et non recopié

`make budget` recalcule ces hauteurs **dans `css/style.css`** et compare le
résultat au tableau écrit en clair dans le commentaire de la feuille. Il échoue
si les deux divergent. La table ci-dessous est sa sortie, pas une recopie.

Le premier chiffre est ce que l'appareil a dit, et l'outil le **retrouve seul** :

```
largeur 402 px, place visible 210 px (mesurée)

  normal / avant reponse          324 px  (5 éléments)  pour  210 px  manque 114 px
  normal / apres reponse          203 px  (4 éléments)  pour  210 px  tient (+7)
  compact / avant reponse         208 px  (4 éléments)  pour  226 px  tient (+18)
  compact / apres reponse         179 px  (4 éléments)  pour  226 px  tient (+47)
  compact / barre deployee        264 px  (4 éléments)  pour  226 px  manque 38 px
```

Deux choses dans cette table ne se déduisent pas du CSS, et sont **données en
paramètre** plutôt qu'inventées : la largeur de 402 px, parce que la taille de
l'énoncé est un `clamp(…, 11vw, 44px)` ; et les 210 px visibles, **mesurés**.
Tout le reste se lit dans la feuille — y compris le nombre de lignes du pire
commentaire, qui est le plus long des 79 de `data.js`, plié à la largeur utile.

Les intervalles se comptent entre **éléments rendus**, pas entre éléments du
balisage : un élément masqué sort du flux, et son intervalle avec. C'est la
différence entre 324 et 357, et c'est exactement le détail qui avait produit le
premier chiffre faux.

Et la place visible **n'est pas la même** dans les deux modes : les 210 px ont
été mesurés avec `--pad: 20px`, donc avec 40 px de marge de coque ; en mode
compact il n'y en a plus que 24, et la même zone visible en rend 16 de plus.
Comparer le contenu compact aux 210 px d'origine afficherait un déficit de 2 px
là où il n'y en a pas — et un déficit de 2 px est le genre de chiffre qui envoie
chercher un arrondi inexistant pendant une heure.

### Quand il n'y a pas assez de place

Quatre correctifs, dans cet ordre. Le premier est un gain, les deux suivants
sont structurels, et le dernier est une simple mesure.

**P1 — Le bouton Valider disparaît au lieu de se griser.** Il passait
`disabled` et **restait en place** : 48 px du budget vertical pour une action
morte, à l'endroit exact où la place manquait. Deux boutons à l'écran pour une
seule action utile, c'est aussi déroutant. Les deux occupaient la même barre,
donc en masquer un revient à zéro.

`disabled` reste posé : c'est le verrou réel, et il doit tenir même si quelque
chose réapparaît le bouton par erreur. Masquer ne remplace pas verrouiller,
c'est l'inverse.

**P2 — Le commentaire reprend la place de l'énoncé.** L'énoncé est devenu
redondant une fois qu'on y a répondu, et c'est le commentaire qui a de la
valeur. L'énoncé et le type de question s'effacent (`html[data-answered='1']`,
posé par `validate()` et retiré par `renderQuestion()`), et le commentaire les
remplace **à leur place** : il est placé juste avant le formulaire dans
`index.html`, donc quand l'énoncé sort du flux, le commentaire est déjà dans le
sien. Pas au-dessus, pas en dessous — **à la place**.

Ce n'est pas qu'une optimisation. Placé plus bas, le commentaire s'empilait
sous le formulaire : il poussait la zone d'action hors de l'écran, et
l'utilisateur ne pouvait pas le lire sans défiler. Il masquait deux choses au
lieu d'une. Son rendu est un peu plus long que l'énoncé — deux lignes de retour
contre une, trois pour une mauvaise réponse — donc la reprise n'est pas
exacte, et le bouton Suivant peut rester bas. L'ordre dans le document est
vérifié par `tools/verify.py`.

**P3 — La zone d'action est un enfant de la coque, pas de l'écran qui défile.**
C'est le correctif de fond, et il a fallu deux essais.

*Le premier essai* était `position: sticky` à l'intérieur de l'écran défilant.
Il ne garantit **rien** : un élément collé ne peut se déplacer que dans la boîte
de son parent — ici, le formulaire. Dès que le contenu déborde, donc
précisément dans le cas qu'on voulait sécuriser, le formulaire est plus bas que
la zone visible et la barre ne peut pas remonter au-dessus de lui. Elle restait
hors champ : le symptôme intact, avec une règle CSS de plus en travers.

*Le bon* : `.actions` est un enfant direct de `.shell`, qui est calé sur la
hauteur visible et ne défile pas. La barre est alors un simple élément de flex
au bas de l'écran, et elle y reste **quoi qu'il arrive du contenu**. Elle ne
dépend plus d'une mesure, ni de la position d'un autre élément — c'est la seule
forme du problème qui ne se repose pas sur un nombre écrit à la main.

Deux corollaires, tous deux vérifiés :

- `.shell` est passé de `min-height` à **`height`**, plus `overflow: hidden`. En
  `min-height`, la coque pouvait grandir au-delà de la hauteur visible : c'était
  alors le *document* qui défilait, et il n'y avait plus de bas où caler la barre.
  `.screen` est le seul conteneur qui défile, et c'est ce qui donne son point de
  référence à la barre.
- La barre n'apparaît que sur le quiz, via `html[data-screen='quiz']` — le même
  attribut que pour l'icône du son.

`tools/verify.py` **refuse** `sticky` et `fixed` sur `.actions`, avec le motif de
chaque refus. Ce ne sont pas deux styles : ce sont deux solutions qui ont été
tentées, et deux erreurs que vaut la peine de garder en mémoire.

**Cette correction a un effet de bord, et il a fallu le voir.** Les boutons
n'étant plus des descendants de `#screen-quiz`, la parade anti-prise de focus du
conteneur ne les voyait plus : Valider et Suivant reprenaient le focus, le
champ le perdait, le clavier se fermait, et l'écran sautait — le tremblement exact
que la parade venait d'éliminer, revenu par la porte de la correction. Même
situation que le bouton son, qui est en `position: fixed` et enfant de `body`.
`#actions` porte donc sa propre parade, et `tools/verify.py` refuse
`position: sticky` **et** exige que `.actions` soit hors de `#screen-quiz`.

Le harnais de test était lui aussi faux : il rattachait les boutons à
`#screen-quiz`. Les assertions « Valider bloque la prise de focus » restaient
vertes parce que la parade du quiz les satisfait — sur une page où elle ne les
voit plus. Un écouteur fantôme dans le harnais, un vrai tremblement sur
l'appareil. Les deux liens de parenté sont donc d'abord assertionnés, puis
l'affirmation seulement (*voir* « Ce qui est vérifié, et comment »).

**P5 — L'appareil mesure son propre débordement.** `mesurerDebordement()`
compare `scrollHeight` et `clientHeight` de l'écran de quiz, et affiche un
bandeau **seulement s'il déborde**. Il est appelé à chaque changement de hauteur
visible, pas seulement au rendu : c'est ainsi qu'un débordement apparaît ou
disparaît aussi à une rotation ou à une ouverture de clavier en cours de partie.

Le bandeau n'apparaît que dans le cas problématique. Permanent, ce serait du
bruit qu'on arrête de lire — et un diagnostic qu'on ne lit plus est un
diagnostic qu'on n'a pas. **Les deux chiffres bruts y sont**, parce que « ça ne
rentre pas » ne se corrige pas, et « 324 px pour 210 px » se corrige.

Et la tolérance est d'un pixel : ces deux hauteurs sont arrondies par le
navigateur, et un demi-pixel de débordement n'a rien de réel. Sans elle, le
bandeau s'afficherait sur un écran qui tient exactement, et l'utilisateur
finirait par l'ignorer.

Ni `verify.py` ni les assertions ne peuvent voir la mise en page : le faux DOM
n'a pas de moteur de rendu, et une assertion qui dirait « le commentaire est
sous le clavier » serait une assertion sur rien. Ce que les tests vérifient,
c'est que l'application **réagit correctement à une mesure** ; les nombres sont
posés à la main dans le test, et personne ne les calcule. Un test qui prétendrait
mesurer la hauteur simulerait exactement le défaut qu'il est censé attraper.

**P6 — Ce qui ne rentre pas, on le rétrécit, et c'est l'appareil qui le décide.**
C'est la suite de P1 à P5, et elle vient de la mesure ci-dessus.

**La barre de symboles part avec la réponse.** On ne compose plus rien une fois
la réponse comptée, et c'est précisément quand le commentaire et Suivant ont
besoin de la place : 319 px de contenu deviennent 203, pour 210 disponibles. Un
gain de 116 px sans rien retirer à ce qui se touche au doigt.

**Avant la réponse, elle se replie derrière un bouton**, et le reste se resserre.
Le repli est une **disposition** : `aria-expanded`, `aria-controls`, un bouton
de 48 px comme toutes les autres cibles tactiles. Le choix du joueur **survit à
la question** — celui qui veut la barre en veut dix fois de suite — mais **pas à
une nouvelle série**.

**Le resserrement est déclenché par une mesure, jamais par un seuil deviné.** Un
seuil de hauteur serait un nombre inventé, donc faux sur tout appareil qui ne lui
ressemble pas exactement. Pire, il ne fonctionnerait pas du tout : sur iOS le
viewport de **mise en page** ne rétrécit pas quand le clavier se lève, donc une
requête `@media (max-height: …)` y verrait toujours la hauteur de l'écran et ne
se déclencherait jamais. C'est **exactement le piège de
`interactive-widget=resizes-content`**, qui n'existe que sur Chrome et qui a
déjà fait perdre une version entière de mise en page.

`mesurerDebordement()` constate donc le débordement sur la machine qui échoue,
pose `html[data-compact='1'`, et **re-mesure**. Les quatre leviers — `--gap`,
`--pad`, `.question-type` masqué, barre repliée — rendent 324 px en 208, pour
226 disponibles.

`tools/verify.py` **refuse** toute requête de média sur la hauteur, et vérifie
que les deux variables du mode compact sont **numériquement plus petites** que
celles de `:root`. Comparer leurs noms passerait avec `--gap: 16px`, qui est la
valeur de base et ne rend donc aucun pixel : le mode serait posé, annoncé, et
sans effet.

Le mode est **verrouillé** pour la question en cours. Le décomposer puis le
recomposer au fil des mesures ferait osciller la mise en page d'un bord à
l'autre — et l'icône du son, qui lit la **même** `var(--pad)` que la coque,
monterait et descendrait avec elle. Il se repose à la question suivante, parce
que chaque énoncé a sa hauteur.

Le bandeau, lui, **ne ment pas** sur le repli : si le joueur déploie la barre
et que ça déborde (264 px pour 226), il le dit et propose de la refermer. C'est
un choix, pas un défaut, et un débordement choisi en connaissance de cause qui
resterait muet serait un débordement invisible.

`refreshSymbolZone()` est le **seul propriétaire** des deux propriétés `hidden`.
Ni le balisage ni le CSS n'en décident seuls : deux sources se disputant la même
propriété, la dernière posée gagnerait, donc un `hidden` de `validate()` serait
annulé par le rendu suivant selon l'ordre. Un seul propriétaire rend la règle
observable, donc testable.

**Ce qui reste hors d'atteinte de toute correction de mise en page** : la barre
d'adresse de Safari, et l'accessoire clavier d'iOS. La première ne s'ouvre pas —
une application installée, lancée depuis l'écran d'accueil, n'a pas de barre
d'adresse. La seconde disparaîtrait avec le `<form>` ; c'est un remède plausible,
jamais vérifié ici, donc présenté comme **candidat** et non comme correctif.

### La touche retour du clavier

**Mesure de terrain : sur iPhone, ça n'a jamais marché.** La première pression
valait bien la réponse ; la seconde ne passait pas à la question suivante.

La cause est le mécanisme lui-même. La touche retour ne faisait rien par
elle-même : elle soumettait le formulaire, et c'était le gestionnaire `submit`
qui validait puis enchaînait. Or la soumission *implicite* — le formulaire
n'ayant pas de bouton de soumission, la touche retour en déclenche une —
n'est pas fiable sur iOS. La première passe, la suivante non. Un chemin qui
dépend d'un comportement qu'on n'a pas vérifié n'est pas un chemin fiable,
même quand il paraît marcher.

Le remède n'a donc pas été de retenter la soumission, mais de **ne plus en
dépendre**. Une source d'entrée, un chemin, exactement :

| Source | Chemin | Ne peut pas |
|---|---|---|
| touche retour | `keydown` dans `onKeydown()` | ne peut pas doubler l'effet |
| bouton Valider | `click`, en `type="button"` | ne peut pas enchaîner |

Le bouton Valider est passé en `type="button"` : avec un bouton de soumission
dans le formulaire, une soumission implicite peut suivre la touche retour, et
une seule pression validerait **puis** avancerait. Une question sautée par
accident, silencieusement. `SubmitEvent.submitter`, qui distingue les deux
sources, n'existe que depuis Safari 15.4 — trop récent pour en faire la base.

Écouter `keydown` **et** `submit` aurait paru plus robuste. C'est
l'inverse : les deux se déclencheraient sur la même pression, et la course
entre eux vaudrait exactement le défaut qu'on cherche à éviter. D'où
`make verify`, qui refuse un `#validate-button` en `type="submit"` et un
gestionnaire `submit` qui appellerait `onEnter()`.

Le geste lui-même reste le plus répété de la série : la touche vaut Valider
**puis** Question suivante, là où il fallait lever le doigt, viser le bouton
Suivant, poser le doigt. `state.answered` fait tout l'arbitrage, et fait
aussi le garde-fou : le point gagné une fois ne peut pas être recompte.

#### Et quand le clavier a volé le focus

Un second mécanisme, distinct, capable de produire exactement le même
symptôme : **le champ n'a plus le focus**.

Un navigateur n'envoie `keydown` qu'à l'élément focus. Or iOS et Android
retirent le focus du champ quand ils valident une correction ou un mot
proposé : le clavier se ferme, et la touche retour n'atteint plus rien. Le
joueur doit alors retaper dans le champ avant de pouvoir avancer. Rien dans
l'application ne l'explique.

D'où une seconde écoute, au niveau du `document`, qui récupère la touche
retour même quand le champ ne l'a plus. Les deux chemins sont **exclusifs par
construction**, par le test de focus — et c'est une condition de correction,
pas une commodité :

| Focus | Qui traite la touche |
|---|---|
| le champ | l'écoute du champ, ci-dessus — le cas normal |
| pas le champ | l'écoute du `document` — le filet |
| un bouton | le `click` du bouton, que le retour déclenche |
| pas en série | personne : il n'y a rien à confirmer |

Une double validation voit `onEnter()` valider **puis** avancer : la question
est sautée et le score faux. L'exclusion par le focus est donc ce qui empêche
ce défaut, et elle est vérifiée par le harnais comme tout le reste.

Le harnais devait pour cela remonter les événements jusqu'au `document`, comme
un vrai DOM. Il ne le faisait pas : la double validation était alors
impossible à reproduire, et la garantie n'était pas vérifiée — seulement
énoncée. Deux assertions'y veillent désormais, sinon le harnais pourrait
redevenir infidèle en silence.

### Le numéro de version, affiché à l'écran

`version d83e6ffc` figure en bas de l'écran d'accueil et de l'écran de
résultat.

Il ne s'agit pas d'un décor. Les deux symptômes signalés sur l'appareil —
l'icône du son à sa place par défaut, la touche retour qui n'avance pas —
sont **exactement** ce que fait un appareil encore sur l'ancien code. Les
distinguer d'un correctif inefficace demandait de le demander à l'utilisateur,
qui ne pouvait pas le savoir.

Le numéro vient de l'empreinte des vingt fichiers précachés, la même qui
nomme le cache. Il est donc le numéro du cache que **cet** appareil sert, pas
une étiquette : `make cache-version` écrit les deux depuis la même empreinte,
et `make verify` échoue s'ils divergent.

L'empreinte retire le `<meta>` avant de le hacher. Le hacher rendrait le
calcul autoréférentiel — écrire une version change le fichier, donc change
l'empreinte, donc la version suivante diffère encore — et `make cache-version`
ne convergerait jamais.

### L'icône du son, centrée sur la ligne de progression

L'icône se tient au centre de la ligne « Question X / 10 … Score : Y » pendant
la série. L'écran de quiz étant ancré en haut, cette ligne est toujours la
première de l'écran, à la même hauteur quel que soit l'état du clavier — c'est
ce qui rend un centrage possible sans la mesurer en direct, et sans qu'elle
bouge quand le clavier se lève.

La position est **calculée**, pas mesurée : la même marge que `.shell`, plus la
moitié de la ligne moins la moitié du bouton. La hauteur de la ligne est donc
une variable partagée, `--progress-h`, lue par `.progress-row` **et** par la
règle de centrage. Les deux ne peuvent pas diverger. Un `11px` en dur aurait
été la même chose, jusqu'au jour où la ligne aurait changé de hauteur et où
l'icône aurait dérivé sans que personne ne le voie.

Le centrage ne vise que l'écran de quiz, par `html[data-screen='quiz']`,
attribut posé par `showScreen()`. La ligne de progression n'existe que là, et
sur l'écran de résultat le contenu est centré et peut remonter haut, sous un
commentaire rétro d'unequis.

L'attribut remplace `body:has(#screen-quiz:not([hidden]))`. `:has()` paraît plus
court, mais il demande Safari 15.4 : sur un appareil plus ancien, la règle ne
s'applique pas du tout et l'icône reste **en haut à droite** — c'est-à-dire
précisément le symptôme signalé. Un attribut est accepté partout, et surtout
il se teste : le harnais peut affirmer que l'écran de quiz porte bien
`data-screen="quiz"`, ce qu'aucun test ne peut faire pour `:has()`. `make
verify` refuse donc `:has()` dans le CSS.

**Le bouton son a aussi eu besoin de sa parade anti-prise de focus, pour une
raison qui n'existait pas avant.** Il est `position: fixed`, donc enfant de
`body` : il est *visuellement* dans l'écran de quiz sans en être un descendant,
et la parade enregistrée sur `#screen-quiz` ne le voyait pas. Un bouton qui
prend le focus vide le champ, ferme le clavier, et fait sauter l'écran — baisser
le son en pleine série déclenchait le tremblement qu'on venait de supprimer, et
par la même cause.

### Ce qui est vérifié, et comment

Le harnais n'a **aucune minuterie**, délibérément. Avec un `setTimeout`, un
report de focus passerait : le focus poserait toujours au vidage de la file.
Aucune assertion n'a donc le droit d'en attendre une, et c'est ce qui
attrape une régression de type 3.

Le stub fait maintenant remonter les événements le long des ancêtres, jusqu'au
`document`, parce que les parades sont enregistrées sur le conteneur et non sur
chaque bouton — et parce que le filet de la touche retour écoute le `document`.
Sans propagation, elles ne seraient jamais appelées par un test — et une
parade vérifiée dans le vide n'est pas vérifiée. C'est même arrivé : le lien
de propagation et le test d'exclusion par le focus disparus **ensemble**,
laissant 289 assertions au vert. Deux assertions vérifient désormais que le
harnais voit bien ce que voit un navigateur.

| Invariant | Assertion |
|---|---|
| le curseur est dans le champ à la première question | `document.activeElement === input` |
| le focus est pris **sans attendre** | aucune minuterie dans le harnais |
| le focus ne sort jamais du champ, sur trois questions | compteur de sorties à 0 |
| le code de production ne produit aucun `blur` | `input.blurred` inchangé |
| ni `disabled` ni `readOnly` | les deux à `false` |
| Valider et Suivant ne prennent pas le focus | `pointerdown` annulé, `click` non |
| la parade ne porte pas sur le champ | sinon iOS refuserait le clavier |
| la fin de série est la seule sortie du focus | `activeElement !== input` |
| la touche retour valide | `feedback--correct`, commentaire visible |
| la touche retour passe ensuite à la suivante | l'énoncé change, champ vidé |
| la touche retour ne recompte pas | score identique avant et après |
| un retour à vide ne fait rien | ni validation ni passage |
| une pression ne consomme qu'une question | progression inchangée après validation |
| la touche annule l'événement | `defaultPrevented`, donc pas de soumission |
| une soumission du formulaire ne fait rien | ni validation ni passage |
| le bouton Valider valide, sans enchaîner | le bouton est `disabled` après |
| le retour lève le mode indice/exposant armé | `aria-pressed` à `false` |
| le bouton son bloque la prise de focus | `pointerdown` annulé, `click` non |
| le bouton son ne coûte pas le focus au joueur | `activeElement === input` après |
| la touche retour agit même sans focus | validation, puis passage au retour suivant |
| le filet ne double pas l'effet | une pression, une question |
| le filet laisse un bouton à son propre clic | ni validation ni annulation |
| le filet est inerte hors série | `defaultPrevented` à `false` |
| le harnais voit ce que voit le navigateur | propagation jusqu'au `document` |
| l'écran courant est publié au démarrage | `data-screen="start"` |
| le numéro affiché vient du `<meta>` réel | égalité avec `index.html` |
| l'énoncé ne bouge pas quand la hauteur change | `.screen-quiz` sans marge auto |
| la barre d'adresse n'est pas un clavier | `data-keyboard` absent à 790 px |
| l'indicateur d'accueil s'écarte avec le clavier | `data-keyboard="open"` à 508 px |
| Valider disparaît, pas seulement gris | `hidden` à `true`, `disabled` aussi |
| Valider revient à la question suivante | `hidden` à `false` |
| l'état répondu est publié puis retiré | `data-answered`, puis absent |
| un débordement réel est signalé | bandeau visible, les deux chiffres |
| un écran qui tient exactement reste muet | tolérance d'un pixel |
| rien n'est signalé hors du quiz | bandeau masqué |
| le harnais voit les boutons dans la zone d'action | `_parent === actions` |
| le harnais ne les voit plus dans l'écran de quiz | `_parent !== screen-quiz` |
| le harnais voit le bouton des symboles dans le formulaire | `_parent === answer-form` |
| le harnais voit le formulaire dans l'écran de quiz | `_parent === screen-quiz` |
| le bouton des symboles bloque la prise de focus | `pointerdown` annulé, `click` non |
| un débordement mesuré resserre l'écran | `data-compact="1"` |
| resserré, l'écran tient et le bandeau se tait | 208 px pour 226 |
| le mode reste posé tant que la question ne change pas | verrou |
| le mode se repose à la question suivante | attribut retiré |
| la barre se replie derrière un bouton en mode resserré | `hidden` croisés |
| le repli reste une porte | un clic déploie, un autre referme |
| le bandeau ne se compte pas lui-même | deux mesures, le même chiffre |
| le bandeau nomme l'état mesuré | « avant reponse », « apres reponse » |
| le bandeau ne promet pas un retour inexistant | pas de « lire le retour » avant |
| le bandeau propose de refermer une barre déployée | « Refermez la barre » |
| le bouton remesure sans qu'on le lui demande | bandeau mis à jour au clic |
| la barre part avec la réponse | `hidden`, et le bouton avec |
| le choix du joueur survit à la question | barre déployée à la suivante |
| le choix est remis à zéro par une nouvelle série | `startQuiz()` |
| le repli ne change rien à l'insertion | `SO` + `2` → `SO2` |

Trente-quatre régressions ont été introduites puis vérifiées comme détectées : le
focus volé par Suivant, le champ `disabled` après validation, le focus reporté
d'une micro-tâche, la parade retirée, la parade restreinte à un seul bouton,
`readOnly` réintroduit, le `blur()` de fin de série retiré, le focus de
`renderQuestion()` supprimé, la touche retour réduite à une validation, la
touche retour avancée sans avoir validé, l'écran de quiz recentré,
l'`auto` remonté sur le quiz, la marge d'accueil non remise à zéro,
l'attribut renommé d'un seul côté, la variable non consommée, l'écran de
résultat décentré, le retour à `justify-content: center`, le gestionnaire
`submit` redevenu actif, la parade du bouton son retirée, la ligne de
progression détachée de `--progress-h`, le centrage appliqué à tous les écrans,
le centrage remplacé par une valeur mesurée à l'œil, le retour à
`caches.match()`, le repli de navigation relisant tous les caches, le `<meta>`
affichant une autre version, le `<meta>` supprimé, le worker ne répondant plus
sur sa version, le retour à `:has()`, `data-screen` non publié, la version
affichée disparue, `showScreen('start')` retiré du démarrage, le filet de
sécurité supprimé, l'exclusion par le focus retirée, l'exclusion des boutons
retirée, la garde hors série retirée, le champ ne remontant plus au document,
l'écran de quiz ne remontant plus au document, et `doc.fire` sans
`preventDefault`.

Vingt et une de plus pour P6, le resserrement mesuré : le bandeau qui se
compte lui-même, le mode compact absent, le mode rejoué à chaque mesure, la
re-mesure supprimée, la barre qui survit à la réponse, la barre qui ne se replie
jamais, le choix du joueur ignoré, le mode qui survit à la question, le choix
qui survit à une série, le bandeau qui annonce toujours un retour, le remède qui
promet un retour avant qu'il existe, le bouton qui ne remesure plus, le resserrement
déclaré par une requête de hauteur, `--gap` laissé à sa valeur de base, `--pad`
non réduit, le type de question conservé, le bouton de repli retiré du
balisage, le bouton sans `aria-controls`, le bouton devenu `type="submit"`, et
deux mutations du harnais — le bouton des symboles retiré du formulaire, le
formulaire retiré de l'écran de quiz. **Vingt et une sur vingt et une
détectées.**

Et vingt-deux autres pour les correctifs de place, dont trois qui sont
invisibles sans téléphone : Valider qui ne disparaît plus, `data-answered` qui
n'est plus posé, Valider qui ne revient pas à la question suivante, la barre
d'action en `sticky`, la barre d'action en `fixed`, la coque revenue en
`min-height`, le document redevenu défilable, la barre d'action sans
`flex: 0 0 auto`, la règle de portage `data-screen` retirée, la règle CSS
`data-answered` retirée, la zone d'action replacée dans `#screen-quiz`, le
bandeau de mesure replacé dans `#screen-quiz`, le bandeau de mesure né
visible, le commentaire remis sous le formulaire, la parade de `#actions`
supprimée, la mesure jamais prise, la mesure remplacée par une constante, la
tolérance d'un pixel disparue, et quatre mutations du harnais lui-même —
les boutons rattachés au mauvais parent, un bouton qui ne se reconnaît plus,
la zone d'action qui ne remonte plus au `document`, et le lien de propagation.

Les trois mutations du harnais sont les plus instructives. Rattacher les
boutons à `#screen-quiz` — comme le harnais le faisait encore — laissait
**toutes** les assertions au vert : la parade du conteneur les satisfait, sur
une page où elle ne les voit plus. Rien ne pouvait le dire, parce qu'un
écouteur fantôme dans un harnais est indiscernable d'un vrai écouteur.
C'est pour cela que les deux parentés sont désormais **assertionnées avant**
d'affirmer quoi que ce soit sur la parade.

Et le harnais de mutation lui-même a été repris dans la foulée, et il
mentait sur sa propre sortie. Il classait « harnais cassé » toute mutation dont
la sortie contenait le mot `Exception:` — et `run-tests.py` lève volontairement
une exception **quand une assertion échoue**. Le mot apparaissait donc exactement
dans les cas qu'il fallait déclarer réussis : le rapport annonçait onze mutants
cascés là où il n'y en avait aucun.

Le discriminant n'est plus une recherche de mots mais la **ligne de résumé**,
`N assertions réussies, M en échec`, que seul l'épilogue du fichier de test peut
produire. Si elle est là, le harnais est allé au bout et c'est le compte de `M`
qui tranche ; si elle manque, le mutant a cassé l'outillage avant qu'aucune
assertion n'ait pu s'exprimer, et cela ne prouve rien sur la couverture. C'est
pourquoi les deux classes sont **distinguées** et non confondues : un mutant qui
fait tomber le harnais n'est pas une détection, c'est un trou.

Deux des trois mutations que ce harnais ne voyait pas étaient **mes** erreurs,
pas celles des tests. L'une remplaçait la condition de l'état mesuré par `false`
— ce qui, contre toute attente, produisait exactement le texte que l'assertion
demandait. L'autre ajoutait un commentaire au lieu de retirer l'appel, et ne
changeait donc rien. Une mutation qui ne mute pas ne prouve pas que le test est
faible ; elle prouve que la mutation était mauvaise. Le harnais vérifie désormais
que chaque motif apparaît **une fois exactement**, avant d'exiger qu'un mutant
soit vu.

La troisième, elle, était un vrai trou : la branche « barre repliée, avant
réponse » n'était affirmée nulle part. Les deux autres états l'étaient, et
l'original — le remède qui annonçait un retour avant qu'il existe — passait
entre les mailles. Deux assertions de plus, et il est fermé.

**Quatre de ces contrôles ont eux-mêmes eu besoin d'être repris**, parce qu'ils
passaient au vert sur du CSS absent, c'est-à-dire ne pouvaient pas échouer :

- une recherche de texte enchaînait la queue d'un sélecteur au corps de la règle
  **suivante** ; les règles sont désormais parsées en `{selecteur: corps}` ;
- la requête de média sur la hauteur était cherchée dans le **corps** du bloc,
  et sa **condition** est avant l'accolade : `(max-height: 460px)` lui échappait
  donc entièrement. Le contrôle ne pouvait rien voir — la feuille pouvait
  contenir exactement la requête interdite. Il lit désormais l'at-rule en
  entier ;
- la valeur de `--safe-bottom` n'était pas vérifiée, seulement son nom —
  `--safe-bottom: 34px` cite la variable et ne rend pas un pixel ;
- une comparaison à un nom écrit en dur (`screen == "keyboard"`) avait dérivé
  du vrai nom et **saute le test en silence**. Un test par attribut croisé vaut
  mieux qu'une comparaison à une constante.

### Ce qui reste à l'appareil

Le simulateur garantit que le code **pose le focus dans le geste et ne le
lâche pas**, et que la mise en page est écrite pour ne pas dépendre de la
hauteur. Il ne peut pas garantir deux choses que seul un téléphone tranche :

- que le système d'exploitation lève le clavier sur un `focus()` synchrone.
  Si le clavier ne se lève toujours pas à l'ouverture de la série, le prochain
  remède est de faire la première question au `touchend` plutôt qu'au `click`,
  qui est le geste que le navigateur reconnaît sans ambiguïté.
- que l'énoncé, le champ et Valider tiennent ensemble à l'écran une fois le
  clavier levé. **C'était le calcul du CSS, et il était faux** : les 469 px ne
  décrivaient que l'état avant réponse, et l'état après réponse demande
  davantage. Un iPhone 15 Pro a refusé le calcul, et le commentaire comme le
  bouton Suivant ont disparu. La mesure de l'appareil a ensuite montré que le
  problème n'était pas la mise en page mais le **contenu** : 324 px pour 210 px
  visibles, dont 116 pour la seule barre de symboles. P1 à P5 ont réglé la
  structure, P6 fait ce qui restait : la barre part avec la réponse, se replie
  avant, et l'appareil décide du resserrement en mesurant.
  Ce qui reste hors d'atteinte : **Valider et Suivant restent visibles**
  (`.actions` est un enfant de la coque, donc au bas de la zone visible quoi
  qu'il arrive du contenu), mais l'énoncé et le champ demandent désormais un
  défilement sur un écran plus étroit que 402 px, et le bandeau le dit au lieu
  de le cacher. C'est le compromis assumé : rendre la barre de symboles à une
  touche en vaut la place, mais pas toujours.
- que la barre d'adresse de Safari disparaisse. Elle ne s'ouvre pas : seule
  l'application installée (*voir* « Lancer l'application installée, et non un
  onglet ») en est dépourvue. Les 210 px ont été mesurés **dans un onglet**,
  donc c'est le pire cas.
- que le système retire ou non le focus du champ quand il valide une
  correction. Le filet de sécurité de la touche retour rend la question sans
  importance, mais il ne peut pas être vérifié ici : aucun faux DOM ne simule
  le clavier du système. Ce qui est vérifié, c'est que le filet agit quand le
  focus est parti, et qu'il ne double jamais l'effet quand le focus est là.

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

- **Plus de touche « clavier », et le clavier ne bouge plus.** Sa fonction était
  de fermer le clavier virtuel pour accéder à la barre et au bouton Valider, et
  d'empêcher qu'il se rouvre tout seul. iOS et Android savent le fermer d'un
  geste.

  Le curseur est dans le champ dès la question posée, sans que l'utilisateur
  touche la case, et y reste jusqu'à la fin de la série. Ni `disabled` ni
  `readOnly` ne sont utilisés, aucun bouton ne prend le focus, et le focus est
  pris **dans le geste** plutôt que reporté — un report sort du geste et le
  clavier ne se lève pas. Quatre défauts distincts
  suffisaient à faire bouger le clavier ; ils sont détaillés dans
  [Le clavier virtuel](#le-clavier-virtuel).

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
le cache en priorité : un fichier modifié sans que le nom du cache change
restait servi **indéfiniment** sur l'appareil de l'utilisateur. Cela s'est
déjà produit ici — un correctif d'affichage des commentaires avait été livré
sans incrémentation de version, et il n'atteignait personne. Le symptôme est
trompeur, parce que tout le reste fonctionne et que les tests passent.

Un second bug aggravait le premier, et c'est le plus difficile à voir :
`sw.js` lisait les réponses avec `caches.match(request)`, qui parcourt **tous**
les caches de l'origine et pas seulement celui du service worker courant. Un
cache périmé pouvait donc faire de l'ombre au cache vivant et servir l'ancien
code, indéfiniment. Il ne fallait qu'une étape de cycle de vie manquée — et le
résultat est *le même symptôme* : « j'ai corrigé, rien ne change », impossible
à distinguer d'un correctif inefficace. Le worker ne lit donc plus que
`caches.open(CACHE_NAME)`, repli de navigation compris, et `make verify` refuse
toute lecture globale.

Pas de revalidation en arrière-plan, et c'est délibéré : rafraichir le cache
courant depuis le réseau mélangerait les déploiements — le `js/ui.js` de la
v2 dans le cache de la v1, avec le `js/data.js` de la v1 — et l'application
ne démarre pas. Le nom du cache, dérivé du contenu, *est* le mécanisme
d'invalidation.

### Vérifier sur l'appareil

Un `push` n'a pas d'effet immédiat. **Trois délais** s'y interposent, et ils
sont indépendants :

| Délai | Durée | Comment le constater |
|---|---|---|
| GitHub Pages republie | 1 à 2 min | `make online` |
| le navigateur du téléphone découvre le nouveau worker | 1er lancement | le numéro ne change pas |
| le worker sert enfin le nouveau code | 2e lancement | le numéro change |

`make online` compare la version locale à celle que le site sert réellement,
en contournant le cache du CDN. `make wait` répète l'attente jusqu'à ce que le
site suive.

Il ne faut **pas réinstaller** l'application : le service worker est déjà en
place, il suffit de lancer deux fois.

Le numéro affiché en bas de l'écran d'accueil tranche le reste : il est écrit
par le même outil que `CACHE_VERSION` et vérifié par `make verify`. S'il ne
change pas après un `make online` au vert, l'appareil sert encore l'ancien code
— et le symptôme observé n'a rien à voir avec le correctif que l'on croyait
tester. C'est exactement ce qui est arrivé : l'icône et la touche retour
étaient signalées comme cassées alors que la version précédente marchait
déjà. Les deux produisaient la même image qu'un bug réel, et rien ne
permettait de les distinguer sans ce numéro.

Le seul piège qui subsiste est de modifier un fichier précaché et de pousser
sans avoir lancé `make`. Le garde-fou est là pour le transformer en échec rouge
plutôt qu'en silence.

### Lancer l'application installée, et non un onglet

**C'est le premier réflexe, et il ne coûte aucune ligne de code.**

En onglet Safari, la barre d'adresse occupe 49 à 83 pt en bas de l'écran selon
qu'elle est repliée ou déployée. Installée depuis l'écran d'accueil, l'application
n'a **aucune barre** : c'est la différence la plus grande qui soit, et elle est
gratuite.

L'application installée est aussi la seule façon de tester ce que l'utilisateur
utilise. Un bug visible « seulement dans Safari » est très souvent le comportement
de l'onglet, pas celui de l'application.

Le test de terrain qui a produit ce diagnostic est là-dessus : la barre d'URL
signalée comme masquant le bas de l'écran ne peut pas exister dans l'application
installée. Sa présence indiquait qu'on testait un onglet, et elle a mangé une
partie du budget vertical que le CSS ne comptait pas.

**Cela vaut aussi pour la mesure de 324 px pour 210 px** : elle a été prise
dans un onglet. Les 210 px sont donc le **pire cas**, et l'application installée
rendra au moins 49 px de plus, soit 259. Le budget de `make budget` n'a pas à
être ajusté : il se déduit d'une hauteur *visible* mesurée, et c'est cette
mesure-là qu'il faut refaire sur l'application avant d'en tirer une conclusion.
Ce qui ne change pas en passant à l'application installée, en revanche, c'est
l'accessoire clavier d'iOS, qui existe dans les deux cas.

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

`tools/budget.py` lit les hauteurs **dans le CSS**, mais il ne mesure rien : la
largeur de l'écran et la place visible sont des paramètres, et ses deux seules
hypothèses sont dites dans le fichier. La première est `ratio = 0.5`, la largeur
moyenne d'un caractère exprimée en em, qui sert à plier le plus long
commentaire ; elle est exposée en paramètre pour être corrigée contre un
appareil réel plutôt que changée en douce. La seconde est qu'un énoncé tient
sur une ligne — vrai pour les 62 éléments, 20 ions et leurs formules, puisque ce
sont des noms et des symboles, et vérifié dans `data.js`. Si un jour un énoncé
tenait sur deux, le budget serait faux **par construction** et le tableau le
dirait, ce qui vaut mieux que le contraire.

`tools/tests/dom-stub.js` déclare les touches de la barre de symboles à la
main : c'est un miroir maintenance de `index.html`, donc une source de dérive.
`tools/verify.py` compare les deux listes — contenu **et** ordre — et échoue si
elles divergent, pour que les tests ne puissent pas passer sur une barre qui
n'existe pas à l'écran.

Et `tools/verify.py` couvre les autres contrats qu'aucun test JS ne peut voir,
parce qu'ils sont écrits dans un autre langage :

- `--app-height` est un nom partagé entre `js/ui.js` et `css/style.css`, et
  aucun test ne le voit. `make verify` vérifie qu'il est publié d'un côté,
  consommé de l'autre, et qu'il garde une valeur de repli — sans quoi la page
  vaudrait zéro pixel de haut pendant le premier rendu.
- `#screen-quiz` ne porte **aucune** marge automatique : c'est ce qui l'ancre
  en haut et rend sa position insensible à l'ouverture du clavier. Les écrans
  d'accueil et de résultat, eux, doivent garder la leur, et aucun des trois ne
  doit centrer par `justify-content` — les deux centrent, un seul rend le
  débordement atteignable.
- `data-keyboard` est posé par `js/ui.js` et consommé par `css/style.css` pour
  remettre `--safe-bottom` à zéro. Même nature de contrat, et cette fois la
  **valeur** est vérifiée : `--safe-bottom: 34px` cite la variable et ne rend
  pas un pixel.
- la touche retour et le bouton Valider ne peuvent pas se rejoindre. Aucun test
  JS ne voit le `type` d'un bouton, ni ne produit de soumission implicite :
  `make verify` exige `#validate-button` en `type="button"` et un gestionnaire
  `submit` qui se contente d'annuler.
- `--progress-h` est lue par `.progress-row` et par la règle de centrage de
  l'icône du son. C'est le contrat qui tient l'alignement, pas une valeur
  recopiée qui dériverait un jour. Changer la variable déplace les deux d'un
  coup — et c'est **voulu** : la mutation `--progress-h: 40px` passe le contrôle
  vert, parce qu'elle conserve le contrat.

Ces contrôles passent au vert sur du CSS absent, ce qui est leur mode de panne
préféré. D'où le `parse_rules()` : apparier du texte enchaîne un jour la queue
d'un sélecteur au corps de la règle suivante, et la règle manquante passe.

