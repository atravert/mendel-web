// Colle entre le quiz (quiz.js), le son (audio.js) et le DOM.
//
// Un seul ecran visible a la fois, comme le `switch` sur `phase` de
// ContentView.swift et les trois panneaux de activity_main.xml.

import {
  QUESTIONS_PER_SERIES,
} from './data.js';

import {
  DIRECTION,
  generateSeries,
  isCorrect,
  displayedPrompt,
  questionTypeText,
  inputHint,
  formatAnswer,
  formulaParts,
  scriptInput,
  correctComment,
  wrongComment,
  finalComment,
  resetCommentHistory,
} from './quiz.js';

import * as sound from './audio.js';

// ---------------------------------------------------------------------------
// Hauteur reellement disponible
// ---------------------------------------------------------------------------

/**
 * La hauteur utile n'est pas celle du viewport de mise en page: c'est celle
 * que le clavier virtuel laisse.
 *
 * Le viewport est le piege de cette application. Deux mecanismes distincts
 * coexistent:
 *
 *   - `interactive-widget=resizes-content` (dans la balise viewport) ne vaut
 *     QUE sur Chrome. Le viewport de mise en page y est retreci des que le
 *     clavier s'ouvre, et `100dvh` suit.
 *   - Sur iOS, ce parametre n'existe pas. Le viewport de mise en page garde
 *     sa hauteur, et c'est le document qui defile pour montrer le champ. Or le
 *     contenu est centre verticalement dans la hauteur PLEINE de l'ecran:
 *     quand le clavier monte, sa moitie basse empiete sur le contenu, et le
 *     bouton Valider se retrouve hors de l'ecran. C'est exactement le
 *     defilement saccade que la demande d'un clavier toujours ouvert cherchait
 *     a supprimer.
 *
 * `visualViewport` est la seule mesure fiable sur les deux systemes, et sa
 * `height` suffit: c'est la hauteur reellement visible, celle que le contenu
 * doit se partager.
 *
 * Son `offsetTop`, en revanche, n'est pas publie, et l'omission est deliberee.
 * Rattraper le defilement d'iOS paraissait le complement naturel, et il est
 * surtout dangereux:
 *
 *   - quand le contenu tient dans la hauteur visible, le document est plus
 *     court que le viewport de mise en page. Il ne defile pas, `offsetTop`
 *     vaut 0, et le decalage ne fait rien;
 *   - quand le contenu deborde -- 503 px de contenu pour 407 px visibles sur
 *     un iPhone SE -- le defilement du document est le seul moyen
 *     d'atteindre ce qui manque. L'annuler le rendrait inatteignable, sans
 *     rien gagner au passage.
 *
 * Le defilement reste donc celui du navigateur, et la feuille de style fait
 * deborder .screen lui-meme, ou le contenu reste entierement atteignable.
 */
function syncViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const root = document.documentElement;
  root.style.setProperty('--app-height', viewport.height + 'px');

  // Clavier ouvert ou non? La hauteur visible suffit: sans clavier elle vaut
  // la hauteur de la fenetre, avec elle elle est nettement plus basse. Le
  // seuil de 80 px couvre la barre d'adresse d'iOS, qui retracte la fenetre
  // de 90 px sans qu'aucun clavier n'existe.
  //
  // Ce n'est qu'un indicateur de mise en page -- zeroer la marge de l'indicateur
  // d'accueil, que le clavier recouvre. Mais c'est 34 px, et 34 px suffisaient
  // a faire deborder l'ecran de quiz sur un petit telephone.
  const clavier = viewport.height < window.innerHeight - 80;
  if (clavier) root.setAttribute('data-keyboard', 'open');
  else root.removeAttribute('data-keyboard');

  // La hauteur vient de changer, donc la place disponible vient de changer:
  // c'est le moment ou un debordement apparait ou disparait. Le mesurer ici,
  // et non seulement au rendu, evite un bandeau qui mentirait entre deux
  // rotations ou deux ouvertures de clavier.
  mesurerDebordement();
}

/**
 * Mesure, sur l'appareil, ce qui ne rentre pas dans la zone visible.
 *
 * C'est P5 dans le README, et l'existence meme de cette fonction est un aveu.
 * Le CSS annoncait 469 px de contenu pour 508 px disponibles sur un iPhone 15:
 * deux nombres CALCULES, jamais mesures. Le premier ne decrivait que l'etat
 * avant reponse, alors que l'etat apres reponse demande jusqu'a 601 px. Un
 * iPhone 15 Pro a refuse le calcul, et le commentaire comme le bouton Suivant
 * ont disparu de l'ecran.
 *
 * Aucune assertion JS ne voit cela: elle verifierait que le commentaire
 * EXISTE -- ce qui est vrai -- et jamais qu'il est sous le clavier. Seule une
 * mesure, sur la machine qui echoue, peut le dire.
 *
 * Le bandeau n'apparait que s'il deborde. Permanent, il serait du bruit qu'on
 * arrete de lire; conditionnel, il ne peut pas etre manque -- et il n'a rien a
 * dire quand tout va bien.
 */
function mesurerDebordement() {
  const bandeau = el.overflowNote;
  const ecran = el.screens.quiz;
  if (!bandeau) return;

  // Sur un ecran masque, `clientHeight` et `scrollHeight` valent 0: leur
  // difference vaut 0, donc le bandeau resterait muet PAR HASARD. On demande
  // l'ecran de quiz nominativement, pour que son silence soit une decision.
  if (ecran.hidden || !ecran.clientHeight) {
    bandeau.hidden = true;
    return;
  }

  // La tolerance d'un pixel: ces deux hauteurs sont arrondies, et un
  // debordement d'un demi-pixel n'a rien de reel. Sans elle, le bandeau
  // pourrait s'afficher sur un ecran qui tient exactement.
  const debordement = ecran.scrollHeight - ecran.clientHeight;
  if (debordement <= 1) {
    bandeau.hidden = true;
    return;
  }

  // Les deux chiffres bruts, parce que ce sont eux qu'il faut rapporter. Un
  // "ca ne rentre pas" ne se corrige pas; "601 px pour 508 px" se corrige.
  bandeau.textContent =
    `Il manque ${debordement} px : ${ecran.scrollHeight} px de contenu pour `
    + `${ecran.clientHeight} px visibles. Defilez pour lire le retour.`;
  bandeau.hidden = false;
}

// ---------------------------------------------------------------------------
// Etat
// ---------------------------------------------------------------------------

const state = {
  topic: 'elements',
  questions: [],
  index: 0,
  score: 0,
  answered: false,
  // 'sub', 'sup', ou null: mode arme par la touche d'indice ou d'exposant.
  // Reinitialise a chaque question, sinon un modearme par erreur
  // contaminerait la question suivante.
  script: null,
};

const el = {
  screens: {
    start: document.getElementById('screen-start'),
    quiz: document.getElementById('screen-quiz'),
    result: document.getElementById('screen-result'),
  },
  soundToggle: document.getElementById('sound-toggle'),
  soundIcon: document.getElementById('sound-icon'),
  progressText: document.getElementById('progress-text'),
  scoreText: document.getElementById('score-text'),
  questionType: document.getElementById('question-type'),
  prompt: document.getElementById('prompt'),
  form: document.getElementById('answer-form'),
  input: document.getElementById('answer-input'),
  symbolBar: document.getElementById('symbol-bar'),
  validateButton: document.getElementById('validate-button'),
  feedback: document.getElementById('feedback'),
  nextButton: document.getElementById('next-button'),
  actions: document.getElementById('actions'),
  overflowNote: document.getElementById('overflow-note'),
  resultComment: document.getElementById('result-comment'),
  resultScore: document.getElementById('result-score'),
  restartButton: document.getElementById('restart-button'),
  changeButton: document.getElementById('change-button'),
  installArea: document.getElementById('install-area'),
  installButton: document.getElementById('install-button'),
  installHint: document.getElementById('install-hint'),
  versionStart: document.getElementById('version-start'),
  versionResult: document.getElementById('version-result'),
};

// Le scroll est ecoute avec le resize: sur iOS le deplacement de la barre
// d'adresse retrecit le viewport sans emettre de `resize`.
//
// APRES `el`, et l'ordre n'est pas indifferent. `syncViewport()` mesure
// immediatement -- la hauteur d'abord, puis le debordement -- donc elle lit
// `el.overflowNote`; appelee plus tot, elle tomberait sur le `const` encore
// non initialise, qui est une ReferenceError et non un `undefined` silencieux.
// Le module ne se chargerait donc pas du tout, et l'ecran resterait vide
// sans rien indiquer.
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewport);
  window.visualViewport.addEventListener('scroll', syncViewport);
  syncViewport();
}

// Les touches d'indice et d'exposant sont listees a part des touches
// d'insertion: elles n'inserent rien, elles arment un mode.
const scriptKeys = Array.from(el.symbolBar.querySelectorAll('[data-script]'));

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function showScreen(name) {
  for (const [key, node] of Object.entries(el.screens)) {
    node.hidden = key !== name;
  }
  // L'ecran courant, publie sur `<html>`. Sans lui, la seule facon de
  // demander "suis-je sur l'ecran de quiz?" en CSS est `:has()`, qui demande
  // Safari 15.4. Un attribut, lui, marche partout -- et il se teste.
  document.documentElement.dataset.screen = name;
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

/**
 * Ecrit une formule avec de vrais <sub>/<sup>, plutot qu'avec les caracteres
 * Unicode de prettyFormula: le texte reste selectionnable et se kopie
 * correctement, et l'indexage des chiffres est net a l'ecran.
 *
 * On passe par textContent, jamais innerHTML: le contenu vient de data.js
 * mais la manip est la meme que pour une saisie utilisateur.
 */
function renderFormula(node, formula) {
  node.textContent = '';
  for (const part of formulaParts(formula)) {
    if (part.script) {
      const script = document.createElement(part.script === 'sub' ? 'sub' : 'sup');
      script.textContent = part.text;
      node.appendChild(script);
    } else {
      node.appendChild(document.createTextNode(part.text));
    }
  }
}

/** La reparation attend une formule d'ion, avec ^ et - a saisir au doigt. */
function expectsFormula(question) {
  return question.topic === 'ions' && question.direction === DIRECTION.NAME_TO_CODE;
}

function renderQuestion() {
  const question = state.questions[state.index];

  el.progressText.textContent =
    `Question ${state.index + 1} / ${state.questions.length}`;
  el.scoreText.textContent = `Score : ${state.score}`;

  el.questionType.textContent = questionTypeText(question);

  const prompt = displayedPrompt(question);
  if (question.direction === DIRECTION.CODE_TO_NAME && question.topic === 'ions') {
    renderFormula(el.prompt, prompt);
  } else {
    el.prompt.textContent = prompt;
  }

  el.input.value = '';
  el.input.placeholder = inputHint(question);
  el.validateButton.disabled = true;   // rien a valider tant que le champ est vide
  el.validateButton.hidden = false;    // le bouton mort rend la place a l'enonce
  el.feedback.hidden = true;
  el.feedback.textContent = '';
  el.feedback.className = 'feedback';
  el.nextButton.hidden = true;

  // Symetrique de validate(): l'enonce et le type de question reviennent, et
  // l'etat `data-answered` -- qui fait disparaitre le premier -- part avec.
  // Les deux vont ensemble: n'en laisser qu'un des deux mettrait l'ecran dans
  // un etat qui n'existe pas.
  document.documentElement.removeAttribute('data-answered');

  el.symbolBar.hidden = !expectsFormula(question);
  setScript(null);

  // Le curseur doit etre dans le champ des la question posee, sans que
  // l'utilisateur ait a toucher la case. D'ou le focus ici, et pas plus tard.
  //
  // SYNCHRONE, et c'est le point delicat. Aucun navigateur ne leve le clavier
  // virtuel en dehors d'un geste utilisateur -- c'est une regle de securite,
  // pas une limite d'iOS. Reporter le focus a la tache suivante (ce qu'on
  // faisait, avec un jeton `focusSequence` pour eviter un focus fantome) sort
  // du geste: le champ est bien focus, le curseur y entre, et le clavier ne
  // se leve pas. Le report rendait les choses PIRES, pas meilleures.
  //
  // Chaque entree dans renderQuestion() passe par un clic: le bouton de serie
  // sur l'ecran d'accueil, Suivant, ou Une nouvelle serie. Tous sont des
  // gestes, donc un focus synchrone y est toujours dans le geste. Il suffit
  // donc de ne jamais passer par une promesse ni par une minuterie -- ce que
  // startQuiz() ne fait pas.
  el.input.focus();

  // Le focus vient d'etre pose, donc le clavier se leve -- ou va se lever. La
  // hauteur visible n'est donc pas encore celle de l'etat qui vient d'etre
  // affiche, et c'est le meilleur moment pour mesurer: ce qui sera visible
  // dans une seconde l'est deja, et c'est precisement ce qui compte.
  mesurerDebordement();
}

function renderFeedback(correct) {
  const question = state.questions[state.index];

  el.feedback.className = correct ? 'feedback feedback--correct' : 'feedback feedback--wrong';
  // Le commentaire doit suivre le resultat: "`Nickel chrome !`" apres une
  // mauvaise reponse serait absurde. Les deux familles existent dans data.js,
  // il ne fallait qu'un choix.
  el.feedback.textContent = correct ? correctComment() : wrongComment();

  if (!correct) {
    el.feedback.appendChild(document.createTextNode('\nLa bonne réponse était : '));
    const answer = formatAnswer(question);
    if (question.direction === DIRECTION.NAME_TO_CODE && question.topic === 'ions') {
      renderFormula(el.feedback, answer);
    } else {
      el.feedback.appendChild(document.createTextNode(answer));
    }
  }

  el.feedback.hidden = false;
}

function renderResult() {
  el.resultComment.textContent =
    finalComment(state.score, state.questions.length);
  el.resultScore.textContent = `Score : ${state.score} / ${state.questions.length}`;
  showScreen('result');

  // Seul moment de la serie ou le clavier doit se fermer, donc il faut lui
  // retirer le focus explicitement. Sans cela, il reste dans un champ devenu
  // invisible -- un champ masque ne rend pas le focus, et le navigateur peut
  // garder le clavier leve par-dessus l'ecran de resultat. C'est le seul
  // blur() de l'application.
  el.input.blur();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function startQuiz(topicId) {
  state.topic = topicId;
  state.questions = generateSeries(topicId, QUESTIONS_PER_SERIES);
  state.index = 0;
  state.score = 0;
  state.answered = false;
  resetCommentHistory();

  sound.unlock();
  showScreen('quiz');
  renderQuestion();
}

function validate() {
  // Garde-fou: sans lui, valider deux fois compterait deux fois le score.
  if (state.answered) return;

  const question = state.questions[state.index];
  if (!el.input.value.trim()) return;   // rien saisi: on ne comptabilise rien

  const correct = isCorrect(el.input.value, question);

  state.answered = true;
  if (correct) state.score += 1;

  el.scoreText.textContent = `Score : ${state.score}`;
  // Ni `disabled` ni `readOnly` sur le champ, et c'est volontaire.
  //
  // `disabled` rend l'element infocalisable: le focus le quitte sur-le-champ,
  // le clavier se ferme, et la hauteur visible change -- l'ecran saute. Une
  // fois sur deux, ce n'est pas un detail d'apparence mais un tremblement.
  // `readOnly` garde le focus mais fait disparaitre le clavier sur iOS: meme
  // tremblement, autre cause.
  //
  // Le verrou n'a pas besoin d'eux. `state.answered` tient deja la reponse
  // comptee, et `validate()` s'y arrete: retaper ne recompte rien. Le champ
  // reste donc saisissable apres la reponse -- ce qui n'a rien de geneant,
  // puisque Suivant efface tout.
  el.validateButton.disabled = true;

  // Le bouton Valider disparait au lieu de se griser. C'est P1 dans le README.
  //
  // `disabled` le rendait gris et le LAISSAIT en place: 48 px du budget
  // vertical pour une action morte, a l'endroit exact ou la place manquait.
  // Deux boutons a l'ecran alors qu'un seul fait quelque chose, c'est aussi
  // deroutant. Les deux occupaient la meme place dans la barre d'action, donc
  // en masquer un revient a zero.
  //
  // `disabled` reste pose malgre le masquage: c'est le verrou reel, et il doit
  // tenir meme si quelque chose reapparait le bouton par erreur.
  el.validateButton.hidden = true;

  // L'etat passe par le `<html>` plutot que par une classe sur l'ecran, pour
  // que le CSS masque l'enonce sans connaitre la structure de
  // `#screen-quiz`. Meme choix que `data-screen`, et pour la meme raison.
  document.documentElement.setAttribute('data-answered', '1');

  if (correct) sound.playCorrect();
  else sound.playWrong();

  renderFeedback(correct);

  el.nextButton.textContent =
    state.index === state.questions.length - 1 ? 'Voir le résultat' : 'Question suivante';
  el.nextButton.hidden = false;

  // Surtout pas `nextButton.focus()`, qui fut la premiere version: deplacer le
  // focus hors du champ ferme le clavier, donc retrecit le viewport, donc fait
  // sauter l'ecran -- puis Suivant le rouvre, et l'ecran saute une seconde
  // fois. Deux sautes par question, exactement ce que "le clavier ne bouge
  // plus" exclut. Le focus reste dans le champ, et l'ecouteur `pointerdown`
  // plus bas empeche meme le navigateur de le lui prendre.

  // La forme du contenu vient de changer d'une centaine de px -- l'enonce a
  // disparu, le bouton Valider aussi. C'est donc le moment ou la hauteur
  // disponible compte le plus, et le moment ou il faut la MESURER.
  mesurerDebordement();
}

function next() {
  if (!state.answered) return;

  if (state.index < state.questions.length - 1) {
    state.index += 1;
    state.answered = false;
    renderQuestion();
  } else {
    renderResult();
  }
}

/**
 * Valider ne s'active que s'il y a quelque chose a valider, comme sur iOS
 * (QuizView.swift:47). Appele apres chaque modification du champ, saisie au
 * clavier comme insertion d'un symbole.
 */
function refreshValidateButton() {
  if (!state.answered) {
    el.validateButton.disabled = !el.input.value.trim();
  }
}

/** Insere un caractere a la position du curseur, pas a la fin. */
function insertAtCursor(text) {
  const field = el.input;
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;

  field.value = field.value.slice(0, start) + text + field.value.slice(end);
  const caret = start + text.length;
  field.setSelectionRange(caret, caret);
  field.focus();

  // Ecriture directe dans .value: aucun evenement `input` n'est emis
  // automatiquement, donc le bouton Valider resterait inactif et le joueur
  // taperait sur un bouton gris. On le reactive explicitement.
  refreshValidateButton();
}

/**
 * Arme ou desarme un mode de saisie, et reflete l'etat dans les touches.
 *
 * Le mode n'insere rien: il change ce que la prochaine frappe produit. Une
 * touche armee reste allumee, sinon le joueur ne sait plus s'il tape en
 * indice ou en base apres avoir leve le doigt.
 */
function setScript(mode) {
  state.script = mode;
  for (const key of scriptKeys) {
    key.setAttribute('aria-pressed', String(key.dataset.script === mode));
  }
}

/**
 * Une touche d'indice ou d'exposant: arme le mode correspondant, ou le
 * desarme si elle etait deja activee. Reappuyer est donc le moyen de sortir
 * sans avoir a taper un caractere de sortie.
 */
function toggleScript(mode) {
  setScript(state.script === mode ? null : mode);
}

/**
 * La frappe du clavier est traduite quand un mode est arme: scriptInput()
 * dit quoi inserer, et si le mode survit. Un chiffre, "+" ou "-" restent
 * dans le mode, tout autre caractere en sort.
 *
 * Le caractere est insere a la main, donc `preventDefault()` est
 * indispensable: sans lui le navigateur insererait aussi le "3" ASCII et on
 * obtiendrait "SO₄3".
 */
/**
 * Le geste de confirmation, quel que soit le doigt qui le fait.
 *
 * La touche retour du clavier, et le bouton Valider. `state.answered` fait
 * l'arbitrage: une reponse non encore comptee est comptee, une reponse deja
 * comptee fait passer a la suite. C'est aussi le garde-fou -- le point gagne
 * une fois ne peut pas l'etre deux, quelle que soit la touche.
 */
function onEnter() {
  if (state.answered) next();
  else validate();
}

function onKeydown(event) {
  // La touche retour passe par ICI, et volontairement pas par la soumission du
  // formulaire. Mesure de terrain: sur iPhone, la premiere pression valait
  // bien la reponse -- l'auto-soumission du formulaire fonctionne -- mais la
  // seconde ne passait pas a la question suivante. Un chemin qui depend d'un
  // comportement d'auto-soumission n'est pas un chemin fiable, meme quand il
  // parait marcher.
  //
  // D'ou la regle qui rend le double declenchement impossible: UNE source
  // d'entree, UN chemin.
  //
  //   - la touche retour passe par keydown, ici meme;
  //   - le bouton Valider est `type="button"` et porte son propre `click`.
  //
  // Il n'y a donc aucune soumission implicite a arbitrer, donc aucune
  // fenetre de course entre les deux. Ecouter a la fois `keydown` ET `submit`
  // aurait para plus robuste, et aurait introduce exactement le defaut qu'on
  // cherche a eviter: une seule pression qui valide ET avance, donc une
  // question sautee par accident. `SubmitEvent.submitter`, qui distingue les
  // deux sources, n'est disponible que depuis Safari 15.4 -- trop recent pour
  // etre pose ici.
  if (event.key === 'Enter') {
    // Annule la soumission implicite. Sans cela, le navigateur soumet le
    // formulaire, et le gestionnaire `submit` -- volontairement vide, plus
    // bas -- ne ferait rien: le resultat serait le meme, mais par un chemin
    // qu'on ne maitrise pas.
    event.preventDefault();
    // Un mode d'indice ou d'exposant arme est invalide des que la reponse
    // est comptee: il annonce ce que la PROCHAINE frappe inserera, et il
    // n'y aura pas de prochaine frappe dans cette question.
    setScript(null);
    onEnter();
    return;
  }

  const step = scriptInput(state.script, event.key);
  if (!step) return;

  if (step.char !== null) {
    event.preventDefault();
    insertAtCursor(step.char);
  }
  setScript(step.mode);
}

/**
 * Une touche d'insertion de la barre. Elle passe par la meme traduction que
 * la frappe clavier, sinon "+" et "-" seraient sourds au mode arme alors
 * qu'ils servent presque toujours a ecrire la charge: c'est precisement le
 * cas pour lequel on arme l'exposant. Les chiffres aussi, ce qui permet de
 * composer une formule entiere au doigt, sans clavier.
 *
 * Une parenthese, elle, n'existe qu'en indice ou en exposant: elle est donc
 * inseree telle quelle et fait sortir du mode, comme une lettre au clavier.
 */
function onInsertKey(key) {
  const value = key.dataset.insert;
  const step = scriptInput(state.script, value);
  insertAtCursor(step && step.char !== null ? step.char : value);
  if (step) setScript(step.mode);
}

function updateSoundButton() {
  const on = sound.isEnabled();
  el.soundIcon.textContent = on ? '🔊' : '🔇';
  el.soundToggle.setAttribute('aria-pressed', String(on));
  el.soundToggle.querySelector('.visually-hidden').textContent =
    on ? 'Couper le son' : 'Activer le son';
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

let deferredInstallPrompt = null;

function setupInstall() {
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    el.installArea.hidden = false;
    el.installButton.hidden = false;
  });

  el.installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    el.installButton.hidden = true;
  });

  // iOS n'emet pas beforeinstallprompt: on ne peut que lui dire quoi faire.
  const isIos = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos) {
    el.installArea.hidden = false;
    el.installHint.hidden = false;
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.warn('service worker non enregistre', error);
    });
  });
}

// ---------------------------------------------------------------------------
// Branchement
// ---------------------------------------------------------------------------

for (const button of document.querySelectorAll('[data-topic]')) {
  button.addEventListener('click', () => startQuiz(button.dataset.topic));
}

/**
 * Le formulaire ne fait plus que porter la semantique -- un champ et son
 * bouton de confirmation, grouping utile aux lecteurs d'ecran.
 *
 * Il n'est plus le mecanisme de la touche retour: celle-ci passe par
 * `onKeydown`, et le bouton est `type="button"`. Chaque source d'entree a
 * donc son chemin, et aucun n'a de course possible avec l'autre.
 *
 * Il ne reste ici qu'une garde, et elle est necessaire: le formulaire n'a plus
 * de bouton de soumission, mais un formulaire a un seul champ reste soumis
 * implicitement par la touche retour sur certains navigateurs. Sans cette
 * garde, la page pourrait se recharger en plein milieu d'une serie. Elle ne
 * fait rien d'autre, deliberement -- appeler `onEnter()` ici retablirait
 * exactement la course que le decoupage ci-dessus supprime.
 */
el.form.addEventListener('submit', (event) => {
  event.preventDefault();
});

el.validateButton.addEventListener('click', onEnter);

el.nextButton.addEventListener('click', next);
el.restartButton.addEventListener('click', () => startQuiz(state.topic));
el.changeButton.addEventListener('click', () => showScreen('start'));

// Le numero de version, sur l'ecran d'accueil et sur celui du resultat: les
// deux moments ou l'on regarde l'ecran sans etre en plein dans une serie.
//
// Il vient du `<meta name="app-version">`, ecrit par le meme outil que
// CACHE_VERSION, et verifie egalement par `make`. C'est donc le numero du
// cache que CET appareil sert reellement, pas une etiquette.
for (const node of [el.versionStart, el.versionResult]) {
  const version = document.querySelector('meta[name="app-version"]');
  node.textContent = version ? `version ${version.content}` : 'version inconnue';
}

el.soundToggle.addEventListener('click', () => {
  sound.toggle();
  updateSoundButton();
});

// Empêcher le retrait du focus: sans cela, taper sur une touche de la barre
// de symboles ferme le clavier a chaque fois. `pointerdown` couvre souris,
// tactile et stylet, la ou `mousedown` manque sur les appareils tactiles.
el.symbolBar.addEventListener('pointerdown', (event) => {
  if (event.target.closest('.key')) event.preventDefault();
});

// Meme parade pour TOUS les boutons de l'ecran de quiz, Valider et Suivant
// compris. C'est ce qui rend le clavier immobile d'une question a l'autre:
// un bouton qui prend le focus vide le champ, donc ferme le clavier, donc
// retrecit le viewport de 508 a 844 px -- et toute la page se recentre. Deux
// sautes par question.
//
// Annuler `pointerdown` n'empeche pas le clic: la frappe du bouton a toujours
// lieu, seule la perte de focus est supprimee. Le `click` suit toujours le
// `pointerdown`, donc la validation et l'enchainement ne dependent pas du
// defilement du doigt, comme sur les deux natives.
el.screens.quiz.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button')) event.preventDefault();
});

// Le bouton son a besoin de la meme parade, et pour une raison qui n'existait
// pas avant: il est centre sur la ligne de progression, donc il est
// VISUELLEMENT dans l'ecran de quiz, mais il reste un enfant de `body` -- il
// est en `position: fixed` pour passer au-dessus des trois ecrans. Le
// conteneur #screen-quiz ne le contient donc pas, et la parade ci-dessus ne
// le voit pas.
//
// Un bouton qui prend le focus vide le champ, le clavier se ferme, le viewport
// passe de 508 a 844 px, et toute la page se recentre. Autrement dit: baisser
// le son en pleine serie declenche exactement le tremblement que la parade
// vient d eliminer, et par la meme cause.
el.soundToggle.addEventListener('pointerdown', (event) => {
  event.preventDefault();
});

// Et meme parade pour les DEUX boutons d'action, pour la meme raison que le
// bouton son: ils sont visuellement dans l'ecran de quiz, mais ils n'en sont
// pas les descendants. Ils vivent dans la zone d'action, enfant de la coque,
// pour etre hors du conteneur qui defile et donc toujours au bas de la zone
// visible (voir P3 dans le README). La parade portee par #screen-quiz ne les
// voit donc pas.
//
// Sans elle, Valider et Suivant reprennent le focus, le champ le perd, le
// clavier se ferme, le viewport passe de 508 a 844 px, et tout l'ecran saute --
// c'est-a-dire exactement le defaut que la parade vient d eliminer, revenu par
// la porte de la correction.
//
// Le motif est donc general: tout bouton visible dans l'ecran de quiz mais
// place ailleurs dans l'arbre doit porter sa parade. Les deux conteneurs
// concernes sont ici, et chacun a la sienne. Les reprendre serait faire
// revenir le tremblement sans qu'aucune assertion ne le voie: elles verifient
// la parade sur son conteneur, pas sa portee.
el.actions.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button')) event.preventDefault();
});

for (const key of el.symbolBar.querySelectorAll('[data-insert]')) {
  key.addEventListener('click', () => onInsertKey(key));
}

for (const key of scriptKeys) {
  key.addEventListener('click', () => toggleScript(key.dataset.script));
}

el.input.addEventListener('input', refreshValidateButton);
el.input.addEventListener('keydown', onKeydown);

// Filet de securite pour la touche retour, et lui SEULEMENT.
//
// Ecoute principale: `keydown` sur le champ, ci-dessus. Elle suppose que le
// champ a le focus, parce qu'un navigateur n'envoie `keydown` qu'a l'element
// focus. Or le champ perd le focus sans qu'on l'ait voulu: iOS ferme la barre
// de suggestions quand une correction est validee et retire le focus, Android
// fait de meme quand il valide un mot propose. Le clavier se ferme, la
// touche retour n'atteint plus rien, et la question avance de deux pressions
// sur deux -- sans que rien dans l'application explique pourquoi.
//
// D'ou cette seconde ecoute, au niveau du document, qui recupere la touche
// retour meme quand le champ ne l'a plus.
//
// Elle ne peut pas declencher deux fois, et c'est la seule chose qui compte
// ici. Une double validation voit `onEnter()` valider PUIS avancer d'un coup:
// la question est sautee, silencieusement, et le score du joueur est faux. Les
// deux chemins sont donc exclusifs par construction, et non par convention:
//
//   - le champ a le focus  -> l'ecoute de ci-dessus a deja traite, on ne
//     touche a rien (c'est le cas normal, le seul teste);
//   - le champ n'a pas le focus -> c'est ici que la touche etait perdue.
//
// Le test de focus est donc une condition de correction, pas une commodite:
// c'est lui qui empeche de sauter une question.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  // Le champ a le focus: la premiere ecoute s'en est chargee.
  if (document.activeElement === el.input) return;
  // Un bouton a le focus est active par le retour: son propre `click` fait
  // le travail, et le reproduire ici le ferait deux fois.
  if (event.target && event.target.closest && event.target.closest('button')) return;
  // Pas en serie: la touche retour n'a rien a confirmer.
  if (el.screens.quiz.hidden) return;
  event.preventDefault();
  setScript(null);
  onEnter();
});

// Le navigateur n'autorise une lecture audio qu'a partir d'un geste
// utilisateur. On ouvre le contexte des le premier appui, puis on retente
// la musique a chaque appui tant qu'elle n'a pas demarre: un refus passager
// ne doit pas la bloquer definitivement.
document.addEventListener('pointerdown', function onGesture() {
  sound.unlock();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) el.input.blur();
});

// L'ecran d'accueil est visible par le balisage, sans passer par
// showScreen(): le CSS s'y fie pour centrer l'icone du son sur l'ecran de
// quiz, donc `data-screen` doit etre pose des le demarrage et non au premier
// changement d'ecran. Idempotent: les trois ecrans sont deja dans le bon etat.
showScreen('start');

updateSoundButton();
setupInstall();
registerServiceWorker();
