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
    // Metriques de defilement, a zero par defaut.
    //
    // Le stub ne calcule aucune mise en page, donc il ne PEUT pas deduire une
    // hauteur de contenu. Zero signifie "je ne sais pas", et
    // `mesurerDebordement()` interpretsortie la dessus comme un ecran muet --
    // le cas normal, celui ou rien ne deborde.
    //
    // Un test qui veut verifier l'affichage les pose lui-meme. C'est la seule
    // facon honnete de simuler un telephone trop petit: personne ne calcule
    // vraiment ces deux nombres ici, donc un stub qui les deduirait en
    // inventerait une hauteur -- et le test passerait sur un chiffre que rien
    // n'a mesure, ce qui est precisement le defaut que la fonction de mesure
    // est venue corriger.
    clientHeight: 0,
    scrollHeight: 0,
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
    removeAttribute(name) { delete this.attrs[name]; },
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
    // Meme construction de charge utile que pour un element: `preventDefault`
    // et `stopPropagation` doivent exister, sinon un ecouteur pose sur le
    // document qui les appelle echouerait dans le harnais et passerait sur
    // l'appareil -- ou l'inverse, et le second cas est le piege.
    fire(type, event) {
      const payload = Object.assign({
        type,
        target: doc,
        defaultPrevented: false,
        preventDefault() { payload.defaultPrevented = true; },
        stopPropagation() { payload.propagationStopped = true; },
      }, event || {});
      doc.lastEvent = payload;
      for (const fn of doc._listeners[type] || []) fn(payload);
      return payload;
    },
    getElementById(id) {
      if (!doc._elements[id]) doc._elements[id] = makeElement('div', id, doc);
      return doc._elements[id];
    },
    querySelector(selector) {
      if (selector === 'meta[name="app-version"]') return doc._metaVersion;
      return null;
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

  // Le `<meta name="app-version">` est lu DANS le vrai index.html, comme le
  // reste du balisage. Le test verifie donc le numero reellement publie, pas
  // une constante de la Stub -- et si la metaque oubliee, le test le voit.
  const appVersion = (html.match(/<meta name="app-version" content="([^"]*)"/) || [])[1];
  const metaVersion = makeElement('meta', '', doc);
  metaVersion.content = appVersion === undefined ? '' : appVersion;
  doc._metaVersion = metaVersion;

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

  // Les deux boutons d'action sont enfants de la ZONE D'ACTION, elle-meme
  // enfant de la coque. Ils ne sont donc PAS dans #screen-quiz -- et c'est
  // exactement pour ca qu'ils ont besoin de leur propre parade `pointerdown`.
  //
  // Ce lien est donc une fidelite, pas un detail. Il avait ete code
  // `button._parent = quizScreen`, et l'assertion "Valider bloque la prise de
  // focus" est restee verte quand le markup avait change: la parade du quiz
  // la satisfait par un chemin qui n'existe plus sur l'appareil. Les deux
  // listeners etaient alors dans le harnais, un seul sur la page, et rien ne
  // pouvait le dire.
  const actions = doc._elements['actions'];
  if (actions) {
    for (const name of ['validate-button', 'next-button']) {
      const button = doc._elements[name];
      if (!button) continue;
      button._parent = actions;
      // Comme les touches de la barre: un bouton se reconnait lui-meme a
      // `closest()`, sinon la parade de ui.js ne le verrait jamais.
      button.closest = (selector) => (selector === 'button' ? button : null);
    }
    // La zone d'action remonte jusqu'au document, comme dans un vrai DOM. Le
    // `<main class="shell">` et `<body>` intermediaires sont sautes: seul le
    // dernier relai compte, et c'est deja ce qui est fait pour l'ecran de
    // quiz et pour le champ.
    actions._parent = doc;
  }

  // L'ecran de quiz remonte jusqu'au document, comme dans un vrai DOM. Sans
  // ce lien, un `keydown` pose sur un bouton n'atteindrait pas une ecoute
  // posee sur le document -- et le garde-fou qui laisse un bouton focus a son
  // propre clic ne serait jamais exerce.
  const quizScreen = doc._elements['screen-quiz'];
  if (quizScreen) quizScreen._parent = doc;

  // Le champ de reponse remonte jusqu'au document.
  //
  // Dans un vrai DOM, un `keydown` sur le champ remonte aussi jusqu'a
  // `document`. Sans ce lien, une ecoute posee sur le document -- le filet de
  // securite quand le clavier a vole le focus -- ne serait jamais exercee par
  // les tests, et le harnais validerait une mechanique qui n'a jamais tourne.
  //
  // Rendre la propagation fidele a aussi un effet utile: les deux chemins
  // d'ecoute de la touche retour se declenchent alors sur la MEME pression,
  // exactement comme sur l'appareil. Leur exclusion mutuelle devient donc
  // verifiable, au lieu d'etre une clause de style.
  if (doc._elements['answer-input']) doc._elements['answer-input']._parent = doc;

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
    // Hauteur de la fenetre, hors clavier: c'est la reference contre laquelle
    // syncViewport() deduit qu'un clavier est ouvert. Suit le viewport, donc
    // le navigateur seul le retrecit, pas la vue visuelle.
    innerHeight: 844,
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
