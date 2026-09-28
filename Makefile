# Verification et generation. Aucun outil externe requis: tout passe par
# python3 et le JavaScriptCore d'Apple deja presents sur macOS.
#
#   make          tout verifier
#   make data     regenere js/data.js depuis les sources natives
#   make icons    regenere les icones PWA
#   make audio    regenere le theme compresse (afconvert, livre avec macOS)
#   make serve    sert le site sur http://localhost:8000

PYTHON ?= python3
JSC := /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc

PROD_JS := js/data.js js/quiz.js js/audio.js js/ui.js sw.js
TEST_JS := tools/tests/dom-stub.js tools/tests/quiz.test.js tools/tests/ui.test.js

.PHONY: all check test verify syntax data icons audio audio-ladder \
        cache-version cache-check serve clean

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
syntax:
	@echo "== syntaxe =="
	@$(PYTHON) tools/check-js.py $(PROD_JS) $(TEST_JS)

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

# Recalcule CACHE_VERSION dans sw.js d'apres l'empreinte des fichiers
# precaches. A lancer apres toute modification d'un fichier du precache.
cache-version:
	@$(PYTHON) tools/sync-cache-version.py

# Variante en lecture seule, utilisee par `make`: signale l'oubli sans
# toucher au fichier.
cache-check:
	@$(PYTHON) tools/sync-cache-version.py --check

# http://localhost:est un contexte secur, donc le service worker s'y installe
# comme en production. Indispensable pour tester le hors-ligne.
serve:
	@$(PYTHON) -m http.server 8000

clean:
	@rm -f .build-test.js
