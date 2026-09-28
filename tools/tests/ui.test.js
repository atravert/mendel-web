// Tests de la machine a etats de js/ui.js, executes sur le faux DOM de
// dom-stub.js.
//
// Ce que cela couvre: passage d'un ecran a l'autre, score, garde-fous contre
// la double validation, enchainement des dix questions, affichage du retour
// juste, barre de symboles. Ce que cela ne couvre pas: la mise en page, le
// clavier reel, le son, le service worker -- seul un navigateur le ferait, et
// aucun n'est pilotable sur cette machine.

const dom = wireDom(document);
const input = dom.input;

function screen(name) {
  return document.getElementById('screen-' + name);
}

function visible(name) {
  return !screen(name).hidden;
}

function startTopic(topicId) {
  const buttons = document.querySelectorAll('[data-topic]');
  const button = buttons.filter((b) => b.dataset.topic === topicId)[0];
  button.fire('click');
}

function submit() {
  document.getElementById('answer-form').fire('submit');
}

/** Simule une frappe: le champ se remplit et l'evenement input se declenche. */
function type(text) {
  input.value = text;
  input.fire('input', { target: input });
}

/**
 * Retrouve la reponse attendue a partir de l'enonce affiche. Evite d'exposer
 * l'etat interne de ui.js pour les tests.
 */
function expectedAnswer(prompt) {
  const byElementName = ELEMENTS.filter((e) => e.name === prompt)[0];
  if (byElementName) return byElementName.symbol;

  const byIonName = IONS.filter((i) => i.name === prompt)[0];
  if (byIonName) return byIonName.formula;

  const bySymbol = ELEMENTS.filter((e) => formatSymbol(e.symbol) === prompt)[0];
  if (bySymbol) return bySymbol.name;

  // Formule d'ion rendue: les <sub>/<sup> sont a plat dans renderedText, et le
  // "caret" de la source a disparu.
  const flattened = prompt.replace('^', '');
  const byFormula = IONS.filter((i) => i.formula.replace('^', '') === flattened)[0];
  if (byFormula) return byFormula.name;

  return null;
}

function currentPrompt() {
  return document.getElementById('prompt').textContent;
}

// ---------------------------------------------------------------------------
// Ecran de depart
// ---------------------------------------------------------------------------

check('l\'ecran de depart est visible au chargement', visible('start'), true);
check('le quiz est masque au chargement', visible('quiz'), false);
check('le resultat est masque au chargement', visible('result'), false);

// ---------------------------------------------------------------------------
// Demarrage d'une serie d'elements
// ---------------------------------------------------------------------------

startTopic('elements');

check('le quiz devient visible', visible('quiz'), true);
check('l\'ecran de depart est masque', visible('start'), false);
check('progression 1/10', document.getElementById('progress-text').textContent,
  'Question 1 / 10');
check('score a zero', document.getElementById('score-text').textContent, 'Score : 0');
check('un enonce est affiche', currentPrompt().length > 0, true);
check('un type de question est affiche',
  document.getElementById('question-type').textContent.length > 0, true);
check('le champ est vide', input.value, '');
check('le champ est actif', input.disabled, false);
check('Valider est inactif tant que le champ est vide',
  document.getElementById('validate-button').disabled, true);
check('le retour est masque', document.getElementById('feedback').hidden, true);
check('le bouton Suivant est masque', document.getElementById('next-button').hidden, true);
check('pas de barre de symboles pour un element', document.getElementById('symbol-bar').hidden, true);
check('l\'enonce est compose de texte simple', currentPrompt().indexOf('<') === -1, true);

// ---------------------------------------------------------------------------
// Reponse juste
// ---------------------------------------------------------------------------

{
  const answer = expectedAnswer(currentPrompt());
  check('l\'enonce correspond a une entree connue', answer !== null, true);

  type(answer);
  check('Valider devient actif apres saisie',
    document.getElementById('validate-button').disabled, false);
  submit();

  check('score incremente', document.getElementById('score-text').textContent, 'Score : 1');
  check('retour au vert', document.getElementById('feedback').className,
    'feedback feedback--correct');
  check('le retour est visible', document.getElementById('feedback').hidden, false);
  check('le champ se verrouille', input.disabled, true);
  check('Valider se verrouille', document.getElementById('validate-button').disabled, true);
  check('le bouton Suivant apparait', document.getElementById('next-button').hidden, false);
  check('le bouton dit Suivant', document.getElementById('next-button').textContent,
    'Question suivante');
  check('pas de bonne reponse revelee quand c\'est juste',
    document.getElementById('feedback').textContent.indexOf('bonne réponse') === -1, true);
  // Le commentaire doit venir de la bonne famille. Sans cette assertion, un
  // "Nickel chrome !" apres une mauvaise reponse passait tous les tests: seule
  // la classe CSS etait verifiee.
  check('le commentaire appartient a la famille "juste"',
    COMMENTS.correct.indexOf(document.getElementById('feedback').textContent) !== -1, true);

  // Garde-fou: une seconde validation ne doit pas recompter le point.
  type(answer);
  submit();
  check('le score ne bouge pas si on valide deux fois',
    document.getElementById('score-text').textContent, 'Score : 1');
}

// ---------------------------------------------------------------------------
// Question suivante
// ---------------------------------------------------------------------------

const firstPrompt = currentPrompt();
document.getElementById('next-button').fire('click');

check('progression 2/10', document.getElementById('progress-text').textContent,
  'Question 2 / 10');
check('le score est conserve', document.getElementById('score-text').textContent, 'Score : 1');
check('le champ est vide', input.value, '');
check('le champ redevient actif', input.disabled, false);
check('le retour est masque', document.getElementById('feedback').hidden, true);
check('le bouton Suivant est masque', document.getElementById('next-button').hidden, true);
ok('la question 2 est differente de la question 1', currentPrompt() !== firstPrompt);

// ---------------------------------------------------------------------------
// Reponse fausse
// ---------------------------------------------------------------------------

{
  type('uneReponseQuiNexistePas');
  submit();

  check('retour en rouge', document.getElementById('feedback').className,
    'feedback feedback--wrong');
  check('la bonne reponse est revelee',
    document.getElementById('feedback').textContent.indexOf('La bonne réponse était : ') !== -1,
    true);
  // Le texte affiche apres la mauvaise reponse commence par le commentaire,
  // puis la revelation. On ne teste donc que la premiere ligne. C'est
  // l'assertion qui manquait: elle seule distingue "Aïe, raté !" de
  // "Nickel chrome !".
  const shown = document.getElementById('feedback').textContent.split('\n')[0];
  check('le commentaire appartient a la famille "faux"',
    COMMENTS.wrong.indexOf(shown) !== -1, true);
  check('aucun commentaire de la famille "juste" ne peut apparaitre ici',
    COMMENTS.correct.indexOf(shown) === -1, true);
  check('le score n\'augmente pas', document.getElementById('score-text').textContent, 'Score : 1');
}

// ---------------------------------------------------------------------------
// Champ vide: on ne compte rien, et rien ne se passe
// ---------------------------------------------------------------------------

document.getElementById('next-button').fire('click');
{
  type('   ');
  submit();
  check('une reponse vide ne compte pas',
    document.getElementById('score-text').textContent, 'Score : 1');
  check('Valider se reactive des que le champ se vide',
    document.getElementById('validate-button').disabled, true);
  check('une reponse vide ne valide pas la question',
    document.getElementById('next-button').hidden, true);
  check('aucun retour affiche sur saisie vide',
    document.getElementById('feedback').hidden, true);
}

// ---------------------------------------------------------------------------
// Serie d'ions: barre de symboles et rendu des indices
// ---------------------------------------------------------------------------

screen('start');
startTopic('ions');
check('serie d\'ions affichee', document.getElementById('progress-text').textContent,
  'Question 1 / 10');

{
  // Chercher une question "formule attendue" (donc avec barre de symboles).
  let found = null;
  for (let step = 0; step < 10 && !found; step += 1) {
    if (!document.getElementById('symbol-bar').hidden) found = step;
    else {
      type(expectedAnswer(currentPrompt()) || 'x');
      submit();
      document.getElementById('next-button').fire('click');
    }
  }
  ok('une question de formule est atteinte dans la serie', found !== null);

  check('barre de symboles visible pour une formule',
    document.getElementById('symbol-bar').hidden, false);

  // Le rendu des indices doit produire de vrais <sub>/<sup>.
  const formula = expectedAnswer(currentPrompt());
  input.value = 'mauvaise';
  submit();
  const feedback = document.getElementById('feedback');
  const scripts = feedback.children.filter((c) => c.tagName === 'SUB' || c.tagName === 'SUP');
  check('la reponse revelee utilise des <sub>/<sup> pour une formule',
    scripts.length > 0, true);
  check('les <sub>/<sup> sont bien des elements du DOM',
    feedback.children.map((c) => c.tagName).join(',').indexOf('SUB') !== -1
    || feedback.children.map((c) => c.tagName).join(',').indexOf('SUP') !== -1, true);
  ok('la formule revelee est bien celle attendue', formula !== null);
}

// ---------------------------------------------------------------------------
// Barre de symboles: insertion au curseur
// ---------------------------------------------------------------------------

screen('start');
startTopic('ions');
{
  // Atteindre une question de formule.
  for (let step = 0; step < 10; step += 1) {
    if (!document.getElementById('symbol-bar').hidden) break;
    type(expectedAnswer(currentPrompt()) || 'x');
    submit();
    document.getElementById('next-button').fire('click');
  }
}
check('sur une formule, la barre est visible',
  document.getElementById('symbol-bar').hidden, false);

input.value = 'SO4';
input.setSelectionRange(4, 4);
dom.keys[0].fire('click');           // touche "^"
check('le caractere est insere au curseur', input.value, 'SO4^');
check('le curseur avance', input.selectionStart, 5);

dom.keys[1].fire('click');           // touche "-"
check('second caractere insere', input.value, 'SO4^-');

input.value = 'ClO3';
input.setSelectionRange(0, 0);
dom.keys[1].fire('click');
check('insertion en debut de champ', input.value, '-ClO3');

input.setSelectionRange(1, 3);
dom.keys[2].fire('click');           // touche "+"
check('insertion dans une selection', input.value, '-+O3');

// Regression: inserer un symbole ecrit dans .value sans emettre d'evenement
// `input`. Si le bouton Valider n'etait pas reactive explicitement, il restait
// gris et le joueur tapait dans le vide.
{
  const validateButton = document.getElementById('validate-button');
  input.value = '';
  validateButton.disabled = true;
  dom.keys[0].fire('click');
  check('inserer un symbole reactive Valider', validateButton.disabled, false);
}

{
  // pointerdown et non mousedown: c'est l'evenement que les appareils
  // tactiles emettent reellement, et le code s'appuie dessus.
  const event = dom.symbolBar.fire('pointerdown', { target: dom.keys[0] });
  check('la barre empeche la perte de focus', event.defaultPrevented, true);

  const horsTouche = dom.symbolBar.fire('pointerdown', {
    target: { closest: () => null },
  });
  check('le clic hors des touches n\'est pas bloque', horsTouche.defaultPrevented, undefined);
}

// ---------------------------------------------------------------------------
// Clavier
// ---------------------------------------------------------------------------

check('le champ a le focus au debut', document.activeElement === input, true);
{
  const before = input.focused;
  document.getElementById('toggle-keyboard').fire('click');
  check('le clavier se ferme', input.blurred > 0, true);
  check('l\'etat est memorise',
    document.getElementById('toggle-keyboard').getAttribute('aria-pressed'), 'true');

  // Une nouvelle question ne doit pas rouvrir un clavier que l'utilisateur
  // a volontairement ferme.
  type(expectedAnswer(currentPrompt()) || 'x');
  submit();
  document.getElementById('next-button').fire('click');
  check('le clavier ne se rouvre pas tout seul', input.focused, before);

  document.getElementById('toggle-keyboard').fire('click');
  check('le champ reprend le focus', document.activeElement === input, true);
}

// ---------------------------------------------------------------------------
// Serie complete jusqu'au resultat
// ---------------------------------------------------------------------------

screen('start');
startTopic('elements');
{
  let answered = 0;
  for (let step = 0; step < 10; step += 1) {
    const answer = expectedAnswer(currentPrompt());
    type(answer === null ? 'zzz' : answer);
    submit();
    answered += 1;
    check('le bouton suivant est disponible a la question ' + (step + 1),
      document.getElementById('next-button').hidden, false);
    check('progression ' + (step + 1) + '/10',
      document.getElementById('progress-text').textContent,
      'Question ' + (step + 1) + ' / 10');
    document.getElementById('next-button').fire('click');
  }
  check('10 questions repondues', answered, 10);
  check('le bouton final annonce le resultat', document.getElementById('next-button').textContent,
    'Voir le résultat');
}

check('l\'ecran de resultat est visible', visible('result'), true);
check('le quiz est masque', visible('quiz'), false);
check('score parfait affiche',
  document.getElementById('result-score').textContent, 'Score : 10 / 10');
check('un commentaire de fin est affiche',
  document.getElementById('result-comment').textContent.length > 0, true);

// ---------------------------------------------------------------------------
// Retour au menu et nouvelle serie
// ---------------------------------------------------------------------------

document.getElementById('restart-button').fire('click');
check('redemarrer relance le quiz', visible('quiz'), true);
check('la serie repart a zero', document.getElementById('score-text').textContent, 'Score : 0');
check('redemarrer revient a la question 1',
  document.getElementById('progress-text').textContent, 'Question 1 / 10');

{
  // "Redemarrer" doit rester sur le meme theme.
  let barSeen = 0;
  for (let step = 0; step < 10; step += 1) {
    if (!document.getElementById('symbol-bar').hidden) barSeen += 1;
    type(expectedAnswer(currentPrompt()) || 'x');
    submit();
    document.getElementById('next-button').fire('click');
  }
  check('redemarrer garde le theme elements (aucune formule)', barSeen, 0);
}

document.getElementById('change-button').fire('click');
check('changer de serie revient au menu', visible('start'), true);

// ---------------------------------------------------------------------------
// Bouton son
// ---------------------------------------------------------------------------

{
  const toggle = document.getElementById('sound-toggle');
  const icon = document.getElementById('sound-icon');
  check('son active par defaut', icon.textContent, '🔊');
  check('etat expose aux lecteurs d\'ecran', toggle.getAttribute('aria-pressed'), 'true');

  toggle.fire('click');
  check('le son se coupe', icon.textContent, '🔇');
  check('l\'etat expose passe a faux', toggle.getAttribute('aria-pressed'), 'false');
  check('la preference est memorisee', localStorage.getItem('mendel.sound'), 'off');

  toggle.fire('click');
  check('le son revient', icon.textContent, '🔊');
  check('la preference revient', localStorage.getItem('mendel.sound'), 'on');
}

// ---------------------------------------------------------------------------
// Le resume et le code de sortie sont produits une seule fois par
// tools/run-tests.py, apres tous les fichiers de test.
