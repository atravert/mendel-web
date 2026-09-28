# Verification et generation. Aucun outil externe requis: tout passe par
# python3 et le JavaScriptCore d'Apple deja presents sur macOS.
#
#   make          tout verifier
#   make data     regenere js/data.js depuis les sources natives
#   make icons    regenere les icones PWA
#   make audio    regenere le theme compresse (afconvert, livre avec macOS)
#   make audio-levels  mesure le niveau de sortie du theme et des effets
#   make online   le site publie sert-il la version locale ?
#   make wait     idem, en repetant jusqu'a ce que le site suive
#   make serve    sert le site sur http://localhost:8000

PYTHON ?= python3
JSC := /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc

PROD_JS := js/data.js js/quiz.js js/audio.js js/ui.js sw.js
TEST_JS := tools/tests/dom-stub.js tools/tests/quiz.test.js tools/tests/ui.test.js

.PHONY: all check test verify syntax data icons audio audio-ladder \
        audio-levels cache-version cache-check online wait serve clean

all: check

# `cache-check` est un garde-fou, pas une commodite: le service worker sert le
# cache en priorite, donc un fichier modifie avec une version perimee reste
# servi indefiniment sur les appareils deja installes. Sans cette verification,
# un correctif peut etre livre sans jamais atteindre personne.
#
# Il echoue au lieu de corriger tout seul: une reecriture silencieuse
# laisserait un arbre de travail sale, invisible en revue, et surtout ne
# preloadrait pas le changement de version dans le commit qui le contient.
check: syntax test verify cache-check
	@echo ""
	@echo "Tout est vert."

# Analyse lexicale: detecte les chaines non fermees, les commentaires
# infinites et les regex mal fermees. Remplace `node --check`, absent ici.
#
# Les scripts python sont compiles aussi, sans etre executes: un script de
# verification qui ne compile pas ne peut pas signaler qu'il ne compile pas,
# et l'oubli ne se voit qu'au moment ou l'on a besoin de lui. C'est arrive
# avec `defComparer()` dans check-published.py, que rien n'avait attrape.
#
# La recherche de caracteres parasites est ici pour la meme raison: ils se sont
# glisses trois fois dans des commentaires, toujours invisibles a la relecture,
# et aucun test ne les voit -- un ideogramme au milieu d'une phrase francaise
# n'interrompt rien. Il se signale tout seul, encore faut-il le demander.
syntax:
	@echo "== syntaxe =="
	@$(PYTHON) tools/check-js.py $(PROD_JS) $(TEST_JS)
	@$(PYTHON) -m py_compile $(wildcard tools/*.py)
	@echo "ok     outils python"
	@$(PYTHON) tools/parasites.py .

test:
	@echo ""
	@echo "== tests =="
	@$(PYTHON) tools/run-tests.py

# Coherence des fichiers referencés (precache, icones, imports, ids DOM).
verify:
	@echo ""
	@echo "== coherence des fichiers =="
	@$(PYTHON) tools/verify.py

# js/data.js est genere: ne pas l'editer a la main.
data:
	@$(PYTHON) tools/extract-data.py

icons:
	@$(PYTHON) tools/make-icons.py
	@cd icons && \
	  sips -z 192 192 icon-1024.png --out icon-192.png > /dev/null && \
	  sips -z 512 512 icon-1024.png --out icon-512.png > /dev/null && \
	  sips -z 180 180 icon-1024.png --out apple-touch-icon.png > /dev/null && \
	  sips -z 32 32 icon-1024.png --out favicon-32.png > /dev/null && \
	  echo "icones regenerees"

# Le theme est mono 22 kHz a 64 kbit/s: 820 Ko au lieu de 2,1 Mo en MP3
# stereo, pour une qualite mesuree superieure (`make audio-ladder` rejoue la
# mesure). afconvert est livre avec macOS, donc rien a installer. La source
# reste le .mp3 de l'app Android, que ce depot ne modifie pas.
audio:
	@$(PYTHON) tools/audio.py build

# Compare les couples (frequence, debit) sur le theme d'origine.
audio-ladder:
	@$(PYTHON) tools/audio.py ladder

# Niveau auquel sortira reellement chaque fichier, une fois multiplie par
# MUSIC_VOLUME et EFFECT_VOLUME, lus dans js/audio.js. Le volume du telephone
# est le maitre: l'application ne doit pas obliger a le bouger, donc il faut
# un seul reglage "normal" qui convienne a la musique ET aux effets. C'est le
# seul controle du volume qui ne depende pas de l'oreille.
audio-levels:
	@$(PYTHON) tools/audio.py levels

# Recalcule CACHE_VERSION dans sw.js d'apres l'empreinte des fichiers
# precaches. A lancer apres toute modification d'un fichier du precache.
cache-version:
	@$(PYTHON) tools/sync-cache-version.py

# Variante en lecture seule, utilisee par `make`: signale l'oubli sans
# toucher au fichier.
cache-check:
	@$(PYTHON) tools/sync-cache-version.py --check

# Le deploiement est-il arrive sur le site? `git push` ne repond pas a la
# question: GitHub Pages republie en une a deux minutes, et ensuite l'appareil
# a lui-meme deux lancements de retard. Sans cette etape, ces trois delais se
# confondent en un seul symptome.
#
# Volontairement hors de `make check`: il demande le reseau, et une
# verification de code ne doit pas en dependre.
online:
	@$(PYTHON) tools/check-published.py

# Idem, en attendant la fin de la republication.
wait:
	@$(PYTHON) tools/check-published.py --watch

# http://localhost:est un contexte secur, donc le service worker s'y installe
# comme en production. Indispensable pour tester le hors-ligne.
serve:
	@$(PYTHON) -m http.server 8000

clean:
	@rm -f .build-test.js
