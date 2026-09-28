// Faux DOM minimal pour executer js/ui.js hors navigateur.
//
// Safari est le seul navigateur installe ici et safaridriver exige
// l'automatisation distante (desactivable, et reservee au developpement
// interactif), donc aucun test ne peut tourner dans un vrai navigateur sur
// cette machine. Ce stub fournit juste ce dont ui.js a besoin -- et comme il
// est construit a partir du vrai index.html, il verifie aussi que le markup
// contient bien les identifiants attendus.
//
// Ce n'est pas un navigateur: ni mise en page, ni evenements clavier, ni Web
// Audio. Cela couvre la machine a etats (score, gardes, navigation entre
// ecrans), pas le rendu ni le son.

function makeTextNode(doc, value) {
  return { nodeType: 3, tagName: '#TEXT', children: [], textContent: String(value) };
}

function makeElement(tag, id, doc) {
  const element = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    id: id || '',
    hidden: false,
    className: '',
    value: '',
    disabled: false,
    readOnly: false,
    // Variables CSS posees par ui.js depuis visualViewport: le stub n'a pas de
    // moteur de rendu, mais il doit pouvoir les lire, sinon le code de
    // synchronisation serait teste en silence, donc jamais verifie.
    style: {
      _props: {},
      setProperty(name, value) { this._props[name] = value; },
      getPropertyValue(name) { return this._props[name] || ''; },
    },
    placeholder: '',
    dataset: {},
    attrs: {},
    children: [],
    selectionStart: 0,
    selectionEnd: 0,
    focused: 0,
    blurred: 0,
    _listeners: {},
    // Ancetre pour la propagation de `fire()`. Renseigne uniquement la ou un
    // conteneur recoit des evenements delegues.
    _parent: null,

    /**
     * Comme dans un vrai DOM: poser textContent remplace tous les enfants par
     * un unique noeud de texte, et le lire concatene la descendance. Sans
     * cela, un appendChild() apres un textContent = ... resterait invisible
     * et les tests de rendu de retour de reponse echoueraient.
     */
    get textContent() {
      return this.children.map((child) => child.textContent).join('');
    },
    set textContent(value) {
      this.children = value === '' || value === undefined || value === null
        ? []
        : [makeTextNode(doc, value)];
    },

    setAttribute(name, val) { this.attrs[name] = String(val); },
    getAttribute(name) { return this.attrs[name]; },
    querySelector(selector) { return makeElement('span', '', doc); },
    querySelectorAll() { return []; },
    closest() { return null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      return child;
    },
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = this._listeners[type];
      if (!list) return;
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    /**
     * Declenche les ecouteurs de l'element PUIS ceux de ses ancetres.
     *
     * La propagation n'est pas un detail: le code de production enregistre
     * ses gardes `pointerdown` sur le conteneur (l'ecran de quiz, la barre de
     * symboles) et non sur chaque bouton. Sans remontee, ces ecouteurs ne
     * seraient jamais appeles par un test, et la parade anti-prise de focus
     * serait verifiee dans le vide -- c'est-a-dire pas verifiee.
     */
    fire(type, event) {
      const payload = Object.assign({
        type,
        target: this,
        defaultPrevented: false,
        preventDefault() { payload.defaultPrevented = true; },
        stopPropagation() { payload.propagationStopped = true; },
      }, event || {});
      this.lastEvent = payload;

      let node = this;
      while (node && !payload.propagationStopped) {
        for (const fn of node._listeners[type] || []) fn(payload);
        node = node._parent;
      }
      return payload;
    },
    focus() { this.focused += 1; doc.activeElement = this; },
    blur() { this.blurred += 1; if (doc.activeElement === this) doc.activeElement = null; },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end === undefined ? start : end;
    },
  };
  return element;
}

/**
 * @param {string} html  contenu de index.html
 * @param {string} topicButtons  nombre simule de boutons data-topic
 */
function createDocument(html, topicIds) {
  const doc = {
    activeElement: null,
    _listeners: {},
    _elements: {},
    createElement: (tag) => makeElement(tag, '', doc),
    createTextNode: (text) => makeTextNode(doc, text),
    addEventListener(type, fn) {
      (doc._listeners[type] = doc._listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = doc._listeners[type];
      if (!list) return;
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    fire(type, event) {
      for (const fn of doc._listeners[type] || []) {
        fn(Object.assign({ type }, event || {}));
      }
    },
    getElementById(id) {
      if (!doc._elements[id]) doc._elements[id] = makeElement('div', id, doc);
      return doc._elements[id];
    },
    querySelectorAll(selector) {
      if (selector === '[data-topic]') {
        // Mêmes instances a chaque appel: le code de production enregistre ses
        // ecouteurs une fois pour toutes au chargement, et le test doit
        // retrouver exactement ces objets.
        if (!doc._topicButtons) {
          doc._topicButtons = topicIds.map((topic) => {
            const button = makeElement('button', '', doc);
            button.dataset.topic = topic;
            return button;
          });
        }
        return doc._topicButtons;
      }
      return [];
    },
  };

  // Un element doit exister des le depart si le markup le declare, sinon
  // getElementById() en creerait un et le test ne detecterait pas un id manquant.
  // Son etat `hidden` est repris du HTML: les trois ecrans ne demarrent pas
  // tous visibles.
  for (const match of html.match(/<[a-zA-Z][^>]*>/g) || []) {
    const id = (match.match(/\bid="([^"]+)"/) || [])[1];
    if (!id) continue;
    const node = makeElement((match.match(/^<([a-zA-Z0-9-]+)/) || [])[1] || 'div', id, doc);
    node.hidden = /(^|\s)hidden(\s|=|>|$)/.test(match);
    doc._elements[id] = node;
  }
  doc._declaredIds = (html.match(/id="([^"]+)"/g) || []).map((m) => m.slice(4, -1));

  // La barre de symboles doit repondre a querySelectorAll('[data-insert]')
  // et querySelectorAll('[data-script]') *avant* que le code de production ne
  // s'execute: il enregistre ses ecouteurs au chargement, et ne les
  // retrouverait jamais si le cablage etait fait plus tard.
  const symbolBar = doc._elements['symbol-bar'];
  if (symbolBar) {
    // Une touche se reconnait elle-meme a closest(), pour tester le
    // preventDefault que le parent delegue.
    const makeKey = (dataset) => {
      const key = makeElement('button', '', doc);
      Object.assign(key.dataset, dataset);
      key.closest = (selector) => (selector === '.key' ? key : null);
      return key;
    };

    // L'ordre suit index.html: rangee des signes, puis rangee des chiffres.
    doc._insertKeys = ['+', '-', '(', ')', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
      .map((value) => makeKey({ insert: value }));
    doc._scriptKeys = ['sub', 'sup'].map((value) => makeKey({ script: value }));

    for (const key of doc._insertKeys.concat(doc._scriptKeys)) key._parent = symbolBar;

    symbolBar.querySelectorAll = (selector) => {
      if (selector === '[data-insert]') return doc._insertKeys;
      if (selector === '[data-script]') return doc._scriptKeys;
      return [];
    };
  }

  // Les boutons de l'ecran de quiz sont enfants de l'ecran, qui porte le
  // garde-fou `pointerdown` empechant le focus de quitter le champ.
  const quizScreen = doc._elements['screen-quiz'];
  if (quizScreen) {
    for (const name of ['validate-button', 'next-button']) {
      const button = doc._elements[name];
      if (!button) continue;
      button._parent = quizScreen;
      // Comme les touches de la barre: un bouton se reconnait lui-meme a
      // `closest()`, sinon la parade de ui.js ne le verrait jamais.
      button.closest = (selector) => (selector === 'button' ? button : null);
    }
  }

  // `documentElement` recoit les variables CSS de ui.js. Sans lui,
  // syncViewport() echouerait et le chemin le plus fragile de l'application
  // -- celui qui depend du comportement reel du clavier -- resterait non teste.
  doc.documentElement = makeElement('html', '', doc);

  return doc;
}

/**
 * Faux `visualViewport` pilotable: `setKeyboard(height)` simule l'ouverture du
 * clavier, `hideKeyboard()` sa fermeture, et l'evenement `resize` est emis
 * comme le ferait un vrai navigateur.
 */
function createViewport(doc) {
  const viewport = {
    width: 390,
    height: 844,
    offsetTop: 0,
    _listeners: { resize: [], scroll: [] },
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    /**
     * Ouvre le clavier: seule la HAUTEUR visible diminue. Le decalage reste
     * independant, parce qu'il l'est en reel: iOS peut lever le clavier sans
     * faire defiler (offsetTop nul), ou faire defiler d'autant (offsetTop
     * egal a la hauteur perdue). Relier les deux -- comme un stub trop
     * simple le ferait -- rendrait `height` et `offsetTop` redondants, et
     * `--app-height` indiscutable: une erreur de signe passerait.
     */
    setKeyboard(height) {
      this.height = height;
      for (const fn of this._listeners.resize) fn({ type: 'resize' });
    },
    hideKeyboard() {
      this.height = 844;
      for (const fn of this._listeners.resize) fn({ type: 'resize' });
    },
    /** Fait defiler le document de `top` pixels sous le clavier. */
    scrollTo(top) {
      this.offsetTop = top;
      for (const fn of this._listeners.scroll) fn({ type: 'scroll' });
    },
  };
  return viewport;
}

/** References pratiques, posees par createDocument avant le chargement de ui.js. */
function wireDom(doc) {
  return {
    input: doc._elements['answer-input'],
    symbolBar: doc._elements['symbol-bar'],
    // Touches d'insertion, dans l'ordre de index.html: + - ( ) puis 0 a 9.
    keys: doc._insertKeys || [],
    // Touches d'indice et d'exposant: sub puis sup
    scriptKeys: doc._scriptKeys || [],
    /**
     * Retrouve une touche par ce qu'elle insere. Les tests s'y referent par
     * valeur et non par indice: ajouter une touche ne doit pas les
     * decaler tous, ni les obliger a recompter l'ordre du HTML.
     */
    key: (value) => (doc._insertKeys || []).filter((k) => k.dataset.insert === value)[0],
  };
}

/** Environnement global minimal. */
function createWindow(doc) {
  return {
    document: doc,
    visualViewport: createViewport(doc),
    navigator: {
      userAgent: 'stub',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      serviceWorker: undefined,
    },
    localStorage: {
      _data: {},
      getItem(key) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
      setItem(key, value) { this._data[key] = String(value); },
    },
    matchMedia: (query) => ({ matches: false, media: query }),
    addEventListener: () => {},
    location: { protocol: 'file:', hostname: '', href: '' },
    fetch: () => Promise.reject(new Error('aucun reseau dans le stub')),
    Audio: function FakeAudio(src) {
      this.src = src;
      this.loop = false;
      this.volume = 0;
      this.preload = '';
      this.paused = true;
      this.play = () => { this.paused = false; return Promise.resolve(); };
      this.pause = () => { this.paused = true; };
    },
    AudioContext: undefined,
    console: { warn: () => {}, error: () => {}, log: () => {} },
  };
}
