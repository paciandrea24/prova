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
