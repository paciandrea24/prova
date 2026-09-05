// frontend/shared/f1Difficolta.test.js
//
// I tre livelli di difficolta' dei bot (spec 2026-09-05). La tabella e'
// tarata su misure fatte col banco prova, non a sensazione: i numeri stanno
// nella spec e qui si controlla che restino coerenti fra loro.
const test = require('node:test');
const assert = require('node:assert/strict');
const F1Difficolta = require('./f1Difficolta.js');

test('i tre livelli, dal piu\' lento al piu\' veloce', () => {
    assert.deepEqual(F1Difficolta.LIVELLI, ['facile', 'medio', 'difficile']);
    assert.equal(F1Difficolta.PREDEFINITO, 'medio');
});

test('un livello sconosciuto, assente o storto vale medio', () => {
    // ⚠️ Una lobby aperta prima di questa modifica non manda niente, e un
    // client vecchio puo' mandare qualunque cosa: nessuno dei due deve
    // ritrovarsi bot senza ritmo.
    for (const strano of [undefined, null, '', 'MEDIO', 'impossibile', 42, {}]) {
        assert.equal(F1Difficolta.normalizza(strano), 'medio', `con ${JSON.stringify(strano)}`);
    }
    assert.equal(F1Difficolta.normalizza('facile'), 'facile');
});

test('salendo di livello i bot vanno piu\' forte e sbagliano meno', () => {
    const f = F1Difficolta.intervalliDi('facile');
    const m = F1Difficolta.intervalliDi('medio');
    const d = F1Difficolta.intervalliDi('difficile');
    // Il ritmo sale...
    assert.ok(f.ritmoMax <= m.ritmoMin, 'facile e medio si sovrappongono nel ritmo');
    assert.ok(m.ritmoMax <= d.ritmoMin, 'medio e difficile si sovrappongono nel ritmo');
    // ...e il rumore scende, insieme. Le due leve non si muovono mai in
    // direzioni opposte: un bot veloce e impreciso esce di pista (misurato:
    // ritmo 1.00 con rumore 0.25 fa 13 tick fuori dal cordolo).
    assert.ok(d.rumoreMax <= m.rumoreMin, 'medio e difficile si sovrappongono nel rumore');
    assert.ok(m.rumoreMax <= f.rumoreMin, 'facile e medio si sovrappongono nel rumore');
});

test('ogni livello e\' un intervallo vero, non un numero solo', () => {
    // ⚠️ La varianza dentro il livello e' cio' che rompe l'ordine statico
    // della griglia: senza, chi parte davanti resta davanti e non si vede un
    // sorpasso per tutta la gara (f1Bot.js:568-578).
    for (const livello of F1Difficolta.LIVELLI) {
        const i = F1Difficolta.intervalliDi(livello);
        assert.ok(i.ritmoMax > i.ritmoMin, `${livello}: il ritmo e' un punto solo`);
        assert.ok(i.rumoreMax > i.rumoreMin, `${livello}: il rumore e' un punto solo`);
        assert.ok(i.ritmoMin > 0.5 && i.ritmoMax <= 1, `${livello}: ritmo fuori scala`);
        assert.ok(i.rumoreMin >= 0, `${livello}: rumore negativo`);
    }
});

test('l\'aggressivita\' cresce col livello', () => {
    const f = F1Difficolta.soglieDi('facile');
    const d = F1Difficolta.soglieDi('difficile');
    // Meno margine richiesto = tenta il sorpasso piu' spesso.
    assert.ok(d.margineSorpasso < f.margineSorpasso, 'a difficile deve attaccare con meno margine');
    // Frazione piu' alta = resta piu' attaccato a chi precede.
    assert.ok(d.frazioneMinimaInScia > f.frazioneMinimaInScia, 'a difficile deve talonare di piu\'');
});

test('i valori di oggi restano dentro il livello medio', () => {
    // ⚠️ E' il collaudo del default: chi non sceglie niente deve trovare
    // avversari simili a quelli di prima di questa modifica, non un gioco
    // diverso. I numeri storici sono BOT_OVERTAKE_PACE_MARGIN 1.01 e
    // BOT_FOLLOW_MIN_FRACTION 0.85.
    const m = F1Difficolta.soglieDi('medio');
    assert.ok(Math.abs(m.margineSorpasso - 1.01) < 0.02);
    assert.ok(Math.abs(m.frazioneMinimaInScia - 0.85) < 0.05);
});
