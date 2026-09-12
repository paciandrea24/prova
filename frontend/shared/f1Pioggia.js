// frontend/shared/f1Pioggia.js
//
// LA PIOGGIA CHE CADE. Un volume di gocce attorno alla camera: quando una esce
// dal fondo rientra dalla cima, quindi non nasce e non muore niente.
//
// ⚠️ PERCHE' UN VOLUME E NON UN EMETTITORE. Un emettitore si misura in nascite
// al secondo, e chi lo scrive "a riempimento" fa nascere tutto il serbatoio nel
// primo fotogramma (lezione gia' pagata su questo progetto). Qui il problema
// non si pone: le gocce sono SEMPRE le stesse, riciclate — la pioggia e' uno
// stato del mondo, non una sequenza di eventi. L'intensita' decide QUANTE ne
// sono disegnate, non quante ne nascono.
//
// ⚠️ UN SOLO OGGETTO IN SCENA, e sono linee. Questo gioco e' GPU-bound sui
// PIXEL (misurato: 3 ms di CPU risparmiati non valgono un fps, il 36% di pixel
// in meno ne vale 11), quindi la pioggia deve costare pochi pixel e un solo
// draw call: 2000 segmenti sottili in un LineSegments, non 2000 sprite.
// E si disegnano SOLO le gocce che servono, con `setDrawRange`: a cielo
// asciutto il costo e' zero anche se la geometria resta in memoria.
//
// La goccia e' una STRISCIA e non un punto perche' cade veloce: a 55 unita' al
// secondo, in un fotogramma da 16 ms, l'occhio vede una scia — disegnarla come
// tale e' piu' onesto che disegnare un pallino che si teletrasporta.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Pioggia = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Il volume attorno alla camera. Largo quanto basta perche' girandosi non
    // si veda il bordo, basso abbastanza da non sprecare gocce nel cielo.
    const RAGGIO = 26;
    const ALTEZZA = 40;
    const GOCCE_MAX = 2000;

    // Quanto cade in un secondo, e quanto e' lunga la scia. Crescono con
    // l'intensita': la pioviggine scende piano e corta, il diluvio veloce e
    // lungo — e' quello che distingue i due a vederli, piu' del numero di
    // gocce.
    const CADUTA_MIN = 26, CADUTA_MAX = 62;
    const SCIA_MIN = 0.5, SCIA_MAX = 2.2;
    // Il vento: le gocce non cadono a piombo, o sembrano una griglia.
    const DERIVA_X = 0.16, DERIVA_Z = 0.07;

    function install(scene, THREE) {
        const T = THREE || (typeof window !== 'undefined' ? window.THREE : null);
        if (!T) return null;

        // Due vertici per goccia: la cima e il fondo della scia.
        const posizioni = new Float32Array(GOCCE_MAX * 2 * 3);
        // Dove sta ogni goccia adesso (la cima), in coordinate MONDO.
        const x = new Float32Array(GOCCE_MAX);
        const y = new Float32Array(GOCCE_MAX);
        const z = new Float32Array(GOCCE_MAX);
        // Ognuna cade a velocita' un po' diversa: tutte uguali si leggono come
        // un reticolo che scorre.
        const vel = new Float32Array(GOCCE_MAX);
        for (let i = 0; i < GOCCE_MAX; i++) {
            x[i] = (Math.random() * 2 - 1) * RAGGIO;
            y[i] = (Math.random() * 2 - 1) * (ALTEZZA / 2);
            z[i] = (Math.random() * 2 - 1) * RAGGIO;
            vel[i] = 0.75 + Math.random() * 0.5;
        }

        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(posizioni, 3));
        geo.setDrawRange(0, 0);

        const mat = new T.LineBasicMaterial({
            color: 0xdfeaf2,
            transparent: true,
            opacity: 0.5,
            // La nebbia vale anche per la pioggia: le gocce lontane devono
            // sfumare nello stesso grigio del cielo, o il temporale finisce
            // dietro un velo e la pioggia gli sta davanti nitida.
            fog: true,
            depthWrite: false,
        });

        const linee = new T.LineSegments(geo, mat);
        // Il volume si muove con la camera, quindi la sua bounding box mente:
        // senza questo, girandosi la pioggia sparirebbe per frustum culling.
        linee.frustumCulled = false;
        linee.renderOrder = 3;
        linee.visible = false;
        scene.add(linee);

        let intensita = 0;
        let attive = 0;

        function setIntensita(v) {
            intensita = Math.max(0, Math.min(1, v || 0));
            // Sotto una pioviggine appena accennata non si disegna niente: due
            // gocce sparse sono peggio di nessuna, perche' sembrano un difetto.
            // ⚠️ NON quadratica: con `n * i * i` la pioviggine veniva fuori a 359
            // gocce su 2000 e a schermo erano graffi isolati, non pioggia. La
            // curva parte piu' alta e sale piano — fra «pioviggina» e «diluvia»
            // la differenza che si vede e' soprattutto la VELOCITA' e la
            // lunghezza delle scie, non il conteggio.
            attive = intensita < 0.04
                ? 0
                : Math.round(GOCCE_MAX * Math.pow(intensita, 0.85) * (0.45 + 0.55 * intensita));
            linee.visible = attive > 0;
            geo.setDrawRange(0, attive * 2);
            mat.opacity = 0.24 + 0.38 * intensita;
        }

        function update(camera, dt) {
            if (attive <= 0 || !camera) return;
            const passo = Math.max(0, Math.min(0.1, dt || 0));
            const caduta = (CADUTA_MIN + (CADUTA_MAX - CADUTA_MIN) * intensita) * passo;
            const scia = SCIA_MIN + (SCIA_MAX - SCIA_MIN) * intensita;
            const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;

            for (let i = 0; i < attive; i++) {
                y[i] -= caduta * vel[i];
                x[i] += caduta * vel[i] * DERIVA_X;
                z[i] += caduta * vel[i] * DERIVA_Z;

                // Fuori dal volume della camera? Rientra dall'altra parte. Il
                // riciclo guarda la posizione della CAMERA, non l'origine del
                // mondo: e' cosi' che la pioggia segue l'auto senza essere
                // incollata a lei — le gocce restano ferme nel mondo mentre ci
                // passi in mezzo.
                if (y[i] < cy - ALTEZZA / 2) {
                    y[i] = cy + ALTEZZA / 2;
                    x[i] = cx + (Math.random() * 2 - 1) * RAGGIO;
                    z[i] = cz + (Math.random() * 2 - 1) * RAGGIO;
                } else {
                    if (x[i] - cx > RAGGIO) x[i] -= RAGGIO * 2;
                    else if (x[i] - cx < -RAGGIO) x[i] += RAGGIO * 2;
                    if (z[i] - cz > RAGGIO) z[i] -= RAGGIO * 2;
                    else if (z[i] - cz < -RAGGIO) z[i] += RAGGIO * 2;
                    if (y[i] > cy + ALTEZZA / 2) y[i] -= ALTEZZA;
                }

                const b = i * 6;
                posizioni[b]     = x[i];
                posizioni[b + 1] = y[i];
                posizioni[b + 2] = z[i];
                // Il fondo della scia sta INDIETRO lungo la direzione di
                // caduta, deriva compresa: una scia verticale sotto una goccia
                // che va di traverso si vede subito.
                posizioni[b + 3] = x[i] - scia * DERIVA_X;
                posizioni[b + 4] = y[i] + scia;
                posizioni[b + 5] = z[i] - scia * DERIVA_Z;
            }
            geo.attributes.position.needsUpdate = true;
            // Solo la parte disegnata va caricata sulla GPU: con la pioviggine
            // sono poche centinaia di gocce su duemila.
            geo.attributes.position.updateRange = { offset: 0, count: attive * 6 };
        }

        return {
            oggetto: linee,
            setIntensita,
            update,
            // Per i test e per il pannello di taratura.
            get attive() { return attive; },
            GOCCE_MAX, RAGGIO, ALTEZZA,
        };
    }

    return { install, GOCCE_MAX, RAGGIO, ALTEZZA, CADUTA_MIN, CADUTA_MAX };
});
