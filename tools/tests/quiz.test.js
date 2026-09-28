// Tests de la logique du quiz. Executes par tools/run-tests.py, qui
// concatene data.js et quiz.js en un seul script -- JavaScriptCore ne
// gere pas les modules ES, et Node n'est pas installe sur cette machine.

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
  } else {
    failed += 1;
    print('ECHEC  ' + label);
    print('         attendu  ' + b);
    print('         obtenu   ' + a);
  }
}

function ok(label, condition) {
  check(label, Boolean(condition), true);
}

// ---------------------------------------------------------------------------
// Donnees
// ---------------------------------------------------------------------------

check('62 elements', ELEMENTS.length, 62);
check('20 ions', IONS.length, 20);
check('krypton est le 36', ELEMENTS.filter((e) => e.symbol === 'Kr')[0].z, 36);
check('brome est le 34', ELEMENTS.filter((e) => e.symbol === 'Br')[0].z, 34);
ok('aucun numero atomique duplique', new Set(ELEMENTS.map((e) => e.z)).size === ELEMENTS.length);
ok('aucun symbole duplique', new Set(ELEMENTS.map((e) => e.symbol)).size === ELEMENTS.length);
ok('aucun nom duplique', new Set(ELEMENTS.map((e) => e.name)).size === ELEMENTS.length);
ok('aucun ion duplique', new Set(IONS.map((i) => i.name)).size === IONS.length);
ok('aucune formule dupliquee', new Set(IONS.map((i) => i.formula)).size === IONS.length);
ok('commentaires de reussite non vides', COMMENTS.correct.length > 0);
ok('commentaires d\'echec non vides', COMMENTS.wrong.length > 0);
ok('bilan de fin present', COMMENTS.final10.length > 0);

// ---------------------------------------------------------------------------
// Generation des series
// ---------------------------------------------------------------------------

for (const topic of ['elements', 'ions']) {
  for (let run = 0; run < 200; run += 1) {
    const series = generateSeries(topic, 10);
    if (series.length !== 10) {
      check(topic + ': 10 questions', series.length, 10);
      break;
    }
    const toCode = series.filter((q) => q.direction === DIRECTION.NAME_TO_CODE);
    const toName = series.filter((q) => q.direction === DIRECTION.CODE_TO_NAME);
    if (toCode.length !== 5 || toName.length !== 5) {
      check(topic + ': moitie/moitie', [toCode.length, toName.length], [5, 5]);
      break;
    }
    if (new Set(series.map((q) => q.prompt + q.answer)).size !== 10) {
      check(topic + ': pas de doublon dans la serie', 'doublon', 'unique');
      break;
    }
    if (series.some((q) => q.topic !== topic)) {
      check(topic + ': theme coherent', 'melange', topic);
      break;
    }
  }
}
ok('1000 series generees sans doublon ni desequilibre', passed > 0);

// Les 62 elements doivent tous pouvoir sortir sur une longue serie. Chaque
// element apparait deux fois: une fois nom->code, une fois code->nom.
{
  const seen = new Set();
  for (let run = 0; run < 400; run += 1) {
    for (const q of generateSeries('elements', 62)) {
      seen.add(q.direction + '|' + q.prompt + '|' + q.answer);
    }
  }
  check('les 62 elements sont atteignables dans les deux sens', seen.size, 62 * 2);
}

check('une serie de 3 donne 1 nom->code et 2 code->nom', generateSeries('elements', 3)
  .filter((q) => q.direction === DIRECTION.NAME_TO_CODE).length, 1);

// ---------------------------------------------------------------------------
// CASSE STRICTE: le symbole se tape tel qu'il s'ecrit
// ---------------------------------------------------------------------------

const symbolQuestion = {
  topic: 'elements',
  direction: DIRECTION.NAME_TO_CODE,
  prompt: 'Fer',
  answer: 'Fe',
};
check('symbole exact', isCorrect('Fe', symbolQuestion), true);
check('symbole entoure d espaces', isCorrect('  Fe  ', symbolQuestion), true);
check('symbole en minuscules refuse', isCorrect('fe', symbolQuestion), false);
check('symbole tout majuscules refuse', isCorrect('FE', symbolQuestion), false);
check('symbole a l\'inverse des cas refuse', isCorrect('fE', symbolQuestion), false);
check('mauvais symbole', isCorrect('Fr', symbolQuestion), false);
check('le nom entier ne vaut pas', isCorrect('Fer', symbolQuestion), false);
check('reponse vide', isCorrect('', symbolQuestion), false);
check('reponse blanche', isCorrect('   ', symbolQuestion), false);

check('symbole mono-caractere', isCorrect('U', {
  topic: 'elements', direction: DIRECTION.NAME_TO_CODE, prompt: 'Uranium', answer: 'U',
}), true);
check('symbole mono-caractere en minuscule refuse', isCorrect('u', {
  topic: 'elements', direction: DIRECTION.NAME_TO_CODE, prompt: 'Uranium', answer: 'U',
}), false);

// ---------------------------------------------------------------------------
// Formules d'ions: forme toleratee, casse non
// ---------------------------------------------------------------------------

const ionQuestion = {
  topic: 'ions',
  direction: DIRECTION.NAME_TO_CODE,
  prompt: 'Chlorate',
  answer: 'ClO3^-',
};
check('formule canonique', isCorrect('ClO3^-', ionQuestion), true);
check('formule sans carets', isCorrect('ClO3-', ionQuestion), true);
check('formule avec espaces', isCorrect('  Cl O 3 ^ - ', ionQuestion), true);
check('vrais indices et exposants', isCorrect('ClO₃⁻', ionQuestion), true);
check('mauvaise charge', isCorrect('ClO3^2-', ionQuestion), false);
check('mauvais oxygene', isCorrect('ClO2^-', ionQuestion), false);
check('nom a la place de la formule', isCorrect('Chlorate', ionQuestion), false);
check('formule en minuscules refusee', isCorrect('clo3-', ionQuestion), false);
check('formule tout en majuscules refusee', isCorrect('CLO3-', ionQuestion), false);
check('oxygene en minuscule refuse', isCorrect('Clo3-', ionQuestion), false);

const divalent = { topic: 'ions', direction: DIRECTION.NAME_TO_CODE, prompt: 'Sulfate', answer: 'SO4^2-' };
check('charge 2- canonique', isCorrect('SO4^2-', divalent), true);
check('charge 2- en Unicode', isCorrect('SO₄²⁻', divalent), true);
check('charge 2- en Unicode et ASCII melanges', isCorrect('SO₄2-', divalent), true);

const cation = { topic: 'ions', direction: DIRECTION.NAME_TO_CODE, prompt: 'Ammonium', answer: 'NH4^+' };
check('charge + en Unicode', isCorrect('NH₄⁺', cation), true);
check('charge + separee', isCorrect('NH4^+', cation), true);

check('thiosulfate a deux indices', isCorrect('S2O3^2-', {
  topic: 'ions', direction: DIRECTION.NAME_TO_CODE, prompt: 'Thiosulfate', answer: 'S2O3^2-',
}), true);
check('thiosulfate en Unicode', isCorrect('S₂O₃²⁻', {
  topic: 'ions', direction: DIRECTION.NAME_TO_CODE, prompt: 'Thiosulfate', answer: 'S2O3^2-',
}), true);

// ---------------------------------------------------------------------------
// Les 20 formules doivent etre acceptables sous la forme que produisent les
// touches indice et exposant. C'est le test qui prouve que la barre sert a
// quelque chose: si la normalisation ne reconnait pas un caractere insere,
// le joueur ne peut plus reussir une seule question de formule au doigt.
// ---------------------------------------------------------------------------

/** Reproduit la saisie au doigt: corps en indices, charge en exposants. */
function typedFormula(formula) {
  const [body, charge] = formula.split('^');
  return body.replace(/[0-9]/g, (d) => SCRIPT_TABLES.sub[d])
    + (charge || '').replace(/[0-9+-]/g, (c) => SCRIPT_TABLES.sup[c]);
}

{
  const refusees = IONS.filter((ion) => !isCorrect(typedFormula(ion.formula), {
    topic: 'ions', direction: DIRECTION.NAME_TO_CODE, prompt: ion.name, answer: ion.formula,
  })).map((ion) => ion.formula);
  check('les 20 formules passent la saisie a la barre', refusees, []);
}

// ---------------------------------------------------------------------------
// Mode indice / exposant
// ---------------------------------------------------------------------------

check('aucun mode arme: la frappe n\'est pas traduite', scriptInput(null, '3'), null);
check('mode inconnu ignore', scriptInput('bidon', '3'), null);

check('indice: un chiffre', scriptInput('sub', '4'), { char: '₄', mode: 'sub' });
check('indice: le zero', scriptInput('sub', '0'), { char: '₀', mode: 'sub' });
check('indice: le moins reste dans le mode', scriptInput('sub', '-'), { char: '₋', mode: 'sub' });
check('indice: le plus reste dans le mode', scriptInput('sub', '+'), { char: '₊', mode: 'sub' });
check('indice: une lettre sort du mode', scriptInput('sub', 'O'), { char: null, mode: null });
check('indice: l\'espace sort du mode', scriptInput('sub', ' '), { char: null, mode: null });
check('indice: backspace sort du mode', scriptInput('sub', 'Backspace'), { char: null, mode: null });
check('indice: entree sort du mode', scriptInput('sub', 'Enter'), { char: null, mode: null });

check('exposant: un chiffre', scriptInput('sup', '2'), { char: '²', mode: 'sup' });
check('exposant: le moins', scriptInput('sup', '-'), { char: '⁻', mode: 'sup' });
check('exposant: le plus', scriptInput('sup', '+'), { char: '⁺', mode: 'sup' });
check('exposant: une lettre sort du mode', scriptInput('sup', 'O'), { char: null, mode: null });

// C'est la raison d'etre de la regle de sortie: les deux caracteres d'une
// charge se tapent d'affilee, et le mode doit tenir entre les deux.
check('la charge se tape d\'un trait', scriptInput(scriptInput('sup', '2').mode, '-'),
  { char: '⁻', mode: 'sup' });
check('indice a deux chiffres', scriptInput(scriptInput('sub', '1').mode, '2'),
  { char: '₂', mode: 'sub' });

// L'invariant qui relie les deux tables: tout ce que la barre insere doit
// etre relu par la normalisation. Une table et la table de conversion qui
// divergent, et le joueur perd le point sur une formule correctement tapee.
{
  let perdus = 0;
  for (const table of [SCRIPT_TABLES.sub, SCRIPT_TABLES.sup]) {
    for (const ascii of Object.keys(table)) {
      if (normalizeFormula(table[ascii]) !== ascii) perdus += 1;
    }
  }
  check('tout caractere insere se relit', perdus, 0);
}

{
  const tous = [].concat(Object.keys(SCRIPT_TABLES.sub), Object.keys(SCRIPT_TABLES.sup));
  const inseres = [].concat(Object.values(SCRIPT_TABLES.sub), Object.values(SCRIPT_TABLES.sup));
  check('douze touches par table', [Object.keys(SCRIPT_TABLES.sub).length,
    Object.keys(SCRIPT_TABLES.sup).length], [12, 12]);
  check('24 caracteres inseres, tous distincts', new Set(inseres).size, 24);
  check('aucun caractere insere n\'est un chiffre ASCII', inseres.filter((c) => /[0-9]/.test(c)).length, 0);
  check('aucun caractere insere n\'est un signe ASCII', inseres.filter((c) => /[+-]/.test(c)).length, 0);
  check('que des touches de chiffres et de signes', tous.filter((t) => !/^[0-9+-]$/.test(t)), []);
}

// ---------------------------------------------------------------------------
// Noms: casse, accents, espaces
// ---------------------------------------------------------------------------

const nameQuestion = {
  topic: 'ions',
  direction: DIRECTION.CODE_TO_NAME,
  prompt: 'NO3^-',
  answer: 'Nitrate',
};
check('nom d\'ion', isCorrect('Nitrate', nameQuestion), true);
check('nom d\'ion minuscule', isCorrect('nitrate', nameQuestion), true);
check('nom d\'ion accents ajoutes', isCorrect('Nitrate', nameQuestion), true);
check('nom d\'ion errone', isCorrect('Nitrite', nameQuestion), false);

check('espace interne tolere', isCorrect('  Nitrate  ', nameQuestion), true);
check('prefixe refuse', isCorrect('le nitrate', nameQuestion), false);
check('suffixe refuse', isCorrect('nitrate !', nameQuestion), false);

check('normalizeName retire les accents', normalizeName('Électron'), 'electron');
check('normalizeName compacte les espaces', normalizeName('  sel   de  cuisine '), 'sel de cuisine');
check('normalizeName garde l\'accent de reference', normalizeName('Manganèse'), 'manganese');
check('normalizeSymbol', normalizeSymbol('  Fe '), 'Fe');
check('normalizeFormula', normalizeFormula('  ClO₃ ⁻ '), 'ClO3-');
check('normalizeSymbol ne replie plus la casse', normalizeSymbol('fE'), 'fE');
check('normalizeFormula ne replie plus la casse', normalizeFormula('CLO3-'), 'CLO3-');

// ---------------------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------------------

check('formatSymbol', formatSymbol('fe'), 'Fe');
check('formatSymbol mono', formatSymbol('u'), 'U');
check('formatSymbol deja correct', formatSymbol('Fe'), 'Fe');
check('formatSymbol vide', formatSymbol(''), '');

// Les runs de caracteres non numeriques sont regroupes: moins de noeuds DOM
// que si l'on emettait une lettre par partie.
check('formule sulfate en morceaux', formulaParts('SO4^2-'), [
  { text: 'SO', script: null },
  { text: '4', script: 'sub' },
  { text: '2-', script: 'sup' },
]);
check('formule sans charge', formulaParts('CN^-'), [
  { text: 'CN', script: null },
  { text: '-', script: 'sup' },
]);
check('formule a deux indices', formulaParts('S2O3^2-'), [
  { text: 'S', script: null },
  { text: '2', script: 'sub' },
  { text: 'O', script: null },
  { text: '3', script: 'sub' },
  { text: '2-', script: 'sup' },
]);
check('formule sans indice', formulaParts('ClO^-'), [
  { text: 'ClO', script: null },
  { text: '-', script: 'sup' },
]);

// displayedPrompt reproduit MainActivity.kt:189 et QuizModel.swift:79: le
// prompt n'est reecrit que dans le sens code->nom. Pour un ion, c'est
// ui.js qui passe la formule par formulaParts() -- equivalent du
// prettyFormula() des natives.
const symbolReverse = {
  topic: 'elements', direction: DIRECTION.CODE_TO_NAME, prompt: 'fe', answer: 'Fer',
};
check('symbole mis en forme a l\'enonce', displayedPrompt(symbolReverse), 'Fe');
check('enonce nom brut', displayedPrompt(symbolQuestion), 'Fer');
check('enonce formule brute', displayedPrompt(nameQuestion), 'NO3^-');
check('enonce ion nom->formule', displayedPrompt(ionQuestion), 'Chlorate');
check('formule d\'enonce ion rendue en morceaux', formulaParts(displayedPrompt(nameQuestion)), [
  { text: 'NO', script: null },
  { text: '3', script: 'sub' },
  { text: '-', script: 'sup' },
]);

// ---------------------------------------------------------------------------
// Libelles
// ---------------------------------------------------------------------------

check('libelle symbole', questionTypeText(symbolQuestion), 'Quel est le symbole chimique du :');
check('libelle nom', questionTypeText(nameQuestion), 'Quel ion correspond à la formule :');
check('aide symbole', inputHint(symbolQuestion), 'Tape le symbole (ex. : Fe)');
// L'aide doit annoncer la forme que produisent les touches de la barre, donc
// avec de vrais indices et exposants Unicode.
ok('aide formule en Unicode', inputHint(ionQuestion).indexOf('ClO₃⁻') !== -1);
check('l\'aide formule ne montre plus le carets', inputHint(ionQuestion).indexOf('^'), -1);

// ---------------------------------------------------------------------------
// Phrases de retour
// ---------------------------------------------------------------------------

const allFinal = [].concat(
  COMMENTS.final0to3, COMMENTS.final4to5, COMMENTS.final6to7,
  COMMENTS.final8to9, COMMENTS.final10,
);
check('41 phrases finales', allFinal.length, 41);
check('79 phrases au total', COMMENTS.correct.length + COMMENTS.wrong.length + allFinal.length, 79);

for (let run = 0; run < 500; run += 1) {
  const perfect = finalComment(10, 10);
  if (COMMENTS.final10.indexOf(perfect) === -1) {
    check('10/10 puis commentaire 10', perfect, 'issu de final10');
    break;
  }
  const bad = finalComment(0, 10);
  if (COMMENTS.final0to3.indexOf(bad) === -1) {
    check('0/10 puis commentaire 0', bad, 'issu de final0to3');
    break;
  }
  const mid = finalComment(7, 10);
  if (COMMENTS.final6to7.indexOf(mid) === -1) {
    check('7/10 puis commentaire 6-7', mid, 'issu de final6to7');
    break;
  }
}

check('commentaire de reussite non vide', correctComment().length > 0, true);
check('commentaire d\'echec non vide', wrongComment().length > 0, true);

// Chaque tirage doit rester dans sa famille. Le test ne verifiait que
// "non vide", ce qui laissait passer un commentaire de reussite affiche apres
// une erreur.
{
  let strays = 0;
  for (let run = 0; run < 500; run += 1) {
    if (COMMENTS.correct.indexOf(correctComment()) === -1) strays += 1;
    if (COMMENTS.wrong.indexOf(wrongComment()) === -1) strays += 1;
  }
  check('aucun tirage ne sort de sa famille', strays, 0);
}

// Les deux familles ne doivent pas se recouvrir: c'est ce qui permet a
// l'interface de distinguer "Nickel chrome !" de "Aïe, raté !".
{
  const overlap = COMMENTS.correct.filter((c) => COMMENTS.wrong.indexOf(c) !== -1);
  check('les familles "juste" et "faux" sont disjointes', overlap.length, 0);
}

// L'anti-repetition: deux tirages d'affilee ne rendent jamais la meme chose
// quand la liste a plusieurs variantes.
{
  let repeats = 0;
  for (let run = 0; run < 500; run += 1) {
    const a = correctComment();
    const b = correctComment();
    if (a === b) repeats += 1;
  }
  check('pas de repetition immediate', repeats, 0);
}

// Les seuils suivent le ratio, pas un total fige.
const total90 = [];
for (let run = 0; run < 200; run += 1) {
  total90.push(finalComment(90, 100));
}
ok('une serie de 100 questions marche aussi', total90.every((c) => c.length > 0));

// ---------------------------------------------------------------------------
// Le resume et le code de sortie sont produits une seule fois par
// tools/run-tests.py, apres tous les fichiers de test.
