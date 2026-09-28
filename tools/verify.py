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


def check_viewport(errors):
    """Les variables CSS publiees par ui.js doivent etre consommees par style.css.

    Le contrat passe par des noms de variables: ui.js ecrit `--app-height`,
    style.css la lit. Aucun test ne voit le CSS, donc renommer d'un cote laisse
    la suite verte et la mise en page cassee en silence. On verifie que les
    deux noms se repondent, et qu'un repli subsiste pour le cas ou le JS n'a
    pas tourne -- sans quoi la page vaut zero pixel de haut au premier rendu.
    """
    src = strip_comments(read("js/ui.js"))
    css = strip_comments(read("css/style.css"))

    # \s, et non un espace: l'appel est reparti sur deux lignes, et une
    # regexp trop etroite le ferait disparaitre du compte.
    published = set(re.findall(r"setProperty\(\s*'(--[\w-]+)'", src))
    used = set(re.findall(r"var\((--[\w-]+)", css))

    count = 0
    for name in sorted(published):
        count += 1
        if name not in used:
            errors.append("style.css: %s publie par ui.js n'est consomme par aucune "
                          "regle" % name)
    for name in sorted(used - published):
        if name.startswith("--app-"):
            errors.append("style.css: %s consommee mais jamais publiee par ui.js" % name)
            count += 1

    # Sans repli, le premier rendu precede l'appel a syncViewport() -- donc une
    # page sans hauteur du tout, le temps que le script s'execute.
    for name in sorted(published):
        block = re.search(r"var\(%s,\s*([^)]+)\)" % re.escape(name), css)
        if not block or not block.group(1).strip():
            errors.append("style.css: %s n'a pas de valeur de repli" % name)
    return count


def parse_rules(css):
    """Les regles de `css`, sous la forme {selecteur: corps}.

    Un dict, et non une recherche de texte: les selecteurs et les corps se
    recouvrent, et un motif qui enchaine les deux finit toujours par
    apparier la queue d'un selecteur au corps de la regle SUIVANTE. C'est
    arrive ici, et le controle passait au vert sur une regle absente.

    Les regles imbriquees (`@media`) portent des `{` dans leur partie
    selecteur: on les ignore plutot que de les deformer.
    """
    regles = {}
    for selecteurs, corps in re.findall(r"([^{}]+)\{([^}]*)\}", css):
        selecteurs = selecteurs.strip()
        if "{" in selecteurs or selecteurs.startswith("@"):
            continue
        for selecteur in selecteurs.split(","):
            regles[selecteur.strip()] = corps
    return regles


def check_centering(errors):
    """L'ecran de quiz s'ancre en haut; les deux autres se centrent.

    Ce n'est plus une question de gout, c'est l'invariant qui tient la
    position des elements a l'ecran pendant toute une serie.

    Le centrage vertical lie la position du contenu a la hauteur disponible,
    et cette hauteur change des que le clavier se leve: 844 px deviennent
    508 px, et le contenu se deplace de la moitie de la difference, soit
    168 px -- exactement le poussage vers le haut signale. Ancre en haut, la
    position ne depend plus de la hauteur: ni l'enonce, ni le bloc de saisie,
    ni Valider ne bougent du premier geste au dernier.

    L'ancre passe par l'absence de marges automatiques: `margin-block-start:
    auto` sur le premier enfant est exactement ce qui recentre. On verifie
    donc l'absence de ces marges sur l'ecran de quiz, et leur presence sur les
    deux autres -- qui, eux, doivent rester centres.

    Et sur les trois, pas de `justify-content: center`: les deux centrent, un
    seul rend le debordement atteignable. Avec `justify-content`, un contenu
    plus grand que la boite est centre quand meme, le haut sort du cadre, et
    aucun defilement n'y conduit plus. C'est invisible sans telephone, et le
    debordement est reel des que le clavier s'ouvre sur un petit ecran.
    """
    regles = parse_rules(strip_comments(read("css/style.css")))

    ecran = regles.get(".screen")
    if ecran is None:
        errors.append("style.css: regle .screen introuvable")
        return 0
    if re.search(r"justify-content\s*:\s*[^;]*\bcenter\b", ecran):
        errors.append("style.css: .screen centre par justify-content: le contenu "
                      "trop grand devient inatteignable. Utiliser les marges "
                      "automatiques.")

    count = 0
    # Les ecrans centres: les marges automatiques doivent rester la.
    for screen in ("start", "result"):
        count += 1
        # Le premier enfant porte la marge haute, le dernier la marge basse:
        # c'est la paire qui centre. Verifier les deux marges sur les deux
        # enfants serait faux, et le serait pour une bonne raison -- une
        # seule des deux suffit a recentrer.
        for bord, cote in (("first", "start"), ("last", "end")):
            selecteur = "#screen-%s > :%s-child" % (screen, bord)
            corps = regles.get(selecteur)
            if corps is None:
                errors.append("style.css: %s introuvable, #screen-%s ne sera "
                              "plus centre" % (selecteur, screen))
            elif "margin-block-%s: auto" % cote not in corps:
                errors.append("style.css: %s n'a pas `margin-block-%s: auto`, "
                              "#screen-%s ne sera plus centre"
                              % (selecteur, cote, screen))

    # L'ecran de quiz: pas de marge automatique, donc ancre en haut.
    quiz = [regles.get("#screen-quiz > :%s-child" % b) for b in ("first", "last")]
    if any(corps is None for corps in quiz):
        errors.append("style.css: regle d'ancrage pour #screen-quiz introuvable")
    else:
        count += 1
        for selecteur, corps in zip(("#screen-quiz > :first-child",
                                     "#screen-quiz > :last-child"), quiz):
            if re.search(r"margin-block\S*\s*:\s*auto", corps):
                errors.append("style.css: %s porte des marges automatiques: le "
                              "clavier qui s'ouvre le recentre et deplace toute la "
                              "question. Ancrer en haut." % selecteur)
            if "margin-block: 0" not in corps:
                errors.append("style.css: %s n'a pas `margin-block: 0`, "
                              "l'ancrage en haut n'est pas explicite" % selecteur)
    return count


def check_keyboard_inset(errors):
    """`data-keyboard` doit mettre la marge de l'indicateur d'accueil a zero.

    Meme nature de contrat que --app-height: ui.js pose l'attribut, style.css
    la consomme, et aucun test ne voit le CSS. Une faute de frappe d'un côté
    laisse la suite verte et la marge intacte -- donc 34 px repris d'un coup,
    et 34 px qui suffisaient a faire deborder l'ecran de quiz sur un petit
    telephone. Sans la detection, l'enonce, le champ et Valider ne tiennent
    plus ensemble a l'ecran, ce qui est l'autre demande.

    On verifie les trois maillons: ui.js pose l'attribut sous le bon nom,
    style.css lit cet attribut, et .shell consomme bien la variable.
    """
    src = strip_comments(read("js/ui.js"))
    css = strip_comments(read("css/style.css"))

    # `data-` dans le motif, et non dans le suffixe: sinon `aria-pressed` est
    # pris pour un attribut de donnees, et signale une regle manquante a tort.
    posers = set(re.findall(r"setAttribute\(\s*'(data-[\w-]+)'", src))
    # Meme forme des deux cotes, `data-` inclus, pour que la comparaison soit
    # une simple egalite de noms.
    lus = set(re.findall(r"\[(data-[\w-]+)=", css))

    count = 0
    for attr in sorted(posers):
        count += 1
        if attr not in lus:
            errors.append("style.css: %s pose par ui.js, lu par aucune regle" % attr)

    var = re.search(r"var\((--safe-bottom),\s*env\(safe-area-inset-bottom\)\)", css)
    if not var:
        errors.append("style.css: .shell ne retombe pas sur env(safe-area-inset-bottom) "
                      "quand le clavier est ferme")
    else:
        count += 1
        # Sur chaque attribut que ui.js pose, on cherche la regle qui le
        # consomme ET la valeur qu'elle donne. Un test par attribut, plutot
        # qu'une comparaison a un nom ecrit en dur: un nom ecrit en dur peut
        # deriver du vrai et sauter le test en silence, ce que la premiere
        # version faisait exactement.
        #
        # Et c'est la VALEUR qui compte, pas le nom: `--safe-bottom: 34px`
        # cite la variable, passe le test naif, et ne rend pas un pixel.
        for attr in sorted(posers & lus):
            regle = re.search(r"\[%s[^\]]*\]\s*\{([^}]*)\}" % re.escape(attr),
                              css, re.S)
            if not regle:
                continue
            if not re.search(r"%s:\s*0(?:px)?\s*;?" % re.escape(var.group(1)),
                             regle.group(1)):
                errors.append("style.css: la regle %s ne remet pas %s a zero: "
                              "l'indicateur d'accueil garde 34 px sous le clavier"
                              % (attr, var.group(1)))
    return count


def check_confirm_paths(errors):
    """Une source d'entree, un chemin. Le formulaire ne peut rien valider.

    Le remede au defaut iPhone -- le second retour ne passait pas a la question
    suivante -- a ete de ne plus dependre de la soumission implicite. La
    touche retour passe par `keydown`, le bouton Valider par `click`.

    Ce decoupage ne tient que si les deux sources ne peuvent pas se
    retrouver: un formulaire a bouton `type="submit"` se soumet implicitement
    quand la touche retour n'a pas ete annulee, donc la touche ferait
    valider PUIS avancer, en une seule pression. Une question sautee par
    megarde, silencieusement.

    Aucun test JS ne peut voir cela: le stub ignore le `type` d'un bouton, et
    ne produit aucune soumission implicite. C'est donc un controle statique,
    et il porte sur les DEUX moillons -- le `type` du bouton, et l'inertie du
    gestionnaire `submit`.
    """
    html = read("index.html")
    src = strip_comments(read("js/ui.js"))
    count = 0

    bouton = re.search(r"<button[^>]*id=\"validate-button\"", html, re.S)
    if not bouton:
        errors.append("index.html: bouton #validate-button introuvable")
        return 0
    count += 1
    type_attr = re.search(r"type=\"(\w+)\"", bouton.group(0))
    if not type_attr or type_attr.group(1) != "button":
        errors.append("index.html: #validate-button est type=%s. Il doit etre "
                      "type=button: avec un bouton de soumission, la touche "
                      "retour declenche une soumission implicite qui double "
                      "l'effet de onKeydown et fait sauter une question."
                      % (type_attr.group(1) if type_attr else "?"))

    # Le gestionnaire `submit` doit rester inerte: annuler, et rien d'autre.
    corps = re.search(r"addEventListener\(\s*'submit'.*?\{(.*?)\}\)", src, re.S)
    if not corps:
        errors.append("js/ui.js: aucun gestionnaire submit sur le formulaire. "
                      "Sans lui, une soumission implicite pourrait recharger "
                      "la page en plein milieu d'une serie.")
    else:
        count += 1
        for interdit in ("onEnter(", "validate(", "next("):
            if interdit in corps.group(1):
                errors.append("js/ui.js: le gestionnaire submit appelle %s. Il "
                              "doit se contenter d'annuler: c'est la touche "
                              "retour qui valide, via keydown." % interdit)
    return count


def check_sound_placement(errors):
    """L'icone son se centre sur la ligne de progression, via une hauteur partagee.

    Aucun test JS ne peut voir une mise en page. La position demandee --
    l'icone au centre de la ligne "Question X / 10 ... Score : Y" -- repose
    donc entierement sur du CSS, et sur une hypothese qu'aucun test ne peut
    verifier: que cette ligne fait toujours la meme hauteur.

    D'ou `--progress-h`, lise par `.progress-row` ET par la regle de
    centrage. Les deux ne peuvent plus diverger: c'est le contrat lui-meme qui
    tient l'alignement, pas une valeur recopiee qui derivera un jour.

    On verifie aussi que la regle de centrage ne vise QUE l'ecran de quiz. La
    ligne de progression n'existe que la; sur l'ecran de resultat le contenu
    est centre et peut remonter haut, sous un commentaire retro d'unequis. Et
    la position par defaut en haut a droite doit rester, pour que `:has()` non
    supporte -- Safari avant 15.4 -- degrade vers l'existant, pas vers une
    panne.
    """
    regles = parse_rules(strip_comments(read("css/style.css")))
    count = 0

    if "--progress-h" not in read("css/style.css"):
        errors.append("style.css: --progress-h n'est pas definie")
    else:
        count += 1

    ligne = regles.get(".progress-row")
    if ligne is None:
        errors.append("style.css: regle .progress-row introuvable")
    elif "var(--progress-h)" not in ligne:
        errors.append("style.css: .progress-row ne lit pas --progress-h: sa "
                      "hauteur peut deriver de celle utilisee pour centrer "
                      "l'icone son")
    else:
        count += 1

    defaut = regles.get(".sound-toggle")
    if defaut is None:
        errors.append("style.css: regle .sound-toggle introuvable")
    else:
        count += 1
        if "right:" not in defaut or "left:" in defaut:
            errors.append("style.css: .sound-toggle ne se positionne plus en haut "
                          "a droite par defaut: sans `:has()`, l'icone se "
                          "retrouverait au coin oppose")

    centres = [(sel, corps) for sel, corps in regles.items()
               if sel.endswith(" .sound-toggle") and sel != ".sound-toggle"]
    if not centres:
        errors.append("style.css: aucune regle ne centre .sound-toggle")
    else:
        count += 1
        for selecteur, corps in centres:
            if "#screen-quiz" not in selecteur:
                errors.append("style.css: le centrage de l'icone son vise `%s`, "
                              "alors que la ligne de progression n'existe que "
                              "sur l'ecran de quiz" % selecteur)
            for attendu in ("var(--progress-h)", "var(--tap)"):
                if attendu not in corps:
                    errors.append("style.css: le centrage de l'icone son "
                              "n'utilise pas %s, donc il n'est pas aligne sur "
                              "la ligne de progression" % attendu)
            if "left: 50%" not in corps or "translateX(-50%)" not in corps:
                errors.append("style.css: le centrage de l'icone son ne se centre "
                              "pas horizontalement (left: 50%% + translateX(-50%%))")
    return count


def main():
    errors = []
    precache = check_precache(errors)
    html_refs = check_html_refs(errors)
    icons = check_manifest(errors)
    imports = check_imports(errors)
    audio_refs = check_assets_referenced_by_code(errors)
    dom, missing_dom = check_dom_ids(errors)
    bar = check_symbol_bar(errors)
    viewport = check_viewport(errors)
    centering = check_centering(errors)
    keyboard = check_keyboard_inset(errors)
    confirm = check_confirm_paths(errors)
    son = check_sound_placement(errors)

    print("precache service worker : %d entrees" % precache)
    print("references dans HTML    : %d" % html_refs)
    print("icones du manifeste     : %d" % icons)
    print("imports JS resolus      : %d" % imports)
    print("chemins audio dans le JS: %d" % audio_refs)
    print("ids DOM utilises par ui : %d" % dom)
    print("touches barre vs stub   : %d" % bar)
    print("variables viewport CSS  : %d" % viewport)
    print("centrage de .screen     : %d" % centering)
    print("marge clavier           : %d" % keyboard)
    print("chemins de confirmation: %d" % confirm)
    print("placement du son      : %d" % son)

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
