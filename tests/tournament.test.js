const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/tournament.js');

function ids(n) {
  return Array.from({ length: n }, (_, i) => 'e' + (i + 1));
}

// Generador pseudoaleatorio con semilla, para pruebas reproducibles.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Juega todo el torneo: gana siempre el lado "a" salvo que se indique otra cosa. */
function playAll(bracket) {
  for (const round of bracket.rounds) {
    for (const m of round) {
      if (!m.winner) T.setResult(bracket, m.id, { scoreA: 2, scoreB: 1 });
    }
  }
}

test('seedOrder reparte las siembras de forma clásica', () => {
  assert.deepEqual(T.seedOrder(2), [1, 2]);
  assert.deepEqual(T.seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(T.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('roundName nombra las etapas por cantidad de partidos', () => {
  assert.equal(T.roundName(1, 2), 'Final');
  assert.equal(T.roundName(2, 1), 'Semifinales');
  assert.equal(T.roundName(4, 0), 'Cuartos de final');
  assert.equal(T.roundName(8, 0), 'Octavos de final');
});

test('bracketStats: partidos, rondas y pases directos', () => {
  assert.deepEqual(T.bracketStats(1).rounds, 0);
  const six = T.bracketStats(6);
  assert.equal(six.size, 8);
  assert.equal(six.rounds, 3);
  assert.equal(six.byes, 2);
  assert.equal(six.matches, 5);
  assert.equal(six.firstRoundMatches, 2);
  assert.deepEqual(six.stages, ['Cuartos de final', 'Semifinales', 'Final']);
  assert.equal(T.bracketStats(8).byes, 0);
});

test('createBracket exige al menos 2 equipos', () => {
  assert.throws(() => T.createBracket([]));
  assert.throws(() => T.createBracket(['solo']));
  assert.throws(() => T.createBracket(['a', 'a']));
});

for (let n = 2; n <= 33; n++) {
  test(`sorteo con ${n} equipos: cada equipo una vez, sin cruces vacíos, termina con campeón`, () => {
    const teams = ids(n);
    const b = T.createBracket(teams, seeded(n));
    const size = T.nextPowerOfTwo(n);
    assert.equal(b.rounds.length, Math.log2(size));
    assert.equal(b.rounds[0].length, size / 2);

    const placed = b.rounds[0].flatMap((m) => [m.a, m.b]).filter(Boolean);
    assert.deepEqual([...placed].sort(), [...teams].sort());

    const byes = b.rounds[0].filter((m) => m.bye);
    assert.equal(byes.length, size - n);
    for (const m of b.rounds[0]) assert.ok(m.a || m.b, 'ningún partido sin equipos');
    for (const m of byes) {
      assert.equal(m.decidedBy, 'bye');
      assert.equal(m.winner, m.a || m.b);
      const next = T.nextMatch(b, m);
      if (next) assert.equal(m.index % 2 === 0 ? next.a : next.b, m.winner, 'el pase directo avanza solo');
    }
    // Los pases directos nunca chocan entre sí en la segunda ronda (ambos lados con bye)
    // salvo que haya más de la mitad de huecos, cosa imposible por construcción.
    assert.ok(size - n < size / 2);

    playAll(b);
    assert.equal(T.playedCount(b), n - 1, 'siempre se juegan n - 1 partidos');
    assert.ok(teams.includes(T.championOf(b)));
    assert.equal(T.currentRoundIndex(b), -1);
  });
}

test('el sorteo es aleatorio', () => {
  const teams = ids(8);
  const a = T.createBracket(teams, seeded(1)).rounds[0].map((m) => m.a + m.b).join();
  const b = T.createBracket(teams, seeded(2)).rounds[0].map((m) => m.a + m.b).join();
  assert.notEqual(a, b);
});

test('setResult: gana el marcador mayor y avanza al lado correcto', () => {
  const b = T.buildFromSlots(['A', 'B', 'C', 'D']);
  T.setResult(b, 'r0m0', { scoreA: 0, scoreB: 3 });
  T.setResult(b, 'r0m1', { scoreA: '4', scoreB: '1' });
  const final = b.rounds[1][0];
  assert.equal(final.a, 'B');
  assert.equal(final.b, 'C');
  assert.equal(T.currentRoundIndex(b), 1);
  T.setResult(b, 'r1m0', { scoreA: 1, scoreB: 0 });
  assert.equal(T.championOf(b), 'B');
  assert.equal(T.runnerUpOf(b), 'C');
});

test('setResult: el empate exige elegir quién avanza', () => {
  const b = T.buildFromSlots(['A', 'B']);
  assert.throws(() => T.setResult(b, 'r0m0', { scoreA: 1, scoreB: 1 }), /empate/i);
  assert.throws(() => T.setResult(b, 'r0m0', { scoreA: 1, scoreB: 1, winner: 'Z' }), /empate/i);
  T.setResult(b, 'r0m0', { scoreA: 1, scoreB: 1, winner: 'B' });
  assert.equal(T.championOf(b), 'B');
  assert.equal(b.rounds[0][0].decidedBy, 'tiebreak');
});

test('setResult rechaza marcadores inválidos', () => {
  const b = T.buildFromSlots(['A', 'B']);
  for (const bad of [-1, 1.5, '', null, 'x', T.MAX_SCORE + 1]) {
    assert.throws(() => T.setResult(b, 'r0m0', { scoreA: bad, scoreB: 0 }), /marcador/);
  }
});

test('no se puede jugar un partido sin sus dos equipos ni un pase directo', () => {
  const b = T.buildFromSlots(['A', null, 'C', 'D']);
  assert.throws(() => T.setResult(b, 'r0m0', { scoreA: 1, scoreB: 0 }), /pasó directo/);
  assert.throws(() => T.setResult(b, 'r1m0', { scoreA: 1, scoreB: 0 }), /dos equipos/);
  assert.equal(b.rounds[1][0].a, 'A');
});

test('corregir: se puede cambiar el ganador mientras el siguiente partido no se juegue', () => {
  const b = T.buildFromSlots(['A', 'B', 'C', 'D']);
  T.setResult(b, 'r0m0', { scoreA: 2, scoreB: 0 });
  assert.equal(b.rounds[1][0].a, 'A');
  T.setResult(b, 'r0m0', { scoreA: 0, scoreB: 2 });
  assert.equal(b.rounds[1][0].a, 'B');

  T.setResult(b, 'r0m1', { scoreA: 2, scoreB: 0 });
  T.setResult(b, 'r1m0', { scoreA: 2, scoreB: 0 });
  assert.equal(T.canEdit(b, b.rounds[0][0]), false);
  assert.throws(() => T.setResult(b, 'r0m0', { scoreA: 5, scoreB: 0 }), /siguiente/);
  assert.throws(() => T.clearResult(b, 'r0m0'), /siguiente/);

  T.clearResult(b, 'r1m0');
  assert.equal(T.championOf(b), null);
  T.clearResult(b, 'r0m0');
  assert.equal(b.rounds[1][0].a, null);
  assert.equal(b.rounds[0][0].winner, null);
});

test('teamStatus y pathOf', () => {
  const b = T.buildFromSlots(['A', 'B', 'C', null]);
  T.setResult(b, 'r0m0', { scoreA: 3, scoreB: 1 });
  assert.deepEqual(T.teamStatus(b, 'B'), { status: 'out', round: 0 });
  assert.equal(T.teamStatus(b, 'C').status, 'alive');
  T.setResult(b, 'r1m0', { scoreA: 0, scoreB: 1 });
  assert.equal(T.teamStatus(b, 'C').status, 'champion');
  assert.deepEqual(T.pathOf(b, 'C').map((m) => m.id), ['r0m1', 'r1m0']);
});

test('validateTeam', () => {
  const teams = [{ id: 'x', name: 'Los Halcones', members: ['Ana'] }];
  assert.deepEqual(T.validateTeam({ name: 'Pumas', members: ['Luis'] }, teams).errors, []);
  assert.match(T.validateTeam({ name: '  ', members: ['Luis'] }, teams).errors.join(), /nombre/);
  assert.match(T.validateTeam({ name: 'los halcones', members: ['Luis'] }, teams).errors.join(), /Ya existe/);
  assert.deepEqual(T.validateTeam({ name: 'los halcones', members: ['Luis'] }, teams, 'x').errors, []);
  assert.match(T.validateTeam({ name: 'Pumas', members: [] }, teams).errors.join(), /integrante/);
  assert.match(T.validateTeam({ name: 'Pumas', members: ['José', 'jose'] }, teams).errors.join(), /repetido/);
});

test('initials', () => {
  assert.equal(T.initials('Los Halcones'), 'LH');
  assert.equal(T.initials('Atlas'), 'AT');
  assert.equal(T.initials('  ñandúes  del sur '), 'ÑD');
  assert.equal(T.initials(''), '?');
});

test('normalizeState: datos vacíos o dañados dan un estado limpio', () => {
  for (const raw of [null, 42, 'hola', [], { teams: 'x', bracket: 5 }]) {
    const s = T.normalizeState(raw);
    assert.deepEqual(s.teams, []);
    assert.equal(s.bracket, null);
    assert.equal(T.phaseOf(s), 'setup');
  }
});

test('normalizeState conserva un torneo guardado y repite sus resultados', () => {
  const s = T.createState();
  s.teams = ['A', 'B', 'C'].map((name, i) => ({ id: 'id' + i, name, members: [name + '1'], color: T.TEAM_COLORS[i] }));
  s.bracket = T.createBracket(s.teams.map((t) => t.id), seeded(7));
  const real = s.bracket.rounds[0].find((m) => !m.bye);
  T.setResult(s.bracket, real.id, { scoreA: 2, scoreB: 2, winner: real.b });

  const back = T.normalizeState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back.bracket.rounds, s.bracket.rounds);
  assert.equal(T.phaseOf(back), 'playing');
});

test('normalizeState descarta resultados incoherentes sin romper las llaves', () => {
  const s = T.createState();
  s.teams = ['A', 'B', 'C', 'D'].map((name) => ({ id: name, name, members: ['x'] }));
  s.bracket = T.buildFromSlots(['A', 'B', 'C', 'D']);
  T.setResult(s.bracket, 'r0m0', { scoreA: 1, scoreB: 0 });
  const raw = JSON.parse(JSON.stringify(s));
  raw.bracket.rounds[0][1].winner = 'A'; // A no juega ese partido
  raw.bracket.rounds[0][1].scoreA = 1;
  raw.bracket.rounds[0][1].scoreB = 0;
  raw.bracket.rounds[1][0].winner = 'A';
  const back = T.normalizeState(raw);
  assert.equal(back.bracket.rounds[0][0].winner, 'A');
  assert.equal(back.bracket.rounds[0][1].winner, null);
  assert.equal(back.bracket.rounds[1][0].winner, null);
  assert.equal(back.bracket.rounds[1][0].a, 'A');
});

test('normalizeState descarta llaves que no coinciden con los equipos', () => {
  const s = T.createState();
  s.teams = ['A', 'B', 'C'].map((name) => ({ id: name, name, members: ['x'] }));
  s.bracket = T.buildFromSlots(['A', 'B', 'C', 'D']);
  assert.equal(T.normalizeState(JSON.parse(JSON.stringify(s))).bracket, null);
});
