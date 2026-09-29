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

    # `:has()` est refuse explicitement. L'exigence porte sur le bon endroit
    # -- la regle doit viser l'ecran de quiz -- mais l'ecriture compte aussi:
    # `:has()` demande Safari 15.4, et sur un appareil plus ancien la regle ne
    # s'applique pas du tout. L'icone resterait alors en haut a droite, soit
    # exactement le symptome signale. `data-screen` marche partout, et se
    # teste.
    #
    # Sur le CSS sans ses commentaires: le mot `:has(` y est cite, pour
    # expliquer pourquoi on ne s'en sert pas. Le chercher dans le texte brut
    # ferait echouer le fichier a cause de sa propre documentation.
    if ":has(" in strip_comments(read("css/style.css")):
        errors.append("style.css: le centrage de l'icone son utilise `:has()`. "
                      "Utiliser html[data-screen='quiz'], pose par showScreen(): "
                      "`:has()` demande Safari 15.4 et laisse l'icone a sa "
                      "position par defaut sur les versions plus anciennes.")

    centres = [(sel, corps) for sel, corps in regles.items()
               if sel.endswith(" .sound-toggle") and sel != ".sound-toggle"]
    if not centres:
        errors.append("style.css: aucune regle ne centre .sound-toggle")
    else:
        count += 1
        for selecteur, corps in centres:
            if "data-screen='quiz'" not in selecteur:
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


def check_build_marker(errors):
    """Le numero affiche et le cache servi doivent etre le meme.

    Le marqueur de version ne sert a rien s'il peut diverger du cache que
    l'appareil sert reellement: il afficherait une version, et crierait une
    autre. Un outil de depannage qui ment est pire que pas d'outil, parce
    qu'il oriente le depannage dans la mauvaise direction.

    La coherence tient a l'outillage: `make cache-version` ecrit les deux
    depuis la meme empreinte, et retire le `<meta>` de l'empreinte elle-meme
    -- sinon le calcul serait autoreferentiel et ne convergerait pas. Ce
    controle verifie que l'outillage a bien joue son role.
    """
    html = read("index.html")
    sw = read("sw.js")

    affichee = re.search(r'<meta name="app-version" content="([^"]*)">', html)
    if not affichee:
        errors.append("index.html: meta name=\"app-version\" absent. Sans lui, "
                      "impossible de savoir quel code tourne sur l'appareil.")
        return 0

    servie = re.search(r"^const CACHE_VERSION = '([^']*)';$", sw, re.M)
    if not servie:
        errors.append("sw.js: CACHE_VERSION introuvable")
        return 0

    if affichee.group(1) != servie.group(1):
        errors.append("index.html affiche la version %s alors que sw.js sert la "
                      "version %s. L'appareil afficherait un numero faux."
                      % (affichee.group(1), servie.group(1)))
        return 0

    # L'empreinte du contenu doit encore correspondre: un fichier modifie
    # depuis le dernier `make cache-version` est le meme piege, et la
    # divergence ci-dessus ne le verrait pas.
    return 2


def check_service_worker(errors):
    """Le service worker ne doit lire que SON cache.

    `caches.match(request)` parcourt tous les caches de l'origine, pas
    seulement celui du service worker courant. Le cache etant servi en
    priorite, une seule reponse lue dans un cache perime suffisait a servir
    l'ancien code indefiniment: l'ancien service worker prenait le relais au
    suivant, et le nouveau n'arrivait jamais sur l'appareil.

    C'est exactement le symptome "j'ai corrige, rien ne change", et il est
    impossible a distinguer d'un correctif inefficace sans le marqueur de
    version. Le bug s'est deja produit dans ce depot.

    Aucune assertion JS ne peut voir cela: le harnais n'a pas de service
    worker. C'est une verification de code par lecture, donc elle est
    explicite sur ce qu'elle refuse.
    """
    src = strip_comments(read("sw.js"))
    count = 0

    # `caches.match(` reste legitime dans un commentaire... il n'y en a pas
    # ici, puisque le CSS et le JS sont lus sans leurs commentaires. Toute
    # occurrence est donc une lecture globale.
    globales = re.findall(r"caches\.match\(", src)
    if globales:
        errors.append("sw.js: %d lecture(s) par `caches.match()`, qui parcourt "
                      "TOUS les caches. Un cache perime peut alors faire "
                      "d'ombre au cache vivant et servir l'ancien code "
                      "indefiniment. Utiliser caches.open(CACHE_NAME)."
                      % len(globales))
    else:
        count += 1

    if "caches.open(CACHE_NAME)" not in src:
        errors.append("sw.js: aucune lecture par caches.open(CACHE_NAME). "
                      "Le cache courant n'est jamais ouvert explicitement.")
    else:
        count += 1

    # Le service worker doit pouvoir dire sa version: c'est ce que la page
    # affiche, et le seul moyen de distinguer un appareil perime d'un
    # correctif inefficace.
    if "mendel-version" not in src:
        errors.append("sw.js: le worker ne repond pas a une demande de version. "
                      "Sans cela, le numero affiche peut mentir sur ce qui est "
                      "reellement servi.")
    else:
        count += 1
    return count


def check_action_bar(errors):
    """La zone d'action est atteignable, et le contenu qui disparait libere sa place.

    Le symptome signale sur iOS etait precis: le bandeau de retour et le bouton
    Suivant invisibles derriere le clavier. Ce n'etait ni le clavier ni une
    hauteur d'ecran, c'etait une structure:

      - la coque portait `min-height`, donc elle pouvait GRANDIR au-dela de la
        hauteur visible, et c'etait le DOCUMENT qui defilait. Un `position:
        sticky` se colle alors au bas du viewport de mise en page, pas de la
        zone visible -- et sur iOS ce viewport ne retrecit pas quand le clavier
        se leve. La barre se retrouvait donc sous le clavier: la forme
        exactement inverse de ce qu'on lui demandait. D'ou `height`, plus
        `overflow: hidden`, et le fait que `.screen` reste le seul conteneur qui
        defile;

      - l'enonce et le type de question restaient en place apres la reponse,
        70 px et 34 px occupes pendant que le bouton Suivant attendait en bas;
      - le bouton Valider se grisait sans disparaitre, 48 px pour une action
        morte.

    Chacune de ces trois choses se verifie ici, parce qu'aucune n'est visible
    depuis un test JS: elles sont du CSS et du markup. Et chacune se
    reverrouille sur une valeur exacte plutot que sur une intention.
    """
    count = 0
    css = strip_comments(read("css/style.css"))
    regles = parse_rules(css)

    # --- La coque calee sur la hauteur visible, et elle seule ---------------
    shell = regles.get(".shell")
    if shell is None:
        errors.append("style.css: regle .shell introuvable")
        return count

    if re.search(r"(^|[;\s])min-height\s*:", shell):
        errors.append("style.css: .shell en min-height: la coque peut depasser la "
                      "hauteur visible, le document defile, et la barre collee se "
                      "colle au viewport de mise en page -- sous le clavier sur "
                      "iOS. Utiliser height.")
    else:
        count += 1

    if not re.search(r"(^|[;\s])height\s*:", shell):
        errors.append("style.css: .shell sans height: rien ne cale la coque sur la "
                      "hauteur visible publiee par --app-height.")
    else:
        count += 1

    if not re.search(r"overflow\s*:\s*hidden", shell):
        errors.append("style.css: .shell sans overflow: hidden: le document "
                      "defile aussi, et la barre collee perd son point de "
                      "reference.")
    else:
        count += 1

    # `.screen` doit rester le seul a defiler: c'est lui qui borne la barre.
    screen = regles.get(".screen")
    if screen is None or not re.search(r"overflow-y\s*:\s*auto", screen):
        errors.append("style.css: .screen sans overflow-y: auto: plus aucun "
                      "conteneur ne defile, donc la barre collee n'a plus de "
                      "bas auquel se coller.")
    else:
        count += 1

    # --- La barre d'action, enfant de la coque et rien d'autre -----------
    actions = regles.get(".actions")
    if actions is None:
        errors.append("style.css: regle .actions introuvable: les deux actions ne "
                      "sont plus regroupees, donc rien ne garantit qu'elles restent "
                      "atteignables quand le contenu deborde.")
        return count

    # `sticky` et `fixed` sont refuses, et pas seulement absents. Les deux
    # ont ete essayes, et les deux sont faux:
    #   - `fixed` se cale sur le viewport de mise en page, qui ne retrecit pas
    #     sur iOS quand le clavier se leve: la barre part sous le clavier;
    #   - `sticky` ne se deplace que dans la boite de son parent. Parent du
    #     bouton dans l'ecran defilant, c'est le formulaire -- et des que le
    #     contenu deborde, le formulaire est plus bas que la zone visible,
    #     donc la barre ne peut pas remonter au-dessus de lui. Le symptome
    #     reste entier.
    # Enfant de la coque, qui ne defile pas, la barre est un element de flex
    # au bas de la zone visible: ca, ca tient quelle que soit la hauteur.
    position = re.search(r"position\s*:\s*(\w+)", actions)
    if position:
        trouve = position.group(1)
        if trouve == "sticky":
            errors.append("style.css: .actions en position sticky: un element "
                          "colle ne se deplace que dans la boite de son parent, "
                          "donc pas au-dessus du formulaire. Le symptome reste "
                          "entier. Faire de .actions un enfant de .shell.")
        elif trouve == "fixed":
            errors.append("style.css: .actions en position fixed: il se cale sur "
                          "le viewport de mise en page, qui ne retrecit pas sur "
                          "iOS quand le clavier se leve. Faire de .actions un "
                          "enfant de .shell.")
        else:
            errors.append("style.css: .actions en position %s: position sans "
                          "effet ici, la barre n'est plus garantie en bas de la "
                          "zone visible." % trouve)
    else:
        count += 1

    if not re.search(r"flex\s*:\s*0\s+0\s+auto", actions):
        errors.append("style.css: .actions sans flex: 0 0 auto: un contenu long "
                      "peut compresser la zone d'action.")
    else:
        count += 1

    if not re.search(r"display\s*:\s*none", actions):
        errors.append("style.css: .actions visible par defaut: la barre "
                      "d'action s'afficherait aussi sur l'ecran d'accueil et "
                      "sur le resultat. Le portage est conditionne par "
                      "data-screen.")
    else:
        count += 1

    # Le portage: visible seulement sur le quiz, via l'attribut deja publie.
    portage = regles.get("html[data-screen='quiz'] .actions")
    if portage is None:
        portage = regles.get('html[data-screen="quiz"] .actions')
    if not portage or not re.search(r"display\s*:\s*flex", portage):
        errors.append("style.css: pas de regle affichant .actions quand "
                      "data-screen vaut 'quiz': la barre d'action resterait "
                      "masquee sur l'ecran ou elle sert, ou visible partout.")
    else:
        count += 1

    # Le bandeau de mesure doit etre visible lui aussi: s'il reste dans
    # l'ecran qui defile, le debordement le rend inatteignable, et il perd
    # donc sa raison d'etre.
    note = regles.get(".overflow-note")
    if note is None:
        errors.append("style.css: regle .overflow-note introuvable")
    else:
        if not re.search(r"flex\s*:\s*0\s+0\s+auto", note):
            errors.append("style.css: .overflow-note sans flex: 0 0 auto: le "
                          "diagnostic peut etre ecrase par le contenu.")
        else:
            count += 1

    # --- L'enonce s'efface, et le commentaire prend sa place ---------------
    masque = regles.get("html[data-answered='1'] .question-type")
    if masque is None:
        masque = regles.get('html[data-answered="1"] .question-type')
    if not masque or "display" not in masque or "none" not in masque:
        errors.append("style.css: pas de regle masquant .question-type quand "
                      "data-answered est pose: l'enonce et le type de question "
                      "restent en place apres la reponse, et la place manque "
                      "justement la.")
    else:
        count += 1

    masque_prompt = regles.get("html[data-answered='1'] .prompt")
    if masque_prompt is None:
        masque_prompt = regles.get('html[data-answered="1"] .prompt')
    if not masque_prompt or "none" not in masque_prompt:
        errors.append("style.css: pas de regle masquant .prompt quand "
                      "data-answered est pose: les 53 px de l'enonce ne sont pas "
                      "rendus au commentaire.")
    else:
        count += 1

    # --- Le markup: l'ordre decide de l'occupation de la place -------------
    html = read("index.html")

    try:
        pos_feedback = html.index('id="feedback"')
        pos_form = html.index('id="answer-form"')
    except ValueError:
        errors.append("index.html: #feedback ou #answer-form introuvable")
        return count

    # Le commentaire doit preceder le formulaire: apres la reponse, l'enonce
    # disparait, et c'est donc le commentaire qui occupe l'emplacement libere.
    # Place apres le formulaire, il s'y EMPILE au lieu de le reprendre.
    if pos_feedback > pos_form:
        errors.append("index.html: #feedback apres #answer-form: le commentaire "
                      "s'empile sous le formulaire au lieu de reprendre la place "
                      "laissee par l'enonce, qui ne peut donc pas etre rendue.")
    else:
        count += 1

    # Valider et Suivant dans la meme barre, elle-meme enfant de la coque.
    try:
        pos_actions = html.index('class="actions"')
        pos_valider = html.index('id="validate-button"')
        pos_suivant = html.index('id="next-button"')
        fin_form = html.index("</form>", pos_form)
        fin_quiz = html.index("</section>", pos_form)
        fin_main = html.index("</main>")
    except ValueError:
        errors.append("index.html: .actions, un des deux boutons, </form>, "
                      "</section> ou </main> introuvable")
        return count

    # La barre doit etre APRES la fermeture de l'ecran: enfant de la coque,
    # elle seule n'a pas de conteneur qui defile autour d'elle.
    if not (fin_quiz < pos_actions < fin_main):
        errors.append("index.html: .actions n'est pas enfant de .shell: etant dans "
                      "#screen-quiz, elle se retrouve dans le conteneur qui defile, "
                      "donc elle disparait avec lui. C'est la cause du symptome.")
    else:
        count += 1

    # Les deux boutons dans la barre. Hors de la barre, l'un des deux -- Suivant
    # en particulier -- redeviendrait le dernier element du flux, donc le
    # premier a sortir de l'ecran.
    if not (pos_actions < pos_valider < fin_main) or not (pos_actions < pos_suivant):
        errors.append("index.html: un des deux boutons n'est pas dans .actions")
    else:
        count += 1

    # Le bandeau de mesure hors de l'ecran defilant, lui aussi.
    try:
        pos_note = html.index('id="overflow-note"')
    except ValueError:
        errors.append("index.html: #overflow-note introuvable")
        pos_note = -1
    if pos_note != -1:
        if not (fin_form < pos_note < fin_main):
            errors.append("index.html: #overflow-note dans #screen-quiz: le "
                          "debordement le rend lui-meme inatteignable, et il perd "
                          "donc sa raison d'etre.")
        else:
            count += 1

    # Le bandeau doit naitre masque: un diagnostic visible d'emblee annonce un
    # probleme qui n'existe peut-etre pas encore.
    bandeau = re.search(r'<p class="overflow-note" id="overflow-note"([^>]*)>',
                        html)
    if bandeau is None:
        errors.append("index.html: #overflow-note introuvable ou sans la classe "
                      "overflow-note")
    elif "hidden" not in bandeau.group(1):
        errors.append("index.html: #overflow-note n'est pas masque au depart: le "
                      "diagnostic s'afficherait avant meme qu'il y ait quoi que ce "
                      "soit a signaler.")
    else:
        count += 1

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
    marker = check_build_marker(errors)
    keyboard = check_keyboard_inset(errors)
    confirm = check_confirm_paths(errors)
    son = check_sound_placement(errors)
    worker = check_service_worker(errors)
    action = check_action_bar(errors)

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
    print("marqueur de version   : %d" % marker)
    print("placement du son      : %d" % son)
    print("lectures du service wk: %d" % worker)
    print("barre d'action et place: %d" % action)

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
