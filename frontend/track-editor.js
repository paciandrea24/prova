// frontend/track-editor.js
document.addEventListener('DOMContentLoaded', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a22);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(100, 200, 100);
    scene.add(sun);

    const VIEW = 220;
    // Centro inquadrato (pan) e fattore di zoom: la camera ortografica
    // top-down non ruota mai, quindi pan/zoom sono solo traslazione del
    // target e riduzione/allargamento della frustum attorno ad esso.
    let camTarget = { x: 0, z: 0 };
    let zoom = 1;
    const camera = new THREE.OrthographicCamera(-VIEW, VIEW, VIEW, -VIEW, 0.1, 2000);

    function updateCameraTransform() {
        const a = window.innerWidth / window.innerHeight;
        const v = VIEW / zoom;
        camera.left = -v * a; camera.right = v * a;
        camera.top = v; camera.bottom = -v;
        camera.updateProjectionMatrix();
        camera.position.set(camTarget.x, 500, camTarget.z + 0.001);
        camera.lookAt(camTarget.x, 0, camTarget.z);
        camera.updateMatrixWorld();
    }
    updateCameraTransform();

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    scene.add(new THREE.GridHelper(2000, 100, 0x444455, 0x2a2a33));

    window.addEventListener('resize', () => {
        updateCameraTransform();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ====================================================
    // STATO DATI
    // ====================================================
    let mainPoints = [];
    let pitPoints  = [];

    // LA GEOMETRIA: nodi con una direzione, tratti tipizzati. Quando c'è,
    // `mainPoints` non si modifica a mano — è il suo prodotto cotto, e
    // toccarlo darebbe due verità per la stessa cosa (la seconda andrebbe
    // persa alla cottura successiva).
    //
    // `null` = pista aperta in modalità punti, cioè come si è sempre fatto.
    // Non c'è un terzo stato, e non si converte niente: le piste esistenti non
    // hanno un'intenzione da cui rigenerarle, e dedurla con un fitting sarebbe
    // una supposizione — costosa proprio sulle piste già validate. Rif.
    // docs/superpowers/specs/2026-08-24-f1-editor-segmenti-design.md
    //
    // Una pista NUOVA nasce invece a segmenti: è il modo in cui si disegna da
    // qui in avanti.
    let geometria = { versione: 1, nodi: [], tratti: [] };
    let nodoSelezionato = -1;
    let trattoSelezionato = -1;

    function inSegmenti() { return geometria !== null; }

    // Su COSA agiscono trascinamento, cancellazione e rotellina. In modalità
    // segmenti sono i nodi: i punti cotti sono il prodotto, e modificarli
    // sarebbe la seconda verità che alla prossima cottura sparisce.
    function listaDi(nome) {
        if (nome === 'pit') return pitPoints;
        return inSegmenti() ? geometria.nodi : mainPoints;
    }

    // Da chiamare dopo ogni modifica ai nodi: la forma dipende da tutti, non
    // solo da quello toccato.
    function dopoModificaMain() {
        if (!inSegmenti()) return;
        geometria = TrackSegmenti.riallinea(geometria);
        rigeneraDaGeometria();
    }

    // ====================================================
    // ANNULLA / RIFAI — uno stack di STATI, non di modifiche.
    //
    // Le operazioni di TrackSegmenti restituiscono una geometria nuova senza
    // mutare quella vecchia: annullare è tornare allo stato precedente, non
    // saper disfare un'azione. È la ragione per cui quelle funzioni sono
    // scritte così, e il motivo per cui qui bastano venti righe.
    //
    // Sostituisce «annulla ultimo punto», che non copriva né lo spostamento,
    // né la cancellazione, né la quota, né la direzione.
    // ====================================================
    const storico = [];
    const rifatti = [];
    const STORICO_MAX = 100;

    function salvaStato() {
        if (!inSegmenti()) return;
        const istantanea = JSON.stringify(geometria);
        // Uno stato identico al precedente non si impila: cliccare un nodo per
        // sceglierlo passa di qui senza cambiare niente, e senza questa riga
        // servirebbero dieci Ctrl+Z per tornare indietro di una modifica sola.
        if (storico.length && storico[storico.length - 1] === istantanea) return;
        storico.push(istantanea);
        if (storico.length > STORICO_MAX) storico.shift();
        rifatti.length = 0;   // una modifica nuova taglia il ramo dei "rifai"
    }

    function ripristina(daDove, dove) {
        if (!daDove.length || !inSegmenti()) return;
        dove.push(JSON.stringify(geometria));
        geometria = JSON.parse(daDove.pop());
        // Un nodo può non esistere più: la selezione va rimessa in sicurezza.
        if (nodoSelezionato >= geometria.nodi.length) nodoSelezionato = -1;
        if (trattoSelezionato >= geometria.tratti.length) trattoSelezionato = -1;
        rigeneraDaGeometria();
        rebuild();
        aggiornaRiquadroTratto();
    }

    const annulla = () => ripristina(storico, rifatti);
    const rifai = () => ripristina(rifatti, storico);

    // ====================================================
    // I NUMERI DEL TRATTO SCELTO — si leggono e si scrivono.
    // È la richiesta che il vecchio modello non poteva soddisfare: un punto di
    // controllo non ha né una lunghezza né un raggio, quindi non c'era niente
    // da mostrare e niente da riscrivere.
    // ====================================================
    // La riga sotto il titolo: dice sempre con che modello si sta lavorando e
    // quanto c'e' in scena. Su una pista aperta a punti è l'unico posto in cui
    // si legge che i segmenti lì non ci sono.
    function aggiornaRigaStato() {
        const el = document.getElementById('modoCorrente');
        if (!el) return;
        if (document.getElementById('pitMode').checked) {
            el.textContent = `corsia box · ${pitPoints.length} punti`;
            return;
        }
        el.textContent = inSegmenti()
            ? `segmenti · ${geometria.nodi.length} nodi · ${mainPoints.length} punti cotti`
            : `punti · ${mainPoints.length} punti di controllo`;
    }

    // ⚠️ LA QUOTA VA LETTA, NON INDOVINATA. Il colore e la dimensione del
    // marker saturano a ±5 unita' (Y_RANGE): oltre, la rotellina continua ad
    // alzare ma il pallino resta uguale — «io come faccio a sapere quanta
    // salita ho messo?». Qui il numero c'e', insieme alla PENDENZA verso il
    // nodo successivo, che e' cio' che conta davvero per chi guida: una salita
    // di 10 unita' su 500 e' pianura, su 40 e' un muro.
    function aggiornaPannelloQuota() {
        const el = document.getElementById('quotaStato');
        if (!el) return;
        const lista = listaDi('main');
        if (!inSegmenti() || nodoSelezionato < 0 || !lista[nodoSelezionato]) {
            // Nessun nodo scelto: si dice comunque l'escursione della pista,
            // che e' l'informazione d'insieme.
            if (!lista.length) { el.textContent = 'Nessun nodo.'; return; }
            let min = Infinity, max = -Infinity;
            for (const p of lista) { const y = p.y || 0; if (y < min) min = y; if (y > max) max = y; }
            el.innerHTML = `dislivello del tracciato: <span class="valore">${(max - min).toFixed(1)}</span> unità`
                + ` (da <span class="valore">${min.toFixed(1)}</span> a <span class="valore">${max.toFixed(1)}</span>)`
                + `<br>scegli un nodo per la pendenza del tratto`;
            el.style.color = 'var(--spento)';
            return;
        }
        const n = lista.length;
        const a = lista[nodoSelezionato], b = lista[(nodoSelezionato + 1) % n];
        const dislivello = (b.y || 0) - (a.y || 0);
        const orizzontale = TrackSegmenti.misureTratto(geometria, nodoSelezionato).lunghezza;
        const pendenza = orizzontale > 0 ? (dislivello / orizzontale) * 100 : 0;
        const gradi = Math.atan2(dislivello, orizzontale) * 180 / Math.PI;
        // Oltre il 15% una pista non si guida piu': e' la soglia oltre la
        // quale conviene sapere subito di aver esagerato.
        const troppo = Math.abs(pendenza) > 15;
        el.innerHTML = `quota del nodo <span class="valore">${(a.y || 0).toFixed(1)}</span>`
            + ` · verso il prossimo: <span class="valore">${dislivello >= 0 ? '+' : ''}${dislivello.toFixed(1)}</span> su ${orizzontale.toFixed(0)}`
            + `<br>pendenza <span class="valore">${pendenza.toFixed(1)}%</span>`
            + ` (<span class="valore">${gradi.toFixed(1)}°</span>) — ${dislivello > 0.05 ? 'salita' : dislivello < -0.05 ? 'discesa' : 'in piano'}`
            + (troppo ? '<br>oltre il 15%: difficile da guidare' : '');
        el.style.color = troppo ? 'var(--pericolo)' : 'var(--spento)';
    }

    // La forma della pista in numeri: quanto e' lunga, quanti giri diventa in
    // gara, e quanto e' larga la carreggiata — in auto affiancate, che e'
    // l'unica unita' di misura che dice qualcosa a chi guarderà la pista dal
    // volante. Richiesta esplicita dell'utente: «mi serve un indicatore che mi
    // dica quanti giri quel tracciato avra' in gioco» e «maggiori informazioni
    // riguardo alla larghezza delle strade».
    const LARGHEZZA_AUTO = 2.2;   // la vettura del gioco, misurata sul .glb
    function aggiornaPannelloForma() {
        const el = document.getElementById('formaInfo');
        if (!el) return;
        const mezza = parseFloat(document.getElementById('roadHalfWidth').value) || 11;
        const larghezza = mezza * 2;
        const affiancate = Math.floor(larghezza / (LARGHEZZA_AUTO * 1.35));   // con lo spazio per non toccarsi
        if (mainPoints.length < 3) {
            el.innerHTML = `carreggiata <span class="valore">${larghezza.toFixed(1)}</span> unità`
                + ` — circa <span class="valore">${affiancate}</span> auto affiancate`;
            return;
        }
        const pts = TrackGeometry.sampleLoop(mainPoints, 500);
        const giroUnita = TrackGeometry.lapLength(pts);
        const giri = giriPrevisti();
        el.innerHTML = `giro <span class="valore">${giroUnita.toFixed(0)}</span> unità`
            + ` · in gara <span class="valore">${giri}</span> giri`
            + `<br>carreggiata <span class="valore">${larghezza.toFixed(1)}</span> unità`
            + ` — circa <span class="valore">${affiancate}</span> auto affiancate`;
    }

    // La corsia box: quanto e' lunga e se il riquadro d'ingresso la intercetta
    // davvero. Il secondo e' il controllo che il salvataggio fa comunque, ma
    // scoprirlo PRIMA di premere Salva vale il doppio.
    function aggiornaPannelloBox() {
        const el = document.getElementById('boxStato');
        if (!el) return;
        if (pitPoints.length < 3) {
            el.textContent = 'Corsia box non ancora disegnata: spunta la casella qui sopra e clicca in scena.';
            el.style.color = 'var(--spento)';
            return;
        }
        const pitPts = TrackGeometry.sampleOpenPath(pitPoints, 200);
        let lung = 0;
        for (let i = 1; i < pitPts.length; i++) lung += Math.hypot(pitPts[i].x - pitPts[i-1].x, pitPts[i].z - pitPts[i-1].z);
        const box = readEntryTriggerFields();
        const tocca = pitPoints.some(p => TrackGeometry.pointInOrientedBox(p.x, p.z, box));
        // Quanto il riquadro sta lontano dall'asfalto: se lo sfiora, ci finisce
        // dentro anche chi sta solo passando in pista.
        let sconfina = false;
        if (mainPoints.length >= 3) {
            const pts = TrackGeometry.sampleLoop(mainPoints, 500);
            const roadHalf = parseFloat(document.getElementById('roadHalfWidth').value) || 11;
            const c = Math.cos(box.angle), sn = Math.sin(box.angle);
            for (const [dx, dz] of [[-box.halfWidth, -box.halfLength], [box.halfWidth, -box.halfLength],
                                    [box.halfWidth, box.halfLength], [-box.halfWidth, box.halfLength]]) {
                const x = box.x + dx * c + dz * sn, z = box.z - dx * sn + dz * c;
                if (TrackGeometry.nearestPoint(pts, x, z).dist < roadHalf) sconfina = true;
            }
        }
        el.innerHTML = `corsia di <span class="valore">${lung.toFixed(0)}</span> unità su ${pitPoints.length} punti`
            + `<br>riquadro: ${tocca ? 'aggancia la corsia' : 'NON tocca la corsia — il salvataggio lo rifiuterà'}`
            + (sconfina ? "<br>sconfina sull'asfalto: manderà ai box anche chi passa dritto" : '');
        el.style.color = (tocca && !sconfina) ? 'var(--spento)' : 'var(--pericolo)';
    }

    // IL RIQUADRO D'INGRESSO AI BOX, CALCOLATO INVECE CHE TRASCINATO.
    //
    // Chi ci passa dentro va ai box: se il riquadro sborda sulla carreggiata,
    // ci finisce anche chi sta solo passando di lì a tutta velocità. Il
    // criterio non è quindi «vicino alla corsia» ma «tutto fuori
    // dall'asfalto»: si cerca il primo punto della corsia box che dista dalla
    // pista più di quanto il riquadro sia largo, e lo si mette lì, orientato
    // come la corsia.
    //
    // Richiesta dell'utente (2026-08-24): «mi serve un modo più facile per
    // posizionare il trigger, magari automatico subito fuori dalla pista
    // principale, per non far entrare per sbaglio ai box».
    const TRIGGER_MEZZA_LUNGHEZZA = 7;
    const TRIGGER_MARGINE_ASFALTO = 2;   // oltre il bordo pista, per non sfiorarlo

    function posizionaTriggerAutomatico() {
        const roadHalf = parseFloat(document.getElementById('roadHalfWidth').value) || 11;
        const pitHalf = parseFloat(document.getElementById('pitRoadHalfWidth').value) || 5;
        if (mainPoints.length < 3 || pitPoints.length < 3) {
            alert('Servono la pista e la corsia box prima di posizionare il riquadro.');
            return;
        }
        const pts = TrackGeometry.sampleLoop(mainPoints, 500);
        // Gli stessi punti che vede il gioco: la corsia agganciata alla pista.
        const agganciata = TrackGeometry.snapPitPathEnds(pitPoints, pts, roadHalf);
        const corsia = TrackGeometry.sampleOpenPath(agganciata, 200);

        // Il riquadro è largo quanto la corsia: perché stia tutto fuori
        // dall'asfalto, il suo centro deve distare almeno questo dalla pista.
        const distanzaMinima = roadHalf + pitHalf + TRIGGER_MARGINE_ASFALTO;
        let scelto = -1;
        for (let i = 0; i < corsia.length * 0.5; i++) {
            if (TrackGeometry.nearestPoint(pts, corsia[i].x, corsia[i].z).dist >= distanzaMinima) { scelto = i; break; }
        }
        if (scelto < 0) {
            alert("La corsia box non si allontana mai abbastanza dalla pista: il riquadro finirebbe sull'asfalto. Allontana la corsia dal tracciato.");
            return;
        }
        const p = corsia[scelto];
        const dopo = corsia[Math.min(scelto + 3, corsia.length - 1)];
        const angolo = Math.atan2(dopo.x - p.x, dopo.z - p.z);

        document.getElementById('entryX').value = p.x.toFixed(2);
        document.getElementById('entryZ').value = p.z.toFixed(2);
        document.getElementById('entryHalfWidth').value = pitHalf.toFixed(1);
        document.getElementById('entryHalfLength').value = TRIGGER_MEZZA_LUNGHEZZA;
        document.getElementById('entryAngleDeg').value = (angolo * 180 / Math.PI).toFixed(1);
        rebuild();
    }

    // ====================================================
    // CONTROLLA LA PISTA — i difetti detti mentre disegni, invece che
    // scoperti in gara dopo aver corso fino al punto giusto.
    //
    // Le misure NON stanno qui: stanno in TrackValidatore, che le condivide
    // con le invarianti di scenografia. Un difetto è definito una volta sola.
    // ====================================================
    const CLASSE_LIVELLO = {
        'impedisce': 'impedisce',
        'da guardare': 'guardare',
        'da sapere': 'sapere',
    };

    function portaLaVistaSu(punto) {
        if (!punto) return;
        camTarget.x = punto.x;
        camTarget.z = punto.z;
        zoom = Math.max(zoom, 2.2);   // abbastanza vicino da vedere di cosa si parla
        updateCameraTransform();
    }

    function mostraProblemi(problemi, conScenografia) {
        const elenco = document.getElementById('controllaElenco');
        const esito = document.getElementById('controllaEsito');
        const segno = document.getElementById('segnoControlla');
        elenco.innerHTML = '';

        if (!problemi.length) {
            esito.innerHTML = '<span class="tuttoBene">Nessun problema trovato.</span>'
                + (conScenografia ? ' Geometria e scenografia sono a posto.' : ' (solo geometria)');
            if (segno) segno.textContent = '';
            return;
        }

        const gravi = problemi.filter(p => p.livello === 'impedisce').length;
        esito.textContent = gravi
            ? `${gravi} ${gravi === 1 ? 'problema impedisce' : 'problemi impediscono'} di correre, su ${problemi.length} trovati.`
            : `${problemi.length} ${problemi.length === 1 ? 'cosa da guardare' : 'cose da guardare'}, niente che impedisca di correre.`;
        if (segno) segno.textContent = gravi ? '!' : '•';

        // I più gravi in cima: sono quelli che fermano il lavoro.
        const ordine = { 'impedisce': 0, 'da guardare': 1, 'da sapere': 2 };
        for (const p of problemi.slice().sort((a, b) => ordine[a.livello] - ordine[b.livello])) {
            const riga = document.createElement('div');
            riga.className = 'problema ' + (CLASSE_LIVELLO[p.livello] || '');
            riga.innerHTML = '<b>' + p.livello + '</b>' + p.messaggio;
            if (p.dove) {
                riga.title = 'Clicca per andarci';
                riga.addEventListener('click', () => portaLaVistaSu(p.dove));
            } else {
                riga.style.cursor = 'default';
            }
            elenco.appendChild(riga);
        }
    }

    async function controllaLaPista() {
        const esito = document.getElementById('controllaEsito');
        const dati = buildTrackData();
        const problemi = TrackValidatore.controllaGeometria(dati).problemi;

        // La scenografia costa un secondo di calcolo: si fa solo se la
        // geometria regge, altrimenti si sta generando su una pista che il
        // gioco non caricherebbe comunque.
        const gravi = problemi.filter(p => p.livello === 'impedisce');
        if (gravi.length || mainPoints.length < 3) {
            mostraProblemi(problemi, false);
            return;
        }

        esito.textContent = 'Dispongo la scenografia per controllarla…';
        await new Promise(r => setTimeout(r, 20));   // lascia ridisegnare il pannello
        try {
            const seats = await (await fetch('/assets/custom/circuit/grandStandSeats.json')).json();
            const terrazze = await (await fetch('/assets/custom/circuit/terraceAnchors.json')).json();
            const roadHalf = dati.roadHalfWidth;
            const pts = TrackGeometry.sampleLoop(dati.controlPoints, 1000);
            const pitPath = TrackGeometry.snapPitPathEnds(dati.pit.path, pts, roadHalf);
            const pitPts = TrackGeometry.tuckPitEndsToTrack(
                TrackGeometry.sampleOpenPath(pitPath, 300), pts);
            const barrierProfile = TrackGravel.barrierProfile(pts, {
                roadHalf, curbW: 2.8, pitLanePts: pitPts, pitRoadHalf: dati.pit.roadHalfWidth,
            });
            const barrierDist = roadHalf + 2.8 + 1.2;
            const layout = TrackScenery.generateLayout(dati, pts, pitPts, barrierDist, 45,
                seats.seats, barrierProfile, terrazze.anchors, { gridSize: 6 });
            const daScenografia = TrackValidatore.controllaScenografia(dati, layout, {
                trackPts: pts, pitPts, barrierProfile, barrierDist,
            }).problemi;
            mostraProblemi(problemi.concat(daScenografia), true);
        } catch (e) {
            mostraProblemi(problemi, false);
            document.getElementById('controllaEsito').textContent +=
                ' — la scenografia non si è potuta controllare: ' + e.message;
        }
    }

    document.getElementById('controllaBtn').addEventListener('click', controllaLaPista);

    function aggiornaRiquadroTratto() {
        const sez = document.getElementById('trattoSection');
        const segno = document.getElementById('segnoTratto');
        aggiornaRigaStato();
        aggiornaPannelloQuota();
        if (!sez) return;
        const scelto = inSegmenti() && trattoSelezionato >= 0
            && geometria.tratti[trattoSelezionato] && geometria.nodi.length >= 3;
        if (segno) segno.textContent = scelto ? '•' : '';
        if (!scelto) {
            document.getElementById('trattoTipo').textContent = 'Nessun tratto scelto: clicca un nodo in scena.';
            document.getElementById('trattoMisure').textContent = '';
            document.getElementById('trattoLunghezza').value = '';
            return;
        }
        const m = TrackSegmenti.misureTratto(geometria, trattoSelezionato);
        const tipo = geometria.tratti[trattoSelezionato].tipo;
        document.getElementById('trattoTipo').textContent =
            `dal nodo ${trattoSelezionato} al ${(trattoSelezionato + 1) % geometria.nodi.length} · ${tipo}`;
        document.getElementById('trattoLunghezza').value = m.lunghezza.toFixed(1);
        document.getElementById('trattoMisure').textContent = tipo === 'retta'
            ? 'dritto — nessun raggio'
            : `gira di ${(m.angolo * 180 / Math.PI).toFixed(0)}° · raggio minimo ${
                Number.isFinite(m.raggioMinimo) ? m.raggioMinimo.toFixed(0) : '—'}`;
    }

    // ====================================================
    // ABRASIVITÀ DELL'ASFALTO e durata delle mescole.
    //
    // Il campo `abrasivita` (0.5-2) esiste nel .json ed è già usato in gara da
    // TyreModel: all'editor mancava solo il controllo. Ma un numero fra 0.5 e
    // 2 non dice niente a nessuno — accanto ci va quanto dura una gomma.
    //
    // ⚠️ Quella previsione NON si ricalcola qui. TyreModel è un modulo del
    // backend e non si carica in una pagina statica; riscrivere la formula
    // darebbe due numeri per la stessa cosa, che prima o poi divergono. La
    // chiede al server, che risponde con la funzione vera.
    // ====================================================
    function giriPrevisti() {
        if (mainPoints.length < 3) return null;
        const pts = TrackGeometry.sampleLoop(mainPoints, 500);
        return TrackGeometry.lapsForDistance(
            TrackGeometry.lapLength(pts),
            parseFloat(document.getElementById('targetKm').value) || 5);
    }

    let ultimaRichiestaAbrasivita = 0;
    async function aggiornaAbrasivita() {
        const el = document.getElementById('abrasivitaInfo');
        if (!el) return;
        const abr = parseFloat(document.getElementById('abrasivita').value) || 1;
        const giri = giriPrevisti();
        if (!giri) {
            el.textContent = `abrasività ${abr.toFixed(2)} · disegna la pista per la previsione`;
            return;
        }
        // Lo slider spara richieste ad ogni pixel: vince l'ultima partita, non
        // l'ultima arrivata.
        const mia = ++ultimaRichiestaAbrasivita;
        try {
            const res = await fetch(`/api/f1/giri-per-mescola?laps=${giri}&abrasivita=${abr}`);
            const g = await res.json();
            if (mia !== ultimaRichiestaAbrasivita) return;
            el.textContent = `abrasività ${abr.toFixed(2)} · ${giri} giri di gara · una gomma dura: soft ${g.soft}, medium ${g.medium}, hard ${g.hard}`;
        } catch (err) {
            if (mia !== ultimaRichiestaAbrasivita) return;
            el.textContent = `abrasività ${abr.toFixed(2)} · ${giri} giri di gara · previsione non disponibile`;
        }
    }

    function rigeneraDaGeometria() {
        mainPoints = geometria.nodi.length >= 3
            ? TrackSegmenti.cuoci(geometria, TrackSegmenti.PASSO_COTTURA)
            : [];
    }

    // Traguardo esplicito: indipendente da mainPoints/pitPoints (un solo
    // punto, non una lista). null finché non caricato/impostato — in quel
    // caso si comporta come oggi (indice 0, angolo dedotto dalla tangente),
    // vedi rebuild().
    let startFinish = null; // { x, z, angle }
    let startFinishMarker = null;
    let startFinishRotateHandle = null;
    let startFinishDirectionArrow = null;
    const startFinishGroup = new THREE.Group();
    scene.add(startFinishGroup);

    // Colore del marker quando l'angolo scelto è (quasi) opposto al verso
    // geometrico reale — stesso rosso di allarme usato altrove nell'editor,
    // MAI applicato ai dati (nessuna correzione automatica, solo un
    // avviso visivo — Rif. audit 2026-07-29 "verso pista invertito").
    const STARTFINISH_COLOR_OK = 0xffffff;
    const STARTFINISH_COLOR_MISMATCH = 0xe74c3c;
    // Stessa soglia (e stesso motivo: non disturbare un traguardo
    // volutamente leggermente obliquo) del warning runtime gemello in
    // backend/sockets/games/trackLoader.js — se una delle due cambia,
    // aggiornare anche l'altra.
    const STARTFINISH_OPPOSITE_TOLERANCE_DEG = 30;

    function ensureStartFinishMeshes() {
        if (startFinishMarker) return;
        const markerGeo = new THREE.ConeGeometry(3, 8, 4);
        const markerMat = new THREE.MeshBasicMaterial({ color: STARTFINISH_COLOR_OK });
        startFinishMarker = new THREE.Mesh(markerGeo, markerMat);
        startFinishMarker.userData = { role: 'startFinishMarker' };
        const handleGeo = new THREE.SphereGeometry(2.5, 12, 12);
        const handleMat = new THREE.MeshBasicMaterial({ color: 0xe67e22 });
        startFinishRotateHandle = new THREE.Mesh(handleGeo, handleMat);
        startFinishRotateHandle.userData = { role: 'startFinishRotateHandle' };
        // Freccia di riferimento (verde): mostra il verso GEOMETRICO reale
        // della pista (quello che governa davvero trackIndex/lookahead/
        // cornerTargetSpeed/racingLine — mai l'angolo scelto qui), per
        // confronto visivo diretto col cono bianco. Non cliccabile/non
        // trascinabile: solo un riferimento.
        const arrowGeo = new THREE.ConeGeometry(2, 6, 4);
        const arrowMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71 });
        startFinishDirectionArrow = new THREE.Mesh(arrowGeo, arrowMat);
        startFinishDirectionArrow.userData = { role: 'startFinishDirectionArrow' };
        startFinishGroup.add(startFinishMarker, startFinishRotateHandle, startFinishDirectionArrow);
    }

    // Verso geometrico reale nel punto del traguardo — stessa tecnica di
    // trackLoader.js::buildTrack (nearestPoint + tangentAt), qui ricalcolata
    // sui punti dell'editor invece che scriverla una volta sola e tenerla
    // sincronizzata: l'editor non ha un ciclo di render a costo significativo,
    // ricampionare ad ogni update non è un problema di prestazioni qui.
    function geometricStartFinishAngle() {
        if (!startFinish || mainPoints.length < 3) return null;
        const pts = TrackGeometry.sampleLoop(mainPoints, 500);
        const idx = TrackGeometry.nearestPoint(pts, startFinish.x, startFinish.z).index;
        const tangent = TrackGeometry.tangentAt(pts, idx, true);
        return Math.atan2(tangent.tx, tangent.tz);
    }

    // Il cono (marker) punta lungo +Z locale di default (ConeGeometry si
    // sviluppa lungo Y, ruotato qui una volta di 90° su X per sdraiarlo sul
    // piano orizzontale) — rotation.y = angle lo orienta nel verso di marcia.
    // ⚠️ ORIENTARE UN CONO NEL VERSO DI MARCIA, e farlo davvero.
    //
    // Il cono di Three cresce lungo +Y; sdraiato con una rotazione di 90° su X
    // e poi girato di `angolo` su Z, la sua punta finisce in (-sin, cos) —
    // cioè SPECCHIATA rispetto alla convenzione del progetto, dove un angolo
    // vale (dx, dz) = (sin, cos). Per due mesi il cono del traguardo e la
    // freccia del verso hanno indicato la direzione sbagliata ogni volta che
    // la pista non correva lungo Z: misurato su monte-rosso, 156° di scarto
    // dal verso vero. Segnalato dall'utente il 2026-08-24 — «la freccia verde
    // punta al lato opposto rispetto a quello in cui si corre».
    //
    // I DATI erano giusti (la maniglia arancione sta a (sin, cos) e l'angolo
    // salvato segue lei): sbagliava solo il disegno. Ed è il motivo per cui
    // «non si capiva la maniglia»: maniglia e cono raccontavano due versi
    // diversi.
    function orientaVersoDiMarcia(mesh, angolo) {
        mesh.rotation.set(Math.PI / 2, 0, -angolo);
    }

    function updateStartFinishMeshes() {
        if (!startFinish) { startFinishGroup.visible = false; return; }
        startFinishGroup.visible = true;
        ensureStartFinishMeshes();
        startFinishMarker.position.set(startFinish.x, 1, startFinish.z);
        orientaVersoDiMarcia(startFinishMarker, startFinish.angle);
        const handleDist = 12;
        startFinishRotateHandle.position.set(
            startFinish.x + Math.sin(startFinish.angle) * handleDist,
            1,
            startFinish.z + Math.cos(startFinish.angle) * handleDist
        );

        // Freccia verde di riferimento + evidenza se il facing scelto è
        // quasi opposto al verso reale (stessa diagnosi/soglia del warning
        // gemello in trackLoader.js — MAI una correzione automatica qui,
        // solo segnalazione: la scelta resta dell'utente).
        const geometricAngle = geometricStartFinishAngle();
        let mismatch = false;
        if (geometricAngle != null) {
            startFinishDirectionArrow.visible = true;
            startFinishDirectionArrow.position.set(startFinish.x, 1, startFinish.z);
            orientaVersoDiMarcia(startFinishDirectionArrow, geometricAngle);
            let diffDeg = (startFinish.angle - geometricAngle) * 180 / Math.PI;
            while (diffDeg > 180) diffDeg -= 360;
            while (diffDeg <= -180) diffDeg += 360;
            mismatch = Math.abs(Math.abs(diffDeg) - 180) < STARTFINISH_OPPOSITE_TOLERANCE_DEG;
        } else {
            startFinishDirectionArrow.visible = false;
        }
        startFinishMarker.material.color.setHex(mismatch ? STARTFINISH_COLOR_MISMATCH : STARTFINISH_COLOR_OK);
        const warningEl = document.getElementById('startFinishWarning');
        if (warningEl) warningEl.style.display = mismatch ? 'block' : 'none';
    }
    let trackMeshGroup = null;
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    function activeList() {
        return document.getElementById('pitMode').checked ? pitPoints : mainPoints;
    }

    // ====================================================
    // OVERLAY IMMAGINE DI RIFERIMENTO — incollata con Ctrl+V, serve solo a
    // ricalcare un tracciato reale con i punti esistenti. Non persiste (né
    // in buildTrackData() né sul server): sparisce a reload/cambio pista.
    // ====================================================
    let imageOverlay = null;      // { mesh, texture, x, z, rotation, width, height, opacity }
    let imagePositioning = false; // true = maniglie attive, click normali sospesi
    let imageDrag = null;         // { mode: 'move'|'scale'|'rotate', ...dati iniziali }
    let scaleHandleMesh = null;
    let rotateHandleMesh = null;
    const imageHandleGroup = new THREE.Group();
    scene.add(imageHandleGroup);

    function updateImageOverlayTransform() {
        if (!imageOverlay) return;
        imageOverlay.mesh.position.set(imageOverlay.x, -0.05, imageOverlay.z);
        imageOverlay.mesh.rotation.y = imageOverlay.rotation;
        imageOverlay.mesh.scale.set(imageOverlay.width, 1, imageOverlay.height);
    }

    // Le maniglie sono posizionate ricalcolando a mano la trasformazione
    // (centro + rotazione Y) invece di essere figlie del mesh dell'immagine:
    // così restano oggetti di primo livello, facili da raycastare separati
    // dal piano stesso (vedi pickImageHandle).
    function updateImageHandles() {
        if (!imageOverlay || !imagePositioning) return;
        const { x, z, rotation, width, height } = imageOverlay;
        const cos = Math.cos(rotation), sin = Math.sin(rotation);

        const cornerLocalX = width / 2, cornerLocalZ = height / 2;
        scaleHandleMesh.position.set(
            x + cornerLocalX * cos + cornerLocalZ * sin,
            0.2,
            z - cornerLocalX * sin + cornerLocalZ * cos
        );

        const gap = Math.max(6, height * 0.15);
        const topLocalZ = -(height / 2 + gap);
        rotateHandleMesh.position.set(x + topLocalZ * sin, 0.2, z + topLocalZ * cos);
    }

    function enterImagePositioning() {
        if (!imageOverlay) return;
        imagePositioning = true;
        if (!scaleHandleMesh) {
            const handleGeo = new THREE.SphereGeometry(3, 12, 12);
            scaleHandleMesh = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: 0x2ecc71 }));
            scaleHandleMesh.userData = { mode: 'scale' };
            rotateHandleMesh = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: 0xe67e22 }));
            rotateHandleMesh.userData = { mode: 'rotate' };
        }
        imageHandleGroup.add(scaleHandleMesh, rotateHandleMesh);
        updateImageHandles();
    }

    function exitImagePositioning() {
        imagePositioning = false;
        imageDrag = null;
        imageHandleGroup.clear();
    }

    function setOverlayImage(img) {
        if (imageOverlay) removeImageOverlay();
        const texture = new THREE.Texture(img);
        texture.needsUpdate = true;
        const aspect = img.width / img.height;
        const width  = aspect >= 1 ? 150 : 150 * aspect;
        const height = aspect >= 1 ? 150 / aspect : 150;
        // Piano unitario "sdraiato" una volta sola in fase di creazione: da
        // qui in poi basta scale.set(width,1,height) per dimensionarlo,
        // niente da ricalcolare sulla geometria ad ogni resize.
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({
            map: texture, transparent: true, opacity: 1,
            depthWrite: false, side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geo, material);
        scene.add(mesh);

        imageOverlay = { mesh, texture, x: camTarget.x, z: camTarget.z, rotation: 0, width, height, opacity: 1 };
        updateImageOverlayTransform();

        document.getElementById('imgOverlaySection').style.display = 'block';
        enterImagePositioning();
    }

    function removeImageOverlay() {
        if (!imageOverlay) return;
        scene.remove(imageOverlay.mesh);
        imageOverlay.mesh.geometry.dispose();
        imageOverlay.mesh.material.dispose();
        imageOverlay.texture.dispose();
        imageOverlay = null;
        exitImagePositioning();
        document.getElementById('imgOverlaySection').style.display = 'none';
    }

    function pickImageHandle(ev) {
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        const hits = raycaster.intersectObjects(imageHandleGroup.children);
        return hits.length > 0 ? hits[0].object : null;
    }

    function pickImageBody(ev) {
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        return raycaster.intersectObject(imageOverlay.mesh).length > 0;
    }

    document.addEventListener('paste', (ev) => {
        const items = ev.clipboardData && ev.clipboardData.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                ev.preventDefault();
                const blob = item.getAsFile();
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => { setOverlayImage(img); URL.revokeObjectURL(url); };
                img.src = url;
                break;
            }
        }
    });

    document.getElementById('imgConfirmBtn').addEventListener('click', exitImagePositioning);
    document.getElementById('imgEditBtn').addEventListener('click', enterImagePositioning);
    document.getElementById('imgRemoveBtn').addEventListener('click', removeImageOverlay);

    // ====================================================
    // FEEDBACK VISIVO QUOTA (y) — vista dall'alto: la posizione verticale
    // non si vede, quindi la quota va resa con colore (giallo=0, rosso=su,
    // blu=giù) e dimensione del marker. Materiali precalcolati a bucket
    // fissi per evitare di allocarne di nuovi ad ogni rebuild (chiamato
    // anche durante il drag, quindi molte volte al secondo).
    const Y_RANGE = 5; // |y| oltre questo valore satura colore/scala
    const Y_BUCKETS = 21;
    const yMarkerMaterials = [];
    for (let i = 0; i < Y_BUCKETS; i++) {
        const y = -Y_RANGE + (i / (Y_BUCKETS - 1)) * (2 * Y_RANGE);
        const base = new THREE.Color(0xf1c40f);
        const col = y >= 0
            ? base.clone().lerp(new THREE.Color(0xe74c3c), Math.min(1, y / Y_RANGE))
            : base.clone().lerp(new THREE.Color(0x3498db), Math.min(1, -y / Y_RANGE));
        yMarkerMaterials.push(new THREE.MeshBasicMaterial({ color: col }));
    }
    function materialForY(y) {
        const t = Math.min(1, Math.max(0, (y + Y_RANGE) / (2 * Y_RANGE)));
        return yMarkerMaterials[Math.round(t * (Y_BUCKETS - 1))];
    }
    function scaleForY(y) {
        return 1 + Math.max(-0.5, Math.min(1.5, y / (Y_RANGE * 0.8)));
    }

    // Ricreata ad ogni modifica: dataset piccoli (poche decine di punti),
    // costo trascurabile per uno strumento dev-only.
    function rebuild() {
        if (trackMeshGroup) scene.remove(trackMeshGroup);
        trackMeshGroup = new THREE.Group();
        scene.add(trackMeshGroup);

        const roadHalf    = parseFloat(document.getElementById('roadHalfWidth').value) || 11;
        const pitRoadHalf = parseFloat(document.getElementById('pitRoadHalfWidth').value) || 5;
        const pitBoxIndex = parseInt(document.getElementById('pitBoxIndex').value, 10) || 0;
        const CURB_W = 2.8;
        const TRACK_COLOR = 0x1e1e1e;

        let pts = null;
        // Campioni della corsia box agganciata (snap+abbraccio alla curva)
        // vicino ai due estremi, entro la stessa finestra usata da
        // frontend/f1.js::pitMergeSamples — SOLO per far vedere in anteprima
        // dove il cordolo verrà ricolorato (buildCurbs), coerente col gioco
        // reale.
        let pitMergeSamples = null;
        if (mainPoints.length >= 3) {
            pts = TrackGeometry.sampleLoop(mainPoints, 500);
            TrackMeshBuilder.buildRibbon(trackMeshGroup, pts, roadHalf, new THREE.MeshStandardMaterial({ color: TRACK_COLOR, roughness: 0.95, side: THREE.DoubleSide }));
            const startIdx = startFinish
                ? TrackGeometry.nearestPoint(pts, startFinish.x, startFinish.z).index
                : 0;
            TrackMeshBuilder.buildStartLine(trackMeshGroup, pts, roadHalf, startIdx);
        }
        // Anteprima fedele: la corsia box disegnata è quella AGGANCIATA e
        // "abbracciata" alla curva vera (stesse funzioni usate dal gioco
        // reale) — i marker trascinabili (pitPoints) restano quelli grezzi,
        // così l'autore continua a piazzarli "circa lì" e il sistema
        // perfeziona da solo il punto di contatto.
        if (pts && pitPoints.length >= 3 && pitBoxIndex < pitPoints.length) {
            const snappedPitPoints = TrackGeometry.snapPitPathEnds(pitPoints, pts, roadHalf);
            TrackMeshBuilder.buildPitLane(trackMeshGroup, snappedPitPoints, pitRoadHalf, pitBoxIndex, true, pts, TRACK_COLOR, roadHalf, CURB_W);

            const pitPtsSampled = TrackGeometry.tuckPitEndsToTrack(TrackGeometry.sampleOpenPath(snappedPitPoints, 300), pts);
            const n = pitPtsSampled.length;
            const cum = [0];
            for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pitPtsSampled[i].x - pitPtsSampled[i - 1].x, pitPtsSampled[i].z - pitPtsSampled[i - 1].z));
            const total = cum[n - 1];
            const WINDOW = 75;
            pitMergeSamples = pitPtsSampled.filter((_, i) => cum[i] < WINDOW || total - cum[i] < WINDOW);
        }
        if (pts) TrackMeshBuilder.buildCurbs(trackMeshGroup, pts, roadHalf, CURB_W, pitMergeSamples);

        markerGroup.clear();
        const pitMat = new THREE.MeshBasicMaterial({ color: 0x3498db });
        const bridgeMat = new THREE.MeshBasicMaterial({ color: 0xff8c00 });
        const geo = new THREE.SphereGeometry(2, 12, 12);
        // In modalità segmenti i marker sono i NODI: i punti cotti sono
        // centinaia e non si trascinano — sono il prodotto, non il disegno.
        // Più grandi, perché sono pochi e ognuno conta.
        const selMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71 });
        listaDi('main').forEach((p, i) => {
            const y = p.y || 0;
            const scelto = inSegmenti() && i === nodoSelezionato;
            const m = new THREE.Mesh(geo, scelto ? selMat : (p.bridge ? bridgeMat : materialForY(y)));
            m.scale.setScalar(scaleForY(y) * (inSegmenti() ? 1.4 : 1));
            m.position.set(p.x, y + 1, p.z);
            m.userData = { list: 'main', index: i };
            markerGroup.add(m);
        });
        pitPoints.forEach((p, i) => {
            const m = new THREE.Mesh(geo, pitMat);
            m.position.set(p.x, 1, p.z);
            m.userData = { list: 'pit', index: i };
            markerGroup.add(m);
        });

        // LA MANIGLIA esce dal nodo scelto nella sua direzione: si trascina
        // per girare la tangente, e con essa le due curve che vi si
        // appoggiano. Una sola alla volta — quella del nodo scelto — perché
        // su una pista da quaranta nodi quaranta maniglie non si guardano.
        if (inSegmenti() && nodoSelezionato >= 0 && geometria.nodi[nodoSelezionato]) {
            const nodo = geometria.nodi[nodoSelezionato];
            const v = TrackSegmenti.versore(nodo.dir);
            const LUNGHEZZA = 26;
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(2.6, 12, 12),
                new THREE.MeshBasicMaterial({ color: 0x2ecc71 }));
            mesh.position.set(nodo.x + v.dx * LUNGHEZZA, (nodo.y || 0) + 1, nodo.z + v.dz * LUNGHEZZA);
            mesh.userData = { maniglia: nodoSelezionato };
            markerGroup.add(mesh);

            // L'asta, così si vede a colpo d'occhio da quale nodo esce.
            const asta = new THREE.Mesh(
                new THREE.BoxGeometry(0.8, 0.4, LUNGHEZZA),
                new THREE.MeshBasicMaterial({ color: 0x27ae60 }));
            asta.position.set(nodo.x + v.dx * LUNGHEZZA / 2, (nodo.y || 0) + 1, nodo.z + v.dz * LUNGHEZZA / 2);
            asta.rotation.y = nodo.dir;
            markerGroup.add(asta);
        }

        // LA TRASPARENZA VA SUL TRACCIATO, non sull'immagine di riferimento
        // (richiesta esplicita dell'utente): per controllare un ricalco si
        // sbiadisce cio' che si sta disegnando, mentre il riferimento deve
        // restare nitido — sbiadire proprio quello era il contrario.
        //
        // Solo il nastro: i marker restano pieni, perche' servono a cliccarci
        // sopra e un marker trasparente non si prende piu'.
        const opacitaPista = (parseInt(document.getElementById('trackOpacity').value, 10) || 100) / 100;
        trackMeshGroup.traverse((o) => {
            if (!o.isMesh || !o.material) return;
            o.material.transparent = opacitaPista < 1;
            o.material.opacity = opacitaPista;
        });

        // IL TRAGUARDO NASCE CON LA PISTA. Prima esisteva solo se lo portava un
        // file caricato: disegnando da zero il cono non compariva mai, e la
        // pista si salvava senza traguardo (il gioco ripiegava sul campione 0
        // e sulla tangente lì). Segnalato dall'utente il 2026-08-24:
        // «ho creato un tracciato temporaneo e non vedo il cono».
        if (!startFinish && mainPoints.length >= 3) {
            const pts = TrackGeometry.sampleLoop(mainPoints, 500);
            const t = TrackGeometry.tangentAt(pts, 0, true);
            startFinish = { x: mainPoints[0].x, z: mainPoints[0].z, angle: Math.atan2(t.tx, t.tz) };
        }
        if (startFinish && mainPoints.length < 3) startFinish = null;
        updateStartFinishMeshes();

        updateEntryTriggerVisual();
        aggiornaAbrasivita();
        aggiornaRigaStato();
        aggiornaPannelloTraguardo();
        aggiornaPannelloQuota();
        aggiornaPannelloForma();
        aggiornaPannelloBox();
    }

    // ⚠️ IL VERSO DELLA PISTA, IN NUMERI. Il cono bianco e la freccia verde
    // dicono la stessa cosa in modo grafico, e l'utente ha detto chiaramente
    // che così non si capisce: «continuo a non capire assolutamente come
    // funziona l'allineamento del traguardo». Un angolo e uno scarto in gradi
    // si leggono senza interpretare due frecce sovrapposte.
    function aggiornaPannelloTraguardo() {
        const el = document.getElementById('startFinishStato');
        if (!el) return;
        if (!startFinish) {
            el.textContent = 'Nessun traguardo: servono almeno 3 nodi.';
            return;
        }
        const reale = geometricStartFinishAngle();
        const gradi = (r) => ((r * 180 / Math.PI) % 360 + 360) % 360;
        if (reale == null) {
            el.textContent = `verso scelto ${gradi(startFinish.angle).toFixed(0)}°`;
            return;
        }
        const scarto = Math.abs(Math.atan2(Math.sin(startFinish.angle - reale),
                                           Math.cos(startFinish.angle - reale))) * 180 / Math.PI;
        const giudizio = scarto < 15 ? 'allineato'
            : scarto < 90 ? 'storto' : 'CONTROMANO';
        el.innerHTML = `verso scelto <span class="valore">${gradi(startFinish.angle).toFixed(0)}°</span>`
            + ` · verso della pista <span class="valore">${gradi(reale).toFixed(0)}°</span><br>`
            + `scarto <span class="valore">${scarto.toFixed(0)}°</span> — ${giudizio}`;
        el.style.color = scarto < 15 ? 'var(--accento)' : scarto < 90 ? 'var(--spento)' : 'var(--pericolo)';
    }

    // ====================================================
    // RIQUADRO TRIGGER INGRESSO PIT — wireframe live sopra la pista, per
    // vedere a occhio se corrisponde davvero alla corsia box prima di
    // salvare (bug reale: un riquadro lasciato ai valori di un'altra pista
    // intercettava un tratto qualunque del tracciato principale).
    // ====================================================
    let entryTriggerFrame = null; // THREE.Group di 4 barre piatte: cornice visiva E bersaglio del drag
    // Spessore fisso della cornice, stessa scala d'ingombro dei marker/maniglie
    // già cliccabili in questo editor (sfere raggio 2-3): un wireframe sottile
    // (1px) era troppo difficile da centrare col mouse per trascinarlo.
    const ENTRY_TRIGGER_FRAME_THICKNESS = 5;
    // Valori "senza limite" (es. -999, convenzione ereditata da Monte Rosso
    // per il lato del riquadro che non deve restringere nulla) renderebbero
    // il wireframe enorme e inutile da vedere, quindi la visualizzazione
    // clampa — il valore salvato nel JSON resta sempre quello scritto nel
    // campo, mai quello clampato. Il limite però NON può essere un numero
    // fisso: un tracciato con punti lontani dall'origine (bug reale,
    // riscontrato su un tracciato con punti fino a x=-966) faceva sembrare
    // il riquadro "bloccato" a un bordo — il valore era corretto (es.
    // xMin=-700), ma il disegno veniva tagliato a un limite fisso più
    // stretto (600) del tutto scollegato dall'estensione vera del
    // tracciato. Il limite si ricalcola quindi sul tracciato in editing.
    const VISUAL_CLAMP_MIN    = 600; // minimo ragionevole per un tracciato piccolo/vuoto
    const VISUAL_CLAMP_MARGIN = 200; // oltre il punto più lontano dall'origine
    function visualClampExtent() {
        let maxAbs = VISUAL_CLAMP_MIN;
        for (const p of mainPoints) maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.z));
        for (const p of pitPoints)  maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.z));
        return maxAbs + VISUAL_CLAMP_MARGIN;
    }
    // Legge i 5 campi e restituisce il rettangolo nel formato usato da
    // TrackGeometry.pointInOrientedBox (angolo in RADIANTI — il campo HTML
    // è in gradi solo per comodità di battitura, converte qui in un unico
    // punto).
    function readEntryTriggerFields() {
        const x = parseFloat(document.getElementById('entryX').value);
        const z = parseFloat(document.getElementById('entryZ').value);
        const halfWidth = parseFloat(document.getElementById('entryHalfWidth').value);
        const halfLength = parseFloat(document.getElementById('entryHalfLength').value);
        const angleDeg = parseFloat(document.getElementById('entryAngleDeg').value);
        return { x, z, halfWidth, halfLength, angle: angleDeg * Math.PI / 180 };
    }

    function updateEntryTriggerVisual() {
        if (entryTriggerFrame) { scene.remove(entryTriggerFrame); entryTriggerFrame = null; }
        const box = readEntryTriggerFields();
        if (![box.x, box.z, box.halfWidth, box.halfLength, box.angle].every(Number.isFinite)) return;
        if (!(box.halfWidth > 0) || !(box.halfLength > 0)) return;

        const clamp = visualClampExtent();
        if (Math.abs(box.x) > clamp || Math.abs(box.z) > clamp) return;

        // Cornice = 4 barre piatte in coordinate LOCALI del rettangolo,
        // ruotate come UN SOLO gruppo di box.angle: stessa idea della
        // cornice assi-allineata di prima, ma ora l'intero gruppo ruota
        // invece delle singole barre calcolate in coordinate mondo.
        const t = ENTRY_TRIGGER_FRAME_THICKNESS;
        const w = box.halfWidth * 2, d = box.halfLength * 2;
        const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
        entryTriggerFrame = new THREE.Group();
        entryTriggerFrame.position.set(box.x, 1.5, box.z);
        entryTriggerFrame.rotation.y = box.angle;

        const barFrontBack = new THREE.PlaneGeometry(w, t);
        const front = new THREE.Mesh(barFrontBack, mat);
        front.rotation.x = -Math.PI / 2;
        front.position.set(0, 0, box.halfLength - t / 2);
        const back = new THREE.Mesh(barFrontBack, mat);
        back.rotation.x = -Math.PI / 2;
        back.position.set(0, 0, -box.halfLength + t / 2);

        const barSide = new THREE.PlaneGeometry(t, Math.max(0.01, d - 2 * t));
        const left = new THREE.Mesh(barSide, mat);
        left.rotation.x = -Math.PI / 2;
        left.position.set(-box.halfWidth + t / 2, 0, 0);
        const right = new THREE.Mesh(barSide, mat);
        right.rotation.x = -Math.PI / 2;
        right.position.set(box.halfWidth - t / 2, 0, 0);

        entryTriggerFrame.add(front, back, left, right);
        scene.add(entryTriggerFrame);
    }

    function pickEntryTriggerFrame(ev) {
        if (!entryTriggerFrame) return false;
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        return raycaster.intersectObjects(entryTriggerFrame.children).length > 0;
    }

    // ====================================================
    // INTERAZIONE
    // ====================================================
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    function worldFromEvent(ev) {
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        const hit = new THREE.Vector3();
        raycaster.ray.intersectPlane(groundPlane, hit);
        return hit;
    }

    function pickMarker(ev) {
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        const hits = raycaster.intersectObjects(markerGroup.children);
        return hits.length > 0 ? hits[0].object : null;
    }

    let dragging = null;
    let panning = false;
    let panLast = { x: 0, y: 0 };
    let triggerDrag = null; // { startHitX, startHitZ, startX, startZ }
    let startFinishDrag = null;

    // Tenuta aggiornata per poter "riusare" pickMarker anche da un evento
    // tastiera (keydown non porta la posizione del mouse) — vedi tasto B.
    let lastMouseClient = { clientX: 0, clientY: 0 };

    renderer.domElement.addEventListener('mousedown', (ev) => {
        if (ev.button === 1) {
            // Tasto centrale: pan, mai aggiunta/selezione punti.
            ev.preventDefault();
            panning = true;
            panLast = { x: ev.clientX, y: ev.clientY };
            return;
        }
        if (ev.button === 2) return;
        if (imagePositioning) {
            const handle = pickImageHandle(ev);
            if (handle) {
                imageDrag = handle.userData.mode === 'scale'
                    ? { mode: 'scale', startWidth: imageOverlay.width, startHeight: imageOverlay.height,
                        startCornerDist: 0.5 * Math.hypot(imageOverlay.width, imageOverlay.height) }
                    : { mode: 'rotate' };
                return;
            }
            if (pickImageBody(ev)) imageDrag = { mode: 'move' };
            return;
        }
        if (startFinish) {
            mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
            mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
            raycaster.setFromCamera(mouseNDC, camera);
            const hits = raycaster.intersectObjects([startFinishMarker, startFinishRotateHandle]);
            if (hits.length > 0) {
                startFinishDrag = { mode: hits[0].object === startFinishRotateHandle ? 'rotate' : 'move' };
                return;
            }
        }
        const marker = pickMarker(ev);
        if (marker) {
            salvaStato();
            dragging = marker.userData;
            if (marker.userData.maniglia !== undefined) return;   // la maniglia non seleziona
            // Cliccare un nodo lo sceglie, e sceglie il tratto che ne PARTE:
            // è quello che si vede davanti quando lo si guarda.
            if (inSegmenti() && marker.userData.list === 'main') {
                nodoSelezionato = marker.userData.index;
                trattoSelezionato = marker.userData.index;
                mostraPagina('tratto');
                rebuild();
                aggiornaRiquadroTratto();
            }
            return;
        }
        if (pickEntryTriggerFrame(ev)) {
            const hit = worldFromEvent(ev);
            triggerDrag = {
                startHitX: hit.x, startHitZ: hit.z,
                startX: parseFloat(document.getElementById('entryX').value),
                startZ: parseFloat(document.getElementById('entryZ').value),
            };
            return;
        }
        const hit = worldFromEvent(ev);
        // In modalità segmenti si posa un NODO, non un punto di controllo: i
        // punti li produce la cottura. La corsia box resta a punti — ha una
        // geometria sua, che questo progetto non tocca.
        if (inSegmenti() && !document.getElementById('pitMode').checked) {
            salvaStato();
            geometria.nodi.push({ x: +hit.x.toFixed(2), z: +hit.z.toFixed(2), y: 0, dir: 0 });
            geometria.tratti.push({ tipo: 'curva' });
            dopoModificaMain();
            rebuild();
            return;
        }
        activeList().push({ x: +hit.x.toFixed(2), z: +hit.z.toFixed(2) });
        rebuild();
    });

    renderer.domElement.addEventListener('mousemove', (ev) => {
        lastMouseClient = { clientX: ev.clientX, clientY: ev.clientY };
        if (panning) {
            const dx = ev.clientX - panLast.x;
            const dy = ev.clientY - panLast.y;
            panLast = { x: ev.clientX, y: ev.clientY };
            // Pixel -> unità mondo, alla scala di zoom corrente.
            const worldPerPixelX = (camera.right - camera.left) / window.innerWidth;
            const worldPerPixelY = (camera.top - camera.bottom) / window.innerHeight;
            camTarget.x -= dx * worldPerPixelX;
            camTarget.z -= dy * worldPerPixelY;
            updateCameraTransform();
            return;
        }
        if (imageDrag) {
            const hit = worldFromEvent(ev);
            if (imageDrag.mode === 'move') {
                imageOverlay.x = hit.x;
                imageOverlay.z = hit.z;
            } else if (imageDrag.mode === 'scale') {
                const dist = Math.hypot(hit.x - imageOverlay.x, hit.z - imageOverlay.z);
                const ratio = Math.max(0.05, dist / imageDrag.startCornerDist);
                imageOverlay.width = imageDrag.startWidth * ratio;
                imageOverlay.height = imageDrag.startHeight * ratio;
            } else if (imageDrag.mode === 'rotate') {
                const dx = hit.x - imageOverlay.x, dz = hit.z - imageOverlay.z;
                imageOverlay.rotation = Math.atan2(-dx, -dz);
            }
            updateImageOverlayTransform();
            updateImageHandles();
            return;
        }
        if (triggerDrag) {
            const hit = worldFromEvent(ev);
            const dx = hit.x - triggerDrag.startHitX;
            const dz = hit.z - triggerDrag.startHitZ;
            document.getElementById('entryX').value = (triggerDrag.startX + dx).toFixed(2);
            document.getElementById('entryZ').value = (triggerDrag.startZ + dz).toFixed(2);
            updateEntryTriggerVisual();
            return;
        }
        if (startFinishDrag) {
            const hit = worldFromEvent(ev);
            if (startFinishDrag.mode === 'move') {
                startFinish.x = +hit.x.toFixed(2);
                startFinish.z = +hit.z.toFixed(2);
            } else {
                // Stesso calcolo già usato per la maniglia di rotazione
                // dell'overlay immagine (riga 441): atan2(-dx,-dz) dà
                // l'angolo nel verso di marcia (Z locale) coerente con
                // TrackGeometry.tangentAt (tx,tz) usato altrove.
                const dx = hit.x - startFinish.x, dz = hit.z - startFinish.z;
                startFinish.angle = Math.atan2(-dx, -dz) + Math.PI;
            }
            updateStartFinishMeshes();
            aggiornaPannelloTraguardo();
            return;
        }
        if (!dragging) return;
        const hit = worldFromEvent(ev);

        // Trascinare la maniglia gira la TANGENTE del nodo, non lo sposta.
        if (dragging.maniglia !== undefined) {
            const nodo = geometria.nodi[dragging.maniglia];
            if (!nodo) return;
            let dir = Math.atan2(hit.x - nodo.x, hit.z - nodo.z);
            // Snap a 15°: è ciò che rende paralleli due rettilinei senza
            // misurarli. Alt lo sospende, per le direzioni fuori griglia.
            if (!ev.altKey) {
                const PASSO = Math.PI / 12;
                dir = Math.round(dir / PASSO) * PASSO;
            }
            nodo.dir = dir;
            // Da qui in poi la direzione è una scelta dell'autore: il
            // riorientamento automatico non la tocca più.
            nodo.dirManuale = true;
            rigeneraDaGeometria();
            rebuild();
            return;
        }

        const p = listaDi(dragging.list)[dragging.index];
        p.x = +hit.x.toFixed(2);
        p.z = +hit.z.toFixed(2);
        dopoModificaMain();
        rebuild();
    });

    window.addEventListener('mouseup', () => { dragging = null; panning = false; imageDrag = null; triggerDrag = null; startFinishDrag = null; });

    renderer.domElement.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const marker = pickMarker(ev);
        if (!marker || marker.userData.maniglia !== undefined) return;
        salvaStato();
        listaDi(marker.userData.list).splice(marker.userData.index, 1);
        // Un nodo in meno è anche un tratto in meno: la catena ne ha uno per
        // nodo, ed è l'invariante che tiene chiusa la geometria.
        if (inSegmenti() && marker.userData.list === 'main') {
            geometria.tratti.splice(marker.userData.index, 1);
            nodoSelezionato = -1;
            trattoSelezionato = -1;
        }
        dopoModificaMain();
        rebuild();
    });

    // Rotellina su un punto della pista principale: alza/abbassa la y
    // (dislivello solo visivo — nessun effetto sulla fisica server).
    // Rotellina altrove: zoom della visuale, centrato sul cursore.
    renderer.domElement.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const marker = pickMarker(ev);
        if (marker && marker.userData.list === 'main') {
            salvaStato();
            const p = listaDi('main')[marker.userData.index];
            p.y = +(((p.y || 0) - Math.sign(ev.deltaY) * 0.5).toFixed(2));
            dopoModificaMain();
            rebuild();
            return;
        }
        const before = worldFromEvent(ev);
        zoom = Math.min(Math.max(zoom * (ev.deltaY > 0 ? 0.9 : 1.1), 0.2), 6);
        updateCameraTransform();
        // Ricentra così il punto sotto il cursore resta fermo durante lo zoom.
        const after = worldFromEvent(ev);
        camTarget.x -= (after.x - before.x);
        camTarget.z -= (after.z - before.z);
        updateCameraTransform();
    }, { passive: false });

    // Scrivere un numero sposta UN nodo, quello di arrivo: i nodi sono
    // posizioni assolute, non una catena relativa in cui una modifica trascina
    // tutto il resto. È la proprietà che serve per ricalcare un'immagine.
    // ESPLORARE UNA PISTA NON SALVATA e' il caso normale mentre la si disegna:
    // i dati passano da sessionStorage, non dal disco. La corsia box qui non
    // serve — l'anteprima non ci fa entrare nessuno — ma buildTrackData la
    // pretende, quindi se manca se ne mette una finta che non va da nessuna
    // parte e non viene mai salvata.
    const CHIAVE_ANTEPRIMA = 'f1AnteprimaPista';
    document.getElementById('esploraBtn').addEventListener('click', () => {
        if (mainPoints.length < 3) {
            alert('Disegna almeno tre nodi prima di esplorare.');
            return;
        }
        const dati = buildTrackData();
        if (!dati.pit.path || dati.pit.path.length < 3) {
            const p0 = mainPoints[0], p1 = mainPoints[1] || p0;
            dati.pit = dati.pit || {};
            dati.pit.roadHalfWidth = dati.pit.roadHalfWidth || 5;
            dati.pit.boxIndex = 0;
            dati.pit.path = [p0, p1, mainPoints[2] || p1].map(p => ({ x: p.x, z: p.z }));
            dati.pit.entryTrigger = { x: p0.x, z: p0.z, halfWidth: 5, halfLength: 5, angle: 0 };
        }
        try {
            sessionStorage.setItem(CHIAVE_ANTEPRIMA, JSON.stringify(dati));
        } catch (e) {
            alert("Non riesco a passare la pista all'anteprima: salvala e riprova.");
            return;
        }
        location.href = 'track-preview.html';
    });

    document.getElementById('triggerAutoBtn').addEventListener('click', posizionaTriggerAutomatico);
    document.getElementById('trackOpacity').addEventListener('input', rebuild);
    document.getElementById('abrasivita').addEventListener('input', aggiornaAbrasivita);
    document.getElementById('targetKm').addEventListener('change', () => { aggiornaAbrasivita(); aggiornaPannelloForma(); });
    document.getElementById('roadHalfWidth').addEventListener('change', () => { rebuild(); });

    document.getElementById('trattoLunghezza').addEventListener('change', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!(v > 0) || !inSegmenti() || trattoSelezionato < 0) return;
        salvaStato();
        geometria = TrackSegmenti.impostaLunghezza(geometria, trattoSelezionato, v);
        dopoModificaMain();
        rebuild();
        aggiornaRiquadroTratto();
    });

    document.getElementById('undoBtn').addEventListener('click', () => {
        if (inSegmenti() && !document.getElementById('pitMode').checked) { annulla(); return; }
        activeList().pop();
        rebuild();
    });
    document.getElementById('clearBtn').addEventListener('click', () => {
        if (document.getElementById('pitMode').checked) {
            pitPoints = [];
        } else if (inSegmenti()) {
            // Svuotare i nodi svuota anche i tratti: uno per nodo, sempre.
            // E dimentica la pista tenuta da parte per l'anteprima: senza,
            // la prossima apertura dell'editor la ritroverebbe: «svuota» deve
            // voler dire davvero ricominciare.
            try { sessionStorage.removeItem('f1AnteprimaPista'); } catch (e) { /* modalità privata */ }
            geometria = { versione: 1, nodi: [], tratti: [] };
            nodoSelezionato = -1;
            trattoSelezionato = -1;
            mainPoints = [];
        } else {
            mainPoints = [];
        }
        rebuild();
    });
    // Imposta l'angolo del traguardo esattamente al verso geometrico reale
    // (la freccia verde) — non tocca posizione/piste, solo l'orientamento.
    // No-op silenzioso se non c'è ancora un traguardo piazzato.
    document.getElementById('startFinishAlignBtn').addEventListener('click', () => {
        if (!startFinish) return;
        const geometricAngle = geometricStartFinishAngle();
        if (geometricAngle == null) return;
        startFinish.angle = geometricAngle;
        updateStartFinishMeshes();
    });
    ['roadHalfWidth', 'pitRoadHalfWidth', 'pitBoxIndex'].forEach(id => {
        document.getElementById(id).addEventListener('change', rebuild);
    });
    // 'input' (non 'change'): il riquadro si aggiorna mentre si digita, non
    // solo al blur — serve a vedere subito se copre la corsia box giusta.
    ['entryX', 'entryZ', 'entryHalfWidth', 'entryHalfLength', 'entryAngleDeg'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateEntryTriggerVisual);
    });
    document.addEventListener('keydown', (ev) => {
        // Mai rubare i tasti a chi sta scrivendo in un campo: R e C sono
        // lettere comunissime nei nomi delle piste.
        const dentroUnCampo = ev.target && /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName);
        if (dentroUnCampo) return;   // in un campo, Ctrl+Z e' l'annulla del testo

        if (ev.ctrlKey && (ev.key === 'z' || ev.key === 'Z') && !ev.shiftKey) {
            ev.preventDefault(); annulla(); return;
        }
        if (ev.ctrlKey && (ev.key === 'y' || ev.key === 'Y' || ((ev.key === 'z' || ev.key === 'Z') && ev.shiftKey))) {
            ev.preventDefault(); rifai(); return;
        }

        if (ev.key === 'u' || ev.key === 'U') {
            salvaStato();
            if (inSegmenti() && !document.getElementById('pitMode').checked) {
                geometria.nodi.pop();
                geometria.tratti.pop();
                nodoSelezionato = -1;
                trattoSelezionato = -1;
                dopoModificaMain();
            } else {
                activeList().pop();
            }
            rebuild();
        }
        if (ev.key === 'b' || ev.key === 'B') {
            const marker = pickMarker(lastMouseClient);
            if (marker && marker.userData.list === 'main') {
                salvaStato();
                const p = listaDi('main')[marker.userData.index];
                p.bridge = !p.bridge;
                dopoModificaMain();
                rebuild();
            }
        }
        // R: il tratto scelto diventa una retta, e i suoi due nodi prendono la
        // sua direzione. C: torna curva. Sono le due sole forme che esistono.
        if ((ev.key === 'r' || ev.key === 'R') && inSegmenti() && trattoSelezionato >= 0) {
            salvaStato();
            geometria = TrackSegmenti.raddrizza(geometria, trattoSelezionato);
            // Le direzioni imposte dalla retta sono una scelta, non un
            // ripiego: vanno protette dal riorientamento automatico, che
            // altrimenti le riporterebbe verso i vicini al primo spostamento.
            const n = geometria.nodi.length;
            geometria.nodi[trattoSelezionato].dirManuale = true;
            geometria.nodi[(trattoSelezionato + 1) % n].dirManuale = true;
            rigeneraDaGeometria();
            rebuild();
            aggiornaRiquadroTratto();
        }
        // I: spezza in due il tratto scelto, con un nodo nuovo a meta'. Senza,
        // un nodo si puo' solo aggiungere in coda e per correggere una curva a
        // meta' pista bisognerebbe rifare tutto da li' in avanti.
        if ((ev.key === 'i' || ev.key === 'I') && inSegmenti() && trattoSelezionato >= 0) {
            salvaStato();
            geometria = TrackSegmenti.inserisci(geometria, trattoSelezionato);
            nodoSelezionato = trattoSelezionato + 1;   // il nodo nuovo, gia' scelto
            rigeneraDaGeometria();
            rebuild();
            aggiornaRiquadroTratto();
        }
        if ((ev.key === 'c' || ev.key === 'C') && inSegmenti() && trattoSelezionato >= 0) {
            salvaStato();
            geometria.tratti[trattoSelezionato] = { tipo: 'curva' };
            rigeneraDaGeometria();
            rebuild();
            aggiornaRiquadroTratto();
        }
    });

    // ====================================================
    // CARICAMENTO (pista esistente nel gioco, o file .json locale)
    // ====================================================

    // Inquadra tutti i punti del tracciato caricato, altrimenti dopo
    // l'import ci si può ritrovare con la pista fuori dalla visuale fissa.
    function fitView() {
        if (mainPoints.length === 0) return;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        mainPoints.forEach(p => {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        });
        camTarget.x = (minX + maxX) / 2;
        camTarget.z = (minZ + maxZ) / 2;
        const halfSpanX = (maxX - minX) / 2 || 10;
        const halfSpanZ = (maxZ - minZ) / 2 || 10;
        const a = window.innerWidth / window.innerHeight;
        const neededHalfHeight = Math.max(halfSpanZ, halfSpanX / a) * 1.25;
        zoom = Math.min(Math.max(VIEW / neededHalfHeight, 0.2), 6);
        updateCameraTransform();
    }

    function applyTrackData(data) {
        if (!data || !Array.isArray(data.controlPoints) || data.controlPoints.length < 3) {
            alert('File pista non valido: mancano i punti di controllo (controlPoints)');
            return;
        }
        document.getElementById('trackId').value = data.id || '';
        document.getElementById('trackName').value = data.name || '';
        document.getElementById('targetKm').value = data.targetKm ?? 5;
        document.getElementById('roadHalfWidth').value = data.roadHalfWidth ?? 11;
        document.getElementById('abrasivita').value = data.abrasivita ?? 1;
        // Giorno o notte e' una proprieta' del circuito e sta nel suo file:
        // qualifica e gara la leggono dalla stessa fonte, quindi non possono
        // finire una di giorno e una di notte.
        document.getElementById('notturno').checked = data.notturno === true;
        const pit = data.pit || {};
        document.getElementById('pitRoadHalfWidth').value = pit.roadHalfWidth ?? 5;
        document.getElementById('pitBoxIndex').value = pit.boxIndex ?? 0;
        const et = pit.entryTrigger || {};
        document.getElementById('entryX').value = et.x ?? 0;
        document.getElementById('entryZ').value = et.z ?? 0;
        document.getElementById('entryHalfWidth').value = et.halfWidth ?? 5.5;
        document.getElementById('entryHalfLength').value = et.halfLength ?? 5.5;
        document.getElementById('entryAngleDeg').value = ((et.angle ?? 0) * 180 / Math.PI).toFixed(1);

        mainPoints = data.controlPoints.map(p => {
            const point = typeof p.y === 'number' ? { x: p.x, z: p.z, y: p.y } : { x: p.x, z: p.z };
            if (p.bridge) point.bridge = true;
            return point;
        });
        pitPoints = Array.isArray(pit.path) ? pit.path.map(p => ({ x: p.x, z: p.z })) : [];

        // Un file con `geometria` si apre in modalità segmenti; uno senza, in
        // modalità punti. Non c'è un terzo stato, e NON si converte niente: le
        // piste esistenti non hanno un'intenzione da cui rigenerarle, e
        // dedurla con un fitting sarebbe una supposizione — costosa proprio
        // sulle piste già validate.
        geometria = (data.geometria && Array.isArray(data.geometria.nodi)
                     && data.geometria.nodi.length >= 3) ? data.geometria : null;
        nodoSelezionato = -1;
        trattoSelezionato = -1;
        if (geometria) rigeneraDaGeometria();
        aggiornaRiquadroTratto();

        // Default: se la pista caricata non ha ancora startFinish (piste
        // esistenti pre-questa modifica), il marker appare alla posizione
        // del primo control point con angolo dedotto come oggi — nessuna
        // differenza visibile finché l'utente non lo trascina altrove.
        if (data.startFinish) {
            startFinish = { x: data.startFinish.x, z: data.startFinish.z, angle: data.startFinish.angle ?? 0 };
        } else if (mainPoints.length > 0) {
            const pts = TrackGeometry.sampleLoop(mainPoints, 500);
            const { tx, tz } = TrackGeometry.tangentAt(pts, 0, true);
            startFinish = { x: mainPoints[0].x, z: mainPoints[0].z, angle: Math.atan2(tx, tz) };
        } else {
            startFinish = null;
        }
        updateStartFinishMeshes();

        rebuild();
        fitView();
    }

    async function refreshTrackList() {
        try {
            const res = await fetch('/api/f1/tracks');
            const tracks = await res.json();
            const select = document.getElementById('loadTrackSelect');
            select.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '-- seleziona --';
            select.appendChild(placeholder);
            tracks.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${t.name} (${t.id})`;
                select.appendChild(opt);
            });
        } catch (err) {
            console.warn('Impossibile caricare elenco piste:', err.message);
        }
    }
    refreshTrackList();

    document.getElementById('loadTrackBtn').addEventListener('click', async () => {
        const id = document.getElementById('loadTrackSelect').value;
        if (!id) { alert('Seleziona una pista dal menu'); return; }
        try {
            const res = await fetch(`/tracks/${id}.json`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            applyTrackData(await res.json());
        } catch (err) {
            alert(`Errore caricamento pista: ${err.message}`);
        }
    });

    document.getElementById('deleteTrackBtn').addEventListener('click', async () => {
        const id = document.getElementById('loadTrackSelect').value;
        if (!id) { alert('Seleziona una pista dal menu'); return; }
        if (!confirm(`Eliminare definitivamente la pista "${id}"? L'operazione non è reversibile.`)) return;
        try {
            const res = await fetch(`/api/f1/tracks/${id}`, { method: 'DELETE' });
            const body = await res.json();
            if (!res.ok) { alert(`Errore eliminazione: ${body.error || res.status}`); return; }
            alert(`Pista "${id}" eliminata.`);
            refreshTrackList();
        } catch (err) {
            alert(`Errore di rete durante l'eliminazione: ${err.message}`);
        }
    });

    document.getElementById('importFile').addEventListener('change', (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                applyTrackData(JSON.parse(reader.result));
            } catch (err) {
                alert(`Errore lettura file: ${err.message}`);
            }
        };
        reader.readAsText(file);
        ev.target.value = ''; // permette di reimportare lo stesso file più volte
    });

    // ====================================================
    // EXPORT / SALVATAGGIO
    // ====================================================
    function validateBeforeSave() {
        if (mainPoints.length < 3) { alert('Servono almeno 3 punti per il tracciato principale'); return false; }
        if (pitPoints.length < 3) { alert('Servono almeno 3 punti per la corsia box (obbligatoria)'); return false; }
        if (!document.getElementById('trackId').value.trim()) { alert('Inserisci un id pista'); return false; }
        const pitBoxIndex = parseInt(document.getElementById('pitBoxIndex').value, 10) || 0;
        if (pitBoxIndex < 0 || pitBoxIndex >= pitPoints.length) { alert('pitBoxIndex non valido: deve essere un indice valido della corsia box'); return false; }

        const box = readEntryTriggerFields();
        if (!(box.halfWidth > 0) || !(box.halfLength > 0)) { alert('Riquadro trigger ingresso pit non valido: mezza larghezza/lunghezza devono essere positive'); return false; }
        // Stesso controllo del server (vedi trackLoader.validateTrackData):
        // il riquadro deve intercettare la corsia box vera, non un tratto
        // qualunque del tracciato principale (bug reale: valori di default
        // lasciati da un'altra pista).
        const hitsPath = pitPoints.some(p => TrackGeometry.pointInOrientedBox(p.x, p.z, box));
        if (!hitsPath) { alert('Il riquadro trigger (viola) non tocca nessun punto della corsia box: spostalo o allargalo prima di salvare'); return false; }
        return true;
    }

    function buildTrackData() {
        return {
            id: document.getElementById('trackId').value.trim(),
            name: document.getElementById('trackName').value.trim(),
            targetKm: parseFloat(document.getElementById('targetKm').value) || 1,
            roadHalfWidth: parseFloat(document.getElementById('roadHalfWidth').value) || 11,
            abrasivita: parseFloat(document.getElementById('abrasivita').value) || 1,
            notturno: document.getElementById('notturno').checked,
            startFinish: startFinish ? { x: startFinish.x, z: startFinish.z, angle: startFinish.angle } : undefined,
            // L'intenzione accanto al risultato: `geometria` è dell'editor,
            // `controlPoints` è del gioco e resta il suo prodotto cotto.
            geometria: geometria && geometria.nodi.length >= 3 ? geometria : undefined,
            controlPoints: mainPoints,
            pit: {
                roadHalfWidth: parseFloat(document.getElementById('pitRoadHalfWidth').value) || 5,
                boxIndex: parseInt(document.getElementById('pitBoxIndex').value, 10) || 0,
                entryTrigger: readEntryTriggerFields(),
                path: pitPoints
            }
        };
    }

    document.getElementById('exportBtn').addEventListener('click', () => {
        if (!validateBeforeSave()) return;
        const data = buildTrackData();
        const blob = new Blob([JSON.stringify(data, null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${data.id || 'pista'}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Salva direttamente in frontend/tracks/<id>.json lato server: la pista
    // compare subito nel menu della lobby, senza scaricare e spostare il
    // file a mano.
    document.getElementById('saveGameBtn').addEventListener('click', async () => {
        if (!validateBeforeSave()) return;
        const data = buildTrackData();
        try {
            const res = await fetch('/api/f1/tracks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const body = await res.json();
            if (!res.ok) { alert(`Errore salvataggio: ${body.error || res.status}`); return; }
            alert(`Pista "${data.id}" salvata: ora compare nel menu piste della lobby.`);
            refreshTrackList();
        } catch (err) {
            alert(`Errore di rete durante il salvataggio: ${err.message}`);
        }
    });

    // I TASTI DI CATEGORIA. Una finestra sola, che cambia contenuto: premi
    // «Box» e ci sono le opzioni della corsia box, premi «Via» e nello stesso
    // riquadro compare il traguardo. L'ultima categoria aperta si ricorda.
    function mostraPagina(nome) {
        for (const b of document.querySelectorAll('#tabs button')) {
            b.setAttribute('aria-selected', String(b.dataset.pagina === nome));
        }
        for (const s of document.querySelectorAll('.pagina')) {
            s.classList.toggle('attiva', s.dataset.pagina === nome);
        }
        try { localStorage.setItem('trackEditorPagina', nome); } catch (e) { /* modalità privata */ }
    }
    for (const b of document.querySelectorAll('#tabs button')) {
        b.addEventListener('click', () => mostraPagina(b.dataset.pagina));
    }
    try {
        const salvata = localStorage.getItem('trackEditorPagina');
        if (salvata && document.querySelector(`.pagina[data-pagina="${salvata}"]`)) mostraPagina(salvata);
    } catch (e) { /* si resta su Pista */ }

    // Cambiare modalità cambia su cosa si clicca: va detto subito, non al
    // primo click andato dove non ci si aspettava.
    document.getElementById('pitMode').addEventListener('change', () => {
        aggiornaRigaStato();
        if (document.getElementById('pitMode').checked) mostraPagina('box');
    });

    // TORNANDO DALL'ANTEPRIMA la pista deve essere ancora qui. Senza questa
    // rilettura, «Esplora» sarebbe un modo per perdere mezz'ora di disegno —
    // e il difetto si scoprirebbe solo dopo averla disegnata.
    try {
        const tornata = sessionStorage.getItem('f1AnteprimaPista');
        if (tornata) applyTrackData(JSON.parse(tornata));
    } catch (e) { /* modalità privata, o dati illeggibili: si riparte puliti */ }

    // Lo stato iniziale va MOSTRATO, non solo tenuto: `rebuild()` parte solo
    // agli eventi, quindi su una pagina appena aperta la riga dell'abrasività
    // restava muta e il riquadro del tratto non si sapeva se esistesse.
    aggiornaRiquadroTratto();
    aggiornaAbrasivita();
    aggiornaPannelloForma();
    aggiornaPannelloBox();
    aggiornaPannelloTraguardo();

    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }
    animate();
});
