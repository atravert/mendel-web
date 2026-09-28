#!/usr/bin/env python3
"""Controle de structure des fichiers JavaScript du projet.

Node n'est pas installe sur cette machine, donc pas de `node --check`.
Ce script fait le minimum qui evite les erreurs de frappe les plus
courantes dans du JS genere: litteraux de chaine mal fermes, echappement
oublie, commentaire de fin de fichier non termine.

C'est un analyseur lexical, pas un analyseur grammatical: il ne remplace
pas un vrai parseur, mais il attrape les fautes de generation.
"""

import sys


def check(path):
    src = open(path, encoding="utf-8").read()
    errors = []
    i, line, n = 0, 1, len(src)
    state = "code"          # code | line | block | sq | dq | tpl | regex | regexclass
    quote_line = 0
    prev = ""               # dernier caractere significatif vu dans le code
    word = ""               # identifiant en cours de lecture

    while i < n:
        char = src[i]
        nxt = src[i + 1] if i + 1 < n else ""

        if char == "\n":
            line += 1
            if state == "line":
                state = "code"          # un // se termine a la fin de ligne
            elif state in ("sq", "dq", "tpl", "regex"):
                errors.append((quote_line, "%s non ferme avant le saut de ligne" % state))
            i += 1
            continue

        if state == "code":
            if char == "/" and nxt == "/":
                state = "line"
                i += 2
                continue
            if char == "/" and nxt == "*":
                state, quote_line = "block", line
                i += 2
                continue
            if char == "/" and starts_regex(prev, word):
                # Un littéral de regex, pas une division. Indispensable ici:
                # /id="([^"]+)"/ contient des guillemets qui feraient croire a
                # une chaine. On ne peut pas distinguer regex et division sans
                # un vrai parseur, d'ou l'heuristique sur le caractere precedent.
                state, quote_line = "regex", line
                i += 1
                continue
            if char in "'\"":
                state, quote_line = ("sq" if char == "'" else "dq"), line
            elif char == "`":
                state, quote_line = "tpl", line
        elif state == "line":
            pass
        elif state == "block":
            if char == "*" and nxt == "/":
                state = "code"
                i += 2
                continue
        elif state == "regex":
            if char == "\\":
                i += 2
                continue
            if char == "[":
                state = "regexclass"      # les ] n'y ferment pas la regex
            elif char == "/":
                state = "code"
                prev = "/"
                i += 1
                continue
        elif state == "regexclass":
            if char == "\\":
                i += 2
                continue
            if char == "]":
                state = "regex"
        elif state in ("sq", "dq", "tpl"):
            closing = {"sq": "'", "dq": '"', "tpl": "`"}[state]
            if char == "\\":
                i += 2
                continue
            if char == closing:
                state = "code"

        if state == "code":
            if char.isalnum() or char in "_$":
                word += char
            else:
                word = ""
            if not char.isspace():
                prev = char
        i += 1

    for leftover, label in (("sq", "chaine '"), ("dq", 'chaine "'),
                            ("tpl", "chaine `"), ("regex", "regex")):
        if state == leftover:
            errors.append((quote_line, "%s non fermee en fin de fichier" % label))
    if state == "block":
        errors.append((quote_line, "commentaire /* non termine"))
    if state == "regexclass":
        errors.append((quote_line, "classe de regex [...] non fermee"))

    return errors


# Un "/" ouvre une regex apres un operateur, un separateur ou un mot reserve,
# et c'est une division apres un identifiant, un nombre ou une parenthese
# fermante. Impossible de trancher sans un vrai parseur, donc heuristique.
_REGEX_PRECEDERS = set("(,=:[!&|?{};+-*%~^<>\n")
_REGEX_KEYWORDS = {
    "return", "typeof", "instanceof", "new", "delete", "void",
    "case", "in", "of", "yield", "await", "else", "do",
}


def starts_regex(prev, word):
    if prev == "":
        return True
    if prev in _REGEX_PRECEDERS:
        return True
    if word and word in _REGEX_KEYWORDS:
        return True
    # Identifiant, chiffre ou fermeture: c'est une division.
    if prev.isalnum() or prev in "_$)]":
        return False
    return True


def main():
    paths = sys.argv[1:]
    if not paths:
        sys.exit("usage: check-js.py <fichier.js> ...")

    failed = False
    for path in paths:
        errors = check(path)
        if errors:
            failed = True
            print("ECHEC  %s" % path)
            for line, message in errors[:10]:
                print("       ligne %d : %s" % (line, message))
        else:
            print("ok     %s" % path)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
