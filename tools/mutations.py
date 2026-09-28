#!/usr/bin/env python3
"""Verifie que les tests et les controles statiques detectent la casse.

Une suite verte ne prouve rien tant qu'on n'a pas vu la devenir rouge. Ce
script casse le code d'une facon PRECISE, lance la verification, et exige
qu'elle echoue.

Trois issues, et non deux. Une mutation peut:

  - etre DETECTEE: une assertion ou un controle signale l'anomalie. C'est le
    resultat attendu;
  - CASSER LE HARNAIS: la mutation empeche la verification de tourner -- une
    ReferenceError, un fichier illisible, un import mort. La suite n'a pas
    verifie, elle s'est arretee. C'est aussi un echec, mais un echec qui ne
    prouve rien: compter cette mutation comme "detectee" rendrait le rapport
    flatteur sur des mutations qui n'ont rien verifie du tout;
  - passer INDETECTEE: la verification reste verte. C'est le seul resultat
    qui compte comme un defaut du harnais, et il fait echouer ce script.

La distinction entre les deux premiers existe parce que le piege est reel: un
mutant trop brutal -- supprimer une fonction entiere, casser une chaine -- fait
echouer le harnais avant qu'il n'ait eu l'occasion de rien voir, et un script
qui ne compte que les codes de sortie le range parmi les mutations detectees.
Sur un rapport deja flatteur, c'est exactement la mutation qu'on ne veut pas
lister comme une victoire.

Usage:
    python3 tools/mutations.py            toutes les mutations
    python3 tools/mutations.py compact    seulement celles dont le nom contient
                                          le motif donne
"""

import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# Chaque mutation: (nom, fichier, avant, apres, ce qui doit la voir)
#
# `avant` doit etre present TEL QU'IL EST ECRIT, et la mutation echoue bruyamment
# s'il ne l'est pas. Un motif approximatif qui cesse de correspondre apres une
# reecriture du fichier produirait un mutant qui ne change rien, donc un
# "non detecte"qui ne prouve rien non plus: le verifier vaut mieux que de le
# supposer.
MUTATIONS = [
    # ------------------------------------------------------------------ ui.js
    (
        "mesurerDebordement: le bandeau ne se masque plus avant de mesurer",
        "js/ui.js",
        "  bandeau.hidden = true;\n\n  // Sur un ecran masque",
        "  // Sur un ecran masque",
        "test",
    ),
    (
        "mesurerDebordement: plus de mode compact au defaut de debordement",
        "js/ui.js",
        "  if (!state.compact) {",
        "  if (false) {",
        "test",
    ),
    (
        "mesurerDebordement: la re-mesure decoche le mode qu'elle vient de poser",
        "js/ui.js",
        "    refreshSymbolZone();\n    mesurerDebordement();\n    return;",
        "    refreshSymbolZone();\n    mesurerDebordement();\n"
        "    state.compact = false;\n"
        "    document.documentElement.removeAttribute('data-compact');\n    return;",
        "test",
    ),
    (
        "mesurerDebordement: plus de remesure apres resserrement",
        "js/ui.js",
        "    refreshSymbolZone();\n    mesurerDebordement();\n    return;",
        "    refreshSymbolZone();\n    return;",
        "test",
    ),
    (
        "refreshSymbolZone: la barre survit a la reponse",
        "js/ui.js",
        "  const attendue = !state.answered && expectsFormula(question);",
        "  const attendue = expectsFormula(question);",
        "test",
    ),
    (
        "refreshSymbolZone: la barre ne se replie jamais en mode compact",
        "js/ui.js",
        "  const deployee = attendue && (state.symbolsOpen || !state.compact);",
        "  const deployee = attendue && state.symbolsOpen;",
        "test",
    ),
    (
        "refreshSymbolZone: le choix du joueur est ignore",
        "js/ui.js",
        "  const deployee = attendue && (state.symbolsOpen || !state.compact);",
        "  const deployee = attendue && !state.compact;",
        "test",
    ),
    (
        "renderQuestion: le mode compact survit a la question suivante",
        "js/ui.js",
        "  state.compact = false;\n  document.documentElement.removeAttribute('data-compact');",
        "  // le mode compact survit",
        "test",
    ),
    (
        "startQuiz: le choix du joueur survit a une nouvelle serie",
        "js/ui.js",
        "  state.symbolsOpen = false;\n",
        "",
        "test",
    ),
    (
        "texteDebordement: le bandeau annonce toujours un retour",
        "js/ui.js",
        "  const etat = state.answered ? 'apres reponse' : 'avant reponse';",
        "  const etat = 'apres reponse';",
        "test",
    ),
    (
        "texteDebordement: le remede promet un retour avant qu'il existe",
        "js/ui.js",
        "      ? 'Defilez pour atteindre le champ.'",
        "      ? 'Defilez pour lire le retour.'",
        "test",
    ),
    (
        "bouton des symboles: il ne remesure plus",
        "js/ui.js",
        "se dire.\n  mesurerDebordement();\n});",
        "se dire.\n});",
        "test",
    ),

    # -------------------------------------------------------------- style.css
    (
        "le mode compact se declare par une requete de hauteur",
        "css/style.css",
        "html[data-compact='1'] {",
        "@media (max-height: 460px) {\n  .prompt { color: red; }\n}\n\n"
        "html[data-compact='1'] {",
        "verify",
    ),
    (
        "le mode compact laisse --gap a sa valeur de base",
        "css/style.css",
        "html[data-compact='1'] {\n  --gap: 8px;",
        "html[data-compact='1'] {\n  --gap: 16px;",
        "verify",
    ),
    (
        "le mode compact ne reduit pas la marge de la coque",
        "css/style.css",
        "html[data-compact='1'] {\n  --gap: 8px;\n  --pad: 12px;\n}",
        "html[data-compact='1'] {\n  --gap: 8px;\n}",
        "verify",
    ),
    (
        "le mode compact garde le type de question",
        "css/style.css",
        "html[data-compact='1'] .question-type { display: none; }",
        "html[data-compact='1'] .question-type { display: block; }",
        "verify",
    ),

    # ------------------------------------------------------------- index.html
    (
        "le bouton de repli n'est plus dans le balisage",
        "index.html",
        '<button class="symbol-toggle" id="symbol-toggle" type="button"',
        '<div class="symbol-toggle" id="symbol-toggle" type="button"',
        "verify",
    ),
    (
        "le bouton de repli ne dit plus ce qu'il commande",
        "index.html",
        'aria-expanded="false" aria-controls="symbol-bar" hidden>Symboles',
        'aria-expanded="false" hidden>Symboles',
        "verify",
    ),
    (
        "le bouton de repli redevient un bouton de soumission",
        "index.html",
        '<button class="symbol-toggle" id="symbol-toggle" type="button"',
        '<button class="symbol-toggle" id="symbol-toggle" type="submit"',
        "verify",
    ),

    # -------------------------------------------------------------- dom-stub
    # Ces deux-la ne cassent aucun code de production. Elles cassent le
    # HARN AIS, et leur but est de prouver que les assertions qui les
    # concernaient dependaient reellement de ce lien de parentage. Une
    # assertion verte sur un harnais qui ne voit pas la page verifie un
    # fantome: c'est deja arrive deux fois dans ce depot.
    (
        "harnais: le bouton des symboles n'est plus dans le formulaire",
        "tools/tests/dom-stub.js",
        "  if (symbolToggle) symbolToggle._parent = form || null;",
        "",
        "test",
    ),
    (
        "harnais: le formulaire n'est plus dans l'ecran de quiz",
        "tools/tests/dom-stub.js",
        "  if (form) form._parent = quizScreen || null;",
        "",
        "test",
    ),
]

COMMANDE = {"test": ["make", "test"], "verify": ["make", "verify"]}


def lancer(etape):
    """Lance une etape de verification. (code, sortie) -- rien d'autre.

    Le code ne suffit pas: `make` renvoie 2 pour une assertion en echec comme
    pour une erreur de syntaxe, et les deux ne se lisent pas de la meme facon.
    """
    terminee = subprocess.run(
        COMMANDE[etape],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return terminee.returncode, terminee.stdout.decode("utf-8", "replace")


# Signatures de panne du harnais. Elles disent que la mutation a casse
# l'outillage, pas qu'elle a ete vue. Un mutant trop brutal tombe ici.
PANNES = (
    "SyntaxError",
    "ReferenceError",
    "TypeError",
    "Exception:",
    "AssertionError",
    "Traceback (most recent call last)",
    "error:",
    "not a valid",
)


def classer(etape, code, sortie):
    """Trois issues, et non deux. (verdict, detail).

    Le discriminant est la LIGNE DE RESUME, pas une recherche de mots
    d'exception. C'est la premiere version qui cherchait "Exception:", et elle
    classait "harnais casse" les mutations que les tests voyaient parfaitement
    bien: `run-tests.py` leve volontairement une exception a la fin quand une
    assertion echoue, donc ce mot apparait exactement dans les cas qu'il fallait
    declarer reussis. Le rapport disait 11 mutations cassees la ou il y en
    avait 0.

    La ligne "N assertions reussies, M en echec" est produite par l'epilogue du
    fichier de test, donc elle n'apparait QUE si le harnais a va jusqu'au bout.
    Son absence avec un code non nul dit que le mutant a casse l'outillage
    avant qu'aucune assertion n'ait pu s'exprimer -- et cela ne prouve rien
    sur la couverture.
    """
    if code == 0:
        return "INDETECTEE", ""

    resume = re.search(r"(\d+) assertions reussies, (\d+) en echec", sortie)
    if resume:
        echecs = int(resume.group(2))
        if echecs:
            return "DETECTEE", "%d assertion(s) en echec" % echecs
        # Resume vert et code non nul: le harnais a abouti sans rien signaler,
        # et autre chose a echoue. C'est encore une panne, pas une detection.
        return "HARNAIS CASSE", premiere_panne(sortie)

    if etape == "verify" and re.search(r"^ECHEC ", sortie, re.M):
        return "DETECTEE", premiere_echec(sortie)

    return "HARNAIS CASSE", premiere_panne(sortie)


def premiere_panne(sortie):
    for ligne in sortie.splitlines():
        if any(panne in ligne for panne in PANNES):
            return ligne.strip()[:100]
    return ""


def premiere_echec(sortie):
    for ligne in sortie.splitlines():
        marque = ligne.strip()
        if marque.startswith(("ECHEC", "echec")):
            return marque[:100]
    return ""


def appliquer(fichier, avant, apres):
    chemin = os.path.join(ROOT, fichier)
    with open(chemin, encoding="utf-8") as handle:
        source = handle.read()
    if source.count(avant) != 1:
        return None
    with open(chemin, "w", encoding="utf-8") as handle:
        handle.write(source.replace(avant, apres))
    return source


def restaurer(fichier, source):
    with open(os.path.join(ROOT, fichier), "w", encoding="utf-8") as handle:
        handle.write(source)


def main():
    filtres = [arg for arg in sys.argv[1:] if not arg.startswith("-")]
    mutations = [m for m in MUTATIONS
                 if not filtres or any(f in m[0] for f in filtres)]

    if not mutations:
        print("aucune mutation ne correspond a %s" % " ".join(filtres))
        return 1

    # Reference: la suite doit etre verte AVANT toute mutation. Sans cela, un
    # etat deja rouge ferait passer toutes les mutations pour detectees.
    code, sortie = lancer("test")
    if code != 0:
        print("la suite n'est pas verte au depart. Mutations impossibles.")
        print(sortie[-2000:])
        return 1
    code, sortie = lancer("verify")
    if code != 0:
        print("les controles statiques ne sont pas verts au depart.")
        print(sortie[-2000:])
        return 1

    print("%d mutations" % len(mutations))
    print("")

    compte = {"DETECTEE": 0, "INDETECTEE": 0, "HARNAIS CASSE": 0}
    defaillants = []

    for nom, fichier, avant, apres, etape in mutations:
        source = appliquer(fichier, avant, apres)
        if source is None:
            compte["HARNAIS CASSE"] += 1
            defaillants.append((nom, "MOTIF INTROUVABLE -- la mutation ne change rien"))
            print("  harnais casse    %s" % nom)
            print("                    motif introuvable ou ambigu dans %s" % fichier)
            continue

        try:
            code, sortie = lancer(etape)
        finally:
            restaurer(fichier, source)

        verdict, detail = classer(etape, code, sortie)
        compte[verdict] += 1
        marque = {"DETECTEE": "  detecte       ",
                  "INDETECTEE": "  INDETECTEE    ",
                  "HARNAIS CASSE": "  harnais casse"}[verdict]
        print("%s %s" % (marque, nom))
        if verdict != "DETECTEE" and detail:
            print("                    %s" % detail)
        elif verdict == "DETECTEE" and detail:
            print("                    %s" % detail)

    print("")
    print("detectees    : %d" % compte["DETECTEE"])
    print("indetectees  : %d" % compte["INDETECTEE"])
    print(" harnais casse: %d" % compte["HARNAIS CASSE"])

    if compte["INDETECTEE"] or compte["HARNAIS CASSE"]:
        print("")
        print("%d mutation(s) n'ont pas ete vues par ce qu'elles "
              "devraient voir" % (compte["INDETECTEE"] + compte["HARNAIS CASSE"]))
        for nom, detail in defaillants:
            print("  %s: %s" % (nom, detail))
        return 1

    print("\nok: chaque mutation a ete vue par ce qui devait la voir")
    return 0


if __name__ == "__main__":
    sys.exit(main())
