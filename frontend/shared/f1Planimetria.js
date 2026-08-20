// frontend/shared/f1Planimetria.js
//
// La MAPPA di un circuito, disegnata in un riquadro: entra una geometria (i
// punti del tracciato, gli stessi che usa il gioco), esce un disegno.
//
// Serve alla premiazione, dove le mappe da mostrare sono tutte quelle del
// calendario — fino a otto — mentre di circuito costruito in scena ce n'è uno
// solo, quello dell'ultima gara. Un render 3D per ciascuno non è una strada:
// costruire una pista è il lavoro più pesante che fa questa pagina.
//
// Niente Three.js e niente DOM: il contesto 2D arriva da fuori, e così
// l'inquadratura si verifica senza browser. Le due cose che si sbagliano in
// silenzio in un disegno del genere sono proprio quelle misurabili: una pista
// che esce dal riquadro, e un ovale che diventa un cerchio.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Planimetria = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Come stanno `punti` dentro un riquadro `larghezza`×`altezza`: una scala
    // sola per le due direzioni (altrimenti il tracciato si deforma) e quello
    // che avanza diviso in parti uguali ai due lati (altrimenti la mappa sta
    // incollata a un bordo).
    function inquadra(punti, larghezza, altezza, margine) {
        const m = margine || 0;
        const utileX = Math.max(1, larghezza - m * 2);
        const utileY = Math.max(1, altezza - m * 2);
        if (!punti || !punti.length) {
            return { scala: 1, offsetX: m, offsetY: m };
        }
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of punti) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        }
        // Un tracciato degenere (tutti i punti nello stesso posto) darebbe una
        // divisione per zero, e da lì in poi ogni coordinata sarebbe NaN.
        const largo = Math.max(1e-6, maxX - minX);
        const alto = Math.max(1e-6, maxZ - minZ);
        const scala = Math.min(utileX / largo, utileY / alto);
        return {
            scala,
            offsetX: m + (utileX - largo * scala) / 2 - minX * scala,
            offsetY: m + (utileY - alto * scala) / 2 - minZ * scala,
        };
    }

    // Disegna il giro come un nastro chiuso, e il traguardo come un trattino
    // trasversale. Nient'altro: a questa dimensione cordoli e vie di fuga
    // diventano sporco, non informazione.
    //
    // `traguardo` è l'indice del punto dove sta la linea, oppure null.
    function disegna(ctx, punti, opzioni) {
        const o = opzioni || {};
        const larghezza = o.larghezza || 400;
        const altezza = o.altezza || 300;
        const q = inquadra(punti, larghezza, altezza, o.margine != null ? o.margine : 16);
        const px = (p) => q.offsetX + p.x * q.scala;
        const py = (p) => q.offsetY + p.z * q.scala;

        if (!punti || !punti.length) return q;

        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = o.colore || '#8CAEB6';
        ctx.lineWidth = o.spessore || 7;
        ctx.beginPath();
        punti.forEach((p, i) => {
            if (i === 0) ctx.moveTo(px(p), py(p));
            else ctx.lineTo(px(p), py(p));
        });
        ctx.closePath();
        ctx.stroke();

        if (o.traguardo == null) return q;

        // Il traguardo: un trattino perpendicolare al tracciato nel punto dato.
        const n = punti.length;
        const i = ((o.traguardo | 0) % n + n) % n;
        const a = punti[i], b = punti[(i + 1) % n];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len;
        const mezzo = (o.spessore || 7) * 0.9;
        ctx.strokeStyle = o.coloreTraguardo || '#E9F3F5';
        ctx.lineWidth = Math.max(2, (o.spessore || 7) * 0.45);
        ctx.beginPath();
        ctx.moveTo(px(a) + nx * mezzo, py(a) + nz * mezzo);
        ctx.lineTo(px(a) - nx * mezzo, py(a) - nz * mezzo);
        ctx.stroke();
        return q;
    }

    return { inquadra, disegna };
});
