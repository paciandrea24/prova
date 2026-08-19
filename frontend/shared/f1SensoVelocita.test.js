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
const TG = require('./trackGeometry.js');
const { loadTrack } = require('../../backend/sockets/games/trackLoader.js');

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

// ── Gli scossoni ────────────────────────────────────────────────────────────

test('scossone: sull asfalto la camera e ferma', () => {
    const stato = SV.creaStato();
    for (let t = 0; t < 1000; t += 16) {
        SV.avanza(stato, { velocita: SV.VEL_RIFERIMENTO, superficie: SV.ASFALTO }, 16);
    }
    const s = SV.scossone(stato);
    // Math.abs perche' il prodotto per una sinusoide negativa da' -0, che con
    // assert.equal in modalita' strict non e' 0.
    assert.equal(Math.abs(s.dx), 0);
    assert.equal(Math.abs(s.dy), 0);
    assert.equal(Math.abs(s.rollRad), 0);
});

test('scossone: proporzionale alla velocita', () => {
    function ampiezzaA(velocita) {
        const stato = SV.creaStato();
        let max = 0;
        for (let t = 0; t < 1500; t += 16) {
            SV.avanza(stato, { velocita, superficie: SV.CORDOLO }, 16);
            if (t > 500) max = Math.max(max, Math.abs(SV.scossone(stato).dy));
        }
        return max;
    }
    const piano = ampiezzaA(SV.VEL_RIFERIMENTO * 0.2);
    const forte = ampiezzaA(SV.VEL_RIFERIMENTO);
    assert.ok(forte > piano * 3, `a tutta ${forte} contro ${piano} al 20%`);
    assert.ok(piano > 0, 'a bassa velocita il cordolo deve comunque sentirsi');
});

test('scossone: il cordolo pesa meta del fuoripista', () => {
    // Gerarchia voluta (playtest 2026-08-19): il cordolo lo prendi in
    // traiettoria decine di volte per giro ed e' routine; erba e ghiaia sono un
    // errore e devono restare un evento. A regime, alla stessa velocita', la
    // vibrazione del cordolo deve valere la meta di quella del fuoripista.
    function aRegime(superficie) {
        const stato = SV.creaStato();
        for (let t = 0; t < 1500; t += 16) SV.avanza(stato, { velocita: SV.VEL_RIFERIMENTO, superficie }, 16);
        return stato;
    }
    const suCordolo = aRegime(SV.CORDOLO);
    const fuori = aRegime(SV.FUORI);
    assert.ok(Math.abs(suCordolo.intCordolo - SV.PESO_CORDOLO) < 0.01,
        `intensita cordolo a regime: ${suCordolo.intCordolo}`);
    assert.ok(Math.abs(fuori.intFuori - SV.PESO_FUORI) < 0.01,
        `intensita fuoripista a regime: ${fuori.intFuori}`);

    // E in ampiezza vera, non solo nell'intensita interna: il cordolo deve
    // risultare piu leggero del fuoripista, non solo diverso.
    const ampCordolo = suCordolo.intCordolo * SV.SCOSSONE_CORDOLO.dy;
    const ampFuori = fuori.intFuori * SV.SCOSSONE_FUORI.dy;
    assert.ok(ampCordolo < ampFuori, `cordolo ${ampCordolo} non piu leggero di fuori ${ampFuori}`);
});

test('scossone: fermi non succede niente nemmeno in ghiaia', () => {
    // Insabbiato e fermo: la camera non deve vibrare da sola.
    const stato = SV.creaStato();
    for (let t = 0; t < 1000; t += 16) SV.avanza(stato, { velocita: 0, superficie: SV.FUORI }, 16);
    assert.ok(Math.abs(SV.scossone(stato).dy) < 1e-9);
});

test('scossone: la camera d inseguimento trasla, quella sul telaio ruota', () => {
    // Il difetto che questa separazione esiste per risolvere (playtest
    // 2026-08-19, "dall'halo la macchina si vede saltare moltissimo"): la
    // scocca sta a mezza unita' dall'obiettivo, e traslare li' la sposta
    // nell'inquadratura di decine di gradi mentre il mondo lontano resta
    // fermo. Non e' una vibrazione, e' parallasse.
    const stato = SV.creaStato();
    for (let t = 0; t < 800; t += 16) SV.avanza(stato, { velocita: SV.VEL_RIFERIMENTO, superficie: SV.FUORI }, 16);

    const inseguimento = SV.scossone(stato);
    assert.ok(Math.abs(inseguimento.dy) > 0 && Math.abs(inseguimento.dx) > 0, 'da fuori deve traslare');
    assert.equal(inseguimento.pitchRad, 0, 'da fuori niente beccheggio: basta la traslazione');
    assert.equal(inseguimento.yawRad, 0);

    const halo = SV.scossone(stato, { halo: true });
    assert.equal(halo.dy, 0, 'sul telaio la camera NON si sposta rispetto all auto');
    assert.equal(halo.dx, 0);
    assert.ok(Math.abs(halo.pitchRad) > 0 && Math.abs(halo.yawRad) > 0, 'sul telaio deve ruotare');

    // Il rollio c'e' in entrambe (e' una rotazione anche da fuori, non fa
    // parallasse): e' li che si verifica il moltiplicatore dell halo-cam.
    assert.ok(Math.abs(Math.abs(halo.rollRad) / Math.abs(inseguimento.rollRad) - SV.SCOSSONE_HALO_MULT) < 1e-9,
        `moltiplicatore halo: ${Math.abs(halo.rollRad) / Math.abs(inseguimento.rollRad)}`);
});

test('scossone: gli angoli dell halo restano dell ordine del grado', () => {
    // Un grado e' gia' molto per una camera a mezza unita dalla scocca: sopra i
    // due, l'inquadratura non trema piu, sbanda.
    const stato = SV.creaStato();
    let maxPitch = 0, maxYaw = 0, maxRoll = 0;
    for (let t = 0; t < 2000; t += 16) {
        SV.avanza(stato, { velocita: SV.VEL_RIFERIMENTO, superficie: SV.CORDOLO }, 16);
        const s = SV.scossone(stato, { halo: true });
        maxPitch = Math.max(maxPitch, Math.abs(s.pitchRad));
        maxYaw = Math.max(maxYaw, Math.abs(s.yawRad));
        maxRoll = Math.max(maxRoll, Math.abs(s.rollRad));
    }
    const gradi = (rad) => rad * 180 / Math.PI;
    for (const [nome, v] of [['beccheggio', maxPitch], ['imbardata', maxYaw], ['rollio', maxRoll]]) {
        assert.ok(gradi(v) > 0.1, `${nome} impercettibile: ${gradi(v).toFixed(2)}°`);
        assert.ok(gradi(v) < 2, `${nome} troppo ampio: ${gradi(v).toFixed(2)}°`);
    }
});

test('scossone: passare dal cordolo all erba si fonde, non scatta', () => {
    // Le due intensita' sono separate proprio per questo: con una sola, il
    // cambio di superficie cambiava i parametri sotto e si vedeva uno scatto.
    //
    // Si guarda l'INVILUPPO, non il valore istantaneo: a 11 Hz una sinusoide
    // cambia molto in un frame da 16 ms, e confrontare due campioni successivi
    // misurerebbe l'oscillazione normale, non una discontinuita'.
    const inviluppo = (s) => s.intCordolo * SV.SCOSSONE_CORDOLO.dy + s.intFuori * SV.SCOSSONE_FUORI.dy;
    const stato = SV.creaStato();
    for (let t = 0; t < 1000; t += 16) SV.avanza(stato, { velocita: 5, superficie: SV.CORDOLO }, 16);
    const primaDelCambio = inviluppo(stato);
    SV.avanza(stato, { velocita: 5, superficie: SV.FUORI }, 16);
    const dopoUnFrame = inviluppo(stato);
    assert.ok(Math.abs(dopoUnFrame - primaDelCambio) < 0.01,
        `salto d ampiezza di ${Math.abs(dopoUnFrame - primaDelCambio)} in un frame`);
    // E dopo un decimo di secondo il cordolo si e' quasi spento.
    for (let t = 0; t < 200; t += 16) SV.avanza(stato, { velocita: 5, superficie: SV.FUORI }, 16);
    assert.ok(stato.intCordolo < 0.06, `il cordolo non si spegne: ${stato.intCordolo}`);
});

test('scossone: la vibrazione e la stessa a 30 e a 144 fps', () => {
    // Non si confrontano i valori istante per istante (le fasi campionate a
    // frame rate diversi non coincidono), ma l'INVILUPPO: ampiezza massima e
    // numero di oscillazioni in un secondo devono essere gli stessi.
    function inviluppo(fps) {
        const stato = SV.creaStato();
        const dt = 1000 / fps;
        let max = 0, cambiSegno = 0, prec = 0;
        for (let t = 0; t < 2000; t += dt) {
            SV.avanza(stato, { velocita: SV.VEL_RIFERIMENTO, superficie: SV.CORDOLO }, dt);
            if (t < 1000) continue;
            const y = SV.scossone(stato).dy;
            max = Math.max(max, Math.abs(y));
            if (prec * y < 0) cambiSegno++;
            prec = y;
        }
        return { max, cambiSegno };
    }
    const a30 = inviluppo(30);
    const a60 = inviluppo(60);
    const a144 = inviluppo(144);
    assert.ok(Math.abs(a60.max - a144.max) < 0.02, `ampiezza 60 vs 144: ${a60.max} vs ${a144.max}`);
    // A 30 fps una vibrazione da 13 Hz e' al limite di Nyquist: l'ampiezza
    // campionata cala per forza, ma non deve sparire.
    assert.ok(a30.max > a60.max * 0.5, `a 30 fps la vibrazione sparisce: ${a30.max} contro ${a60.max}`);
    assert.ok(Math.abs(a60.cambiSegno - a144.cambiSegno) <= 2,
        `frequenza diversa fra 60 e 144 fps: ${a60.cambiSegno} vs ${a144.cambiSegno} inversioni`);
});

// ── I bordi dello schermo ───────────────────────────────────────────────────

test('bordi: spenti per quasi tutto il giro, accesi solo in fondo', () => {
    assert.equal(SV.intensitaBordi(0), 0);
    assert.equal(SV.intensitaBordi(SV.VEL_RIFERIMENTO * 0.5), 0);
    assert.equal(SV.intensitaBordi(SV.VEL_RIFERIMENTO * SV.SOGLIA_BORDI), 0);
    assert.ok(SV.intensitaBordi(SV.VEL_RIFERIMENTO * 0.9) > 0.2, 'al 90% devono essersi accesi');
    assert.equal(SV.intensitaBordi(SV.VEL_RIFERIMENTO), 1);
});

test('bordi: si accendono piu in fretta di quanto si spengono', () => {
    const su = SV.creaStato();
    SV.avanza(su, { velocita: SV.VEL_RIFERIMENTO }, 150);
    const giu = SV.creaStato();
    giu.bordi = 1;
    SV.avanza(giu, { velocita: 0 }, 150);
    assert.ok(su.bordi > 1 - giu.bordi,
        `accensione ${su.bordi} non piu svelta dello spegnimento ${1 - giu.bordi}`);
});

test('bordi: fuori dalla guida si spengono nello stesso frame', () => {
    const stato = SV.creaStato();
    stato.bordi = 1;
    SV.avanza(stato, { attivo: false }, 16);
    assert.equal(stato.bordi, 0);
});

// ── La manopola del playtest ────────────────────────────────────────────────

test('intensita: a zero il gioco torna esattamente com era prima', () => {
    // Vale come interruttore di sicurezza: se l'effetto disturbasse qualcuno,
    // a zero non deve restare NIENTE — ne mezzo grado di campo visivo.
    try {
        SV.impostaIntensita(0);
        const stato = SV.creaStato();
        for (let t = 0; t < 2000; t += 16) {
            SV.avanza(stato, { velocita: SV.VEL_RIFERIMENTO, superficie: SV.CORDOLO }, 16);
        }
        assert.equal(stato.fov, SV.FOV_BASE);
        assert.equal(stato.bordi, 0);
        assert.equal(Math.abs(SV.scossone(stato).dy), 0);
        assert.equal(Math.abs(SV.molla(1).dz), 0);
    } finally {
        SV.impostaIntensita(1);
    }
});

test('intensita: si accetta solo un numero fra 0 e 2', () => {
    try {
        assert.equal(SV.impostaIntensita(1.5), 1.5);
        assert.equal(SV.impostaIntensita(9), 2);
        assert.equal(SV.impostaIntensita(-3), 0);
        assert.equal(SV.impostaIntensita('niente'), 1, 'un valore non numerico torna al default');
    } finally {
        SV.impostaIntensita(1);
    }
    assert.equal(SV.getIntensita(), 1);
});

// ── Che cosa c'e sotto l'auto, sui tracciati VERI ───────────────────────────

test('superficie: asfalto, cordolo e fuori su ogni campione di prova e monte-rosso', () => {
    for (const id of ['prova', 'monte-rosso']) {
        const track = loadTrack(id);
        const pts = track.points;
        const CURB_W = 2.8;
        const semi = SV.SEMI_LARGHEZZA_AUTO;
        const conta = { asfalto: 0, cordolo: 0, fuori: 0, campioni: 0 };

        // Un campione ogni 10, per non trasformare un test in un benchmark.
        for (let i = 0; i < pts.length; i += 10) {
            const p = pts[i];
            const n = TG.normalAt(pts, i, true);
            // Tre posizioni costruite sulla normale a scostamenti noti: in
            // mezzo alla pista, con una ruota sul cordolo, e ben oltre il
            // cordolo. Il lato si alterna, cosi si provano entrambi.
            const lato = (i % 20 === 0) ? 1 : -1;
            const casi = [
                [0, SV.ASFALTO],
                [track.roadHalf - semi + 0.5, SV.CORDOLO],
                [track.roadHalf + CURB_W - semi + 1.0, SV.FUORI],
            ];
            for (const [scostamento, atteso] of casi) {
                const x = p.x + n.nx * scostamento * lato;
                const z = p.z + n.nz * scostamento * lato;
                const s = SV.superficieSottoAuto(TG, {
                    trackPts: pts, pitPts: track.pitLanePts, idxPrecedente: i,
                    x, z, roadHalf: track.roadHalf, curbW: CURB_W,
                });
                conta.campioni++;
                // Vicino alla corsia box la risposta legittima e' "asfalto"
                // qualunque sia lo scostamento: il pit e' asfalto per
                // definizione, ed e' esattamente il caso che la regola
                // "vince il tracciato piu vicino" esiste per coprire.
                const vicinoAlPit = TG.nearestPoint(track.pitLanePts, x, z).dist
                    < Math.hypot(x - p.x, z - p.z);
                if (vicinoAlPit) { conta.asfalto++; continue; }
                assert.equal(s, atteso,
                    `${id} campione ${i} scostamento ${scostamento.toFixed(1)}: atteso ${atteso}, ottenuto ${s}`);
                conta[s]++;
            }
        }
        // Il test non deve poter passare "perche non ha provato niente".
        assert.ok(conta.campioni > 200, `${id}: solo ${conta.campioni} campioni provati`);
        assert.ok(conta.cordolo > 50 && conta.fuori > 50,
            `${id}: campioni sbilanciati ${JSON.stringify(conta)}`);
    }
});

test('superficie: in corsia box e sempre asfalto', () => {
    // In mezzo alla corsia box lo scostamento dall asse PISTA e' enorme: senza
    // la regola del tracciato piu vicino, ogni sosta ai box sarebbe una
    // vibrazione da fuoripista.
    const track = loadTrack('prova');
    const pit = track.pitLanePts;
    let provati = 0;
    for (let i = 5; i < pit.length - 5; i += 7) {
        const s = SV.superficieSottoAuto(TG, {
            trackPts: track.points, pitPts: pit, idxPrecedente: track.pitEntryIndex || 0,
            x: pit[i].x, z: pit[i].z, roadHalf: track.roadHalf, curbW: 2.8,
        });
        assert.equal(s, SV.ASFALTO, `punto ${i} della corsia box classificato ${s}`);
        provati++;
    }
    assert.ok(provati > 20, `solo ${provati} punti di corsia box provati`);
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
