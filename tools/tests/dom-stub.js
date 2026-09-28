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
    placeholder: '',
    dataset: {},
    attrs: {},
    children: [],
    selectionStart: 0,
    selectionEnd: 0,
    focused: 0,
    blurred: 0,
    _listeners: {},

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
    /** Declenche les ecouteurs; retient le dernier evenement pour inspection. */
    fire(type, event) {
      const payload = Object.assign({
        type,
        target: this,
        preventDefault() { payload.defaultPrevented = true; },
        stopPropagation() {},
      }, event || {});
      this.lastEvent = payload;
      for (const fn of this._listeners[type] || []) fn(payload);
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

    // L'ordre suit index.html: c'est l'ordre des touches sur l'ecran, et les
    // tests s'y referent par indice.
    doc._insertKeys = ['+', '-', '(', ')'].map((value) => makeKey({ insert: value }));
    doc._scriptKeys = ['sub', 'sup'].map((value) => makeKey({ script: value }));

    symbolBar.querySelectorAll = (selector) => {
      if (selector === '[data-insert]') return doc._insertKeys;
      if (selector === '[data-script]') return doc._scriptKeys;
      return [];
    };
  }

  return doc;
}

/** References pratiques, posees par createDocument avant le chargement de ui.js. */
function wireDom(doc) {
  return {
    input: doc._elements['answer-input'],
    symbolBar: doc._elements['symbol-bar'],
    // Touches d'insertion, dans l'ordre de index.html: + - ( )
    keys: doc._insertKeys || [],
    // Touches d'indice et d'exposant: sub puis sup
    scriptKeys: doc._scriptKeys || [],
  };
}

/** Environnement global minimal. */
function createWindow(doc) {
  return {
    document: doc,
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
