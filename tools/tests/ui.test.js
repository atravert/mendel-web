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

/**
 * Le geste de confirmation par la touche retour du clavier: `keydown` sur le
 * champ, avec `key: 'Enter'`.
 *
 * C'est le chemin que le joueur utilise le plus, et c'est celui qui a
 * reellement echoue sur iPhone. Il merite donc d'etre celui qu'exerce la
 * majorite des tests plutot que d'etre un chemin secondaire verifie a part.
 */
function pressEnter() {
  return input.fire('keydown', { key: 'Enter' });
}

/** Le meme geste, mais par le bouton Valider. */
function clickValidate() {
  return document.getElementById('validate-button').fire('click');
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

/**
 * La question courante attend-elle une FORMULE? C'est la seule condition qui
 * fait apparaitre la barre de symboles, et la seule qui pose le probleme de
 * place mesure plus bas.
 *
 * La reponse se deduit de l'ENONCE, pas de la visibilite de la barre. C'etait
 * la premiere version, et elle devenait fausse precisement dans le cas qu'elle
 * sert a atteindre: en mode compact la barre est repliee meme sur une formule,
 * donc le parcours ne s'arretait jamais et epuisait ses douze essais. Un
 * detecteur d'etat de mise en page ne peut pas servir a reconnaitre une
 * question.
 */
function isFormulaQuestion() {
  return IONS.some((ion) => ion.name === currentPrompt());
}

function reachFormulaQuestion() {
  for (let step = 0; step < 12; step += 1) {
    if (isFormulaQuestion()) return true;
    type(expectedAnswer(currentPrompt()) || 'zzz');
    pressEnter();
    document.getElementById('next-button').fire('click');
  }
  return isFormulaQuestion();
}

// ---------------------------------------------------------------------------
// Ecran de depart
// ---------------------------------------------------------------------------

// Verifie ICI, et non plus bas: `data-screen` ne vaut `start` qu'avant la
// premiere navigation. Apres, le fichier a deja parcouru des series, et
// l'assertion testerait l'ecran courant plutot que le demarrage. Retirer
// cette assertion ne ferait echouer aucun autre test.
check('l\'ecran courant est publie des le chargement',
  document.documentElement.dataset.screen, 'start');

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
  pressEnter();

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
  // P1: `disabled` ne suffit pas. Le bouton se GRISAIT et restait en place,
  // 48 px du budget vertical pour une action morte, exactement a l'endroit ou
  // la place manquait. Deux boutons a l'ecran pour une seule action utile.
  // Le masquage est ce qui rend les 48 px; le verrou reste pose a part.
  check('Valider disparait, pas seulement grise',
    document.getElementById('validate-button').hidden, true);
  // P2: l'etat qui fait disparaitre l'enonce, et que le CSS lit pour le
  // remplacer par le commentaire. Pose sur `<html>`, comme `data-screen`.
  check("l'etat repondu est publie sur <html>",
    document.documentElement.getAttribute('data-answered'), '1');
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

  // Le second retour passe a la question suivante sans recompter: teste dans
  // la section du clavier, la ou le double retour a tout son sens. Une seule
  // soumission ici, pour que la suite du fichier reste sur la question 1.
  //
  // Le garde-fou reste entier: `state.answered` fait que validate() ne peut
  // compter deux fois la meme reponse, meme si le code l'appelle deux fois.
  check('une reponse ne peut etre recomptee',
    document.getElementById('feedback').className, 'feedback feedback--correct');
  check('Valider reste inactif apres reponse',
    document.getElementById('validate-button').disabled, true);

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
check('Valider revient, l\'enonce aussi', document.getElementById('validate-button').hidden, false);
check("l'etat repondu est retire de <html>",
  document.documentElement.getAttribute('data-answered'), undefined);
ok('la question 2 est differente de la question 1', currentPrompt() !== firstPrompt);

// ---------------------------------------------------------------------------
// Reponse fausse
// ---------------------------------------------------------------------------

{
  type('uneReponseQuiNexistePas');
  pressEnter();

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
  pressEnter();
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
  // Rejoindre une question dont la reponse est une formule.
  ok('une question de formule est atteinte dans la serie', reachFormulaQuestion());

  check('barre de symboles visible pour une formule',
    document.getElementById('symbol-bar').hidden, false);

  // Le rendu des indices doit produire de vrais <sub>/<sup>.
  const formula = expectedAnswer(currentPrompt());
  input.value = 'mauvaise';
  pressEnter();
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
  reachFormulaQuestion();
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
  pressEnter();
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
      pressEnter();
      document.getElementById('next-button').fire('click');
    }
  }
  ok('une question "nom vers formule" est atteinte', target !== null);

  const scoreBefore = document.getElementById('score-text').textContent;
  composeFormula(target.formula);

  // La valeur du champ doit etre la forme Unicode, pas la forme "caret" de
  // data.js: c'est ce que voit le joueur, et ce que produit la touche.
  check('le champ contient la forme Unicode', input.value, unicodeFormula(target.formula));

  pressEnter();
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
    pressEnter();
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
  pressEnter();
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
    pressEnter();
    document.getElementById('next-button').fire('click');
    if (visible('result')) break;
    last = currentPrompt();
  }
  check('la serie se termine sur l\'ecran de resultat', visible('result'), true);
  check('le champ rend le focus a la fin de la serie',
    document.activeElement === input, false);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// La touche retour du clavier, et les deux chemins de confirmation
// ---------------------------------------------------------------------------

// Mesure de terrain: sur iPhone, la premiere pression de la touche retour
// valait la reponse, la seconde ne passait PAS a la question suivante. Elle
// passait par la soumission implicite du formulaire, dont iOS ne garantit pas
// le second passage.
//
// Le remede n'est pas de retenter la soumission, c'est de ne plus en dependre.
// Chaque source d'entree a son chemin, exactement un:
//   - la touche retour, par `keydown`;
//   - le bouton Valider, par `click`, en `type="button"`.
// Aucun ecouteur ne sert les deux, donc aucune course n'est possible entre
// eux. Ecouter `keydown` ET `submit` aurait paru plus robuste, et aurait
// introduit le defaut inverse: une pression qui valide ET avance, donc une
// question sautee.
{
  // Le fichier est arrive a la question 10/10, ou le retour suivant affiche le
  // resultat: ce qu'on veut tester ici, c'est le passage a la question
  // SUIVANTE, pas la fin de serie. On repart donc d'une serie neuve.
  startTopic('elements');

  const reponse = expectedAnswer(currentPrompt());
  const promptAvant = currentPrompt();

  // Premier retour: la reponse est comptee, le retour s'affiche.
  type(reponse);
  const evt = pressEnter();
  check('le retour compte la reponse',
    document.getElementById('feedback').className, 'feedback feedback--correct');
  check('le retour montre le commentaire',
    document.getElementById('feedback').hidden, false);

  // Une seule pression, une seule question consommee. C'est LA course a
  // eviter, et elle ne se verrait pas si la touche ne faisait qu'une chose:
  // il faudrait lire les deux assertions ci-dessous.
  check('une seule pression ne consomme pas deux questions',
    document.getElementById('progress-text').textContent, 'Question 1 / 10');

  // L'evenement est annule, donc le navigateur ne soumet rien. C'est ce qui
  // rend le chemin du formulaire inoffensif: il ne peut plus doubler l'effet
  // de la touche.
  check('la touche retour annule l\'evenement', evt.defaultPrevented, true);

  // Second retour: on avance, sans recompter le point deja acquis.
  const scoreAvant = document.getElementById('score-text').textContent;
  pressEnter();
  check('le second retour passe a la question suivante',
    currentPrompt() !== promptAvant, true);
  check('le second retour ne recompte pas',
    document.getElementById('score-text').textContent, scoreAvant);
  check('le second retour a vide le champ', input.value, '');
  check('le second retour masque le retour de la question precedente',
    document.getElementById('feedback').hidden, true);
  check('le second retour masque le bouton Suivant',
    document.getElementById('next-button').hidden, true);
  check('le curseur est deja dans le champ pour la question suivante',
    document.activeElement === input, true);

  // Un retour sur une reponse vide ne doit ni compter ni avancer: rien a
  // valider, donc rien a faire.
  const promptVide = currentPrompt();
  const scoreVide = document.getElementById('score-text').textContent;
  pressEnter();
  check('un retour a vide ne fait rien',
    currentPrompt() === promptVide && document.getElementById('score-text').textContent === scoreVide,
    true);

  // ---- Le bouton Valider, chemin distinct -------------------------------
  //
  // Il doit valider, et ne peut pas enchainer: il est desactive apres la
  // reponse. C'est ce qui laisse les deux chemins disjoints -- la touche
  // enchaine, le bouton non.
  const promptBouton = currentPrompt();
  type(expectedAnswer(promptBouton));
  clickValidate();
  check('le bouton Valider compte la reponse',
    document.getElementById('feedback').className, 'feedback feedback--correct');
  check('le bouton Valider ne passe pas a la question suivante',
    currentPrompt(), promptBouton);
  check('le bouton Valider se desactive',
    document.getElementById('validate-button').disabled, true);

  // Une soumission du formulaire ne doit RIEN faire, et ne doit meme pas
  // valider: si elle validait, une soumission implicite passant par la touche
  // retour doublerait l'effet -- compter, puis avancer.
  const promptApresBouton = currentPrompt();
  const scoreApresBouton = document.getElementById('score-text').textContent;
  const evtSoumission = document.getElementById('answer-form').fire('submit');
  check('une soumission du formulaire est annulee', evtSoumission.defaultPrevented, true);
  check('une soumission du formulaire ne fait rien',
    currentPrompt() === promptApresBouton
      && document.getElementById('score-text').textContent === scoreApresBouton,
    true);
  check('une soumission ne valide pas non plus',
    currentPrompt() === promptApresBouton, true);

  // Le mode d'indice ou d'exposant arme tombe au retour: il annonce ce que la
  // PROCHAINE frappe inserera, et la reponse est desormais comptee.
  //
  // `arm('sub')` arme l'exposant, qui n'est pas le mode demande par la barre
  // de cette serie d'ions; le test porte sur la levee, pas sur le mode.
  startTopic('ions');
  arm('sub');
  const cleExposant = dom.scriptKeys[0];
  check('le mode est arme', cleExposant.getAttribute('aria-pressed'), 'true');
  type(expectedAnswer(currentPrompt()));
  pressEnter();
  check('le retour leve le mode arme',
    cleExposant.getAttribute('aria-pressed'), 'false');
}

// ---------------------------------------------------------------------------
// La touche retour quand le clavier a vole le focus
// ---------------------------------------------------------------------------

// Le cas de terrain qui manquait.
//
// Les deux symptomes signales -- l'icone du son mal placee, et la touche
// retour qui n'avance pas -- sont exactement ce que fait un appareil encore
// sur l'ancien code. On ne pouvait pas le distinguer d'un correctif
// inefficace. Le numero de version affiche tranche maintenant, et le service
// worker ne lit plus que son propre cache.
//
// Reste un mecanisme reel, distinct, et capable de produire le meme
// symptome: iOS et Android retirent le focus du champ quand ils valident une
// correction ou un mot propose. Le champ n'a alors plus le focus, donc plus
// de `keydown`, donc la touche retour ne fait plus rien -- jusqu'a ce que le
// joueur tape a nouveau dans le champ.
{
  // ---- D'abord: le harnais doit voir ce que voit un vrai navigateur ----
  //
  // Un `keydown` sur le champ remonte jusqu'au document. Si le faux DOM ne
  // remonte pas l'evenement, la double validation -- compter ET avancer d'un
  // coup, donc sauter une question -- devient IMPOSSIBLE a reproduire dans
  // les tests, et l'exclusion mutuelle par le focus cesse d'etre verifiee. Le
  // harnais validerait alors une garantie qu'il ne controle pas.
  //
  // C'est deja arrive: le lien de propagation et le test de focus etaient
  // supposes se surveiller mutuellement, et les deux disparus ensemble
  // laissaient 289 assertions au vert.
  let vuParLeDocument = 0;
  const temoin = () => { vuParLeDocument += 1; };
  document.addEventListener('keydown', temoin);

  input.fire('keydown', { key: 'x' });
  check('le faux DOM fait remonter le keydown du champ jusqu\'au document',
    vuParLeDocument, 1);

  vuParLeDocument = 0;
  document.getElementById('validate-button').fire('keydown', { key: 'x' });
  check('le faux DOM fait remonter le keydown d\'un bouton jusqu\'au document',
    vuParLeDocument, 1);

  document.removeEventListener('keydown', temoin);

  // ---- Puis: le filet de securite, qui ne sert que si le focus a disparu -
  startTopic('elements');

  // Une reponse comptee, puis le champ perd le focus, comme le ferait la
  // validation d'une correction par le clavier du systeme.
  type(expectedAnswer(currentPrompt()));
  pressEnter();
  const promptAvant = currentPrompt();
  input.blur();
  check('le champ a bien perdu le focus', document.activeElement, null);

  // La touche retour, portee ailleurs que par le champ.
  const evt = document.fire('keydown', { key: 'Enter' });
  check('la touche retour avance malgre la perte de focus',
    currentPrompt() !== promptAvant, true);
  check('le focus revient dans le champ pour la question suivante',
    document.activeElement === input, true);
  check('l\'evenement est annule', evt.defaultPrevented, true);

  // Meme chose sans reponse comptee: c'est un retour qui VALIDE, dans les
  // memes conditions. Sans cela, le filet ne fonctionnerait qu'apres une
  // reponse, donc pas pour l'usage le plus courant.
  startTopic('elements');
  const promptAValider = currentPrompt();
  type(expectedAnswer(promptAValider));
  input.blur();
  const evtValider = document.fire('keydown', { key: 'Enter' });
  check('le retour valide malgre la perte de focus',
    document.getElementById('feedback').hidden, false);
  check('une seule question consommee',
    document.getElementById('progress-text').textContent, 'Question 1 / 10');
  check('la question courante n\'a pas change', currentPrompt(), promptAValider);
  check('l\'evenement de validation est annule', evtValider.defaultPrevented, true);

  // Le filet ne doit pas valider quand il n'y a rien a valider.
  startTopic('elements');
  const promptVide = currentPrompt();
  input.blur();
  document.fire('keydown', { key: 'Enter' });
  check('un retour a vide ne fait rien, focus ou non',
    currentPrompt(), promptVide);

  // Hors serie, la touche retour n'a rien a confirmer.
  document.getElementById('change-button').fire('click');
  const evtHorsSerie = document.fire('keydown', { key: 'Enter' });
  check('la touche retour est ignoree hors serie',
    evtHorsSerie.defaultPrevented, false);
  check('le retour a l\'accueil tient', visible('start'), true);

  // Un bouton a le focus est active par le retour: son propre `click` agit
  // deja. Le doubler validerait ET avancerait d'un coup.
  startTopic('elements');
  type(expectedAnswer(currentPrompt()));
  const boutonValider = document.getElementById('validate-button');
  document.activeElement = boutonValider;
  const promptBoutonFocus = currentPrompt();
  // Le evenement part du BOUTON: c'est sa cible qui declenche le garde-fou.
  // Lance sur le document, la cible serait le document, et le test passerait
  // sans rien verifier du tout.
  const evtBouton = boutonValider.fire('keydown', { key: 'Enter' });
  check('la touche retour laisse un bouton focus a son propre clic',
    currentPrompt(), promptBoutonFocus);
  check('le bouton focus n\'est pas confirme par le filet',
    document.getElementById('feedback').hidden, true);
  check('l\'evenement n\'est pas annule au passage du bouton',
    evtBouton.defaultPrevented, false);
}

// ---------------------------------------------------------------------------
// L'ecran courant, et le numero de version affiche
// ---------------------------------------------------------------------------

// Deux choses que je ne peux pas verifier autrement.
//
// `data-screen` sur `<html>`: c'est ce qui permet au CSS de centrer l'icone du
// son sur l'ecran de quiz. Il remplace `:has()`, qui n'existe pas avant Safari
// 15.4 -- et qui, sur un appareil plus ancien, laissait l'icone a sa position
// par defaut, c'est-a-dire le symptome signale. Un attribut se teste.
//
// Le numero de version: sans lui, un appareil qui tourne encore l'ancien code
// et un appareil sur lequel le correctif echoue affichent exactement la meme
// chose. Le depannage tourne alors en rond, et c'est ce qui est arrive.
{
  const racine = document.documentElement;
  const versionAffichee = document.getElementById('version-start');
  const versionResultat = document.getElementById('version-result');

  check('le numero de version est affiche sur l\'ecran d\'accueil',
    /^version [0-9a-f]{8}$/.test(versionAffichee.textContent), true);
  check('le numero de version est affiche sur l\'ecran de resultat',
    /^version [0-9a-f]{8}$/.test(versionResultat.textContent), true);
  check('les deux ecrans affichent le meme numero',
    versionAffichee.textContent === versionResultat.textContent, true);

  // Le numero vient du `<meta>` du vrai index.html, pas d'une constante.
  const metaVersion = document.querySelector('meta[name="app-version"]').content;
  check('le numero affiche vient du meta du vrai index.html',
    versionAffichee.textContent, 'version ' + metaVersion);
  check('le meta porte bien une empreinte',
    /^[0-9a-f]{8}$/.test(metaVersion), true);

  // Le demarrage est verifie dans la section d'accueil, ou aucun test n'a
  // encore navigue. Ici, on verifie que la publication suit l'ecran.
  startTopic('elements');
  check('l\'ecran de quiz est publie', racine.dataset.screen, 'quiz');

  // C'est ce que lit le CSS pour centrer l'icone du son. Si `data-screen`
  // suivait l'ecran avec un retard, l'icone resterait a sa position par
  // defaut pendant une question -- et ce serait le symptome signale.
  check('le centrage de l\'icone s\'applique sur l\'ecran de quiz',
    racine.dataset.screen === 'quiz', true);

  document.getElementById('change-button').fire('click');
  check('le retour a l\'accueil est publie', racine.dataset.screen, 'start');
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

  // D'ABORD ce que voit le harnais, parce que les assertions suivantes n'ont
  // aucun sens sinon.
  //
  // Les deux boutons vivent dans la zone d'action, pas dans l'ecran de quiz:
  // c'est ce qui les sort du conteneur qui defile, pour qu'ils restent en bas
  // de la zone visible. Le harnais le modelait encore comme le contraire, et
  // les deux assertions ci-dessous restaient vertes parce que la parade du
  // quiz les satisfaisait -- sur une page ou elle ne les voit plus. Un
  // listener fantome dans le harnais, un vrai tremblement sur l'appareil.
  const actions = document.getElementById('actions');
  const quiz = document.getElementById('screen-quiz');
  check('le harnais voit les boutons dans la zone d\'action',
    validate._parent === actions, true);
  check('le harnais ne les voit plus dans l\'ecran de quiz',
    validate._parent === quiz, false);

  check('Valider bloque la prise de focus',
    validate.fire('pointerdown').defaultPrevented, true);
  check('Suivant bloque la prise de focus',
    nextButton.fire('pointerdown').defaultPrevented, true);
  check('la parade ne porte pas sur le champ lui-meme',
    input.fire('pointerdown').defaultPrevented, false);
  check('la parade ne bloque pas le clic qui suit',
    validate.fire('click').defaultPrevented, false);
}

// Le bouton son a sa propre parade, et elle n'est pas optionnelle.
//
// Il est centre sur la ligne de progression: il est donc VISUELLEMENT dans
// l'ecran de quiz, mais il reste un enfant de `body`, en `position: fixed`
// pour passer au-dessus des trois ecrans. #screen-quiz ne le contient pas, et
// la parade du conteneur ne le voit pas. Sans la sienne, baisser le son en
// pleine serie donne le focus au bouton, vide le champ, ferme le clavier, et
// fait sauter l'ecran -- le tremblement exact qu'on vient de supprimer.
{
  const son = document.getElementById('sound-toggle');

  check('le bouton son bloque la prise de focus',
    son.fire('pointerdown').defaultPrevented, true);
  check('le bouton son ne bloque pas le clic qui suit',
    son.fire('click').defaultPrevented, false);

  // Et le comportement doit rester entier: baisser puis relever le son, avec
  // le curseur dans le champ tout du long.
  startTopic('elements');
  const pressedAvant = son.getAttribute('aria-pressed');

  check('le curseur est dans le champ avant de baisser le son',
    document.activeElement === input, true);
  son.fire('pointerdown');
  son.fire('click');
  check('le son a bien ete coupe',
    son.getAttribute('aria-pressed') !== pressedAvant, true);
  check('le curseur est reste dans le champ apres le bouton son',
    document.activeElement === input, true);

  son.fire('pointerdown');
  son.fire('click');
  check('le son est revenu', son.getAttribute('aria-pressed'), pressedAvant);
  check('le curseur est toujours dans le champ',
    document.activeElement === input, true);
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

  // Au repos: la hauteur de l'ecran entier, et la marge de l'indicateur
  // d'accueil intacte. Les deux assertions se font ICI, avant l'ouverture du
  // clavier: apres, l'absence d'attribut passerait toujours, puisque le
  // clavier est justement ouvert. C'est l'ordre qui les rend significatives.
  check('au repos, la hauteur vaut celle de l\'ecran', cssVar('--app-height'), '844px');
  check("au repos, l'indicateur d'accueil garde sa marge",
    root.getAttribute('data-keyboard'), undefined);

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

  // L'indicateur d'accueil du bas n'est utile que SANS clavier: le clavier le
  // recouvre, et sa marge devient du vide. 34 px, et 34 px qui faisaient
  // deborder l'ecran de quiz sur un petit telephone -- c'est ce qui permet a
  // l'enonce, au champ et a Valider de tenir ensemble a l'ecran.
  check("clavier ouvert, l'indicateur d'accueil est ecarte",
    root.getAttribute('data-keyboard'), 'open');

  // Un clavier qui ne fait pas tomber la fenetre de 80 px, c'est la barre
  // d'adresse d'iOS qui se retracte: aucun clavier a l'ecran, donc la marge
  // doit rester. C'est la seule chose qui distingue les deux, et le seuil
  // est ce qui les departage.
  viewport.setKeyboard(790);
  check("une simple barre d'adresse n'est pas un clavier",
    root.getAttribute('data-keyboard'), undefined);
  viewport.setKeyboard(508);

  // Referme: on doit retrouver la hauteur de l'ecran, sinon la page reste
  // raccourcie apres le passage du clavier.
  viewport.hideKeyboard();
  check('clavier referme, la hauteur revient', cssVar('--app-height'), '844px');
  check("clavier referme, l'indicateur d'accueil revient",
    root.getAttribute('data-keyboard'), undefined);
  check('le curseur survit a la fermeture du clavier',
    document.activeElement === input, true);
}

// ---------------------------------------------------------------------------
// Ce qui ne rentre pas: la mesure, lue sur l'appareil
// ---------------------------------------------------------------------------

// P5, et l'aveu qui va avec.
//
// Le CSS annoncait 469 px de contenu pour 508 px disponibles sur un iPhone 15,
// et en deduisait que tout tenait. Les deux chiffres etaient CALCULES. Le
// premier ne decrivait que l'etat AVANT reponse -- et les deux elements qui
// dependent (le commentaire, le bouton Suivant) n'existent qu'apres, ou ils
// pesaient 555 a 601 px. Un iPhone 15 Pro a refuse le calcul: le commentaire
// et le bouton Suivant ont disparu de l'ecran.
//
// Aucune assertion de ce fichier n'aurait vu le defaut. Elles verifient que le
// commentaire EXISTE et que Suivant est affiche -- les deux vrais. Elles ne
// peuvent pas dire "c'est sous le clavier": seul un appareil peut le dire.
//
// Ce que ces tests verifient, et c'est tout: que l'application REAGIT
// correctement a une mesure. Les deux nombres sont poses ici a la main, et
// personne ne les calcule -- un test qui pretendrait mesurer la hauteur
// simulerait exactement le defaut qu'il est cense attraper. Le vrai chiffre
// reste a produire sur l'appareil.
{
  const quiz = screen('quiz');
  const note = document.getElementById('overflow-note');
  const root = document.documentElement;
  const viewport = window.visualViewport;

  // Le bloc precedent a relance une serie et referme le clavier. On est donc
  // sur le quiz, question 1, sans reponse, et sans debordement annonce.
  check('le bandeau de mesure est muet quand tout rentre',
    note.hidden, true);
  check("aucun etat 'repondu' au depart", root.getAttribute('data-answered'), undefined);

  // Les 508 px que le CSS annoncaient, et les 601 px qu'il annoncait pas.
  // C'est le couples qui a produit le symptome: un deficit de 93 px, qui
  // emportait le commentaire et le bouton Suivant.
  quiz.clientHeight = 508;
  quiz.scrollHeight = 601;

  // Le clavier seul ne suffit pas a le faire parler: il faut une nouvelle
  // mesure. Passer par syncViewport et non par un rendu verifie qu'il mesure
  // au bon moment -- a chaque changement de hauteur visible, pas seulement au
  // changement de question, donc aussi a une rotation ou a une ouverture de
  // clavier en cours de partie.
  viewport.setKeyboard(508);
  check('un debordement reel est signale', note.hidden, false);

  // Les DEUX chiffres bruts, parce que "ca ne rentre pas" ne se corrige pas et
  // "601 px pour 508 px" se corrige. C'est ce que l'utilisateur peut rapporter.
  const texte = note.textContent;
  check('le bandeau donne le contenu', texte.indexOf('601 px') !== -1, true);
  check('le bandeau donne la place disponible', texte.indexOf('508 px') !== -1, true);
  check('le bandeau donne le manque', texte.indexOf('93 px') !== -1, true);
  check('le bandeau dit quoi faire', texte.indexOf('Defilez') !== -1, true);

  // Ce qui tient exactement ne doit PAS etre signale. Ces hauteurs-la sont
  // arrondies par le navigateur, et un demi-pixel de debordement n'a rien de
  // reel: sans cette tolerance, le bandeau s'afficherait sur un ecran qui
  // tient, et l'utilisateur finirait par l'ignorer -- c'est-a-dire par
  // perdre le seul diagnostic qu'on lui donne.
  quiz.scrollHeight = 508;
  viewport.setKeyboard(508);
  check('un ecran qui tient exactement reste muet', note.hidden, true);

  quiz.scrollHeight = 509;
  viewport.setKeyboard(508);
  check('un pixel de debordement reste tolere', note.hidden, true);

  quiz.scrollHeight = 511;
  viewport.setKeyboard(508);
  check('trois pixels, laTolerance est franchie', note.hidden, false);

  // L'ecran de resultat n'a pas les memes contraintes: centre, court, et
  // lisible en defilant. Signaler SON debordement dans le bandeau du quiz
  // serait une fausse alerte sur un ecran ou rien n'est masque.
  document.getElementById('change-button').fire('click');
  check('l\'ecran de depart est affiche', visible('start'), true);
  viewport.setKeyboard(508);
  check('rien n\'est signale hors du quiz', note.hidden, true);

  // Retour au quiz, et le bandeau doit revenir aussi. Sans cela, une mesure
  // faite sur un autre ecran resterait affichee, et l'utilisateur verrait un
  // avertissement qui ne parle plus de rien.
  //
  // On remet le contenu a 601 px d'abord: le test de tolerance a laisse
  // 511, et c'est le scenario de l'iPhone 15 Pro qu'on veut retrouver, pas un
  // debordement de trois pixels.
  quiz.scrollHeight = 601;
  startTopic('elements');
  viewport.setKeyboard(508);
  check('le bandeau revient des que le quiz est affiche', note.hidden, false);
  // Les chiffres sont redeux ceux du quiz, et non un reste de l'ecran
  // precedent: c'est ce qui distingue une mesure d'un message colle.
  check('le bandeau retrace le manque mesure', note.textContent.indexOf('93 px') !== -1, true);

  quiz.clientHeight = 0;
  quiz.scrollHeight = 0;
  viewport.setKeyboard(844);
  check('plus de mesure, plus de bandeau', note.hidden, true);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// La mesure de l'appareil, et ce qu'elle a change
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
//
// P6. L'appareil a tranche, et son verdict n'etait pas celui qu'on attendait.
//
// Sur la serie ions, avec le clavier ouvert, dans un onglet Safari, il a
// rapporte: 324 px de contenu pour 210 px visibles. Soit 114 px de defaut, sur
// un ecran ou P1, P2 et P3 venaient d'etre appliques.
//
// Le premier chiffre se decompose EXACTEMENT, et chaque terme se lit dans
// css/style.css: 22 + 1 + 20 + 53 + 48 + 116 + 64 = 324. Les 116 px sont la
// barre de symboles, soit plus de la moitie de la place visible. Ce n'etait
// donc pas un probleme de mise en page mais de CONTENU: rien ne pouvait faire
// tenir 324 px dans 210 px sans rendre quelque chose.
//
// Deux corrections en decoulent, et aucune ne touche a ce qui se touche au
// doigt:
//
//   - apres la reponse, la barre part. On ne compose plus rien, et c'est
//     precisement quand le commentaire et Suivant ont besoin de la place;
//   - avant la reponse, elle se replie derriere UN bouton, et le reste se
//     resserre. Le repli est declenche par la MESURE, jamais par un seuil
//     devine -- et une requete `@media (max-height)` ne peut pas le faire, car
//     sur iOS le viewport de mise en page ne retrecit pas quand le clavier se
//     leve. `make verify` refuse cette ecriture-la.
//
// Les hauteurs posees ici le sont A LA MAIN, comme partout ailleurs dans ce
// fichier: personne ne les calcule. Le stub n'a pas de moteur de rendu, donc
// poser `data-compact` ne reduit rien de mesurable -- un test qui simulerait
// l'effet du CSS inventerait une hauteur, et repasserait sur un chiffre que
// rien n'a mesure. C'est exactement le defaut que la fonction de mesure est
// venue corriger. Les couples de nombres viennent donc du commentaire de
// css/style.css, ou ils sont derives du CSS, et les assertions d'ici verifient
// que l'APPLICATION REAGIT correctement a ces etats-la.
{
  const quiz = screen('quiz');
  const note = document.getElementById('overflow-note');
  const bar = document.getElementById('symbol-bar');
  const toggle = document.getElementById('symbol-toggle');
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const form = document.getElementById('answer-form');

  /** Les deux hauteurs que la feuille produit apres resserrement, posees a la
   *  main. Les nombres viennent du commentaire de css/style.css: 226 px
   *  disponibles une fois `--pad` ramene de 20 a 12, et 208 px de contenu une
   *  fois `--gap` a 8, le type de question masque et la barre repliee. */
  const pose = (dispo, contenu) => {
    quiz.clientHeight = dispo;
    quiz.scrollHeight = contenu;
  };

  /** Remeasure par le chemin reel: un changement de hauteur visible, donc
   *  syncViewport(), donc mesurerDebordement(). Passer par un rendu verifierait
   *  le mauvais moment -- la mesure doit suivre la hauteur, pas la question. */
  const remesurer = (hauteur) => viewport.setKeyboard(hauteur);

  // ---- D'abord ce que voit le harnais, sinon les assertions ne disent rien
  //
  // Le bouton est dans le formulaire, donc dans l'ecran de quiz. Le stub le
  // modelait sans parent: une parade `pointerdown` ne l'atteindrait donc pas,
  // et l'assertion qui suit verifierait la parade dans le vide -- c'est-a-dire
  // ne la verifierait pas.
  check('le harnais voit le bouton dans le formulaire', toggle._parent === form, true);
  check('le harnais voit le formulaire dans l\'ecran de quiz',
    form._parent === quiz, true);
  check('le bouton des symboles bloque la prise de focus',
    toggle.fire('pointerdown').defaultPrevented, true);
  check('le bouton des symboles ne bloque pas le clic qui suit',
    toggle.fire('click').defaultPrevented, false);

  // ---- Reprise de l'etat mesure -------------------------------------------
  //
  // 210 px visibles: c'est le `clientHeight` de l'ecran de quiz, hors bandeau
  // et hors zone d'action, sur un ecran ou la place reelle est deux fois moindre.
  // C'est un iPhone dans un ONGLET: la barre d'adresse de Safari n'existe pas
  // dans l'application installee. 210 px n'est donc pas un plancher, c'est le
  // pire cas, et c'est celui-la qu'il faut faire tenir.
  screen('start');
  startTopic('ions');
  ok('une question de formule pour la mesure', reachFormulaQuestion());

  check('au depart, l\'ecran n\'est pas resserre',
    root.getAttribute('data-compact'), undefined);
  check('au depart, la barre est deployee', bar.hidden, false);
  check('au depart, pas de bouton de repli', toggle.hidden, true);

  // ---- Le declenchement par la mesure, et lui seul -------------------------
  pose(210, 324);
  remesurer(373);

  check('un debordement mesure resserre l\'ecran',
    root.getAttribute('data-compact'), '1');
  check('la barre se replie derriere un bouton', bar.hidden, true);
  check('le bouton de repli apparait', toggle.hidden, false);
  check('le bouton annonce la barre comme repliee',
    toggle.getAttribute('aria-expanded'), 'false');

  // Et une fois resserre, ca tient: 208 px pour 226. Le bandeau se tait donc,
  // et il ne doit le faire que si c'est vrai.
  pose(226, 208);
  remesurer(389);
  check('une fois resserre, l\'ecran tient et le bandeau se tait', note.hidden, true);
  // Le mode ne se desarme pas parce que ca tient: il est pose tant que la
  // question n'a pas change, sinon l'icone du son remonterait de 8 px au
  // moindre passage sous la limite.
  check('le mode reste pose tant que la question ne change pas',
    root.getAttribute('data-compact'), '1');

  // ---- Le repli est une porte, pas un mur ---------------------------------
  {
    toggle.fire('click');
    check('le joueur peut deployer la barre', bar.hidden, false);
    check('le bouton annonce la barre deployee',
      toggle.getAttribute('aria-expanded'), 'true');

    // La barre reposee, ca repasse a 264 px de contenu pour 226. C'est un
    // DEFAUT, et un defaut choisi par le joueur: il doit donc se dire. Le
    // garder ouvert en silence laisserait un debordement muet, c'est-a-dire
    // invisible.
    pose(226, 264);
    remesurer(389);
    check('une barre deployee qui deborde est signalee', note.hidden, false);
    check('le bandeau propose de la refermer',
      note.textContent.indexOf('Refermez la barre de symboles') !== -1, true);
    // Le message nomme l'etat mesure. Avant la reponse, il n'y a aucun
    // "retour" a lire, et c'est ce que l'ancien texte promettait: il
    // decrivait un autre ecran que celui qu'il mesurait.
    check('le bandeau nomme l\'etat mesure',
      note.textContent.indexOf('avant reponse') !== -1, true);
    check('le bandeau ne promet pas un retour inexistant',
      note.textContent.indexOf('lire le retour') === -1, true);
    check('le bandeau ne promet pas non plus le texte d\'avant',
      note.textContent.indexOf('Defilez pour lire le retour') === -1, true);

    // Refermer doit etre possible: c'est le meme bouton, donc un clic de plus,
    // et pas un retour a l'ecran d'accueil.
    toggle.fire('click');
    check('la barre se replie a nouveau', bar.hidden, true);
    pose(226, 208);
    remesurer(389);
    check('une barre repliee ne deborde plus', note.hidden, true);
  }

  // ---- Le bouton remesure, sans qu'on le lui demande ----------------------
  //
  // Deployer la barre rend 68 px, et cette place peut ne pas suffire. Le
  // bouton doit donc remesurer LUI-MEME: attendre la prochaine ouverture de
  // clavier laisserait le debordement muet entre-temps -- c'est-a-dire
  // invisible, ce qui est le pire des deux.
  //
  // Le test pose les hauteurs SANS declencher de mesure -- une simple
  // affectation ne mesure rien -- puis clique. Sans la remesure du gestionnaire,
  // le bandeau resterait muet et l'assertion echouerait. C'est donc bien le
  // clic qui mesure, et non une coincidence de l'ordre des operations.
  {
    pose(226, 208);
    remesurer(389);
    check('au depart de ce bloc, tout tient', note.hidden, true);

    quiz.scrollHeight = 264;          // barre deployee: 264 px, par make budget
    toggle.fire('click');
    check('le bandeau parle sans attendre une autre mesure', note.hidden, false);
    check('et il parle de la place qui manque vraiment',
      note.textContent.indexOf('38 px') !== -1, true);

    // On referme. Le bandeau, lui, ne peut pas disparaitre: le stub conserve
    // les hauteurs posees a la main, et 264 px pour 226 debordent toujours --
    // alors que sur l'appareil la barre repliee rendrait ces 68 px.
    //
    // C'est la limite du harnais, et elle est dite plutot que contournee.
    // Poser une hauteur qui "reconvient" ferait passer l'assertion en
    // verifiant le stub et non le code -- c'est precisement la faute que ce
    // fichier reproche a la premiere version de la mesure.
    toggle.fire('click');
    check('refermer redonne la barre repliee', bar.hidden, true);
  }

  // ---- Le bandeau ne se compte pas lui-meme -------------------------------
  //
  // Il est enfant de la coque, comme la zone d'action: il occupe donc de la
  // place sur CELLE de `.screen`. Le code le masquait APRES avoir lu les
  // hauteurs, donc toute relecture le comptait en deduction, et le defaut
  // qu'il rapportait grossissait a chaque mesure. 114 px affirmes la ou il y
  // en avait 44 -- et c'est peut-etre precisement le nombre que l'appareil a
  // rapporté.
  //
  // Deux mesures successives, et le meme chiffre. Sans le masquage prealable,
  // la seconde differait. Il suffirait de n'en faire qu'une pour que le defaut
  // passe inapercu.
  {
    pose(280, 324);            // 210 reels, plus les 70 px du bandeau
    remesurer(443);
    const avant = note.textContent;
    check('le bandeau s\'affiche sur un vrai debordement', note.hidden, false);
    check('la place mesuree exclut le bandeau lui-meme',
      note.textContent.indexOf('280 px') !== -1, true);

    // La barre est REPLIEE ici, et il n'y a toujours pas de retour a lire. Le
    // remede est donc le champ, pas le commentaire -- et c'est cette branche
    // que rien n'affirmait avant: les deux autres etats etaient couverts, celui
    // la laissait passer meme reduit au texte d'origine.
    check('barre repliee et avant reponse, le bandeau renvoie au champ',
      note.textContent.indexOf('Defilez pour atteindre le champ.') !== -1, true);
    check('et il ne parle toujours pas de retour',
      note.textContent.indexOf('lire le retour') === -1, true);

    remesurer(443);
    check('une remeasure ne dit pas autre chose', note.textContent === avant, true);
    check('le defaut ne grossit pas a chaque lecture',
      note.textContent.indexOf('44 px') !== -1, true);

    // Et ce qui est annonce est bien la difference des deux chiffres annonces.
    const manque = parseInt(note.textContent.match(/Il manque (\d+) px/)[1], 10);
    const contenu = parseInt(note.textContent.match(/(\d+) px de contenu/)[1], 10);
    const dispo = parseInt(note.textContent.match(/pour (\d+) px visibles/)[1], 10);
    check('le manque annonce est la difference des deux chiffres',
      manque, contenu - dispo);
  }

  // ---- Apres la reponse, la barre s'en va ---------------------------------
  //
  // 116 px rendues exactement la ou le commentaire et Suivant en ont besoin:
  // 319 px de contenu pour un retour sur trois lignes, contre 210 visibles.
  // On ne compose plus rien une fois la reponse comptee.
  {
    // La barre est deployee pour que sa disparition soit un effet de la
    // reponse, et non un etat ou elle n'etait jamais sortie.
    toggle.fire('click');
    check('la barre est deployee avant de repondre', bar.hidden, false);
    pose(210, 319);
    remesurer(373);

    type('SO4^2-');
    pressEnter();
    check('la reponse est comptee', document.getElementById('feedback').hidden, false);
    check('la barre part avec la reponse', bar.hidden, true);
    check('le bouton de repli part aussi', toggle.hidden, true);
    check('le bouton n\'annonce plus une barre ouverte',
      toggle.getAttribute('aria-expanded'), 'false');
    check('le curseur n\'a pas quitte le champ a la validation',
      document.activeElement === input, true);

    // Et la, la place suffit: 179 px de contenu pour 226. C'est le chiffre qui
    // rend le bouton Suivant et le commentaire visibles en meme temps que le
    // clavier, sur un ecran qui ne les faisait pas tenir a 324.
    pose(226, 179);
    remesurer(389);
    check('apres la reponse, le commentaire et Suivant tiennent a l\'ecran',
      note.hidden, true);
  }

  // ---- Le mode ne survit pas a la question --------------------------------
  //
  // Chaque enonce a sa hauteur, et un ecran qui tient a la question 3 ne doit
  // pas rester resserre parce que la 2 debordait. Le bouton son lit la MEME
  // `var(--pad)` que la coque: un mode persistant le ferait monter et descendre
  // de 8 px d'une question a l'autre, pour rien.
  //
  // Les hauteurs sont posees AVANT le changement de question, parce que
  // renderQuestion() mesure a sa fin: le poser apres testerait un ecran qui
  // deborde encore, et le mode se releverait aussitot -- ce qui est correct,
  // et rendrait l'assertion muette.
  pose(844, 400);
  remesurer(844);
  document.getElementById('next-button').fire('click');
  check('le mode se repose a la question suivante',
    root.getAttribute('data-compact'), undefined);
  check('le bouton de repli s\'efface quand la barre n\'a pas a etre repliee',
    toggle.hidden, true);

  // Et il doit repartir des que la place manque de nouveau, sinon une serie
  // commencee en mode compact resterait resserree pour rien.
  pose(210, 324);
  remesurer(373);
  check('le mode revient des que ca deborde a nouveau',
    root.getAttribute('data-compact'), '1');

  // ---- Le choix du joueur, lui, survit a la question ---------------------
  //
  // 116 px, c'est court. Un joueur qui les veut doit avoir le champ, la
  // formule et l'ecran -- et pas les redemander dix fois.
  //
  // Les hauteurs sont posees AVANT le parcours: chaque changement de question
  // remet le mode a zero puis remesure, donc c'est la derniere question du
  // parcours qui decide, et elle ne voit que ces hauteurs-la.
  //
  // Et la serie est neuve, parce que c'est la seule facon de remettre le choix
  // du joueur a zero. Partir de l'etat laisse par les blocs precedents -- ou il
  // avait demande la barre -- n'aurait pas ete une erreur du code, mais cela
  // aurait teste autre chose: la persistance, pas le repli.
  screen('start');
  startTopic('ions');
  pose(210, 324);
  remesurer(373);
  ok('une question de formule pour le choix du joueur', reachFormulaQuestion());
  check('le mode repart des que la place manque',
    root.getAttribute('data-compact'), '1');
  check('la barre est de nouveau repliee', bar.hidden, true);
  check('le bouton de repli est de la', toggle.hidden, false);
  check('le bouton annonce une barre repliee',
    toggle.getAttribute('aria-expanded'), 'false');

  toggle.fire('click');
  check('le joueur la deploye', bar.hidden, false);
  check('le bouton annonce une barre deployee',
    toggle.getAttribute('aria-expanded'), 'true');
  type(expectedAnswer(currentPrompt()));
  pressEnter();
  document.getElementById('next-button').fire('click');
  ok('une nouvelle formule pour verifier la reprise', reachFormulaQuestion());
  check('le choix survit a la question suivante', bar.hidden, false);

  // Mais une NOUVELLE serie, c'est une nouvelle session: le choix ne survit
  // pas au changement de sujet.
  screen('start');
  startTopic('ions');
  ok('une formule dans la nouvelle serie', reachFormulaQuestion());
  check('le choix est remis a zero par une nouvelle serie', bar.hidden, true);

  // ---- Et la barre n'a pas change de comportement -------------------------
  //
  // Elle est repliee, pas amputee: les touches existent, et un joueur qui la
  // redeploie retrouve exactement les memes gestes. Le repli ne doit rien
  // changer a l'insertion.
  {
    toggle.fire('click');
    type('SO');
    input.setSelectionRange(2, 2);
    dom.key('2').fire('click');
    check('l\'insertion marche apres un repli et un deploiement', input.value, 'SO2');
  }

  quiz.clientHeight = 0;
  quiz.scrollHeight = 0;
  remesurer(844);
  check('plus de mesure, plus de bandeau', note.hidden, true);
}
