// backend/sockets/games/f1GameSocket.pitEntry.test.js
//
// Entrando in corsia box l'auto non deve tornare indietro.
//
// Il difetto che questi test proteggono (segnalato in playtest, presente da
// sempre): `startPitLaneEntry` puntava l'autopilota al campione 1 della
// corsia box, sempre, chiunque fosse la pista. Ma il trigger d'ingresso non
// sta sopra il campione 1: sta dove il tracciato lo mette. Misurato, la
// distanza fra il campione 1 e quello sotto il trigger:
//
//   prova         campione 25 di 300  ->  42.3 unità INDIETRO
//   new-monza     campione 47         ->  41.4 unità indietro
//   monte-rosso   campione  8         ->   4.5 unità indietro
//
// L'auto entrava, tornava indietro fino all'imbocco e solo dopo ripartiva —
// e su monte-rosso, dove lo scarto è piccolo, quasi non si notava.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const f1 = require('./f1GameSocket.js');
const { loadTrack } = require('./trackLoader.js');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');

const TRACCIATI = fs
    .readdirSync(path.join(__dirname, '..', '..', '..', 'frontend', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

const ioFinto = { to: () => ({ emit: () => { } }) };

for (const id of TRACCIATI) {
    test(`${id}: entrando ai box l'autopilota riparte da dove sei, non dall'imbocco`, () => {
        const track = loadTrack(id);
        const trigger = track.pitEntryTrigger;
        // L'auto è dove il gioco fa scattare l'ingresso: sul trigger.
        const p = { color: 'red', x: trigger.x, z: trigger.z, angle: 0, speed: 2 };

        f1.physics.startPitLaneEntry(ioFinto, 'L', { track, socketByColor: {} }, p);

        const mira = track.pitLanePts[p.pitPathIndex];
        const distanza = Math.hypot(mira.x - p.x, mira.z - p.z);
        assert.ok(distanza < 20,
            `l'autopilota punta a ${distanza.toFixed(1)} unità dall'auto: ` +
            `campione ${p.pitPathIndex}, mentre l'auto sta sul ${TrackGeometry.nearestPoint(track.pitLanePts, p.x, p.z).index}`);
    });

    // ═══ ESSERE NELLA CORSIA BOX BASTA, IL RIQUADRO NON È L'UNICA PORTA ═══
    //
    // Su monte-rosso il riquadro-trigger è posato nel vuoto fra bordo pista e
    // corsia: la corsia campionata gli passa a 7.1 unità nel punto più vicino,
    // il nastro a 5.7. Nessuno poteva entrare ai box su quella pista — né i
    // bot né un umano — e chi non si ferma prende 30 secondi di penalità a fine
    // gara. Segnalato dall'utente ("ci provano ma non riescono").
    //
    // Il riquadro resta il modo NORMALE di entrare (lo si piazza in editor per
    // decidere dove comincia la corsia); questa è la rete di sicurezza
    // geometrica: se l'auto ha lasciato il nastro ed è dentro la corsia,
    // sta entrando ai box, comunque sia messo il riquadro.
    test(`${id}: guidare dentro la corsia box fa scattare l'ingresso`, () => {
        const track = loadTrack(id);
        const s = track.pitLanePts[40];   // ben oltre il raccordo, fuori dal nastro su tutte le piste
        assert.ok(f1.physics.inPitEntryZone({ x: s.x, z: s.z }, track),
            `campione 40 della corsia box (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) non riconosciuto come ingresso`);
    });

    test(`${id}: correre sul nastro non fa MAI scattare l'ingresso ai box`, () => {
        const track = loadTrack(id);
        const falsiAllarmi = [];
        for (let i = 0; i < track.points.length; i++) {
            const c = track.points[i];
            if (f1.physics.inPitEntryZone({ x: c.x, z: c.z }, track)) falsiAllarmi.push(i);
        }
        // Il riquadro-trigger vero può coprire il centro pista (è lì per
        // questo su alcune piste): si contano solo i campioni che scattano
        // per la regola nuova, cioè quelli FUORI dal riquadro.
        const perLaCorsia = falsiAllarmi.filter(i => !TrackGeometry.pointInOrientedBox(
            track.points[i].x, track.points[i].z, track.pitEntryTrigger));
        assert.deepEqual(perLaCorsia, [],
            `campioni di pista scambiati per corsia box: ${perLaCorsia.join(', ')}`);
    });

    // ⚠️ UNA COSA, UNA MISURA. Il bot si considera "già sull'imbocco" fino a
    // pitRoadHalf + PIT_LANE_ON_LANE_MARGIN dalla linea della corsia (mezza
    // vettura di tolleranza: insegue un centro-corsia, non ci sta incollato),
    // ma il server lo riconosceva solo entro pitRoadHalf esatto. Nel mezzo
    // c'era un limbo: il bot crede di essere entrato, il server non gli prende
    // il volante, e la corsia finisce — misurato su prova-notturno, quattro
    // bot su quindici sfioravano la corsia a 5.5-6.6 unità (tolleranza 5) e
    // tornavano in pista, chiudendo la gara senza sosta e con 30s di penalità.
    test(`${id}: quel che il bot considera già sulla corsia, il server lo riconosce come ingresso`, () => {
        const track = loadTrack(id);
        const pl = track.pitLanePts;
        const finestra = Math.min(pl.length - 1, Math.max(2, Math.floor(pl.length * 0.25)));

        // Il primo campione dell'imbocco che ha già lasciato il nastro: prima
        // di lì la corsia corre ancora dentro la carreggiata (su prova succede
        // fino al campione 10) e nessuno può essere "fuori dal nastro" lì.
        let i = -1;
        for (let k = 1; k <= finestra; k++) {
            if (TrackGeometry.nearestPoint(track.points, pl[k].x, pl[k].z).dist > track.roadHalf) { i = k; break; }
        }
        assert.ok(i > 0, `nessun campione dell'imbocco fuori dal nastro entro il primo quarto della corsia`);

        // Scostato dalla linea della corsia quanto basta a stare nel limbo, e
        // scostato dalla parte OPPOSTA alla pista, così resta fuori dal nastro.
        const c = TrackGeometry.nearestPoint(track.points, pl[i].x, pl[i].z);
        const asse = track.points[c.index];
        const dx = pl[i].x - asse.x, dz = pl[i].z - asse.z;
        const n = Math.hypot(dx, dz) || 1;
        const scarto = track.pitRoadHalf + 2.5;   // oltre pitRoadHalf, dentro la tolleranza del bot
        const auto = { x: pl[i].x + dx / n * scarto, z: pl[i].z + dz / n * scarto };

        assert.ok(f1.physics.inPitEntryZone(auto, track),
            `auto a ${scarto} unità dalla linea della corsia (campione ${i}) e fuori dal nastro: ` +
            `il bot la considera entrata, il server no`);
    });

    test(`${id}: il punto mirato all'ingresso sta AVANTI, non dietro`, () => {
        const track = loadTrack(id);
        const trigger = track.pitEntryTrigger;
        const p = { color: 'red', x: trigger.x, z: trigger.z, angle: 0, speed: 2 };

        f1.physics.startPitLaneEntry(ioFinto, 'L', { track, socketByColor: {} }, p);

        const dove = TrackGeometry.nearestPoint(track.pitLanePts, p.x, p.z).index;
        assert.ok(p.pitPathIndex >= dove,
            `mira il campione ${p.pitPathIndex} mentre l'auto è già al ${dove}: ` +
            `l'autopilota la farebbe tornare indietro`);
    });
}
