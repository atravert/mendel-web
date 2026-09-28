#!/usr/bin/env python3
"""Execute les tests JS de la webapp.

Ni Node ni un navigateur ne sont disponibles ici, mais macOS embarque
JavaScriptCore: /System/Library/Frameworks/JavaScriptCore.framework/
Versions/A/Helpers/jsc. Jsc ne lit pas les modules ES, donc on concatene
data.js + quiz.js + le fichier de test en un seul script en retirant les
mots-cles `import` / `export`, qui n'ont ici aucun autre role que le
routage entre fichiers.

Les assertions vivent dans tools/tests/*.test.js, en JS normal.
"""

import json
import os
import re
import subprocess
import sys

JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ordre de concatenation. L'amorce s'intercale avant js/audio.js, qui lit
# localStorage et branche un ecouteur sur document des son chargement -- les
# globaux doivent donc exister avant lui.
STAGES = [
    (["tools/tests/dom-stub.js"], None, None),
    (None, "bootstrap", None),
    (["js/data.js", "js/quiz.js"], None, None),
    (["js/audio.js"], None, "namespace:js/audio.js:sound"),
    (["js/ui.js"], None, None),
]

BOOTSTRAP = """
// --- amorce de l'environnement (avant audio.js) ---
var MENDEL_HTML = %s;
var document = createDocument(MENDEL_HTML, ['elements', 'ions']);
var window = createWindow(document);
var navigator = window.navigator;
var localStorage = window.localStorage;
var fetch = window.fetch;
var Audio = window.Audio;
var location = window.location;

// Jsc n'a pas de boucle d'evenement ni de setTimeout, et ce n'est pas un
// oubli qu'il faille combler: aucun code de production n'en utilise. Fournir
// une minuterie ici rendrait possible un report de focus -- le defaut exact
// qu'on cherche a empecher -- et le rendrait invisible, puisque le focus
// poserait toujours au flush. Si une minterie devient vraiment necessaire,
// il faudra d'abord ecrire le test qui echoue sans elle.
"""


def strip_modules(source, name):
    source = re.sub(r"^\s*import\s+[^;]*?;\s*$", "", source, flags=re.M)
    source = re.sub(r"^\s*export\s+(const|let|var|function|class|async)\b",
                    r"\1", source, flags=re.M)
    return "// ---- %s ----\n%s" % (name, source)


EPILOGUE = """
// --- resume unique, tous fichiers de test confondus ---
print('');
print(passed + ' assertions reussies, ' + failed + ' en echec');
if (failed > 0) throw new Error(failed + ' test(s) en echec');
"""


def namespace_of(rel, alias):
    """Rebatit l'objet `alias` a partir des exports reellement declares.

    `import * as sound from './audio.js'` disparait a la concatenation, donc il
    faut reconstituer l'objet a la main -- ici derive des exports du module
    pour ne pas deriver de lui.
    """
    with open(os.path.join(ROOT, rel), encoding="utf-8") as handle:
        source = handle.read()
    names = re.findall(
        r"^\s*export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)",
        source, flags=re.M)
    if not names:
        sys.exit("aucun export trouve dans %s" % rel)
    body = ", ".join("%s: %s" % (n, n) for n in names)
    return ("// --- namespace %s (reconstruit depuis les exports de %s) ---\n"
            "var %s = { %s };\n" % (alias, rel, alias, body))


def bundle(tests):
    parts = []
    for files, bootstrap, after in STAGES:
        if bootstrap:
            html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
            parts.append(BOOTSTRAP % json.dumps(html))
            continue
        for rel in files:
            with open(os.path.join(ROOT, rel), encoding="utf-8") as handle:
                parts.append(strip_modules(handle.read(), rel))
        if after:
            kind, rel, alias = after.split(":")
            if kind == "namespace":
                parts.append(namespace_of(rel, alias))
    for rel in tests:
        with open(os.path.join(ROOT, rel), encoding="utf-8") as handle:
            parts.append("// ---- %s ----\n%s" % (rel, handle.read()))
    parts.append(EPILOGUE)
    return "\n".join(parts)


def main():
    tests = sorted(
        os.path.join("tools", "tests", f)
        for f in os.listdir(os.path.join(ROOT, "tools", "tests"))
        if f.endswith(".test.js")
    )
    if not tests:
        sys.exit("aucun fichier tools/tests/*.test.js")

    if not os.path.exists(JSC):
        sys.exit("JavaScriptCore introuvable: %s" % JSC)

    source = bundle(tests)
    tmp = os.path.join(ROOT, ".build-test.js")
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(source)

    try:
        result = subprocess.run([JSC, tmp], capture_output=True, text=True)
    finally:
        os.unlink(tmp)

    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        print("\nECHEC du test (code %d)" % result.returncode)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
