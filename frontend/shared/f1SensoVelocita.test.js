// frontend/shared/f1SensoVelocita.test.js
//
// Di questo modulo l'aspetto non e' verificabile qui e non si finge di farlo:
// il campo visivo che si apre si guarda in pista. Cio' che si puo' verificare,
// e che se si rompe si rompe in silenzio, e' TRE cose:
//
// 1. l'indipendenza dal frame rate: la stessa manovra deve durare uguale a 30 e
//    a 144 fps, altrimenti chi tara i numeri li tara per la propria macchina;
// 2. gli estremi: fermi si sta a 65 (con cui e' tarato tutto il resto del
//    gioco) e a tutta velocita' si arriva davvero a 82;
// 3. il ritorno ISTANTANEO a 65 quando non si sta guidando: la vetrina
//    dell'auto in pole calcola la propria posizione da camera.fov, e un residuo
//    lasciato li' dalla gara appena finita le spostava l'auto fuori quadro.
const test = require('node:test');
const assert = require('node:assert/strict');
const SV = require('./f1SensoVelocita');

test('frazioneVelocita: fermi zero, a tutta uno', () => {
    assert.equal(SV.frazioneVelocita(0), 0);
    assert.equal(SV.frazioneVelocita(SV.VEL_RIFERIMENTO), 1);
    // Oltre il riferimento non si sfonda: il tetto e' un tetto.
    assert.equal(SV.frazioneVelocita(SV.VEL_RIFERIMENTO * 2), 1);
});

test('frazioneVelocita: sotto la soglia non si muove niente', () => {
    const sottoSoglia = SV.VEL_RIFERIMENTO * (SV.SOGLIA_APERTURA - 0.05);
    assert.equal(SV.frazioneVelocita(sottoSoglia), 0);
    // La corsia box col limitatore sta la' sotto: e' il caso che la soglia
    // esiste per proteggere.
    assert.equal(SV.fovObiettivo(sottoSoglia), SV.FOV_BASE);
});

test('frazioneVelocita: la retromarcia conta come velocita', () => {
    // La velocita' del server e' firmata; a marcia indietro si va piano, ma il
    // segno non deve far collassare la frazione a zero per magia.
    assert.equal(SV.frazioneVelocita(-SV.VEL_RIFERIMENTO), 1);
});

test('fovObiettivo: gli estremi sono quelli dichiarati', () => {
    assert.equal(SV.fovObiettivo(0), SV.FOV_BASE);
    assert.equal(SV.fovObiettivo(SV.VEL_RIFERIMENTO), SV.FOV_MASSIMO);
    // Monotono: piu' veloce non puo' mai voler dire piu' stretto.
    let prec = -Infinity;
    for (let v = 0; v <= SV.VEL_RIFERIMENTO; v += SV.VEL_RIFERIMENTO / 20) {
        const f = SV.fovObiettivo(v);
        assert.ok(f >= prec, `fov non monotono a v=${v}: ${f} < ${prec}`);
        prec = f;
    }
});

test('avanza: lo smorzamento e a tempo, non a frame', () => {
    // Stessa mezza manovra (500 ms di accelerazione a tavoletta) simulata a tre
    // frame rate diversi: il campo visivo raggiunto deve essere lo stesso.
    function dopo500msA(fps) {
        const stato = SV.creaStato();
        const dt = 1000 / fps;
        for (let t = 0; t < 500; t += dt) SV.avanza(stato, { velocita: SV.VEL_RIFERIMENTO }, dt);
        return stato.fov;
    }
    const a30 = dopo500msA(30);
    const a60 = dopo500msA(60);
    const a144 = dopo500msA(144);
    assert.ok(Math.abs(a30 - a60) < 0.5, `30 vs 60 fps: ${a30} vs ${a60}`);
    assert.ok(Math.abs(a60 - a144) < 0.5, `60 vs 144 fps: ${a60} vs ${a144}`);
    // E dopo il tempo caratteristico dichiarato si deve essere circa al 63%
    // della strada: e' il "mezzo secondo di ritardo" della specifica.
    const atteso = SV.FOV_BASE + (SV.FOV_MASSIMO - SV.FOV_BASE) * 0.632;
    assert.ok(Math.abs(a60 - atteso) < 1, `dopo TAU non siamo al 63%: ${a60}, atteso ~${atteso}`);
});

test('avanza: la chiusura e piu svelta dell apertura', () => {
    // La frenata deve essere un gesto: la strada torna a stringersi addosso
    // piu' in fretta di quanto si era aperta.
    const su = SV.creaStato();
    SV.avanza(su, { velocita: SV.VEL_RIFERIMENTO }, 200);
    const guadagnoInSalita = su.fov - SV.FOV_BASE;

    const giu = { fov: SV.FOV_MASSIMO };
    SV.avanza(giu, { velocita: 0 }, 200);
    const persoInDiscesa = SV.FOV_MASSIMO - giu.fov;

    const escursione = SV.FOV_MASSIMO - SV.FOV_BASE;
    assert.ok(persoInDiscesa / escursione > guadagnoInSalita / escursione,
        `chiusura non piu svelta: -${persoInDiscesa} contro +${guadagnoInSalita}`);
});

test('avanza: fuori dalla guida il campo visivo torna a 65 nello stesso frame', () => {
    const stato = { fov: SV.FOV_MASSIMO };
    SV.avanza(stato, { attivo: false }, 16);
    assert.equal(stato.fov, SV.FOV_BASE);
});

test('avanza: a tutta velocita si arriva davvero a 82', () => {
    const stato = SV.creaStato();
    for (let t = 0; t < 5000; t += 16) SV.avanza(stato, { velocita: SV.VEL_RIFERIMENTO }, 16);
    assert.ok(Math.abs(stato.fov - SV.FOV_MASSIMO) < 0.05, `arrivato a ${stato.fov}`);
});

test('passoVersoObiettivo: dt zero non muove nulla, tau zero arriva subito', () => {
    assert.equal(SV.passoVersoObiettivo(65, 82, 500, 0), 65);
    assert.equal(SV.passoVersoObiettivo(65, 82, 0, 16), 82);
});

// ── La molla ────────────────────────────────────────────────────────────────
//
// Accelerazioni MISURATE con la fisica vera del server (banco prova headless,
// 3 bot su `prova` e `monte-rosso`): l'accelerazione satura a 3.72 u/s², la
// frenata a ~8 u/s². Sono gli stessi numeri su cui e' tarata la scala della
// spinta, quindi qui si simulano quelli e non due valori inventati.
const ACCEL_PIENA = 3.72;    // unità/s²
const FRENO_PIENO = 8.0;     // unità/s²

// Fa girare `avanza` per `ms` millisecondi a 60 fps con un'accelerazione
// costante, partendo da `v0`. Restituisce lo stato.
function guida(stato, { v0 = 0, a = 0, ms = 1000, fps = 60 } = {}) {
    const dt = 1000 / fps;
    let v = v0;
    for (let t = 0; t < ms; t += dt) {
        v = Math.max(0, Math.min(SV.VEL_RIFERIMENTO, v + a * (dt / 1000)));
        SV.avanza(stato, { velocita: v }, dt);
    }
    return stato;
}

test('molla: a velocita costante la camera sta ferma', () => {
    const stato = SV.creaStato();
    guida(stato, { v0: 4, a: 0, ms: 2000 });
    assert.ok(Math.abs(stato.spinta) < 0.02, `spinta ${stato.spinta} a velocita costante`);
    const m = SV.molla(stato.spinta);
    assert.ok(Math.abs(m.dz) < 0.03 && Math.abs(m.dy) < 0.03, `camera mossa a velocita costante: ${JSON.stringify(m)}`);
});

test('molla: in accelerazione arretra e si abbassa, in frenata il contrario', () => {
    const acc = guida(SV.creaStato(), { v0: 1, a: ACCEL_PIENA, ms: 1200 });
    assert.ok(acc.spinta > 0.4, `accelerazione piena ha dato spinta ${acc.spinta}`);
    const mAcc = SV.molla(acc.spinta);
    assert.ok(mAcc.dz < 0, 'accelerando la camera deve arretrare (dz < 0)');
    assert.ok(mAcc.dy < 0, 'accelerando la camera deve abbassarsi (dy < 0)');
    assert.ok(mAcc.beccheggioDeg < 0, 'accelerando lo sguardo dell halo-cam deve alzarsi');

    const fre = guida(SV.creaStato(), { v0: SV.VEL_RIFERIMENTO, a: -FRENO_PIENO, ms: 700 });
    assert.ok(fre.spinta < -0.4, `frenata piena ha dato spinta ${fre.spinta}`);
    const mFre = SV.molla(fre.spinta);
    assert.ok(mFre.dz > 0 && mFre.dy > 0 && mFre.beccheggioDeg > 0,
        `frenata: la camera deve avvicinarsi e alzarsi, invece ${JSON.stringify(mFre)}`);
});

test('molla: le due scale sono tarate, non satura ne resta muta', () => {
    // Il difetto che le due scale separate esistono per evitare: con una scala
    // sola, o l'accelerazione non si vede o la frenata sbatte al fondo.
    const acc = guida(SV.creaStato(), { v0: 1, a: ACCEL_PIENA, ms: 1500 });
    const fre = guida(SV.creaStato(), { v0: SV.VEL_RIFERIMENTO, a: -FRENO_PIENO, ms: 700 });
    assert.ok(acc.spinta > 0.35 && acc.spinta <= 1, `accelerazione fuori scala: ${acc.spinta}`);
    assert.ok(fre.spinta < -0.35 && fre.spinta >= -1, `frenata fuori scala: ${fre.spinta}`);
    assert.equal(Math.abs(SV.molla(2).dz), SV.MOLLA_ARRETRAMENTO, 'la molla non deve sfondare oltre spinta 1');
});

test('molla: indipendente dal frame rate', () => {
    const a30 = guida(SV.creaStato(), { v0: 1, a: ACCEL_PIENA, ms: 800, fps: 30 }).spinta;
    const a60 = guida(SV.creaStato(), { v0: 1, a: ACCEL_PIENA, ms: 800, fps: 60 }).spinta;
    const a144 = guida(SV.creaStato(), { v0: 1, a: ACCEL_PIENA, ms: 800, fps: 144 }).spinta;
    assert.ok(Math.abs(a30 - a60) < 0.05, `30 vs 60 fps: ${a30} vs ${a60}`);
    assert.ok(Math.abs(a60 - a144) < 0.05, `60 vs 144 fps: ${a60} vs ${a144}`);
});

test('molla: uscire e rientrare in pista non inventa una frenata', () => {
    // Dieci secondi di schermata a 300 km/h alle spalle: al rientro il primo
    // campione deve reinizializzare i filtri, non generare un transitorio.
    const stato = guida(SV.creaStato(), { v0: 5, a: ACCEL_PIENA, ms: 1000 });
    SV.avanza(stato, { attivo: false }, 16);
    assert.equal(stato.spinta, 0);
    SV.avanza(stato, { velocita: 5.5 }, 16);
    assert.ok(Math.abs(stato.spinta) < 0.01, `primo frame al rientro: spinta ${stato.spinta}`);
    assert.equal(stato.velVeloce, stato.velLenta, 'i filtri devono ripartire allineati');
});

test('molla: la velocita a scalini della rete non fa tremare la camera', () => {
    // La velocita' arriva dal server a 20 Hz ma animate() gira a 60: lo stesso
    // valore si ripete per 3 frame. Il filtro veloce (80 ms) e' piu' lento dello
    // scalino di proposito — se non lo fosse, la molla sfarfallerebbe a ogni
    // pacchetto anche in accelerazione perfettamente costante.
    const stato = SV.creaStato();
    let v = 2, ultimoAggiornamento = 0, vRete = 2;
    const storia = [];
    for (let t = 0; t < 1500; t += 16.7) {
        v = Math.min(SV.VEL_RIFERIMENTO, v + ACCEL_PIENA * 0.0167);
        if (t - ultimoAggiornamento >= 50) { vRete = v; ultimoAggiornamento = t; }
        SV.avanza(stato, { velocita: vRete }, 16.7);
        if (t > 500) storia.push(stato.spinta);
    }
    // Nessuna inversione di direzione della molla: l'accelerazione e' monotona,
    // e la camera non deve mai andare avanti e indietro mentre accelero.
    let inversioni = 0;
    for (let i = 2; i < storia.length; i++) {
        const d1 = storia[i - 1] - storia[i - 2];
        const d2 = storia[i] - storia[i - 1];
        if (d1 * d2 < 0 && Math.abs(d2) > 0.002) inversioni++;
    }
    assert.equal(inversioni, 0, `la molla ha cambiato direzione ${inversioni} volte in accelerazione costante`);
});
