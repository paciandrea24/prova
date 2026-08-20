// frontend/shared/f1SuoniCerimonia.js
//
// I suoni della festa di fine mondiale: i fuochi d'artificio e il passaggio
// degli aerei. Sintetizzati con WebAudio, non caricati da file — nel progetto
// c'è un solo file audio (engine.wav) e questi due non sono un motivo
// sufficiente per aggiungerne altri da procurare e da servire.
//
// Il file è diviso in due metà con due nature diverse:
//
//   - il PROGRAMMA (quando parte cosa) è aritmetica pura, e si verifica senza
//     browser: è l'unica parte di un suono che si possa controllare a tavolino.
//   - la SINTESI tocca l'AudioContext e va ascoltata. Sta qui sotto, corta e
//     senza decisioni dentro.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1SuoniCerimonia = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Quanto dura il volo di un razzo prima di scoppiare. Il fischio dura
    // quanto la salita, ed è per questo che nel programma sta PRIMA del botto:
    // in un fuoco d'artificio si sente sempre partire, poi esplodere.
    const SALITA_MS = 900;

    // I razzi non partono a intervalli uguali: una cadenza regolare suona come
    // un metronomo, non come una festa. Lo scarto è deterministico (dipende
    // dall'indice) così il programma è verificabile.
    function programmaFuochi(durataMs, quanti) {
        const n = Math.max(1, quanti | 0);
        const utile = Math.max(SALITA_MS + 200, durataMs - 400);
        const eventi = [];
        for (let i = 0; i < n; i++) {
            const base = (utile * i) / n;
            const scarto = ((i * 37) % 11) / 11 * (utile / n) * 0.55;
            const partenza = Math.round(base + scarto);
            eventi.push({ istanteMs: partenza, tipo: 'fischio', indice: i });
            eventi.push({ istanteMs: partenza + SALITA_MS, tipo: 'botto', indice: i });
        }
        return eventi.sort((a, b) => a.istanteMs - b.istanteMs);
    }

    // Gli aerei passano in formazione: un solo rombo che cresce e si allontana,
    // più un secondo passaggio se c'è tempo. Non uno per aereo — sono in
    // formazione, e si sentono come una cosa sola.
    function programmaJet(durataMs, passaggi) {
        const n = Math.max(1, passaggi | 0);
        const eventi = [];
        for (let i = 0; i < n; i++) {
            const istante = Math.round((durataMs * 0.12) + (durataMs * 0.62 * i) / n);
            if (istante > durataMs) break;
            eventi.push({ istanteMs: istante, tipo: 'passaggio', indice: i });
        }
        return eventi;
    }

    // ---- la sintesi ---------------------------------------------------------

    function rumore(ctx, durataS) {
        const campioni = Math.max(1, Math.floor(ctx.sampleRate * durataS));
        const buffer = ctx.createBuffer(1, campioni, ctx.sampleRate);
        const dati = buffer.getChannelData(0);
        for (let i = 0; i < campioni; i++) dati[i] = Math.random() * 2 - 1;
        const sorgente = ctx.createBufferSource();
        sorgente.buffer = buffer;
        return sorgente;
    }

    // Il fischio della salita: sale di tono e si spegne quando il razzo arriva.
    function fischio(ctx, quandoS, volume) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(420, quandoS);
        osc.frequency.exponentialRampToValueAtTime(1500, quandoS + SALITA_MS / 1000);
        gain.gain.setValueAtTime(0.0001, quandoS);
        gain.gain.exponentialRampToValueAtTime(0.05 * volume, quandoS + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.0001, quandoS + SALITA_MS / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(quandoS);
        osc.stop(quandoS + SALITA_MS / 1000 + 0.05);
    }

    // Il botto: rumore filtrato con una coda che si spegne, più tre crepitii
    // sfalsati — senza, è uno sbuffo e non uno scoppio.
    function botto(ctx, quandoS, volume) {
        const sorgente = rumore(ctx, 1.2);
        const filtro = ctx.createBiquadFilter();
        filtro.type = 'lowpass';
        filtro.frequency.setValueAtTime(1800, quandoS);
        filtro.frequency.exponentialRampToValueAtTime(220, quandoS + 0.9);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.9 * volume, quandoS);
        gain.gain.exponentialRampToValueAtTime(0.0001, quandoS + 1.1);
        sorgente.connect(filtro).connect(gain).connect(ctx.destination);
        sorgente.start(quandoS);
        sorgente.stop(quandoS + 1.2);

        for (let i = 0; i < 3; i++) {
            const t = quandoS + 0.18 + i * 0.13;
            const crepitio = rumore(ctx, 0.12);
            const alto = ctx.createBiquadFilter();
            alto.type = 'highpass';
            alto.frequency.value = 1400;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.22 * volume, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
            crepitio.connect(alto).connect(g).connect(ctx.destination);
            crepitio.start(t);
            crepitio.stop(t + 0.12);
        }
    }

    // Il passaggio dei jet: rumore a banda che si avvicina e si allontana. La
    // frequenza sale mentre arrivano e scende dopo — è il doppler, ed è ciò che
    // fa "passare" un aereo invece di farlo stare fermo a rombare.
    function jet(ctx, quandoS, durataS, volume) {
        const sorgente = rumore(ctx, durataS + 0.5);
        const banda = ctx.createBiquadFilter();
        banda.type = 'bandpass';
        banda.Q.value = 0.9;
        banda.frequency.setValueAtTime(180, quandoS);
        banda.frequency.linearRampToValueAtTime(760, quandoS + durataS * 0.45);
        banda.frequency.linearRampToValueAtTime(150, quandoS + durataS);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, quandoS);
        gain.gain.linearRampToValueAtTime(0.5 * volume, quandoS + durataS * 0.45);
        gain.gain.linearRampToValueAtTime(0.0001, quandoS + durataS);
        sorgente.connect(banda).connect(gain).connect(ctx.destination);
        sorgente.start(quandoS);
        sorgente.stop(quandoS + durataS + 0.2);
    }

    // Programma tutto in una volta sull'orologio dell'AudioContext, che è
    // preciso al campione: un setTimeout per ogni botto sarebbe alla mercé del
    // frame rate, e in una scena piena di particelle si sentirebbe.
    function suonaFuochi(ctx, eventi, volume) {
        if (!ctx) return;
        const t0 = ctx.currentTime + 0.05;
        for (const e of eventi) {
            const quando = t0 + e.istanteMs / 1000;
            if (e.tipo === 'fischio') fischio(ctx, quando, volume == null ? 1 : volume);
            else botto(ctx, quando, volume == null ? 1 : volume);
        }
    }

    function suonaJet(ctx, eventi, durataPassaggioMs, volume) {
        if (!ctx) return;
        const t0 = ctx.currentTime + 0.05;
        for (const e of eventi) {
            jet(ctx, t0 + e.istanteMs / 1000, (durataPassaggioMs || 3200) / 1000,
                volume == null ? 1 : volume);
        }
    }

    return {
        SALITA_MS,
        programmaFuochi, programmaJet,
        suonaFuochi, suonaJet,
    };
});
