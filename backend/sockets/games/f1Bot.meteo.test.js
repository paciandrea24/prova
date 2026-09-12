// backend/sockets/games/f1Bot.meteo.test.js
//
// I BOT E IL CIELO: quale gomma vogliono, quando rientrano a prenderla, e
// quanto sbagliano di piu' sul bagnato.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('./f1Bot');
const T = require('./physics/TyreModel');

test('bot: vuole la mescola che rende di piu col cielo di adesso', () => {
    // ⚠️ Sull'asciutto le tre slick rendono ESATTAMENTE uguale (aderenza 1.00
    // per tutte), quindi «la migliore» non e' definita: qui deve restare quella
    // montata. Cambiare gomma fra slick e' una scelta di usura, non di meteo, e
    // non spetta a questa funzione — se cambiasse, un bot con le hard tornerebbe
    // ai box al primo tick di gara per montare le soft.
    assert.equal(B.mescolaVolutaDalBot({ compound: 'medium' }, 0), 'medium');
    assert.equal(B.mescolaVolutaDalBot({ compound: 'hard' }, 0), 'hard');

    assert.equal(B.mescolaVolutaDalBot({ compound: 'medium' }, 0.5), 'intermedie');
    assert.equal(B.mescolaVolutaDalBot({ compound: 'intermedie' }, 0.95), 'pioggia');
    // E quando il cielo torna asciutto, si torna alle slick.
    assert.ok(T.MESCOLE_ASCIUTTO.includes(B.mescolaVolutaDalBot({ compound: 'pioggia' }, 0)));
});

test('bot: venti bot non entrano tutti nello stesso giro', () => {
    const ritardi = new Set();
    for (let i = 0; i < 20; i++) ritardi.add(B.ritardoRientroMeteo({ color: `#c0ffe${i}` }, 'medio'));
    assert.ok(ritardi.size >= 2, `tutti i bot reagiscono con lo stesso ritardo: ${[...ritardi]}`);
    // Deterministico: lo stesso bot deve dare sempre lo stesso ritardo, o un
    // test non potrebbe dire niente e una gara non si potrebbe riprodurre.
    const uno = { color: '#e74c3c' };
    assert.equal(B.ritardoRientroMeteo(uno, 'medio'), B.ritardoRientroMeteo(uno, 'medio'));
    // Chi e' piu' forte reagisce prima, mai dopo.
    // ⚠️ Il livello si PASSA: sui player non esiste un campo della
    // difficolta' (sta in game.settings.botDifficolta), e cercandolo su `p` la
    // fretta dei bot forti non si applicava mai.
    for (const c of ['#e74c3c', '#2ecc71', '#3498db', '#f1c40f']) {
        const facile = B.ritardoRientroMeteo({ color: c }, 'facile');
        const difficile = B.ritardoRientroMeteo({ color: c }, 'difficile');
        assert.ok(difficile <= facile, `col colore ${c} il bot difficile reagisce dopo quello facile`);
    }
    // E almeno un colore deve davvero accorciare, o il test non misura niente.
    const accorcia = ['#e74c3c', '#2ecc71', '#3498db', '#f1c40f', '#9b59b6', '#16a085']
        .some(c => B.ritardoRientroMeteo({ color: c }, 'difficile') < B.ritardoRientroMeteo({ color: c }, 'facile'));
    assert.ok(accorcia, 'il livello difficile non accorcia il ritardo di nessuno');
});

test('bot: rientra quando il cielo lo ripaga, non per un guadagno che la sosta si mangia', () => {
    // Diluvio con le slick: guadagno enorme, deve rientrare (passato il suo
    // ritardo).
    const conSlick = { color: '#e74c3c', compound: 'soft', bagnato: 1, lap: 0 };
    conSlick.botMeteoGiroVisto = 0;
    conSlick.lap = 10;   // ritardo ampiamente passato
    assert.equal(B.vuoleRientrarePerIlMeteo(conSlick), true);
    assert.equal(B.mescolaVolutaDalBot(conSlick, 1), 'pioggia');

    // Appena umido con le slick: il guadagno c'e' ma e' piccolo, non si spende
    // una sosta.
    const umidoLeggero = { color: '#e74c3c', compound: 'soft', bagnato: 0.12, lap: 10 };
    umidoLeggero.botMeteoGiroVisto = 0;
    assert.equal(B.vuoleRientrarePerIlMeteo(umidoLeggero), false);

    // Con la gomma giusta addosso non si rientra mai.
    const giusta = { color: '#e74c3c', compound: 'pioggia', bagnato: 1, lap: 10 };
    giusta.botMeteoGiroVisto = 0;
    assert.equal(B.vuoleRientrarePerIlMeteo(giusta), false);

    // E prima del proprio ritardo non si muove: e' quel che evita la fila.
    const appenaVisto = { color: '#e74c3c', compound: 'soft', bagnato: 1, lap: 3 };
    appenaVisto.botMeteoGiroVisto = 3;
    const ritardo = B.ritardoRientroMeteo(appenaVisto);
    assert.equal(B.vuoleRientrarePerIlMeteo(appenaVisto), ritardo === 0,
        'il bot ignora il proprio ritardo di reazione');
});

test('errori: sul bagnato ne accadono di piu, e si contano per EPISODIO', () => {
    // ⚠️ Non si legge la costante: si contano gli EPISODI in una gara
    // simulata, perche' «quanto sbaglia un bot» si sente in quello e non in una
    // percentuale per tick. E' la lezione pagata tre volte su difesa, errori e
    // trenino.
    //
    // Il dado e' seminato: con Math.random il conteggio sarebbe statistico e il
    // test rosso una volta su venti senza voler dire niente.
    // ⚠️ xorshift32, lo stesso generatore di f1Meteo, e non un LCG: il primo
    // dado che avevo scritto qui prendeva i bit BASSI di un LCG (`% 100000`),
    // che sono quasi periodici, e contava 1.95 errori a giro dove il codice ne
    // produce 1.2. La misura era sbagliata, non il codice: un dado scadente
    // falsa il banco prima di falsare il gioco.
    // ⚠️ I DUE RUN SI APPAIANO SULLO STESSO SEME: un dado condiviso fra i due
    // li farebbe misurare tratti DIVERSI della sequenza, e il confronto
    // perdeva il 30% dell'effetto (1.45 contro 1.38 invece di 1.38 contro
    // 1.94). I banchi di questo progetto sono rumorosi: si appaia.
    function dadoDaSeme(s0) {
        let seme = s0;
        return () => {
            seme ^= seme << 13; seme |= 0;
            seme ^= seme >>> 17;
            seme ^= seme << 5;  seme |= 0;
            return ((seme >>> 0) % 100000) / 100000;
        };
    }

    const GIRI = 40, TICK = 50, GIRO_MS = 50000;
    function episodiIn(bagnato) {
        const dado = dadoDaSeme(12345);
        const p = { color: '#e74c3c', bagnato };
        let episodi = 0;
        for (let t = 0; t < (GIRI * GIRO_MS) / TICK; t++) {
            if (B.aggiornaErroreConIlCielo(p, 1.2, TICK, GIRO_MS, dado, true)) episodi++;
        }
        return episodi / GIRI;
    }
    const asciutto = episodiIn(0);
    const diluvio = episodiIn(1);
    assert.ok(asciutto > 0.5 && asciutto < 2, `a secco gli errori per giro sono ${asciutto.toFixed(2)}, fuori scala`);
    assert.ok(diluvio > asciutto * 1.25,
        `nel diluvio si sbaglia ${diluvio.toFixed(2)} volte a giro contro ${asciutto.toFixed(2)} a secco: non si sente`);
});
