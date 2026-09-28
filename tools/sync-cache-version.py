#!/usr/bin/env python3
"""Derive CACHE_VERSION de l'empreinte des fichiers precaches.

Le service worker sert le cache en priorite, sans revalidation reseau. Un
fichier modifie sans que le nom du cache change reste donc servi indefiniment
sur l'appareil de l'utilisateur, et le correctif n'atteint jamais personne.
C'est un bug silencieux et durable: il s'est deja produit dans ce depot, ou un
correctif d'affichage etait livre sans que la version du cache soit incrementee.

Plutot que de demander a un humain de s'en souvenir, on derive la version du
contenu. Changer un fichier change son empreinte, donc change le nom du cache,
ce qui purge l'ancien au moment de l'activation. Le cache ne peut plus etre
perime.

  sync-cache-version.py            ecrit la version calculee dans sw.js
  sync-cache-version.py --check    echoue si sw.js n'est pas a jour (mode CI)
"""

import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW = os.path.join(ROOT, "sw.js")
HTML = os.path.join(ROOT, "index.html")

PRECACHE = re.compile(r"^\s*'([^']+)',\s*$", re.MULTILINE)
VERSION = re.compile(r"^const CACHE_VERSION = '([^']*)';$", re.MULTILINE)
META = re.compile(r'<meta name="app-version" content="([^"]*)">')


def precached_files():
    with open(SW, encoding="utf-8") as handle:
        source = handle.read()
    start = source.index("const PRECACHE = [")
    end = source.index("];", start)
    entries = PRECACHE.findall(source[start:end])

    files = []
    for entry in entries:
        # './' est la racine du site: son contenu est index.html.
        path = os.path.join(ROOT, "index.html" if entry in ("./", ".") else entry)
        if not os.path.exists(path):
            sys.exit("fichier precache absent: %s" % entry)
        files.append((entry, path))
    return files


def fingerprint():
    """Empreinte stable: insensible a l'ordre du precache, sensible au contenu.

    Trier par chemin evite qu'un simple reordonnancement de la liste invalide
    tous les caches installs, sans rien cacher du contenu reellement servi.
    """
    digest = hashlib.sha256()
    for entry, path in sorted(precached_files()):
        digest.update(entry.encode("utf-8"))
        digest.update(b"\0")
        with open(path, "rb") as handle:
            contenu = handle.read()
        if os.path.abspath(path) == os.path.abspath(HTML):
            contenu = sans_version_affichee(contenu)
        digest.update(hashlib.sha256(contenu).hexdigest().encode())
        digest.update(b"\0")
    return digest.hexdigest()[:8]


def sans_version_affichee(contenu):
    """Le numero affiche, normalise avant d'etre hache.

    L'empreinte est calculee sur les fichiers precaches, dont index.html, qui
    porte ce numero. Le hacher tel quel rend le calcul autoreferentiel: ecrire
    une version change le fichier, donc change l'empreinte, donc la version
    suivante differe encore. `make cache-version` ne convergeait pas -- chaque
    passage produisait une nouvelle version, et `make` echouait toujours.

    Le numero affiche est une consequence de l'empreinte, pas une entree:
    il doit donc etre retire avant de hacher. Ce qui reste hacher, c'est le
    contenu reellement servi au navigateur.
    """
    neutralise = '<meta name="app-version" content="">'
    return META.sub(neutralise, contenu.decode("utf-8")).encode("utf-8")


def current_version():
    with open(SW, encoding="utf-8") as handle:
        found = VERSION.search(handle.read())
    if not found:
        sys.exit("const CACHE_VERSION introuvable dans sw.js")
    return found.group(1)


def html_version():
    with open(HTML, encoding="utf-8") as handle:
        found = META.search(handle.read())
    if not found:
        sys.exit('meta name="app-version" introuvable dans index.html')
    return found.group(1)


def write_version(version):
    """Ecrit la version dans sw.js ET dans index.html.

    Les deux doivent venir de la meme empreinte. Sans le second, l'appareil
    affiche une version qui n'est pas celle qu'il sert, ce qui rend le
    marqueur lui-meme incapable de depanner quoi que ce soit.
    """
    changed = False

    with open(SW, encoding="utf-8") as handle:
        source = handle.read()
    updated = VERSION.sub("const CACHE_VERSION = '%s';" % version, source, count=1)
    if updated != source:
        with open(SW, "w", encoding="utf-8") as handle:
            handle.write(updated)
        changed = True

    with open(HTML, encoding="utf-8") as handle:
        source = handle.read()
    updated = META.sub('<meta name="app-version" content="%s">' % version, source,
                       count=1)
    if updated != source:
        with open(HTML, "w", encoding="utf-8") as handle:
            handle.write(updated)
        changed = True

    return changed


def main(argv):
    wanted = fingerprint()
    present = current_version()
    affichee = html_version()

    if "--check" in argv:
        if present != wanted:
            print("ECHEC la version du cache est perimee.")
            print("  sw.js annonce   %s" % present)
            print("  contenu reel    %s" % wanted)
            print("  -> lancer: make cache-version")
            return 1
        if affichee != wanted:
            print("ECHEC le numero affiche ne correspond pas au cache.")
            print("  index.html affiche %s" % affichee)
            print("  sw.js sert       %s" % wanted)
            print("  -> lancer: make cache-version")
            return 1
        print("ok   version du cache a jour: %s" % wanted)
        return 0

    if present == wanted:
        print("version du cache deja a jour: %s" % wanted)
        return 0

    write_version(wanted)
    print("CACHE_VERSION %s -> %s (%d fichiers precaches)"
          % (present, wanted, len(precached_files())))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
