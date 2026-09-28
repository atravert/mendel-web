#!/usr/bin/env python3
"""Genere mendel-web/js/data.js a partir des sources natives.

Les donnees sont dupliquees quatre fois dans les apps natives: elements et
ions dans QuizGenerator.kt *et* dans QuizModel.swift, les 79 phrases dans
strings.xml *et* dans QuizModel.swift. Plutot que de les recopier a la main
-- 79 phrases avec accents et emojis, le genre de copie qui introduit des
fautes silencieuses -- on extrait la version la plus complete
(QuizModel.swift) et on la reemet sous forme de module JS.

Le texte est repris octet pour octet: accents, emojis et apostrophes
ASCII d'origine sont conserves, seuls les guillemets et retours a la ligne
sont echappes pour le JavaScript.
"""

import os
import re
import sys

# Nom Swift -> cle dans l'objet COMMENTS exporte.
COMMENT_ARRAYS = [
    ("feedbackCorrect", "correct"),
    ("feedbackWrong", "wrong"),
    ("comments0To3", "final0to3"),
    ("comments4To5", "final4to5"),
    ("comments6To7", "final6to7"),
    ("comments8To9", "final8to9"),
    ("comments10", "final10"),
]

# Numeros atomiques faux dans QuizModel.swift. Le quiz ne s'en sert pas pour
# l'affichage, mais la donnee doit etre juste des qu'elle fait autorite.
ATOMIC_NUMBER_FIXES = {
    # Krypton est le 36: la source iOS ecrit 35.
    "Kr": 36,
}

HEADER = """// Source de verite unique du contenu du quiz.
//
// Fichier genere par tools/extract-data.py depuis mendel-ios/Mendel-iOS/
// QuizModel.swift -- ne pas editer a la main. C'etait la version Android
// (QuizGenerator.kt) qui portait aussi ces listes, en plus court et avec
// sept ions commentes; cette version-ci fait autorite.
//
// 62 elements, 20 ions polyatomiques, 79 phrases de retour.

export const ELEMENTS = %s;

export const IONS = %s;

export const COMMENTS = %s;

/** Series proposees a l'ecran de depart. */
export const TOPICS = [
  { id: 'elements', label: 'Elements chimiques' },
  { id: 'ions', label: 'Ions polyatomiques' },
];

/** Nombre de questions par serie. */
export const QUESTIONS_PER_SERIES = 10;
"""


def read(path):
    try:
        return open(path, encoding="utf-8").read()
    except OSError as exc:
        sys.exit("impossible de lire %s: %s" % (path, exc))


def array_block(src, name):
    """Contenu du litteral [...] de `static let <name> = [...]`."""
    match = re.search(r"static let %s\s*(?::[^=]+)?=\s*\[" % re.escape(name), src)
    if not match:
        return None
    start = src.index("[", match.start())
    depth, index = 0, start
    while index < len(src):
        char = src[index]
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return src[start + 1:index]
        elif char == '"':                  # sauter les chaines
            index += 1
            while src[index] != '"':
                index += 2 if src[index] == "\\" else 1
        index += 1
    return None


def block_of(src, name):
    block = array_block(src, name)
    if block is None:
        sys.exit("tableau Swift introuvable: %s" % name)
    return block


def swift_strings(block):
    return [
        m.group(1)
        .replace('\\"', '"')
        .replace("\\n", "\n")
        .replace("\\\\", "\\")
        for m in re.finditer(r'"((?:[^"\\]|\\.)*)"', block)
    ]


def jstr(text):
    """Litteral JS sur une ligne. Le texte reste identique a la source."""
    if isinstance(text, int):
        return str(text)
    escaped = (
        text.replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace('"', '\\"')
        .replace("\n", "\\n")
    )
    return "'%s'" % escaped


def js_string_list(values, indent):
    pad = "  " * indent
    return "[\n%s\n%s]" % ("".join("%s  %s,\n" % (pad, jstr(v)) for v in values), pad)


def js_object(pairs, indent):
    pad = "  " * indent
    body = "".join(
        "%s  %s: %s,\n" % (pad, key, js_string_list(value, indent + 1))
        for key, value in pairs
    )
    return "{\n%s%s}" % (body, pad)


def js_record_list(records, indent):
    """Liste d'objets a proprietes nommees, une ligne chacun."""
    pad = "  " * indent
    inner = "  " * (indent + 1)
    body = "".join(
        "%s  { %s },\n"
        % (pad, ", ".join("%s: %s" % (k, jstr(v)) for k, v in record.items()))
        for record in records
    )
    return "[\n%s%s]" % (body, pad)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    swift_path = os.environ.get("MENDEL_SWIFT") or os.path.join(
        os.path.dirname(root), "mendel-ios", "Mendel-iOS", "QuizModel.swift"
    )
    src = read(swift_path)

    elements = re.findall(
        r'ChemicalElement\(\s*(\d+)\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)',
        block_of(src, "elements"),
    )
    if not elements:
        sys.exit("aucun element extrait")
    elements = [
        {"z": ATOMIC_NUMBER_FIXES.get(symbol, int(z)), "symbol": symbol, "name": name}
        for z, symbol, name in elements
    ]
    for symbol, correct_z in ATOMIC_NUMBER_FIXES.items():
        found = [e for e in elements if e["symbol"] == symbol]
        if not found:
            sys.exit("correctif d'atomicite introuvable pour %s" % symbol)
        if found[0]["z"] != correct_z:
            sys.exit("correctif d'atomicite non applique pour %s" % symbol)

    ions = re.findall(
        r'PolyatomicIon\(name:\s*"([^"]*)"\s*,\s*formula:\s*"([^"]*)"\)',
        block_of(src, "ions"),
    )
    if not ions:
        sys.exit("aucun ion extrait")
    ions = [{"name": name, "formula": formula} for name, formula in ions]

    comments = [(key, swift_strings(block_of(src, name))) for name, key in COMMENT_ARRAYS]
    for key, value in comments:
        if not value:
            sys.exit("tableau de commentaires vide: %s" % key)

    out = HEADER % (
        js_record_list(elements, 0),
        js_record_list(ions, 0),
        js_object(comments, 0),
    )
    path = os.path.join(root, "js", "data.js")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(out)

    print("elements : %d" % len(elements))
    print("ions     : %d" % len(ions))
    print("phrases  : %d" % sum(len(v) for _, v in comments))
    print("ecrit    : %s" % os.path.relpath(path, root))


if __name__ == "__main__":
    main()
