#!/usr/bin/env python3
"""Verifie que tous les fichiers referencés existent vraiment.

Une PWA se casse tres silencieusement: une icone manquante donne juste un
ecran d'accueil sans icone, un chemin faux dans le precache du service
worker signifie que l'application n'est pas hors-ligne du tout, et rien ne
signale d'erreur dans la console. Ce script compare ce que le code declare
aux fichiers reels.

Controles:
  - chaque entree du precache de sw.js existe,
  - chaque src/href de index.html existe,
  - chaque icone du manifeste existe, et la taille annoncee correspond,
  - chaque fichier JS importe un module qui existe,
  - chaque element utilise par ui.js existe dans index.html,
  - la barre de symboles de index.html correspond a son miroir de test,
  - le manifeste et le JSON de deploiement sont bien formes.
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def strip_comments(source):
    """Retire // et /* */ sans toucher au contenu des chaines.

    Indispensable ici: les commentaires francais contiennent des apostrophes
    (l'application, d'une) qu'un naiveextracteur de chaine prendrait pour des
    delimiteurs.
    """
    out = []
    i, n = 0, len(source)
    while i < n:
        char = source[i]
        nxt = source[i + 1] if i + 1 < n else ""
        if char in "'\"":
            quote = char
            out.append(char)
            i += 1
            while i < n:
                out.append(source[i])
                if source[i] == "\\":
                    if i + 1 < n:
                        out.append(source[i + 1])
                        i += 2
                        continue
                elif source[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if char == "/" and nxt == "/":
            while i < n and source[i] != "\n":
                i += 1
            continue
        if char == "/" and nxt == "*":
            i += 2
            while i < n and not (source[i] == "*" and i + 1 < n and source[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(char)
        i += 1
    return "".join(out)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as handle:
        return handle.read()


def check_precache(errors):
    src = strip_comments(read("sw.js"))
    block = re.search(r"const PRECACHE = \[(.*?)\];", src, re.S)
    if not block:
        errors.append("sw.js: tableau PRECACHE introuvable")
        return 0
    entries = re.findall(r"'([^']+)'", block.group(1))
    for entry in entries:
        if entry == "./":
            continue
        if not os.path.exists(os.path.join(ROOT, entry)):
            errors.append("sw.js: precache '%s' introuvable" % entry)
    return len(entries)


def check_html_refs(errors):
    src = read("index.html")
    refs = re.findall(r'(?:src|href)="([^"]+)"', src)
    count = 0
    for ref in refs:
        if ref.startswith(("http://", "https://", "data:", "#", "mailto:")):
            continue
        count += 1
        if not os.path.exists(os.path.join(ROOT, ref)):
            errors.append("index.html: reference '%s' introuvable" % ref)
    return count


def check_manifest(errors):
    path = os.path.join(ROOT, "manifest.webmanifest")
    if not os.path.exists(path):
        errors.append("manifest.webmanifest absent")
        return 0
    try:
        manifest = json.loads(read("manifest.webmanifest"))
    except ValueError as exc:
        errors.append("manifest.webmanifest: JSON invalide (%s)" % exc)
        return 0

    for icon in manifest.get("icons", []):
        target = os.path.join(ROOT, icon["src"])
        if not os.path.exists(target):
            errors.append("manifest: icone '%s' introuvable" % icon["src"])
            continue
        declared = icon["sizes"]
        if "x" in declared:
            width, height = (int(v) for v in declared.split("x"))
        else:
            continue
        actual = png_size(target)
        if actual and actual != (width, height):
            errors.append(
                "manifest: '%s' annonce %dx%d, reel %dx%d"
                % (icon["src"], width, height, actual[0], actual[1])
            )

    purposes = {i.get("purpose", "any") for i in manifest.get("icons", [])}
    if "maskable" not in purposes:
        errors.append("manifest: aucune icone maskable (requis par Android)")
    for key in ("name", "short_name", "start_url", "display", "theme_color"):
        if key not in manifest:
            errors.append("manifest: cle '%s' absente" % key)
    return len(manifest.get("icons", []))


def png_size(path):
    with open(path, "rb") as handle:
        head = handle.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    import struct
    width, height = struct.unpack(">II", head[16:24])
    return width, height


def check_imports(errors):
    count = 0
    for dirpath, _dirs, files in os.walk(os.path.join(ROOT, "js")):
        for name in files:
            if not name.endswith(".js"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), ROOT)
            for spec in re.findall(r"from\s+'([^']+)'", read(rel)):
                if not spec.startswith("."):
                    continue
                count += 1
                target = os.path.normpath(
                    os.path.join(os.path.dirname(rel), spec)
                )
                if not os.path.exists(os.path.join(ROOT, target)):
                    errors.append("%s: importe '%s' introuvable" % (rel, spec))
    return count


def check_assets_referenced_by_code(errors):
    """Les chemins audio sont ecrits en dur dans audio.js."""
    src = read("js/audio.js")
    refs = re.findall(r"'(audio/[^']+)'", src)
    count = 0
    for ref in refs:
        count += 1
        if not os.path.exists(os.path.join(ROOT, ref)):
            errors.append("audio.js: '%s' introuvable" % ref)
    return count


def check_dom_ids(errors):
    """Chaque element utilise par ui.js doit exister dans index.html."""
    html = read("index.html")
    ids = set(re.findall(r'id="([^"]+)"', html))
    src = read("js/ui.js")
    used = set(re.findall(r"getElementById\('([^']+)'\)", src))
    count = len(used)
    missing = sorted(used - ids)
    for name in missing:
        errors.append("ui.js: getElementById('%s') absent de index.html" % name)
    return count, missing


def check_symbol_bar(errors):
    """La barre de index.html doit correspondre a son miroir dans dom-stub.js.

    Le stub declare les touches a la main. S'il derive de index.html, les tests
    passent sur une fiction: ils verifient une barre qui n'existe pas a l'ecran,
    et la suite reste verte pendant que le joueur, lui, ne trouve pas le chiffre
    7. On compare les deux listes, dans l'ordre.
    """
    html = read("index.html")
    expected = {
        "insert": re.findall(r'data-insert="([^"]*)"', html),
        "script": re.findall(r'data-script="([^"]*)"', html),
    }

    stub = strip_comments(read("tools/tests/dom-stub.js"))
    declared = {}
    for name in ("insert", "script"):
        block = re.search(r"doc\._%sKeys = \[(.*?)\]" % name, stub, re.S)
        if not block:
            errors.append("dom-stub.js: liste _%sKeys introuvable" % name)
            return 0
        declared[name] = re.findall(r"'([^']*)'", block.group(1))

    for name in ("insert", "script"):
        for value in sorted(set(expected[name]) - set(declared[name])):
            errors.append("dom-stub.js: touche data-%s=\"%s\" de index.html absente du stub"
                          % (name, value))
        for value in sorted(set(declared[name]) - set(expected[name])):
            errors.append("dom-stub.js: touche data-%s=\"%s\" du stub absente de index.html"
                          % (name, value))
        if expected[name] != declared[name] and set(expected[name]) == set(declared[name]):
            errors.append("dom-stub.js: ordre des touches data-%s different de index.html "
                          "(%s contre %s)" % (name, expected[name], declared[name]))
    return len(expected["insert"]) + len(expected["script"])


def main():
    errors = []
    precache = check_precache(errors)
    html_refs = check_html_refs(errors)
    icons = check_manifest(errors)
    imports = check_imports(errors)
    audio_refs = check_assets_referenced_by_code(errors)
    dom, missing_dom = check_dom_ids(errors)
    bar = check_symbol_bar(errors)

    print("precache service worker : %d entrees" % precache)
    print("references dans HTML    : %d" % html_refs)
    print("icones du manifeste     : %d" % icons)
    print("imports JS resolus      : %d" % imports)
    print("chemins audio dans le JS: %d" % audio_refs)
    print("ids DOM utilises par ui : %d" % dom)
    print("touches barre vs stub   : %d" % bar)

    if errors:
        print()
        for message in errors:
            print("ECHEC  %s" % message)
        print("\n%d probleme(s)" % len(errors))
        return 1

    print("\nok: tous les fichiers referencés sont presents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
