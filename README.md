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
| `make test` | 266 assertions sur la logique et sur l'interface, exécutées dans le JavaScriptCore d'Apple. |
| `make verify` | Compare le code aux fichiers réels : entrées du précache, icônes du manifeste, imports, identifiants du DOM, barre de symboles, variables de viewport partagées entre le JS et le CSS, ancrage du centrage, marge de l'indicateur d'accueil, chemins de confirmation, placement de l'icône du son. |
| `make cache-version` | Recalcule `CACHE_VERSION` dans `sw.js` d'après l'empreinte des fichiers précachés. |

Le harnais a deux extensions qui méritent d'être connues, parce qu'elles
rendent testable ce qui ne l'était pas :

- **`visualViewport` pilotable.** `setKeyboard`, `hideKeyboard` et `scrollTo`
  rejouent l'ouverture du clavier et le défilement du document. La hauteur et
  le décalage y sont **indépendants**, comme en réel : iOS peut lever le clavier
  sans faire défiler. Les relier l'un à l'autre — ce qu'un stub trop simple
  ferait — rendrait les deux variables redondantes, et une erreur de signe
  passerait.
- **La propagation des événements.** `fire()` remonte le long des ancêtres.
  Les parades anti-prise de focus sont enregistrées sur le conteneur et non
  sur chaque bouton ; sans remontée elles ne seraient jamais appelées par un
  test, et une parade vérifiée dans le vide n'est pas vérifiée.

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
ce qui remet la marge à zéro. Le contenu de l'écran de quiz passe alors de
503 à 469 px, pour 508 px visibles sur un iPhone 15 : l'énoncé, le champ et
Valider tiennent ensemble à l'écran, avec 39 px d'air.

Le seuil de 80 px départage le clavier de la barre d'adresse d'iOS, qui
rétracte la fenêtre de 90 px sans qu'aucun clavier n'existe à l'écran.

Le prix de l'ancrage : sans clavier, le contenu occupe le haut de l'écran et le
bas reste vide. C'est acceptable parce que le clavier ouvert est l'état normal
d'une série — c'est tout l'objet de la demande — et que l'état sans clavier
n'est visible que sur les deux autres écrans, qui restent centrés.

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

Le centrage ne vise que l'écran de quiz, par `body:has(#screen-quiz:not([hidden]))`.
La ligne de progression n'existe que là, et sur l'écran de résultat le contenu
est centré et peut remonter haut, sous un commentaire rétro d'unequis. `:has()`
demande Safari 15.4 ; en dessous, l'icône reste en haut à droite, c'est-à-dire
la position précédente — la dégradation n'est pas une panne.

**Le bouton son a aussi eu besoin de sa parade anti-prise de focus, pour une
raison qui n'existait pas avant.** Il est `position: fixed`, donc enfant de
`body` : il est *visuellement* dans l'écran de quiz sans en être un descendant,
et la parade enregistrée sur `#screen-quiz` ne le voyait pas. Un bouton qui
prend le focus vide le champ, ferme le clavier, et fait sauter l'écran — baisser
le son en pleine série déclenchait le tremblement qu'on venait de supprimer, et
par la même cause.

### Ce qui est vérifié, et comment
### Ce qui est vérifié, et comment

Le harnais n'a **aucune minuterie**, délibérément. Avec un `setTimeout`, un
report de focus passerait : le focus poserait toujours au vidage de la file.
Aucune assertion n'a donc le droit d'en attendre une, et c'est ce qui
attrape une régression de type 3.

Le stub fait maintenant remonter les événements le long des ancêtres, parce
que les parades sont enregistrées sur le conteneur et non sur chaque bouton.
Sans propagation, elles ne seraient jamais appelées par un test — et une
parade vérifiée dans le vide n'est pas vérifiée.

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
| l'énoncé ne bouge pas quand la hauteur change | `.screen-quiz` sans marge auto |
| la barre d'adresse n'est pas un clavier | `data-keyboard` absent à 790 px |
| l'indicateur d'accueil s'écarte avec le clavier | `data-keyboard="open"` à 508 px |

Vingt-deux régressions ont été introduites puis vérifiées comme détectées : le focus
volé par Suivant, le champ `disabled` après validation, le focus reporté d'une
micro-tâche, la parade retirée, la parade restreinte à un seul bouton,
`readOnly` réintroduit, le `blur()` de fin de série retiré, le focus de
`renderQuestion()` supprimé, la touche retour réduite à une validation, la
touche retour avancée sans avoir validé, l'écran de quiz recentré,
l'`auto` remonté sur le quiz, la marge d'accueil non remise à zéro,
l'attribut renommé d'un seul côté, la variable non consommée, l'écran de
résultat décentré, le retour à `justify-content: center`, la touche retour
réduite à une validation, le gestionnaire `submit` redevenu actif, la parade
du bouton son retirée, la ligne de progression détachée de `--progress-h`, le
centrage appliqué à tous les écrans, et le centrage remplacé par une valeur
mesurée à l'œil.

Trois de ces contrôles ont eux-mêmes eu besoin d'être repris, parce qu'ils
passaient au vert sur du CSS absent :

- une recherche de texte enchaînait la queue d'un sélecteur au corps de la
  règle **suivante** ; les règles sont désormais parsées en `{selecteur: corps}`;
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
  clavier levé. Le calcul dit 469 px de contenu pour 508 px visibles sur un
  iPhone 15, donc 39 px d'air — mais il n'a pas été mesuré sur un appareil.
  Sur un iPhone SE il n'y a que 407 px : le contenu déborde de 62 px et
  `.screen` défile. C'est le seul écran où l'invariant « rien ne bouge » se
  heurte à la taille de l'écran, pas au clavier.

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

