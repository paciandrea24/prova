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


test('la difesa cresce col livello', () => {
    assert.ok(F1Difficolta.soglieDi('difficile').frazioneDifesa >
              F1Difficolta.soglieDi('medio').frazioneDifesa);
    assert.ok(F1Difficolta.soglieDi('medio').frazioneDifesa >
              F1Difficolta.soglieDi('facile').frazioneDifesa);
    // ⚠️ E resta una difesa, non un muro: oltre i tre quarti della mezza
    // carreggiata il bot occuperebbe la pista invece di coprire una linea.
    for (const l of F1Difficolta.LIVELLI) {
        assert.ok(F1Difficolta.soglieDi(l).frazioneDifesa < 0.75, l + ': difesa troppo larga');
    }
});

// ⚠️ LA MISURA CHE HA CAMBIATO QUESTI NUMERI (playtest 2026-09-05).
// La difesa era in unita' di pista (4.5 a difficile) mentre l'attacco era ed
// e' una frazione della mezza carreggiata (BOT_OVERTAKE_FRACTION = 0.55, cioe'
// 6.05 unita' su `prova`): il bot attaccava tre volte piu' di quanto
// difendeva, e su `prova` la difesa realizzata valeva 0.61 larghezze d'auto —
// invisibile. Difendere quanto si attacca e' la stessa scala per le due meta'
// dello stesso duello.
test('a difficile ci si copre quanto ci si sposta per attaccare', () => {
    const BOT_OVERTAKE_FRACTION = 0.55;   // f1Bot.js, la meta' offensiva
    assert.ok(Math.abs(F1Difficolta.soglieDi('difficile').frazioneDifesa - BOT_OVERTAKE_FRACTION) < 1e-9,
        "a difficile la difesa deve valere quanto l'attacco");
});

test('si sbaglia di piu\' ai livelli bassi, ma mai zero', () => {
    const f = F1Difficolta.soglieDi('facile');
    const m = F1Difficolta.soglieDi('medio');
    const d = F1Difficolta.soglieDi('difficile');
    assert.ok(f.erroriPerGiro > m.erroriPerGiro, 'a facile si deve sbagliare piu\' che a medio');
    assert.ok(m.erroriPerGiro > d.erroriPerGiro, 'a medio si deve sbagliare piu\' che a difficile');
    // ⚠️ Nemmeno a difficile e' zero: un pilota che non sbaglia MAI non e'
    // credibile. Ma resta sotto uno ogni due giri (invariante 7 della spec),
    // altrimenti chi sceglie il livello alto vince per gli errori altrui.
    assert.ok(d.erroriPerGiro > 0, 'a difficile non sbagliano mai: non e\' credibile');
    assert.ok(d.erroriPerGiro < 0.5, 'a difficile si sbaglia troppo per un livello alto');
    // E a facile non si diventa uno spettacolo di uscite di pista: misurato
    // sul banco, 1.2 errori a giro fanno +0.3 punti di tick fuori dal
    // cordolo (9.2% contro 8.9%). Sopra i due errori a giro non e' piu' stato
    // misurato niente, e quindi non ci si va.
    assert.ok(f.erroriPerGiro <= 2, 'a facile si sbaglia oltre quanto sia stato misurato');
});
test('salendo di livello si sta piu\' vicini alla linea buona', () => {
    const f = F1Difficolta.intervalliDi('facile');
    const m = F1Difficolta.intervalliDi('medio');
    const d = F1Difficolta.intervalliDi('difficile');
    // ⚠️ Allargarsi COSTA: misurato su `prova`, 0.20 vale +650 ms al giro e
    // 0.35 vale +1100 ms, perche' il bot calcola la velocita' in curva dalla
    // curvatura della LINEA e non della traiettoria che percorre davvero —
    // paga il percorso lungo senza incassare il raggio ampio. Un livello alto
    // non se lo puo' permettere.
    assert.ok(d.allargaMax <= m.allargaMax, 'difficile si allarga piu\' di medio');
    assert.ok(m.allargaMax <= f.allargaMax, 'medio si allarga piu\' di facile');
    for (const l of F1Difficolta.LIVELLI) {
        const i = F1Difficolta.intervalliDi(l);
        assert.ok(i.allargaMax > i.allargaMin, l + ': guidano tutti uguale, non e\' un intervallo');
        // Oltre 0.4 non e' stato misurato niente, e a 0.45 i bot perdevano
        // 1.5 s al giro: tanto quanto tutto il divario dall'umano.
        assert.ok(i.allargaMax <= 0.4, l + ': allargamento oltre quanto sia stato misurato');
        assert.ok(i.allargaMin >= 0, l + ': allargamento negativo (taglierebbe l\'apice)');
    }
});
