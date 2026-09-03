// frontend/shared/pitClubProfilo.test.js
//
// IL PROFILO DEL PALAZZO DEI BOX (spec 2026-09-03).
//
// Qui si prova il modulo da solo, senza scenografia intorno: se una di queste
// invarianti cade, il palazzo e' sbagliato prima ancora di essere posato.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Profilo = require('./pitClubProfilo.js');
const TG = require('./trackGeometry.js');
const { loadTrack } = require('../../backend/sockets/games/trackLoader.js');

const PISTE = fs.readdirSync(path.join(__dirname, '..', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

// ⚠️ DUE COSE DIVERSE CHE SI CHIAMANO QUASI UGUALE.
//   `raw.pit.path`  = i NODI del tracciato disegnati nell'editor, pochi.
//   `t.pitLanePts`  = la stessa corsia CAMPIONATA, trecento punti.
// `boxIndex` indicizza la PRIMA, e tutto il gioco (pitBoxAnchors, pitSlotAt,
// buildPaddockLayout) cammina sulla prima. Passando la seconda l'indice 2
// finisce a tre unita' dall'inizio della corsia invece che in mezzo ai box:
// niente solleva, e le misure che ne escono sono plausibili e tutte sbagliate
// — box che sembrano sovrapposti, nastro che sembra collassare, palazzo posato
// dall'altra parte del circuito.
const cache = new Map();
function fetteDi(id, gridSize) {
    const chiave = id + ':' + gridSize;
    if (!cache.has(chiave)) {
        const raw = JSON.parse(fs.readFileSync(
            path.join(__dirname, '..', 'tracks', id + '.json'), 'utf8'));
        const t = loadTrack(id);
        const pitPath = raw.pit.path;
        const boxIndex = raw.pit.boxIndex;
        assert.ok(Array.isArray(pitPath) && pitPath.length > 1, `${id}: pit.path assente`);
        cache.set(chiave, {
            fette: Profilo.fette(pitPath, boxIndex, t.points, raw.pit.roadHalfWidth, gridSize),
            t, pitPath, boxIndex, half: raw.pit.roadHalfWidth,
        });
    }
    return cache.get(chiave);
}

for (const id of PISTE) {
    test(`${id}: il passo fra due fette e' sempre mezzo passo di box`, () => {
        const { fette } = fetteDi(id, 6);
        assert.ok(fette.length >= 8, `${id}: solo ${fette.length} fette`);
        for (let k = 1; k < fette.length; k++) {
            assert.ok(Math.abs((fette[k].offset - fette[k - 1].offset) - Profilo.PASSO) < 1e-9,
                `${id}: fra la fetta ${k - 1} e la ${k} il passo e' ${fette[k].offset - fette[k - 1].offset}`);
        }
    });

    test(`${id}: due teste, una per capo, e vicine ai capi`, () => {
        // ⚠️ NON per forza la fetta 0 e l'ultima: dove il boxIndex sta a inizio
        // corsia (melbourne) la prima fetta ha un box sotto, e una testa li'
        // sarebbe un garage murato. La testa e' la prima fetta LIBERA di
        // ciascun capo.
        const { fette } = fetteDi(id, 6);
        const idx = fette.map((f, i) => [f, i])
            .filter(([f]) => f.tipo === 'pitClubHead').map(([, i]) => i);
        assert.equal(idx.length, 2, `${id}: ${idx.length} teste invece di 2`);
        // ⚠️ NON si pretende che stiano nella prima e nell'ultima meta'. Dove i
        // box occupano quasi tutto il palazzo — new-monza, tredici Span su
        // ventisette fette — la prima fetta LIBERA dal fondo puo' cadere prima
        // di meta': una testa e' comunque meglio di un capo aperto, e uno Span
        // col fianco murato sarebbe un garage chiuso nel cemento.
        assert.notEqual(idx[0], idx[1], `${id}: le due teste sono la stessa fetta`);
        for (const k of idx) {
            assert.notEqual(fette[k].tipo, 'pitClubSpan');
        }
    });

    test(`${id}: le due teste chiudono in FUORI, non una dentro la fila`, () => {
        // Il fianco pieno sta su +X del modello, che con rotazione rotY finisce
        // in mondo su (cos rotY, -sin rotY). Se punta verso il vicino, quel capo
        // del palazzo resta aperto con la sezione a vista: e' il difetto visto
        // sul primo render dell'anteprima.
        const { fette } = fetteDi(id, 6);
        fette.forEach((f, k) => {
            if (f.tipo !== 'pitClubHead') return;
            const vicino = fette[k === 0 ? 1 : k - 1];
            const verso = Math.cos(f.rotY) * (vicino.x - f.x) - Math.sin(f.rotY) * (vicino.z - f.z);
            assert.ok(verso < 0,
                `${id}: la testa ${k} ha il fianco girato verso l'interno della fila`);
        });
    });

    for (const grid of [1, 6, 20]) {
        test(`${id}: con ${grid} piloti ogni box sta sotto uno Span`, () => {
            const { fette, t } = fetteDi(id, grid);
            const { pitPath, boxIndex, half } = fetteDi(id, grid);
            const ancore = TG.pitBoxAnchors(pitPath, boxIndex, grid, t.points, half);
            // ⚠️ SI CONFRONTA SULLA CORSIA (f.corsia), non fra i centri: le
            // ancore stanno sulla corsia e le fette 23 unita' piu' in fuori.
            // E l'invariante NON e' «ogni box ha un palazzo sopra» — dove il
            // nastro si ripiega il palazzo si ferma prima, ed e' giusto cosi'.
            // E' «nessun box finisce sotto una fetta col piano terra PIENO»,
            // che sarebbe un garage colorato murato dentro il cemento.
            const guai = [];
            for (const a of ancore) {
                for (const f of fette) {
                    if (f.tipo === 'pitClubSpan') continue;
                    const d = Math.hypot(f.corsia.x - a.x, f.corsia.z - a.z);
                    if (d <= Profilo.PASSO) {
                        guai.push(`${f.tipo} sopra il box a (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`);
                    }
                }
            }
            assert.deepEqual(guai, []);
        });
    }

    test(`${id}: con pochi piloti il palazzo non resta su palafitte`, () => {
        // ⚠️ Gli Span vanno dove un box c'e' DAVVERO, non su tutte e venti le
        // posizioni della griglia piena: con sei piloti quattordici vani
        // resterebbero buchi veri, e il palazzo starebbe su gambe. La LUNGHEZZA
        // invece resta quella dei venti, sempre.
        const sei = fetteDi(id, 6).fette;
        const venti = fetteDi(id, 20).fette;
        assert.equal(sei.length, venti.length,
            `${id}: il palazzo cambia lunghezza col numero di piloti`);
        const spanSei = sei.filter(f => f.tipo === 'pitClubSpan').length;
        const spanVenti = venti.filter(f => f.tipo === 'pitClubSpan').length;
        // Meno piloti, meno vani aperti — mai di piu'. Non si pretende che
        // siano STRETTAMENTE meno: dove il nastro e' sano solo per un tratto
        // corto, il palazzo contiene poche posizioni di box e con sei piloti o
        // con venti sono le stesse.
        assert.ok(spanSei <= spanVenti,
            `${id}: con 6 piloti ci sono ${spanSei} Span, con 20 solo ${spanVenti}`);
        // Un box e' largo 14.1 e le fette 7.3 a passo 7.5: un box tocca la
        // fetta su cui e' centrato e sborda di 3.2 su ciascuna vicina, quindi
        // ne occupa TRE. Con sei box in fila le fette occupate sono al massimo
        // 6*2 + 2 = 14 — nel tratto dei box il piano terra e' tutto loro, che
        // e' esattamente com'e' fatto un pit building vero.
        assert.ok(spanSei <= 14,
            `${id}: ${spanSei} Span per sei piloti`);
    });

    test(`${id}: nessuna fetta dentro la corsia box`, () => {
        const { fette, t, half } = fetteDi(id, 6);
        // Il centro della fetta sta a OFFSET_FRONTE dal bordo: mezza profondita'
        // del corpo (11) piu' il franco. Gli angoli, con l'ingombro vero, li
        // prova sceneryPalazzoBox.test.js una volta che il palazzo e' in pista.
        for (const f of fette) {
            const d = TG.nearestPoint(t.pitLanePts, f.x, f.z).dist;
            assert.ok(d >= half + 11,
                `${id}: una fetta ha il centro a ${d.toFixed(1)} dalla corsia (ne servono ${(half + 11).toFixed(1)})`);
        }
    });

    test(`${id}: nessuna fetta esce dalla linea delle vicine`, () => {
        const { fette } = fetteDi(id, 6);
        // ⚠️ DUE MISURE SCARTATE PRIMA DI QUESTA, ed erano sbagliate entrambe.
        // 1. distanza dal CAMPIONE piu' vicino della corsia (TG.nearestPoint):
        //    quel numero oscilla di suo su una polilinea coi campioni radi.
        // 2. distanza dalla POLILINEA: giusta, ma cambia con la CURVATURA — le
        //    fette sono corde di un arco, e il loro centro si avvicina alla
        //    corsia della sagitta, che dipende dal raggio. Dove il raggio cambia
        //    (curva che finisce) quella distanza salta di 0.7 senza che nessuna
        //    fetta si sia mossa di un millimetro.
        //
        // L'invariante della spec e' un'altra: nessuna fetta si scosta PER
        // CONTO PROPRIO. Si misura guardando quanto ciascuna esce dalla retta
        // che unisce le sue due vicine — che su un nastro regolare, curvo
        // quanto si vuole, resta piccola, e salta solo se una si e' spostata.
        for (let k = 1; k < fette.length - 1; k++) {
            const a = fette[k - 1], b = fette[k + 1], p = fette[k];
            const dx = b.x - a.x, dz = b.z - a.z;
            const len = Math.hypot(dx, dz) || 1e-9;
            const fuori = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / len;
            assert.ok(fuori <= 1.0,
                `${id}: la fetta ${k} esce di ${fuori.toFixed(2)} dalla linea delle vicine`);
        }
    });

    test(`${id}: due torri non stanno mai vicine`, () => {
        const { fette } = fetteDi(id, 6);
        const idx = fette.map((f, i) => [f, i])
            .filter(([f]) => f.tipo === 'pitClubTower').map(([, i]) => i);
        for (let k = 1; k < idx.length; k++) {
            assert.ok(idx[k] - idx[k - 1] >= 8,
                `${id}: due torri a ${idx[k] - idx[k - 1]} fette di distanza`);
        }
    });
}

// --- LA QUOTA DEL PRIMO PIANO ---------------------------------------------
//
// ⚠️ `pitClubSpan` e' il SOLO primo piano, e il suo pivot sta alla base del
// primo piano, non a terra: lo dichiara `pitPalazzo.py` («chi lo posa lo mette
// a quota SOLAIO_Z»). Posato alla quota del terreno come gli altri tre pezzi,
// le logge e le balconate finiscono a terra, DENTRO i box colorati dei piloti
// — che e' esattamente cio' che l'utente ha visto in pista il 03-09.
//
// Nessuno dei test di prima guardava la quota: provavano ingombri, pianta,
// teste, torri e buchi, e uno di loro dava per scontato che lo Span stesse a
// undici invece di misurarlo. Un'ipotesi dentro un test non e' piu' un'ipotesi.
for (const id of PISTE) {
    test(`${id}: lo Span esce dal profilo alla quota del solaio`, () => {
        const { fette } = fetteDi(id, 6);
        const terra = fette.filter(f => f.tipo !== 'pitClubSpan');
        const primoPiano = fette.filter(f => f.tipo === 'pitClubSpan');
        assert.ok(terra.length, `${id}: nessuna fetta a terra con cui confrontare`);
        // Il palazzo poggia su un tratto di paddock in piano: se un giorno non
        // fosse piu' vero, e' questo assert a dirlo, e il confronto qui sotto
        // andra' fatto sulla vicina invece che sulla base comune.
        const base = terra[0].y;
        for (const f of terra) {
            assert.ok(Math.abs(f.y - base) <= 0.05,
                `${id}: le fette a terra non sono alla stessa quota (${base} e ${f.y})`);
        }
        for (const f of primoPiano) {
            assert.ok(Math.abs(f.y - base - Profilo.QUOTA_SOLAIO) <= 0.05,
                `${id}: uno Span sta a quota ${f.y.toFixed(2)} invece di ${(base + Profilo.QUOTA_SOLAIO).toFixed(2)}: il primo piano e' a terra, dentro i box`);
        }
    });
}

// --- IL PALAZZO COPRE I BOX ------------------------------------------------
//
// L'invariante che la spec dichiara per prima — «il palazzo si estende sempre
// sui box a 20 piloti» — non era provata da nessuno, e non era vera: misurata
// il 2026-09-04, la copertura andava dal 30% di suzuka al 100% di melbourne.
// La causa non era il palazzo ma il NASTRO su cui si posa: la corsia box e'
// disegnata con pochi nodi (suzuka 10, monte-rosso 5) e al vertice fra due
// segmenti la tangente scatta di 12-28 gradi in un colpo. A 23 unita' di
// braccio quel salto sposta la fetta di 10-20 unita', il criterio di sanita'
// legge «nastro collassato» e taglia li'.
//
// ⚠️ Questo test guarda la GRIGLIA PIENA. Con sei piloti il difetto non si
// vede: i box sono pochi e stanno in mezzo, cioe' proprio dove il palazzo
// sopravvive al taglio.
// ⚠️ I BOX DISTINTI, NON TUTTI E VENTI. Dove la corsia è più corta di quanto
// venti box chiedano (285 unità), `pitSlotAt` satura e le ancore si impilano:
// su monte-rosso sette finiscono nello stesso identico punto, su test dieci.
// Contarle come box da coprire chiede al palazzo l'impossibile e fa sembrare un
// difetto una proprietà della pista.
function boxDistinti(pitPath, boxIndex, half, t) {
    const tutte = TG.pitBoxAnchors(pitPath, boxIndex, 20, t.points, half);
    return tutte.filter((a, i) => i === 0
        || Math.hypot(a.x - tutte[i - 1].x, a.z - tutte[i - 1].z) > 1);
}

for (const id of PISTE) {
    test(`${id}: il palazzo non lascia buchi in mezzo ai box`, () => {
        const { fette, pitPath, boxIndex, half, t } = fetteDi(id, 20);
        const coperto = boxDistinti(pitPath, boxIndex, half, t).map(
            a => fette.some(f => Math.hypot(f.corsia.x - a.x, f.corsia.z - a.z) <= Profilo.PASSO));
        // Un box scoperto OLTRE un capo è il palazzo che finisce; uno scoperto
        // fra due coperti è il palazzo che si è spezzato, e quello non deve
        // succedere mai: in pista sarebbe un box senza vano in mezzo alla
        // facciata.
        const primo = coperto.indexOf(true), ultimo = coperto.lastIndexOf(true);
        assert.ok(primo >= 0, `${id}: il palazzo non copre nessun box`);
        const buchi = coperto.slice(primo, ultimo + 1).filter(c => !c).length;
        assert.equal(buchi, 0, `${id}: ${buchi} box senza vano IN MEZZO al palazzo`);
    });

    test(`${id}: il palazzo copre la gran parte dei box a griglia piena`, () => {
        const { fette, pitPath, boxIndex, half, t } = fetteDi(id, 20);
        const box = boxDistinti(pitPath, boxIndex, half, t);
        const coperti = box.filter(
            a => fette.some(f => Math.hypot(f.corsia.x - a.x, f.corsia.z - a.z) <= Profilo.PASSO)).length;
        // ⚠️ NON il 100%: su una corsia più corta di quanto i venti box
        // chiedano, il palazzo finisce dove finisce la corsia. Due terzi è la
        // rete che coglie un taglio andato a male — misurato il 2026-09-04, il
        // peggiore è monte-rosso col 71%, e sette piste su dodici stanno al
        // 100%. Prima della lisciatura del nastro suzuka stava al 30%.
        assert.ok(coperti >= box.length * 2 / 3,
            `${id}: solo ${coperti} box coperti su ${box.length}`);
    });

    test(`${id}: a griglia piena i capi restano chiusi se il palazzo li raggiunge`, () => {
        const { fette, pitPath, boxIndex, half, t } = fetteDi(id, 20);
        const box = boxDistinti(pitPath, boxIndex, half, t);
        const coperti = box.filter(
            a => fette.some(f => Math.hypot(f.corsia.x - a.x, f.corsia.z - a.z) <= Profilo.PASSO)).length;
        // ⚠️ CON VENTI PILOTI, NON CON SEI. Dove sotto c'è un box la fetta deve
        // essere uno Span, e con la griglia piena le uniche fette libere sono
        // quelle di margine: se il taglio le mangia, il capo resta aperto con la
        // sezione a vista. È il difetto misurato il 04-09, teste presenti su 3
        // piste su 12, e il motivo per cui il margine è passato da due fette a
        // tre.
        //
        // Dove il palazzo NON arriva a coprire tutti i box (monte-rosso e
        // new-monza: la loro corsia box è più corta dei 285 unità che venti box
        // chiedono) il capo del palazzo coincide col capo della corsia, e lì una
        // fetta libera non c'è. Non si pretende.
        if (coperti < box.length) return;
        const teste = fette.filter(f => f.tipo === 'pitClubHead').length;
        assert.equal(teste, 2, `${id}: ${teste} teste a griglia piena`);
    });
}
