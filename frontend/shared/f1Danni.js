// frontend/shared/f1Danni.js
//
// Lo stato di salute della vettura, nella forma in cui si disegna: la scala di
// colore verde → giallo → rosso, l'arco dei quadranti circolari e i nomi dei
// quattro componenti che si possono rompere.
//
// Nasce dal pannello del tasto T rifatto sul riferimento del gioco F1
// ufficiale: auto vista dall'alto al centro, quattro quadranti a percentuale
// intorno, ognuno collegato da una linea punteggiata al pezzo che rappresenta.
//
// DIFFERENZA DAL RIFERIMENTO, ed è il motivo per cui questo file esiste. Lì i
// quattro quadranti sono le quattro GOMME, una per ruota. Da noi l'usura è UN
// valore solo per tutte e quattro (è così che la calcola il server, non è una
// semplificazione del disegno), mentre i pezzi che si rompono davvero sono
// quattro e sono altri: ala anteriore, fondo, motore, sospensioni. Quindi i
// quattro quadranti sono i COMPONENTI, e l'usura gomme è una riga a parte.
//
// PERCHÉ UN MODULO E NON DUE RIGHE DENTRO f1.js. La scala di colore era già
// scritta in `f1.js` come `wearColor` e serviva a tre posti; ora ne serve un
// quarto e sarebbe stata la volta buona per farne nascere una copia leggermente
// diversa. Una cosa, una misura — la lezione è già costata una volta con la
// sosta ai box.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Danni = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // I quattro componenti di `DamageModel.createDamageParts()`, nell'ordine in
    // cui compaiono nel pannello: davanti a sinistra, davanti a destra, dietro
    // a sinistra, dietro a destra. `chiave` DEVE restare uguale al nome del
    // campo che manda il server — c'è un test che lo verifica contro il modello
    // vero invece di fidarsi.
    const COMPONENTI = [
        { chiave: 'frontWing',  nome: 'Ala anteriore', breve: 'ALA' },
        { chiave: 'suspension', nome: 'Sospensioni',   breve: 'SOSP' },
        { chiave: 'floor',      nome: 'Fondo',         breve: 'FONDO' },
        { chiave: 'engine',     nome: 'Motore',        breve: 'MOTORE' },
    ];

    // Verde → giallo → rosso. Sono le stesse tre fermate che l'utente ha già
    // approvato per l'usura gomme: 0 sano, 55 il punto in cui il giallo è
    // pieno, 100 rotto. Vale identica per l'usura e per i danni perché nei due
    // casi lo zero vuol dire la stessa cosa — tutto a posto.
    const SCALA = [
        [0,   [79, 191, 130]],
        [55,  [217, 178, 60]],
        [100, [198, 91, 82]],
    ];

    function colore(pct) {
        const v = Math.max(0, Math.min(100, Number(pct) || 0));
        for (let i = 0; i < SCALA.length - 1; i++) {
            const [p0, c0] = SCALA[i], [p1, c1] = SCALA[i + 1];
            if (v >= p0 && v <= p1) {
                const f = (v - p0) / (p1 - p0);
                const c = c0.map((x, idx) => Math.round(x + (c1[idx] - x) * f));
                return `rgb(${c[0]},${c[1]},${c[2]})`;
            }
        }
        return `rgb(${SCALA[SCALA.length - 1][1].join(',')})`;
    }

    // L'arco riempito del quadrante: parte dalle ore 12 e gira in senso orario,
    // come nel riferimento.
    //
    // ⚠️ 360° esatti su un arco SOLO non si disegnano: il punto d'arrivo
    // coincide con quello di partenza e per l'SVG l'arco è vuoto — il quadrante
    // sparirebbe proprio quando il componente è distrutto, cioè nell'unico
    // momento in cui conta. Da qui il taglio a 0.9999 di giro, che lascia un
    // buco largo meno di un decimo di grado (invisibile a qualunque raggio
    // usato qui) invece di un cerchio che scompare.
    function arco(pct, cx, cy, r) {
        const f = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
        if (f <= 0) return '';
        const ang = Math.min(f, 0.9999) * Math.PI * 2;
        const x1 = cx + Math.sin(ang) * r;
        const y1 = cy - Math.cos(ang) * r;
        const grande = ang > Math.PI ? 1 : 0;
        return `M ${cx.toFixed(2)} ${(cy - r).toFixed(2)}`
            + ` A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${grande} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    }

    // Il peggiore dei quattro: è lo stesso numero che il server manda come
    // `damage` (che è il MASSIMO, non la media — un solo pezzo distrutto deve
    // pesare subito). Ricalcolarlo qui serve solo all'icona chiusa, che deve
    // poter dire "c'è un danno" anche prima che il pannello venga aperto.
    function peggiore(parti) {
        let max = 0;
        for (const c of COMPONENTI) max = Math.max(max, (parti && parti[c.chiave]) || 0);
        return max;
    }

    return { COMPONENTI, SCALA, colore, arco, peggiore };

});
