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
  resultComment: document.getElementById('result-comment'),
  resultScore: document.getElementById('result-score'),
  restartButton: document.getElementById('restart-button'),
  changeButton: document.getElementById('change-button'),
  installArea: document.getElementById('install-area'),
  installButton: document.getElementById('install-button'),
  installHint: document.getElementById('install-hint'),
};

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
  el.input.disabled = false;
  el.validateButton.disabled = true;   // rien a valider tant que le champ est vide
  el.feedback.hidden = true;
  el.feedback.textContent = '';
  el.feedback.className = 'feedback';
  el.nextButton.hidden = true;

  el.symbolBar.hidden = !expectsFormula(question);
  setScript(null);

  // Le champ reprend le focus a chaque question, donc le clavier virtuel se
  // rouvre tout seul. Le laisser tel quel obligerait a chaque enchainement a
  // un aller-retour entre le clavier et le bouton Suivant, et la question
  // suivante n'apparaitrait qu'apres: le defilement sautillait.
  el.input.focus();
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
  el.input.disabled = true;
  el.validateButton.disabled = true;

  if (correct) sound.playCorrect();
  else sound.playWrong();

  renderFeedback(correct);

  el.nextButton.textContent =
    state.index === state.questions.length - 1 ? 'Voir le résultat' : 'Question suivante';
  el.nextButton.hidden = false;
  el.nextButton.focus();
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
function onKeydown(event) {
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

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  validate();
});

el.nextButton.addEventListener('click', next);
el.restartButton.addEventListener('click', () => startQuiz(state.topic));
el.changeButton.addEventListener('click', () => showScreen('start'));

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

for (const key of el.symbolBar.querySelectorAll('[data-insert]')) {
  key.addEventListener('click', () => onInsertKey(key));
}

for (const key of scriptKeys) {
  key.addEventListener('click', () => toggleScript(key.dataset.script));
}

el.input.addEventListener('input', refreshValidateButton);
el.input.addEventListener('keydown', onKeydown);

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

updateSoundButton();
setupInstall();
registerServiceWorker();
