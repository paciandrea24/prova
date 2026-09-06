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
    assert.ok(F1Difficolta.soglieDi('difficile').coperturaDifesa >
              F1Difficolta.soglieDi('medio').coperturaDifesa);
    assert.ok(F1Difficolta.soglieDi('medio').coperturaDifesa >
              F1Difficolta.soglieDi('facile').coperturaDifesa);
    // ⚠️ E resta una difesa, non un blocco: 1 vuol dire «gli vado davanti»,
    // che e' il massimo lecito. Oltre, il bot mirerebbe PIU' IN LA' della
    // linea dell'attaccante, cioe' verrebbe a prendersi la sua metrata —
    // quello non e' coprirsi, e' buttarlo fuori.
    for (const l of F1Difficolta.LIVELLI) {
        assert.ok(F1Difficolta.soglieDi(l).coperturaDifesa <= 1,
            l + ': si mira oltre la linea dell\'attaccante, non e\' una difesa');
    }
});

// ⚠️ QUESTO TEST HA SOSTITUITO UN'IPOTESI SBAGLIATA, e vale la pena dire
// quale. Fino al 2026-09-06 qui si pretendeva che la difesa valesse
// ESATTAMENTE quanto l'attacco (BOT_OVERTAKE_FRACTION, 0.55 della mezza
// carreggiata), col ragionamento «sono le due meta' dello stesso duello,
// stessa scala». Sembrava simmetrico ed era falso: chi attacca si sposta
// verso lo spazio libero e lo trova, chi difende deve coprire una porta la
// cui larghezza dipende da dove passa la sua linea. Su `prova` sono 16.3
// unita' contro le 6.05 che quel numero concedeva.
//
// Il test rendeva definitiva quell'ipotesi: legava i due numeri, quindi
// nessuna taratura della difesa poteva passare senza toccare anche
// l'attacco. Un'ipotesi dentro un test non e' piu' un'ipotesi.
test('la difesa si misura sulla porta, non sull\'attacco', () => {
    const R = 11;          // mezza carreggiata di `prova`
    const AUTO = 3.48;
    const F1Duelli = require('./f1Duelli.js');
    // La situazione vera: la linea dei bot passa a 6 dall'asse, l'attaccante
    // arriva dal lato largo ed e' incollato.
    const porta = (livello) => {
        const d = F1Duelli.scostamentoDifensivo({
            latLinea: 6, latAttaccante: -6, gapM: 0, finestraM: 120,
            copertura: F1Difficolta.soglieDi(livello).coperturaDifesa,
            scostamentoAttuale: 0, affiancato: false, ultimoCambioMs: 0, adessoMs: 1e6,
        });
        return (R + (6 + d.scostamento)) / AUTO;   // auto affiancate dal lato dell'attacco
    };
    assert.ok(porta('difficile') < 1.6,
        `a difficile la porta resta ${porta('difficile').toFixed(2)} auto: ci si passa senza sterzare`);
    assert.ok(porta('medio') < 2.8, 'a medio la porta e\' ancora un\'autostrada');
    assert.ok(porta('facile') > porta('medio') && porta('medio') > porta('difficile'),
        'salendo di livello la porta si stringe');
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
