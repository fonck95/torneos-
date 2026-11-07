/*
 * Lógica pura del torneo (sin DOM).
 * Funciona en el navegador (window.Torneo) y en Node (module.exports) para las pruebas.
 *
 * Modelo de las llaves (eliminación directa):
 *   bracket.rounds[r][i] = partido i de la ronda r
 *   El ganador del partido i pasa a rounds[r + 1][floor(i / 2)],
 *   al lado "a" si i es par y al lado "b" si i es impar.
 *   Los "pases directos" (byes) solo existen en la primera ronda.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Torneo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_TEAMS = 64;
  const MAX_MEMBERS = 30;
  const MAX_NAME = 40;
  const MAX_TOURNAMENT_NAME = 60;
  const MAX_SCORE = 999;
  const DEFAULT_TOURNAMENT_NAME = 'Mi torneo';

  // Colores de escudo: todos llevan texto blanco encima en ambos temas.
  const TEAM_COLORS = [
    '#C2412A', '#2B63C6', '#17855A', '#7B45C8', '#9A6208', '#C0336E',
    '#0E7C7A', '#4C5B7A', '#93491F', '#3B47B5', '#2B7736', '#8D35A0',
  ];

  // ---------- utilidades ----------

  function uid(prefix) {
    const rand = Math.random().toString(36).slice(2, 8);
    return (prefix || 'id') + '-' + Date.now().toString(36) + rand;
  }

  function str(v) {
    return typeof v === 'string' ? v : '';
  }

  function cleanName(v) {
    return str(v).replace(/\s+/g, ' ').trim();
  }

  function sameName(a, b) {
    return cleanName(a).localeCompare(cleanName(b), 'es', { sensitivity: 'base' }) === 0;
  }

  function initials(name) {
    const words = cleanName(name).split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w));
    if (!words.length) return '?';
    const letters = words.length >= 2
      ? [Array.from(words[0])[0], Array.from(words[1])[0]]
      : Array.from(words[0]).slice(0, 2);
    return letters.join('').toLocaleUpperCase('es');
  }

  function pickColor(teams) {
    const used = new Set(teams.map((t) => t.color));
    const free = TEAM_COLORS.find((c) => !used.has(c));
    return free || TEAM_COLORS[teams.length % TEAM_COLORS.length];
  }

  function isPowerOfTwo(n) {
    return n >= 1 && (n & (n - 1)) === 0;
  }

  function nextPowerOfTwo(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  /** Orden clásico de siembra: para 8 → [1, 8, 4, 5, 2, 7, 3, 6]. */
  function seedOrder(size) {
    let order = [1];
    while (order.length < size) {
      const len = order.length * 2;
      order = order.flatMap((s) => [s, len + 1 - s]);
    }
    return order;
  }

  function shuffle(list, rng) {
    const random = rng || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function roundName(matchCount, roundIndex) {
    switch (matchCount) {
      case 1: return 'Final';
      case 2: return 'Semifinales';
      case 4: return 'Cuartos de final';
      case 8: return 'Octavos de final';
      case 16: return 'Dieciseisavos de final';
      case 32: return 'Treintaidosavos de final';
      default: return 'Ronda ' + (roundIndex + 1);
    }
  }

  /** Resumen de lo que generará el sorteo con n equipos. */
  function bracketStats(n) {
    if (n < 2) return { size: n, rounds: 0, byes: 0, matches: 0, firstRoundMatches: 0, stages: [] };
    const size = nextPowerOfTwo(n);
    const rounds = Math.log2(size);
    const stages = [];
    for (let r = 0; r < rounds; r++) stages.push(roundName(size / 2 ** (r + 1), r));
    return {
      size,
      rounds,
      byes: size - n,
      matches: n - 1, // en eliminación directa siempre se juegan n - 1 partidos
      firstRoundMatches: size / 2 - (size - n),
      stages,
    };
  }

  // ---------- llaves ----------

  function emptyMatch(r, i) {
    return {
      id: 'r' + r + 'm' + i,
      round: r,
      index: i,
      a: null,
      b: null,
      scoreA: null,
      scoreB: null,
      winner: null,
      decidedBy: null, // 'score' | 'tiebreak' | 'bye'
      bye: false,
    };
  }

  /** Construye las llaves a partir de los puestos de la primera ronda (null = pase directo). */
  function buildFromSlots(slots) {
    const size = slots.length;
    if (size < 2 || !isPowerOfTwo(size)) throw new Error('Cantidad de puestos inválida.');
    const totalRounds = Math.log2(size);
    const rounds = [];
    for (let r = 0; r < totalRounds; r++) {
      const count = size / 2 ** (r + 1);
      const matches = [];
      for (let i = 0; i < count; i++) matches.push(emptyMatch(r, i));
      rounds.push(matches);
    }
    const bracket = { rounds, drawnAt: null };
    rounds[0].forEach((m, i) => {
      m.a = slots[2 * i] || null;
      m.b = slots[2 * i + 1] || null;
      if (!m.a && !m.b) throw new Error('Un partido no puede quedar sin equipos.');
      if (!m.a || !m.b) {
        m.bye = true;
        m.winner = m.a || m.b;
        m.decidedBy = 'bye';
        placeWinner(bracket, m);
      }
    });
    return bracket;
  }

  /**
   * Sorteo: baraja los equipos y los coloca con el orden de siembra clásico.
   * Si la cantidad no es potencia de 2, los pases directos quedan repartidos
   * por todo el cuadro y nunca se enfrentan dos huecos entre sí.
   */
  function createBracket(teamIds, rng) {
    if (!Array.isArray(teamIds) || teamIds.length < 2) throw new Error('Se necesitan al menos 2 equipos para el sorteo.');
    if (new Set(teamIds).size !== teamIds.length) throw new Error('Hay equipos repetidos.');
    const shuffled = shuffle(teamIds, rng);
    const size = nextPowerOfTwo(shuffled.length);
    const slots = seedOrder(size).map((seed) => (seed <= shuffled.length ? shuffled[seed - 1] : null));
    const bracket = buildFromSlots(slots);
    bracket.drawnAt = new Date().toISOString();
    return bracket;
  }

  function findMatch(bracket, matchId) {
    if (!bracket) return null;
    for (const round of bracket.rounds) {
      for (const m of round) if (m.id === matchId) return m;
    }
    return null;
  }

  function nextMatch(bracket, m) {
    const next = bracket.rounds[m.round + 1];
    return next ? next[Math.floor(m.index / 2)] : null;
  }

  function placeWinner(bracket, m) {
    const next = nextMatch(bracket, m);
    if (!next) return;
    if (m.index % 2 === 0) next.a = m.winner;
    else next.b = m.winner;
  }

  function toScore(v) {
    if (v === null || v === undefined) return null;
    const s = typeof v === 'string' ? v.trim() : v;
    if (s === '') return null;
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0 || n > MAX_SCORE) return null;
    return n;
  }

  /** Un resultado se puede registrar o corregir mientras el partido siguiente no se haya jugado. */
  function canEdit(bracket, m) {
    if (!m || m.bye || !m.a || !m.b) return false;
    const next = nextMatch(bracket, m);
    return !(next && next.winner);
  }

  function setResult(bracket, matchId, input) {
    const m = findMatch(bracket, matchId);
    if (!m) throw new Error('No se encontró el partido.');
    if (m.bye) throw new Error('Este equipo pasó directo; no hay resultado que registrar.');
    if (!m.a || !m.b) throw new Error('Este partido todavía no tiene a sus dos equipos.');
    if (!canEdit(bracket, m)) throw new Error('El partido siguiente ya tiene resultado. Corrígelo primero.');
    const sa = toScore(input && input.scoreA);
    const sb = toScore(input && input.scoreB);
    if (sa === null || sb === null) throw new Error('Escribe el marcador de ambos equipos con números enteros desde 0.');
    let winner;
    let decidedBy = 'score';
    if (sa > sb) winner = m.a;
    else if (sb > sa) winner = m.b;
    else {
      const pick = input && input.winner;
      if (pick !== m.a && pick !== m.b) throw new Error('Hay empate: elige qué equipo avanza.');
      winner = pick;
      decidedBy = 'tiebreak';
    }
    m.scoreA = sa;
    m.scoreB = sb;
    m.winner = winner;
    m.decidedBy = decidedBy;
    placeWinner(bracket, m);
    return m;
  }

  function clearResult(bracket, matchId) {
    const m = findMatch(bracket, matchId);
    if (!m) throw new Error('No se encontró el partido.');
    if (m.bye) throw new Error('Un pase directo no se puede borrar.');
    if (!m.winner) return m;
    if (!canEdit(bracket, m)) throw new Error('El partido siguiente ya tiene resultado. Corrígelo primero.');
    m.scoreA = null;
    m.scoreB = null;
    m.winner = null;
    m.decidedBy = null;
    const next = nextMatch(bracket, m);
    if (next) {
      if (m.index % 2 === 0) next.a = null;
      else next.b = null;
    }
    return m;
  }

  function finalMatch(bracket) {
    if (!bracket) return null;
    const last = bracket.rounds[bracket.rounds.length - 1];
    return last ? last[0] : null;
  }

  function championOf(bracket) {
    const f = finalMatch(bracket);
    return f ? f.winner : null;
  }

  function runnerUpOf(bracket) {
    const f = finalMatch(bracket);
    if (!f || !f.winner) return null;
    return f.winner === f.a ? f.b : f.a;
  }

  /** Primera ronda con partidos pendientes, o -1 si el torneo terminó. */
  function currentRoundIndex(bracket) {
    if (!bracket) return -1;
    return bracket.rounds.findIndex((round) => round.some((m) => !m.winner));
  }

  function roundProgress(round) {
    const real = round.filter((m) => !m.bye);
    return {
      played: real.filter((m) => m.winner).length,
      total: real.length,
      byes: round.length - real.length,
    };
  }

  function playedCount(bracket) {
    if (!bracket) return 0;
    let n = 0;
    for (const round of bracket.rounds) for (const m of round) if (!m.bye && m.winner) n++;
    return n;
  }

  function hasResults(bracket) {
    return playedCount(bracket) > 0;
  }

  function teamStatus(bracket, teamId) {
    if (!bracket) return { status: 'alive', round: -1 };
    if (championOf(bracket) === teamId) return { status: 'champion', round: bracket.rounds.length - 1 };
    for (const round of bracket.rounds) {
      for (const m of round) {
        if (m.winner && m.winner !== teamId && (m.a === teamId || m.b === teamId)) {
          return { status: 'out', round: m.round };
        }
      }
    }
    return { status: 'alive', round: -1 };
  }

  /** Partidos ya definidos de un equipo, en orden de ronda. */
  function pathOf(bracket, teamId) {
    if (!bracket) return [];
    const out = [];
    for (const round of bracket.rounds) {
      for (const m of round) if (m.winner && (m.a === teamId || m.b === teamId)) out.push(m);
    }
    return out;
  }

  // ---------- equipos ----------

  function validateTeam(draft, teams, editingId) {
    const errors = [];
    const name = cleanName(draft && draft.name);
    const members = ((draft && draft.members) || []).map(cleanName).filter(Boolean);
    if (!name) errors.push('Escribe el nombre del equipo.');
    else if (name.length > MAX_NAME) errors.push('El nombre del equipo admite hasta ' + MAX_NAME + ' caracteres.');
    const clash = name && teams.find((t) => t.id !== editingId && sameName(t.name, name));
    if (clash) errors.push('Ya existe un equipo llamado «' + clash.name + '».');
    if (!members.length) errors.push('Agrega al menos un integrante.');
    if (members.length > MAX_MEMBERS) errors.push('Un equipo admite hasta ' + MAX_MEMBERS + ' integrantes.');
    const repeated = members.find((m, i) => members.findIndex((x) => sameName(x, m)) !== i);
    if (repeated) errors.push('«' + repeated + '» está repetido en este equipo.');
    if (!editingId && teams.length >= MAX_TEAMS) errors.push('El torneo admite hasta ' + MAX_TEAMS + ' equipos.');
    return { errors, value: { name, members } };
  }

  // ---------- estado completo ----------

  function createState() {
    return {
      version: 1,
      tournament: { id: uid('t'), name: DEFAULT_TOURNAMENT_NAME, createdAt: new Date().toISOString() },
      teams: [],
      bracket: null,
      history: [],
      flags: { exampleBanner: false },
    };
  }

  function phaseOf(state) {
    if (!state.bracket) return 'setup';
    return championOf(state.bracket) ? 'finished' : 'playing';
  }

  function isColor(v) {
    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  }

  /**
   * Reconstruye las llaves guardadas repitiendo cada resultado en orden.
   * Así, aunque los datos vengan alterados (importados o editados a mano),
   * las llaves que quedan siempre son coherentes.
   */
  function normalizeBracket(raw, ids) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rounds) || !raw.rounds.length) return null;
    const first = raw.rounds[0];
    if (!Array.isArray(first) || !first.length) return null;
    const size = first.length * 2;
    if (!isPowerOfTwo(size) || raw.rounds.length !== Math.log2(size)) return null;
    const slots = [];
    for (const m of first) {
      for (const v of [m && m.a, m && m.b]) {
        if (v === null || v === undefined) slots.push(null);
        else if (typeof v === 'string' && ids.has(v)) slots.push(v);
        else return null; // equipo desconocido: las llaves no corresponden a estos equipos
      }
    }
    const present = slots.filter(Boolean);
    if (new Set(present).size !== present.length || present.length !== ids.size) return null;
    for (let i = 0; i < slots.length; i += 2) if (!slots[i] && !slots[i + 1]) return null;
    const bracket = buildFromSlots(slots);
    bracket.drawnAt = str(raw.drawnAt) || null;
    for (let r = 0; r < bracket.rounds.length; r++) {
      const rawRound = Array.isArray(raw.rounds[r]) ? raw.rounds[r] : [];
      for (const m of bracket.rounds[r]) {
        if (m.bye || !m.a || !m.b) continue;
        const rm = rawRound[m.index];
        if (!rm || (rm.winner !== m.a && rm.winner !== m.b)) continue;
        const sa = toScore(rm.scoreA);
        const sb = toScore(rm.scoreB);
        if (sa !== null && sb !== null && sa !== sb && rm.winner !== (sa > sb ? m.a : m.b)) continue;
        try {
          setResult(bracket, m.id, { scoreA: sa, scoreB: sb, winner: rm.winner });
        } catch (e) {
          // Resultado incoherente: el partido queda pendiente.
        }
      }
    }
    return bracket;
  }

  function normalizeHistory(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const h of raw) {
      if (!h || typeof h !== 'object' || !h.champion || !cleanName(h.champion.name)) continue;
      out.push({
        id: str(h.id) || uid('t'),
        name: cleanName(h.name).slice(0, MAX_TOURNAMENT_NAME) || DEFAULT_TOURNAMENT_NAME,
        date: str(h.date) || new Date().toISOString(),
        champion: {
          name: cleanName(h.champion.name).slice(0, MAX_NAME),
          color: isColor(h.champion.color) ? h.champion.color : TEAM_COLORS[0],
          members: Array.isArray(h.champion.members) ? h.champion.members.map(cleanName).filter(Boolean).slice(0, MAX_MEMBERS) : [],
        },
        runnerUp: cleanName(h.runnerUp).slice(0, MAX_NAME),
        teams: Number.isInteger(h.teams) && h.teams > 0 ? h.teams : 0,
      });
    }
    return out.slice(0, 50);
  }

  /** Acepta cualquier cosa (datos guardados o importados) y devuelve un estado válido. */
  function normalizeState(raw) {
    const s = createState();
    if (!raw || typeof raw !== 'object') return s;
    const t = raw.tournament;
    if (t && typeof t === 'object') {
      s.tournament.id = str(t.id) || s.tournament.id;
      s.tournament.name = cleanName(t.name).slice(0, MAX_TOURNAMENT_NAME) || DEFAULT_TOURNAMENT_NAME;
      s.tournament.createdAt = str(t.createdAt) || s.tournament.createdAt;
    }
    const ids = new Set();
    if (Array.isArray(raw.teams)) {
      for (const team of raw.teams) {
        if (!team || typeof team !== 'object') continue;
        const id = str(team.id);
        const name = cleanName(team.name).slice(0, MAX_NAME);
        if (!id || !name || ids.has(id) || s.teams.some((x) => sameName(x.name, name))) continue;
        if (s.teams.length >= MAX_TEAMS) break;
        ids.add(id);
        const members = [];
        if (Array.isArray(team.members)) {
          for (const m of team.members) {
            const clean = cleanName(m).slice(0, MAX_NAME);
            if (clean && !members.some((x) => sameName(x, clean))) members.push(clean);
          }
        }
        s.teams.push({
          id,
          name,
          members: members.slice(0, MAX_MEMBERS),
          color: isColor(team.color) ? team.color : pickColor(s.teams),
          example: team.example === true,
        });
      }
    }
    s.bracket = normalizeBracket(raw.bracket, ids);
    s.history = normalizeHistory(raw.history);
    s.flags.exampleBanner = !!(raw.flags && raw.flags.exampleBanner) && s.teams.some((x) => x.example);
    return s;
  }

  return {
    MAX_TEAMS,
    MAX_MEMBERS,
    MAX_NAME,
    MAX_TOURNAMENT_NAME,
    MAX_SCORE,
    DEFAULT_TOURNAMENT_NAME,
    TEAM_COLORS,
    uid,
    cleanName,
    sameName,
    initials,
    pickColor,
    nextPowerOfTwo,
    seedOrder,
    shuffle,
    roundName,
    bracketStats,
    buildFromSlots,
    createBracket,
    findMatch,
    nextMatch,
    canEdit,
    toScore,
    setResult,
    clearResult,
    finalMatch,
    championOf,
    runnerUpOf,
    currentRoundIndex,
    roundProgress,
    playedCount,
    hasResults,
    teamStatus,
    pathOf,
    validateTeam,
    createState,
    phaseOf,
    normalizeState,
  };
});
