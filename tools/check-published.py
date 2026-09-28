#!/usr/bin/env python3
"""Le site publie est-il a jour, et a quel moment l'appareil l'aura-t-il ?

Un `git push` ne veut rien dire pour l'utilisateur. Trois delais s'y
interposent, et ils sont independants:

  1. GitHub Pages republie le site. Une a deux minutes, parfois plus.
  2. Le navigateur du telephone decouvre la nouvelle version du service
     worker au lancement suivant.
  3. Le service worker installe le nouveau precache, puis le sert au
     LANCEMENT SUIVANT encore.

Sans outil, ces trois etats se confondent en un seul symptome -- "rien n'a
change" -- et le depannage part alors sur la mauvaise piste. C'est
exactement ce qui s'est produit: un appareil encore sur l'ancien code et un
correctif inefficace produisent la meme ecran.

  check-published.py            compare le local au publie
  check-published.py --watch    repete jusqu'a ce que le publie suive

Seul `python3` et `urllib` sont requis, comme partout ailleurs dans ce
depot. Cet outil n'est volontairement PAS dans `make check`: il demande le
reseau, et une verification de code ne doit pas dependre du reseau.
"""

import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW = os.path.join(ROOT, "sw.js")
HTML = os.path.join(ROOT, "index.html")

# Le depot est publie sous un prefixe de projet, d'ou le sous-chemin. Les
# chemins internes du site sont relatifs, donc rien d'autre n'a besoin d'etre
# configure ici.
BASE = "https://atravert.github.io/mendel-web/"

VERSION_SW = re.compile(r"^const CACHE_VERSION = '([^']*)';$", re.M)
VERSION_HTML = re.compile(r'<meta name="app-version" content="([^"]*)">')

DELAI = 30  # secondes entre deux tentatives en mode --watch


def lire_local(chemin, motif):
    with open(chemin, encoding="utf-8") as handle:
        trouve = motif.search(handle.read())
    return trouve.group(1) if trouve else None


def lire_publie(chemin):
    """Le fichier publie, en contournant le cache du CDN.

    Le `?` est indispensable: sans lui on risque de relire la reponse mise en
    cache, et de conclure que le site est a jour alors qu'il ne l'est pas --
    l'echec de verification le plus facile a obtenir, et le plus couteux.
    """
    url = "%s%s?verif=%d" % (BASE, chemin, time.time())
    requete = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(requete, timeout=20) as reponse:
        return reponse.read().decode("utf-8")


def version_publiee():
    sw = VERSION_SW.search(lire_publie("sw.js"))
    html = VERSION_HTML.search(lire_publie("index.html"))
    return (sw.group(1) if sw else None, html.group(1) if html else None)


def comparer():
    local = lire_local(SW, VERSION_SW)
    affichee = lire_local(HTML, VERSION_HTML)

    if local is None or affichee is None:
        print("ECHEC version introuvable dans les fichiers locaux.")
        return None

    if local != affichee:
        print("ECHEC le local est incoherent avant meme de publier.")
        print("  sw.js sert        %s" % local)
        print("  index.html affiche %s" % affichee)
        print("  -> lancer: make cache-version")
        return None

    try:
        sw_en_ligne, html_en_ligne = version_publiee()
    except (urllib.error.URLError, OSError) as erreur:
        print("ECHEC site injoignable: %s" % erreur)
        print("  (le reseau est peut-etre indisponible, ce n'est pas un probleme de code)")
        return None

    if sw_en_ligne is None or html_en_ligne is None:
        print("ECHEC version introuvable sur le site publie.")
        return None

    if sw_en_ligne != html_en_ligne:
        # Les deux fichiers ayant ete publies dans deux deploiements
        # differents, pendant la republication. C'est transitoire.
        print("EN ATTENTE  le site est en cours de republication.")
        print("  sw.js en ligne        %s" % sw_en_ligne)
        print("  numero affiche en ligne %s" % html_en_ligne)
        return None

    if sw_en_ligne != local:
        print("EN ATTENTE  le site sert encore une version anterieure.")
        print("  local   %s" % local)
        print("  en ligne %s" % sw_en_ligne)
        return None

    return local


def main(argv):
    if "--watch" in argv:
        while True:
            version = comparer()
            if version:
                print("EN LIGNE  %s" % version, flush=True)
                print("")
                print("Le site est a jour. Sur le telephone, il faut ENCORE")
                print("deux lancements: le premier sert l'ancien cache et")
                print("installe le nouveau, le second l'execute. Le numero")
                print("affiche en bas de l'ecran d'accueil le confirme.",
                      flush=True)
                return 0
            # `flush` explicite: sans lui, python bufferise la sortie quand elle
            # n'est pas un terminal, et `make wait` redirige vers un fichier
            # parait fige pendant toute la republication.
            print("   -- nouvelle tentative dans %d s" % DELAI, flush=True)
            time.sleep(DELAI)

    version = comparer()
    if not version:
        return 1
    print("EN LIGNE  %s -- le site sert bien la version locale" % version)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
