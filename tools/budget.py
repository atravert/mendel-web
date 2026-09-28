#!/usr/bin/env python3
"""Calcule le budget vertical de l'ecran de quiz, et le confronte au chiffre
ecrit dans css/style.css.

Pourquoi cet outil existe
-------------------------

Le defaut qui a produit tout ce travail etait un chiffre ecrit a la main. Le
CSS annoncait 469 px de contenu pour 508 px disponibles, en deduisait que
tout tenait, et un iPhone a refuse le calcul: le commentaire et le bouton
Suivant ont disparu de l'ecran. Ce n'etait pas une faute de raisonnement, c'etait
un nombre recopie qui n'avait jamais ete verifie contre la feuille dont il
pretendait decrire les hauteurs.

Corriger l'ecart ne suffit pas: un tableau ecrit dans un commentaire n'a
aucune raison de rester vrai. Quelqu'un reglera `--gap` un jour, et le
tableauAttendra, muet, en racontant une hauteur qui n'existe plus.

Alors il est calcule. Cet outil lit les hauteurs DANS css/style.css, les
compose comme le navigateur compose les enfants de `.screen` -- un `gap` entre
chaque element rendu, pas entre chaque element du balisage -- et compare le
resultat au bloc marque dans le commentaire de la feuille. S'ils divergent,
il echoue. Le commentaire ne peut plus mentir sans que `make check` le
dise.

Ce qui est mesure et ce qui est fourni
--------------------------------------

Deux choses ne se deduisent pas du CSS, et les deux sont DONNEES en parametre,
jamais inventees ici:

  - la largeur de l'ecran, parce que la taille de l'enonce est un `clamp(…,
    11vw, 44px)`. 402 px est la largeur d'un iPhone 15, et elle a un sens:
    c'est celle-la qui donne 44 px;
  - la place reellement visible, 210 px, mesuree par l'appareil sur la serie
    ions avec le clavier ouvert dans un onglet Safari. C'est la seule mesure
    qui existe, et c'est la seule qui compte.

Tout le reste -- 22, 1, 20, 53, 48, 116, 64 -- se lit dans la feuille. Si la
feuille change, ces nombres-la changent avec elle, et c'est le but.

Usage:
    python3 tools/budget.py              verifie le bloc marque
    python3 tools/budget.py --largeur 375 --visible 260
    python3 tools/budget.py --table      affiche le detail, sans verifier
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Le bloc que l'outil compare au calcul. Il doit se trouver tel quel dans le
# commentaire de css/style.css, entre ces deux marqueurs.
DEBUT = "   BUDGET-CALCULE"
FIN = "   FIN-BUDGET"

# Etats calcules, dans l'ordre ou ils apparaissent dans le commentaire. Le nom
# de chaque etat apparait tel quel dans la sortie: la sortie doit se lire sans
# le code, parce que c'est elle qu'on regarde en premier quand un telephone
# refuse l'ecran.
ETATS = [
    ("avant reponse",            "avant"),
    ("apres reponse",            "apres"),
    ("avant reponse, resserre",  "avant-compact"),
    ("apres reponse, resserre",  "apres-compact"),
    ("barre deployee en resserre", "barre"),
]


class Budget(object):
    """Les hauteurs, lues dans la feuille.

    Chaque nombre a une source nommee. Un nombre sans source serait exactement
    le defaut que cet outil combat, reintroduit plus bas.
    """

    def __init__(self, regles, largeur):
        self.regles = regles
        self.largeur = largeur
        self.variables = self._variables()

    def _declaration(self, selecteur, nom):
        corps = self.regles.get(selecteur, "")
        trouve = re.search(r"(?<![\w-])%s:\s*([^;]+)" % re.escape(nom), corps)
        return trouve.group(1).strip() if trouve else None

    def _px(self, valeur, variables, defaut=None):
        """Resout une longueur en pixels, y compris `var(--x)`."""
        if valeur is None:
            return defaut
        while "var(" in valeur:
            trouve = re.search(r"var\((--[\w-]+)\)", valeur)
            if not trouve:
                return defaut
            # `variables` porte des nombres, `valeur` est du texte: la
            # substitution repasse donc par une chaine. Un `.replace` direct
            # echouerait sur un float, et l'outil planterait au lieu de
            # signaler une hauteur illisible.
            resolu = variables.get(trouve.group(1))
            valeur = valeur.replace(trouve.group(0),
                                    "%.4gpx" % resolu if resolu is not None else "0px")
        trouve = re.match(r"^(\d+(?:\.\d+)?)px$", valeur.strip())
        return float(trouve.group(1)) if trouve else defaut

    def _variables(self, compact=False):
        base = {}
        for nom in ("--gap", "--pad", "--tap", "--progress-h"):
            base[nom] = self._px(self._declaration(":root", nom), base)
        if compact:
            for nom in ("--gap", "--pad"):
                base[nom] = self._px(
                    self._declaration("html[data-compact='1']", nom), base)
        return base

    # --- Hauteur d'un element du flux ---------------------------------------

    def _interligne(self, selecteur, defaut):
        valeur = self._declaration(selecteur, "line-height")
        if valeur is None:
            return defaut
        try:
            return float(valeur)
        except ValueError:
            return defaut

    def _police(self, selecteur):
        valeur = self._declaration(selecteur, "font-size")
        trouve = re.search(r"(\d+(?:\.\d+)?)px", valeur or "")
        return float(trouve.group(1)) if trouve else 16.0

    def progression(self, variables):
        return self._px(self._declaration(".progress-row", "min-height"), variables)

    def filet(self):
        return self._px(self._declaration(".rule", "height"), {})

    def type_question(self, variables):
        """Une ligne de texte a l'interligne du `body`.

        `.question-type` ne declare pas son propre `line-height`: il herite de
        celui du `body`. L'oublier donnerait 20 px au lieu de 20,3 -- un ecart
        trop petit pour se voir, et assez pour que le total ne soit pas celui
        du navigateur.
        """
        return round(self._police(".question-type")
                     * self._interligne(".question-type",
                                       self._interligne("body", 1.0)))

    def enonce(self, variables, lignes=1):
        """La taille du `clamp(30px, 11vw, 44px)`, a la largeur donnee."""
        valeur = self._declaration(".prompt", "font-size") or ""
        borne = re.search(r"clamp\([^,]+,\s*([\d.]+)vw\s*,\s*(\d+)px\s*\)", valeur)
        if not borne:
            return 0.0
        milieu = self.largeur * float(borne.group(1)) / 100.0
        taille = min(max(30.0, milieu), float(borne.group(2)))
        return round(taille * self._interligne(".prompt", 1.0)) * lignes

    def champ(self, variables):
        return self._px(self._declaration(".answer-input", "min-height"), variables)

    def barre(self, variables):
        """Les deux rangees, la marge et l'intervalle qui les separe."""
        variables = dict(variables)
        variables.setdefault("--gap", 0.0)
        return (self._px(self._declaration(".symbol-bar", "margin-top"), variables)
                + 2 * self._px(self._declaration(".symbol-toggle", "min-height"), variables)
                + self._px(self._declaration(".symbol-bar", "gap"), variables))

    def repli(self, variables):
        """Le bouton qui deroule la barre: une cible tactile et sa marge."""
        return (self._px(self._declaration(".symbol-toggle", "margin-top"), variables)
                + self._px(self._declaration(".symbol-toggle", "min-height"), variables))

    def retour(self, variables, lignes):
        """Le commentaire, au pire cas reel: la plus longue ligne de COMMENTS."""
        return round(self._police(".feedback")
                     * self._interligne(".feedback",
                                       self._interligne("body", 1.0))) * lignes


def pire_commentaire(largeur_utile, police=19.0, ratio=0.5):
    """Le nombre de LIGNES du plus long commentaire, d'apres js/data.js.

    Pas une estimation "trois lignes", choisie parce que c'est ce que
    l'ecran montrait. La hauteur du pire cas se deduit du texte le plus long
    des 79 commentaires, plie a la largeur reellement utile.

    Le seul parametre invente est `ratio`: la largeur moyenne d'un caractere,
    exprimee en em. 0,5 est une approximation honnete, pas une mesure -- et
    elle est exposee en parametre pour qu'on puisse la corriger contre un
    appareil reel plutot que de la changer en douce. Une largeur de caractere
    qui varie avec la lettre rendrait tout calcul de retour approximatif, et
    c'est pour cela que l'enonce ne depend pas de ce nombre: tous les enonces
    tiennent sur une ligne.
    """
    data = open(os.path.join(ROOT, "js", "data.js"), encoding="utf-8").read()
    if "COMMENTS" not in data:
        return 1
    corps = data.split("COMMENTS", 1)[1]
    commentaires = re.findall(r"'((?:[^'\\\n]|\\.)*)'", corps)
    if not commentaires:
        return 1
    plus_long = max(commentaires, key=len)
    largeur_texte = len(plus_long) * police * ratio
    return max(1, int(largeur_texte / largeur_utile) + 1)


def composer(budget, variables, items):
    """Somme les hauteurs, et les intervalles ENTRE LES ELEMENTS RENDUS.

    Pas entre les elements du balisage: un element masque -- `.question-type`
    apres la reponse, la barre repliee -- sort du flux, et son intervalle avec.
    C'est la difference entre 324 et 357, et c'est exactement le genre de
    detail qui a produit le premier chiffre faux.
    """
    visibles = [hauteur for hauteur in items if hauteur]
    intervalles = max(0, len(visibles) - 1) * variables["--gap"]
    return round(sum(visibles) + intervalles), len(visibles)


def etats(budget, largeur, visible):
    variables = {False: budget._variables(False), True: budget._variables(True)}
    detail = []

    # La place visible n'est pas la meme dans les deux modes, et c'est un piege
    # qui avait echappe au calcul a la main: les 210 px ont ete MESURES avec
    # `--pad: 20px`, donc avec 40 px de marge de coque. En mode compact il n'y
    # en a plus que 24: la meme zone visible en rend 16 de plus a l'ecran.
    #
    # Comparer le contenu compact aux 210 px d'origine donnerait un defait de
    # 2 px la ou il n'y en a pas -- et un defait de 2 px est le genre de chiffre
    # qui envoie chercher un arrondi inexistant pendant une heure.
    visibles = {False: visible,
                True: visible + 2 * (variables[False]["--pad"] - variables[True]["--pad"])}

    for compact in (False, True):
        v = variables[compact]
        # En mode compact, `.question-type` est masque, donc il sort du flux --
        # et son intervalle avec. La cacher sans ca ferait perdre 20 px et un
        # intervalle de 8.
        type_question = 0 if compact else budget.type_question(v)
        repli = compact          # le bouton de repli n'existe qu'en mode compact
        barre = 0 if compact else budget.barre(v)

        # La largeur utile, elle, change avec `--pad`: c'est une des raisons
        # pour lesquelles le mode compact rend aussi des px de commentaire.
        utile = largeur - 2 * v["--pad"]
        lignes = pire_commentaire(utile)

        avant, n_avant = composer(budget, v, [
            budget.progression(v), budget.filet(), type_question,
            budget.enonce(v), budget.champ(v) + barre + (budget.repli(v) if repli else 0),
        ])
        apres, n_apres = composer(budget, v, [
            budget.progression(v), budget.filet(),
            budget.retour(v, lignes), budget.champ(v),
        ])
        nom = "compact" if compact else "normal"
        detail.append(("%s / avant reponse" % nom, avant, n_avant, visibles[compact]))
        detail.append(("%s / apres reponse" % nom, apres, n_apres, visibles[compact]))

    # La barre redeployee, qui est le seul cas ou le joueur perd de la place
    # volontairement: c'est le seul budget que le code laisse deborder en
    # connaissance de cause.
    v = variables[True]
    barre_ouverte, n_ouverte = composer(budget, v, [
        budget.progression(v), budget.filet(), budget.enonce(v),
        budget.champ(v) + budget.barre(v),
    ])
    detail.append(("compact / barre deployee", barre_ouverte, n_ouverte, visibles[True]))
    return detail


def main():
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("--largeur", type=int, default=402,
                           help="largeur de l'ecran en px (defaut: 402, iPhone 15)")
    analyseur.add_argument("--visible", type=int, default=210,
                           help="hauteur visible mesuree, sans le bandeau "
                                "(defaut: 210, mesure par l'appareil)")
    analyseur.add_argument("--table", action="store_true",
                           help="affiche le detail sans rien verifier")
    arguments = analyseur.parse_args()

    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "verify", os.path.join(ROOT, "tools", "verify.py"))
    verify = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verify)

    css = verify.strip_comments(verify.read("css/style.css"))
    regles = verify.parse_rules(css)
    budget = Budget(regles, arguments.largeur)
    detail = etats(budget, arguments.largeur, arguments.visible)

    if arguments.table:
        print("largeur %d px, place visible %d px (mesuree)" % (
            arguments.largeur, arguments.visible))
        print("")
        for nom, total, n, place in detail:
            manque = total - place
            print("  %-30s %4d px  (%d elements)  pour %4d px  %s" % (
                nom, total, n, place,
                ("manque %d px" % manque) if manque > 1 else "tient (%+d)" % -manque))
        return 0

    # Le bloc marque doit se trouver TEL QUEL dans le commentaire de la
    # feuille. Il est lu dans le CSS BRUT: `strip_comments` vient justement de
    # retirer les commentaires, et le tableau est dedans.
    brut = open(os.path.join(ROOT, "css", "style.css"), encoding="utf-8").read()
    if DEBUT not in brut or FIN not in brut:
        print("css/style.css: le bloc Budget calcule est absent.")
        print("  attendu entre %r et %r, dans le commentaire du budget vertical."
              % (DEBUT, FIN))
        return 1

    bloc = brut.split(DEBUT, 1)[1].split(FIN, 1)[0]
    annonce = {}
    for nom, total, n, _ in detail:
        # L'indentation compte: le tableau est un commentaire, donc aligne dans
        # la feuille. Sans `\s*` apres `^`, la premiere ligne ne correspondait
        # jamais et l'outil refusait un tableau parfaitement correct -- un
        # contrôle qui echoue pour une raison qui n'a rien a voir avec ce qu'il
        # contrôle apprend a etre ignore.
        trouve = re.search(r"^[ \t]*%s\s+(\d+)\s+(\d+)\s*$" % re.escape(nom),
                           bloc, re.M)
        if not trouve:
            print("css/style.css: le bloc Budget calcule ne donne pas %r." % nom)
            return 1
        annonce[nom] = (int(trouve.group(1)), int(trouve.group(2)))

    erreurs = []
    for nom, total, n, _ in detail:
        dit_total, dit_n = annonce[nom]
        if dit_total != total:
            erreurs.append("  %-30s ecrit %d px, calcule %d px" % (
                nom, dit_total, total))
        if dit_n != n:
            erreurs.append("  %-30s ecrit %d elements rendus, calcule %d" % (
                nom, dit_n, n))

    if erreurs:
        print("ECHEC le budget ecrit dans css/style.css ne correspond plus au CSS.")
        print("")
        for ligne in erreurs:
            print(ligne)
        print("")
        print("  Ces chiffres sont ecrits a la main, et c'est precisement ce qui")
        print("  avait produit le premier defaut de place: un nombre recopie qui")
        print("  n'avait jamais ete verifie. Le tableau se corrige -- ou mieux, on")
        print("  ne le recopie pas et on laisse `make budget` l'ecrire.")
        return 1

    print("budget vertical : %d etats conformes au CSS" % len(detail))
    return 0


if __name__ == "__main__":
    sys.exit(main())
