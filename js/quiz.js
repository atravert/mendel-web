// Logique du quiz: generation des series, correction des reponses, mise en
// forme. Port des apps natives (QuizGenerator.kt et QuizModel.swift), avec
// des corrections assumees, signalees ci-dessous.

import { ELEMENTS, IONS, COMMENTS, QUESTIONS_PER_SERIES } from './data.js';

export const DIRECTION = {
  NAME_TO_CODE: 'nameToCode',
  CODE_TO_NAME: 'codeToName',
};

/** Libelles de l'enonce, par theme et par sens. */
const QUESTION_TYPE = {
  elements: {
    nameToCode: 'Quel est le symbole chimique du :',
    codeToName: 'Quel élément correspond au symbole :',
  },
  ions: {
    nameToCode: "Quelle est la formule de l'ion :",
    codeToName: 'Quel ion correspond à la formule :',
  },
};

/**
 * Texte d'aide du champ de saisie. La formule est annoncee avec ses vrais
 * indices et exposants Unicode, c'est-a-dire sous la forme que produisent
 * les touches dediees de la barre de symboles.
 */
const INPUT_HINT = {
  elements: {
    nameToCode: 'Tape le symbole (ex. : Fe)',
    codeToName: "Tape le nom de l'élément",
  },
  ions: {
    nameToCode: 'Tape la formule (ex. : ClO₃⁻)',
    codeToName: "Tape le nom de l'ion",
  },
};

// ---------------------------------------------------------------------------
// Aleatoire
// ---------------------------------------------------------------------------

/** Melange de Fisher-Yates, en place. */
function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function pickSome(items, count) {
  return shuffle(items.slice()).slice(0, count);
}

// ---------------------------------------------------------------------------
// Generation des series
// ---------------------------------------------------------------------------

/**
 * Une seriemelange nom->code et code->nom a parts egales, comme
 * QuizGenerator.generateSeries: la moitie des entrees est posee dans un
 * sens, l'autre dans l'autre, puis l'ensemble est melee.
 */
export function generateSeries(topicId, count = QUESTIONS_PER_SERIES) {
  const pool = topicId === 'ions'
    ? IONS.map((ion) => ({ name: ion.name, code: ion.formula }))
    : ELEMENTS.map((el) => ({ name: el.name, code: el.symbol }));

  const chosen = pickSome(pool, count);
  const half = Math.floor(count / 2);

  return shuffle(chosen.map((entry, index) => {
    const direction = index < half ? DIRECTION.NAME_TO_CODE : DIRECTION.CODE_TO_NAME;
    return {
      topic: topicId,
      direction,
      prompt: direction === DIRECTION.NAME_TO_CODE ? entry.name : entry.code,
      answer: direction === DIRECTION.NAME_TO_CODE ? entry.code : entry.name,
    };
  }));
}

// ---------------------------------------------------------------------------
// Correction
// ---------------------------------------------------------------------------

// La casse compte desormais.
//
// Une formule chimique n'a qu'une seule graphie legitime: la majuscule de
// chaque symbole d'element. Accepter "clo3-" ou "CLO3-" apprend une faute --
// c'est tout l'interet d'un quiz de chimie. Les deux apps natives etaient
// laxistes sur ce point, et l'app iOS aggravait le probleme en forçant la
// majuscule complete via .textInputAutocapitalization(.characters).
//
// Consequence assumee: la saisie devient exigeante. Le clavier est donc
// configure en autocapitalize="sentences" (voir index.html), qui ouvre en
// majuscule puis bascule seul apres le premier caractere. "Fe" et "ClO"
// s'ecrivent donc naturellement; les majuscules suivantes restent a la main.
//
// CORRECTION 1 (annulee) -- le symbole d'un element etait compare sans
// tenir compte de la casse, pour que "fe" et "FE" comptent juste.
export function normalizeSymbol(input) {
  return input.trim();
}

// CORRECTION 2 -- normalizeFormula des natives ne retirait que l'espace et
// "^". Or les claviers de telephone produisent volontiers les vrais indices
// et exposants Unicode: taper "ClO3^-" au doigt donne souvent "ClO₃⁻", qui
// etait refuse. On convertit d'abord vers de l'ASCII, puis on normalise.
//
// La touche "^" a disparu de la barre de symboles, remplacee par les touches
// d'indice et d'exposant (voir les tables ci-dessous): le "^" n'est plus
// qu'un equivalent clavier, accepte mais plus propose.
const SUBSCRIPT_TO_ASCII = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₋': '-', '₊': '+',
};

const SUPERSCRIPT_TO_ASCII = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁻': '-', '⁺': '+',
};

/**
 * Ramene une formule a une forme unique: "ClO3^-", "ClO3-" et "ClO₃⁻"
 * donnent tous la meme cle. La casse, elle, est preservee.
 */
export function normalizeFormula(input) {
  let text = '';
  for (const char of input.trim()) {
    const sub = SUBSCRIPT_TO_ASCII[char];
    const sup = SUPERSCRIPT_TO_ASCII[char];
    if (sub) text += sub;
    else if (sup) text += sup;
    else if (char !== '^' && !/\s/.test(char)) text += char;
  }
  return text;
}

/** Nom d'element ou d'ion: insensible a la casse, aux accents et aux espaces. */
export function normalizeName(input) {
  return input
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // diacritiques combinants (U+0300-U+036F)
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** La reponse tapee est-elle correcte pour cette question ? */
export function isCorrect(input, question) {
  const answer = input.trim();
  if (!answer) return false;

  if (question.direction === DIRECTION.NAME_TO_CODE) {
    return question.topic === 'elements'
      ? normalizeSymbol(answer) === normalizeSymbol(question.answer)
      : normalizeFormula(answer) === normalizeFormula(question.answer);
  }
  // Les noms restent tolerants: on demande le nom de l'ion, pas sa graphie
  // exacte, et taper "nitrate" au doigt ne doit pas etre puni.
  return normalizeName(answer) === normalizeName(question.answer);
}

// ---------------------------------------------------------------------------
// Saisie en indice ou en exposant
// ---------------------------------------------------------------------------

/**
 * Ce qu'inserent les touches d'indice et d'exposant de la barre de symboles,
 * pour chaque touche du clavier. La lettre est la cle: le code du caractere
 * Unicode insere.
 *
 * Ce sont de vrais caracteres Unicode et non de l'ASCII, parce que la touche
 * "^" a disparu de la barre. Sans elle, il faut bien un signe qui distingue
 * la charge du corps de la formule: un "⁻" en exposant ne peut designer que
 * la charge, alors que "SO42-" se lirait "SO(quarante-deux)". C'est aussi la
 * forme qu'affichait deja l'application, via <sub> et <sup>.
 *
 * Ces caracteres sont enfin ceux que produisent les claviers de telephone,
 * donc une formule frappee au clavier et une formule composee a la barre se
 * rejoignent, sans double saisie a l'ecran.
 */
export const SCRIPT_TABLES = {
  sub: {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
    '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
    '+': '₊', '-': '₋',
  },
  sup: {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻',
  },
};

/**
 * Que fait la touche frappee pendant qu'un mode indice ou exposant est arme?
 *
 * Renvoie null si aucun mode n'est arme. Sinon `{ char, mode }`: `char` est
 * le caractere a inserer, ou null si la touche n'en produit pas; `mode` est
 * le mode a conserver.
 *
 * La regle de sortie est celle de la demande: un chiffre, "+" ou "-" restent
 * dans le mode, tout le reste en sort. C'est ce qui permet de taper une
 * charge d'affilee -- exposant, "2", "-", soit trois touches, dont les deux
 * dernieres doivent rester dans le mode. Un caractere de formule en sort,
 * ce qui permet de reprendre la base: "SO", indice, "4", "O" (sortie), puis
 * exposant, "2", "-".
 */
export function scriptInput(mode, key) {
  if (!mode || !SCRIPT_TABLES[mode]) return null;
  const char = SCRIPT_TABLES[mode][key];
  return { char: char || null, mode: char ? mode : null };
}

// ---------------------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------------------

/** "fe" -> "Fe", comme MainActivity.formatSymbol. */
export function formatSymbol(symbol) {
  if (!symbol) return '';
  return symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
}

/**
 * Decoupe une formule ionique en morceaux a afficher, pour que le rendu se
 * fasse avec de vrais <sub>/<sup> plutot qu'avec des caracteres Unicode:
 * "SO4^2-" -> [{S, base}, {O, base}, {4, sub}, {2-, sup}].
 *
 * Retourne des donnees, jamais du HTML: c'est ui.js qui construit les
 * noeuds, donc aucune chaine venant de la saisie n'atteint innerHTML.
 */
export function formulaParts(formula) {
  const [body, charge] = formula.split('^');
  const parts = [];

  // Les chiffres du corps sont des indices, ceux de la charge sont des
  // exposants: on alterne donc les deux dans le corps.
  for (const run of body.match(/[0-9]+|[^0-9]+/g) || []) {
    parts.push({ text: run, script: /^[0-9]+$/.test(run) ? 'sub' : null });
  }
  if (charge) parts.push({ text: charge, script: 'sup' });

  return parts;
}

/** L'enonce affiche a l'ecran pour la question courante. */
export function displayedPrompt(question) {
  if (question.direction !== DIRECTION.CODE_TO_NAME) return question.prompt;
  return question.topic === 'ions' ? question.prompt : formatSymbol(question.prompt);
}

export function questionTypeText(question) {
  return QUESTION_TYPE[question.topic][question.direction];
}

export function inputHint(question) {
  return INPUT_HINT[question.topic][question.direction];
}

// ---------------------------------------------------------------------------
// Phrases de retour
// ---------------------------------------------------------------------------

// Comme dans les deux natives: on evite de repeter deux fois de suite la
// meme variante.
let lastCommentIndex = -1;

function drawComment(variants) {
  if (variants.length === 0) return '';
  let index = Math.floor(Math.random() * variants.length);
  if (variants.length > 1 && index === lastCommentIndex) {
    index = (index + 1) % variants.length;
  }
  lastCommentIndex = index;
  return variants[index];
}

export function correctComment() {
  return drawComment(COMMENTS.correct);
}

export function wrongComment() {
  return drawComment(COMMENTS.wrong);
}

/**
 * Phrase finale. Les natives utilisent des seuils figes (>= 10, >= 8...)
 * qui n'ont de sens que pour une serie de 10; ici on raisonne en ratio pour
 * que le comportement survive a un changement de QUESTIONS_PER_SERIES.
 */
export function finalComment(score, total = QUESTIONS_PER_SERIES) {
  const ratio = total > 0 ? score / total : 0;
  if (ratio === 1) return drawComment(COMMENTS.final10);
  if (ratio >= 0.8) return drawComment(COMMENTS.final8to9);
  if (ratio >= 0.6) return drawComment(COMMENTS.final6to7);
  if (ratio >= 0.4) return drawComment(COMMENTS.final4to5);
  return drawComment(COMMENTS.final0to3);
}

/** La bonne reponse, formtee pour l'affichage. */
export function formatAnswer(question) {
  if (question.direction === DIRECTION.NAME_TO_CODE) {
    return question.topic === 'ions' ? question.answer : formatSymbol(question.answer);
  }
  return question.answer;
}

/** Reinitialise l'anti-repetition, pour un questionnaire neuf. */
export function resetCommentHistory() {
  lastCommentIndex = -1;
}
