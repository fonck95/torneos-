/*
 * Interfaz de Torneos.
 * Todo el estado vive en un objeto que se guarda completo en localStorage
 * después de cada cambio, así que al recargar la página sigue donde quedó.
 */
(function () {
  'use strict';

  const T = window.Torneo;
  const STORAGE_KEY = 'torneos:v1';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const ICONS = {
    edit: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 14.5V17h2.5l8-8-2.5-2.5-8 8zM15.7 6.8a.9.9 0 0 0 0-1.3l-1.2-1.2a.9.9 0 0 0-1.3 0l-1 1 2.5 2.5 1-1z" fill="currentColor"/></svg>',
    trash: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 3h5l.6 1.5H16v1.6H4V4.5h2.9L7.5 3zM5.2 7.2h9.6l-.7 9.1a1.5 1.5 0 0 1-1.5 1.4H7.4a1.5 1.5 0 0 1-1.5-1.4l-.7-9.1zm3 1.8v6.6h1.4V9H8.2zm2.2 0v6.6h1.4V9h-1.4z" fill="currentColor"/></svg>',
    x: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.6 4.4 10 8.8l4.4-4.4 1.2 1.2L11.2 10l4.4 4.4-1.2 1.2L10 11.2l-4.4 4.4-1.2-1.2L8.8 10 4.4 5.6z" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8.2 13.6-3.6-3.6-1.3 1.3 4.9 4.9 9-9-1.3-1.3z" fill="currentColor"/></svg>',
    trophy: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M20 6h24v16c0 7.7-5.4 14-12 14s-12-6.3-12-14V6z" fill="currentColor"/><path d="M20 11h-9v5c0 6.5 4.6 11 11 11.5M44 11h9v5c0 6.5-4.6 11-11 11.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M28.5 35h7v9h-7z" fill="currentColor"/><path d="M21 58v-5c0-4 4-7 11-7s11 3 11 7v5z" fill="currentColor"/></svg>',
  };

  const EXAMPLES = [
    ['Los Halcones', ['Ana', 'Bruno', 'Carla']],
    ['Tiburones FC', ['Diego', 'Elena', 'Fabián']],
    ['Rayos del Sur', ['Gabriela', 'Hugo', 'Inés']],
    ['Club Atlas', ['Javier', 'Karen', 'Luis']],
    ['Pumas Dorados', ['Mariana', 'Nicolás', 'Olga']],
    ['Leones Azules', ['Pablo', 'Quique', 'Rosa']],
  ];

  function exampleTeams() {
    return EXAMPLES.map(([name, members], i) => ({
      id: T.uid('e'), name, members: members.slice(), color: T.TEAM_COLORS[i], example: true,
    }));
  }

  // ---------------------------------------------------------------------------
  // Almacenamiento en el navegador
  // ---------------------------------------------------------------------------

  const storage = {
    ok: true,
    lastSaved: null,
    read() {
      let raw;
      try {
        raw = window.localStorage.getItem(STORAGE_KEY);
      } catch (e) {
        this.ok = false;
        return { data: null };
      }
      if (!raw) return { data: null };
      try {
        return { data: JSON.parse(raw) };
      } catch (e) {
        return { data: null, corrupt: true };
      }
    },
    write(data) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        this.ok = true;
        this.lastSaved = new Date();
      } catch (e) {
        this.ok = false;
      }
      return this.ok;
    },
  };

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------

  let state = null;
  const ui = {
    draft: newDraft(),
    view: 'auto', // con el torneo terminado: 'champion' o 'bracket'
    mounted: null,
    notice: null,
  };

  function newDraft() {
    return { id: null, members: [] };
  }

  function teamById(id) {
    return (id && state.teams.find((t) => t.id === id)) || null;
  }

  /** Guarda el campeón del torneo actual en el palmarés (o lo quita si se corrigió la final). */
  function syncHistory() {
    const id = state.tournament.id;
    const existing = state.history.find((h) => h.id === id);
    state.history = state.history.filter((h) => h.id !== id);
    const champ = teamById(T.championOf(state.bracket));
    if (!champ) return;
    const runner = teamById(T.runnerUpOf(state.bracket));
    state.history.unshift({
      id,
      name: state.tournament.name,
      date: existing ? existing.date : new Date().toISOString(),
      champion: { name: champ.name, color: champ.color, members: champ.members.slice() },
      runnerUp: runner ? runner.name : '',
      teams: state.teams.length,
    });
    state.history = state.history.slice(0, 50);
  }

  function persist() {
    syncHistory();
    storage.write(state);
    renderFooter();
    renderBanner();
  }

  // ---------------------------------------------------------------------------
  // Diálogos
  // ---------------------------------------------------------------------------

  const modalState = { onClose: null, result: undefined, ignoreNextClose: false };

  function modalEl() {
    return $('#modal');
  }

  function finishModal() {
    const cb = modalState.onClose;
    const result = modalState.result;
    modalState.onClose = null;
    modalState.result = undefined;
    if (cb) cb(result);
  }

  function openModal(html, opts) {
    const options = opts || {};
    const el = modalEl();
    if (el.open) finishModal();
    el.className = 'modal' + (options.size ? ' modal-' + options.size : '');
    el.innerHTML = '<div class="modal-body">' + html + '</div>';
    modalState.onClose = options.onClose || null;
    if (!el.open) {
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    }
    if (options.focus !== false) {
      const focusTarget = $('[autofocus]', el) || $('input:not([type=hidden]):not([readonly]), select, textarea:not([readonly])', el);
      if (focusTarget) focusTarget.focus();
    }
    el.scrollTop = 0;
    return el;
  }

  function closeModal(result) {
    const el = modalEl();
    modalState.result = result;
    if (el.open) {
      if (typeof el.close === 'function') {
        modalState.ignoreNextClose = true;
        el.close();
      } else {
        el.removeAttribute('open');
      }
    }
    finishModal();
  }

  function confirmDialog(opts) {
    return new Promise((resolve) => {
      openModal(
        '<div class="confirm">' +
          '<h2 id="modal-title">' + esc(opts.title) + '</h2>' +
          '<p>' + esc(opts.message) + '</p>' +
          '<div class="modal-actions"><span class="spacer"></span>' +
            '<button type="button" class="btn btn-ghost" data-modal="cancel">Cancelar</button>' +
            '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-modal="ok" autofocus>' + esc(opts.confirmLabel || 'Confirmar') + '</button>' +
          '</div>' +
        '</div>',
        { size: 'sm', onClose: (r) => resolve(r === true) }
      );
    });
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    const host = modalEl().open ? modalEl() : document.body;
    $$('.toast').forEach((t) => t.remove());
    host.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  // ---------------------------------------------------------------------------
  // Piezas reutilizables
  // ---------------------------------------------------------------------------

  function badge(team, size) {
    if (!team) return '<span class="badge badge-empty' + (size ? ' badge-' + size : '') + '" aria-hidden="true"></span>';
    return '<span class="badge' + (size ? ' badge-' + size : '') + '" style="--team:' + esc(team.color) + '" aria-hidden="true">' + esc(T.initials(team.name)) + '</span>';
  }

  function roundLabel(r) {
    return T.roundName(state.bracket.rounds[r].length, r);
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    try {
      return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    } catch (e) {
      return d.toLocaleDateString();
    }
  }

  function fmtTime(d) {
    try {
      return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(d);
    } catch (e) {
      return d.toLocaleTimeString();
    }
  }

  function historyPanel() {
    if (!state.history.length) return '';
    const items = state.history.map((h) =>
      '<li class="history-item">' +
        '<span class="badge" style="--team:' + esc(h.champion.color) + '" aria-hidden="true">' + esc(T.initials(h.champion.name)) + '</span>' +
        '<div class="history-text">' +
          '<strong>' + esc(h.champion.name) + '</strong>' +
          '<span>' + esc(h.name) + ' · ' + esc(fmtDate(h.date)) + (h.teams ? ' · ' + plural(h.teams, 'equipo', 'equipos') : '') +
          (h.runnerUp ? ' · subcampeón: ' + esc(h.runnerUp) : '') + '</span>' +
        '</div>' +
      '</li>'
    ).join('');
    return '<section class="panel history" aria-labelledby="history-title">' +
      '<div class="section-head"><h2 id="history-title">Palmarés</h2><p class="muted">Campeones guardados en este navegador</p></div>' +
      '<ol class="history-list">' + items + '</ol>' +
    '</section>';
  }

  // ---------------------------------------------------------------------------
  // Render general
  // ---------------------------------------------------------------------------

  function currentViewKey() {
    const phase = T.phaseOf(state);
    if (phase === 'setup') return 'setup';
    if (phase === 'playing') return 'bracket';
    return ui.view === 'bracket' ? 'bracket' : 'champion';
  }

  function render() {
    const phase = T.phaseOf(state);
    const key = currentViewKey();
    renderHeader(phase);
    renderBanner();
    if (key === 'setup') {
      if (ui.mounted !== 'setup') mountSetup();
      updateSetup();
    } else if (key === 'bracket') {
      mountBracket(phase);
    } else {
      mountChampion();
    }
    ui.mounted = key;
    renderFooter();
  }

  function renderHeader(phase) {
    const input = $('#tournament-name');
    if (document.activeElement !== input) input.value = state.tournament.name;
    const order = ['setup', 'playing', 'finished'];
    const idx = order.indexOf(phase);
    $$('#stepper li').forEach((li, i) => {
      li.classList.toggle('is-current', i === idx);
      li.classList.toggle('is-done', i < idx);
      if (i === idx) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
  }

  function renderBanner() {
    const parts = [];
    if (!storage.ok) {
      parts.push(
        '<div class="banner banner-warn" role="alert"><p><strong>No se pudo guardar.</strong> Este navegador está bloqueando el almacenamiento local (por ejemplo, en una ventana privada). Puedes seguir usando la app, pero los datos se perderán al cerrar la página. Usa «Datos → Exportar copia» para no perderlos.</p></div>'
      );
    }
    if (ui.notice === 'corrupt') {
      parts.push(
        '<div class="banner banner-warn"><p><strong>Los datos guardados estaban dañados</strong> y no se pudieron leer, así que empezamos de cero.</p><div class="banner-actions"><button type="button" class="btn btn-sm btn-ghost" data-action="dismiss-notice">Entendido</button></div></div>'
      );
    }
    if (state.flags.exampleBanner && T.phaseOf(state) === 'setup') {
      parts.push(
        '<div class="banner"><p><strong>Equipos de ejemplo.</strong> Cargamos ' + EXAMPLES.length + ' equipos para que pruebes el sorteo. Edítalos, bórralos o agrega los tuyos.</p>' +
        '<div class="banner-actions"><button type="button" class="btn btn-sm" data-action="remove-examples">Quitar ejemplos</button><button type="button" class="btn btn-sm btn-ghost" data-action="dismiss-examples">Entendido</button></div></div>'
      );
    }
    $('#banner').innerHTML = parts.join('');
  }

  function renderFooter() {
    const el = $('#save-status');
    el.classList.toggle('is-error', !storage.ok);
    if (!storage.ok) el.textContent = 'Sin guardar: el almacenamiento de este navegador no está disponible.';
    else if (storage.lastSaved) el.textContent = 'Guardado en este navegador a las ' + fmtTime(storage.lastSaved) + '.';
  }

  // ---------------------------------------------------------------------------
  // Etapa 1: equipos
  // ---------------------------------------------------------------------------

  function mountSetup() {
    ui.draft = newDraft();
    $('#view').innerHTML =
      '<section class="setup" aria-label="Inscripción de equipos">' +
        '<div class="summary-strip" id="draw-bar"></div>' +
        '<div class="setup-grid">' +
          '<form id="team-form" class="panel team-form" novalidate>' +
            '<div class="panel-head"><h2 id="form-title">Nuevo equipo</h2></div>' +
            '<div class="field">' +
              '<label for="team-name">Nombre del equipo</label>' +
              '<input id="team-name" name="team-name" type="text" maxlength="' + T.MAX_NAME + '" autocomplete="off" placeholder="Ej.: Los Halcones">' +
            '</div>' +
            '<div class="field">' +
              '<label for="member-input">Integrantes <span class="label-count" id="member-count"></span></label>' +
              '<div class="inline-input">' +
                '<input id="member-input" name="member-input" type="text" maxlength="200" autocomplete="off" placeholder="Nombre del integrante">' +
                '<button type="button" class="btn" data-action="add-member">Agregar</button>' +
              '</div>' +
              '<p class="hint">Pulsa Enter para agregar. Puedes pegar varios nombres separados por comas.</p>' +
            '</div>' +
            '<ul id="member-chips" class="chips" aria-label="Integrantes del equipo"></ul>' +
            '<p id="form-note" class="note" hidden></p>' +
            '<p id="form-error" class="error" role="alert" hidden></p>' +
            '<div class="form-actions">' +
              '<button type="submit" class="btn btn-primary" id="team-submit">Agregar equipo</button>' +
              '<button type="button" class="btn btn-ghost" data-action="cancel-edit" id="cancel-edit" hidden>Cancelar</button>' +
            '</div>' +
          '</form>' +
          '<div class="teams-col">' +
            '<div class="section-head"><h2>Equipos inscritos <span id="team-count" class="count">0</span></h2></div>' +
            '<div id="team-list" class="team-grid"></div>' +
          '</div>' +
        '</div>' +
        '<div id="setup-history"></div>' +
      '</section>';
  }

  function updateSetup() {
    refreshDraftUi();
    refreshChips();
    refreshTeams();
    refreshDrawBar();
    $('#setup-history').innerHTML = historyPanel();
  }

  function refreshDraftUi() {
    const editing = !!ui.draft.id;
    $('#form-title').textContent = editing ? 'Editar equipo' : 'Nuevo equipo';
    $('#team-submit').textContent = editing ? 'Guardar cambios' : 'Agregar equipo';
    $('#cancel-edit').hidden = !editing;
  }

  function refreshChips() {
    const ul = $('#member-chips');
    const list = ui.draft.members;
    ul.innerHTML = list.length
      ? list.map((m, i) =>
          '<li class="chip"><span>' + esc(m) + '</span>' +
          '<button type="button" class="chip-x" data-action="remove-member" data-index="' + i + '" aria-label="Quitar a ' + esc(m) + '">' + ICONS.x + '</button></li>'
        ).join('')
      : '<li class="chip-empty">Todavía no hay integrantes.</li>';
    $('#member-count').textContent = list.length ? '(' + list.length + ')' : '';
  }

  function setFormMessage(kind, text) {
    const err = $('#form-error');
    const note = $('#form-note');
    if (!err) return;
    err.hidden = !(kind === 'error' && text);
    note.hidden = !(kind === 'note' && text);
    if (kind === 'error') err.textContent = text || '';
    if (kind === 'note') note.textContent = text || '';
    if (!kind) {
      err.hidden = true;
      note.hidden = true;
    }
  }

  function teamCard(t) {
    const editing = ui.draft.id === t.id;
    return '<article class="team-card' + (editing ? ' is-editing' : '') + '">' +
      '<div class="team-card-head">' +
        badge(t) +
        '<div class="team-card-title"><h3>' + esc(t.name) + '</h3>' +
          '<p class="meta">' + plural(t.members.length, 'integrante', 'integrantes') + (editing ? ' · editando' : '') + '</p></div>' +
        '<div class="card-actions">' +
          '<button type="button" class="icon-btn" data-action="edit-team" data-id="' + esc(t.id) + '" aria-label="Editar ' + esc(t.name) + '" title="Editar">' + ICONS.edit + '</button>' +
          '<button type="button" class="icon-btn icon-btn-danger" data-action="delete-team" data-id="' + esc(t.id) + '" aria-label="Eliminar ' + esc(t.name) + '" title="Eliminar">' + ICONS.trash + '</button>' +
        '</div>' +
      '</div>' +
      '<ul class="member-list" aria-label="Integrantes de ' + esc(t.name) + '">' + t.members.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul>' +
    '</article>';
  }

  function refreshTeams() {
    $('#team-count').textContent = state.teams.length;
    $('#team-list').innerHTML = state.teams.length
      ? state.teams.map(teamCard).join('')
      : '<div class="empty-state"><p><strong>Todavía no hay equipos.</strong><br>Crea el primero con el formulario o carga unos de ejemplo para probar.</p>' +
        '<button type="button" class="btn" data-action="load-examples">Cargar equipos de ejemplo</button></div>';
  }

  function refreshDrawBar() {
    const n = state.teams.length;
    const s = T.bracketStats(n);
    let msg;
    if (n === 0) msg = 'Inscribe al menos 2 equipos para hacer el sorteo.';
    else if (n === 1) msg = 'Falta 1 equipo más para poder hacer el sorteo.';
    else {
      msg = 'Etapas: <strong>' + s.stages.map(esc).join(' → ') + '</strong>.';
      if (s.byes) {
        msg += ' Para que los cruces cuadren, el sorteo dará pase directo a ' +
          (s.byes === 1 ? '1 equipo' : s.byes + ' equipos') + ' hasta ' + (s.stages[1] === 'Final' ? 'la ' : '') + esc(s.stages[1]) + '.';
      }
    }
    const stat = (num, label) => '<div class="stat"><span class="stat-num">' + num + '</span><span class="stat-label">' + label + '</span></div>';
    $('#draw-bar').innerHTML =
      '<div class="stats" aria-label="Resumen del torneo">' +
        stat(n, 'Equipos') + stat(s.matches, 'Partidos') + stat(s.rounds, 'Etapas') + stat(s.byes, 'Pases directos') +
      '</div>' +
      '<p class="summary-text">' + msg + '</p>' +
      '<button type="button" class="btn btn-primary btn-lg" data-action="draw"' + (n < 2 ? ' disabled' : '') + '>Realizar sorteo</button>';
  }

  function addMember() {
    const input = $('#member-input');
    const names = input.value.split(/[,;\n]/).map(T.cleanName).filter(Boolean);
    if (!names.length) {
      setFormMessage('error', 'Escribe el nombre del integrante.');
      input.focus();
      return false;
    }
    const errors = [];
    const notes = [];
    for (const raw of names) {
      const name = raw.slice(0, T.MAX_NAME);
      if (ui.draft.members.length >= T.MAX_MEMBERS) {
        errors.push('Un equipo admite hasta ' + T.MAX_MEMBERS + ' integrantes.');
        break;
      }
      if (ui.draft.members.some((m) => T.sameName(m, name))) {
        errors.push('«' + name + '» ya está en este equipo.');
        continue;
      }
      const other = state.teams.find((t) => t.id !== ui.draft.id && t.members.some((m) => T.sameName(m, name)));
      if (other) notes.push('«' + name + '» también está en ' + other.name + '.');
      ui.draft.members.push(name);
    }
    input.value = '';
    refreshChips();
    if (errors.length) setFormMessage('error', errors.join(' '));
    else if (notes.length) setFormMessage('note', notes.join(' ') + ' Si es otra persona con el mismo nombre, puedes dejarlo así.');
    else setFormMessage(null);
    input.focus();
    return !errors.length;
  }

  function saveTeam() {
    const memberInput = $('#member-input');
    if (memberInput.value.trim() && !addMember()) return;
    const result = T.validateTeam({ name: $('#team-name').value, members: ui.draft.members }, state.teams, ui.draft.id);
    if (result.errors.length) {
      setFormMessage('error', result.errors.join(' '));
      (result.value.name ? memberInput : $('#team-name')).focus();
      return;
    }
    const { name, members } = result.value;
    let message;
    if (ui.draft.id) {
      const t = teamById(ui.draft.id);
      t.name = name;
      t.members = members;
      t.example = false;
      message = 'Cambios guardados en ' + name + '.';
    } else {
      state.teams.push({ id: T.uid('e'), name, members, color: T.pickColor(state.teams), example: false });
      message = name + ' quedó inscrito.';
    }
    if (!state.teams.some((t) => t.example)) state.flags.exampleBanner = false;
    resetDraft();
    persist();
    render();
    toast(message);
    $('#team-name').focus();
  }

  function resetDraft() {
    ui.draft = newDraft();
    const name = $('#team-name');
    if (name) {
      name.value = '';
      $('#member-input').value = '';
      setFormMessage(null);
      refreshDraftUi();
      refreshChips();
      refreshTeams();
    }
  }

  function startEdit(id) {
    const t = teamById(id);
    if (!t) return;
    ui.draft = { id: t.id, members: t.members.slice() };
    $('#team-name').value = t.name;
    $('#member-input').value = '';
    setFormMessage(null);
    refreshDraftUi();
    refreshChips();
    refreshTeams();
    const form = $('#team-form');
    if (form.getBoundingClientRect().top < 0 || window.innerWidth < 860) {
      form.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    }
    $('#team-name').focus({ preventScroll: true });
  }

  async function deleteTeam(id) {
    const t = teamById(id);
    if (!t) return;
    const ok = await confirmDialog({
      title: '¿Eliminar a ' + t.name + '?',
      message: 'Se borrará el equipo con sus ' + plural(t.members.length, 'integrante', 'integrantes') + '.',
      confirmLabel: 'Eliminar equipo',
      danger: true,
    });
    if (!ok) return;
    state.teams = state.teams.filter((x) => x.id !== id);
    if (ui.draft.id === id) resetDraft();
    if (!state.teams.some((x) => x.example)) state.flags.exampleBanner = false;
    persist();
    render();
    toast(t.name + ' fue eliminado.');
  }

  // ---------------------------------------------------------------------------
  // Sorteo
  // ---------------------------------------------------------------------------

  function doDraw() {
    if (state.teams.length < 2) return;
    state.bracket = T.createBracket(state.teams.map((t) => t.id));
    state.flags.exampleBanner = false;
    ui.view = 'auto';
    ui.mounted = null;
    persist();
    render();
    showDrawCeremony();
  }

  function drawTeam(t) {
    return '<span class="draw-team">' + badge(t, 'sm') + '<span class="draw-name">' + esc(t.name) + '</span></span>';
  }

  function showDrawCeremony() {
    const b = state.bracket;
    const first = b.rounds[0];
    const nextName = b.rounds[1] ? roundLabel(1) : '';
    const items = first.map((m) => {
      if (m.bye) {
        return '<li class="draw-item is-bye">' + drawTeam(teamById(m.a || m.b)) +
          '<span class="draw-bye">Pase directo a ' + esc(nextName) + '</span></li>';
      }
      return '<li class="draw-item">' + drawTeam(teamById(m.a)) + '<span class="draw-vs">vs</span>' + drawTeam(teamById(m.b)) + '</li>';
    });

    let timer = null;
    let spin = null;
    const stop = () => {
      clearTimeout(timer);
      clearInterval(spin);
    };

    const el = openModal(
      '<div class="draw">' +
        '<header class="modal-head"><p class="eyebrow">Sorteo · ' + esc(roundLabel(0)) + '</p><h2 id="modal-title">Así quedan los cruces</h2></header>' +
        '<div class="bombo" id="bombo" aria-hidden="true"><span class="bombo-ball"></span><span class="bombo-name" id="bombo-name">Mezclando…</span></div>' +
        '<ol class="draw-list" id="draw-list">' + items.join('') + '</ol>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn btn-ghost" id="draw-skip">Mostrar todo</button>' +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn btn-primary" data-modal="ok">Ver las llaves</button>' +
        '</div>' +
      '</div>',
      { size: 'lg', onClose: stop }
    );

    const lis = $$('.draw-item', el);
    const nameEl = $('#bombo-name', el);
    const skip = $('#draw-skip', el);
    const names = state.teams.map((t) => t.name);
    const per = Math.max(240, Math.min(720, 5200 / lis.length));
    let i = 0;

    const revealAll = () => {
      stop();
      lis.forEach((li) => { li.hidden = false; });
      nameEl.textContent = '¡Sorteo listo!';
      $('#bombo', el).classList.add('is-done');
      skip.hidden = true;
    };

    const step = () => {
      if (i >= lis.length) {
        revealAll();
        return;
      }
      spin = setInterval(() => {
        nameEl.textContent = names[Math.floor(Math.random() * names.length)];
      }, 70);
      timer = setTimeout(() => {
        clearInterval(spin);
        const m = first[i];
        nameEl.textContent = m.bye
          ? teamById(m.a || m.b).name + ' pasa directo'
          : teamById(m.a).name + ' vs ' + teamById(m.b).name;
        lis[i].hidden = false;
        lis[i].classList.add('is-in');
        lis[i].scrollIntoView({ block: 'nearest' });
        i++;
        timer = setTimeout(step, per * 0.5);
      }, per);
    };

    skip.addEventListener('click', revealAll);
    if (reduceMotion()) revealAll();
    else {
      lis.forEach((li) => { li.hidden = true; });
      step();
    }
  }

  // ---------------------------------------------------------------------------
  // Etapa 2: llaves
  // ---------------------------------------------------------------------------

  function teamRow(m, side) {
    const id = side === 'a' ? m.a : m.b;
    const t = teamById(id);
    if (!t) {
      return '<div class="team-row is-empty">' + badge(null) +
        '<span class="team-name">' + (m.round === 0 ? 'Sin rival' : 'Por definir') + '</span><span class="score"></span></div>';
    }
    const score = side === 'a' ? m.scoreA : m.scoreB;
    const cls = m.winner ? (m.winner === id ? ' is-winner' : ' is-loser') : '';
    return '<div class="team-row' + cls + '">' + badge(t) +
      '<span class="team-name" title="' + esc(t.name + ': ' + t.members.join(', ')) + '">' + esc(t.name) + '</span>' +
      '<span class="score">' + (m.bye || score === null ? '' : score) + '</span></div>';
  }

  function matchFooter(m) {
    if (m.bye) return '<span class="match-status">Pase directo</span>';
    if (m.winner) {
      return '<span class="match-status is-done">' + ICONS.check + (m.decidedBy === 'tiebreak' ? 'Ganó en desempate' : 'Finalizado') + '</span>' +
        (T.canEdit(state.bracket, m) ? '<button type="button" class="link-btn" data-action="open-result" data-id="' + esc(m.id) + '">Corregir</button>' : '');
    }
    if (m.a && m.b) {
      return '<button type="button" class="btn btn-primary btn-sm btn-block" data-action="open-result" data-id="' + esc(m.id) + '">Registrar resultado</button>';
    }
    return '<span class="match-status">Esperando rival</span>';
  }

  function matchCard(m) {
    const status = m.bye ? 'bye' : m.winner ? 'done' : m.a && m.b ? 'ready' : 'waiting';
    return '<article class="match is-' + status + '" aria-label="' + esc(roundLabel(m.round)) + ', partido ' + (m.index + 1) + '">' +
      teamRow(m, 'a') + teamRow(m, 'b') +
      '<div class="match-foot">' + matchFooter(m) + '</div>' +
    '</article>';
  }

  function roundColumn(round, r, current) {
    const p = T.roundProgress(round);
    const pairs = [];
    for (let i = 0; i < round.length; i += 2) pairs.push(round.slice(i, i + 2));
    const meta = p.total + (p.byes ? ' · ' + plural(p.byes, 'pase', 'pases') : '');
    return '<div class="round' + (r === current ? ' is-current' : '') + '" id="round-' + r + '">' +
      '<header class="round-head"><h3>' + esc(T.roundName(round.length, r)) + '</h3>' +
        '<span class="round-meta">' + p.played + '/' + meta + '</span></header>' +
      '<div class="round-body">' +
        pairs.map((pair) =>
          '<div class="pair' + (pair.length === 1 ? ' single' : '') + '">' +
            pair.map((m) => '<div class="slot' + (m.winner ? ' is-done' : '') + '">' + matchCard(m) + '</div>').join('') +
          '</div>'
        ).join('') +
      '</div>' +
    '</div>';
  }

  function championColumn() {
    const champ = teamById(T.championOf(state.bracket));
    return '<div class="round round-champion" id="round-champ">' +
      '<header class="round-head"><h3>Campeón</h3></header>' +
      '<div class="round-body"><div class="pair single"><div class="slot">' +
        '<div class="champ-card' + (champ ? ' is-crowned' : '') + '">' + ICONS.trophy +
          '<span class="champ-card-name">' + (champ ? esc(champ.name) : 'Por definir') + '</span>' +
          (champ ? '<button type="button" class="link-btn" data-action="show-champion">Ver celebración</button>' : '') +
        '</div>' +
      '</div></div></div>' +
    '</div>';
  }

  function rosterPanel() {
    const b = state.bracket;
    const rows = state.teams.map((t) => ({ t, st: T.teamStatus(b, t.id) }));
    const rank = (x) => (x.st.status === 'champion' ? 1000 : x.st.status === 'alive' ? 500 : x.st.round);
    rows.sort((x, y) => rank(y) - rank(x));
    const alive = rows.filter((x) => x.st.status !== 'out').length;
    const items = rows.map(({ t, st }) => {
      const pill = st.status === 'champion'
        ? '<span class="pill pill-champion">Campeón</span>'
        : st.status === 'out'
          ? '<span class="pill pill-out">Eliminado en ' + esc(roundLabel(st.round)) + '</span>'
          : '<span class="pill pill-alive">En carrera</span>';
      return '<li class="roster-item is-' + st.status + '">' + badge(t) +
        '<div class="roster-text"><span class="roster-name">' + esc(t.name) + '</span>' +
        '<span class="roster-members">' + esc(t.members.join(' · ')) + '</span></div>' + pill + '</li>';
    }).join('');
    return '<section class="panel roster" aria-labelledby="roster-title">' +
      '<div class="section-head"><h2 id="roster-title">Equipos</h2><p class="muted">' + alive + ' en carrera · ' + (rows.length - alive) + ' eliminados</p></div>' +
      '<ul class="roster-list">' + items + '</ul>' +
    '</section>';
  }

  function mountBracket(phase) {
    const view = $('#view');
    const b = state.bracket;
    const prevScroller = $('.bracket-scroll', view);
    const prevLeft = ui.mounted === 'bracket' && prevScroller ? prevScroller.scrollLeft : null;
    const current = T.currentRoundIndex(b);
    const played = T.playedCount(b);
    const totalMatches = state.teams.length - 1;
    const pct = totalMatches ? Math.round((played / totalMatches) * 100) : 0;

    let stage;
    if (phase === 'finished') {
      const champ = teamById(T.championOf(b));
      stage =
        '<div class="stage-info"><p class="eyebrow">Torneo finalizado</p>' +
        '<h2 class="stage-name">Campeón: ' + esc(champ.name) + '</h2>' +
        '<p class="stage-meta">Si hubo un error en la final, puedes corregirla desde su tarjeta.</p></div>' +
        '<div class="stage-actions"><button type="button" class="btn btn-primary" data-action="show-champion">Ver campeón</button></div>';
    } else {
      const round = b.rounds[current];
      const p = T.roundProgress(round);
      const alive = state.teams.filter((t) => T.teamStatus(b, t.id).status !== 'out').length;
      stage =
        '<div class="stage-info"><p class="eyebrow">Etapa actual · ' + (current + 1) + ' de ' + b.rounds.length + '</p>' +
        '<h2 class="stage-name">' + esc(roundLabel(current)) + '</h2>' +
        '<p class="stage-meta">' + p.played + ' de ' + plural(p.total, 'partido jugado', 'partidos jugados') + ' · ' + alive + ' equipos siguen en carrera</p></div>' +
        '<div class="stage-progress">' +
          '<div class="meter" role="progressbar" aria-label="Avance del torneo" aria-valuemin="0" aria-valuemax="' + totalMatches + '" aria-valuenow="' + played + '"><span style="width:' + pct + '%"></span></div>' +
          '<p class="meter-label"><span class="num">' + played + '/' + totalMatches + '</span> partidos del torneo</p>' +
        '</div>' +
        '<div class="stage-actions">' +
          (!T.hasResults(b) ? '<button type="button" class="btn" data-action="redraw">Repetir sorteo</button>' : '') +
          '<button type="button" class="btn" data-action="back-to-teams">Editar equipos</button>' +
        '</div>';
    }

    const chips = b.rounds.map((round, r) => {
      const p = T.roundProgress(round);
      const done = p.played === p.total;
      return '<button type="button" class="round-chip' + (r === current ? ' is-current' : '') + (done ? ' is-done' : '') + '" data-action="goto-round" data-round="' + r + '">' +
        (done ? ICONS.check : '') + esc(T.roundName(round.length, r)) + '</button>';
    }).join('') +
      '<button type="button" class="round-chip' + (phase === 'finished' ? ' is-done' : '') + '" data-action="goto-round" data-round="champ">' + (phase === 'finished' ? ICONS.check : '') + 'Campeón</button>';

    view.innerHTML =
      '<section class="playing" aria-label="Llaves del torneo">' +
        '<div class="stage-bar on-board">' + stage + '</div>' +
        '<nav class="round-nav" aria-label="Ir a una etapa">' + chips + '</nav>' +
        '<div class="bracket-scroll" tabindex="0" aria-label="Cuadro del torneo, se desplaza horizontalmente">' +
          '<div class="bracket">' + b.rounds.map((round, r) => roundColumn(round, r, current)).join('') + championColumn() + '</div>' +
        '</div>' +
        rosterPanel() +
      '</section>';

    const scroller = $('.bracket-scroll', view);
    if (prevLeft !== null) scroller.scrollLeft = prevLeft;
    else {
      const col = $(current >= 0 ? '#round-' + current : '#round-champ', view);
      if (col && current > 0) scroller.scrollLeft = Math.max(0, col.offsetLeft - 20);
      else if (current < 0 && col) scroller.scrollLeft = scroller.scrollWidth;
    }
  }

  function gotoRound(key) {
    const scroller = $('.bracket-scroll');
    const col = $(key === 'champ' ? '#round-champ' : '#round-' + key);
    if (!scroller || !col) return;
    scroller.scrollTo({ left: Math.max(0, col.offsetLeft - 20), behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  // ---------------------------------------------------------------------------
  // Resultado de un partido
  // ---------------------------------------------------------------------------

  function openResult(matchId) {
    const b = state.bracket;
    const m = T.findMatch(b, matchId);
    if (!m || m.bye || !m.a || !m.b) return;
    if (!T.canEdit(b, m)) {
      toast('El partido siguiente ya tiene resultado. Corrígelo primero.');
      return;
    }
    const A = teamById(m.a);
    const B = teamById(m.b);
    const editing = !!m.winner;
    const isFinal = m.round === b.rounds.length - 1;

    const side = (t, key, value) =>
      '<div class="side" id="side-' + key + '">' +
        badge(t, 'lg') +
        '<h3 class="side-name">' + esc(t.name) + '</h3>' +
        '<p class="side-members">' + esc(t.members.join(' · ')) + '</p>' +
        '<div class="score-input">' +
          '<button type="button" class="step-btn" data-step="' + key + '" data-delta="-1" aria-label="Restar un punto a ' + esc(t.name) + '">−</button>' +
          '<input id="score-' + key + '" name="score-' + key + '" type="number" inputmode="numeric" min="0" max="' + T.MAX_SCORE + '" step="1" value="' + value + '" aria-label="Marcador de ' + esc(t.name) + '">' +
          '<button type="button" class="step-btn" data-step="' + key + '" data-delta="1" aria-label="Sumar un punto a ' + esc(t.name) + '">+</button>' +
        '</div>' +
      '</div>';

    const pick = m.decidedBy === 'tiebreak' ? (m.winner === m.a ? 'a' : 'b') : '';
    const el = openModal(
      '<form class="result-form" id="result-form" novalidate>' +
        '<header class="modal-head"><p class="eyebrow">' + esc(roundLabel(m.round)) + (isFinal ? '' : ' · Partido ' + (m.index + 1)) + '</p>' +
          '<h2 id="modal-title">' + (editing ? 'Corregir resultado' : 'Registrar resultado') + '</h2></header>' +
        '<div class="versus">' + side(A, 'a', m.scoreA === null ? 0 : m.scoreA) + '<span class="vs" aria-hidden="true">vs</span>' + side(B, 'b', m.scoreB === null ? 0 : m.scoreB) + '</div>' +
        '<fieldset class="tiebreak" id="tiebreak" hidden>' +
          '<legend>Hay empate. ¿Qué equipo avanza?</legend>' +
          '<div class="tiebreak-options">' +
            '<label class="pick"><input type="radio" name="pick" value="a"' + (pick === 'a' ? ' checked' : '') + '><span>' + esc(A.name) + '</span></label>' +
            '<label class="pick"><input type="radio" name="pick" value="b"' + (pick === 'b' ? ' checked' : '') + '><span>' + esc(B.name) + '</span></label>' +
          '</div>' +
          '<p class="hint">Defínanlo como prefieran: penales, muerte súbita, una moneda…</p>' +
        '</fieldset>' +
        '<p class="verdict" id="verdict" aria-live="polite"></p>' +
        '<p class="error" id="result-error" role="alert" hidden></p>' +
        '<footer class="modal-actions">' +
          (editing ? '<button type="button" class="btn btn-ghost btn-danger-text" id="clear-result">Borrar resultado</button>' : '') +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn btn-ghost" data-modal="cancel">Cancelar</button>' +
          '<button type="submit" class="btn btn-primary">' + (isFinal ? 'Confirmar y coronar' : 'Confirmar resultado') + '</button>' +
        '</footer>' +
      '</form>'
    );

    const form = $('#result-form', el);
    const inA = $('#score-a', el);
    const inB = $('#score-b', el);
    const errEl = $('#result-error', el);
    const pickValue = () => {
      const r = $('input[name="pick"]:checked', el);
      return r ? r.value : '';
    };

    const update = () => {
      const sa = T.toScore(inA.value);
      const sb = T.toScore(inB.value);
      const valid = sa !== null && sb !== null;
      const tie = valid && sa === sb;
      $('#tiebreak', el).hidden = !tie;
      $('#side-a', el).classList.toggle('is-ahead', valid && (sa > sb || (tie && pickValue() === 'a')));
      $('#side-b', el).classList.toggle('is-ahead', valid && (sb > sa || (tie && pickValue() === 'b')));
      const verdict = $('#verdict', el);
      if (!valid) verdict.textContent = 'Escribe un número entero desde 0 en cada marcador.';
      else if (tie) {
        const p = pickValue();
        verdict.textContent = p ? 'Avanza ' + (p === 'a' ? A.name : B.name) + ' por desempate.' : 'Marcador empatado: elige quién avanza.';
      } else verdict.textContent = (isFinal ? 'Campeón: ' : 'Avanza ') + (sa > sb ? A.name : B.name) + '.';
      errEl.hidden = true;
    };

    form.addEventListener('input', update);
    form.addEventListener('change', update);
    $$('.step-btn', el).forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = btn.dataset.step === 'a' ? inA : inB;
        const cur = T.toScore(input.value) || 0;
        input.value = Math.min(T.MAX_SCORE, Math.max(0, cur + Number(btn.dataset.delta)));
        update();
      });
    });
    [inA, inB].forEach((input) => input.addEventListener('focus', () => input.select()));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = pickValue();
      try {
        T.setResult(b, m.id, { scoreA: inA.value, scoreB: inB.value, winner: p === 'a' ? m.a : p === 'b' ? m.b : null });
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        return;
      }
      const winner = teamById(m.winner);
      persist();
      closeModal(true);
      if (isFinal) {
        ui.view = 'champion';
        render();
        celebrate(winner.color);
        window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
      } else {
        render();
        const next = T.currentRoundIndex(b);
        if (next > m.round && T.roundProgress(b.rounds[m.round]).played === T.roundProgress(b.rounds[m.round]).total) {
          toast(roundLabel(m.round) + ' completa. Sigue: ' + roundLabel(next) + '.');
          gotoRound(next);
        } else {
          toast('Avanza ' + winner.name + '.');
        }
      }
    });

    const clearBtn = $('#clear-result', el);
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (clearBtn.dataset.armed !== '1') {
          clearBtn.dataset.armed = '1';
          clearBtn.textContent = 'Pulsa otra vez para borrar';
          return;
        }
        try {
          T.clearResult(b, m.id);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          return;
        }
        ui.view = 'auto';
        persist();
        closeModal(false);
        render();
        toast('Resultado borrado.');
      });
    }

    update();
  }

  // ---------------------------------------------------------------------------
  // Etapa 3: campeón
  // ---------------------------------------------------------------------------

  function mountChampion() {
    const b = state.bracket;
    const f = T.finalMatch(b);
    const champ = teamById(f.winner);
    const runner = teamById(T.runnerUpOf(b));
    const champIsA = f.a === champ.id;
    const cs = champIsA ? f.scoreA : f.scoreB;
    const rs = champIsA ? f.scoreB : f.scoreA;

    const route = T.pathOf(b, champ.id).map((m) => {
      const isFinal = m.round === b.rounds.length - 1;
      if (m.bye) {
        return '<li class="route-item"><span class="route-round">' + esc(roundLabel(m.round)) + '</span>' +
          '<span class="route-rival muted">Pase directo por sorteo</span><span class="route-score">—</span></li>';
      }
      const isA = m.a === champ.id;
      const rival = teamById(isA ? m.b : m.a);
      const mine = isA ? m.scoreA : m.scoreB;
      const theirs = isA ? m.scoreB : m.scoreA;
      return '<li class="route-item' + (isFinal ? ' is-final' : '') + '"><span class="route-round">' + esc(roundLabel(m.round)) + '</span>' +
        '<span class="route-rival">' + badge(rival, 'sm') + '<span>vs ' + esc(rival.name) + '</span></span>' +
        '<span class="route-score">' + mine + '–' + theirs + (m.decidedBy === 'tiebreak' ? '<small>desempate</small>' : '') + '</span></li>';
    }).join('');

    $('#view').innerHTML =
      '<section class="champion-view" aria-label="Campeón del torneo">' +
        '<div class="podium on-board" style="--team:' + esc(champ.color) + '">' +
          '<div class="trophy">' + ICONS.trophy + '</div>' +
          '<p class="eyebrow">Campeón · ' + esc(state.tournament.name) + '</p>' +
          '<h1 class="champ-name">' + esc(champ.name) + '</h1>' +
          '<ul class="chips chips-static" aria-label="Integrantes del equipo campeón">' + champ.members.map((x) => '<li class="chip">' + esc(x) + '</li>').join('') + '</ul>' +
          '<div class="scoreboard" aria-label="Resultado de la final">' +
            '<p class="sb-label">Final' + (f.decidedBy === 'tiebreak' ? ' · definida por desempate' : '') + '</p>' +
            '<div class="sb-row is-winner">' + badge(champ, 'sm') + '<span class="sb-name">' + esc(champ.name) + '</span><span class="sb-score">' + cs + '</span></div>' +
            '<div class="sb-row">' + badge(runner, 'sm') + '<span class="sb-name">' + esc(runner.name) + '</span><span class="sb-score">' + rs + '</span></div>' +
          '</div>' +
          '<p class="runner-up">Subcampeón: <strong>' + esc(runner.name) + '</strong></p>' +
          '<div class="podium-actions">' +
            '<button type="button" class="btn" data-action="show-bracket">Ver llaves</button>' +
            '<button type="button" class="btn btn-primary" data-action="new-same">Nuevo torneo con estos equipos</button>' +
            '<button type="button" class="btn" data-action="new-empty">Empezar de cero</button>' +
          '</div>' +
        '</div>' +
        '<div class="champion-side">' +
          '<section class="panel" aria-labelledby="route-title"><div class="section-head"><h2 id="route-title">Camino al título</h2></div><ol class="route">' + route + '</ol></section>' +
          historyPanel() +
        '</div>' +
      '</section>';
  }

  function celebrate(color) {
    if (reduceMotion()) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) {
      canvas.remove();
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const palette = [color, css.getPropertyValue('--gold-bright').trim() || '#E2B33C', css.getPropertyValue('--accent').trim() || '#CF3E22', '#2B63C6', '#17855A'];
    const parts = Array.from({ length: 150 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.25,
      y: H * 0.3,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 13 - 4,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      c: palette[Math.floor(Math.random() * palette.length)],
    }));
    const duration = 3200;
    const start = performance.now();
    const frame = (now) => {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(0, 1 - t / duration);
      for (const p of parts) {
        p.vy += 0.3;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.cos(p.rot * 2));
        ctx.restore();
      }
      if (t < duration) requestAnimationFrame(frame);
      else canvas.remove();
    };
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Datos: exportar, importar, borrar
  // ---------------------------------------------------------------------------

  function replaceState(next, message) {
    state = next;
    ui.draft = newDraft();
    ui.view = 'auto';
    ui.mounted = null;
    ui.notice = null;
    persist();
    render();
    if (message) toast(message);
  }

  function openDataModal() {
    const json = JSON.stringify(state, null, 2);
    const kb = Math.max(1, Math.round(new Blob([JSON.stringify(state)]).size / 1024));
    const el = openModal(
      '<div class="data-modal">' +
        '<header class="modal-head"><p class="eyebrow">Tus datos</p><h2 id="modal-title">Guardados en este navegador</h2></header>' +
        '<p>Equipos, llaves, resultados y palmarés se guardan solos en el almacenamiento local del navegador (<code>localStorage</code>). Siguen ahí aunque cierres la pestaña o apagues el equipo, pero se pierden si borras los datos del sitio o abres la app en otro navegador o dispositivo.</p>' +
        '<dl class="data-stats">' +
          '<div><dt>Equipos</dt><dd>' + state.teams.length + '</dd></div>' +
          '<div><dt>Partidos jugados</dt><dd>' + T.playedCount(state.bracket) + '</dd></div>' +
          '<div><dt>Palmarés</dt><dd>' + state.history.length + '</dd></div>' +
          '<div><dt>Tamaño</dt><dd>' + kb + ' KB</dd></div>' +
        '</dl>' +
        '<section class="data-section">' +
          '<h3>Exportar copia</h3>' +
          '<p class="hint">Guarda este texto o descárgalo como archivo para restaurarlo después o pasarlo a otro dispositivo.</p>' +
          '<label for="export-json" class="sr-only">Copia de los datos</label>' +
          '<textarea id="export-json" rows="5" readonly>' + esc(json) + '</textarea>' +
          '<div class="row"><button type="button" class="btn" id="copy-json">Copiar</button><button type="button" class="btn" id="download-json">Descargar .json</button></div>' +
        '</section>' +
        '<section class="data-section">' +
          '<h3>Importar copia</h3>' +
          '<p class="hint">Reemplaza los datos actuales por los de una copia exportada.</p>' +
          '<div class="row"><label for="import-file" class="btn btn-file">Elegir archivo…</label><input type="file" id="import-file" accept="application/json,.json" class="sr-only"></div>' +
          '<label for="import-json" class="sr-only">Pegar copia</label>' +
          '<textarea id="import-json" rows="3" placeholder="O pega aquí el texto de la copia"></textarea>' +
          '<p class="error" id="import-error" role="alert" hidden></p>' +
          '<div class="row"><button type="button" class="btn" id="do-import">Importar</button></div>' +
        '</section>' +
        '<section class="data-section">' +
          '<h3>Borrar todo</h3>' +
          '<p class="hint">Elimina equipos, llaves y palmarés de este navegador. No se puede deshacer.</p>' +
          '<div class="row"><button type="button" class="btn btn-danger" id="wipe-all">Borrar todos los datos</button></div>' +
        '</section>' +
        '<div class="modal-actions"><span class="spacer"></span><button type="button" class="btn btn-primary" data-modal="cancel">Cerrar</button></div>' +
      '</div>',
      { size: 'md', focus: false }
    );

    const exportArea = $('#export-json', el);
    $('#copy-json', el).addEventListener('click', () => {
      const fallback = () => {
        exportArea.focus();
        exportArea.select();
        toast('Texto seleccionado: cópialo con Ctrl+C o Cmd+C.');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(() => toast('Copia copiada al portapapeles.'), fallback);
      } else fallback();
    });

    $('#download-json', el).addEventListener('click', () => {
      try {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const slug = state.tournament.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'torneo';
        a.href = url;
        a.download = slug + '-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } catch (e) {
        toast('No se pudo descargar. Usa «Copiar» y guarda el texto.');
      }
    });

    const importArea = $('#import-json', el);
    const importError = $('#import-error', el);
    const doImport = async () => {
      importError.hidden = true;
      let parsed;
      try {
        parsed = JSON.parse(importArea.value);
      } catch (e) {
        importError.textContent = 'Ese texto no es una copia válida. Pega el contenido completo de un archivo exportado.';
        importError.hidden = false;
        return;
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.teams)) {
        importError.textContent = 'Ese texto no parece una copia de Torneos: no tiene lista de equipos.';
        importError.hidden = false;
        return;
      }
      const next = T.normalizeState(parsed);
      const ok = await confirmDialog({
        title: '¿Reemplazar los datos actuales?',
        message: 'La copia trae ' + plural(next.teams.length, 'equipo', 'equipos') + ' y ' + plural(next.history.length, 'campeón', 'campeones') + ' en el palmarés. Lo que tienes ahora se perderá.',
        confirmLabel: 'Importar copia',
        danger: true,
      });
      if (ok) replaceState(next, 'Copia importada.');
    };
    $('#do-import', el).addEventListener('click', doImport);
    $('#import-file', el).addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        importArea.value = String(reader.result || '');
        doImport();
      };
      reader.onerror = () => {
        importError.textContent = 'No se pudo leer el archivo.';
        importError.hidden = false;
      };
      reader.readAsText(file);
    });

    $('#wipe-all', el).addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '¿Borrar todos los datos?',
        message: 'Se eliminarán los equipos, las llaves y el palmarés guardados en este navegador.',
        confirmLabel: 'Borrar todo',
        danger: true,
      });
      if (ok) replaceState(T.createState(), 'Datos borrados.');
    });
  }

  // ---------------------------------------------------------------------------
  // Acciones
  // ---------------------------------------------------------------------------

  const actions = {
    'add-member': () => addMember(),
    'remove-member': (el) => {
      ui.draft.members.splice(Number(el.dataset.index), 1);
      refreshChips();
      setFormMessage(null);
      $('#member-input').focus();
    },
    'edit-team': (el) => startEdit(el.dataset.id),
    'cancel-edit': () => resetDraft(),
    'delete-team': (el) => deleteTeam(el.dataset.id),
    'load-examples': () => {
      state.teams = exampleTeams();
      state.flags.exampleBanner = true;
      persist();
      render();
    },
    'remove-examples': () => {
      if (state.teams.some((t) => t.example && t.id === ui.draft.id)) resetDraft();
      state.teams = state.teams.filter((t) => !t.example);
      state.flags.exampleBanner = false;
      persist();
      render();
      toast('Equipos de ejemplo eliminados.');
    },
    'dismiss-examples': () => {
      state.flags.exampleBanner = false;
      persist();
    },
    'dismiss-notice': () => {
      ui.notice = null;
      renderBanner();
    },
    draw: () => doDraw(),
    redraw: () => doDraw(),
    'back-to-teams': async () => {
      const played = T.playedCount(state.bracket);
      if (played) {
        const ok = await confirmDialog({
          title: '¿Volver a editar los equipos?',
          message: 'Se borrarán las llaves y ' + plural(played, 'resultado registrado', 'resultados registrados') + '. Después tendrás que hacer el sorteo otra vez.',
          confirmLabel: 'Borrar llaves y editar',
          danger: true,
        });
        if (!ok) return;
      }
      state.bracket = null;
      ui.view = 'auto';
      persist();
      render();
    },
    'open-result': (el) => openResult(el.dataset.id),
    'goto-round': (el) => gotoRound(el.dataset.round),
    'show-champion': () => {
      ui.view = 'champion';
      render();
      window.scrollTo({ top: 0 });
    },
    'show-bracket': () => {
      ui.view = 'bracket';
      render();
    },
    'new-same': () => {
      state.bracket = null;
      state.tournament = { id: T.uid('t'), name: state.tournament.name, createdAt: new Date().toISOString() };
      ui.view = 'auto';
      persist();
      render();
      toast('Listo: los mismos equipos, a sortear de nuevo.');
    },
    'new-empty': async () => {
      const ok = await confirmDialog({
        title: '¿Empezar un torneo desde cero?',
        message: 'Se quitarán los ' + state.teams.length + ' equipos inscritos. El palmarés se conserva.',
        confirmLabel: 'Empezar de cero',
      });
      if (!ok) return;
      state.teams = [];
      state.bracket = null;
      state.tournament = { id: T.uid('t'), name: T.DEFAULT_TOURNAMENT_NAME, createdAt: new Date().toISOString() };
      ui.view = 'auto';
      persist();
      render();
    },
    'open-data': () => openDataModal(),
  };

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const modalBtn = e.target.closest('[data-modal]');
      if (modalBtn) {
        closeModal(modalBtn.dataset.modal === 'ok');
        return;
      }
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      const fn = actions[el.dataset.action];
      if (fn) fn(el);
    });

    document.addEventListener('submit', (e) => {
      if (e.target.id === 'team-form') {
        e.preventDefault();
        saveTeam();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'member-input' && !e.isComposing) {
        e.preventDefault();
        addMember();
      }
    });

    const nameInput = $('#tournament-name');
    let renameTimer = null;
    nameInput.addEventListener('input', () => {
      state.tournament.name = T.cleanName(nameInput.value).slice(0, T.MAX_TOURNAMENT_NAME) || T.DEFAULT_TOURNAMENT_NAME;
      clearTimeout(renameTimer);
      renameTimer = setTimeout(persist, 300);
    });
    nameInput.addEventListener('blur', () => {
      clearTimeout(renameTimer);
      nameInput.value = state.tournament.name;
      persist();
      if (ui.mounted === 'champion') render();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nameInput.blur();
    });

    const dlg = modalEl();
    dlg.addEventListener('close', () => {
      if (modalState.ignoreNextClose) {
        modalState.ignoreNextClose = false;
        return;
      }
      finishModal();
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) closeModal(false);
    });

    // Si la app está abierta en otra pestaña, mantener ambas sincronizadas.
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      const r = storage.read();
      closeModal(false);
      state = r.data ? T.normalizeState(r.data) : T.createState();
      ui.draft = newDraft();
      ui.mounted = null;
      render();
      toast('Datos actualizados desde otra pestaña.');
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', () => {
      // En marcos aislados (iframes) el navegador puede negar el acceso;
      // en ese caso no hay modo sin conexión, pero la app funciona igual.
      try {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      } catch (e) { /* sin service worker */ }
    });
  }

  function init() {
    const saved = storage.read();
    if (saved.data) {
      state = T.normalizeState(saved.data);
    } else {
      state = T.createState();
      if (saved.corrupt) ui.notice = 'corrupt';
      else {
        state.teams = exampleTeams();
        state.flags.exampleBanner = true;
      }
    }
    bindEvents();
    persist();
    render();
    registerServiceWorker();
  }

  init();
})();
