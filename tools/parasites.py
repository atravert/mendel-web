"""Recherche de caracteres qui n'ont rien a faire dans le depot.

Ce controle existe parce qu'ils se sont glisses trois fois dans des commentaires
et des chaines, toujours dans des textes en francais, toujours invisibles a la
relecture rapide. Un `?` a la place d'un `e`, ou deux ideogrammes au milieu
d'une phrase, ne cassent aucun test et se propagent jusqu'a l'ecran de
l'utilisateur.

Les accents et la ponctuation francaise sont deliberement exclus: ils sont
legitimes. Seuls les caracteres issus d'autres systemes d'ecriture et les
caracteres de remplacement sont signales.

Usage: python3 tools/parasites.py [racine ...]
Sortie: la liste des occurrences, et un code de retour non nul s'il y en a.
"""

import pathlib
import re
import sys

# Cartes d'ecriture hors du francais et des symboles usuels.
ETRANGES = re.compile(
    "["
    "\u0400-\u04ff"  # cyrillique
    "\u0530-\u058f"  # armenien
    "\u0590-\u05ff"  # hebreu
    "\u0600-\u06ff"  # arabe
    "\u0e00-\u0e7f"  # thai
    "\u3040-\u30ff"  # kana
    "\u3400-\u4dbf"  # ideogrammes etendus
    "\u4e00-\u9fff"  # ideogrammes
    "\uac00-\ud7af"  # hangul
    "\ufffd"         # caractere de remplacement
    "]"
)

# Fichiers a ignorer: binaires, et le materiel lui-meme.
IGNORES = {".git", "node_modules", "__pycache__", ".DS_Store"}


def fichier_texte(path):
    try:
        donnees = path.read_bytes()
    except OSError:
        return None
    if b"\0" in donnees[:8192]:
        return None
    try:
        return donnees.decode("utf-8")
    except UnicodeDecodeError:
        return None


def cherche(racine):
    trouves = []
    racine = pathlib.Path(racine)
    fichiers = [racine] if racine.is_file() else racine.rglob("*")
    for chemin in sorted(fichiers):
        if not chemin.is_file() or IGNORES & set(chemin.parts):
            continue
        if chemin.suffix in {".png", ".wav", ".icns", ".ico", ".jpg", ".woff2"}:
            continue
        texte = fichier_texte(chemin)
        if texte is None:
            continue
        for numero, ligne in enumerate(texte.split("\n"), 1):
            for trouve in ETRANGES.finditer(ligne):
                trouves.append((chemin, numero, trouve.group(), ligne.strip()[:90]))
    return trouves


def main(argv):
    racines = argv[1:] or ["."]
    trouves = []
    for racine in racines:
        trouves.extend(cherche(racine))

    if not trouves:
        print("aucun caractere parasite")
        return 0

    for chemin, numero, caractere, ligne in trouves:
        print("%s:%d  U+%04X  %r" % (chemin, numero, ord(caractere), ligne))
    print("%d caractere(s) parasite(s)" % len(trouves))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
