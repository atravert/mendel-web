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
 * Arme un mode de la barre, ou le laisse tel quel s'il l'est deja. Reappuyer
 * sur une touche armee la desarme, donc un appel direct ne convient pas pour
 * "je suis deja en indice": c'est le cas de tout corps contenant deux
 * chiffres, comme S2O3.
 */
function arm(mode) {
  const key = dom.scriptKeys[mode === 'sub' ? 0 : 1];
  if (key.getAttribute('aria-pressed') !== 'true') key.fire('click');
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
check('le champ n\'est jamais desactive', input.disabled, false);
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
  // Ni `disabled` ni `readOnly`: le champ garde le focus, donc le clavier
  // reste leve. C'est `state.answered` qui empeche de recompter, pas lui.
  check('le champ reste saisissable pour ne pas fermer le clavier',
    input.disabled, false);
  check('le focus ne quitte pas le champ a la validation',
    document.activeElement === input, true);
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
check('le champ n\'est toujours pas desactive', input.disabled, false);
check('le curseur revient dans le champ, sans attendre',
  document.activeElement === input, true);
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

// Les touches sont reperees par ce qu'elles inserent et non par leur
// position: ajouter la rangee de chiffres ne doit pas decaler tous les
// tests, ni les obliger a recompter l'ordre du HTML.
check('la touche + est presente', dom.key('+').dataset.insert, '+');
check('la touche - est presente', dom.key('-').dataset.insert, '-');
check('la touche ( est presente', dom.key('(').dataset.insert, '(');
check('la touche ) est presente', dom.key(')').dataset.insert, ')');
ok('plus de touche carets', dom.keys.filter((k) => k.dataset.insert === '^').length === 0);
check('14 touches d\'insertion: 4 signes et 10 chiffres', dom.keys.length, 14);
ok('les dix chiffres ont leur touche',
  '0123456789'.split('').every((d) => dom.key(d) !== undefined));

input.value = 'SO4';
input.setSelectionRange(4, 4);
dom.key('+').fire('click');
check('le caractere est insere au curseur', input.value, 'SO4+');
check('le curseur avance', input.selectionStart, 5);

dom.key('-').fire('click');
check('second caractere insere', input.value, 'SO4+-');

input.value = 'ClO3';
input.setSelectionRange(0, 0);
dom.key('-').fire('click');
check('insertion en debut de champ', input.value, '-ClO3');

input.setSelectionRange(1, 3);
dom.key('(').fire('click');
check('insertion dans une selection', input.value, '-(O3');

// Regression: inserer un symbole ecrit dans .value sans emettre d'evenement
// `input`. Si le bouton Valider n'etait pas reactive explicitement, il restait
// gris et le joueur tapait dans le vide.
{
  const validateButton = document.getElementById('validate-button');
  input.value = '';
  validateButton.disabled = true;
  dom.key('+').fire('click');
  check('inserer un symbole reactive Valider', validateButton.disabled, false);
}

{
  // pointerdown et non mousedown: c'est l'evenement que les appareils
  // tactiles emettent reellement, et le code s'appuie dessus.
  const event = dom.symbolBar.fire('pointerdown', { target: dom.key('+') });
  check('la barre empeche la perte de focus', event.defaultPrevented, true);

  const horsTouche = dom.symbolBar.fire('pointerdown', {
    target: { closest: () => null },
  });
  check('le clic hors des touches n\'est pas bloque', horsTouche.defaultPrevented, false);
}

// ---------------------------------------------------------------------------
// Touches d'insertion et mode arme
// ---------------------------------------------------------------------------

{
  const [indice, exposant] = dom.scriptKeys;

  // Sans mode, la rangee de chiffres tape du ASCII: c'est le cas le plus
  // courant, un indice se tape aussi en 4.
  input.value = '';
  input.setSelectionRange(0, 0);
  dom.key('4').fire('click');
  check('la touche chiffre tape un 4 ordinaire', input.value, '4');

  // Arme, la MEME touche produit un indice. C'est tout l'objet de la barre:
  // le joueur choisit une fois le regime, puis tape les chiffres.
  indice.fire('click');
  dom.key('2').fire('click');
  check('la touche chiffre respecte l\'indice arme', input.value, '4₂');
  check('l\'indice reste arme', indice.getAttribute('aria-pressed'), 'true');

  // "+" et "-" doivent suivre le meme regime. C'est le cas le plus courant de
  // tout: ecrire une charge, c'est armer l'exposant puis taper "2-". Si ces
  // deux touches ignoraient le mode, il faudrait repasser par le clavier.
  input.value = 'SO';
  input.setSelectionRange(2, 2);
  exposant.fire('click');
  dom.key('2').fire('click');
  dom.key('-').fire('click');
  check('les signes de la barre suivent l\'exposant', input.value, 'SO²⁻');
  check('l\'exposant tient apres un signe', exposant.getAttribute('aria-pressed'), 'true');

  indice.fire('click');
  dom.key('+').fire('click');
  dom.key('-').fire('click');
  check('les signes de la barre suivent l\'indice', input.value, 'SO²⁻₊₋');

  // Une parenthese n'existe pas en indice ni en exposant: elle est inseree
  // telle quelle, et sort du mode comme une lettre au clavier.
  input.value = 'SO';
  input.setSelectionRange(2, 2);
  arm('sub');
  check('l\'indice est arme avant la parenthese', indice.getAttribute('aria-pressed'), 'true');
  dom.key('(').fire('click');
  check('une parenthese reste une parenthese', input.value, 'SO(');
  check('la parenthese sort du mode', indice.getAttribute('aria-pressed'), 'false');
  dom.key('-').fire('click');
  check('apres la parenthese le signe redevient ASCII', input.value, 'SO(-');
}

// ---------------------------------------------------------------------------
// Touches d'indice et d'exposant, frappe au clavier
// ---------------------------------------------------------------------------

{
  const [indice, exposant] = dom.scriptKeys;

  // Point de depart explicite: si une section precedente laisse un mode arme,
  // les assertions suivantes partiraient d'un etat sale, et leurs echecs
  // decaleraient la vraie cause.
  if (indice.getAttribute('aria-pressed') === 'true') indice.fire('click');
  if (exposant.getAttribute('aria-pressed') === 'true') exposant.fire('click');

  // Le stub n'a pas de saisie clavier: pour une touche que le code laisse
  // passer, on imite le navigateur, sans quoi le champ resterait fige et la
  // seule difference observable serait l'etat du mode. C'est aussi ce qui
  // rend l'assertion sur preventDefault signifiante: sans lui, le caractere
  // ASCII viendrait s'ajouter a l'Unicode insere par le code.
  const press = (key) => {
    const event = input.fire('keydown', { key });
    if (!event.defaultPrevented) {
      const at = input.selectionStart;
      input.value = input.value.slice(0, at) + key + input.value.slice(at);
      input.setSelectionRange(at + 1, at + 1);
    }
    return event;
  };

  check('deux touches de script', dom.scriptKeys.length, 2);
  check('la premiere est l\'indice', indice.dataset.script, 'sub');
  check('la seconde est l\'exposant', exposant.dataset.script, 'sup');
  check('aucun mode n\'est arme au depart', indice.getAttribute('aria-pressed'), 'false');

  input.value = '';
  indice.fire('click');
  check('l\'indice s\'arme', indice.getAttribute('aria-pressed'), 'true');
  check('l\'exposant reste eteint', exposant.getAttribute('aria-pressed'), 'false');
  check('armer un mode n\'insere rien', input.value, '');

  // Le corps: S, O puis l'indice 4.
  input.value = 'SO';
  input.setSelectionRange(2, 2);
  press('4');
  check('le chiffre devient un indice', input.value, 'SO₄');
  check('le mode indice tient apres un chiffre', indice.getAttribute('aria-pressed'), 'true');

  // La charge: on passe en exposant, puis "2" et "-" d'affilee.
  exposant.fire('click');
  check('armer l\'exposant eteint l\'indice', indice.getAttribute('aria-pressed'), 'false');
  press('2');
  press('-');
  check('la formule se compose aux touches', input.value, 'SO₄²⁻');
  check('le mode exposant tient apres le signe', exposant.getAttribute('aria-pressed'), 'true');

  // Le caret a disparu de la barre: si preventDefault() manquait, le
  // navigateur insererait le "-" ASCII en plus du "⁻" insere ici.
  press('-');
  check('une touche interceptee ne double pas l\'insertion', input.value, 'SO₄²⁻⁻');

  // Sortie du mode par un caractere qui n'est ni un chiffre, ni +, ni -.
  press('O');
  check('une lettre sort du mode', exposant.getAttribute('aria-pressed'), 'false');
  press('-');
  check('apres la sortie le signe est redevenu un - ordinaire', input.value.slice(-2), 'O-');

  exposant.fire('click');
  press(' ');
  check('l\'espace sort du mode', exposant.getAttribute('aria-pressed'), 'false');

  // Reappuyer sur la touche armee la desarme: c'est le seul moyen de sortir
  // sans avoir a taper un caractere de sortie.
  input.value = 'NH';
  input.setSelectionRange(2, 2);
  indice.fire('click');
  press('4');
  check('l\'ammonium prend son indice', input.value, 'NH₄');
  indice.fire('click');
  check('reappuyer desarme', indice.getAttribute('aria-pressed'), 'false');
  press('4');
  check('apres desaturation le chiffre redevient un 4', input.value, 'NH₄4');

  // Le mode ne doit pas survivre a la question suivante.
  indice.fire('click');
  check('indice arme avant de changer de question', indice.getAttribute('aria-pressed'), 'true');
  type('zzz');
  submit();
  document.getElementById('next-button').fire('click');
  check('le mode se reinitialise a la question suivante',
    indice.getAttribute('aria-pressed'), 'false');
  check('l\'exposant aussi', exposant.getAttribute('aria-pressed'), 'false');
}

// ---------------------------------------------------------------------------
// Bout en bout: composer une formule a la barre, puis la faire valider
// ---------------------------------------------------------------------------

/**
 * Compose une formule au doigt, avec la barre seule: aucun clavier. C'est le
 * trajet que la rangee de chiffres rend possible, et il doit produire
 * exactement la forme Unicode attendue par la validation.
 */
function composeFormula(formula) {
  const [body, charge] = formula.split('^');
  input.value = '';
  input.setSelectionRange(0, 0);

  for (const char of body) {
    if (/[0-9]/.test(char)) {
      arm('sub');                                // arme l'indice
      dom.key(char).fire('click');               // puis tape le chiffre
    } else {
      input.value += char;
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
  if (charge) {
    arm('sup');                                  // arme l'exposant
    for (const char of charge) dom.key(char).fire('click');
  }
  input.fire('input', { target: input });
}

/** Ce que la saisie au doigt doit produire: corps en indices, charge en exposants. */
function unicodeFormula(formula) {
  const [body, charge] = formula.split('^');
  return body.replace(/[0-9]/g, (d) => SCRIPT_TABLES.sub[d])
    + (charge || '').replace(/[0-9+-]/g, (c) => SCRIPT_TABLES.sup[c]);
}

{
  screen('start');
  startTopic('ions');

  // Rejoindre une question dont on doit composer la formule.
  let target = null;
  for (let step = 0; step < 10 && !target; step += 1) {
    const match = IONS.filter((i) => i.name === currentPrompt())[0];
    if (match) target = match;
    else {
      type(expectedAnswer(currentPrompt()) || 'zzz');
      submit();
      document.getElementById('next-button').fire('click');
    }
  }
  ok('une question "nom vers formule" est atteinte', target !== null);

  const scoreBefore = document.getElementById('score-text').textContent;
  composeFormula(target.formula);

  // La valeur du champ doit etre la forme Unicode, pas la forme "caret" de
  // data.js: c'est ce que voit le joueur, et ce que produit la touche.
  check('le champ contient la forme Unicode', input.value, unicodeFormula(target.formula));

  submit();
  check('la formule composee a la barre est acceptee',
    document.getElementById('feedback').className, 'feedback feedback--correct');
  check('le score augmente', document.getElementById('score-text').textContent !== scoreBefore, true);

  // On enchaîne: valider ne doit PAS avoir vole le focus, et Suivant non
  // plus. Le curseur est deja dans le champ quand le clic rend la main.
  check('le focus n\'a pas quitte le champ a la validation',
    document.activeElement === input, true);
  document.getElementById('next-button').fire('click');
  check('le champ a le focus des le rendu de la question suivante',
    document.activeElement === input, true);
}

// ---------------------------------------------------------------------------
// Clavier virtuel
// ---------------------------------------------------------------------------

// La demande est precise: le clavier est present des l'ouverture de la serie,
// et ne bouge plus jusqu'a la fin des reponses. Traduit en invariants
// verifiables:
//
//   1. le curseur est dans le champ des la question posee, sans que
//      l'utilisateur touche la case;
//   2. le focus est pris SYNCHRONEMENT. Aucun navigateur ne leve le clavier
//      hors d'un geste utilisateur: reporter le focus a la tache suivante
//      sort du geste, et le champ se focus sans que le clavier se leve. C'est
//      ce qui rendait le resultat pire qu'avant. Le harnais n'a volontairement
//      aucune minuterie: avec un `setTimeout`, un report passerait, puisque le
//      focus poserait au flush. Aucune assertion ici n'a donc le droit d'en
//      attendre une;
//   3. ni valider ni Suivant ne volent le focus, ni en changeant l'etat du
//      champ ni en le focalisant. Perdre le focus ferme le clavier, qui
//      retrecit le viewport, et toute la page se recentre: deux sautes par
//      question.

check('le curseur est dans le champ a la premiere question',
  document.activeElement === input, true);
check('le champ n\'a jamais ete desactive', input.disabled, false);

{
  // Enchainement normal, comme le joueur: saisir, valider, suivant. Le focus
  // ne doit jamais sortir du champ, et le nombre de blur produits par le code
  // de production doit rester nul.
  const blursAvant = input.blurred;
  let focusPerdu = 0;
  for (let question = 0; question < 3; question += 1) {
    type(expectedAnswer(currentPrompt()) || 'x');
    submit();
    if (document.activeElement !== input) focusPerdu += 1;
    document.getElementById('next-button').fire('click');
    // Aucune minuterie: le focus doit etre deja pose quand le clic rend la
    // main. C'est l'assertion qui rattraperait un report.
    if (document.activeElement !== input) focusPerdu += 1;
  }
  check('le focus reste dans le champ sur trois questions enchainees',
    focusPerdu, 0);
  check('aucun blur n\'est produit par le code de production',
    input.blurred - blursAvant, 0);
  check('le champ est toujours saisissable', input.disabled, false);
  check('readOnly n\'est pas utilise non plus', input.readOnly, false);
}

{
  // Le geste est indispensable: sans lui, le navigateur refuse le clavier.
  // `startQuiz` passe par un clic, et le focus y est synchrone -- c'est ce qui
  // fait lever le clavier des la premiere question, sans clic sur le champ.
  input.blur();
  type(expectedAnswer(currentPrompt()) || 'x');
  submit();
  document.getElementById('next-button').fire('click');
  check('un focus manuel est repris a la question suivante',
    document.activeElement === input, true);

  input.blur();
  startTopic('ions');
  check('le curseur est deja dans le champ a l\'ouverture de la serie',
    document.activeElement === input, true);
  check('aucun clic sur la case reponse n\'est necessaire',
    input.focused > 0, true);
  check('la serie est bien demarree', visible('quiz'), true);
}

{
  // La fin de serie est le seul moment ou le clavier DOIT se fermer. Donc il
  // faut lui retirer le focus explicitement: le laisser dans un champ devenu
  // invisible est l'etat qu'iOS interprete le plusership -- et le resultat
  // s'affiche avec le clavier encore leve, en plein ecran.
  let last = currentPrompt();
  for (let question = 0; question < QUESTIONS_PER_SERIES + 2; question += 1) {
    type(expectedAnswer(last) || 'x');
    submit();
    document.getElementById('next-button').fire('click');
    if (visible('result')) break;
    last = currentPrompt();
  }
  check('la serie se termine sur l\'ecran de resultat', visible('result'), true);
  check('le champ rend le focus a la fin de la serie',
    document.activeElement === input, false);
}

// ---------------------------------------------------------------------------
// La parade anti-prise de focus
// ---------------------------------------------------------------------------

// Valider et Suivant sont des <button>: sans parade, le navigateur leur donne
// le focus a l'appui, le champ le perd, le clavier se ferme, et l'ecran saute.
// La parade est un `pointerdown` annule sur le conteneur. On verifie qu'elle
// porte bien sur les deux boutons -- et qu'elle n'annule pas le champ, sans
// quoi iOS refuserait de lever le clavier, ce qu'on ne vit qu'a l'appareil.
{
  const validate = document.getElementById('validate-button');
  const nextButton = document.getElementById('next-button');

  check('Valider bloque la prise de focus',
    validate.fire('pointerdown').defaultPrevented, true);
  check('Suivant bloque la prise de focus',
    nextButton.fire('pointerdown').defaultPrevented, true);
  check('la parade ne porte pas sur le champ lui-meme',
    input.fire('pointerdown').defaultPrevented, false);
  check('la parade ne bloque pas le clic qui suit',
    validate.fire('click').defaultPrevented, false);
}

// ---------------------------------------------------------------------------
// Hauteur reellement visible
// ---------------------------------------------------------------------------

// `interactive-widget=resizes-content` ne vaut que sur Chrome; sur iOS le
// viewport de mise en page ne bouge pas et le contenu, centre dans la hauteur
// PLEINE, se retrouve a moitie sous le clavier, avec le bouton Valider hors de
// l'ecran. Ces assertions verifient que la hauteur utile publiee suit le
// clavier.
{
  // Le bloc precedent a mene la serie a son terme, donc le champ a rendu le
  // focus et le curseur n'est plus dedans. On repart sur une serie neuve: ce
  // qui suit mesure l'ecran du quiz, pas celui du resultat.
  startTopic('elements');
  check('une serie neuve replace le curseur dans le champ',
    document.activeElement === input, true);

  const viewport = window.visualViewport;
  const root = document.documentElement;
  const cssVar = (name) => root.style.getPropertyValue(name);

  // Au repos: la hauteur de l'ecran entier.
  check('au repos, la hauteur vaut celle de l\'ecran', cssVar('--app-height'), '844px');

  // Clavier ouvert sur un iPhone 15: il reste ~508 px, la ou le centrage se
  // faisait sur 844. Sans ca, la moitie basse du contenu etait sous le
  // clavier et le bouton Valider sortait de l'ecran.
  viewport.setKeyboard(508);
  check('clavier ouvert, la hauteur diminue', cssVar('--app-height'), '508px');

  // Le decalage d'iOS n'est PAS publie, et c'est une decision: quand le
  // contenu deborde, le defilement du document est le seul moyen
  // d'atteindre la fin. L'annuler la rendrait inatteignable. Ce test
  // verrouille ce choix: le remettre casserait l'ecran le plus petit.
  viewport.scrollTo(336);
  check('le decalage d\'iOS ne touche pas a la hauteur', cssVar('--app-height'), '508px');
  check('aucun decalage n\'est publie', root.style._props['--app-offset'], undefined);

  // Referme: on doit retrouver la hauteur de l'ecran, sinon la page reste
  // raccourcie apres le passage du clavier.
  viewport.hideKeyboard();
  check('clavier referme, la hauteur revient', cssVar('--app-height'), '844px');
  check('le curseur survit a la fermeture du clavier',
    document.activeElement === input, true);
}
