document.addEventListener('DOMContentLoaded', async () => {
    // urlParams resta solo per gli interruttori di sviluppo (toon, aa, ratio,
    // ombre) che si leggono piu' sotto: chi sono e in che stanza sono stanno
    // nella sessione della scheda. Vedi shared/sessioneGiocatore.js.
    const urlParams = new URLSearchParams(window.location.search);
    const sessione = SessioneGiocatore.richiedi();
    if (!sessione) return;
    const lobbyId = sessione.lobbyId;
    const myColor = sessione.color;
    // Chieste al SERVER, non lette dall'indirizzo: e' lui a possederle, ed e'
    // sulla SUA copia che gira la partita. Vedi shared/impostazioniGara.js per
    // il perche' — in breve, client e server potevano credere a due piste
    // diverse, ed e' successo davvero.
    const clientSettings = await ImpostazioniGara.carica(lobbyId);
    const trackId = clientSettings.trackId || 'monte-rosso';
    // Numero di piloti della gara: scelto in lobby, viaggia nell'indirizzo e
    // arriva qui PRIMA che si generi la scenografia. È ciò che permette di
    // costruire il fronte della corsia box per il numero reale invece che per
    // il caso peggiore — vedi la spec 2026-08-17-f1-piloti-configurabili.
    const gridSize = Math.min(20, Math.max(1, parseInt(clientSettings.gridSize, 10) || 6));
    // Gara veloce o campionato. Si sa GIA' QUI, dalle impostazioni della
    // lobby, e non solo da f1Setup che arriva col socket: serve prima di
    // scrivere qualunque cosa sulla schermata di caricamento.
    const formatoPartita = clientSettings.formato === 'stagione' ? 'stagione' : 'veloce';
    // "Sono davanti alle SCHERMATE del campionato", che non e' la stessa cosa
    // di "questa partita appartiene a un campionato": una gara di stagione ha
    // il formato 'stagione' ma e' un weekend in tutto e per tutto — pista da
    // annunciare, sonoro acceso, comandi vivi. Distinzione tenuta in un posto
    // solo, perche' sbagliarla in due punti diversi ha gia' prodotto due
    // difetti (il calendario davanti alla pista, e il mondo muto in gara).
    const schermataCampionato = formatoPartita === 'stagione' && clientSettings.stagioneInCorso !== true;
    // ...e il suo opposto: una GARA di campionato. Si sa fin dall'avvio, dalle
    // impostazioni, e non si aspetta nessun evento — il podio configura la
    // propria uscita prima che il server possa dire com'e' andata.
    const garaDiCampionato = formatoPartita === 'stagione' && clientSettings.stagioneInCorso === true;

    // Il file del circuito si legge QUI, prima di ogni altra cosa, e non
    // più giù insieme alla costruzione della pista: dentro c'è scritto se
    // questo circuito si corre in notturno, e cielo, nebbia e luci nascono
    // una volta sola — leggerlo dopo vorrebbe dire costruirli di giorno e
    // poi rifarli.
    const trackRes = await fetch(`/tracks/${trackId}.json`);
    const trackData = await trackRes.json();

    // Giorno o notte è una proprietà del CIRCUITO, non della partita:
    // qualifica e gara dello stesso circuito sono sempre tutte e due
    // uguali, per costruzione, perché la fonte è una sola.
    // Giorno o notte lo decide il circuito, e basta. E' vissuto qui per
    // qualche ora un `?notte=on` per il confronto rapido: tolto su richiesta
    // dell'utente, che non vuole impostazioni nell'indirizzo - la stessa
    // ragione per cui ci sono usciti prima le impostazioni di gara e poi il
    // colore del giocatore. Per il confronto si usa la spunta nell'editor.
    const NOTTURNO = trackData.notturno === true;
    ToonPalette.impostaOrario(NOTTURNO ? 'notte' : 'giorno');
    document.body.classList.toggle('notturno', NOTTURNO);

    if (!lobbyId || !myColor) {
        window.location.href = '/';
        return;
    }

    // ====================================================
    // SCHERMATA DI CARICAMENTO — il pannello è già a schermo (è HTML statico
    // in f1.html, vedi lì il perché); qui lo si aggiorna e alla fine lo si
    // spegne. Da qui in giù non deve esserci nessun tratto di esecuzione
    // lungo senza un passoCaricamento: un avanzamento fermo si legge come un
    // blocco anche quando il lavoro procede.
    // ====================================================
    const caricamento = (() => {
        const box = document.getElementById('f1-loading');
        const barra = document.getElementById('f1-loading-fill');
        const riga = document.getElementById('f1-loading-step');
        const titolo = document.getElementById('f1-loading-track');
        let spento = false;
        return {
            pista(nome) { if (titolo && nome) titolo.textContent = nome; },
            passo(testo, frazione) {
                if (riga) riga.textContent = testo;
                if (barra && frazione != null) {
                    barra.style.transform = `scaleX(${Math.max(0, Math.min(1, frazione))})`;
                }
            },
            // Cede il thread per un frame. Senza, il testo appena scritto non
            // verrebbe mai dipinto: la funzione prosegue dentro lo stesso
            // frame e il browser non ha occasione di disegnare nulla finché
            // la costruzione della pista non è finita.
            respira() {
                return new Promise(r => {
                    let fatto = false;
                    const prosegui = () => { if (!fatto) { fatto = true; r(); } };
                    requestAnimationFrame(prosegui);
                    // In una scheda in SECONDO PIANO requestAnimationFrame non
                    // scatta affatto: senza questa scorciatoia l'avvio si
                    // fermerebbe qui fino al ritorno in primo piano — cioè
                    // proprio nel caso delle due schede, dove la seconda
                    // carica mentre si guarda la prima. setTimeout viene
                    // rallentato in background, ma scatta.
                    setTimeout(prosegui, 60);
                });
            },
            spegni() {
                if (spento || !box) return;
                spento = true;
                box.classList.add('is-done');
                setTimeout(() => box.remove(), 400);
            },
        };
    })();

    // Segnali attesi prima di scoprire il gioco (vedi in fondo al file): la
    // scenografia completa, la propria auto in scena e almeno un frame
    // disegnato. Dichiarati qui perché chi li risolve sta sparso più sotto.
    let segnalaAutoPronta, segnalaPrimoFrame;
    const autoPronta = new Promise(r => { segnalaAutoPronta = r; });
    const primoFrame = new Promise(r => { segnalaPrimoFrame = r; });

    caricamento.passo('Collegamento all\'account…', 0.04);

    // --- INIZIO GESTIONE FIREBASE E LIVREA ---
    let loadedLivery = null;

    // 1. Aspettiamo (in modo asincrono) che Firebase inizializzi l'auth e ci dica se siamo loggati
    const user = await new Promise((resolve) => {
        const unsubscribe = firebase.auth().onAuthStateChanged((u) => {
            unsubscribe(); // Ci basta saperlo una volta all'avvio
            resolve(u);
        });
    });

    // 2. Se siamo loggati, proviamo a prendere la nostra livrea dal database
    if (user) {
        console.log("[F1] Utente loggato in gara:", user.uid);
        try {
            const res = await fetch(`/api/livery/${user.uid}`);
            if (res.ok) {
                loadedLivery = await res.json();
                console.log("[F1] Livrea personale caricata con successo!");
            } else {
                console.warn("[F1] Livrea non trovata nel database.");
            }
        } catch (e) {
            console.error("[F1] Errore durante il fetch della livrea:", e);
        }
    } else {
        console.log("[F1] Giocatore ospite, nessuna livrea da caricare.");
    }

    // 3. NESSUN fallback a una fixture JSON condivisa: se non c'è una livrea
    // salvata (ospite, o account senza livrea) loadedLivery resta null e
    // CarLoader.loadCarModel colora la carrozzeria col colore scelto in
    // lobby (myColor) — stesso comportamento di bot e altri ospiti, e stesso
    // comportamento del gioco prima delle livree custom. Usare una fixture
    // fissa qui produceva la stessa identica livrea rossa per chiunque non
    // avesse un account con livrea salvata (bug reale osservato in
    // localhost: bot e guest tutti con la stessa livrea).
    const TEST_LIVERY_COLORS = loadedLivery;
    // --- FINE GESTIONE LIVREA ---

    const socket = io({ transports: ['websocket'], upgrade: false });

    // Riconnessione
    socket.io.on('reconnect', () => {
        socket.emit('joinLobby', { lobbyId, color: myColor, token: sessione.token });
        socket.emit('joinF1Game', { lobbyId, playerColor: myColor, uid: user ? user.uid : null });
    });

    // ====================================================
    // THREE.JS SETUP
    // ====================================================
    const scene = new THREE.Scene();
    // Cielo a gradiente e nebbia (Rif. spec 2026-08-10-f1-art-direction-cel-shading).
    // Il colore della nebbia non è più scelto a mano ma DERIVATO dal gradiente
    // del cielo alla quota dell'orizzonte (ToonPalette.fogColor): con due
    // tinte indipendenti la linea di stacco fra prato e cielo resta leggibile
    // e la mappa sembra finita — segnalato dall'utente il 2026-08-09.
    // Densità 0.0016 e non 0.0022: a 0.0022 la nebbia era già al 99% a 1000
    // unità, cioè le colline dell'orizzonte (SceneryHills) sarebbero sparite
    // prima di vedersi (camera.far è 1200).
    //
    // `?toon=off` nell'indirizzo riporta il gioco ESATTAMENTE a com'era prima
    // del cel shading — cielo piatto, materiali standard, ombre morbide, luci
    // vecchie — tenendo però il pannello e il suo contatore. Serve per il
    // confronto A/B: senza, "questo problema c'era anche prima?" resta una
    // domanda senza risposta.
    const TOON_ON = urlParams.get('toon') !== 'off';
    const toonSky = TOON_ON ? ToonSky.install(scene) : ToonSky.installFlat(scene);
    // Il notturno e' una uniform condivisa da tutti i materiali toon: si
    // accende una volta e vale per la pista generata in JS come per i
    // modelli che arrivano dai GLB. Vedi ToonStyle.impostaNotturno.
    if (TOON_ON) ToonStyle.impostaNotturno(NOTTURNO);
    if (TOON_ON) toonSky.setStelle(NOTTURNO);

    // Unico punto da cui passa la conversione dei materiali: con il look
    // spento non tocca nulla.
    function applicaStile(oggetto, opts) {
        if (TOON_ON) ToonStyle.convert(oggetto, opts);
        return oggetto;
    }

    // 65° è il campo visivo con cui è tarato tutto il resto del gioco (le
    // inquadrature della griglia, la vetrina dell'auto in pole, l'halo-cam):
    // resta il valore di partenza, ma in gara non è più fisso — si apre con la
    // velocità, vedi aggiornaCampoVisivo() e shared/f1SensoVelocita.js.
    const camera = new THREE.PerspectiveCamera(F1SensoVelocita.FOV_BASE, window.innerWidth / window.innerHeight, 0.1, 1200);

    // Misure del frame condivise col pannello F9. `logica` la riempie
    // animate(), il resto lo legge il pannello da renderer e camera.
    const F1Perf = { logica: 0 };

    // ANTIALIAS: `?aa=off` lo spegne. Non è un capriccio da menu, è una
    // misura: con antialias il canvas è multisample e ogni pixel coperto
    // costa più campioni, ed è il tipo di costo che su questo gioco domina
    // il frame (vedi PIXEL_RATIO qui sotto). Va giudicato guardando il
    // gioco, perché il tratto nero dei contorni maschera buona parte della
    // scalettatura che l'antialias serve a togliere.
    const renderer = new THREE.WebGLRenderer({ antialias: urlParams.get('aa') !== 'off' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // PIXEL RATIO — misurato in gioco il 2026-08-16, ed è la leva più
    // efficace che abbia questo gioco:
    //
    //   1920x868 (ratio 1.25) -> 47 fps, disegno 9.8 ms
    //   1536x695 (ratio 1.00) -> 58 fps, disegno 7.4 ms
    //
    // Il 36% di pixel in meno vale 11 fps, mentre 3 ms di CPU risparmiati
    // altrove (ombra da 4096 a 1024) non ne valgono nemmeno uno: il frame lo
    // decide la GPU, e la GPU la decidono i pixel. Con lo scaling di Windows
    // al 125% il browser dichiara 1.25 e si finiva a renderizzare un quarto
    // di pixel in più di quelli della finestra, per poi rimpicciolirli.
    //
    // 1 è il valore predefinito; `?ratio=1.5` (o qualunque numero) lo alza
    // per chi ha GPU da spendere, e l'interruttore «risoluzione piena» del
    // pannello F9 fa il confronto a caldo.
    const ratioChiesto = parseFloat(urlParams.get('ratio'));
    renderer.setPixelRatio(Number.isFinite(ratioChiesto) && ratioChiesto > 0
        ? Math.min(ratioChiesto, 2)
        : 1);
    // `?ombre=off` toglie le ombre dinamiche. Non è un'opzione di qualità: è
    // la MISURA che dice se conviene cuocere le ombre della scenografia in una
    // texture. Spegnere la mappa non basta a rispondere — quella costa CPU, e
    // abbiamo visto che la CPU qui ha margine — perché il costo vero è nello
    // shader di OGNI superficie, che per ogni pixel campiona la mappa per
    // sapere se è in ombra. Solo togliendo `shadowMap.enabled` quel codice
    // sparisce dai materiali, ed è per questo che va fatto al caricamento:
    // cambia i define e li fa ricompilare tutti.
    renderer.shadowMap.enabled = urlParams.get('ombre') !== 'off';
    // Ombra NETTA ma non scalettata: PCF semplice con raggio 1 dà un bordo
    // stretto. PCFSoftShadowMap lo sfuma troppo per un look cel-shaded,
    // BasicShadowMap lo rende netto ma a scaletta (si vedrebbe la griglia dei
    // texel della mappa). Con `?toon=off` torna quella di prima.
    renderer.shadowMap.type = (urlParams.get('toon') !== 'off')
        ? THREE.PCFShadowMap
        : THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    document.body.appendChild(renderer.domElement);

    // Contorni neri: aggiungono un passaggio di rendering, quindi restano
    // fuori quando il look è disattivato con ?toon=off.
    if (urlParams.get('toon') !== 'off') ToonOutline.init(renderer, camera);

    // ====================================================
    // LUCI
    // ====================================================
    // Luci tarate per il cel shading (Rif. spec 2026-08-10-f1-art-direction-cel-shading).
    //
    // LA SOMMA DELLE DUE INTENSITÀ DEVE RESTARE INTORNO A 1: solo l'apporto
    // del sole passa per la quantizzazione a fasce, quello dell'emisferica è
    // costante. Se la somma supera 1, le fasce finiscono tutte oltre il tetto
    // della scala e si schiacciano l'una sull'altra — misurato al playtest del
    // 2026-08-10 con 0.95+1.15: su un colore chiaro le tre fasce davano
    // 0.972/0.979/0.982 a schermo, cioè un punto percentuale di stacco, e la
    // livrea appariva piatta. Con 0.30+0.72 lo stacco sale a 18 punti.
    //
    // È anche il rapporto fra le due a decidere il contrasto: più sole e meno
    // ambiente = fasce marcate; il contrario = look slavato.
    // I due colori e le due intensità arrivano dall'orario del circuito
    // (ToonPalette.ORARI): di notte cambiano le TINTE, non le intensità —
    // il perché sta scritto lì, in breve è che le fasce del cel shading
    // sono agganciate a una somma di luce che deve restare intorno a 1.
    const _luci = ToonPalette.orario();
    const hemi = TOON_ON
        ? new THREE.HemisphereLight(_luci.hemi.cielo, _luci.hemi.terra, _luci.hemi.intensita)
        : new THREE.HemisphereLight(0xb0d8f5, 0x2d7a2d, 0.7);   // com'era prima del cel shading
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(TOON_ON ? _luci.sole.colore : 0xfff4e0, TOON_ON ? _luci.sole.intensita : 1.3);
    sun.position.set(150, 200, 50);
    sun.target.position.set(50, 0, 100);  // punta al centro del circuito
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.radius = 1;                // bordo stretto, vedi shadowMap.type sopra
    // 2048 e non 4096. Misurato in gioco il 2026-08-17 su "prova" con dieci
    // piloti: 30 fps con le ombre accese, 121 premendo O per spegnerle —
    // ventacinque millisecondi di frame in una mappa sola.
    //
    // 4096 sono 16.8 milioni di pixel da riempire ogni frame, SEDICI VOLTE i
    // pixel dello schermo (misurato: 1536x695, cioè poco più di un milione).
    // Con il riquadro ristretto qui sotto la finezza dell'ombra resta la
    // stessa di prima — 4.7 pixel per unità di mondo contro 6.8 — a un quarto
    // del costo di riempimento.
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 520;
    // ±220 e non più ±300: da quando il riquadro SEGUE l'auto non deve più
    // coprire mezzo circuito sperando di intercettarlo, gli basta la zona
    // attorno a chi guida. Meno area vuol dire due cose insieme: meno oggetti
    // da ridisegnare nella mappa, e più pixel di mappa per ogni unità di
    // mondo. La nebbia copre comunque ciò che sta oltre.
    const OMBRA_SEMILATO = 220;
    sun.shadow.camera.left = -OMBRA_SEMILATO;
    sun.shadow.camera.right = OMBRA_SEMILATO;
    sun.shadow.camera.top = OMBRA_SEMILATO;
    sun.shadow.camera.bottom = -OMBRA_SEMILATO;
    sun.shadow.bias = -0.0005;
    // I triangoli che si muovevano sulle barriere (playtest 2026-08-18).
    //
    // Non è un difetto del notturno in sé, è l'inclinazione della luce: a
    // 78 gradi una barriera VERTICALE sta quasi a 90 gradi dalla luce, e
    // una superficie in quella posizione occupa moltissima profondità
    // dentro un solo texel della mappa d'ombra. Il confronto di profondità
    // cade allora ora da una parte ora dall'altra, e disegna il motivo a
    // scaglie che l'occhio legge come triangoli — e che nuota, perché il
    // riquadro si sposta con l'auto.
    //
    // `bias` da solo non basta: è uno scostamento costante in profondità,
    // e il problema qui cresce con l'inclinazione. `normalBias` sposta il
    // punto campionato lungo la NORMALE della superficie, quindi corregge
    // tanto quanto la superficie è di taglio: è lo strumento giusto.
    // 0.4 unità di mondo su texel da 0.215: sposta di due texel scarsi,
    // abbastanza da uscire dal proprio errore e poco da staccare l'ombra
    // dagli oggetti.
    sun.shadow.normalBias = 0.4;
    scene.add(sun);

    // ── La mappa delle ombre segue l'auto ──
    //
    // Prima il riquadro delle ombre stava fermo attorno a (50, 100), un punto
    // scritto nel codice. Misurato, quanta pista ci cadeva dentro:
    // monte-rosso 100%, new-monza 49%, prova **0%** — su prova non c'era una
    // sola ombra dinamica, ed è la ragione per cui le altre piste sembravano
    // averle molto più marcate.
    //
    // Il sole non cambia direzione, si sposta soltanto: l'inclinazione delle
    // ombre resta identica ovunque, cambia solo dove il riquadro è puntato.
    // Di notte la luce arriva da molto più in alto: vedi `elevazione` nel
    // blocco ORARI di toonPalette.js. Si applica QUI, prima che _dirSole
    // venga calcolata dalla posizione, così tutto il resto non cambia.
    // L'azimut di partenza resta quello del giorno; da lì in poi lo
    // comanda il faro più vicino (vedi direzioneDaiFari).
    if (_luci.sole.elevazione != null) {
        const _d = new THREE.Vector3().subVectors(sun.position, sun.target.position);
        const _oriz = Math.hypot(_d.x, _d.z) || 1;
        const _e = _luci.sole.elevazione * Math.PI / 180;
        const _lung = _d.length();
        sun.position.set(
            sun.target.position.x + (_d.x / _oriz) * Math.cos(_e) * _lung,
            sun.target.position.y + Math.sin(_e) * _lung,
            sun.target.position.z + (_d.z / _oriz) * Math.cos(_e) * _lung);
    }

    const _dirSole = new THREE.Vector3().subVectors(sun.target.position, sun.position);
    const DISTANZA_SOLE = _dirSole.length();
    _dirSole.normalize();
    // Il riquadro guarda un po' più avanti del muso: è la parte di circuito
    // che il giocatore ha davanti, e a spendercela si guadagna dove serve.
    const ANTICIPO_OMBRA = 120;
    const _avanti = new THREE.Vector3();

    // Posizioni in coordinate mondo dei pannelli lampade delle torri faro.
    // Le riempie accendiTorreFaro mentre la scenografia si carica; di
    // giorno resta vuoto. Su `prova` sono 21, una ogni ~246 unità.
    const fariNotturni = [];

    const _elevNotte = (_luci.sole.elevazione || 78) * Math.PI / 180;
    let _oriFaroX = 0, _oriFaroZ = 0;

    // La DIREZIONE della luce viene dai fari; l'INTENSITÀ no, resta uniforme
    // su tutto il circuito (richiesta esplicita dell'utente: «la luce non
    // arriva veramente dai fari, i fari sono accesi solo per estetica»).
    //
    // È così che si ottiene «le ombre sulle macchine che cambiano» senza
    // aggiungere una sola luce: guidando, ogni ~245 unità l'azimut ruota e
    // l'ombra gira attorno all'auto.
    //
    // Peso 1/d⁴ e non 1/d²: con ventuno fari e un peso che cala piano, si
    // mediano tutti fra loro e la direzione non si muove più. Alla quarta
    // potenza comanda quello vicino e gli altri fanno solo da raccordo.
    // Costante di tempo dello smorzamento, in secondi. Senza, l'ombra SALTA:
    // misurato con una sonda headless su un giro di "prova" a 60 fps, lo
    // scatto peggiore era 23° in un frame, cioè 1380°/s — l'ombra che si
    // ribalta dall'altra parte dell'auto in un lampo. La causa è geometria e
    // non si aggira cambiando formula: la direzione orizzontale da una torre
    // all'auto si INVERTE nell'istante in cui la si supera, ed è proprio lì
    // che quella torre pesa più di tutte.
    //
    // Con 0.32 s lo scatto peggiore scende a 1.1° per frame (69°/s, una
    // spazzata leggibile) e si conserva l'81% del movimento totale: 905° di
    // rotazione sul giro contro i 1121 senza smorzamento. Sotto, verso 0.8 s,
    // il movimento si perde per strada (600°, il 46% in meno) e l'ombra
    // diventa pigra.
    //
    // Anche un'ombra vera ci mette un momento a girare, quindi non è solo una
    // pezza: è il comportamento giusto.
    const TAU_DIREZIONE = 0.32;
    const _bersaglioSole = new THREE.Vector3();
    let _istanteDirezione = 0;
    let _direzioneAvviata = false;

    function direzioneDaiFari(x, z) {
        if (fariNotturni.length === 0) return false;
        _oriFaroX = 0; _oriFaroZ = 0;
        for (const f of fariNotturni) {
            const dx = x - f.x, dz = z - f.z;
            const d = Math.max(Math.hypot(dx, dz), 0.001);
            // 1/d² e non 1/d⁴: alla quarta la torre vicina schiaccia tutte le
            // altre e il bersaglio si muove a strappi fra un faro e il
            // successivo. Al quadrato le vicine si contendono la direzione e
            // il passaggio è graduale. Misurate entrambe: dopo lo smorzamento
            // danno lo stesso movimento totale, ma al quadrato il bersaglio
            // parte già più docile (su monte-rosso 4.6° di scatto grezzo
            // contro 12.8°).
            const peso = 1 / (d * d);
            _oriFaroX += (dx / d) * peso;
            _oriFaroZ += (dz / d) * peso;
        }
        const lung = Math.hypot(_oriFaroX, _oriFaroZ);
        // Fari opposti che si annullano: si tiene la direzione di prima.
        if (!(lung > 1e-12)) return false;

        const co = Math.cos(_elevNotte), si = Math.sin(_elevNotte);
        _bersaglioSole.set((_oriFaroX / lung) * co, -si, (_oriFaroZ / lung) * co);

        if (!_direzioneAvviata) {
            _dirSole.copy(_bersaglioSole);
            _direzioneAvviata = true;
            _istanteDirezione = performance.now();
            return true;
        }

        const ora = performance.now();
        // Il tetto sul passo serve al rientro da una scheda lasciata in
        // secondo piano: là il tempo passa e i frame no, e senza tetto
        // l'ombra si ritroverebbe di colpo dall'altra parte.
        const dt = Math.min((ora - _istanteDirezione) / 1000, 0.25);
        _istanteDirezione = ora;
        // Smorzamento legato al TEMPO e non al frame: a 30 fps l'ombra deve
        // girare alla stessa velocità che a 60.
        _dirSole.lerp(_bersaglioSole, 1 - Math.exp(-dt / TAU_DIREZIONE)).normalize();
        return true;
    }

    function puntaOmbre(x, z) {
        if (NOTTURNO) direzioneDaiFari(x, z);
        // Il centro si arrotonda al passo dei texel della mappa. Senza,
        // muovendo il riquadro le ombre "nuotano": i bordi si ricampionano su
        // texel diversi ad ogni frame e sfarfallano. Arrotondando, il
        // campionamento resta agganciato alla stessa griglia mentre l'auto si
        // sposta. Il sole è quasi a picco, quindi la griglia del mondo in XZ
        // approssima bene quella della mappa.
        const passo = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
        const cx = Math.round(x / passo) * passo;
        const cz = Math.round(z / passo) * passo;
        sun.target.position.set(cx, 0, cz);
        sun.position.set(cx - _dirSole.x * DISTANZA_SOLE,
                         -_dirSole.y * DISTANZA_SOLE,
                         cz - _dirSole.z * DISTANZA_SOLE);
    }

    // ====================================================
    // COSTRUZIONE PISTA 3D — dati caricati dal JSON della pista scelta
    // (vedi frontend/tracks/), stessa geometria usata dal server tramite
    // backend/sockets/games/trackLoader.js.
    // ====================================================
    caricamento.passo('Dati del circuito…', 0.12);
    // trackData è già stato letto in cima (serviva a sapere se si corre in
    // notturno prima di accendere le luci): qui non si rilegge.
    //
    // In CAMPIONATO il nome del circuito non si scrive: la pista caricata qui
    // non è quella che si correrà — serve solo a far nascere la partita,
    // mentre il calendario lo sorteggia la stagione. Annunciarla sarebbe una
    // bugia, ed è stata segnalata come tale al playtest ("dice caricamento del
    // circuito, e cita Monte Rosso"). Il nome vero comparirà quando una gara
    // del calendario partirà davvero.
    caricamento.pista(schermataCampionato ? 'Campionato' : (trackData.name || trackId));
    // Il nome del circuito è il titolo della schermata mescole: è la cosa che
    // il giocatore vuole sapere per prima ("dove corro?"), e l'anteprima di
    // fianco è la risposta lunga alla stessa domanda.
    const titoloPista = document.getElementById('tyre-track-name');
    if (titoloPista) titoloPista.textContent = trackData.name || trackId;

    const ROAD_HALF = trackData.roadHalfWidth;
    const CURB_W = 2.8;
    const BARRIER_D = ROAD_HALF + CURB_W + 1.2;
    // Il terrapieno deve iniziare esattamente dal bordo esterno del cordolo
    // (non da BARRIER_D, che è 1.2 unità più in là, dove sta la barriera):
    // altrimenti resta scoperta una fascia sottile tra cordolo e barriera —
    // prima invisibile perché il prato piatto infinito copriva tutto, ora
    // che il prato parte dal terrapieno si vedrebbe il cielo di sfondo.
    const EMBANKMENT_START = ROAD_HALF + CURB_W;
    // Ampiezza del terrapieno oltre EMBANKMENT_START, entro cui la quota del
    // terreno sfuma dalla quota pista a 0 (prato in piano) — valore di
    // partenza, da tarare a vista (pendenza troppo ripida/dolce si aggiusta
    // solo qui, non in TrackGeometry.terrainHeightAt/TrackMeshBuilder).
    const EMBANKMENT_WIDTH = 45;

    const N_SAMPLES = 1000;
    const trackPts = TrackGeometry.sampleLoop(trackData.controlPoints, N_SAMPLES);
    // Aggancia il primo/ultimo punto della corsia box al bordo pista vero
    // (Rif. richiesta utente 2026-08-08) — stessa funzione usata dal
    // server (trackLoader.js::buildTrack) sugli stessi punti di controllo
    // grezzi, quindi il disegno qui corrisponde ESATTAMENTE alla posizione
    // fisica reale dell'auto in uscita dai box.
    const PIT_PATH = TrackGeometry.snapPitPathEnds(trackData.pit.path, trackPts, ROAD_HALF);

    // ====================================================
    // MINIMAPPA — contorno pista + corsia box in SVG, generati una tantum
    // proiettando trackPts/PIT_PTS (x,z) sul piano. Nessuna finezza di
    // parametrizzazione per arco: i vertici campionati sono già lisci a
    // queste dimensioni. Trasformazione (scala/offset) calcolata UNA VOLTA
    // sull'ingombro di entrambi i tracciati insieme, non solo della pista
    // principale: altrimenti la corsia box, se sporge anche di poco dal
    // riquadro della pista, finirebbe tagliata fuori dai margini.
    // ====================================================
    function minimapTransform(allPts) {
        const xs = allPts.map(p => p.x), zs = allPts.map(p => p.z);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minZ = Math.min(...zs), maxZ = Math.max(...zs);
        const w = maxX - minX, h = maxZ - minZ;
        const VB_W = 200, VB_H = 140, MARGIN = 16;
        const scale = Math.min((VB_W - MARGIN * 2) / w, (VB_H - MARGIN * 2) / h);
        const offX = MARGIN + (VB_W - MARGIN * 2 - w * scale) / 2 - minX * scale;
        const offZ = MARGIN + (VB_H - MARGIN * 2 - h * scale) / 2 - minZ * scale;
        return { scale, offX, offZ };
    }

    // `closed`: true per un anello (pista, si richiude su se stessa con Z),
    // false per un percorso aperto (corsia box, che non è un loop).
    function minimapPathString(pts, transform, closed) {
        const toSvg = (p) => `${(p.x * transform.scale + transform.offX).toFixed(1)},${(p.z * transform.scale + transform.offZ).toFixed(1)}`;
        return `M ${toSvg(pts[0])} ` + pts.slice(1).map(p => `L ${toSvg(p)}`).join(' ') + (closed ? ' Z' : '');
    }

    // ====================================================
    // TERRENO ERBOSO — prato con un "buco" a forma di tracciato (esterno) +
    // pezzo pieno per l'infield, riempiti dal terrapieno che sfuma dalla
    // quota pista a 0 man mano che ci si allontana: niente più piano piatto
    // fisso che potesse tagliare la pista nelle discese sotto quota 0 (vedi
    // design 2026-07-22-f1-terrapieno-e-ponti).
    // ====================================================
    // Le mesh del prato (e delle colline, che condividono la stessa griglia)
    // servono più sotto per marcarle come terreno nel motore di stile:
    // buildGround non le restituisce, quindi si prendono per differenza.
    // Identificarle dal colore sarebbe fragile — il colore del prato cambia
    // con la palette e il confronto smetterebbe di trovarle senza che nulla
    // lo segnali.
    // Stessi punti campionati (e "abbracciati" alla curva pista vicino agli
    // estremi, TrackGeometry.tuckPitEndsToTrack) usati internamente da
    // TrackMeshBuilder.buildPitLane (che li ricalcola per conto suo): un
    // secondo ricalcolo qui è economico (300 campioni, una tantum al
    // caricamento) e serve per generare la scenografia/il varco barriera
    // senza toccare la firma di buildPitLane. Stessa funzione pura con gli
    // stessi input di buildPitLane → stesso risultato, nessun rischio di
    // divergenza tra corsia box disegnata e varco/scenografia.
    const PIT_PTS = TrackGeometry.tuckPitEndsToTrack(TrackGeometry.sampleOpenPath(PIT_PATH, 300), trackPts);

    // Dove sta il bordo del circuito: barriera e vie di fuga, calcolate UNA
    // volta qui e riusate per la banda di ghiaia disegnata, per la posizione
    // delle barriere e per traslare la scenografia. Il server ne calcola uno
    // identico con la stessa funzione (trackLoader.js) per il muro fisico —
    // stessi input, stesso risultato, nessun rischio di divergenza.
    //
    // ⚠️ Va calcolato PRIMA di costruire il terreno: il pianoro del terrapieno
    // deve arrivare fino alla barriera, e la barriera la decide questo profilo.
    //
    // `BARRIER_PROFILE.gravel` è la ghiaia GIÀ RIFILATA sul muro: è quella da
    // disegnare, non il risultato grezzo di gravelProfile, altrimenti dove il
    // muro si abbassa (imbocchi dei ponti) la banda gli sbucherebbe da sotto.
    const BARRIER_PROFILE = TrackGravel.barrierProfile(trackPts, {
        roadHalf: ROAD_HALF,
        curbW: CURB_W,
        pitLanePts: PIT_PTS,
        pitRoadHalf: trackData.pit.roadHalfWidth,
    });

    // Fin dove il terreno resta alla quota della pista, e dove ha finito di
    // degradare al prato in piano. Il pianoro arriva alla barriera più lontana
    // del giro: con la via di fuga la barriera sta ben oltre il vecchio
    // EMBANKMENT_START, e lasciandolo com'era nelle zone sopraelevate il muro
    // restava sospeso sul pendio e le tribune si piantavano più in basso della
    // pista. La stessa distanza la ricava da sé TrackScenery.generateLayout
    // dal profilo, quindi terreno disegnato e oggetti piazzati concordano.
    const EMBANK_PLATEAU = TrackScenery.embankmentStart(BARRIER_PROFILE, EMBANKMENT_START);
    const EMBANK_OUTER = EMBANK_PLATEAU + EMBANKMENT_WIDTH;

    // I `respira()` sparsi fra un blocco di costruzione e l'altro non sono
    // decorativi: queste chiamate bloccano il thread per centinaia di ms
    // ciascuna, e senza cedere il controllo la barra resterebbe ferma
    // dall'inizio alla fine della costruzione.
    caricamento.passo('Terreno e dislivelli…', 0.20);
    await caricamento.respira();

    const primaDelPrato = scene.children.length;
    TrackMeshBuilder.buildGround(scene, trackPts, EMBANK_OUTER, 3000);
    const mesheTerreno = scene.children.slice(primaDelPrato);
    // Tre distanze: attacco alla pista, fine del pianoro, fine della rampa.
    // EMBANKMENT_START resta l'attacco (bordo del cordolo), com'è sempre
    // stato: è il pianoro che è nuovo.
    TrackMeshBuilder.buildEmbankment(scene, trackPts, EMBANKMENT_START, EMBANK_PLATEAU, EMBANK_OUTER);
    // Punti "a terra" (non-ponte): usati sia per i piloni (quota reale sotto
    // un ponte) sia per la quota visiva dell'auto fuori pista più sotto —
    // calcolato una sola volta qui, non ad ogni frame.
    const groundPts = trackPts.filter(p => !p.bridge);
    // Ultimo argomento: la barriera VERA del tratto che passa sotto il
    // viadotto. Senza, i piloni si tenevano alla larga da una distanza
    // costante che le vie di fuga hanno reso obsoleta, e su "prova" quattro
    // finivano dentro la carreggiata (vedi buildBridgeDecks).
    TrackMeshBuilder.buildBridgeDecks(scene, trackPts, groundPts, ROAD_HALF + CURB_W, EMBANKMENT_START, EMBANK_PLATEAU, EMBANK_OUTER,
        (i, lato) => TrackGravel.barrierAt(BARRIER_PROFILE, i, lato));

    // Beccheggio (pitch) visivo dell'auto sui dislivelli: pendenza locale tra
    // il campione precedente e successivo lungo il giro, applicata come
    // rotazione attorno all'asse locale dell'auto DOPO l'imbardata (vedi
    // rotation.order = 'YXZ' in animate()) — così il muso si alza in salita e
    // si abbassa in discesa indipendentemente dalla direzione di marcia.
    function trackPitchAt(idx) {
        const n = trackPts.length;
        const prev = trackPts[(idx - 1 + n) % n];
        const next = trackPts[(idx + 1) % n];
        const dy = (next.y || 0) - (prev.y || 0);
        const horiz = Math.hypot(next.x - prev.x, next.z - prev.z) || 1e-6;
        return -Math.atan2(dy, horiz);
    }

    // Calcolato una volta sola: cordolo, barriera disegnata e MURO FISICO
    // lato server devono aprire il varco esattamente nello stesso punto e
    // nella stessa forma (Rif. richiesta utente 2026-08-08: "togliere il
    // cordolo... tanto c'è la corsia box"). La regola sta in TrackGravel, non
    // più qui: il server la richiama sugli stessi punti, così il varco
    // disegnato e quello fisico non possono divergere.
    //
    // Solo i campioni vicino ai due estremi (entro PIT_MERGE_WINDOW unità
    // d'arco da ciascuno) e non l'intero PIT_PTS: il varco deve aprirsi SOLO
    // al vero ingresso/uscita, non ovunque il tracciato passi vicino a un
    // punto qualunque della corsia box (bug reale misurato in playtest: 139m
    // di varco spurio su "prova"). Usare i campioni "abbracciati" alla curva
    // fa sì che anche la FORMA del varco segua la vera curvatura della pista.
    const PIT_MERGE_SAMPLES = TrackGravel.pitGapSamples(PIT_PTS);

    caricamento.passo('Asfalto, cordoli e barriere…', 0.30);
    await caricamento.respira();

    // Da qui in avanti nascono le superfici che di notte stanno SOTTO le
    // torri faro — asfalto, cordoli, ghiaia. Si segna dove comincia la
    // lista per poterle stilizzare a parte, con la tinta notturna dei
    // tratti illuminati invece di quella del buio: è il nastro chiaro che
    // taglia la notte, e senza il circuito è solo una scena scura.
    const _primaDellAsfalto = scene.children.length;

    // DoubleSide evita artefatti di culling nelle zone ad alta curvatura
    TrackMeshBuilder.buildRibbon(scene, trackPts, ROAD_HALF, new THREE.MeshStandardMaterial({ color: ToonPalette.SURFACES.asphalt, roughness: 0.95, side: THREE.DoubleSide }));
    TrackMeshBuilder.buildCurbs(scene, trackPts, ROAD_HALF, CURB_W, PIT_MERGE_SAMPLES);
    // Vie di fuga in ghiaia, dopo il cordolo e prima della barriera: l'ordine
    // delle chiamate riflette la sezione reale della pista. La banda parte dal
    // bordo esterno del cordolo, quindi non si sovrappone a nessuno dei due.
    TrackMeshBuilder.buildGravel(scene, trackPts, ROAD_HALF, CURB_W, BARRIER_PROFILE.gravel);
    // …e qui finiscono. La passata generale più sotto le salterà: convert()
    // converte solo i MeshStandardMaterial, e questi sono già toon.
    for (const m of scene.children.slice(_primaDellAsfalto)) {
        applicaStile(m, {
            saturation: ToonPalette.SATURATION.world,
            tintaNotte: ToonPalette.orario().tintaPista,
            guadagnoNotte: ToonPalette.orario().guadagnoPista,
        });
    }
    // La barriera sta dove dice il profilo: arretrata della via di fuga
    // minima quasi ovunque, di più dove c'è la ghiaia, ferma dov'era nel
    // tratto del traguardo e dei box, a bordo strada sui ponti.
    // Il piede va posato sul TERRENO, non sulla quota della pista: in curva
    // mentre si sale i settori del terrapieno si accavallano e quello più
    // avanti, più alto, seppellirebbe la barriera di quello più indietro
    // (segnalato in gioco il 2026-08-12, in salita verso il ponte).
    TrackMeshBuilder.buildBarriers(scene, trackPts,
        (i, side) => TrackGravel.barrierAt(BARRIER_PROFILE, i, side),
        PIT_MERGE_SAMPLES,
        (i, bx, bz) => TrackGeometry.terrainTopAt(trackPts, i, bx, bz, EMBANK_PLATEAU));
    TrackMeshBuilder.buildStartLine(scene, trackPts, ROAD_HALF);
    // drawBoxMarker=false: il riquadro giallo unico su boxIndex era il solo
    // indicatore visivo quando il box era un punto condiviso da tutti; ora
    // ogni pilota ha il proprio box 3D colorato (vedi loadPlayerPitBox,
    // caricato pigramente per gara), che ne prende il posto in gara —
    // resta true di default per l'editor tracciato (track-editor.js).
    // roadHalf/CURB_W in coda: solo per non disegnare la striscia laterale
    // "allungata" sopra il cordolo nella zona di preavviso (curbBand in
    // buildPitEdgeLines).
    TrackMeshBuilder.buildPitLane(scene, PIT_PATH, trackData.pit.roadHalfWidth, trackData.pit.boxIndex, false, trackPts, ToonPalette.SURFACES.asphalt, ROAD_HALF, CURB_W);

    // Griglia di partenza vera, permanente sulla pista (Rif. richiesta
    // utente 2026-08-07: "visibile sia in qualifica che in gara") — stessa
    // tecnica di startFinishIndex già usata server-side
    // (backend/sockets/games/trackLoader.js): indice campionato più vicino
    // al traguardo esplicito se la pista ne ha uno, altrimenti 0 (piste
    // non ancora riaperte nell'editor). Quante piazzole dipingere non è un
    // dato geometrico ma il numero di piloti scelto in lobby: prima era un 6
    // scritto qui a mano, da tenere in sync con altri due file — ed è
    // esattamente la divergenza che questo lavoro ha tolto di mezzo.
    const START_FINISH_INDEX = trackData.startFinish
        ? TrackGeometry.nearestPoint(trackPts, trackData.startFinish.x, trackData.startFinish.z).index
        : 0;
    TrackMeshBuilder.buildStartingGrid(scene, trackPts, START_FINISH_INDEX, gridSize);

    // ====================================================
    // STILE CEL-SHADED — conversione dei materiali generati qui
    // (Rif. spec 2026-08-10-f1-art-direction-cel-shading-design.md)
    // ====================================================
    // ORDINE OBBLIGATORIO: il terreno si converte PRIMA della conversione
    // generale qui sotto. Facendolo dopo, i suoi materiali non sarebbero più
    // MeshStandardMaterial, la marcatura non avrebbe effetto, le chiazze del
    // prato dipinto non comparirebbero e non ci sarebbe alcun errore a dirlo.
    // Solo buildGround, non il terrapieno: quello sfuma dal colore della
    // pista al verde con i vertex color, e le chiazze verdi gli
    // ricoprirebbero il bordo asfaltato.
    caricamento.passo('Stile del circuito…', 0.40);
    await caricamento.respira();

    for (const mesh of mesheTerreno) {
        applicaStile(mesh, {
            saturation: ToonPalette.SATURATION.world,
            isGround: true,
            // Di notte il verde attorno alla pista prende solo la luce
            // che avanza dai proiettori: vedi tintaTerreno in
            // toonPalette.js.
            tintaNotte: ToonPalette.orario().tintaTerreno,
        });
    }
    // Le mesh di TrackMeshBuilder sono aggiunte alla scena in modo sincrono:
    // una sola conversione qui le copre tutte. A questo punto dell'esecuzione
    // la scena contiene SOLO mesh sincrone — scenografia, auto e box arrivano
    // da callback asincrone, che non possono essersi inserite prima —, quindi
    // nessun oggetto rischia di prendere la saturazione sbagliata.
    applicaStile(scene, { saturation: ToonPalette.SATURATION.world });

    // Pannello di taratura: F9 lo apre, F8 accende e spegne i contorni.
    // `outline` resta null finché ToonOutline non entra in gioco.
    const pannello = ToonPanel.install({
        style: ToonStyle, sky: toonSky, outline: TOON_ON ? ToonOutline : null, scene,
        lights: { sun, hemi }, renderer, attivo: TOON_ON, perf: F1Perf,
    });

    // ====================================================
    // AUDIO MOTORE — un solo loop di 4s di un vero motore d'auto,
    // registrato e tarato apposta per un gioco di corse (progetto
    // "Trigger" di qubodup): CC-BY 3.0, va mantenuta l'attribuzione —
    // https://opengameart.org/content/car-engine-loop-96khz-4s. I
    // tentativi precedenti (crossfade a 8 bande da una registrazione F1
    // reale, poi un loop generico di macchinario CC0) sono stati bocciati
    // all'ascolto dall'utente. Pitch/volume seguono la velocità in
    // continuo (vedi animate()), con range diversi se l'auto sta
    // accelerando o decelerando/rilasciando — stesso file per entrambe le
    // fasi, nessun secondo asset.
    // ====================================================
    const listener = new THREE.AudioListener();
    camera.add(listener);
    // In CAMPIONATO il mondo parte muto. La propria auto viene caricata comunque
    // (serve appena si corre) e il suo motore parte con lei, a volume zero ma
    // con un attacco che si sente — segnalato al playtest: "finito il
    // caricamento sento un piccolo colpo, come qualcosa che parte per un
    // microsecondo". Davanti a una schermata di menu non deve uscire nessun
    // suono dal mondo, qualunque ne sia la sorgente.
    //
    // Il silenzio si toglie da solo al primo countdown: f1Countdown chiama
    // silenzioTransizione(false) da sempre, per la transizione qualifica→gara.
    // Solo davanti alle SCHERMATE del campionato, non nelle sue gare: una gara
    // di campionato e' un weekend come gli altri e deve avere il suo sonoro.
    if (schermataCampionato) silenzioTransizione(true);
    // La camera nel grafo della scena. Non serve a lei — una camera funziona
    // anche staccata — ma a ciò che le si appende: il renderer disegna solo
    // quello che raggiunge partendo da `scene`, quindi un oggetto figlio di
    // una camera fuori dal grafo non comparirebbe mai. Serve al modello
    // dell'auto in pole nel riepilogo di fine qualifica, che sta appeso alla
    // camera per restare fermo sullo schermo mentre dietro scorre la
    // panoramica del circuito.
    scene.add(camera);
    // Politica autoplay dei browser: il contesto audio nasce sospeso finché
    // non c'è un gesto dell'utente sulla pagina.
    function resumeAudioContext() {
        if (listener.context.state === 'suspended') listener.context.resume();
    }
    window.addEventListener('pointerdown', resumeAudioContext, { once: true });
    window.addEventListener('keydown', resumeAudioContext, { once: true });

    caricamento.passo('Audio…', 0.46);
    const engineBuffer = await new Promise((resolve, reject) => {
        new THREE.AudioLoader().load('/assets/audio/engine.wav', resolve, undefined, reject);
    });
    // Il file (4s, non tagliato da noi) non è stato editato per essere
    // seamless in loop: misurato sui campioni grezzi, tra l'ultimo e il
    // primo campione c'è un salto di ampiezza di ~0.28 (su scala -1..1) —
    // un "colpo" udibile a ogni giro di loop. Dissolvenza lineare di 15ms
    // su inizio e fine di ogni canale, verso lo zero, per eliminarlo.
    (function declickLoopEdges(buffer, fadeMs = 15) {
        const fadeSamples = Math.floor(buffer.sampleRate * fadeMs / 1000);
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < fadeSamples; i++) {
                const g = i / fadeSamples;
                data[i] *= g;                          // fade-in iniziale
                data[data.length - 1 - i] *= g;         // fade-out finale
            }
        }
    })(engineBuffer);

    // Deve restare in sync a mano con MAX_SPEED in
    // backend/sockets/games/f1GameSocket.js (oggi 6.2): nessun endpoint
    // espone questa costante al client.
    const ENGINE_REF_MAX_SPEED = 6.2;
    // Manopola unica di volume: le tre formule sotto (accelerando,
    // decelerando, corsia box) restano invariate come "forma" relativa,
    // questo moltiplicatore le scala tutte insieme — il volume si
    // percepisce su scala logaritmica, quindi per un taglio netto serve
    // un moltiplicatore basso (0.4 ≈ dimezzato all'orecchio, non 0.5
    // lineare), non un piccolo aggiustamento.
    const ENGINE_VOLUME_MULT = 0.4;

    // ====================================================
    // SCENOGRAFIA — caricamento asset e istanziazione dal layout generato
    // da TrackScenery.generateLayout. Ogni asset ripetuto (natura, folla)
    // usa un unico THREE.InstancedMesh per tenere basse le draw call anche
    // con centinaia di istanze; il laghetto (categoria 'pond', nessun asset
    // scaricato: il Nature Kit non ne include uno) è una mesh procedurale,
    // stesso approccio già usato per il prato di sfondo qui sopra.
    // ====================================================
    const SCENERY_ASSET_PATHS = {
        // Alberi: unici Kenney rimasti, per scelta esplicita dell'utente, e
        // unici a essere istanziati con un moltiplicatore di scala.
        treeBroad: '/assets/custom/circuit/treeBroad.glb',
        treeYoung: '/assets/custom/circuit/treeYoung.glb',
        treePine: '/assets/custom/circuit/treePine.glb',
        treeRound: '/assets/custom/circuit/treeRound.glb',
        bushLow: '/assets/custom/circuit/bushLow.glb',
        bushTall: '/assets/custom/circuit/bushTall.glb',
        motorhome: '/assets/custom/circuit/motorhome.glb',
        truck: '/assets/custom/circuit/truck.glb',
        containerStack: '/assets/custom/circuit/containerStack.glb',
        parkedCarRed: '/assets/custom/circuit/parkedCarRed.glb',
        parkedCarBlue: '/assets/custom/circuit/parkedCarBlue.glb',
        parkedCarWhite: '/assets/custom/circuit/parkedCarWhite.glb',
        banner: '/assets/custom/circuit/banner.glb',
        spectatorStandA: '/assets/custom/circuit/spectatorStandA.glb',
        spectatorStandB: '/assets/custom/circuit/spectatorStandB.glb',
        rockSingle: '/assets/custom/circuit/rockSingle.glb',
        rockCluster: '/assets/custom/circuit/rockCluster.glb',
        treeLarge: '/assets/kenney/treeLarge.glb',
        treeSmall: '/assets/kenney/treeSmall.glb',
        // Catalogo voxel custom (vedi docs/f1-notes.md): modellati 1:1 in
        // unità di gioco, quindi istanziati con scale 1.
        grandStand: '/assets/custom/circuit/grandStand.glb',
        grandStandAwning: '/assets/custom/circuit/grandStandAwning.glb',
        grandStandCovered: '/assets/custom/circuit/grandStandCovered.glb',
        billboard: '/assets/custom/circuit/billboard.glb',
        billboardLow: '/assets/custom/circuit/billboardLow.glb',
        pitsGarageClosed: '/assets/custom/circuit/pitsGarageClosed.glb',
        pitsOffice: '/assets/custom/circuit/pitsOffice.glb',
        // Landmark unici (SceneryLandmarks): gantry e passerella vengono
        // scalati per scavalcare le barriere, gli altri restano a 1.
        raceControlTower: '/assets/custom/circuit/raceControlTower.glb',
        startGantry: '/assets/custom/circuit/startGantry.glb',
        podium: '/assets/custom/circuit/podium.glb',
        footbridge: '/assets/custom/circuit/footbridge.glb',
        // Elementi distribuiti lungo il giro (SceneryTrackside).
        tyreStack: '/assets/custom/circuit/tyreStack.glb',
        catchFence: '/assets/custom/circuit/catchFence.glb',
        marshalPost: '/assets/custom/circuit/marshalPost.glb',
        brakingBoard: '/assets/custom/circuit/brakingBoard.glb',
        concreteBarrier: '/assets/custom/circuit/concreteBarrier.glb',
        pylon: '/assets/custom/circuit/pylon.glb',
        flagPole: '/assets/custom/circuit/flagPole.glb',
        paddockTent: '/assets/custom/circuit/paddockTent.glb',
        // Spettatori (SceneryCrowd): tre varianti alternate per dare
        // varietà alla folla. Restano 12 InstancedMesh anche con centinaia
        // di figure.
        spectatorA: '/assets/custom/circuit/spectatorA.glb',
        spectatorB: '/assets/custom/circuit/spectatorB.glb',
        spectatorC: '/assets/custom/circuit/spectatorC.glb',
        // Infrastrutture di circuito (spec 2026-08-13): modellate 1:1 in unità
        // di gioco come gli altri custom, quindi istanziate con scale 1.
        giantScreen: '/assets/custom/circuit/giantScreen.glb',
        floodlightTower: '/assets/custom/circuit/floodlightTower.glb',
        hospitalityDeck: '/assets/custom/circuit/hospitalityDeck.glb',
        vipSuite: '/assets/custom/circuit/vipSuite.glb',
        serviceBuilding: '/assets/custom/circuit/serviceBuilding.glb',
        tvTower: '/assets/custom/circuit/tvTower.glb',
        recoveryCrane: '/assets/custom/circuit/recoveryCrane.glb',
        trackGate: '/assets/custom/circuit/trackGate.glb',
    };

    // Asset che NON proiettano ombra. Il costo di un InstancedMesh in ombra
    // non si paga in draw call ma nella shadow map, che deve ridisegnare ogni
    // istanza a ogni frame: con ~1250 alberi e ~1400 spettatori il gioco
    // iniziava a scattare anche in localhost. Sono anche i casi in cui
    // l'ombra si nota meno — figure piccole e vegetazione lontana — mentre
    // tribune, edifici e strutture continuano a proiettarla.
    // Assets che di notte seguono la tinta del TERRENO invece di quella
    // delle costruzioni.
    const VEGETAZIONE = new Set([
        'treeLarge', 'treeSmall', 'treeBroad', 'treeYoung', 'treePine',
        'treeRound', 'bushLow', 'bushTall', 'woodMass',
    ]);

    // Finestre accese.
    //
    // In tutte e tre le foto di riferimento lo skyline è pieno di finestre
    // arancioni, e il contrasto fra quel caldo e il bianco freddo dei
    // proiettori è metà dell'atmosfera. Da noi gli edifici di notte erano
    // spenti.
    //
    // I vetri sono già un nodo a sé dentro ogni modello (`*_glass`), quindi
    // non serve geometria nuova: come per le lampade delle torri faro, il
    // materiale toon lascia il posto a un MeshBasicMaterial che non ascolta
    // nessuna luce. Zero draw call in più.
    const FINESTRE_CALDE = new Set([
        'motorhome_glass', 'pitsOffice_glass', 'pitsGarageClosed_glass',
        'raceControlTower_glass', 'serviceBuilding_glass', 'tvTower_glass',
        'vipSuite_glass',
    ]);

    // Gli schermi no: sono azzurrini, non arancioni.
    const SCHERMI_ACCESI = new Set(['giantScreen_glass']);

    // ⚠️ NON compaiono in nessuno dei due elenchi i vetri dei VEICOLI
    // (parkedCar*_glass, truck_glass, recoveryCrane_glass): un parabrezza
    // non è una finestra illuminata, e accenderlo darebbe un parcheggio di
    // auto coi fari interni accesi.

    const NO_SHADOW_ASSETS = new Set([
        'treeLarge', 'treeSmall', 'treeBroad', 'treeYoung', 'treePine', 'treeRound',
        'bushLow', 'bushTall', 'rockSingle', 'rockCluster',
        'spectatorA', 'spectatorB', 'spectatorC',
        // La torre faro è alta 32.5: la sua ombra attraversa la pista da parte
        // a parte e si muove col sole, ed è l'oggetto sbagliato su cui spendere
        // la risoluzione della shadow map. Gli spettatori in piedi seguono la
        // stessa regola dei loro fratelli seduti.
        'floodlightTower', 'spectatorStandA', 'spectatorStandB',
        // Le barriere di gomme sono il singolo asset più pesante della scena
        // (333k triangoli su "prova", un quinto del totale) e proiettano
        // l'ombra di un muretto alto 1.9 addossato a una barriera: non si
        // vede, e ridisegnarle nella mappa d'ombra ogni frame si paga. Stesso
        // discorso per le reti, che proietterebbero una grata sottile.
        'tyreStack', 'catchFence',
        // Le tribune non proiettano l'ombra col loro modello — 399k triangoli
        // e 102 gruppi su "prova", la fetta più grossa di quel che restava a
        // carico della mappa d'ombra. La proiettano con una SAGOMA: vedi
        // SHADOW_PROXY_ASSETS qui sotto.
        'grandStand', 'grandStandAwning', 'grandStandCovered',
    ]);

    // Asset la cui ombra è proiettata da una SCATOLA invisibile al posto del
    // modello vero. È la tecnica dei giochi grossi: l'ombra di una tribuna
    // vista da terra è un rettangolo scuro, e per disegnare un rettangolo
    // scuro non servono 3.700 triangoli di gradoni, sedili e tettoia — ne
    // bastano 12.
    //
    // Misurato su "prova": le tre varianti di tribuna pesavano 399k triangoli
    // in 102 gruppi nella mappa d'ombra; le sagome ne mettono ~200 in 17.
    // La scatola non si vede: si disegna senza scrivere colore né profondità,
    // quindi nell'immagine non compare — esiste solo per la mappa d'ombra.
    const SHADOW_PROXY_ASSETS = new Set(['grandStand', 'grandStandAwning', 'grandStandCovered']);

    // Asset esclusi dai CONTORNI (Rif. playtest 2026-08-10): figure minute e
    // ripetute in gran numero, sulle quali il tratto nero si legge come
    // sporco invece che come disegno, e che nel passaggio delle normali
    // costerebbero una draw call ciascuna.
    const NO_OUTLINE_ASSETS = new Set(['spectatorA', 'spectatorB', 'spectatorC',
        'spectatorStandA', 'spectatorStandB', 'bushLow', 'bushTall']);

    // Restituisce una Promise che si risolve quando OGNI asset ha finito —
    // riuscito o fallito. La schermata di caricamento la aspetta per non
    // scoprire un circuito a cui manca ancora metà scenografia; il fallimento
    // conta come "finito" apposta: un solo file mancante non deve poter
    // lasciare il giocatore davanti a una barra ferma per sempre.
    function loadScenery(container, layout) {
        const sceneryLoader = new THREE.GLTFLoader();
        const byAsset = new Map();
        for (const item of layout) {
            // Le voci senza modello — laghetto e asfalto del parcheggio — non
            // passano dal caricatore GLB: sono superfici piane costruite qui
            // sotto, e cercarne il file darebbe un 404 per ciascuna.
            if (item.category === 'pond' || item.category === 'parkingLot') continue;
            if (!byAsset.has(item.asset)) byAsset.set(item.asset, []);
            byAsset.get(item.asset).push(item);
        }

        const dummy = new THREE.Object3D();
        const attese = [];
        let fatti = 0;
        const totale = byAsset.size;
        // La scenografia occupa la seconda metà della barra: è la parte più
        // lunga dell'avvio ed è l'unica di cui si conosce il denominatore.
        const segnaAssetFatto = () => {
            fatti++;
            caricamento.passo(`Scenografia del circuito · ${fatti}/${totale}`, 0.55 + 0.42 * (fatti / totale));
        };
        for (const [asset, items] of byAsset) {
            const url = SCENERY_ASSET_PATHS[asset];
            let segnalaAsset;
            attese.push(new Promise(r => { segnalaAsset = r; }));
            sceneryLoader.load(url, (gltf) => {
                gltf.scene.updateMatrixWorld(true);
                const meshes = [];
                gltf.scene.traverse((child) => { if (child.isMesh) meshes.push(child); });

                // Peso dell'asset in scena, in triangoli: serve a decidere se
                // spezzarlo in celle. Si conta su TUTTE le mesh del modello e
                // una volta sola, perché la decisione è dell'asset e non della
                // singola mesh — mesh dello stesso oggetto divise in modo
                // diverso darebbero gruppi disallineati.
                let triAsset = 0;
                for (const mesh of meshes) {
                    const g = mesh.geometry;
                    triAsset += (g.index ? g.index.count : g.attributes.position.count) / 3;
                }
                triAsset *= items.length;
                const dividi = SceneryChunks.vaDivisoInCelle(items.length, triAsset);
                // Calcolata una volta sola e riusata: la divisione in celle
                // dipende dalle istanze, non dalla singola mesh, e serve anche
                // alle sagome d'ombra qui sotto.
                const gruppi = dividi
                    ? SceneryChunks.groupByCell(items, SceneryChunks.CELL)
                    : new Map([['unico', items]]);

                for (const mesh of meshes) {
                    const localMatrix = mesh.matrixWorld;
                    // Raggio e centro del singolo oggetto, per dimensionare
                    // l'ingombro dei gruppi qui sotto. Il centro non è per
                    // forza l'origine della geometria (il tetto di una tribuna
                    // sta tutto in alto), quindi va trasformato con la matrice
                    // dell'istanza e non semplicemente sommato.
                    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
                    const sferaBase = mesh.geometry.boundingSphere;

                    // Un InstancedMesh per CELLA invece di uno per asset: solo
                    // così il frustum culling può funzionare (vedi il commento
                    // in testa a sceneryChunks.js). Sotto la soglia resta un
                    // gruppo unico, che comunque riceve un ingombro corretto.
                    for (const sub of gruppi.values()) {
                        // Geometria "sottile": stessi attributi per riferimento
                        // (nessuna copia in memoria) ma volume di ingombro
                        // proprio. Scriverlo su mesh.geometry lo condividerebbe
                        // fra tutte le celle, che è esattamente il problema da
                        // risolvere.
                        const geo = new THREE.BufferGeometry();
                        for (const nome of Object.keys(mesh.geometry.attributes)) {
                            geo.setAttribute(nome, mesh.geometry.attributes[nome]);
                        }
                        if (mesh.geometry.index) geo.setIndex(mesh.geometry.index);

                        const im = new THREE.InstancedMesh(geo, mesh.material.clone(), sub.length);
                        // Etichetta per la diagnostica del pannello (F9):
                        // permette di spegnere per categoria e capire da dove
                        // viene il costo, senza ricaricare la pagina.
                        im.userData.sceneryAsset = asset;
                        // Nome del nodo nel .glb: serve a ritrovare i pezzi
                        // che il gioco deve comandare uno per uno, come i
                        // cinque gruppi semaforo del ponte di partenza
                        // (`gantry_light_1..5`, vedi raceStructures.py).
                        im.userData.sceneryMesh = mesh.name;
                        // Gli spettatori NON prendono il contorno: sono
                        // centinaia di figure alte poco più di un pixel sullo
                        // schermo, il tratto le trasforma in sporco nero sulle
                        // tribune e ogni istanza andrebbe ridisegnata nel
                        // passaggio delle normali. Restano visibili (la camera
                        // abilita quel layer) e ombra non ne proiettavano già
                        // prima (NO_SHADOW_ASSETS).
                        if (NO_OUTLINE_ASSETS.has(asset)) ToonStyle.excludeFromOutline(im);
                        im.castShadow = !NO_SHADOW_ASSETS.has(asset);
                        im.receiveShadow = true;

                        const centri = [];
                        let raggioMax = 0;
                        sub.forEach((it, i) => {
                            dummy.position.set(it.x, it.y || 0, it.z);
                            dummy.rotation.set(0, it.rotY || 0, 0);
                            dummy.scale.setScalar(it.scale || 1);
                            dummy.updateMatrix();
                            const finalMatrix = new THREE.Matrix4().multiplyMatrices(dummy.matrix, localMatrix);
                            im.setMatrixAt(i, finalMatrix);
                            const c = sferaBase.center.clone().applyMatrix4(finalMatrix);
                            centri.push({ x: c.x, y: c.y, z: c.z });
                            const s = it.scale || 1;
                            if (sferaBase.radius * s > raggioMax) raggioMax = sferaBase.radius * s;
                        });
                        im.instanceMatrix.needsUpdate = true;

                        const b = SceneryChunks.boundsOf(centri, raggioMax);
                        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(b.x, b.y, b.z), b.radius);
                        // Il culling vale sia per la camera sia per la mappa
                        // delle ombre, che ha un frustum suo: il risparmio si
                        // prende due volte.
                        im.frustumCulled = true;

                        // La vegetazione segue il terreno e non le
                        // costruzioni: nelle foto le palme ai lati della
                        // pista sono scure quanto il prato.
                        applicaStile(im, VEGETAZIONE.has(asset)
                            ? { tintaNotte: ToonPalette.orario().tintaTerreno }
                            : undefined);
                        // Dopo applicaStile: registraSemaforo e
                        // accendiTorreFaro sostituiscono il materiale toon
                        // con uno base, e farlo prima significherebbe
                        // farselo riconvertire subito dopo.
                        registraSemaforo(im, container);
                        // `centri` sono già le posizioni in coordinate
                        // mondo di questa mesh, istanza per istanza: per
                        // il pannello lampade sono esattamente i punti in
                        // cui accendere l'alone.
                        accendiTorreFaro(im, container, centri, sferaBase.radius);
                        accendiFinestre(im);
                        container.add(im);
                    }
                }

                // Sagoma d'ombra: una scatola grande quanto l'asset, che
                // proietta l'ombra al posto del modello vero. Disegnata senza
                // scrivere colore né profondità, quindi non compare
                // nell'immagine — esiste solo per la mappa d'ombra.
                if (SHADOW_PROXY_ASSETS.has(asset)) {
                    const dim = SceneryAssetSizes.sizeOf(asset);
                    if (dim) {
                        const scatola = new THREE.BoxGeometry(dim.w, dim.h, dim.d);
                        // Il pivot degli asset è alla BASE (vedi docs/f1-notes.md),
                        // il centro di una scatola è a metà altezza: va alzata,
                        // altrimenti l'ombra esce da un volume mezzo interrato.
                        scatola.translate(0, dim.h / 2, 0);
                        const raggioScatola = Math.hypot(dim.w, dim.h, dim.d) / 2;
                        for (const sub of gruppi.values()) {
                            // Geometria "sottile": stessi attributi per
                            // riferimento, volume di ingombro proprio. Serve
                            // per lo stesso motivo delle mesh vere qui sopra —
                            // e senza, la sagoma NON SI VEDE AFFATTO: una
                            // BoxGeometry ha l'ingombro centrato sull'origine
                            // del mondo, quindi il culling la scarta prima di
                            // disegnarla nella mappa d'ombra, ovunque sia in
                            // realtà. È esattamente quello che è successo al
                            // primo tentativo: le sagome c'erano e non
                            // proiettavano niente.
                            const geoProxy = new THREE.BufferGeometry();
                            for (const nome of Object.keys(scatola.attributes)) {
                                geoProxy.setAttribute(nome, scatola.attributes[nome]);
                            }
                            if (scatola.index) geoProxy.setIndex(scatola.index);

                            const proxy = new THREE.InstancedMesh(
                                geoProxy,
                                new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
                                sub.length);
                            const centriProxy = [];
                            sub.forEach((it, i) => {
                                dummy.position.set(it.x, it.y || 0, it.z);
                                dummy.rotation.set(0, it.rotY || 0, 0);
                                dummy.scale.setScalar(it.scale || 1);
                                dummy.updateMatrix();
                                proxy.setMatrixAt(i, dummy.matrix);
                                centriProxy.push({ x: it.x, y: (it.y || 0) + dim.h / 2, z: it.z });
                            });
                            const bProxy = SceneryChunks.boundsOf(centriProxy, raggioScatola);
                            geoProxy.boundingSphere = new THREE.Sphere(
                                new THREE.Vector3(bProxy.x, bProxy.y, bProxy.z), bProxy.radius);
                            proxy.instanceMatrix.needsUpdate = true;
                            proxy.castShadow = true;
                            proxy.receiveShadow = false;
                            proxy.frustumCulled = true;
                            proxy.userData.sceneryAsset = asset + ' (sagoma ombra)';
                            // Fuori dai contorni: il tratto nero seguirebbe gli
                            // spigoli di una scatola che non si deve vedere.
                            ToonStyle.excludeFromOutline(proxy);
                            container.add(proxy);
                        }
                    }
                }

                segnaAssetFatto();
                segnalaAsset();
            }, undefined, (err) => {
                console.error(`[F1] Errore caricando asset scenografia "${asset}":`, err);
                segnaAssetFatto();
                segnalaAsset();
            });
        }

        // Asfalto del parcheggio: un rettangolo piano, come il laghetto ma
        // squadrato e orientato con la corsia box. Senza, le auto poggiano
        // sull'erba e si leggono come abbandonate invece che parcheggiate.
        for (const item of layout) {
            if (item.category !== 'parkingLot') continue;
            const asfalto = new THREE.Mesh(
                new THREE.PlaneGeometry(item.larghezza, item.profondita),
                new THREE.MeshStandardMaterial({ color: ToonPalette.SURFACES.pitLane, roughness: 0.95 })
            );
            asfalto.rotation.x = -Math.PI / 2;
            asfalto.rotation.z = item.rotY;
            asfalto.position.set(item.x, (item.y || 0) + 0.04, item.z);
            asfalto.receiveShadow = true;
            applicaStile(asfalto, { saturation: ToonPalette.SATURATION.world });
            container.add(asfalto);
        }

        for (const item of layout) {
            if (item.category !== 'pond') continue;
            const pond = new THREE.Mesh(
                new THREE.CircleGeometry(item.radius, 24),
                new THREE.MeshStandardMaterial({ color: ToonPalette.SURFACES.pond, roughness: 0.35, metalness: 0.05 })
            );
            pond.rotation.x = -Math.PI / 2;
            pond.position.set(item.x, (item.y || 0) + 0.03, item.z);
            pond.receiveShadow = true;
            applicaStile(pond, { saturation: ToonPalette.SATURATION.world });
            container.add(pond);
        }

        return Promise.all(attese);
    }

    // Chiamata qui (dopo la dichiarazione di loadScenery/SCENERY_ASSET_PATHS,
    // non subito dopo buildPitLane più sopra): SCENERY_ASSET_PATHS è un
    // const nello stesso scope della funzione asincrona di DOMContentLoaded,
    // quindi resta nella temporal dead zone finché l'esecuzione non arriva
    // alla sua riga — chiamare loadScenery prima, pur essendo la funzione
    // stessa hoistata, faceva scattare un ReferenceError a runtime.
    // I posti a sedere delle tribune stanno in un JSON generato dal builder
    // degli asset (backend/tools/f1CircuitAssetsBuilder.py): TrackScenery è
    // un modulo puro e non può fare fetch, quindi glieli passiamo noi. Se il
    // file manca la scenografia viene comunque generata, solo senza
    // spettatori, invece di far fallire il caricamento della pista.
    let seatAnchors = null;
    try {
        const seatsRes = await fetch('/assets/custom/circuit/grandStandSeats.json');
        if (seatsRes.ok) seatAnchors = (await seatsRes.json()).seats;
    } catch (err) {
        console.warn('[F1] posti tribuna non caricati, tribune vuote:', err);
    }
    // Ancore degli spettatori sulle terrazze, stesso discorso dei posti a
    // sedere: file generato dal builder, TrackScenery non può fare fetch.
    let terraceAnchors = null;
    try {
        const terrRes = await fetch('/assets/custom/circuit/terraceAnchors.json');
        if (terrRes.ok) terraceAnchors = (await terrRes.json()).anchors;
    } catch (err) {
        console.warn('[F1] ancore terrazze non caricate, terrazze vuote:', err);
    }
    // BARRIER_PROFILE come ultimo argomento: la scenografia si calcola con la
    // barriera storica e poi segue il muro dove si è spostato. Senza questo,
    // tribune e cartelloni resterebbero dentro la via di fuga o murati.
    // ====================================================
    // SEMAFORO DI PARTENZA — quello VERO, sul ponte in fondo al rettilineo
    // ====================================================
    // Le cinque colonne di lenti sono cinque mesh distinte nel .glb
    // (`gantry_light_1..5`), quindi hanno un InstancedMesh e un materiale
    // ciascuna e si possono accendere una alla volta.
    //
    // Materiale BASE e non toon: una lampada accesa non deve obbedire alla
    // luce del sole, deve essere sempre alla sua massima intensità — è quello
    // che la fa leggere come accesa invece che come "rossa in ombra". Dalla
    // pole il gruppo di lenti occupa il 12% dell'altezza dello schermo, da P6
    // circa la metà: senza questo stacco netto, a quella dimensione non si
    // distinguerebbe acceso da spento.
    // Rosso pieno da acceso, e un rosso quasi nero da spento: più i due stati
    // sono lontani, più la lampada si legge da lontano. È la stessa ragione
    // per cui il materiale non è toon.
    const SEMAFORO_SPENTO = 0x2a0806;
    const SEMAFORO_ACCESO = 0xff0000;
    const semaforiPonte = [];   // InstancedMesh, in ordine da 1 a 5
    const bagliori = [];        // l'alone attorno a ciascuna, stesso ordine

    // Alone: una macchia luminosa che sfuma verso il bordo, disegnata una
    // volta e riusata da tutte e cinque. Un colore pieno non può superare il
    // bianco, quindi da solo non "illumina": è l'alone che si somma allo
    // sfondo (blending additivo) a dare l'impressione di luce che esce.
    function texturaBagliore() {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d').createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0.00, 'rgba(255,110,90,1)');
        g.addColorStop(0.25, 'rgba(255,40,20,0.55)');
        g.addColorStop(1.00, 'rgba(255,0,0,0)');
        const ctx = c.getContext('2d');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(c);
    }
    let _texBagliore = null;

    // Torri faro accese.
    //
    // Il pannello di lampade è un nodo suo dentro il modello
    // (`floodlightTower_white`, x da -3.22 a 3.23 e y da 28.67 a 31.33:
    // misurato sul .glb, non indovinato). Di notte smette di essere una
    // superficie ILLUMINATA e diventa una superficie che ILLUMINA: il
    // materiale toon lascia il posto a un MeshBasicMaterial, che non
    // ascolta nessuna luce e resta bianco anche in mezzo al buio.
    //
    // È lo stesso trucco dei semafori del ponte di partenza, qui sotto —
    // e non costa una draw call in più, perché il materiale sostituito è
    // quello di una mesh che veniva disegnata comunque.
    //
    // L'alone invece SÌ: uno sprite additivo per torre. Il gioco è
    // GPU-bound sui pixel (vedi il pannello F9), quindi resta piccolo —
    // 2.6 volte il raggio del pannello e non 3.2 come i semafori, che si
    // guardano da vicino e sono cinque in tutto.
    function accendiFinestre(im) {
        if (!NOTTURNO) return;
        const nome = im.userData.sceneryMesh || '';
        const caldo = FINESTRE_CALDE.has(nome);
        if (!caldo && !SCHERMI_ACCESI.has(nome)) return;
        im.material = new THREE.MeshBasicMaterial({ color: caldo ? 0xffcf8c : 0xcfe0ff });
        // Senza, il passaggio dei contorni disegna un bordo nero attorno a
        // ogni finestra: una luce con il contorno non è una luce.
        ToonStyle.excludeFromOutline(im);
    }

    function accendiTorreFaro(im, container, centri, raggioPannello) {
        if (!NOTTURNO) return;
        if (im.userData.sceneryMesh !== 'floodlightTower_white') return;

        // Il colore sta dentro la funzione e non accanto: la chiamata arriva
        // da una callback di caricamento, e una const dichiarata piu' sotto
        // nel file non e' ancora inizializzata quando quella callback parte.
        // Le funzioni si possono usare prima, le const no.
        im.material = new THREE.MeshBasicMaterial({ color: 0xfffdf2 });
        // Senza questo il passaggio dei contorni disegna un bordo nero
        // attorno alla lampada: una luce con il contorno non è una luce.
        ToonStyle.excludeFromOutline(im);

        // Il raggio arriva da fuori e NON da im.geometry.boundingSphere:
        // quella, poche righe prima della chiamata, e' stata riscritta con
        // l'ingombro dell'INTERO gruppo di torri della cella (serve al
        // frustum culling). Usarla qui darebbe un alone grande quanto mezzo
        // circuito. Ai semafori del ponte non succede perche' li' il gruppo
        // e' una lampada sola.
        if (!(raggioPannello > 0)) return;
        if (!_texBagliore) _texBagliore = texturaBagliore();
        for (const c of centri) {
            const alone = new THREE.Sprite(new THREE.SpriteMaterial({
                map: _texBagliore,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                transparent: true,
                opacity: 0.75,
            }));
            alone.position.set(c.x, c.y, c.z);
            alone.scale.setScalar(raggioPannello * 4.0);
            alone.renderOrder = 2;
            ToonStyle.excludeFromOutline(alone);
            container.add(alone);
            // Da qui la direzione della luce: vedi direzioneDaiFari.
            fariNotturni.push({ x: c.x, z: c.z });
        }
    }

    function registraSemaforo(im, container) {
        const n = /^gantry_light_(\d+)$/.exec(im.userData.sceneryMesh || '');
        if (!n) return;
        const i = parseInt(n[1], 10) - 1;
        im.material = new THREE.MeshBasicMaterial({ color: SEMAFORO_SPENTO });
        semaforiPonte[i] = im;

        // L'alone va dove stanno le lenti: il centro dell'ingombro
        // dell'InstancedMesh è già in coordinate mondo (lo calcola
        // loadScenery poco sopra).
        const sfera = im.geometry.boundingSphere;
        if (!sfera) return;
        if (!_texBagliore) _texBagliore = texturaBagliore();
        const alone = new THREE.Sprite(new THREE.SpriteMaterial({
            map: _texBagliore,
            blending: THREE.AdditiveBlending,
            depthWrite: false,   // non deve nascondere ciò che ha dietro
            transparent: true,
            opacity: 0,
        }));
        alone.position.copy(sfera.center);
        alone.scale.setScalar(sfera.radius * 3.2);
        alone.renderOrder = 2;
        // Fuori dai contorni: lo sprite è un riquadro sempre rivolto alla
        // camera, e il passaggio dei bordi ne disegnava il perimetro — a
        // schermo si vedeva un pannello invisibile squadrato attorno alle
        // luci, perpendicolare alla loro direzione (segnalato in playtest).
        ToonStyle.excludeFromOutline(alone);
        container.add(alone);
        bagliori[i] = alone;
    }

    function accendiSemafori(quanti) {
        for (let i = 0; i < semaforiPonte.length; i++) {
            const acceso = i < quanti;
            const im = semaforiPonte[i];
            if (im) im.material.color.setHex(acceso ? SEMAFORO_ACCESO : SEMAFORO_SPENTO);
            if (bagliori[i]) bagliori[i].material.opacity = acceso ? 1 : 0;
        }
    }

    // Bip del semaforo, sintetizzato invece che scaricato: un file in più
    // sarebbe un asset da caricare e una licenza da rispettare per mezzo
    // secondo di suono. Onda quadra, come il resto dell'estetica del gioco.
    // Passa dal listener (non da destination diretto) così segue il volume
    // generale e non è posizionale: il semaforo lo senti uguale da qualunque
    // posizione in griglia.
    function bipSemaforo(freq, durata, volume) {
        const ctx = listener.context;
        if (!ctx || ctx.state !== 'running') return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        const t0 = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durata);
        osc.connect(gain);
        gain.connect(listener.getInput());
        osc.start(t0);
        osc.stop(t0 + durata + 0.03);
    }

    // Scatto del conteggio delle posizioni in griglia: il "clic" secco di un
    // display che cambia cifra. Sintetizzato come il bip del semaforo, per lo
    // stesso motivo (mezzo secondo di suono non vale un asset e una licenza).
    //
    // La frequenza SALE man mano che si risale la griglia: il suono racconta
    // la stessa cosa che raccontano i numeri, cioè che stai migliorando, e
    // sulla pole arriva in cima. Non è decorazione, è la stessa informazione
    // per un altro senso.
    //
    // ⚠️ Va a `ctx.destination`, NON al listener come bipSemaforo: durante la
    // transizione il mondo è muto (silenzioTransizione azzera il volume del
    // listener, altrimenti si sentirebbero i motori delle auto già ferme in
    // griglia) e questo è un suono d'interfaccia, non un suono del mondo.
    function ticPosizione(progresso) {
        const ctx = listener.context;
        if (!ctx || ctx.state !== 'running') return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        // 520 → 980 Hz dall'ultima posizione alla pole.
        osc.frequency.value = 520 + 460 * Math.max(0, Math.min(1, progresso));
        const t0 = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.07);
    }

    // Il colpo con cui il conteggio si pianta sulla propria posizione. Più
    // pieno e più lungo degli scatti, così l'arrivo si sente e non si deduce
    // dal fatto che i clic sono finiti. La pole prende la nota più alta.
    function colpoArrivo(isPole) {
        const ctx = listener.context;
        if (!ctx || ctx.state !== 'running') return;
        const t0 = ctx.currentTime;
        const note = isPole ? [523, 784, 1047] : [392, 523];
        note.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            const inizio = t0 + i * 0.075;
            gain.gain.setValueAtTime(0.0001, inizio);
            gain.gain.exponentialRampToValueAtTime(0.06, inizio + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, inizio + 0.42);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(inizio);
            osc.stop(inizio + 0.46);
        });
    }

    // Indicatore a schermo: il via lo danno i semafori sul ponte, questo è un
    // aiuto facoltativo per chi parte in fondo alla griglia (da lì le luci
    // occupano metà dello spazio che occupano dalla pole) o sta guardando
    // altrove. Spento di default; la scelta resta fra una gara e l'altra.
    let indicatoreLuci = false;
    try { indicatoreLuci = localStorage.getItem('f1IndicatoreLuci') === '1'; } catch (e) { /* modalità privata */ }

    caricamento.passo('Disposizione della scenografia…', 0.52);
    await caricamento.respira();
    const sceneryLayout = TrackScenery.generateLayout(trackData, trackPts, PIT_PTS, BARRIER_D, EMBANKMENT_WIDTH, seatAnchors, BARRIER_PROFILE, terraceAnchors, { gridSize });
    const scenografiaPronta = loadScenery(scene, sceneryLayout);

    // Inquadrature dell'anteprima mostrata durante la scelta mescola. Si
    // calcolano una volta sola: dipendono dalla forma del tracciato e dalla
    // scenografia, che da qui in poi non cambiano più.
    //
    // DOPO generateLayout, non prima: senza la scenografia le camere non
    // sanno cosa hanno intorno e finiscono dentro i cartelloni sponsor —
    // che stanno esattamente all'offset dove si mettevano loro (vedi
    // trackPreviewShots.js).
    const anteprimaScatti = TrackPreviewShots.buildShots(trackPts, PIT_PTS, {
        startFinishIndex: START_FINISH_INDEX,
        barrierDist: BARRIER_D,
        layout: sceneryLayout,
    });

    // ====================================================
    // LOADER GLB (macchina colorata per team)
    // ====================================================
    // recolorLiveryTexture/loadCarModel estratti in frontend/shared/carLoader.js
    // (condiviso col banco prova bot in frontend/f1-testbench.js) — questo è
    // solo un thin wrapper che passa le dipendenze locali.
    function loadCarModel(playerColor, onReady, liveryColors) {
        CarLoader.loadCarModel(playerColor, (car) => {
            // Saturazione quasi nulla sull'auto: il colore identifica il
            // pilota ed è lo stesso pallino della classifica. A
            // caratterizzarla ci pensano le fasce di luce, non lo
            // spostamento di colore.
            applicaStile(car, { saturation: ToonPalette.SATURATION.car });
            onReady(car);
        }, { scene, listener, engineBuffer }, liveryColors);
    }

    // ====================================================
    // EFFETTI PARTICELLARI — la scia e i detriti
    //
    // Il moto sta in shared/f1Particelle.js (nessun Three.js dentro, si
    // verifica senza browser); qui c'è solo il pezzo che non può stare
    // altrove: costruire l'InstancedMesh e copiarci dentro le matrici.
    //
    // Un'unica InstancedMesh per effetto = una draw call per tutti i cubetti.
    // Niente trasparenza per istanza (i materiali base di InstancedMesh non la
    // supportano in questa versione di Three): la dissolvenza è resa
    // restringendo la scala, ed è la ragione per cui `scalaDi` esiste.
    //
    // La SCIA è il vento in slipstream: vive in coordinate locali dell'auto,
    // appesa al suo group, e la si vede solo quando il server segnala il bonus.
    // I DETRITI sono erba e ghiaia sollevate da sotto la vettura: vivono in
    // coordinate MONDO, appesi alla scena, perché la terra resta dov'era e
    // l'auto se ne va. Stesso modulo, due configurazioni.
    // ====================================================
    const _particelleDummy = new THREE.Object3D();
    const particelleGeometria = new THREE.BoxGeometry(1, 1, 1);

    // `partiPieno`: la scia nasce col pool già sparso su tutta la durata di vita
    // (si accende e si spegne in blocco con `visible`, e deve essere completa
    // dal primo frame). I detriti no — nascono VUOTI: le loro particelle vivono
    // in coordinate mondo, e un pool precaricato sarebbe una manciata di zolle
    // ferme all'origine della mappa, pronte a comparire al primo fuoripista.
    function costruisciEffettoParticelle(config, colore, opacita, { partiPieno = true } = {}) {
        const materiale = new THREE.MeshBasicMaterial({
            color: colore, transparent: true, opacity: opacita
        });
        const mesh = new THREE.InstancedMesh(particelleGeometria, materiale, config.numero);
        mesh.visible = false;
        const stato = F1Particelle.creaStato(config);
        mesh.userData.particelle = partiPieno ? F1Particelle.riempi(stato, config, null) : stato;
        mesh.userData.configParticelle = config;
        // Effetto, non oggetto solido: col contorno i cubetti diventerebbero
        // coriandoli neri. Perde anche la proiezione d'ombra, che comunque non
        // aveva (MeshBasicMaterial, castShadow mai attivato).
        ToonStyle.excludeFromOutline(mesh);
        return mesh;
    }

    function aggiornaEffettoParticelle(mesh, dtMs, { ancora = null, emissione = 1 } = {}) {
        const config = mesh.userData.configParticelle;
        const stato = mesh.userData.particelle;
        F1Particelle.avanza(stato, config, dtMs, { ancora, emissione });
        let vive = 0;
        for (let i = 0; i < config.numero; i++) {
            const scala = F1Particelle.scalaDi(stato, i, config);
            if (scala > 0) vive++;
            _particelleDummy.position.set(stato.x[i], stato.y[i], stato.z[i]);
            _particelleDummy.scale.setScalar(scala);
            _particelleDummy.updateMatrix();
            mesh.setMatrixAt(i, _particelleDummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        return vive;
    }

    function buildSlipstreamEffect() {
        return costruisciEffettoParticelle(F1Particelle.SCIA, 0xdfe3e6, 0.55);
    }

    // ── Detriti di erba e ghiaia ────────────────────────────────────────────
    // Appesi alla SCENA, non all'auto: la terra sollevata resta dov'era e la
    // vettura se ne va.
    //
    // UNA MESH PER VETTURA, non una sola condivisa. Il colore è una proprietà
    // del materiale, e in pista due auto possono benissimo essere una sul prato
    // e una nella ghiaia nello stesso istante: con una mesh sola servirebbe il
    // colore per istanza. Il conto è presto fatto — otto draw call in più su
    // ~800, su un gioco che è limitato dai pixel e non dalle draw call
    // (misurato col pannello F9) — e la mesh di chi è in pista resta invisibile,
    // quindi il caso normale non costa niente.
    //
    // Nascono su richiesta: chi non è mai finito fuori pista non ha nemmeno la
    // mesh. In una gara pulita non ne esiste una.
    const detritiPerAuto = {};

    function detritiDi(color) {
        let d = detritiPerAuto[color];
        if (!d) {
            // Pool VUOTO alla nascita (non `partiPieno`): le particelle vivono
            // in coordinate mondo, e un pool precaricato sarebbe una manciata di
            // zolle ferme all'origine della mappa pronte a comparire al primo
            // fuoripista.
            const mesh = costruisciEffettoParticelle(
                F1Particelle.DETRITI, ToonPalette.SURFACES.grass, 0.95, { partiPieno: false });
            // Senza questo l'effetto non si vedrebbe MAI. Il frustum culling di
            // Three prova la sfera di ingombro della GEOMETRIA trasformata dalla
            // matrice dell'oggetto e non sa niente delle istanze: questa mesh ha
            // origine (0,0,0) mentre le zolle vivono a centinaia di unità da lì,
            // quindi verrebbe scartata ogni volta che l'origine della mappa è
            // fuori inquadratura, cioè quasi sempre.
            mesh.frustumCulled = false;
            scene.add(mesh);
            d = detritiPerAuto[color] = {
                mesh,
                materiale: null,                 // 'erba' | 'ghiaia': quale colore è montato
                ancora: { x: 0, y: 0, z: 0, avantiX: 0, avantiZ: 1 },
            };
        }
        return d;
    }

    function rimuoviDetritiDi(color) {
        const d = detritiPerAuto[color];
        if (!d) return;
        scene.remove(d.mesh);
        d.mesh.material.dispose();
        delete detritiPerAuto[color];
    }

    // Sotto questa frazione di velocità non schizza niente: fermarsi nella
    // ghiaia e restarci non solleva terra, e un effetto che continua a sbuffare
    // sull'auto ferma è la cosa che si nota per prima come sbagliata.
    const DETRITI_SOGLIA = 0.08;
    const DETRITI_PIENO = 0.5;        // frazione di velocità a cui il ritmo è pieno
    const _detritiAvanti = new THREE.Vector3();

    // Aggiorna i detriti di UNA vettura. `misura` può arrivare già calcolata
    // (per la propria auto la calcola anche la camera, e farla due volte per
    // frame sarebbe lavoro doppio per la stessa domanda).
    function aggiornaDetritiDi(color, carGroup, dtMs, misuraGia) {
        const esistenti = detritiPerAuto[color];
        const stato = serverState[color];
        const inScena = !!carGroup && !tyreSelectActive && !panoramicaAttiva && !cerimoniaAttiva;
        let emissione = 0;
        let misura = null;

        if (inScena && stato) {
            misura = misuraGia !== undefined ? misuraGia : F1SensoVelocita.misuraSottoAuto(TrackGeometry, {
                trackPts, pitPts: PIT_PTS,
                idxPrecedente: stato.trackIndex || 0,
                x: carGroup.position.x, z: carGroup.position.z,
                roadHalf: ROAD_HALF, curbW: CURB_W,
            });
            if (misura && misura.superficie === F1SensoVelocita.FUORI) {
                const frazione = Math.min(1, Math.abs(stato.speed || 0) / F1SensoVelocita.VEL_RIFERIMENTO);
                emissione = Math.max(0, Math.min(1, (frazione - DETRITI_SOGLIA) / (DETRITI_PIENO - DETRITI_SOGLIA)));
            }
        }

        // Chi non è mai uscito di pista non ha una mesh, e finché non serve non
        // se ne crea una: in una gara pulita questo ramo esce sempre di qui.
        if (emissione === 0 && !esistenti) return;

        const d = detritiDi(color);
        if (emissione > 0) {
            // Il colore lo decide la MAPPA, non un valore fisso: la ghiaia
            // esiste solo dove il profilo delle vie di fuga la disegna, e altrove
            // il fuoripista è prato.
            const materiale = F1SensoVelocita.materialeFuori(
                BARRIER_PROFILE.gravel, misura.idx, misura.lat, ROAD_HALF, CURB_W);
            if (materiale !== d.materiale) {
                d.mesh.material.color.setHex(materiale === F1SensoVelocita.GHIAIA
                    ? ToonPalette.SURFACES.gravel
                    : ToonPalette.SURFACES.grass);
                d.materiale = materiale;
            }

            _detritiAvanti.set(0, 0, 1).applyQuaternion(carGroup.quaternion);
            d.ancora.x = carGroup.position.x;
            d.ancora.y = carGroup.position.y;
            d.ancora.z = carGroup.position.z;
            d.ancora.avantiX = _detritiAvanti.x;
            d.ancora.avantiZ = _detritiAvanti.z;
        } else if (!d.mesh.visible) {
            // Niente da emettere e niente in aria: non c'è lavoro da fare.
            return;
        }

        // Anche a emissione zero si continua finché resta qualcosa in volo: è ciò
        // che fa ricadere le ultime zolle dopo il rientro in pista, invece di
        // spegnerle a mezz'aria.
        const vive = aggiornaEffettoParticelle(d.mesh, dtMs, {
            ancora: d.ancora,
            emissione,
            // Il suolo sta alla quota dell'auto: le piste hanno dislivelli, e uno
            // zero fisso farebbe posare le zolle sotto o sopra il prato.
            pavimento: carGroup ? carGroup.position.y : 0,
        });
        d.mesh.visible = vive > 0;
    }

    // ── La scia, per tutte le vetture ───────────────────────────────────────
    // Il server segnala chi è in scia per OGNI pilota (buildPublicState), era il
    // client a guardare solo il proprio colore. Qui la mesh è appesa all'auto —
    // la scia è vento, sta attaccata a chi la produce — quindi si sposta e si
    // distrugge insieme a lei senza doverla inseguire.
    const sciePerAuto = {};

    function rimuoviSciaDi(color) {
        const mesh = sciePerAuto[color];
        if (!mesh) return;
        if (mesh.parent) mesh.parent.remove(mesh);
        mesh.material.dispose();
        delete sciePerAuto[color];
    }

    function aggiornaSciaDi(color, carGroup, dtMs) {
        const stato = serverState[color];
        const attiva = !!(carGroup && stato && stato.slipstream);
        let mesh = sciePerAuto[color];
        // Chi non è mai stato in scia non ha nemmeno la mesh.
        if (!attiva && !mesh) return;
        if (!mesh) {
            mesh = sciePerAuto[color] = buildSlipstreamEffect();
            carGroup.add(mesh);
        }
        mesh.visible = attiva;
        // Ferma quando non serve: il pool resta dov'è e riprende da lì, già
        // sfalsato, la volta dopo.
        if (attiva) aggiornaEffettoParticelle(mesh, dtMs);
    }

    // Tutte le vetture in scena, non solo la propria: chi guarda una gara vede
    // la scia e gli errori degli altri, ed è metà del senso di avere gli effetti.
    // Un giro solo per entrambi, così non possono divergere su chi è in pista.
    function aggiornaEffettiVetture(dtMs, misuraMia) {
        aggiornaDetritiDi(myColor, myCarGroup, dtMs, misuraMia);
        aggiornaSciaDi(myColor, myCarGroup, dtMs);
        for (const color of Object.keys(otherCars)) {
            const carGroup = otherCars[color];
            aggiornaDetritiDi(color, carGroup, dtMs);
            aggiornaSciaDi(color, carGroup, dtMs);
        }
    }

    // ====================================================
    // STATO DI GIOCO
    // ====================================================
    let myCarGroup = null;
    let cameraMode = 'third';
    // "Guarda dietro": attivo solo finché il tasto resta premuto (B / freccia
    // giù, Cerchio sul controller). Non è una terza modalità camera — si
    // sovrappone a quella corrente, che resta invariata al rilascio.
    // Tastiera e controller hanno stati SEPARATI perché convivono nella
    // stessa partita: con un'unica variabile, il gamepad (ripollato ad ogni
    // frame) spegnerebbe subito la vista attivata da tastiera.
    let lookBackKey = false;
    let lookBackPad = false;
    function isLookingBack() { return lookBackKey || lookBackPad; }
    // ── Segnalazioni in gioco (M / Shift+M) ────────────────────────────
    // Un id per ogni caricamento della pagina: tiene separati i giri di
    // ricognizione e dà a Shift+M un bersaglio non ambiguo.
    const sessioneSegnalazioni = F1Segnalazioni.nuovaSessioneId(new Date(), Math.random);
    // Ultimo giro noto, per annotare la segnalazione. null = non ancora saputo.
    let giroCorrente = null;
    let isRacing = false;
    let myFinalTime = null;
    // Tempo trascorso "vero" per il timer HUD live (Rif. 2026-08-07):
    // ANCORATO a state[myColor].elapsedMs (conteggio di tick fisici lato
    // server, la STESSA fonte usata per il tempo finale — vedi checkLap),
    // ma tra un f1StateUpdate e il prossimo (~50ms, a volte di più per il
    // jitter del tick loop — vedi nota su PHYSICS_TICK_MS) il rendering
    // (~60fps) estrapola in avanti con Date.now() dall'ultimo aggancio:
    // altrimenti il numero "scatta" a salti di 50/150ms invece di scorrere
    // liscio (segnalato dall'utente). Ri-agganciato ad ogni tick reale, non
    // può quindi derivare come il vecchio Date.now()-localStart.
    let myLiveElapsedMs = null;
    let myLiveElapsedSyncedAt = null;
    // Delta continuo rispetto al giro precedente (Rif.
    // docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md): letto
    // una volta per f1StateUpdate (~50ms), usato solo per colorare
    // #hud-timer — non serve estrapolazione locale come myLiveElapsedMs.
    let myDeltaToPreviousLapMs = null;
    // Sessione di qualifica "ancora aperta" agli occhi del client — driven
    // SOLO dagli eventi di ciclo vita (mai da target.finished, vedi sotto),
    // per il pannello "in attesa degli altri piloti". Rif. 2026-08-07,
    // terzo giro: durante 'grid_display' (il pannello coi tempi di tutti)
    // playersVisibleTo() lato server ritorna ESPLICITAMENTE {} per quella
    // fase (f1GameSocket.js) — nessun f1StateUpdate arriva più finché non
    // si passa a 'race', quindi target.finished per il proprio colore resta
    // congelato a true per TUTTA la durata della griglia (non ~1 tick come
    // creduto al giro precedente): un mostra/nascondi basato sullo stato
    // "vivo" del giocatore non può funzionare in questa fase, serve sapere
    // se la sessione è chiusa indipendentemente da quel dato.
    let qualiSessionOpen = false;
    let hostColor = null;
    let currentPhase = null;   // tyre_select | qualifying | grid_display | race
    let raceTotalLaps = 3;      // giri della gara vera (fisso, indipendente dalla fase corrente)

    let tyrePanelOpen = false;   // stato locale, mai sincronizzato col server — resettato a chiuso ad ogni f1Countdown
    let debugPanelOpen = false;   // pannello debug usura/guasti (tasto G), stato locale, mai sincronizzato col server
    let lightsSequenceActive = false;   // true durante la plancia luci del via gara (non in qualifica)

    // Verde -> giallo -> rosso, la scala approvata per l'usura. Vive in
    // shared/f1Danni.js perche' ora la usano anche i quattro quadranti dei
    // danni: due copie della stessa scala si sarebbero scostate al primo
    // ritocco, e il pannello avrebbe detto una cosa e l'icona un'altra.
    const wearColor = (pct) => F1Danni.colore(pct);

    // Il pannello gomme ha senso SOLO in gara (in qualifica/tyre_select/
    // grid_display l'usura non è mai rilevante — stessa logica del vecchio
    // tyre-box). Dentro la gara, mostra o l'icona chiusa o il pannello
    // esteso a seconda di tyrePanelOpen, mai entrambi.
    function renderTyreVisibility() {
        const closedEl = document.getElementById('tyre-closed');
        const openEl = document.getElementById('tyre-open');
        if (currentPhase !== 'race') {
            closedEl.style.display = 'none';
            openEl.style.display = 'none';
            return;
        }
        closedEl.style.display = tyrePanelOpen ? 'none' : 'flex';
        openEl.style.display = tyrePanelOpen ? 'block' : 'none';
    }

    // I quattro quadranti circolari del pannello stato vettura, uno per
    // componente. Sono costruiti da qui e non scritti a mano nell'HTML perche'
    // l'elenco dei componenti e' quello del server (F1Danni.COMPONENTI, che un
    // test tiene agganciato a DamageModel.createDamageParts): se un giorno se
    // ne aggiunge o toglie uno, qui se ne accorge subito invece di lasciare un
    // quadrante fermo a 0% per sempre.
    //
    // Le quattro posizioni seguono l'ordine di COMPONENTI: davanti-sinistra,
    // davanti-destra, dietro-sinistra, dietro-destra. Sono le stesse a cui
    // puntano le linee punteggiate disegnate nell'HTML.
    const QUADRANTI_POS = [
        { cx: 26, cy: 44 }, { cx: 210, cy: 44 },
        { cx: 26, cy: 200 }, { cx: 210, cy: 200 },
    ];
    const QUADRANTE_R = 22;

    function costruisciQuadranti() {
        const g = document.getElementById('hud-quadranti');
        if (!g) return;
        const NS = 'http://www.w3.org/2000/svg';
        const el = (tag, attrs) => {
            const n = document.createElementNS(NS, tag);
            for (const k in attrs) n.setAttribute(k, attrs[k]);
            return n;
        };
        F1Danni.COMPONENTI.forEach((c, i) => {
            const pos = QUADRANTI_POS[i];
            if (!pos) {
                console.warn('[f1] nessun posto nel pannello per il componente', c.chiave);
                return;
            }
            g.appendChild(el('circle', { class: 'v-pista', cx: pos.cx, cy: pos.cy, r: QUADRANTE_R }));

            const arco = el('path', { class: 'v-arco', id: 'arco-' + c.chiave });
            arco.dataset.cx = pos.cx; arco.dataset.cy = pos.cy; arco.dataset.r = QUADRANTE_R;
            g.appendChild(arco);

            const num = el('text', { class: 'v-num', x: pos.cx, y: pos.cy + 6, id: 'num-' + c.chiave });
            num.textContent = '0%';
            g.appendChild(num);

            const sigla = el('text', { class: 'v-sigla', x: pos.cx, y: pos.cy + QUADRANTE_R + 13 });
            sigla.textContent = c.breve;
            // Il nome per esteso resta raggiungibile col puntatore: la sigla da
            // sola ("SOSP") non basta a chi apre il pannello la prima volta.
            const titolo = document.createElementNS(NS, 'title');
            titolo.textContent = c.nome;
            sigla.appendChild(titolo);
            g.appendChild(sigla);
        });
    }
    costruisciQuadranti();

    // Quale mescola e' gia' disegnata nella riga in fondo: il disegno si
    // rigenera solo quando cambia davvero, non venti volte al secondo.
    let mescolaDisegnata = null;

    // Tutto il pannello in una funzione sola: gli stessi numeri colorano il
    // disegno dell'auto, i quadranti e i due quadratini dell'icona chiusa.
    function aggiornaStatoVettura(data) {
        const svg = document.getElementById('hud-vettura');
        if (!svg) return;
        const parti = data.damageParts || {};

        for (const c of F1Danni.COMPONENTI) {
            const v = Math.round(parti[c.chiave] || 0);
            const col = F1Danni.colore(v);
            const arco = document.getElementById('arco-' + c.chiave);
            if (arco) {
                arco.setAttribute('d', F1Danni.arco(v, +arco.dataset.cx, +arco.dataset.cy, +arco.dataset.r));
                arco.style.stroke = col;
            }
            const num = document.getElementById('num-' + c.chiave);
            if (num) num.textContent = v + '%';
            // La variabile CSS si chiama come il campo del server apposta:
            // niente tabella di traduzione da tenere allineata.
            svg.style.setProperty('--' + c.chiave, col);
        }

        const usura = Math.round(data.tyreWear || 0);
        svg.style.setProperty('--gomme', F1Danni.colore(usura));
        document.getElementById('tyre-wear-value').textContent = usura;

        // L'icona chiusa: il quadrato e' l'usura, il rombo compare solo se
        // qualcosa e' rotto.
        document.getElementById('tyre-icon-closed').style.background = F1Danni.colore(usura);
        const peggio = Math.round(F1Danni.peggiore(parti));
        const rombo = document.getElementById('damage-icon-closed');
        rombo.style.display = peggio > 0 ? 'inline-block' : 'none';
        rombo.style.background = F1Danni.colore(peggio);
    }

    // Mostra il giro CORRENTE che si sta guidando (convenzione vera F1: durante
    // l'ultimo giro di una gara a 3 giri si legge "3/3" per tutto il giro, non
    // "2/3" — altrimenti il traguardo finale sembra arrivare "un giro prima").
    // `completedLaps` è il conteggio di giri già completati (0 all'inizio);
    // in qualifica il totale è sempre 1 giro secco, mai quello della gara vera.
    function setLapDisplay(completedLaps, phaseName) {
        giroCorrente = completedLaps;   // unico punto in cui il giro cambia: lo intercetta anche per le segnalazioni
        const el = document.getElementById('lap-chip-value');
        // In qualifica non ha senso mostrare "1/1" (un solo giro secco non è
        // un rapporto giri/totale) — l'utente lo trovava fuorviante. Nota:
        // il pannello che contiene questo chip è visibile SOLO in gara
        // (vedi updateStandings), quindi questa scrittura in qualifica non
        // si vede mai — innocua, non serve un controllo in più per evitarla.
        if (phaseName === 'qualifying') {
            el.textContent = 'GIRO SECCO';
            return;
        }
        const current = Math.min(completedLaps + 1, raceTotalLaps);
        el.textContent = `${current}/${raceTotalLaps}`;
    }

    // Quanti giri prima della fine l'avviso della sosta diventa rosso. Uno
    // solo: è l'ultimo momento utile per rientrare senza restare fuori dalla
    // finestra dei box.
    const SOSTA_URGENTE_GIRI = 1;

    // Avviso "sosta obbligatoria": compare in gara finché il pit stop non è
    // fatto e sparisce appena lo si è fatto. Prima non esisteva niente del
    // genere e i 30 secondi di penalità si scoprivano solo nel pannello
    // finale, a gara conclusa — segnalato dall'utente il 2026-08-17: primo
    // sotto la bandiera a scacchi, ultimo in classifica.
    function aggiornaAvvisoSosta(data) {
        const chip = document.getElementById('pit-duty-chip');
        if (!chip) return;
        if (data.hasPitted || data.finished) { chip.style.display = 'none'; return; }
        chip.style.display = '';
        const giriRimasti = raceTotalLaps - (data.lap || 0);
        chip.classList.toggle('urgente', giriRimasti <= SOSTA_URGENTE_GIRI);
    }

    const serverState = {};
    const visualState = {};
    const otherCars = {};

    // Un box colorato per pilota lungo la corsia box (vedi
    // docs/superpowers/specs/2026-08-03-f1-pit-boxes-design.md). Caricato
    // pigramente al primo f1StateUpdate che porta un pitBoxSlot per quel
    // colore — non sincrono con la scenografia statica (sceneryLayout più
    // sopra), perché lo stato dei giocatori non è ancora noto in quel punto
    // del caricamento pagina.
    const pitBoxes = {};
    const pendingPitBoxLoads = new Set();
    // Guardia SEPARATA da pitBoxes/pendingPitBoxLoads (quelle riguardano
    // solo il modello 3D del garage, caricato in modo asincrono e con
    // retry su errore): la segnaletica a terra è sincrona e non fallisce
    // mai, ma non deve comunque essere aggiunta più volte alla scena ad
    // ogni f1StateUpdate.
    const stallMarkersAdded = new Set();

    // Il server manda già l'anchor calcolato (assignGridSpawns →
    // TrackGeometry.pitBoxAnchors), il client si limita a posizionare/
    // ruotare il modello: niente più bisogno di ricalcolare/duplicare la
    // stessa geometria lato client, niente più rischio di disallineamento
    // se il conteggio giocatori cambia a gara in corso (prima si
    // ricalcolava da pitBoxSlot + Object.keys(state).length, che poteva
    // divergere dall'N usato lato server in assignGridSpawns dopo una
    // rimozione mid-race — game.grid non viene mai potato — causando un
    // box disallineato o, peggio, un accesso fuori indice che mandava in
    // eccezione l'handler f1StateUpdate — bug trovato dalla review finale).
    function loadPlayerPitBox(color, anchor) {
        if (pitBoxes[color] || pendingPitBoxLoads.has(color)) return;
        pendingPitBoxLoads.add(color);

        const nx = -anchor.tz, nz = anchor.tx;   // normale, perpendicolare alla tangente della corsia

        // Stessa tecnica di trackScenery.js::buildPaddockLayout: tra le due
        // direzioni normali, si sceglie quella che allontana di più dal
        // centro del circuito (lato "verso l'esterno").
        const distPlus = TrackGeometry.nearestPoint(trackPts, anchor.x + nx, anchor.z + nz).dist;
        const distMinus = TrackGeometry.nearestPoint(trackPts, anchor.x - nx, anchor.z - nz).dist;
        const side = distPlus >= distMinus ? 1 : -1;

        // PitBoxLoader.PIT_BOX_OFFSET_MARGIN (non TrackScenery.PIT_BUILDING_OFFSET_MARGIN,
        // tarato sui piccoli edifici decorativi Kenney): il box giocatore
        // reale è molto più grande, serve un margine che tenga conto del
        // suo ingombro misurato — vedi commento in pitBoxLoader.js.
        const offset = trackData.pit.roadHalfWidth + PitBoxLoader.PIT_BOX_OFFSET_MARGIN;
        const bx = anchor.x + nx * offset * side, bz = anchor.z + nz * offset * side;
        const rotY = Math.atan2(anchor.x - bx, anchor.z - bz);   // guarda verso la corsia

        // Segnaletica a terra dello stallo (Rif. richiesta utente
        // 2026-08-07: "stalli veri" come in F1 reale, non solo il modello
        // del garage) — rettangolo colorato del pilota, piazzato sullo
        // stesso stallo dove si ferma davvero l'auto (anchor.stallX/stallZ,
        // già calcolato server-side da TrackGeometry.pitBoxAnchors),
        // orientato con l'asse lungo parallelo alla corsia (stessa
        // convenzione rotY di un'auto: atan2(tangente.x, tangente.z)) — la
        // macchina si ferma parallela al senso di marcia, non più diagonale
        // verso il garage. Guardia SEPARATA dal modello 3D (sincrona, non
        // fallisce mai): un retry del modello dopo un errore di rete non
        // deve ri-aggiungere una segnaletica duplicata.
        if (!stallMarkersAdded.has(color) && anchor.stallX != null && anchor.stallZ != null) {
            const marker = new THREE.Mesh(
                new THREE.BoxGeometry(PitBoxLoader.STALL_WIDTH, 0.03, PitBoxLoader.STALL_LENGTH),
                new THREE.MeshStandardMaterial({ color: parseInt(color.replace('#', ''), 16), roughness: 0.9, transparent: true, opacity: 0.55 })
            );
            marker.position.set(anchor.stallX, 0.04, anchor.stallZ);
            marker.rotation.y = Math.atan2(anchor.tx, anchor.tz);
            // Segnaletica col colore del pilota: stessa saturazione dell'auto,
            // così resta riconoscibile. Senza conversione sarebbe l'unico
            // oggetto della scena ancora illuminato in modo realistico.
            applicaStile(marker, { saturation: ToonPalette.SATURATION.car });
            scene.add(marker);
            stallMarkersAdded.add(color);

            // Meccanici davanti al box (Rif. richiesta utente 2026-08-09: gli
            // asset erano modellati ma non li usava nessuno). Modelli
            // indipendenti e non InstancedMesh: sono cinque per box, pochi, e
            // seguono lo stesso ciclo di vita della segnaletica. Stanno dentro
            // la guardia stallMarkersAdded proprio per questo: senza, ogni
            // f1StateUpdate ne aggiungerebbe altri cinque sopra i precedenti.
            for (const crew of PitBoxLoader.crewPlacements({ x: bx, y: 0, z: bz, rotY })) {
                new THREE.GLTFLoader().load(`/assets/custom/circuit/${crew.asset}.glb`, (gltf) => {
                    gltf.scene.position.set(crew.x, crew.y, crew.z);
                    gltf.scene.rotation.y = crew.rotY;
                    gltf.scene.scale.setScalar(crew.scale || 1);
                    gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
                    applicaStile(gltf.scene);
                    scene.add(gltf.scene);
                }, undefined, (err) => console.error(`[F1] Errore caricando ${crew.asset}.glb:`, err));
            }
        }

        PitBoxLoader.loadPitBoxModel(color, { x: bx, y: 0, z: bz, rotY }, (model) => {
            applicaStile(model);
            scene.add(model);
            pitBoxes[color] = model;
            pendingPitBoxLoads.delete(color);
        }, () => {
            pendingPitBoxLoads.delete(color);   // permette un nuovo tentativo al prossimo state update (vedi pitBoxLoader.js)
        });
    }

    // Livrea VERA di ogni avversario (bug reale: prima si applicava sempre
    // TEST_LIVERY_COLORS, cioè la propria, a tutte le auto altrui). Cache per
    // uid: più colori/rejoin possono condividere lo stesso uid nel tempo, un
    // solo fetch basta. pendingCarLoads evita doppio loadCarModel per lo
    // stesso colore mentre il fetch è ancora in volo (il player object arriva
    // ad ogni tick, ~20Hz, ben prima che GLTF+livrea siano pronti).
    const liveryCacheByUid = new Map();   // uid -> Promise<livery|null>
    const pendingCarLoads = new Set();    // color attualmente in caricamento

    function fetchLiveryForUid(uid) {
        if (!uid) return Promise.resolve(null);
        if (!liveryCacheByUid.has(uid)) {
            liveryCacheByUid.set(uid, fetch(`/api/livery/${uid}`)
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null));
        }
        return liveryCacheByUid.get(uid);
    }

    // Carica l'auto di un avversario con la SUA livrea vera. Se uid è null
    // (bot/ospite) o non ha nulla di salvato, livery resta null: CarLoader
    // colora la carrozzeria col colore scelto in lobby (color), MAI con una
    // fixture condivisa (produceva la stessa livrea per tutti i bot/ospiti)
    // e MAI con TEST_LIVERY_COLORS (che è la livrea di chi guarda, non un default).
    async function loadOtherCar(color, uid, onReady) {
        if (otherCars[color] || pendingCarLoads.has(color)) return;
        pendingCarLoads.add(color);
        const livery = await fetchLiveryForUid(uid);
        if (otherCars[color]) { pendingCarLoads.delete(color); return; }   // creata nel frattempo
        loadCarModel(color, (g) => {
            pendingCarLoads.delete(color);
            onReady(g);
        }, livery);
    }

    // Motore: per ogni auto (mia e altrui) approssimo "sta
    // accelerando/decelerando" da una variazione di velocità rispetto
    // all'ultimo valore osservato — vale anche per me: se rilascio
    // l'acceleratore e la velocità scende per attrito, senza frenare, è
    // comunque una decelerazione udibile. Finestra di "tenuta"
    // (ENGINE_ACTIVE_HOLD_MS) più lunga del tick server (50ms) per non far
    // sfarfallare il suono tra un aggiornamento e l'altro dello stato di
    // rete. Niente più cambio marcia sonoro: il clunk sintetizzato (onda
    // quadra) stonava col nuovo motore reale e veniva percepito come un
    // "colpo" indesiderato — rimosso su richiesta dell'utente.
    const engineActiveSince = {};
    const engineLastCheckedSpeed = {};
    const engineAccelerating = {};
    const ENGINE_ACTIVE_HOLD_MS = 400;
    const ENGINE_SPEED_DELTA_EPS = 0.02;

    // ====================================================
    // DEBUG: hitbox visibili (tasto H) — stessi valori di CAR_HALF_LENGTH/
    // CAR_HALF_WIDTH lato server. Posizionate sulla posizione REALE del
    // server (serverState), non su quella interpolata (visualState), per
    // poter verificare a occhio eventuali disallineamenti tra fisica e resa.
    // ====================================================
    const HITBOX_HALF_LEN = 3.58, HITBOX_HALF_WID = 1.74, HITBOX_HEIGHT = 1.5;
    let showHitboxes = false;  // toggle con H, debug only
    const hitboxMeshes = {};

    function getHitboxMesh(color) {
        if (hitboxMeshes[color]) return hitboxMeshes[color];
        const geo = new THREE.BoxGeometry(HITBOX_HALF_WID * 2, HITBOX_HEIGHT, HITBOX_HALF_LEN * 2);
        const edges = new THREE.EdgesGeometry(geo);
        const mat = new THREE.LineBasicMaterial({ color: color === myColor ? 0x00ff00 : 0xff0000 });
        const mesh = new THREE.LineSegments(edges, mat);
        mesh.position.y = HITBOX_HEIGHT / 2;
        scene.add(mesh);
        hitboxMeshes[color] = mesh;
        return mesh;
    }

    // ====================================================
    // SELEZIONE MESCOLA
    // ====================================================
    let tyreSelectActive = false;   // true mentre siamo in fase tyre_select: la camera orbita sul tracciato
    // I numeri veri di QUESTA pista, mandati dal server: quanto l'asfalto
    // mangia le gomme e quanti giri dura ogni mescola. Servono a decidere se
    // fermarsi una volta o due — cioe' a calcolare un under-cut. Rif.
    // docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md
    let abrasivitaPista = 1;
    let giriMescolaPista = null;
    let tyreOrbitAngle = 0;
    let myCompoundChoice = null;
    let tyreCompoundsInfo = null;   // { hard:{...}, medium:{...}, soft:{...} }, ricevuto una volta in f1Setup

    // ── Carosello dell'anteprima ────────────────────────────────────────
    // Sostituisce l'orbita di prima, che girava attorno a (50, 0, 100): un
    // punto scritto nel codice, che su "prova" cade a 828 unità dal circuito
    // e su "baku" a 584. La camera guardava un pezzo di prato vuoto — è il
    // motivo per cui l'anteprima non mostrava niente di interessante.
    //
    // Ora si passa fra le inquadrature calcolate da TrackPreviewShots
    // (traguardo, curva più stretta, rettilineo, ponte, corsia box, veduta
    // aerea), ognuna con una lenta deriva e uno stacco in dissolvenza.
    const veloScatto = document.getElementById('tyre-shot-fade');
    const etichettaScatto = document.getElementById('tyre-shot-label');
    const STACCO_MS = 420;   // dissolvenza al nero a inizio e fine di ogni scatto
    let scattoCorrente = 0;
    let scattoDa = 0;        // performance.now() dell'inizio dello scatto in corso

    function misto(a, b, t) { return a + (b - a) * t; }

    function mostraScatto(s) {
        if (etichettaScatto) etichettaScatto.textContent = s.etichetta;
    }

    // ── Panoramica del riepilogo griglia ────────────────────────────────
    // Riusa le inquadrature già calcolate, ma NON il carosello: qui serve un
    // fondale, non un montaggio. Una sola inquadratura — la veduta aerea sul
    // traguardo, che è già l'apertura del carosello — percorsa lentamente per
    // tutta la durata del pannello, senza stacchi che distrarrebbero dalla
    // lettura della griglia.
    //
    // A differenza della scelta mescole si renderizza a TUTTO SCHERMO: lì
    // l'anteprima sta dentro un riquadro del pannello, qui il circuito è lo
    // sfondo e il pannello ci sta sopra.
    // ── Piano vicino delle camere lontane ───────────────────────────────
    // In gara la camera sta a pochi metri dall'auto e serve un near piccolo.
    // Le camere che guardano il circuito da lontano (carosello della scelta
    // mescole, panoramica del riepilogo griglia) con quel near non reggono:
    //
    //   near 0.1 -> risoluzione in profondità 0.037 a 250 unità, 0.061 a 320
    //   near 2   ->                           0.0019            0.0030
    //
    // L'asfalto sta 0.02 sopra l'impalcato e il cordolo 0.04 sopra la pista:
    // col near di gioco il buffer di profondità non riesce a distinguerli e
    // le superfici si contendono il pixel — è lo "sfarfallio" segnalato in
    // playtest, prima sulla schermata mescole e poi di nuovo sul riepilogo.
    // Nulla di visibile sta entro 2 unità dalle camere del carosello.
    const PREVIEW_NEAR = 2;
    const nearDiGioco = camera.near;

    // Piano vicino della panoramica. Stesso problema del carosello della
    // scelta mescole — lo sfarfallio delle superfici di pista — e stessa
    // cura, ma con un margine più largo perché questa camera è messa peggio:
    // sta a 155 unità di quota e vede il circuito FINO IN FONDO, mentre le
    // inquadrature del carosello si fermano a 320 (DISTANZA_UTILE).
    //
    // Risoluzione del buffer di profondità (24 bit) alla distanza z:
    //
    //   near 0.1 -> 0.037 a 250 unità   0.60 a 1000
    //   near 2   -> 0.0019              0.030
    //   near 4   -> 0.00093             0.015
    //
    // Le superfici da distinguere sono l'asfalto 0.02 sopra l'impalcato del
    // ponte e il cordolo 0.04 sopra la pista: col near di gioco il buffer non
    // ci arriva nemmeno da vicino e le due si contendono il pixel. Con 4 il
    // margine regge anche sui tratti lontani, e sopra questa camera non c'è
    // nulla entro 4 unità — è a 155 metri d'aria.
    const PANORAMICA_NEAR = 4;

    let panoramicaAttiva = false;
    let panoramicaDa = 0;
    let panoramicaDurata = 1;

    function avviaPanoramica(durataMs) {
        panoramicaDa = performance.now();
        panoramicaDurata = Math.max(1, durataMs || 1);
        panoramicaAttiva = true;
        camera.near = PANORAMICA_NEAR;
        camera.updateProjectionMatrix();
    }

    function fermaPanoramica() {
        if (!panoramicaAttiva) return;
        panoramicaAttiva = false;
        // Il near di gioco va rimesso SEMPRE: in gara la camera sta a pochi
        // metri dall'auto e con un near di 4 le si vedrebbe dentro il muso.
        camera.near = nearDiGioco;
        camera.updateProjectionMatrix();
    }

    function scattoPanoramica() {
        if (!anteprimaScatti.length) return null;
        return anteprimaScatti.find(s => s.id === 'panoramica') || anteprimaScatti[0];
    }

    function aggiornaCameraPanoramica() {
        const s = scattoPanoramica();
        if (!s) {
            // Nessuna inquadratura (tracciato degenere): orbita di scorta sul
            // centro vero del circuito, come fa la scelta mescole.
            tyreOrbitAngle += 0.0018;
            const c = TrackPreviewShots.ingombro(trackPts);
            const r = Math.max(150, c.diagonale * 0.3);
            camera.position.set(c.cx + Math.cos(tyreOrbitAngle) * r, r * 0.7, c.cz + Math.sin(tyreOrbitAngle) * r);
            camera.lookAt(c.cx, 0, c.cz);
            return;
        }
        const t = Math.min(1, (performance.now() - panoramicaDa) / panoramicaDurata);
        const e = t * t * (3 - 2 * t);   // parte e finisce piano
        camera.position.set(misto(s.cam.x, s.camFine.x, e),
                            misto(s.cam.y, s.camFine.y, e),
                            misto(s.cam.z, s.camFine.z, e));
        camera.lookAt(misto(s.target.x, s.targetFine.x, e),
                      misto(s.target.y, s.targetFine.y, e),
                      misto(s.target.z, s.targetFine.z, e));
    }

    function updateTyreSelectCamera() {
        // Tracciato senza inquadrature (caso degenere): orbita di scorta, ma
        // sul centro VERO del circuito, non più su un punto fisso.
        if (!anteprimaScatti.length) {
            tyreOrbitAngle += 0.0022;
            const c = TrackPreviewShots.ingombro(trackPts);
            const r = Math.max(150, c.diagonale * 0.3);
            camera.position.set(c.cx + Math.cos(tyreOrbitAngle) * r, r * 0.7, c.cz + Math.sin(tyreOrbitAngle) * r);
            camera.lookAt(c.cx, 0, c.cz);
            return;
        }

        // Il conto alla rovescia vive qui: questa funzione gira ad ogni frame
        // finché la schermata è aperta, quindi non serve un timer a parte
        // (che poi andrebbe fermato all'uscita, ed è il tipo di cosa che ci
        // si dimentica).
        aggiornaContoPartenza();

        const ora = performance.now();
        if (!scattoDa) { scattoDa = ora; mostraScatto(anteprimaScatti[0]); }

        const s = anteprimaScatti[scattoCorrente];
        const trascorso = ora - scattoDa;
        const t = Math.min(1, trascorso / s.durata);
        const e = t * t * (3 - 2 * t);   // la deriva parte e finisce piano

        camera.position.set(misto(s.cam.x, s.camFine.x, e),
                            misto(s.cam.y, s.camFine.y, e),
                            misto(s.cam.z, s.camFine.z, e));
        camera.lookAt(misto(s.target.x, s.targetFine.x, e),
                      misto(s.target.y, s.targetFine.y, e),
                      misto(s.target.z, s.targetFine.z, e));

        if (veloScatto) {
            // Nero pieno allo stacco, trasparente in mezzo: senza, la camera
            // sembrerebbe teletrasportarsi da un punto all'altro del circuito.
            const restante = s.durata - trascorso;
            const nero = Math.max(0, Math.max(1 - trascorso / STACCO_MS, 1 - restante / STACCO_MS));
            veloScatto.style.opacity = Math.min(1, nero).toFixed(3);
        }

        if (t >= 1) {
            scattoCorrente = (scattoCorrente + 1) % anteprimaScatti.length;
            scattoDa = ora;
            mostraScatto(anteprimaScatti[scattoCorrente]);
        }
    }

    // Riparenta il canvas dentro la cornice della selezione mescola e lo
    // ridimensiona a quella: un vero modellino contenuto, non la scena a
    // schermo intero vista in trasparenza dietro l'overlay.
    function enterTyrePreview() {
        const frame = document.getElementById('tyre-preview-frame');
        if (renderer.domElement.parentElement !== frame) frame.appendChild(renderer.domElement);
        renderer.domElement.classList.add('tyre-preview-canvas');
        const w = frame.clientWidth, h = frame.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.near = PREVIEW_NEAR;
        camera.updateProjectionMatrix();
        // Il buffer dei contorni NON si adegua da solo (ToonOutline.render non
        // rilegge la dimensione): senza questa riga resta grande quanto la
        // finestra mentre il canvas è la cornice dell'anteprima, e il tratto
        // nero finisce spostato rispetto all'immagine. Stessa ragione per cui
        // la chiama il gestore di resize.
        ToonOutline.setSize(renderer);
        // Il carosello riparte dalla prima inquadratura ad ogni ingresso: la
        // scelta mescola ricompare anche ai box, e riprendere da metà di uno
        // scatto vecchio mostrerebbe un pezzo di circuito a caso.
        scattoCorrente = 0;
        scattoDa = 0;
    }

    function exitTyrePreview() {
        if (renderer.domElement.parentElement !== document.body) document.body.appendChild(renderer.domElement);
        renderer.domElement.classList.remove('tyre-preview-canvas');
        renderer.setSize(window.innerWidth, window.innerHeight);
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.near = nearDiGioco;
        camera.updateProjectionMatrix();
        ToonOutline.setSize(renderer);
        if (veloScatto) veloScatto.style.opacity = '0';
        mescoleScadeA = null;   // la scelta è chiusa: il conto non ha più senso
    }

    // Una riga per pilota atteso, con il suo stato. Sostituisce il vecchio
    // contatore "1/2 pronti", che diceva che si stava aspettando ma non CHI:
    // con un pilota ancora fermo sul caricamento della pista, quel numero era
    // indistinguibile da un problema della propria connessione.
    // `attesi` arriva dal server (fotografia della lobby al via); se manca —
    // partita vecchia, server non aggiornato — si ricade sul contatore.
    // Finestra di cortesia di fine gara: si continua a girare mentre i bot
    // ancora in pista provano a tagliare il traguardo, così prendono il tempo
    // vero invece di quello proiettato. Il server manda quanto resta, il conto
    // lo tiene il client (gli orologi dei due capi non coincidono).
    let fineGaraScadeA = null;
    let fineGaraUltimoSec = null;

    function aggiornaContoFineGara() {
        const el = document.getElementById('quali-waiting-conto');
        if (!el) return;
        if (fineGaraScadeA == null) {
            if (fineGaraUltimoSec !== null) { el.textContent = ''; fineGaraUltimoSec = null; }
            return;
        }
        const sec = Math.max(0, Math.ceil((fineGaraScadeA - performance.now()) / 1000));
        if (sec === fineGaraUltimoSec) return;
        fineGaraUltimoSec = sec;
        el.textContent = `Si chiude fra ${sec} s · INVIO per chiudere subito`;
    }

    socket.on('f1RaceGrace', ({ restaMs }) => {
        fineGaraScadeA = performance.now() + (restaMs || 0);
        fineGaraUltimoSec = null;
    });

    // Scadenza della scelta mescola, in tempo LOCALE: il server manda quanto
    // resta (non l'istante), perché i due orologi non coincidono. Da qui in
    // poi il conto lo tiene il client, aggiornato dentro il ciclo di
    // rendering — nessun timer da creare e da ricordarsi di fermare.
    let mescoleScadeA = null;
    let mescoleUltimoSec = null;

    function aggiornaContoPartenza() {
        const el = document.getElementById('tyre-countdown');
        if (!el) return;
        if (mescoleScadeA == null) {
            if (mescoleUltimoSec !== null) { el.textContent = '—'; mescoleUltimoSec = null; }
            return;
        }
        const sec = Math.max(0, Math.ceil((mescoleScadeA - performance.now()) / 1000));
        if (sec === mescoleUltimoSec) return;   // una scrittura al secondo, non 60
        mescoleUltimoSec = sec;
        el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        el.classList.toggle('in-scadenza', sec <= 10);
    }

    // Le informazioni del circuito nella colonna di sinistra: numeri veri,
    // calcolati dalla stessa geometria che il server usa per la gara (vedi
    // shared/f1ProfiloCircuito.js, e il test che verifica che i giri mostrati
    // qui siano quelli che la gara fara' davvero).
    function renderInfoCircuito() {
        const el = (id) => document.getElementById(id);
        if (!el('tyre-info-giri')) return;
        const profilo = F1ProfiloCircuito.profilo(trackPts, trackData.targetKm || 10);
        // I giri li decide il server: se li ha già mandati si usano i suoi, e il
        // calcolo locale resta solo per il caso in cui la schermata apra prima.
        const giri = raceTotalLaps || profilo.giri;
        el('tyre-info-giri').textContent = giri;
        el('tyre-info-distanza').innerHTML =
            (profilo.lunghezzaKm * giri).toFixed(1) + '<span class="unita">km</span>';
        el('tyre-info-lunghezza').innerHTML =
            profilo.lunghezzaKm.toFixed(3) + '<span class="unita">km</span>';
        // In parole e non come numero: "1.35" non dice niente a nessuno, e il
        // valore esatto non e' un'informazione che serve al giocatore. Gli
        // serve sapere se questa pista chiede una sosta o due — e quello
        // glielo dicono i giri sulle card, qui accanto.
        const elAbr = el('tyre-info-abrasivita');
        if (elAbr) {
            const scala = [[0.85, 'Dolce'], [1.15, 'Media'], [Infinity, 'Aggressiva']];
            elAbr.textContent = scala.find(([soglia]) => abrasivitaPista < soglia)[1];
        }

        const NOMI = {
            trazione: 'Trazione',
            stress: 'Stress gomme',
            frenata: 'Frenata',
            caricoAero: 'Carico aero',
        };
        const box = el('tyre-barrette');
        box.innerHTML = '';
        for (const [chiave, nome] of Object.entries(NOMI)) {
            const voto = profilo.barrette[chiave];
            const riga = document.createElement('div');
            riga.className = 'mescole-barretta';
            const tacche = [1, 2, 3, 4, 5]
                .map(i => `<span class="mescole-tacca${i <= voto ? ' accesa' : ''}"></span>`).join('');
            riga.innerHTML = `<span class="mescole-barretta-nome">${nome}</span>`
                + `<span class="mescole-tacche" role="img" aria-label="${nome}: ${voto} su 5">${tacche}</span>`;
            box.appendChild(riga);
        }
    }

    function renderAttesaMescole(dati) {
        const box = document.getElementById('tyre-confirm-status');
        if (!box || !dati) return;
        if (dati.restaMs != null) {
            mescoleScadeA = performance.now() + dati.restaMs;
            mescoleUltimoSec = null;   // forza la riscrittura al prossimo frame
        }
        const attesi = dati.attesi || [];
        if (!attesi.length) {
            box.textContent = `${dati.count || 0}/${dati.total || 1} pronti`;
            return;
        }

        // Una FILA DI PALLINI, uno per pilota, bot compresi. Niente pillole con
        // il testo accanto: erano un elenco travestito, e in una gara da otto
        // occupavano mezza colonna. Chi non ha ancora scelto resta spento —
        // l'unica differenza è quanto il pallino è acceso, che si legge di
        // sfuggita anche senza sapere cosa significhi.
        //
        // Sotto il proprio pallino c'è scritto "Tu": è l'unica etichetta che
        // serve, perché è l'unica cosa che il colore da solo non dice a chi non
        // ricorda di che colore è.
        const confermati = new Set(dati.confermati || []);
        box.innerHTML = '';
        for (const color of attesi) {
            const cella = document.createElement('div');
            cella.className = 'tyre-pilota' + (confermati.has(color) ? ' is-pronto' : '');
            const pallino = document.createElement('span');
            pallino.className = 'tyre-pilota-dot';
            pallino.style.background = color;
            pallino.title = confermati.has(color) ? 'ha scelto' : 'sta scegliendo';
            cella.appendChild(pallino);
            if (color === myColor) {
                const io_ = document.createElement('span');
                io_.className = 'tyre-pilota-io';
                io_.textContent = 'Tu';
                cella.appendChild(io_);
            }
            box.appendChild(cella);
        }
    }

    // Riusata sia per la selezione mescola pre-qualifica sia per il cambio
    // gomme ai box (containerId/eventName diversi, stessa presentazione).
    function renderTyreCards(compounds, myCompound, containerId, eventName, giriPerMescola) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        let myIndex = 0, i = 0;
        for (const key of ['hard', 'medium', 'soft']) {
            const c = compounds[key];
            if (!c) continue;
            const card = document.createElement('div');
            card.className = 'tyre-card' + (myCompound === key ? ' selected' : '');
            // Raggiungibile da tastiera: finora si sceglieva solo col mouse o
            // col pad. Solo Invio e non anche la barra spaziatrice, che nel
            // gioco è già la reazione al pit stop.
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); card.click(); } };
            // Lo pneumatico disegnato al posto del pallino colorato: è la
            // richiesta esplicita dell'utente sul riferimento Pirelli, «voglio
            // quella stessa rappresentazione, voglio vederli così». Il colore
            // della fascia esce dalla stessa tabella del server, non da una
            // copia qui.
            card.style.setProperty('--mescola', c.color);
            const segno = (v) => (v >= 1 ? '+' : '') + Math.round((v - 1) * 100) + '%';
            // "Usura 1.5×" e' un moltiplicatore astratto; "dura ~3 giri" e' la
            // cosa con cui si decide una strategia. Se il server non ha ancora
            // mandato i giri (schermata aperta prima del payload) si torna al
            // moltiplicatore, che e' sempre vero.
            const giri = giriPerMescola && giriPerMescola[key];
            const durata = giri ? `Dura <b>~${giri} giri</b>` : `Usura <b>${c.wearRate}×</b>`;
            card.innerHTML = F1Pneumatico.svg(key, c.color, { titolo: `Mescola ${c.label}` })
                + `<div>
                    <div class="tyre-card-label">${c.label.toUpperCase()}</div>
                    <div class="tyre-card-stats">
                        Velocità <b>${segno(c.speedMult)}</b> · Aderenza <b>${segno(c.gripMult)}</b><br>
                        ${durata}
                    </div>
                </div>`;
            card.onclick = () => {
                if (eventName === 'f1TyreChoice') myCompoundChoice = key;
                socket.emit(eventName, { lobbyId, playerColor: myColor, compound: key });
                container.querySelectorAll('.tyre-card').forEach(el => el.classList.remove('selected'));
                card.classList.add('selected');
                anime({
                    targets: card,
                    scale: [1, 1.12, 1],
                    duration: 320,
                    easing: 'easeOutElastic(1, 0.6)',
                });
            };
            container.appendChild(card);
            if (myCompound === key) myIndex = i;
            i++;
        }
        // Abilita la navigazione da gamepad (D-pad sx/dx + X) su questo
        // container: diventa quello "attivo" finché non se ne apre un altro
        // o viene esplicitamente disattivato (vedi clearTyreNav()).
        activeTyreContainerId = containerId;
        tyreFocusIndex = myIndex;
        _applyTyreFocus();

        // Ingresso a cascata: le card compaiono una dopo l'altra invece di
        // tutte insieme, ogni volta che questa funzione viene chiamata
        // (apertura schermo scelta iniziale o pannello ai box).
        anime({
            targets: container.querySelectorAll('.tyre-card'),
            translateY: [16, 0],
            opacity: [0, 1],
            delay: anime.stagger(90),
            duration: 320,
            easing: 'easeOutQuad',
        });
    }

    // ── Navigazione mescola da gamepad ──────────────────────────────────
    let activeTyreContainerId = null;
    let tyreFocusIndex = 0;

    function _tyreCards() {
        if (!activeTyreContainerId) return [];
        const container = document.getElementById(activeTyreContainerId);
        return container ? Array.from(container.querySelectorAll('.tyre-card')) : [];
    }

    function _applyTyreFocus() {
        // L'anello di focus ha senso solo con un gamepad davvero collegato:
        // senza questo controllo, tyreFocusIndex parte comunque da 0 (prima
        // card, "hard") e finiva applicato SEMPRE, anche da tastiera/mouse —
        // bordo giallo fisso sulla prima mescola segnalato dall'utente.
        const gpActive = typeof F1GamepadInput !== 'undefined' && F1GamepadInput.isConnected();
        const cards = _tyreCards();
        cards.forEach((el, idx) => el.classList.toggle('gp-focused', gpActive && idx === tyreFocusIndex));
    }

    function tyreNav(delta) {
        const cards = _tyreCards();
        if (cards.length === 0) return;
        tyreFocusIndex = (tyreFocusIndex + delta + cards.length) % cards.length;
        _applyTyreFocus();
    }

    function tyreConfirm() {
        const cards = _tyreCards();
        if (cards[tyreFocusIndex]) cards[tyreFocusIndex].click();
    }

    function clearTyreNav() {
        activeTyreContainerId = null;
    }

    // ====================================================
    // PIT STOP — autopilota ingresso/uscita + minigioco di reazione
    // (pannello visibile SOLO al pilota in visita ai box: gli eventi sotto
    // arrivano solo al SUO socket, il server non fa broadcast alla lobby).
    // Il pannello resta aperto per TUTTA la visita — dall'ingresso (mentre
    // l'auto guida da sola verso il box: qui si sceglie la mescola) fino
    // all'uscita — non solo durante il minigioco.
    // ====================================================
    let pitting = false;   // true SOLO durante la sosta vera e propria (minigioco attivo)

    // Pulsante "Ripara danni" (stile tyre-card: bagliore verde = selezionato),
    // niente più checkbox — un checkbox col focus si deseleziona da solo alla
    // pressione di Spazio (usato per la reazione pit), inoltre l'utente
    // voleva uno stile coerente con gli altri pulsanti del pannello.
    // Funzione condivisa: la richiama sia il click sia il tasto R1 da
    // controller (vedi F1GamepadInput.setCallbacks/onRepairToggle sotto).
    function toggleRepairChoice() {
        const repairToggle = document.getElementById('pitstop-repair-toggle');
        const repairBtn = document.getElementById('pitstop-repair-btn');
        if (!repairToggle || !repairBtn || repairToggle.style.display === 'none') return;
        const nowSelected = !repairBtn.classList.contains('selected');
        repairBtn.classList.toggle('selected', nowSelected);
        socket.emit('f1PitRepairChoice', { lobbyId, playerColor: myColor, repair: nowSelected });
    }

    // I due cronometri della corsia box: da quando si e' entrati, e quanto sta
    // durando la sosta. Il secondo si ferma sul valore finale invece di
    // continuare a correre — e' un risultato, non un orologio.
    let pitCorsiaDa = null;
    let pitSostaDa = null;
    let pitSostaDurata = null;

    function aggiornaTempiCorsia() {
        if (pitCorsiaDa == null) return;
        const ora = performance.now();
        const totale = document.getElementById('pl-totale');
        const sosta = document.getElementById('pl-sosta');
        if (totale) totale.textContent = ((ora - pitCorsiaDa) / 1000).toFixed(1);
        if (sosta) {
            const t = pitSostaDa == null ? 0
                : (pitSostaDurata != null
                    ? Math.min(ora - pitSostaDa, pitSostaDurata)
                    : ora - pitSostaDa);
            sosta.textContent = (t / 1000).toFixed(1);
        }
    }

    // ── Il muro del gioco di reazione ai box ────────────────────────────────
    //
    // Un pannello verticale semi-trasparente piantato di traverso nella corsia,
    // che si attraversa: si preme nell'istante in cui il muso lo passa. Sopra ci
    // sono il conto alla rovescia e il tasto da premere, e una freccia che
    // indica dove sta il punto.
    //
    // La prima versione erano tre bande dipinte per terra, bocciate al playtest:
    // «le bande sono tipo trasversali all'andamento della corsia» — a terra e in
    // scorcio non si capiva dove finisse una e cominciasse l'altra, mentre un
    // muro verticale lo si vede arrivare da lontano e attraversare è un evento
    // netto. È il modello del gioco ufficiale.
    //
    // Il testo sta su una TEXTURE e non in un pannello HTML: deve essere nel
    // mondo, in prospettiva, a quella distanza — un riquadro fisso sullo schermo
    // racconterebbe un'altra cosa. Si ridisegna dieci volte al secondo, non a
    // ogni frame: il conto alla rovescia ha un decimale, e oltre non cambia
    // niente da vedere.
    let pitMuro = null;

    // I colori dei tre esiti, in un posto solo: li usano il muro quando dà il
    // VERDETTO — a reazione avvenuta, non prima — e il pannello che lo ripete a
    // sosta iniziata. Fucsia per la perfetta perché è l'unico dei tre che non si
    // confonde con nient'altro in pista: il verde è già dei cordoli e dei tempi
    // migliori, il rosso dei danni.
    const ESITO_COLORE = {
        perfetta: { rgb: '236, 64, 172', css: '#ec40ac' },
        buona:    { rgb: '46, 204, 113', css: 'var(--green, #2ecc71)' },
        lenta:    { rgb: '231, 76, 60',  css: 'var(--red, #e74c3c)' },
    };

    const MURO_ALTEZZA = 4.6;
    const MURO_TEXTURE_W = 512;
    const MURO_TEXTURE_H = 236;

    function disegnaTexturaMuro(ctx, { secondi, esito, acceso, verdetto }) {
        const w = MURO_TEXTURE_W, h = MURO_TEXTURE_H;
        ctx.clearRect(0, 0, w, h);

        // Fondo: più acceso in basso, dove il muro tocca l'asfalto.
        //
        // Avvicinandosi il muro è azzurro e si ACCENDE di verde quando il muso
        // entra nella finestra perfetta: è il segnale di "adesso", e serve a non
        // dover leggere il numero che scorre. A reazione avvenuta prende invece
        // il colore del verdetto. Le due cose sono separate apposta — colorare
        // anche l'avvicinamento con l'esito previsto è stato provato e bocciato:
        // un muro che cambia tinta in continuazione mentre si arriva racconta
        // troppo, e quello che serve sapere prima è solo "adesso o non ancora".
        const colore = verdetto
            ? (ESITO_COLORE[esito] || ESITO_COLORE.lenta).rgb
            : (acceso ? ESITO_COLORE.buona.rgb : '80, 210, 240');
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, `rgba(${colore}, ${acceso ? 0.24 : 0.12})`);
        grad.addColorStop(1, `rgba(${colore}, ${acceso ? 0.66 : 0.44})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Montanti e traversa: danno al pannello un bordo da cui leggere la
        // profondità, che un rettangolo sfumato da solo non ha.
        ctx.strokeStyle = `rgba(${colore}, 0.95)`;
        ctx.lineWidth = 7;
        ctx.strokeRect(4, 4, w - 8, h - 8);

        if (verdetto) {
            ctx.fillStyle = `rgba(${colore}, 1)`;
            ctx.font = 'bold 74px Fredoka, Trebuchet MS, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(esito.toUpperCase(), w / 2, h / 2);
            return;
        }

        // La freccia: indica il verso di marcia, cioè verso l'osservatore.
        ctx.fillStyle = `rgba(${colore}, 0.9)`;
        ctx.beginPath();
        ctx.moveTo(w / 2, 62);
        ctx.lineTo(w / 2 - 34, 20);
        ctx.lineTo(w / 2 + 34, 20);
        ctx.closePath();
        ctx.fill();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(240, 252, 255, 0.92)';
        ctx.font = 'bold 30px Fredoka, Trebuchet MS, sans-serif';
        ctx.fillText('INGRESSO', w / 2, 96);

        ctx.font = 'bold 84px Fredoka, Trebuchet MS, sans-serif';
        ctx.fillText(secondi != null ? secondi.toFixed(1) : '--', w / 2, 152);

        // Il tasto da premere, in un riquadro come su una tastiera.
        ctx.font = 'bold 26px Fredoka, Trebuchet MS, sans-serif';
        const etichetta = 'SPAZIO';
        const larghezza = ctx.measureText(etichetta).width + 34;
        ctx.strokeStyle = 'rgba(240, 252, 255, 0.85)';
        ctx.lineWidth = 3;
        ctx.strokeRect((w - larghezza) / 2, h - 56, larghezza, 38);
        ctx.fillText(etichetta, w / 2, h - 36);
    }

    function mostraMuroPit(dati) {
        nascondiMuroPit();
        const canvas = document.createElement('canvas');
        canvas.width = MURO_TEXTURE_W;
        canvas.height = MURO_TEXTURE_H;
        const ctx = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        const larghezza = dati.larghezza || 10;
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(larghezza, MURO_ALTEZZA),
            new THREE.MeshBasicMaterial({
                map: texture, transparent: true, side: THREE.DoubleSide,
                depthWrite: false,   // è un velo: non deve nascondere ciò che ha dietro
            }),
        );
        const quota = myCarGroup ? myCarGroup.position.y : 0;
        mesh.position.set(dati.x, quota + MURO_ALTEZZA / 2, dati.z);
        // Perpendicolare alla corsia e RIVOLTO A CHI ARRIVA. Il piano nasce con
        // la normale su +Z; orientarla lungo la direzione di marcia lo mette di
        // spalle a chi sopraggiunge, che quindi ne vede il retro e legge il
        // testo specchiato (segnalato al playtest). La faccia deve guardare
        // all'indietro, cioè verso l'auto: da qui il segno meno.
        mesh.rotation.y = Math.atan2(-dati.tx, -dati.tz);
        ToonStyle.excludeFromOutline(mesh);
        scene.add(mesh);

        pitMuro = {
            mesh, canvas, ctx, texture, dati,
            unitaAlSecondo: (dati.velocitaPerTick || 1.55) * (1000 / (dati.tickMs || 50)),
            ultimoTesto: null, esito: null, spegniA: null,
        };
        disegnaTexturaMuro(ctx, { secondi: null, esito: null });
        texture.needsUpdate = true;
    }

    function nascondiMuroPit() {
        if (!pitMuro) return;
        scene.remove(pitMuro.mesh);
        pitMuro.mesh.geometry.dispose();
        pitMuro.mesh.material.dispose();
        pitMuro.texture.dispose();
        pitMuro = null;
    }

    // Quanto manca al muro per il MUSO dell'auto, in unità. Negativo = passato.
    // La formula è quella del modulo condiviso, la stessa con cui il server
    // giudica: il conto alla rovescia che si legge e il verdetto che si prende
    // devono venire dallo stesso calcolo, o si finisce giudicati su un muro
    // diverso da quello che si vede (è già successo, vedi f1BoxIngresso.js).
    function distanzaDalMuroPit() {
        if (!pitMuro || !myCarGroup) return null;
        return F1BoxIngresso.distanzaDalMuro(
            { muroPunto: pitMuro.dati },
            myCarGroup.position.x, myCarGroup.position.z, myCarGroup.rotation.y);
    }

    // Chiamata da animate(): tiene aggiornato il conto alla rovescia e toglie il
    // muro quando ha finito il suo lavoro.
    function aggiornaMuroPit() {
        if (!pitMuro) return;
        if (pitMuro.spegniA != null) {
            if (performance.now() >= pitMuro.spegniA) nascondiMuroPit();
            return;
        }
        const d = distanzaDalMuroPit();
        if (d == null) return;
        // Superato senza premere: resta un istante col verdetto e poi sparisce.
        if (d < -F1BoxIngresso.MURO_BUONO) {
            segnaEsitoMuroPit('lenta');
            return;
        }
        const secondi = Math.max(0, d / pitMuro.unitaAlSecondo);
        // Il muro si ACCENDE quando il muso e' dentro la finestra perfetta. E'
        // la differenza fra un gioco di tempismo che si legge e uno che si
        // indovina: il numero cambia dieci volte al secondo ed e' troppo per
        // l'occhio, mentre un colore che cambia lo si coglie subito. Il valore
        // e' lo stesso su cui giudica il server, non una soglia grafica a parte.
        // Acceso = il muso è dentro la finestra perfetta. La soglia è quella su
        // cui giudica il server, non una soglia grafica per conto suo.
        const acceso = Math.abs(d) <= F1BoxIngresso.MURO_PERFETTO;
        const testo = secondi.toFixed(1) + (acceso ? '!' : '');
        if (testo === pitMuro.ultimoTesto) return;
        pitMuro.ultimoTesto = testo;
        disegnaTexturaMuro(pitMuro.ctx, { secondi, acceso });
        pitMuro.texture.needsUpdate = true;
    }

    // Il muro dà il verdetto e si spegne: il giocatore lo legge dove stava
    // guardando, senza cercarlo in un angolo dello schermo.
    function segnaEsitoMuroPit(esito) {
        if (!pitMuro || pitMuro.spegniA != null) return;
        pitMuro.esito = esito;
        disegnaTexturaMuro(pitMuro.ctx, { secondi: null, esito, verdetto: true });
        pitMuro.texture.needsUpdate = true;
        pitMuro.spegniA = performance.now() + 900;
    }

    socket.on('f1PitIndicatore', (dati) => mostraMuroPit(dati));

    socket.on('f1PitLaneEntered', () => {
        const panel = document.getElementById('pitstop-panel');
        panel.style.display = 'block';
        // I due cronometri della corsia: partono da qui e li disegna
        // aggiornaTempiCorsia(), chiamata da animate().
        pitCorsiaDa = performance.now();
        pitSostaDa = null;
        pitSostaDurata = null;
        document.getElementById('pitlane-hud').style.display = 'block';
        document.getElementById('pitstop-status').textContent = 'INGRESSO AI BOX...';
        document.getElementById('pitstop-instructions').textContent =
            'Scegli la mescola, poi premi SPAZIO quando passi sulla banda verde in corsia.';
        document.getElementById('pitstop-react-prompt').style.display = 'none';
        document.getElementById('pitstop-result').textContent = '';
        if (tyreCompoundsInfo) renderTyreCards(tyreCompoundsInfo, null, 'pitstop-cards', 'f1PitCompoundChoice', giriMescolaPista);

        const myDamage = (serverState[myColor] && serverState[myColor].damage) || 0;
        const repairToggle = document.getElementById('pitstop-repair-toggle');
        const repairBtn = document.getElementById('pitstop-repair-btn');
        if (myDamage > 0) {
            const estSecs = ((myDamage * 150) / 1000).toFixed(1);   // 150 = REPAIR_MS_PER_DAMAGE_PCT lato server
            repairBtn.textContent = `Ripara danni (+${estSecs}s)`;
            repairBtn.classList.remove('selected');
            repairToggle.style.display = 'flex';
            repairBtn.onclick = toggleRepairChoice;
        } else {
            repairToggle.style.display = 'none';
        }
    });

    // L'esito arriva mentre si sta ancora arrivando: si vede subito se il
    // tempismo era giusto, che è metà del gioco. Il pannello lo ripete quando
    // l'auto si ferma, con la durata che ne consegue.
    const ESITO_TESTO = {
        perfetta: { testo: 'PERFETTA!', colore: ESITO_COLORE.perfetta.css },
        buona:    { testo: 'BUONA',     colore: ESITO_COLORE.buona.css },
        lenta:    { testo: 'LENTA',     colore: ESITO_COLORE.lenta.css },
    };

    socket.on('f1PitEsito', ({ esito }) => {
        segnaEsitoMuroPit(esito);   // il verdetto si legge sul muro, dov'era lo sguardo
        const e = ESITO_TESTO[esito] || ESITO_TESTO.lenta;
        const el = document.getElementById('pitstop-result');
        el.textContent = e.testo;
        el.style.color = e.colore;
        anime({ targets: el, scale: [0.6, 1], opacity: [0, 1], duration: 320, easing: 'easeOutBack' });
    });

    socket.on('f1PitStopStarted', ({ esito, durationMs } = {}) => {
        pitting = true;
        pitSostaDa = performance.now();
        pitSostaDurata = durationMs != null ? durationMs : null;
        nascondiMuroPit();
        clearTyreNav();
        document.getElementById('pitstop-react-prompt').style.display = 'none';
        document.getElementById('pitstop-status').textContent = 'AI BOX...';
        document.getElementById('pitstop-instructions').textContent = '';
        const e = ESITO_TESTO[esito] || ESITO_TESTO.lenta;
        const secs = durationMs != null ? (durationMs / 1000).toFixed(1) : null;
        const el = document.getElementById('pitstop-result');
        el.textContent = secs != null ? `${e.testo} — sosta ${secs}s` : e.testo;
        el.style.color = e.colore;
    });

    socket.on('f1PitStopFinished', () => {
        pitting = false;
        document.getElementById('pitstop-status').textContent = 'USCITA DAI BOX...';
        document.getElementById('pitstop-instructions').textContent = '';
    });

    socket.on('f1PitLaneExited', () => {
        document.getElementById('pitstop-panel').style.display = 'none';
        document.getElementById('pitlane-hud').style.display = 'none';
        pitCorsiaDa = null;
        pitSostaDa = null;
        document.getElementById('pitstop-result').style.color = '';
        nascondiMuroPit();
    });

    // Il client inoltra la pressione ogni volta che viene premuto spazio
    // durante la sosta: è il server a decidere se conta (solo se arrivata
    // DOPO il segnale) o va ignorata (prematura) — nessun rischio di
    // "bruciarsi" l'unico tentativo premendo troppo presto per curiosità.
    // Il tempo di gara che il client ha adesso, estrapolato fra due
    // aggiornamenti come fa il cronometro dell'HUD. Serve al server per sapere
    // DOVE era l'auto quando è stato premuto il tasto, invece di dove è
    // arrivata nel frattempo: a 31 unità al secondo, 100 ms di rete sono 3
    // unità, cioè metà della fascia "perfetta".
    function tempoGaraOra() {
        if (myLiveElapsedMs == null || myLiveElapsedSyncedAt == null) return null;
        return myLiveElapsedMs + (Date.now() - myLiveElapsedSyncedAt);
    }

    function premiReazionePit() {
        socket.emit('f1PitReactionPress', { lobbyId, playerColor: myColor, elapsedMs: tempoGaraOra() });
    }

    document.addEventListener('keydown', (e) => {
        // Si preme mentre si ARRIVA (l'indicatore è a schermo), non più da
        // fermi: la finestra utile è quella in cui l'autopilota sta portando
        // l'auto verso lo stallo.
        if ((pitting || pitMuro) && e.code === 'Space') {
            // Senza preventDefault, se la checkbox riparazione ha il focus
            // (ce l'ha appena la clicchi) il browser la de-seleziona da solo
            // alla pressione di Spazio — comportamento nativo dell'elemento,
            // in aggiunta a (non al posto di) l'emit qui sotto. Segnalato
            // dall'utente: "premo spazio per la reazione e mi si deseleziona
            // la riparazione danni".
            e.preventDefault();
            premiReazionePit();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 't') {
            tyrePanelOpen = !tyrePanelOpen;
            renderTyreVisibility();
        }
    });

    // Tasto R = riparazione danni ai box da tastiera (stessa funzione del
    // click sul pulsante e di R1 da controller) — segnalato dall'utente,
    // prima esisteva solo il tasto controller. toggleRepairChoice ignora la
    // pressione da sola se il pannello riparazione non è visibile.
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'r') toggleRepairChoice();
    });

    // DEBUG: pannello usura/guasti (tasto G) — mostra/nasconde soltanto,
    // il contenuto è già aggiornato ad ogni f1StateUpdate indipendentemente
    // da questo stato (vedi updateDebugPanel), come per showHitboxes.
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'g') {
            debugPanelOpen = !debugPanelOpen;
            document.getElementById('debug-panel').style.display = debugPanelOpen ? 'block' : 'none';
        }
    });

    // Popola il pannello debug dai dati già calcolati server-side
    // (state.debug, vedi buildPublicState in f1GameSocket.js) — nessuna
    // formula duplicata qui, solo lettura/formattazione.
    function updateDebugPanel(data) {
        if (!debugPanelOpen) return;
        const d = data.debug || {};
        document.getElementById('debug-maxspeed').textContent = `${d.maxSpeedPct ?? 100}%`;
        document.getElementById('debug-grip').textContent = `${d.gripPct ?? 100}%`;
        document.getElementById('debug-accel').textContent = `${d.accelPct ?? 100}%`;
        document.getElementById('debug-brake').textContent = `${d.brakePct ?? 100}%`;
        document.getElementById('debug-steer').textContent = `${d.steerPct ?? 100}%`;
        document.getElementById('debug-tyrewear').textContent = `${Math.round(data.tyreWear || 0)}%`;
        const parts = data.damageParts || {};
        document.getElementById('debug-frontwing').textContent = `${Math.round(parts.frontWing || 0)}%`;
        document.getElementById('debug-floor').textContent = `${Math.round(parts.floor || 0)}%`;
        document.getElementById('debug-engine').textContent = `${Math.round(parts.engine || 0)}%`;
        document.getElementById('debug-suspension').textContent = `${Math.round(parts.suspension || 0)}%`;
    }

    // ====================================================
    // SOCKET EVENTS
    // ====================================================
    // ── FORMATO STAGIONE ────────────────────────────────────────────────
    // In stagione il weekend non parte finche' non si sceglie il campionato:
    // il server tiene la partita in fase 'stagione' e qui si montano le sue
    // schermate. Vivono in un modulo a parte (shared/f1StagioneSchermate.js) —
    // questo file e' gia' abbastanza grande, e quelle schermate non hanno
    // niente a che fare con la scena 3D.
    let schermateStagione = null;

    // Dopo questa gara si torna al calendario invece che in lobby. Lo si sa
    // gia' dalle impostazioni (garaDiCampionato); l'evento del server a fine
    // gara (f1StagioneAlCalendario) e' solo una conferma, e arriva DOPO che il
    // podio ha configurato la propria uscita — leggerlo da li' soltanto
    // avrebbe fatto comparire "Torna alla lobby" su una gara di campionato.
    let campionatoTornaAlCalendario = garaDiCampionato;

    // Il SEGNO lasciato da una gara di campionato appena finita.
    //
    // Fra una gara e l'altra la pagina si ricarica (e' la scelta che tiene
    // intatto il codice del weekend), e la pagina che riparte non ha modo di
    // sapere da sola che si arriva da una gara: senza segno mostrerebbe il
    // calendario, mentre quello e' l'unico momento in cui ha senso mostrare il
    // riepilogo. Sta in sessionStorage e non nell'indirizzo perche' e' roba di
    // questa scheda e di questo momento: nessuno deve poterla incollare a un
    // amico, e chiudendo il browser sparisce da se'.
    //
    // Si porta dietro anche la PISTA, non solo la stagione: al ritorno serve
    // sapere che il risultato di quella gara e' stato davvero registrato, e non
    // soltanto che una gara, qualche volta, e' stata corsa.
    const SEGNO_GARA = 'f1StagioneDaGara';

    function alCalendario() {
        try {
            sessionStorage.setItem(SEGNO_GARA, JSON.stringify({
                stagioneId: clientSettings.stagioneId || null,
                pista: trackId,
            }));
        } catch (e) {
            // Niente sessionStorage: si torna al calendario lo stesso, si
            // perde solo il riepilogo. Non e' un motivo per non ricaricare.
        }
        window.location.reload();
    }

    // Si legge UNA VOLTA all'avvio e si cancella subito: il riepilogo si vede
    // rientrando dalla gara, non ogni volta che si ricarica la pagina.
    const garaAppenaCorsa = (() => {
        try {
            const grezzo = sessionStorage.getItem(SEGNO_GARA);
            sessionStorage.removeItem(SEGNO_GARA);
            const segno = grezzo ? JSON.parse(grezzo) : null;
            return (segno && segno.stagioneId) ? segno : null;
        } catch (e) { return null; }
    })();

    // Il token vive qui, che l'autenticazione ce l'ha gia' (vedi `user` in
    // cima): le schermate ne ricevono solo il modo di chiederlo, cosi' non
    // esiste un secondo posto che sa di Firebase. getIdToken() restituisce
    // quello in cache e lo rinnova da solo quando scade.
    function tokenFirebaseCorrente() {
        if (!user) return Promise.reject(new Error('Serve un account per giocare una stagione'));
        return user.getIdToken();
    }

    // Il formato dice "questa partita appartiene a un campionato" e resta
    // 'stagione' ANCHE mentre si corre una sua gara: e' la FASE a dire se in
    // questo momento si sceglie o si guida. Guardare solo il formato metteva il
    // calendario davanti alla pista — segnalato al playtest: "premo Corri, il
    // caricamento parte, e torno nella stessa identica pagina".
    function montaSchermateStagione(fase, stagioneId) {
        if (fase !== 'stagione' || schermateStagione) return;
        // Segnaposto immediato: senza, due f1Setup ravvicinati (rientro,
        // riconnessione) monterebbero le schermate due volte mentre la fetch
        // delle piste e' ancora in volo.
        schermateStagione = { chiudi() { } };
        fetch('/api/f1/tracks')
            .then(r => r.json())
            .then((piste) => {
                schermateStagione = F1StagioneSchermate.monta({
                    socket, lobbyId,
                    sonoHost: myColor === hostColor,
                    tokenDi: tokenFirebaseCorrente,
                    piste: piste || [],
                    mioUid: user ? user.uid : null,
                    // Uscire dal campionato e' uscire dalla partita, ed e' la
                    // stessa regola del podio: chi ospita la chiude per tutti
                    // (il server smonta la sessione), chi non ospita se ne va
                    // e basta — non puo' strappare gli altri dalla schermata.
                    versoLobby: () => {
                        if (myColor === hostColor) socket.emit('f1ReturnToLobby', lobbyId);
                        else window.location.href = `/lobby.html?lobby=${lobbyId}`;
                    },
                    // Rientro a campionato gia' scelto (il server lo dice in
                    // f1Setup): la schermata si apre DIRETTAMENTE su quello.
                    // Prima passava dal server per dirglielo e apriva l'elenco
                    // nel frattempo — un paio di secondi di "crea una nuova
                    // stagione" in faccia a chi ne stava giocando una.
                    stagioneIniziale: stagioneId || null,
                    // Se si arriva da una gara di questa stagione, invece del
                    // calendario si apre il riepilogo.
                    garaAppenaCorsa,
                });
            })
            .catch((e) => console.error('[F1] elenco piste per la stagione:', e));
    }

    socket.on('f1Setup', ({ players, trackName, hostColor: hc, totalLaps, phase, raceStarted, elapsed,
        compounds, strategy, myCompound, tyreConfirmed, tyreTotal, abrasivita, giriPerMescola,
        tyreAttesi, tyreArrivati, tyreConfermati, tyreRestaMs, formato, stagioneId }) => {
        if (compounds) tyreCompoundsInfo = compounds;
        if (phase) currentPhase = phase;
        // Rientro a metà qualifica (reconnect): senza questo qualiSessionOpen
        // resterebbe false (valore iniziale), e l'overlay "in attesa" non
        // comparirebbe mai anche se la sessione è davvero aperta — l'unico
        // altro punto che lo apre è f1Countdown, che non rifira per chi si
        // ricollega a sessione già in corso.
        if (phase) qualiSessionOpen = (phase === 'qualifying');
        if (hc) hostColor = hc;
        // Dopo hostColor: le schermate della stagione devono sapere se sono io
        // a ospitare, ed e' l'unica cosa che decide cosa mi mostrano.
        montaSchermateStagione(phase, stagioneId);
        if (totalLaps) {
            // totalLaps qui è SEMPRE quello della gara vera (il server lo manda
            // così a prescindere dalla fase corrente): setLapDisplay lo riduce
            // già a 1 se si è in qualifica.
            raceTotalLaps = totalLaps;
            const myLap = players[myColor] ? players[myColor].lap : 0;
            setLapDisplay(myLap, phase);
        }

        // Idempotente: su un rientro (reconnect senza reload) i modelli esistono
        // già in scena, ricrearli darebbe auto duplicate.
        if (!myCarGroup) loadCarModel(myColor, (g) => {
            myCarGroup = g;
            segnalaAutoPronta();
        }, TEST_LIVERY_COLORS);
        else segnalaAutoPronta();

        for (const [color, state] of Object.entries(players)) {
            serverState[color] = { x: state.x, z: state.z, angle: state.angle, speed: 0 };
            if (!visualState[color]) visualState[color] = { ...serverState[color] };
            if (color !== myColor && !otherCars[color]) {
                loadOtherCar(color, state.uid, (g) => {
                    otherCars[color] = g;
                    g.position.set(state.x, 0, state.z);
                    g.rotation.y = state.angle;
                });
            }
        }

        // Rientro a gara già in corso: riprende il cronometro dal punto giusto
        // senza rivedere il countdown (che è già passato per tutti gli altri)
        // — myLiveElapsedMs si popola da solo al prossimo f1StateUpdate,
        // nessun calcolo locale da seminare qui.
        if (raceStarted) {
            isRacing = true;
            document.getElementById('countdown-overlay').style.display = 'none';
            document.getElementById('timer-speed-panel').style.display = (phase === 'qualifying' || phase === 'race') ? 'flex' : 'none';
        }

        if (phase === 'tyre_select') {
            tyreSelectActive = true;
            myCompoundChoice = myCompound || null;
            document.getElementById('tyre-select-overlay').style.display = 'flex';
            enterTyrePreview();
            if (typeof abrasivita === 'number') abrasivitaPista = abrasivita;
            if (giriPerMescola) giriMescolaPista = giriPerMescola;
            renderInfoCircuito();
            document.getElementById('tyre-strategy-hint').textContent =
                'Consigliata: ' +
                (strategy || []).map(c => (compounds[c]?.label || c).toLowerCase()).join(' → ');
            renderTyreCards(compounds, myCompoundChoice, 'tyre-cards', 'f1TyreChoice', giriMescolaPista);
            renderAttesaMescole({
                attesi: tyreAttesi, arrivati: tyreArrivati, confermati: tyreConfermati,
                count: tyreConfirmed, total: tyreTotal, restaMs: tyreRestaMs,
            });
        }
    });

    socket.on('f1StateUpdate', (state) => {
        // Layout box in qualifica (Rif. richiesta utente 2026-08-07):
        // chiave speciale FUORI dallo stato per-colore isolato — vedi
        // broadcastState in f1GameSocket.js. Renderizza i box di TUTTI i
        // piloti anche quando lo stato "vivo" (posizione/tempi) resta
        // isolato al solo proprio colore.
        if (state.__boxLayout) {
            for (const [color, anchor] of Object.entries(state.__boxLayout)) {
                loadPlayerPitBox(color, anchor);
            }
        }
        for (const [color, data] of Object.entries(state)) {
            if (color === '__boxLayout') continue;
            serverState[color] = data;
            updateMinimapDot(color, data.x, data.z);
            if (data.pitBoxAnchor) loadPlayerPitBox(color, data.pitBoxAnchor);
            if (color !== myColor && !otherCars[color] && !visualState[color]) {
                visualState[color] = { x: data.x, z: data.z, angle: data.angle };
                loadOtherCar(color, data.uid, (g) => { otherCars[color] = g; });
            } else if (!visualState[color]) {
                visualState[color] = { x: data.x, z: data.z, angle: data.angle };
            }

            if (showHitboxes) {
                const hb = getHitboxMesh(color);
                hb.position.x = data.x;
                hb.position.z = data.z;
                hb.rotation.y = data.angle;
                hb.visible = true;
            } else if (hitboxMeshes[color]) {
                hitboxMeshes[color].visible = false;
            }

            // Solo in GARA: in qualifica tutti guidano sullo spec Soft a
            // prescindere dalla mescola scelta (quella conta solo in gara),
            // mostrarla lì sarebbe fuorviante. Aggiorna SEMPRE sia l'icona
            // chiusa che il pannello esteso: quale dei due sia visibile è
            // deciso solo da renderTyreVisibility()/tyrePanelOpen.
            if (color === myColor && currentPhase === 'race' && data.compound && tyreCompoundsInfo) {
                const info = tyreCompoundsInfo[data.compound];
                if (info) {
                    if (mescolaDisegnata !== data.compound) {
                        mescolaDisegnata = data.compound;
                        document.getElementById('tyre-drawing').innerHTML =
                            F1Pneumatico.svg(data.compound, info.color, { titolo: 'Mescola ' + info.label });
                        document.getElementById('tyre-compound-label').textContent = info.label.toUpperCase();
                        document.getElementById('tyre-open').style.setProperty('--mescola', info.color);
                    }
                    aggiornaStatoVettura(data);
                }
            }
            if (color === myColor && currentPhase === 'race') aggiornaAvvisoSosta(data);
            if (color === myColor) {
                renderTyreVisibility();
                updateDebugPanel(data);
            }
        }
        updateStandings(state);
    });

    // Colora le 3 barre settore in base ai dati del proprio giocatore
    // (mai per gli avversari — Rif. design). Priorità: fucsia (record di
    // sessione) > verde/giallo (confronto col proprio giro precedente) >
    // neutro (settore non ancora raggiunto in questo giro, o nessun
    // riferimento — primo giro in gara).
    function updateSectorBars(sectorTimes, prevSectorTimes, bestSectorTimes) {
        for (let i = 0; i < 3; i++) {
            const bar = document.getElementById(`sector-bar-${i + 1}`);
            if (!bar) continue;
            bar.classList.remove('yellow', 'green', 'best');
            const t = sectorTimes ? sectorTimes[i] : null;
            if (t == null) continue;
            const best = bestSectorTimes ? bestSectorTimes[i] : null;
            if (best != null && t <= best) {
                bar.classList.add('best');
            } else if (prevSectorTimes && prevSectorTimes[i] != null) {
                bar.classList.add(t < prevSectorTimes[i] ? 'green' : 'yellow');
            }
        }
    }

    // Formatta gapToLeaderMs (ms) in "+S.m" (sotto il minuto) o "+M:SS.m"
    // (oltre) — un solo decimale, dato che il calcolo è già una stima
    // (mostrare 3 cifre sarebbe fuorviante). null/leader => stringa vuota.
    function formatGap(ms) {
        if (ms == null) return '';
        const totalDeci = Math.round(ms / 100);
        const s10 = totalDeci % 600;
        const m = Math.floor(totalDeci / 600);
        const secStr = (s10 / 10).toFixed(1);
        return m > 0 ? `+${m}:${secStr.padStart(4, '0')}` : `+${secStr}`;
    }

    // Formatta il delta continuo (ms, con segno) rispetto al giro
    // precedente in "±S.mmm" (sotto il minuto) o "±M:SS.mmm" (oltre) — 3
    // decimali per coerenza col timer principale (che mostra i millisecondi
    // pieni, non arrotondati a un decimale come formatGap sopra, che è
    // invece già una stima di distacco). null => stringa vuota.
    function formatDelta(ms) {
        if (ms == null) return '';
        const sign = ms < 0 ? '-' : '+';
        const abs = Math.round(Math.abs(ms));
        const m = Math.floor(abs / 60000);
        const s = Math.floor((abs % 60000) / 1000);
        const msRem = abs % 1000;
        const secStr = `${s}.${String(msRem).padStart(3, '0')}`;
        return m > 0 ? `${sign}${m}:${String(s).padStart(2, '0')}.${String(msRem).padStart(3, '0')}` : `${sign}${secStr}`;
    }

    let lastStandingsOrder = [];   // colori nell'ordine dell'ultimo render, per rilevare i sorpassi
    const standingRowEls = {};     // color -> riga DOM persistente (mai ricreata finché il pilota resta in gara)

    const STANDING_ROW_HEIGHT = 24;   // deve corrispondere all'altezza reale di .f1-standing-row (padding incluso)
    const STANDING_LIFT_PX = 16;   // quanto la riga di chi sorpassa si "alza" oltre lo slot di arrivo, a metà animazione

    function renderStandingRowContent(rowEl, color, d) {
        const compoundLetter = { soft: 'S', medium: 'M', hard: 'H' }[d.compound] || '';
        const compoundColor = (tyreCompoundsInfo && tyreCompoundsInfo[d.compound] && tyreCompoundsInfo[d.compound].color) || '#888';
        rowEl.innerHTML = `
            <span class="pos">${d.position}</span>
            <span class="dot" style="background:${color};"></span>
            ${color === myColor ? 'TU' : ''}${d.isBot ? '<span class="bot-badge">CPU</span>' : ''}
            ${compoundLetter ? `<span class="compound-badge" style="color:${compoundColor};">${compoundLetter}</span>` : ''}
            ${(d.falseStart && !d.falseStartServed) ? '<span class="false-start-badge">!</span>' : ''}${d.collisionPenalty ? '<span class="false-start-badge collision-badge">!</span>' : ''}
            <span class="gap">${d.position === 1 ? 'Leader' : formatGap(d.gapToLeaderMs)}</span>
        `;
    }

    // Classifica live: pallino colore + posizione + distacco dal leader,
    // ordinata per rank. Mai in qualifica: lì ogni giocatore vede solo se
    // stesso (playersVisibleTo la isola), quindi avrebbe comunque
    // "position" (raceStarted è true anche in qualifica) e mostrerebbe una
    // classifica assurda con un solo "1°" — non basta controllare le
    // entries, va escluso esplicitamente per fase.
    //
    // Le righe sono elementi DOM persistenti, uno per colore, mai ricreati
    // da un innerHTML sull'intera lista: il server manda f1StateUpdate ogni
    // 50ms (PHYSICS_TICK_MS), un rebuild completo ad ogni chiamata
    // distruggerebbe qualsiasi animazione di sorpasso dopo un solo frame,
    // prima ancora che potesse essere visibile.
    // La classifica mostra SEMPRE sei righe, quante ne sta comoda a schermo, e
    // scorre attorno alla propria posizione: da primo si vede dal 1° al 6°, da
    // ultimo di dieci dal 5° al 10°.
    //
    // Niente leader appuntato in cima: da primo restavano due sole righe (tu e
    // quello dietro), e chi corre in fondo non ha bisogno di sapere quanto è
    // lontano il primo — lo rivedrà risalendo. Le informazioni che contano in
    // gara sono chi devi attaccare e chi ti sta attaccando.
    const CLASSIFICA_FINESTRA = 6;
    // Tre davanti e due dietro: con sei righe non si può stare esattamente al
    // centro, e vedere chi si insegue conta più di vedere chi insegue te.
    const CLASSIFICA_SOPRA = 3;

    function finestraClassifica(entries) {
        if (entries.length <= CLASSIFICA_FINESTRA) return entries;

        const mio = entries.findIndex(([color]) => color === myColor);
        // Chi guarda senza essere in gara (rientro, spettatore): i primi.
        if (mio < 0) return entries.slice(0, CLASSIFICA_FINESTRA);

        // La finestra si ferma agli estremi invece di accorciarsi: le righe
        // restano sei anche in testa e in coda alla classifica.
        const da = Math.max(0, Math.min(mio - CLASSIFICA_SOPRA,
                                        entries.length - CLASSIFICA_FINESTRA));
        return entries.slice(da, da + CLASSIFICA_FINESTRA);
    }

    function updateStandings(state) {
        const box = document.getElementById('standings-panel');
        const rowsEl = document.getElementById('standings-rows');

        const tutti = (currentPhase !== 'race') ? [] : Object.entries(state)
            .filter(([, d]) => d.position)
            .sort((a, b) => a[1].position - b[1].position);
        const entries = finestraClassifica(tutti);

        if (entries.length === 0) {
            rowsEl.innerHTML = '';
            box.style.display = 'none';
            lastStandingsOrder = [];
            for (const color in standingRowEls) delete standingRowEls[color];
            return;
        }

        box.style.display = 'flex';
        const newOrder = entries.map(([color]) => color);

        // posizione di ogni pilota nell'ordine PRIMA di questo aggiornamento —
        // serve per animare solo chi ha davvero cambiato posizione.
        const prevIndex = {};
        lastStandingsOrder.forEach((color, i) => { prevIndex[color] = i; });

        // righe di chi non è più in classifica (disconnesso) — via
        for (const color in standingRowEls) {
            if (!newOrder.includes(color)) {
                standingRowEls[color].remove();
                delete standingRowEls[color];
            }
        }

        // crea (solo se manca) o aggiorna il contenuto di ogni riga — mai un
        // innerHTML sull'intera lista, solo sulla singola riga toccata.
        for (const [color, d] of entries) {
            let rowEl = standingRowEls[color];
            if (!rowEl) {
                rowEl = document.createElement('div');
                rowEl.className = 'f1-standing-row';
                rowEl.dataset.color = color;
                standingRowEls[color] = rowEl;
                rowsEl.appendChild(rowEl);
            }
            rowEl.classList.toggle('me', color === myColor);
            renderStandingRowContent(rowEl, color, d);
        }

        // riordina il DOM secondo la classifica attuale — solo se l'ordine è
        // davvero cambiato, per non forzare un reflow ad ogni tick.
        const orderChanged = newOrder.some((color, i) => lastStandingsOrder[i] !== color);
        if (orderChanged) {
            newOrder.forEach(color => rowsEl.appendChild(standingRowEls[color]));

            newOrder.forEach((color, newIdx) => {
                const oldIdx = prevIndex[color];
                if (oldIdx === undefined || oldIdx === newIdx) return;   // riga nuova o posizione invariata: nessuna animazione

                const rowEl = standingRowEls[color];
                const deltaPx = (oldIdx - newIdx) * STANDING_ROW_HEIGHT;

                // Sorpassi ravvicinati possono far scattare due animazioni sulla
                // stessa riga prima che la prima finisca (es. sorpassa e viene
                // subito ri-sorpassato): senza cancellare la tween precedente,
                // anime.js lascia "scale" congelato a un valore intermedio
                // (l'unico ramo che lo anima è quello sotto, l'altro anima solo
                // translateY) — badge/lettera restano leggermente deformati e
                // fuori centro finché non arriva un altro sorpasso a "sbloccarli".
                anime.remove(rowEl);

                if (newIdx < oldIdx) {
                    // Ha sorpassato: la riga viene "estratta" dalla classifica
                    // (sollevata oltre lo slot di arrivo, come una fascia tolta
                    // dal cartellone) e poi riposizionata nel posto giusto —
                    // richiesta esplicita dell'utente, ispirata ai vecchi
                    // cartelloni a fasce non digitali.
                    rowEl.style.transform = `translateY(${deltaPx}px)`;
                    rowEl.classList.add('is-lifting');
                    anime({
                        targets: rowEl,
                        keyframes: [
                            { translateY: -STANDING_LIFT_PX, scale: 1.08, duration: 180, easing: 'easeOutQuad' },
                            { translateY: 0, scale: 1, duration: 300, easing: 'easeInOutQuad' },
                        ],
                        complete: () => rowEl.classList.remove('is-lifting'),
                    });
                } else {
                    // È stato sorpassato: scorre semplicemente giù di uno slot
                    // per fare spazio, nessun sollevamento. Scale esplicito a 1
                    // per riportare a riposo eventuale scale lasciato a metà da
                    // un'animazione di sorpasso interrotta (vedi anime.remove sopra).
                    anime({
                        targets: rowEl,
                        translateY: [deltaPx, 0],
                        scale: 1,
                        duration: 420,
                        easing: 'easeOutQuad',
                    });
                }
            });
        }

        lastStandingsOrder = newOrder;
    }

    // Toglie di scena tutto ciò che appartiene a un pilota: l'auto, le sue
    // zolle, la scia, la hitbox, il pallino sulla minimappa e il suo stato.
    // Due chiamanti, ed è il motivo per cui non vive più dentro f1PlayerLeft:
    // un pilota che se ne va, e l'ingresso in QUALIFICA (dove ognuno corre da
    // solo e le auto altrui non devono esistere).
    function rimuoviAutoDi(color) {
        if (otherCars[color]) { scene.remove(otherCars[color]); delete otherCars[color]; }
        // Anche le sue zolle: senza, resterebbero appese alla scena per sempre
        // (la mesh sta nella scena, non dentro l'auto). La scia se ne va con
        // l'auto perché le è appesa, ma il suo materiale va comunque liberato.
        rimuoviDetritiDi(color);
        rimuoviSciaDi(color);
        if (hitboxMeshes[color]) { scene.remove(hitboxMeshes[color]); delete hitboxMeshes[color]; }
        if (minimapDots[color]) { minimapDots[color].remove(); delete minimapDots[color]; }
        delete serverState[color]; delete visualState[color];
    }

    socket.on('f1PlayerLeft', (color) => rimuoviAutoDi(color));

    socket.on('f1TyreConfirmed', renderAttesaMescole);

    socket.on('f1Countdown', (data) => {
        isRacing = false;
        myFinalTime = null;
        myLiveElapsedMs = null;
        myLiveElapsedSyncedAt = null;
        myDeltaToPreviousLapMs = null;
        if (tyreSelectActive) exitTyrePreview();   // la qualifica sta per partire: fine anteprima tracciato
        tyreSelectActive = false;
        clearTyreNav();
        document.getElementById('timer-speed-panel').style.display = 'none';
        tyrePanelOpen = false;
        renderTyreVisibility();
        // Nasconde in automatico un'eventuale griglia/animazione/selezione ancora
        // a schermo: evita di dover sincronizzare a mano un timeout lato client
        // con GRID_DISPLAY_MS/TYRE_SELECT_MS del server.
        document.getElementById('podium-modal').style.display = 'none';
        document.getElementById('grid-reveal').style.display = 'none';
        // Annulla la transizione qualifica→gara se è ancora in corso: lo
        // stacco dura secondi, e questo countdown può arrivare mentre uno dei
        // suoi pezzi è ancora in coda. Il numero di sequenza li ferma tutti
        // (vedi f1QualiEnded), F1Sting.stop toglie subito quello a schermo.
        sequenzaCorrente++;
        if (window.F1Sting) F1Sting.stop();
        silenzioTransizione(false);
        // Il sipario cala QUI e non alla fine della sequenza: è l'ultimo
        // strato davanti alla pista, e questo countdown è l'unico momento in
        // cui si è sicuri che la pista vada rivista.
        sipario(false);
        nascondiRiepilogoGriglia();
        // "Riavvia" riparte dalla premiazione: la scena col podio va tolta di
        // mezzo, o resterebbe piantata sul traguardo per tutta la gara nuova.
        nascondiCerimonia();
        fermaCerimonia();
        // Prima della camera: l'auto della vetrina e' appesa a lei, e
        // lasciarla li' vorrebbe dire correre con un modello incollato
        // davanti all'obiettivo.
        nascondiAutoInPole();
        // La camera torna all'auto: senza, la gara partirebbe con la veduta
        // aerea ancora in corso.
        fermaPanoramica();
        // true solo per il countdown che apre una qualifica; il countdown di
        // gara (data.phase==='race') la chiude anche come rete di sicurezza,
        // ridondante con f1QualiEnded qui sotto ma innocuo.
        qualiSessionOpen = (data?.phase === 'qualifying');
        // In qualifica ognuno corre da solo: il server smette di trasmettere
        // le auto altrui (playersVisibleTo), e un'auto di cui non arrivano più
        // aggiornamenti resta piantata dove l'abbiamo vista l'ultima volta —
        // questo handler non ne toglie nessuna da sé. Nel flusso normale non
        // c'è niente da togliere (la qualifica è la prima sessione in pista),
        // ma una qualifica RIAVVIATA arriva dopo una gara intera: senza questa
        // riga il giocatore si ritrovava in pista le macchine dei bot
        // (segnalato in playtest). Sotto il velo nero del riavvio, quindi la
        // sparizione non si vede.
        if (data?.phase === 'qualifying') {
            for (const color of Object.keys(otherCars)) rimuoviAutoDi(color);
        }
        document.getElementById('quali-waiting-overlay').style.display = 'none';
        document.getElementById('tyre-select-overlay').style.display = 'none';
        const overlay = document.getElementById('countdown-overlay');
        const num = document.getElementById('countdown-number');
        const trackEl = document.getElementById('countdown-track');
        const labelEl = document.getElementById('countdown-label');
        const lightsBoard = document.getElementById('lights-board');
        if (data?.trackName) trackEl.textContent = data.trackName;
        labelEl.textContent = data?.label || '';
        // Niente velo nero alla partenza della GARA: coprirebbe proprio il
        // ponte che porta i semafori. In qualifica resta, lì non c'è niente
        // da guardare in pista durante il 3-2-1. La classe sposta anche il
        // testo in alto, fuori dalla linea di vista (vedi .overlay.is-gara).
        overlay.classList.toggle('is-gara', data?.phase === 'race');
        overlay.style.background = data?.phase === 'race' ? 'transparent' : 'rgba(0,0,0,0.65)';
        overlay.style.display = 'flex';

        if (data?.phase === 'race') {
            // Plancia luci: 5 bulbi spenti, si accendono uno alla volta ogni
            // LIGHT_INTERVAL_MS (stesso valore lato server, 1000ms), poi
            // restano tutte accese finché non arriva davvero f1RaceStarted
            // (l'attesa casuale la decide solo il server, qui non c'è nessun
            // timer locale che la replica — lo spegnimento è una reazione
            // all'evento, mai un timeout indipendente).
            lightsSequenceActive = true;
            num.style.display = 'none';
            // Il pilota alza gli occhi al semaforo.
            sguardoObiettivo = 1;
            // Nome pista ed etichetta spariscono: al via si guarda il ponte,
            // e tutto il resto è roba che sta davanti a quello che serve.
            trackEl.style.display = 'none';
            labelEl.style.display = 'none';
            lightsBoard.style.display = indicatoreLuci ? 'flex' : 'none';
            const bulbs = [0, 1, 2, 3, 4].map(i => document.getElementById(`light-${i}`));
            bulbs.forEach(b => b.classList.remove('on'));
            accendiSemafori(0);
            const LIGHT_INTERVAL_MS = 1000;
            bulbs.forEach((bulb, i) => {
                setTimeout(() => {
                    // Le luci vere sul ponte sono la cosa che conta; il bip
                    // le accompagna, così il via si sente anche se in quel
                    // momento stai guardando lo specchietto.
                    accendiSemafori(i + 1);
                    bipSemaforo(620, 0.16, 0.16);
                    bulb.classList.add('on');
                    anime({ targets: bulb, scale: [1, 1.18, 1], duration: 260, easing: 'easeOutQuad' });
                }, i * LIGHT_INTERVAL_MS);
            });
        } else {
            num.style.display = '';
            trackEl.style.display = '';
            labelEl.style.display = '';
            lightsBoard.style.display = 'none';
            num.textContent = '3'; num.style.color = '#e74c3c';
            setTimeout(() => { num.textContent = '2'; num.style.color = '#f39c12'; }, 1000);
            setTimeout(() => { num.textContent = '1'; num.style.color = '#f1c40f'; }, 2000);
        }
    });

    socket.on('f1RaceStarted', (data) => {
        // SOLO se questo è il via della GARA: questo evento scatta anche al
        // via della qualifica stessa (data.phase==='qualifying', il momento
        // esatto in cui il pannello deve poter comparire) — un reset
        // incondizionato qui la chiudeva nell'istante stesso in cui si
        // apriva, quindi non compariva mai (bug reale introdotto nel giro
        // precedente, segnalato dall'utente: "non esce più").
        if (data?.phase === 'race') qualiSessionOpen = false;
        isRacing = true;
        lightsSequenceActive = false;
        myFinalTime = null;
        myLiveElapsedMs = null;
        myLiveElapsedSyncedAt = null;
        myDeltaToPreviousLapMs = null;
        if (data?.phase) currentPhase = data.phase;
        const overlay = document.getElementById('countdown-overlay');
        const num = document.getElementById('countdown-number');
        const lightsBoard = document.getElementById('lights-board');
        if (data?.phase === 'race') {
            // Le 5 luci si spengono tutte insieme, sincronizzate con l'arrivo
            // di questo stesso evento (niente testo "GO!" per la gara, lo
            // spegnimento simultaneo è già il segnale di partenza).
            accendiSemafori(0);
            // Lo sguardo torna sulla pista, con calma: il ritorno dura quasi
            // il doppio della salita (vedi SGUARDO_GIU_MS).
            sguardoObiettivo = 0;
            // Suono diverso e più lungo di quello delle singole luci: è
            // l'unico momento in cui il semaforo dice di andare, e all'orecchio
            // non deve poter passare per la sesta accensione.
            bipSemaforo(940, 0.42, 0.2);
            document.querySelectorAll('.light-bulb').forEach(b => b.classList.remove('on'));
        } else {
            num.textContent = 'GO!'; num.style.color = '#2ecc71';
        }
        overlay.style.background = 'transparent';
        document.getElementById('timer-speed-panel').style.display = (data?.phase === 'qualifying' || data?.phase === 'race') ? 'flex' : 'none';
        setTimeout(() => {
            overlay.style.display = 'none';
            lightsBoard.style.display = 'none';
        }, 800);
        // Rinfresca il box giri appena la sessione (qualifica o gara) parte
        // davvero: senza questo restava il valore lasciato dalla fase
        // precedente (es. "1/1" della qualifica per tutto il 1° giro di gara).
        setLapDisplay(0, data?.phase);
        sendInputs();
    });

    socket.on('f1LapUpdate', ({ color, lap, phase }) => {
        if (color !== myColor) return;
        setLapDisplay(lap, phase);
    });

    // Penalità collisione: il badge "!" (già presente in classifica per chi
    // ha una collisionPenaltyMs > 0, vedi renderStandingRowContent) si
    // espande temporaneamente per mostrare i secondi appena aggiunti, poi
    // si richiude tornando al solo "!" — che resta per tutta la gara.
    socket.on('f1CollisionPenalty', ({ color, penaltyMs }) => {
        const rowEl = standingRowEls[color];
        if (!rowEl) return;
        const el = rowEl.querySelector('.collision-badge');
        if (!el) return;
        const secs = (penaltyMs / 1000).toFixed(1);
        anime.timeline({ easing: 'easeOutQuad' })
            .add({
                targets: el, scale: [1, 1.3], width: [14, 46], duration: 200,
                complete: () => { el.textContent = `+${secs}s`; }
            })
            .add({ targets: el, duration: 1200 })
            .add({
                targets: el, scale: 1, width: 14, duration: 200,
                complete: () => { el.textContent = '!'; }
            });
    });

    // ── SIPARIO DELLA TRANSIZIONE ──────────────────────────────────────
    // La sequenza qualifica→gara deve possedere lo schermo dall'inizio alla
    // fine. Il server riposiziona le auto in griglia nell'istante in cui la
    // qualifica chiude, quindi ogni frame in cui la sequenza non copre niente
    // mostra la scena di gioco: in playtest si vedeva "per un secondo la
    // macchina in griglia di partenza, poi spunta l'animazione POLE".
    // Il sipario sale subito e resta su fino al riepilogo, che ha la
    // panoramica del circuito come sfondo e quindi se lo prende lui.
    function sipario(su, durataMs) {
        const el = document.getElementById('transizione-sipario');
        if (!el) return;
        if (su) el.style.display = 'block';
        if (typeof anime !== 'function') {
            el.style.opacity = su ? '1' : '0';
            if (!su) el.style.display = 'none';
            return;
        }
        anime.remove(el);
        anime({
            targets: el,
            opacity: su ? 1 : 0,
            duration: durataMs != null ? durataMs : (su ? 100 : 420),
            easing: 'linear',
            complete: () => { if (!su) el.style.display = 'none'; },
        });
    }

    // ── SCOPERTA DELLA POSIZIONE IN GRIGLIA ────────────────────────────
    // Il conteggio parte dall'ULTIMA posizione e risale, rallentando, fino a
    // fermarsi sulla propria: più a lungo scorre, meglio sei andato, e chi fa
    // la pole se lo vede correre fino in fondo. Sostituisce la rivelazione
    // lettera per lettera, che dava lo stesso peso a chiunque.
    //
    // Nessun colore né nome di altri piloti: si vedono solo numeri, quindi non
    // anticipa niente della griglia altrui (lo stesso vincolo che vale per il
    // pannello di attesa in qualifica).
    function scopriPosizione(miaPosizione, totale, durataMs, isPole) {
        const overlay = document.getElementById('grid-reveal');
        if (!overlay) return Promise.resolve();
        const numero = document.getElementById('reveal-numero');
        const etichetta = document.getElementById('reveal-etichetta');
        const pole = document.getElementById('reveal-pole');
        const anello = document.getElementById('reveal-anello');
        const raggi = document.getElementById('reveal-raggi');

        // Stato di partenza: tutto spento, nessun residuo del giro prima.
        overlay.style.display = 'flex';
        numero.classList.toggle('e-pole', !!isPole);
        anello.classList.toggle('e-pole', !!isPole);
        etichetta.style.opacity = 0;
        pole.style.opacity = 0;
        anello.style.opacity = 0;
        raggi.style.opacity = 0;
        numero.textContent = ' ';

        const durata = Math.max(1200, durataMs || 3400);
        if (typeof anime !== 'function') {
            numero.textContent = 'P' + miaPosizione;
            etichetta.style.opacity = 1;
            if (isPole) pole.style.opacity = 1;
            return new Promise(r => setTimeout(() => {
                overlay.style.display = 'none';
                r();
            }, durata));
        }

        // Quanti scatti: dall'ultima posizione fino alla propria. Chi è ultimo
        // ne vede uno solo, chi è in pole li vede tutti — ed è il punto.
        const scatti = Math.max(1, (totale - miaPosizione) + 1);
        const tEtichetta = durata * 0.14;
        // Il conteggio si prende la fetta maggiore: con pochi piloti gli
        // scatti sono pochi e la curva li comprime tutti all'inizio, quindi il
        // problema non è quanti sono ma quanta corsa hanno (in playtest, con
        // sei piloti: "leggermente veloce").
        const tConteggio = durata * 0.52;
        const tArrivo = durata - tEtichetta - tConteggio;

        return new Promise(risolvi => {
            const linea = anime.timeline({
                complete: () => { overlay.style.display = 'none'; risolvi(); },
            });

            linea.add({
                targets: etichetta,
                opacity: [0, 1], letterSpacing: ['0.6em', '0.42em'],
                duration: tEtichetta, easing: 'easeOutQuad',
            }, 0);

            // Il conteggio. Una sola animazione con `update`, non N animazioni
            // incatenate: il numero mostrato si ricava dal progresso, con una
            // curva che decelera — così gli ultimi scatti si leggono uno per
            // uno mentre i primi sfrecciano.
            const stato = { t: 0 };
            let ultimoMostrato = null;
            linea.add({
                targets: stato,
                t: 1,
                duration: tConteggio,
                // easeOutCubic e non easeOutQuart: la quarta potenza fa
                // sfrecciare i primi scatti al punto che con pochi piloti se
                // ne leggono solo gli ultimi due.
                easing: 'easeOutCubic',
                update: () => {
                    const passo = Math.min(scatti - 1, Math.floor(stato.t * scatti));
                    const valore = totale - passo;
                    if (valore !== ultimoMostrato) {
                        ultimoMostrato = valore;
                        numero.textContent = 'P' + valore;
                        // Uno scatto, un clic. La frequenza sale con la
                        // posizione: il suono dice la stessa cosa del numero.
                        ticPosizione(totale > 1 ? (totale - valore) / (totale - 1) : 1);
                    }
                },
                // Il colpo d'arrivo si aggancia alla FINE del conteggio, che
                // è l'istante esatto in cui il numero si pianta. Legarlo al
                // `begin` dell'animazione successiva sarebbe la stessa cosa
                // solo se i callback dei figli di una timeline scattassero
                // sempre al loro turno — e in questo file abbiamo appena
                // scoperto che sui VALORI non è così.
                complete: () => colpoArrivo(isPole),
            }, tEtichetta);

            // L'arrivo: il numero si pianta, l'anello parte dal centro.
            //
            // ⚠️ `keyframes` e non una coppia [da, a]. In una timeline di
            // anime.js una proprietà animata UNA SOLA VOLTA applica il proprio
            // valore di partenza già da t=0, non quando arriva il suo turno:
            // l'anello scritto come `opacity: [0.85, 0]` stava a 0.85 fin
            // dall'inizio, cioè un cerchietto fermo dietro i numeri che
            // scorrevano, e solo dopo si allargava (segnalato in playtest).
            // Col primo fotogramma a opacità 0 il valore applicato prima del
            // turno è quello invisibile, che è ciò che serve.
            const arrivo = tEtichetta + tConteggio;
            linea.add({
                targets: numero,
                keyframes: [
                    { scale: 1, duration: 1 },
                    { scale: 1.35, duration: tArrivo * 0.12, easing: 'easeOutQuad' },
                    { scale: 1, duration: tArrivo * 0.26, easing: 'easeOutBack' },
                ],
            }, arrivo);
            linea.add({
                targets: anello,
                keyframes: [
                    { opacity: 0, scale: 0.2, duration: 1 },
                    { opacity: 0.85, duration: 40, easing: 'linear' },
                    { opacity: 0, scale: isPole ? 2.6 : 1.9, duration: tArrivo * 0.55, easing: 'easeOutQuad' },
                ],
            }, arrivo + tArrivo * 0.1);

            // Solo la pole si prende raggi e scritta: è l'unica differenza di
            // trattamento, richiesta esplicitamente.
            if (isPole) {
                linea.add({
                    targets: raggi,
                    opacity: [0, 1], rotate: ['0deg', '14deg'],
                    duration: tArrivo * 0.5, easing: 'easeOutQuad',
                }, arrivo);
                linea.add({
                    targets: pole,
                    opacity: [0, 1], translateY: [16, 0], letterSpacing: ['0.6em', '0.36em'],
                    duration: tArrivo * 0.42, easing: 'easeOutExpo',
                }, arrivo + tArrivo * 0.12);
            }

            // Uscita: tutto svanisce insieme. Il sipario dietro resta su, così
            // fra questo momento e il prossimo non si rivede la pista.
            linea.add({
                targets: [numero, etichetta, pole, raggi],
                opacity: 0,
                duration: tArrivo * 0.26, easing: 'easeInQuad',
            }, durata - tArrivo * 0.26);
        });
    }

    // Fine qualifica: rivelazione personale (POLE per il 1°, "P<n>" per tutti
    // gli altri, ognuno vede solo la propria — ricavata dalla propria posizione
    // nella griglia condivisa, nessun evento dedicato per-utente necessario),
    // poi la griglia di partenza completa (riusa il modal del podio) per il
    // resto della finestra prima del countdown di gara (si chiude da sé al
    // prossimo f1Countdown, vedi handler sopra).
    // Finestra di grazia di fine qualifica (Rif. design 2026-08-07): NON
    // mostra il conteggio (anche "X su N" anonimo può far intuire il proprio
    // piazzamento prima della rivelazione — segnalato dall'utente) — l'unico
    // uso di questo evento è nascondere l'overlay appena TUTTI (bot compresi)
    // hanno tagliato il traguardo, senza aspettare f1QualiEnded (che arriva
    // comunque un istante dopo, stesso tick server): senza questo l'overlay
    // poteva restare a schermo un frame in più, sovrapposto alla griglia finale.
    socket.on('f1QualiWaiting', ({ finished, total }) => {
        if (finished >= total) {
            qualiSessionOpen = false;
            document.getElementById('quali-waiting-overlay').style.display = 'none';
        }
    });

    // Numero di sequenza della transizione in corso. Serve a fermare i pezzi
    // ancora in coda (lo stacco dura secondi, e nel frattempo può arrivare un
    // f1Countdown o un rientro in lobby): ogni passo controlla di essere
    // ancora quello corrente prima di mettersi a schermo.
    let sequenzaCorrente = 0;

    // Silenzio durante la transizione qualifica→gara. Le auto vengono
    // riposizionate in griglia nell'istante stesso in cui la qualifica
    // chiude, e i loro motori continuano a suonare dietro le schermate: al
    // playtest si sentiva "un rumore di motori" proprio mentre partiva lo
    // stacco. Un solo interruttore sul listener invece di inseguire il suono
    // di ogni singola auto.
    function silenzioTransizione(attivo) {
        if (listener && typeof listener.setMasterVolume === 'function') {
            listener.setMasterVolume(attivo ? 0 : 1);
        }
    }

    socket.on('f1QualiEnded', async ({ grid, trackName, sequenza }) => {
        // Chiusura DEFINITIVA (non lo stato del giocatore, vedi dichiarazione
        // di qualiSessionOpen sopra): da qui in poi, per tutta 'grid_display'
        // (il pannello coi tempi che sta per aprirsi qui sotto), il server
        // non manda più nessun f1StateUpdate — senza questo flag il pannello
        // "in attesa" resterebbe sovrapposto alla griglia per l'intera durata.
        qualiSessionOpen = false;
        document.getElementById('quali-waiting-overlay').style.display = 'none';
        const mia = ++sequenzaCorrente;
        silenzioTransizione(true);
        // Il sipario PRIMA di qualunque animazione: da qui in poi la sequenza
        // possiede lo schermo, e fra un momento e l'altro non si rivede mai la
        // pista con le auto già riposizionate in griglia.
        sipario(true);
        const seq = sequenza || {};
        const myPos = (grid || []).findIndex(e => e.color === myColor) + 1;
        const isPole = myPos === 1;
        // Subito, non al riepilogo: davanti ci sono otto secondi di schermo
        // coperto in cui il modello puo' arrivare con calma (vedi
        // preparaAutoInPole).
        nascondiAutoInPole();
        preparaAutoInPole((grid || [])[0]);

        // ── 1. STACCO ──────────────────────────────────────────────────
        // Copre il salto dalla pista alla schermata di griglia, che era la
        // parte brusca. Le durate le decide il server (vedi le costanti SEQ_*
        // in f1GameSocket.js): qui non se ne tiene una copia.
        await F1Sting.play({
            durataMs: seq.staccoMs,
            titolo: trackName || '',
            sottotitolo: 'GRIGLIA DI PARTENZA',
        });
        if (mia !== sequenzaCorrente) return;

        // ── 2. SCOPERTA DELLA PROPRIA POSIZIONE ────────────────────────
        // Il tempo in più della pole viene da qui: stesso monte totale per
        // tutti, distribuito diverso (vedi SEQ_POLE_EXTRA_MS lato server).
        if (myPos > 0) {
            const durataScoperta = (seq.posizioneMs || 0) + (isPole ? (seq.poleExtraMs || 0) : 0);
            await scopriPosizione(myPos, (grid || []).length, durataScoperta, isPole);
            if (mia !== sequenzaCorrente) return;
        }

        // ── 3. RIEPILOGO CON LA GRIGLIA COMPLETA ───────────────────────
        // Qui il sipario cede il posto al circuito vero: la camera comincia
        // una lenta panoramica dall'alto sulla zona del traguardo e il
        // pannello ci si posa sopra.
        const restaAlRiepilogo = Math.max(1500,
            (seq.totaleMs || 0) - (seq.staccoMs || 0)
            - (seq.posizioneMs || 0) - (isPole ? (seq.poleExtraMs || 0) : 0));
        avviaPanoramica(restaAlRiepilogo);
        mostraRiepilogoGriglia(grid || [], trackName, restaAlRiepilogo);
        mostraAutoInPole();
        sipario(false, 520);
    });

    // m:ss.mmm — il formato dei tempi sul giro in tutto il gioco.
    function formattaTempoGiro(ms) {
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        return `${m}:${String(s).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
    }

    // Pannello del riepilogo: la griglia completa coi tempi della qualifica.
    // Le righe entrano una dopo l'altra dall'ULTIMA verso la pole, così lo
    // sguardo risale la classifica e finisce sulla riga d'oro invece di
    // trovarsi davanti un elenco già fatto.
    function mostraRiepilogoGriglia(griglia, nomePista, durataMs) {
        const box = document.getElementById('grid-summary');
        const lista = document.getElementById('gs-lista');
        const circuito = document.getElementById('gs-circuito');
        if (!box || !lista) return;

        if (circuito) circuito.textContent = nomePista || '';
        const pole = griglia.length ? griglia[0].time : null;
        lista.innerHTML = griglia.map((riga, i) => {
            const mio = riga.color === myColor;
            // Le caselle si alternano ai due lati del nastro, come lo
            // schieramento dipinto in pista: dispari a sinistra, pari a
            // destra e sfalsate indietro.
            const classi = ['gs-casella', i % 2 ? 'a-destra' : 'a-sinistra'];
            if (i === 0) classi.push('e-pole');
            if (mio) classi.push('sono-io');
            // Dalla seconda posizione in giù si mostra il DISTACCO dalla pole
            // invece del tempo assoluto: è il numero che dice qualcosa a
            // colpo d'occhio, ed è come lo si legge in televisione.
            let tempo;
            if (riga.time === null) tempo = '—';
            else if (i === 0 || pole === null) tempo = formattaTempoGiro(riga.time);
            else tempo = '+' + ((riga.time - pole) / 1000).toFixed(3);
            const etichetta = mio ? 'Tu' : (riga.isBot ? 'Bot' : 'Pilota');
            return `<li class="${classi.join(' ')}">
                <span class="gs-pos">${i + 1}</span>
                <span class="gs-barra" style="background:${riga.color}"></span>
                <span class="gs-chi">${etichetta}</span>
                <span class="gs-tempo">${tempo}</span>
            </li>`;
        }).join('');

        box.style.display = 'block';
        const righe = lista.querySelectorAll('.gs-casella');
        if (typeof anime !== 'function') {
            righe.forEach(r => { r.style.opacity = 1; });
            return;
        }
        // Le righe hanno opacity 0 nel CSS: senza, il pannello lampeggerebbe
        // completo per un frame prima che l'animazione lo prenda in mano.
        anime({
            targets: righe,
            opacity: [0, 1],
            // Ognuna entra dal PROPRIO lato del nastro, non tutte da destra:
            // così il movimento racconta lo schieramento invece di
            // attraversarlo.
            translateX: (el) => (el.classList.contains('a-destra') ? [54, 0] : [-54, 0]),
            // `from: 'last'` fa entrare prima l'ultimo classificato: si risale
            // la griglia, come nel conteggio della scoperta.
            delay: anime.stagger(Math.min(90, (durataMs * 0.34) / Math.max(1, righe.length)), { from: 'last' }),
            duration: 420,
            easing: 'easeOutQuad',
        });
    }

    function nascondiRiepilogoGriglia() {
        const box = document.getElementById('grid-summary');
        if (box) box.style.display = 'none';
    }

    // ── L'AUTO IN POLE NEL RIEPILOGO ────────────────────────────────────
    // Il modello vero di chi ha fatto la pole, con la SUA livrea, nella metà
    // destra dello schermo mentre il pannello elenca la griglia.
    //
    // È appeso alla CAMERA, non alla scena: la camera intanto sta facendo la
    // panoramica del circuito, e un'auto posata nel mondo scorrerebbe via
    // insieme al paesaggio. Appesa alla camera resta ferma sullo schermo
    // mentre dietro il circuito scorre — che è esattamente l'effetto voluto.
    //
    // Nessuna rotazione, solo un orientamento fisso di tre quarti col muso
    // verso il centro dello schermo (richiesta esplicita dell'utente).
    const VETRINA_DISTANZA = 10;    // unità davanti alla camera
    const VETRINA_FRAZIONE_X = 0.72; // centro della colonna destra, in frazione di schermo
    // Quanto l'auto è girata RISPETTO A CHI LA GUARDA, non rispetto allo
    // schermo. 0 sarebbe un frontale puro, π/2 un fianco: 0.68 rad (39°) è il
    // tre quarti anteriore classico.
    const VETRINA_TRE_QUARTI = 0.68;
    // Vedere l'auto dall'alto e tenerla al centro dello schermo sono due cose
    // che si escludono, se la si abbassa e basta: la camera guarda in
    // orizzontale, quindi più la si scopre dall'alto più scende nel quadro. Il
    // primo tentativo faceva così e l'auto finiva col fondo allineato al
    // fondo del pannello (segnalato in playtest).
    //
    // Si separano: la POSIZIONE la decide l'inquadratura, l'INCLINAZIONE
    // decide quanto se ne vede il dorso. L'auto viene coricata verso chi
    // guarda di 0.20 rad (11.5°) — la posa da vetrina, non una macchina in
    // salita: sotto non c'è terreno con cui confrontarla, galleggia sulla
    // panoramica del circuito.
    const VETRINA_INCLINAZIONE = 0.20;
    // Altezza del CENTRO dell'auto nel quadro, in frazione di mezza altezza:
    // 0 è il centro esatto, negativo sotto. Appena sotto la metà, che è dove
    // sta comodo un soggetto con del testo a fianco.
    const VETRINA_FRAZIONE_Y = -0.08;
    const VETRINA_LARGHEZZA_MIN = 900;   // sotto, la colonna non c'è (vedi f1.css)
    let autoInPole = null;
    let autoInPoleAltezza = 1.8;   // misurata sul modello vero appena caricato

    function posizionaAutoInPole() {
        if (!autoInPole) return;
        // Ricavata dal campo visivo invece che scritta a mano: così l'auto sta
        // nella colonna destra su qualunque proporzione di schermo.
        const mezzaAltezza = Math.tan((camera.fov / 2) * Math.PI / 180) * VETRINA_DISTANZA;
        const mezzaLarghezza = mezzaAltezza * camera.aspect;
        const x = (VETRINA_FRAZIONE_X - 0.5) * 2 * mezzaLarghezza;
        // L'origine del modello sta a terra, fra le ruote: per avere il CENTRO
        // dell'auto all'altezza voluta nel quadro va abbassata di mezza altezza.
        const y = VETRINA_FRAZIONE_Y * mezzaAltezza - autoInPoleAltezza / 2;
        autoInPole.position.set(x, y, -VETRINA_DISTANZA);

        // ⚠️ La rotazione NON è un numero fisso, e il motivo è la ragione per
        // cui il primo tentativo mostrava un frontale invece di un tre quarti
        // (segnalato in playtest). L'auto non sta al centro dello schermo ma
        // spostata a destra: la camera la guarda quindi già di sbieco, di un
        // angolo φ = atan(x / distanza) — con questa disposizione, 27°. Una
        // rotazione fissa di -31° cancellava quasi esattamente quei 27° e
        // rimetteva l'obiettivo davanti al muso.
        //
        // Quello che conta è l'angolo fra il muso e la direzione da cui la si
        // guarda, non quello rispetto allo schermo. Togliendo φ si ottiene
        // sempre lo stesso tre quarti, a qualunque proporzione di finestra.
        // Il segno negativo tiene il muso rivolto verso il centro, cioè verso
        // il pannello della griglia.
        const scorcio = Math.atan2(x, VETRINA_DISTANZA);
        // Prima l'imbardata nel sistema dell'auto, poi l'inclinazione in
        // quello della camera: nell'ordine opposto l'auto risulterebbe
        // coricata di lato invece che verso chi guarda. Un quaternione e non
        // gli angoli di Eulero, che qui sarebbero solo un modo più oscuro di
        // scrivere la stessa composizione.
        const imbardata = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0), -(VETRINA_TRE_QUARTI + scorcio));
        const inclinazione = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0), VETRINA_INCLINAZIONE);
        autoInPole.quaternion.copy(inclinazione).multiply(imbardata);
    }

    // Il modello si prepara all'INIZIO della sequenza, non quando serve.
    //
    // Caricarlo al momento del riepilogo lo faceva comparire con tre o quattro
    // secondi di ritardo rispetto al pannello (segnalato in playtest): fra
    // richiesta della livrea, lettura del .glb e ricolorazione della palette
    // c'è lavoro vero, e il riepilogo dura dieci secondi in tutto. Ma davanti
    // al riepilogo ci sono lo stacco e la scoperta della posizione, cioè otto
    // secondi di schermo coperto in cui non si sta facendo altro: il modello
    // arriva pronto.
    let autoInPolePronta = null;

    function preparaAutoInPole(entry) {
        autoInPolePronta = null;
        if (!entry || window.innerWidth <= VETRINA_LARGHEZZA_MIN) return;
        const miaSequenza = sequenzaCorrente;

        // La livrea si chiede per uid, come per gli avversari in pista. Bot e
        // ospiti non ne hanno: resta null e l'auto prende il colore di lobby.
        autoInPolePronta = fetchLiveryForUid(entry.isBot ? null : entry.uid)
            .then((livrea) => new Promise((risolvi) => {
                loadCarModel(entry.color, risolvi, livrea);
            }))
            .then((car) => {
                // Caricata ma non ancora in scena: loadCarModel la posa nel
                // mondo, e senza questo resterebbe all'origine del circuito
                // finché non la si aggancia alla camera.
                car.visible = false;
                if (miaSequenza !== sequenzaCorrente) { smaltisciAuto(car); return null; }

                // Il motore no: questa è una vetrina, non un'auto in pista.
                if (car.userData.engineSound) {
                    try { car.userData.engineSound.stop(); } catch (e) { /* mai partito */ }
                    car.remove(car.userData.engineSound);
                    delete car.userData.engineSound;
                }
                // Nemmeno le ombre: un'auto appesa alla camera proietterebbe
                // la sua ombra in un punto qualsiasi del circuito sotto.
                car.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });

                // Altezza vera del modello: serve a metterlo all'elevazione
                // voluta, che si misura sul suo centro (vedi posizionaAutoInPole).
                const scatola = new THREE.Box3().setFromObject(car);
                const h = scatola.max.y - scatola.min.y;
                if (isFinite(h) && h > 0) autoInPoleAltezza = h;
                return car;
            })
            .catch(() => null);
    }

    // Ritardo prima che l'auto entri, DOPO che il pannello è comparso. Non è
    // attesa tecnica — a questo punto il modello è già pronto — ma la pausa
    // che rende l'ingresso una scelta: "mi piace l'idea di far sfilare la
    // macchina dal lato, quel secondo di suspence ci sta".
    const VETRINA_ATTESA_MS = 600;

    function mostraAutoInPole() {
        if (!autoInPolePronta) return;
        const miaSequenza = sequenzaCorrente;
        autoInPolePronta.then((car) => {
            if (!car) return;
            if (miaSequenza !== sequenzaCorrente) { smaltisciAuto(car); return; }
            setTimeout(() => {
                if (miaSequenza !== sequenzaCorrente) { smaltisciAuto(car); return; }
                camera.add(car);
                autoInPole = car;
                posizionaAutoInPole();
                car.visible = true;

                if (typeof anime === 'function') {
                    // Entrata di sola traslazione, da destra. Nessuna
                    // rotazione: l'orientamento è quello e resta quello.
                    const arrivo = car.position.x;
                    anime({
                        targets: car.position,
                        x: [arrivo + mezzaLarghezzaCorrente() * 1.6, arrivo],
                        duration: 900,
                        easing: 'easeOutExpo',
                    });
                }
            }, VETRINA_ATTESA_MS);
        });
    }

    function mezzaLarghezzaCorrente() {
        const mezzaAltezza = Math.tan((camera.fov / 2) * Math.PI / 180) * VETRINA_DISTANZA;
        return mezzaAltezza * camera.aspect;
    }

    function smaltisciAuto(car) {
        car.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            const materiali = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
            for (const m of materiali) {
                if (m.map) m.map.dispose();
                m.dispose();
            }
        });
    }

    // ── PREMIAZIONE DI FINE GARA ────────────────────────────────────────
    // Podio e le tre auto sul rettilineo del traguardo, con tribune e ponte
    // semafori dietro.
    //
    // Perché NON si usa il podio della scenografia, che pure c'è ed è lì
    // apposta: misurato, un'auto è 3.46 larga per 7.17 LUNGA e un gradino è
    // 4.00 x 4.00 — l'auto è quasi il doppio più lunga del gradino. Perché ci
    // stia sopra il podio va ingrandito almeno 1.6 volte, e attorno a quello
    // della scenografia non c'è spazio: 7.9 unità libere su monte-rosso
    // (poi c'è una tenda del paddock), 8.8 su prova (una barriera), cioè al
    // massimo x1.13 e x1.26. Ingrandirlo lì dentro vorrebbe dire sfondare la
    // scenografia su due circuiti su tre.
    //
    // La premiazione istanzia quindi un podio suo, e quello sul circuito
    // resta intatto dov'è. Il rettilineo del traguardo è il posto giusto: è
    // piatto, è largo 22-28 contro i 19.2 del podio ingrandito, ed è libero
    // da scenografia per costruzione — nulla viene mai piazzato sull'asfalto.
    const CER_SCALA = 1.6;
    // Piani di calpestio dei tre gradini, misurati sul modello (unità non
    // scalate): x, quota, z. L'origine del podio sta a terra, il fronte è +Z.
    const CER_GRADINI = [
        { x: 0.0, y: 3.00, z: 1.50 },   // 1° — quello alto, al centro
        { x: -4.0, y: 2.20, z: 1.50 },  // 2° — a sinistra guardando il podio
        { x: 4.0, y: 1.60, z: 1.50 },   // 3° — a destra
    ];
    // Da quanto lontano la si guarda. Il vincolo è l'ALTEZZA del podio (14.4
    // unità una volta ingrandito): a 24 unità occupa il 47% dello schermo in
    // verticale, che lascia aria sopra e sotto per la fascia dei risultati.
    // La larghezza non è mai il vincolo, ci sta con metà campo visivo.
    const CER_DISTANZA = 24;
    const CER_QUOTA_CAMERA = 7;
    const CER_MIRA_Y = 5;        // fra le auto e la base del fondale
    const CER_AVVICINAMENTO = 4; // di quanto la camera si avvicina durante la scena

    // ── PREMIAZIONE DI FINE MONDIALE ────────────────────────────────────
    // Non e' la cerimonia di fine gara con un titolo diverso: li' le tre auto
    // sono gia' sul podio quando la scena si apre, qui SALGONO una alla volta,
    // dalla terza alla prima, e ognuna ha il suo momento. Richiesta esplicita
    // dell'utente: «il mondiale e' una cosa molto piu' grossa della vittoria di
    // una singola gara, non vorrei semplicemente riusare l'animazione del
    // podio». Il podio e la sua scala restano gli stessi (CER_*): a cambiare e'
    // chi c'e' sopra, quando ci arriva e da dove lo si guarda.
    //
    // I tempi non sono qui: stanno in shared/f1Premiazione.js, che gira anche
    // senza browser ed e' l'unico posto dove l'ordine delle entrate si puo'
    // verificare davvero.
    // Le auto entrano DI LATO, non lungo l'asse del rettilineo: da li' dovrebbero
    // attraversare il podio, che sta esattamente in mezzo (19.2 unita' di
    // larghezza una volta ingrandito). Entrano da fuori inquadratura, sfilano
    // fino alla loro piazzola e negli ultimi metri si girano verso chi guarda.
    const PRE_INGRESSO_X = 30;       // da quanto fuori campo entra un'auto
    const PRE_PIAZZOLA_Z = 9;        // dove si ferma prima di salire, davanti al podio
    const PRE_GIRATA = 0.72;         // da che punto dell'arrivo comincia a girarsi
    const PRE_ARCO = 1.2;            // quanto scavalca il bordo del gradino salendo
    const PRE_CAM_VICINO = { distanza: 16, quota: 3.2, mira: 3.4 };
    const PRE_CAM_LARGO = { distanza: 30, quota: 12, mira: 5.5 };
    // La parata sta in colonna DIETRO il podio, sull'asfalto, come una griglia
    // ancora schierata. Non ai fianchi: il podio ingrandito occupa 19.2 unita' e
    // il rettilineo del traguardo ne e' largo 22-28, quindi di fianco non c'e'
    // spazio che non sia gia' erba, barriera o tribuna. Non davanti: la camera
    // guarda da 16 unita' e ci finirebbero addosso.
    const PRE_PARATA_MAX = 8;
    const PRE_PARATA_X = 5.5;        // due colonne, dentro la carreggiata su qualunque pista
    const PRE_PARATA_Z = -12;        // oltre il podio, che arriva a 3.2
    const PRE_PARATA_PASSO = 9;      // un'auto e' lunga 7.17: sotto questo passo si toccano

    // I tempi dei due movimenti che precedono la consegna. Quelli DENTRO la
    // consegna stanno in shared/f1Premiazione.js.
    const PRE_STING_MS = 4200;
    const PRE_GARA_MS = 1700;        // quanto resta a schermo ogni tappa dell'annata
    const PRE_ANNATA_MIN = 6000;     // sotto questa soglia il racconto non e' un racconto

    // IL TROFEO — l'asset lo consegna l'utente, e potrebbe non esserci.
    //
    // Sta ai piedi del podio, al centro, e compare quando il campione e' salito:
    // prima non avrebbe senso, e in mezzo alla salita l'auto ci passa sopra.
    // La quota 2.2 e' scelta apposta perche' l'auto in salita passa a 2.4 e non
    // lo sfiori.
    //
    // Non si concorda nessuna scala con chi lo modella: il modello viene
    // normalizzato dal suo ingombro reale.
    const PRE_TROFEO_PATH = '/assets/custom/circuit/trophy.glb';
    const PRE_TROFEO_ALTEZZA = 2.2;
    const PRE_TROFEO_POS = { x: 0, y: 0, z: 3.9 };   // il podio arriva a 3.2: appena davanti

    // LA FESTA DELL'APOTEOSI — di notte i fuochi d'artificio, di giorno le
    // frecce tricolori. La scelta la fa il CIRCUITO dell'ultima gara, che e'
    // quello caricato in scena: di giorno un fuoco d'artificio non si vede
    // (era il dubbio dell'utente), e di notte tre aerei bianchi contro il cielo
    // nero nemmeno.
    // Le quote sono misurate sull'inquadratura larga dell'apoteosi (camera 30
    // indietro, 12 di quota, mira a 5.5, FOV 65): sopra le 28 unita' uno
    // scoppio vicino esce dal quadro, e un aereo a 46 si vede solo quando e'
    // gia' lontanissimo. Una festa fuori campo e' una festa che non c'e'.
    const PRE_RAZZI = 5;
    const PRE_RAZZO_QUOTA = [18, 28];      // dove scoppia, sopra il podio
    const PRE_RAZZO_SPARSO = 26;           // di quanto si allarga la rosa dei lanci
    const PRE_JET_QUOTA = 26;
    const PRE_JET_PASSAGGIO_MS = 4200;     // da fuori campo a fuori campo
    const PRE_JET_LUNGO = 260;             // quanta pista percorrono nel passaggio
    const PRE_JET_PASSO = 11;              // distanza fra un aereo e l'altro in formazione
    // Verde, bianco, rosso: i tre colori delle scie, e sono anche i tre aerei
    // che le lasciano.
    const PRE_TRICOLORE = [0x2E9E4F, 0xF2F5F5, 0xCE2B37];

    let premiazione = null;          // { scena, copione, righe, da, risolvi }
    // Vale per TUTTA la cerimonia, non solo per la consegna: Esc deve poter
    // interrompere anche il racconto dell'annata, che dura piu' di tutto il
    // resto.
    let premiazioneInCorso = false;
    // Premiazione DI PROVA (tasto F8 in gara veloce): stessa cerimonia, ma alla
    // fine non c'e' nessuna schermata di campionato da riaprire — si torna alla
    // gara da cui e' partita.
    let premiazioneDiProva = false;

    let cerimoniaGruppo = null;
    let cerimoniaPronta = null;
    let cerimoniaAttiva = false;
    let cerimoniaDa = 0;
    let cerimoniaDurata = 1;
    let cerimoniaCam = null;     // { da:{x,y,z}, a:{x,y,z}, mira:{x,y,z} }

    // Direzione di marcia sul traguardo: da lì si ricava tutto il resto.
    function assiDelTraguardo() {
        const n = trackPts.length;
        const i = START_FINISH_INDEX;
        const p = trackPts[i];
        const q = trackPts[(i + 1) % n];
        const dx = q.x - p.x, dz = q.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        return { p, avanti: { x: dx / len, z: dz / len } };
    }

    function costruisciCerimonia(podio) {
        const primi = (podio || []).slice(0, 3);
        if (!primi.length) return Promise.resolve(null);
        const miaSequenza = sequenzaCorrente;

        const caricaPodio = new Promise((risolvi, rifiuta) => {
            new THREE.GLTFLoader().load(SCENERY_ASSET_PATHS.podium,
                (gltf) => risolvi(gltf.scene), undefined, rifiuta);
        });
        const caricaAuto = primi.map((riga) =>
            fetchLiveryForUid(riga.isBot ? null : riga.uid).then((livrea) =>
                new Promise((risolvi) => loadCarModel(riga.color, risolvi, livrea))));

        return Promise.all([caricaPodio, ...caricaAuto]).then(([podioMesh, ...auto]) => {
            const gruppo = new THREE.Group();
            gruppo.visible = false;

            podioMesh.scale.setScalar(CER_SCALA);
            applicaStile(podioMesh, { saturation: ToonPalette.SATURATION.scenery });
            gruppo.add(podioMesh);

            auto.forEach((car, k) => {
                zittisci(car);
                const g = CER_GRADINI[k];
                car.position.set(g.x * CER_SCALA, g.y * CER_SCALA, g.z * CER_SCALA);
                // Muso verso chi guarda: l'avanti dell'auto è +Z locale, ed è
                // anche il fronte del podio. Nessuna rotazione, come per
                // l'auto in pole del riepilogo griglia.
                car.rotation.set(0, 0, 0);
                gruppo.add(car);
            });

            // Posa sul traguardo, col fronte rivolto a chi arriva: le auto
            // guardano indietro lungo il rettilineo, verso la camera.
            const { p, avanti } = assiDelTraguardo();
            gruppo.position.set(p.x, p.y || 0, p.z);
            gruppo.rotation.set(0, Math.atan2(-avanti.x, -avanti.z), 0);

            // L'inquadratura si calcola qui, dove gli assi del traguardo sono
            // già in mano: la camera sta indietro sull'asse della pista e si
            // avvicina piano per tutta la scena.
            const quotaBase = p.y || 0;
            cerimoniaCam = {
                da: { x: p.x - avanti.x * CER_DISTANZA, y: quotaBase + CER_QUOTA_CAMERA, z: p.z - avanti.z * CER_DISTANZA },
                a: {
                    x: p.x - avanti.x * (CER_DISTANZA - CER_AVVICINAMENTO),
                    y: quotaBase + CER_QUOTA_CAMERA - 0.6,
                    z: p.z - avanti.z * (CER_DISTANZA - CER_AVVICINAMENTO),
                },
                mira: { x: p.x, y: quotaBase + CER_MIRA_Y, z: p.z },
            };

            if (miaSequenza !== sequenzaCorrente) { smaltisciAuto(gruppo); return null; }
            scene.add(gruppo);
            cerimoniaGruppo = gruppo;
            return gruppo;
        }).catch(() => null);
    }

    // I colori dei piloti viaggiano come stringhe CSS (#e74c3c): un materiale
    // Three li vuole numerici.
    function coloreEsadecimale(colore) {
        const n = parseInt(String(colore || '').replace('#', ''), 16);
        return Number.isFinite(n) ? n : 0xffffff;
    }

    // Un'auto in mostra non deve rombare. Vale per tutte e due le cerimonie —
    // quella di fine gara e quella di fine mondiale.
    function zittisci(car) {
        if (!car.userData.engineSound) return;
        try { car.userData.engineSound.stop(); } catch (e) { /* mai partito */ }
        car.remove(car.userData.engineSound);
        delete car.userData.engineSound;
    }

    // Il trofeo e' facoltativo: se il file non c'e', la cerimonia gira identica.
    // Un 404 qui non e' un errore da segnalare — e' la risposta alla domanda
    // "c'e' un trofeo?".
    function caricaTrofeo() {
        return new Promise((risolvi) => {
            new THREE.GLTFLoader().load(PRE_TROFEO_PATH,
                (gltf) => risolvi(gltf.scene),
                undefined,
                () => risolvi(null));
        });
    }

    // Un aereo in stile voxel, costruito da codice: nessun asset da procurare,
    // e a quaranta unita' di quota tre scatole ben proporzionate sono tutto
    // quello che si distingue.
    function costruisciAereo() {
        const aereo = new THREE.Group();
        const corpo = new THREE.Mesh(
            new THREE.BoxGeometry(1.1, 1.0, 6.4),
            new THREE.MeshLambertMaterial({ color: 0xE8ECEE }));
        const ali = new THREE.Mesh(
            new THREE.BoxGeometry(7.4, 0.35, 1.6),
            new THREE.MeshLambertMaterial({ color: 0xE8ECEE }));
        ali.position.z = -0.4;
        const deriva = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, 1.5, 1.4),
            new THREE.MeshLambertMaterial({ color: 0xCE2B37 }));
        deriva.position.set(0, 0.9, -2.6);
        aereo.add(corpo); aereo.add(ali); aereo.add(deriva);
        return aereo;
    }

    // La festa: quale delle due, e tutto ciò che le serve. Nasce spenta e si
    // accende nell'apoteosi.
    function costruisciFesta(colori, base, invertiFesta) {
        const notte = invertiFesta ? !(trackData && trackData.notturno)
            : !!(trackData && trackData.notturno);
        const festa = { notte, razzi: [], scoppi: [], aerei: [], scie: [], suonata: false };
        const { p, avanti, quota } = base;
        const destra = { x: -avanti.z, z: avanti.x };

        if (notte) {
            // Un razzo per volta: un cubetto che sale e sparisce, e uno
            // scoppio pronto a fiorire dov'era arrivato.
            const programma = F1SuoniCerimonia.programmaFuochi(
                F1Premiazione.DURATE.apoteosi, PRE_RAZZI);
            const partenze = programma.filter(e => e.tipo === 'fischio');
            partenze.forEach((evento, i) => {
                // Sparsi dietro il podio, mai davanti alla camera.
                const lato = ((i * 53) % 100) / 100 - 0.5;
                const indietro = 10 + ((i * 31) % 100) / 100 * 26;
                const alto = PRE_RAZZO_QUOTA[0]
                    + ((i * 17) % 100) / 100 * (PRE_RAZZO_QUOTA[1] - PRE_RAZZO_QUOTA[0]);
                const px = p.x + avanti.x * indietro + destra.x * lato * PRE_RAZZO_SPARSO;
                const pz = p.z + avanti.z * indietro + destra.z * lato * PRE_RAZZO_SPARSO;

                const colore = colori[i % colori.length];
                const razzo = new THREE.Mesh(
                    new THREE.BoxGeometry(0.5, 0.9, 0.5),
                    new THREE.MeshBasicMaterial({ color: colore }));
                razzo.visible = false;
                ToonStyle.excludeFromOutline(razzo);
                scene.add(razzo);

                const scoppio = costruisciEffettoParticelle(
                    F1Particelle.SCOPPIO, colore, 0.95, { partiPieno: false });
                scoppio.visible = true;
                scene.add(scoppio);

                festa.razzi.push({
                    mesh: razzo, scoppio,
                    da: evento.istanteMs, a: evento.istanteMs + F1SuoniCerimonia.SALITA_MS,
                    base: { x: px, y: quota, z: pz }, alto: quota + alto,
                    esploso: false,
                });
            });
            festa.programmaSuono = programma;
        } else {
            // Cinque aerei in formazione a cuneo, e tre scie tricolori.
            for (let i = 0; i < 5; i++) {
                const aereo = costruisciAereo();
                aereo.visible = false;
                scene.add(aereo);
                // Cuneo: il capoformazione davanti, gli altri due a due dietro
                // e di lato.
                const fila = Math.ceil(i / 2);
                const lato = (i === 0) ? 0 : (i % 2 === 0 ? 1 : -1);
                festa.aerei.push({ mesh: aereo, indietro: fila * PRE_JET_PASSO, lato: lato * fila * PRE_JET_PASSO });
            }
            for (let k = 0; k < PRE_TRICOLORE.length; k++) {
                const scia = costruisciEffettoParticelle(
                    F1Particelle.SCIA_AEREO, PRE_TRICOLORE[k], 0.9, { partiPieno: false });
                scia.visible = true;
                scene.add(scia);
                // Le tre scie stanno sugli aerei 0, 1 e 2: la formazione ne ha
                // cinque, ma tre colori sono tre colori.
                festa.scie.push({ mesh: scia, aereo: k });
            }
            festa.programmaSuono = F1SuoniCerimonia.programmaJet(
                F1Premiazione.DURATE.apoteosi, 1);
        }
        return festa;
    }

    // Fa vivere la festa. `t` e' il tempo trascorso dall'inizio dell'apoteosi;
    // finche' e' negativo non c'e' niente da mostrare.
    function aggiornaFesta(festa, t, dtMs, base) {
        if (!festa) return;
        const { p, avanti, quota } = base;
        const destra = { x: -avanti.z, z: avanti.x };

        // I suoni si programmano tutti in una volta, sull'orologio dell'audio:
        // un setTimeout per ogni botto sarebbe alla merce' del frame rate.
        if (t >= 0 && !festa.suonata) {
            festa.suonata = true;
            const ctx = listener && listener.context;
            if (ctx) {
                if (festa.notte) F1SuoniCerimonia.suonaFuochi(ctx, festa.programmaSuono, 0.7);
                else F1SuoniCerimonia.suonaJet(ctx, festa.programmaSuono, PRE_JET_PASSAGGIO_MS, 0.7);
            }
        }

        if (festa.notte) {
            for (const razzo of festa.razzi) {
                const salita = (t - razzo.da) / Math.max(1, razzo.a - razzo.da);
                if (salita < 0) { razzo.mesh.visible = false; continue; }
                if (salita < 1) {
                    razzo.mesh.visible = true;
                    razzo.mesh.position.set(
                        razzo.base.x,
                        misto(razzo.base.y, razzo.alto, salita * salita),
                        razzo.base.z);
                } else {
                    razzo.mesh.visible = false;
                    if (!razzo.esploso) {
                        razzo.esploso = true;
                        // Tutto il pool nello stesso istante: e' quello che
                        // distingue uno scoppio da un emettitore.
                        const stato = razzo.scoppio.userData.particelle;
                        const config = razzo.scoppio.userData.configParticelle;
                        const ancora = { x: razzo.base.x, y: razzo.alto, z: razzo.base.z, avantiX: 0, avantiZ: 1 };
                        for (let i = 0; i < config.numero; i++) {
                            F1Particelle.rinasci(stato, i, config, ancora);
                        }
                    }
                }
                // `emissione` a zero: nessuno rinasce, la fiammata si spegne.
                aggiornaEffettoParticelle(razzo.scoppio, dtMs || 16, { emissione: 0 });
            }
            return;
        }

        // Di giorno: il passaggio degli aerei.
        const avanzamento = t / PRE_JET_PASSAGGIO_MS;
        for (let i = 0; i < festa.aerei.length; i++) {
            const jet = festa.aerei[i];
            if (avanzamento < 0 || avanzamento > 1.15) { jet.mesh.visible = false; continue; }
            jet.mesh.visible = true;
            // Entrano da dietro la camera e vanno verso l'orizzonte lungo il
            // rettilineo: cosi' la traiettoria e' giusta su qualunque circuito
            // senza doverla tarare pista per pista.
            const lungo = misto(-PRE_JET_LUNGO * 0.55, PRE_JET_LUNGO * 0.75, avanzamento) - jet.indietro;
            jet.mesh.position.set(
                p.x + avanti.x * lungo + destra.x * jet.lato,
                quota + PRE_JET_QUOTA,
                p.z + avanti.z * lungo + destra.z * jet.lato);
            jet.mesh.rotation.y = Math.atan2(avanti.x, avanti.z);
        }
        for (const scia of festa.scie) {
            const jet = festa.aerei[scia.aereo];
            const viva = jet && jet.mesh.visible;
            aggiornaEffettoParticelle(scia.mesh, dtMs || 16, {
                ancora: viva ? {
                    x: jet.mesh.position.x, y: jet.mesh.position.y, z: jet.mesh.position.z,
                    avantiX: avanti.x, avantiZ: avanti.z,
                } : null,
                emissione: viva ? 1 : 0,
            });
        }
    }

    function smaltisciFesta(festa) {
        if (!festa) return;
        const roba = []
            .concat(festa.razzi.map(r => r.mesh))
            .concat(festa.razzi.map(r => r.scoppio))
            .concat(festa.aerei.map(a => a.mesh))
            .concat(festa.scie.map(s => s.mesh));
        for (const oggetto of roba) {
            scene.remove(oggetto);
            smaltisciAuto(oggetto);
        }
    }

    // Podio, auto dei premiati (che partono FUORI CAMPO) e parata di tutte le
    // altre. Restituisce quello che serve ad animarle: per ogni premiato, le
    // tre pose fra cui si muove.
    function costruisciPremiazione(righe, tutte, opzioni) {
        const premiati = (righe || []).slice(0, 3);
        if (!premiati.length) return Promise.resolve(null);
        const miaSequenza = sequenzaCorrente;

        const caricaPodio = new Promise((risolvi, rifiuta) => {
            new THREE.GLTFLoader().load(SCENERY_ASSET_PATHS.podium,
                (gltf) => risolvi(gltf.scene), undefined, rifiuta);
        });
        const caricaAuto = (riga) => fetchLiveryForUid(riga.bot ? null : riga.uid)
            .then((livrea) => new Promise((risolvi) => loadCarModel(riga.colore, risolvi, livrea)));

        const contorno = (tutte || []).slice(3, 3 + PRE_PARATA_MAX);
        return Promise.all([
            caricaPodio,
            Promise.all(premiati.map(caricaAuto)),
            Promise.all(contorno.map(caricaAuto)),
            caricaTrofeo(),
        ]).then(([podioMesh, auto, parata, trofeoMesh]) => {
            const gruppo = new THREE.Group();
            gruppo.visible = false;

            podioMesh.scale.setScalar(CER_SCALA);
            applicaStile(podioMesh, { saturation: ToonPalette.SATURATION.scenery });
            gruppo.add(podioMesh);

            const attori = auto.map((car, k) => {
                zittisci(car);
                const g = CER_GRADINI[k];
                const gradino = { x: g.x * CER_SCALA, y: g.y * CER_SCALA, z: g.z * CER_SCALA };
                const piazzola = { x: gradino.x, y: 0, z: PRE_PIAZZOLA_Z };
                // Ognuno entra dal lato del proprio gradino: meno strada, e le
                // tre entrate non si assomigliano. Il primo, che sta al centro,
                // arriva da destra.
                const lato = gradino.x >= 0 ? 1 : -1;
                const lontano = { x: lato * PRE_INGRESSO_X, y: 0, z: PRE_PIAZZOLA_Z };
                // Muso nella direzione di marcia mentre sfila; a fine corsa si
                // gira verso chi guarda (il fronte dell'auto e' +Z, e +Z e'
                // anche il fronte del podio).
                car.rotation.set(0, -lato * Math.PI / 2, 0);
                car.position.set(lontano.x, lontano.y, lontano.z);
                car.visible = false;      // entra quando tocca a lei
                gruppo.add(car);
                return { car, posto: k + 1, lato, lontano, piazzola, gradino };
            });

            // La parata: ferme ai due lati, muso verso il centro. Non entrano e
            // non si muovono — sono il campo, e sono li' a dire che quello che
            // sta finendo e' un campionato e non una gara.
            parata.forEach((car, k) => {
                zittisci(car);
                const lato = (k % 2 === 0) ? -1 : 1;
                const fila = Math.floor(k / 2);
                car.position.set(lato * PRE_PARATA_X, 0, PRE_PARATA_Z - fila * PRE_PARATA_PASSO);
                // Muso verso il podio: sono schierate a guardare, non parcheggiate.
                car.rotation.set(0, 0, 0);
                gruppo.add(car);
            });

            // Il trofeo, se c'e'. Normalizzato dal suo ingombro: cosi' va bene
            // qualunque scala abbia il file, e non serve mettersi d'accordo con
            // chi lo ha modellato.
            let trofeo = null;
            if (trofeoMesh) {
                const scatola = new THREE.Box3().setFromObject(trofeoMesh);
                const altezza = Math.max(0.001, scatola.max.y - scatola.min.y);
                trofeoMesh.userData.scalaPiena = PRE_TROFEO_ALTEZZA / altezza;
                trofeoMesh.scale.setScalar(trofeoMesh.userData.scalaPiena);
                trofeoMesh.position.set(PRE_TROFEO_POS.x, PRE_TROFEO_POS.y, PRE_TROFEO_POS.z);
                applicaStile(trofeoMesh, { saturation: ToonPalette.SATURATION.scenery });
                trofeoMesh.visible = false;   // compare quando il campione e' sul podio
                gruppo.add(trofeoMesh);
                trofeo = trofeoMesh;
            }

            // Posa sul traguardo, col fronte rivolto a chi arriva: le auto
            // guardano indietro lungo il rettilineo, verso la camera.
            const { p, avanti } = assiDelTraguardo();
            gruppo.position.set(p.x, p.y || 0, p.z);
            gruppo.rotation.set(0, Math.atan2(-avanti.x, -avanti.z), 0);

            // I coriandoli: tre emettitori, uno per colore del podio (una
            // InstancedMesh ha un materiale solo, quindi un colore solo). Vanno
            // nella SCENA e non nel gruppo: le loro particelle vivono in
            // coordinate mondo, come i detriti, e dentro un gruppo ruotato
            // verrebbero trasformate due volte.
            const coriandoli = premiati.map((riga) => {
                const mesh = costruisciEffettoParticelle(
                    F1Particelle.CORIANDOLI, coloreEsadecimale(riga.colore), 0.95, { partiPieno: false });
                mesh.visible = true;
                scene.add(mesh);
                return mesh;
            });

            if (miaSequenza !== sequenzaCorrente) {
                smaltisciAuto(gruppo);
                for (const m of coriandoli) scene.remove(m);
                return null;
            }
            scene.add(gruppo);
            const base = { p, avanti, quota: p.y || 0 };
            const festa = costruisciFesta(
                premiati.map(r => coloreEsadecimale(r.colore)), base, opzioni && opzioni.invertiFesta);
            return { gruppo, attori, trofeo, coriandoli, festa, base };
        }).catch(() => null);
    }

    // Dove sta un premiato in questo istante. Chi e' gia' salito resta sul suo
    // gradino, chi non e' ancora entrato sta fuori campo: i posti scendono
    // (3, 2, 1), quindi "posto minore del mio" vuol dire "il mio momento e'
    // gia' passato".
    function posaPremiato(attore, stato) {
        const suo = stato.posto === attore.posto;
        const passato = stato.posto === 0 || stato.posto < attore.posto;
        const diMarcia = -attore.lato * Math.PI / 2;
        if (passato) return { visibile: true, pos: attore.gradino, rotY: 0 };
        if (!suo) return { visibile: false, pos: attore.lontano, rotY: diMarcia };
        if (stato.fase === 'arrivo') {
            // Frena arrivando: parte veloce e si posa, invece di piantarsi.
            const a = stato.avanzamento;
            const e = a * a * (3 - 2 * a);
            // La girata verso chi guarda comincia negli ultimi metri, non
            // subito: un'auto che sfila gia' girata sembra trascinata di lato.
            const g = Math.max(0, (a - PRE_GIRATA) / (1 - PRE_GIRATA));
            return {
                visibile: true,
                pos: { x: misto(attore.lontano.x, attore.piazzola.x, e), y: 0, z: attore.piazzola.z },
                rotY: misto(diMarcia, 0, g * g * (3 - 2 * g)),
            };
        }
        if (stato.fase === 'salita') {
            const a = stato.avanzamento;
            return {
                visibile: true,
                pos: {
                    x: misto(attore.piazzola.x, attore.gradino.x, a),
                    // L'arco serve a scavalcare il bordo del gradino: senza, la
                    // salita e' una diagonale che ci passa dentro.
                    y: misto(0, attore.gradino.y, a) + 4 * a * (1 - a) * PRE_ARCO,
                    z: misto(attore.piazzola.z, attore.gradino.z, a),
                },
                rotY: 0,
            };
        }
        return { visibile: true, pos: attore.gradino, rotY: 0 };
    }

    function aggiornaPremiazione(dtMs) {
        if (!premiazione || !premiazione.scena) return;
        const stato = F1Premiazione.stato(premiazione.copione, performance.now() - premiazione.da);

        for (const attore of premiazione.scena.attori) {
            const posa = posaPremiato(attore, stato);
            attore.car.visible = posa.visibile;
            attore.car.position.set(posa.pos.x, posa.pos.y, posa.pos.z);
            attore.car.rotation.y = posa.rotY;
        }

        // La camera: addosso a chi sta entrando, larga sull'apoteosi. Durante
        // l'apoteosi si ALZA piano invece di scattare, e per questo la sua posa
        // e' una miscela fra le due e non una delle due.
        const { p, avanti, quota } = premiazione.scena.base;
        const vicino = stato.posto !== 0;
        const apertura = vicino ? 0 : Math.min(1, stato.avanzamento * 1.4);
        const distanza = misto(PRE_CAM_VICINO.distanza, PRE_CAM_LARGO.distanza, apertura);
        const altezza = misto(PRE_CAM_VICINO.quota, PRE_CAM_LARGO.quota, apertura);
        // Di lato quando entra qualcuno che non sta al centro: guardarlo
        // frontalmente lo metterebbe dietro il gradino piu' alto.
        const scarto = vicino ? CER_GRADINI[stato.posto - 1].x * CER_SCALA * 0.6 : 0;
        const destra = { x: -avanti.z, z: avanti.x };
        camera.position.set(
            p.x - avanti.x * distanza + destra.x * scarto,
            quota + altezza,
            p.z - avanti.z * distanza + destra.z * scarto,
        );
        camera.lookAt(p.x, quota + misto(PRE_CAM_VICINO.mira, PRE_CAM_LARGO.mira, apertura), p.z);

        // I coriandoli cadono solo sull'apoteosi. `emissione` a 0 non li spegne
        // a mezz'aria: smette di farne nascere di nuovi e lascia scendere
        // quelli che ci sono, che e' esattamente come finisce una pioggia.
        const cori = premiazione.scena.coriandoli || [];
        if (cori.length) {
            const ancora = {
                x: p.x, y: quota, z: p.z,
                avantiX: avanti.x, avantiZ: avanti.z,
            };
            const emissione = stato.posto === 0 && stato.fase !== 'finita' ? 1 : 0;
            for (const mesh of cori) {
                aggiornaEffettoParticelle(mesh, dtMs || 16, { ancora, emissione });
            }
        }

        // La festa parte con l'apoteosi. Il tempo che le si passa e' quello
        // trascorso da quando e' cominciata, non dall'inizio della cerimonia.
        if (premiazione.scena.festa) {
            const inizioApoteosi = premiazione.copione[premiazione.copione.length - 1].da;
            aggiornaFesta(premiazione.scena.festa,
                (performance.now() - premiazione.da) - inizioApoteosi,
                dtMs, premiazione.scena.base);
        }

        // Il trofeo cresce nei primi istanti dell'apoteosi invece di apparire
        // di colpo: e' l'unico oggetto che entra in scena senza guidarci.
        const trofeo = premiazione.scena.trofeo;
        if (trofeo) {
            const nato = stato.posto === 0 ? Math.min(1, stato.avanzamento * 4) : 0;
            trofeo.visible = nato > 0;
            trofeo.scale.setScalar(trofeo.userData.scalaPiena * (nato > 0 ? nato : 1));
        }

        aggiornaFasciaPremiazione(stato);
        if (stato.fase === 'finita') fermaPremiazione();
    }

    function aggiornaFasciaPremiazione(stato) {
        const riga = stato.posto ? premiazione.righe[stato.posto - 1] : premiazione.righe[0];
        if (!riga) return;
        const fascia = document.getElementById('premiazione-fascia');
        document.getElementById('premiazione-posto').textContent = stato.posto ? stato.posto + '\u00B0' : 'Campione';
        document.getElementById('premiazione-chi').textContent = riga.etichetta;
        document.getElementById('premiazione-pallino').style.background = riga.colore || '#888';
        document.getElementById('premiazione-punti').textContent = riga.punti + ' punti';
        fascia.classList.toggle('campione', stato.posto === 0);
    }

    // Avvia la consegna e si risolve quando e' finita — o quando la si salta.
    // Il server non c'entra: la stagione e' gia' stata salvata dopo l'ultima
    // gara, e qui non c'e' piu' niente da scrivere.
    function avviaConsegna(scena, righe) {
        // Niente scena (modello mancante, WebGL in ginocchio): la cerimonia
        // finisce qui, ma va CHIUSA lo stesso — altrimenti la schermata resta
        // nascosta e l'albo d'oro viene disegnato dietro le quinte.
        if (!scena) { fermaPremiazione(); return Promise.resolve(null); }
        scena.gruppo.visible = true;
        mostraAutoDiGara(false);
        // Stesso piano vicino della panoramica: anche qui si guarda da lontano,
        // e col near di gioco l'asfalto sfarfalla.
        camera.near = PANORAMICA_NEAR;
        camera.updateProjectionMatrix();
        document.getElementById('premiazione-fascia').style.display = '';
        premiazione = {
            scena, righe,
            copione: F1Premiazione.copione(Math.min(3, righe.length)),
            da: performance.now(),
            risolvi: null,
        };
        // Una passata a vuoto prima di scoprire: mette la camera al suo posto e
        // le auto alle loro pose di partenza, cosi' il primo frame visibile e'
        // gia' quello giusto.
        aggiornaPremiazione(0);
        fermaPanoramica();
        sipario(false, 420);
        return new Promise((risolvi) => { premiazione.risolvi = risolvi; });
    }

    // Chiude TUTTA la cerimonia, in qualunque movimento ci si trovi: lo stacco
    // si copre da se', l'annata guarda `premiazioneInCorso` al prossimo passo,
    // la consegna smette qui.
    function fermaPremiazione() {
        premiazioneInCorso = false;
        document.getElementById('premiazione-annata').style.display = 'none';
        document.getElementById('premiazione-attesa').style.display = 'none';
        fermaPanoramica();
        // Si torna sempre a una schermata opaca (riepilogo o albo d'oro): il
        // sipario, se era su, non serve piu' a niente.
        sipario(false, 240);
        if (!premiazione) {
            // Saltata prima della consegna: c'e' solo da riaprire la schermata.
            if (!premiazioneDiProva) document.getElementById('stagione-overlay').style.display = 'flex';
            premiazioneDiProva = false;
            return;
        }
        const finita = premiazione;
        premiazione = null;
        document.getElementById('premiazione-fascia').style.display = 'none';
        if (!premiazioneDiProva) document.getElementById('stagione-overlay').style.display = 'flex';
        premiazioneDiProva = false;
        if (finita.scena) {
            scene.remove(finita.scena.gruppo);
            smaltisciAuto(finita.scena.gruppo);
            for (const mesh of finita.scena.coriandoli || []) {
                scene.remove(mesh);
                if (mesh.material) mesh.material.dispose();
            }
            smaltisciFesta(finita.scena.festa);
        }
        mostraAutoDiGara(true);
        camera.near = nearDiGioco;
        camera.updateProjectionMatrix();
        if (finita.risolvi) finita.risolvi(true);
    }

    // Il materiale della schermata dell'annata: una mappa e una scheda per
    // ogni circuito del calendario. Si prepara PRIMA che la cerimonia
    // cominci — richiesta esplicita dell'utente: «una volta che si arriva a
    // questa animazione non possiamo aspettare che si carichi la mappa».
    //
    // I file delle piste sono piccoli (poche decine di punti di controllo); il
    // lavoro vero e' campionare il tracciato, e si fa una volta sola qui.
    // Una pista che non si carica non ferma niente: quella tappa mostrera' il
    // riquadro vuoto col suo nome.
    const PA_VISTA_W = 700, PA_VISTA_H = 500;

    // La VEDUTA AEREA di un circuito, renderizzata fuori schermo e restituita
    // come immagine.
    //
    // E' la stessa inquadratura della pagina mescole (TrackPreviewShots, scatto
    // 'panoramica') su una scena costruita apposta: asfalto e terreno, niente
    // scenografia. In scena esiste un solo circuito — quello dell'ultima gara —
    // e qui servono tutti quelli del calendario, quindi ognuno si costruisce,
    // si fotografa e si butta.
    function renderaVistaPista(dati) {
        let gruppo = null, target = null;
        try {
            const punti = TrackGeometry.sampleLoop(dati.controlPoints, 500);
            const mezza = dati.roadHalfWidth || 11;
            gruppo = new THREE.Group();
            // Il mondo largo il doppio del necessario: piu' stretto, e nella
            // veduta si vedrebbe finire il terreno con il cielo sotto
            // l'orizzonte.
            TrackMeshBuilder.buildGround(gruppo, punti, mezza + 16, 6000);
            TrackMeshBuilder.buildRibbon(gruppo, punti, mezza, new THREE.MeshStandardMaterial({
                color: ToonPalette.SURFACES.asphalt, roughness: 0.95, side: THREE.DoubleSide,
            }));
            // Stesso trattamento cel-shading del resto del gioco, cosi' la
            // veduta non stona accanto alle altre schermate.
            applicaStile(gruppo, { saturation: ToonPalette.SATURATION.scenery });

            const scena = new THREE.Scene();
            scena.background = new THREE.Color(dati.notturno ? 0x0B1B2B : 0x9FD6EF);
            scena.add(gruppo);
            // La somma delle intensita' resta intorno a 1: e' la regola del cel
            // shading di questo gioco, e vale anche fuori dalla scena vera.
            scena.add(new THREE.HemisphereLight(0xFFFFFF, 0x88AA66, 0.6));
            const sole = new THREE.DirectionalLight(0xFFFFFF, 0.4);
            sole.position.set(0.6, 1.4, 0.8);
            scena.add(sole);

            // L'inquadratura si CALCOLA invece di riusare lo scatto
            // 'panoramica' della pagina mescole: quello e' tarato su una
            // camera che ruota dentro la scena vera, e qui tagliava fuori
            // meta' tracciato (misurato in headless).
            //
            // Due vincoli: il circuito deve entrare in altezza — dove lo
            // scorcio lo schiaccia di sin(inclinazione) — e in larghezza, dove
            // no. Vince il piu' severo. L'inclinazione bassa e' voluta: dai 50
            // gradi in su diventa una piantina vista dall'alto, ed e'
            // esattamente quello che l'utente ha bocciato.
            const c = TrackPreviewShots.ingombro(punti);
            const cam = new THREE.PerspectiveCamera(
                F1SensoVelocita.FOV_BASE, PA_VISTA_W / PA_VISTA_H, 1, 12000);
            const mezzoFov = Math.tan((F1SensoVelocita.FOV_BASE / 2) * Math.PI / 180);
            const inclinazione = 33 * Math.PI / 180;
            const raggio = c.diagonale / 2;
            const distanza = Math.max(
                raggio * Math.sin(inclinazione) / (mezzoFov * 0.82),
                raggio / (mezzoFov * (PA_VISTA_W / PA_VISTA_H) * 0.82));
            // Si guarda dal lato del traguardo: e' il punto che il giocatore
            // riconosce.
            const traguardo = dati.startFinish
                ? TrackGeometry.nearestPoint(punti, dati.startFinish.x, dati.startFinish.z).index
                : 0;
            const sf = punti[traguardo] || { x: c.cx + raggio, z: c.cz };
            const azimut = Math.atan2(sf.z - c.cz, sf.x - c.cx);
            cam.position.set(
                c.cx + Math.cos(azimut) * distanza * Math.cos(inclinazione),
                distanza * Math.sin(inclinazione),
                c.cz + Math.sin(azimut) * distanza * Math.cos(inclinazione));
            cam.lookAt(c.cx, 0, c.cz);

            target = new THREE.WebGLRenderTarget(PA_VISTA_W, PA_VISTA_H);
            const prima = renderer.getRenderTarget();
            renderer.setRenderTarget(target);
            renderer.render(scena, cam);
            renderer.setRenderTarget(prima);

            // Dal render target a un'immagine: i pixel arrivano capovolti,
            // perche' l'origine di WebGL sta in basso a sinistra e quella di un
            // canvas in alto a sinistra.
            const pixel = new Uint8Array(PA_VISTA_W * PA_VISTA_H * 4);
            renderer.readRenderTargetPixels(target, 0, 0, PA_VISTA_W, PA_VISTA_H, pixel);
            const tela = document.createElement('canvas');
            tela.width = PA_VISTA_W; tela.height = PA_VISTA_H;
            const ctx = tela.getContext('2d');
            const immagine = ctx.createImageData(PA_VISTA_W, PA_VISTA_H);
            for (let y = 0; y < PA_VISTA_H; y++) {
                const da = (PA_VISTA_H - 1 - y) * PA_VISTA_W * 4;
                const a = y * PA_VISTA_W * 4;
                immagine.data.set(pixel.subarray(da, da + PA_VISTA_W * 4), a);
            }
            ctx.putImageData(immagine, 0, 0);
            return tela.toDataURL('image/jpeg', 0.86);
        } catch (e) {
            // Una veduta che non si puo' fare non ferma la cerimonia: al suo
            // posto resta la planimetria, che si disegna sempre.
            console.warn('[F1] veduta del circuito non riuscita:', e);
            return null;
        } finally {
            if (gruppo) smaltisciAuto(gruppo);
            if (target) target.dispose();
        }
    }

    function preparaMappe(cronaca) {
        return Promise.all((cronaca || []).map((voce) =>
            fetch('/tracks/' + encodeURIComponent(voce.pistaId) + '.json')
                .then(r => r.json())
                .then((dati) => {
                    const punti = TrackGeometry.sampleLoop(dati.controlPoints, 400);
                    const traguardo = dati.startFinish
                        ? TrackGeometry.nearestPoint(punti, dati.startFinish.x, dati.startFinish.z).index
                        : 0;
                    return {
                        punti, traguardo,
                        profilo: F1ProfiloCircuito.profilo(punti, dati.targetKm || 10),
                        vista: renderaVistaPista(dati),
                    };
                })
                .catch(() => null)
        ));
    }

    const PA_NOMI_BARRETTE = {
        trazione: 'Trazione',
        stress: 'Stress gomme',
        frenata: 'Frenata',
        caricoAero: 'Carico aero',
    };

    function scriviSchedaCircuito(mappa) {
        const giri = document.getElementById('pa-giri');
        const distanza = document.getElementById('pa-distanza');
        const lunghezza = document.getElementById('pa-lunghezza');
        const barrette = document.getElementById('pa-barrette');
        barrette.innerHTML = '';
        if (!mappa) {
            giri.textContent = distanza.textContent = lunghezza.textContent = '—';
            return;
        }
        const profilo = mappa.profilo;
        giri.textContent = profilo.giri;
        distanza.innerHTML = (profilo.lunghezzaKm * profilo.giri).toFixed(1) + '<span class="unita">km</span>';
        lunghezza.innerHTML = profilo.lunghezzaKm.toFixed(3) + '<span class="unita">km</span>';
        for (const chiave of Object.keys(PA_NOMI_BARRETTE)) {
            const voto = profilo.barrette[chiave];
            const riga = document.createElement('div');
            riga.className = 'pa-barretta';
            const tacche = [1, 2, 3, 4, 5]
                .map(i => `<span class="pa-tacca${i <= voto ? ' accesa' : ''}"></span>`).join('');
            riga.innerHTML = `<span class="pa-barretta-nome">${PA_NOMI_BARRETTE[chiave]}</span>`
                + `<span class="pa-tacche" role="img" aria-label="${PA_NOMI_BARRETTE[chiave]}: ${voto} su 5">${tacche}</span>`;
            barrette.appendChild(riga);
        }
    }

    function disegnaMappa(mappa) {
        const vista = document.getElementById('pa-vista');
        const canvas = document.getElementById('pa-mappa');
        // La veduta e' la cosa da vedere; la planimetria e' il ripiego per
        // quando il render non e' riuscito.
        if (mappa && mappa.vista) {
            vista.src = mappa.vista;
            vista.style.display = '';
            canvas.style.display = 'none';
            return;
        }
        vista.removeAttribute('src');
        vista.style.display = 'none';
        canvas.style.display = '';
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!mappa) return;
        F1Planimetria.disegna(ctx, mappa.punti, {
            larghezza: canvas.width,
            altezza: canvas.height,
            margine: 34,
            spessore: 9,
            colore: '#8CAEB6',
            coloreTraguardo: '#E9F3F5',
            traguardo: mappa.traguardo,
        });
    }

    // La classifica a quel punto della stagione: ogni riga e' una barra, e le
    // barre si misurano sul punteggio FINALE del capoclassifica. Riscalarle a
    // ogni tappa renderebbe illeggibile proprio il confronto che devono
    // mostrare — a ogni gara sembrerebbe che nessuno guadagni niente.
    function scriviClassificaAnnata(voce, massimo) {
        const elenco = document.getElementById('pa-classifica');
        elenco.innerHTML = '';
        for (const riga of voce.testa) {
            const li = document.createElement('li');
            li.className = 'pa-riga';
            const riempie = document.createElement('span');
            riempie.className = 'pa-riempie';
            riempie.style.background = riga.colore || '#888';
            const testo = document.createElement('span');
            testo.className = 'pa-riga-testo';
            const pos = document.createElement('span');
            pos.className = 'pa-riga-pos';
            pos.textContent = String(riga.posizione);
            const nome = document.createElement('span');
            nome.className = 'pa-riga-nome';
            nome.textContent = riga.etichetta;
            const punti = document.createElement('span');
            punti.className = 'pa-riga-punti';
            punti.textContent = String(riga.punti);
            testo.appendChild(pos); testo.appendChild(nome); testo.appendChild(punti);
            li.appendChild(riempie); li.appendChild(testo);
            elenco.appendChild(li);
            // La larghezza si assegna dopo l'inserimento, cosi' la transizione
            // CSS parte da zero e la barra cresce invece di comparire piena.
            requestAnimationFrame(() => {
                riempie.style.width = Math.round((riga.punti / massimo) * 100) + '%';
            });
        }
    }

    // L'annata, una tappa alla volta, in una schermata sorella di quella delle
    // mescole: i dati del circuito a sinistra, la sua MAPPA al centro, il
    // campionato a destra.
    function mostraAnnata(cronaca, mappe) {
        if (!cronaca || !cronaca.length) return Promise.resolve();
        const durata = Math.max(PRE_ANNATA_MIN, cronaca.length * PRE_GARA_MS);
        const passo = durata / cronaca.length;
        const massimo = Math.max(1, ...cronaca.map(v => (v.testa[0] ? v.testa[0].punti : 0)));
        const box = document.getElementById('premiazione-annata');
        const velo = document.getElementById('pa-velo');
        box.style.display = '';
        sipario(false, 420);

        return new Promise((risolvi) => {
            let i = 0;
            const chiudi = () => {
                // Si richiude prima di passare al podio: il sipario copre il
                // salto fra la schermata e la scena.
                sipario(true, 260);
                setTimeout(() => { box.style.display = 'none'; risolvi(); }, 280);
            };
            const scrivi = () => {
                if (!premiazioneInCorso) { chiudi(); return; }
                const voce = cronaca[i];
                const mappa = (mappe && mappe[i]) || null;
                document.getElementById('pa-numero').textContent =
                    'Gara ' + voce.numero + ' di ' + cronaca.length;
                document.getElementById('pa-pista').textContent = voce.pista;
                document.getElementById('pa-chi').textContent = voce.vincitore.etichetta;
                document.getElementById('pa-pallino').style.background = voce.vincitore.colore || '#888';
                scriviSchedaCircuito(mappa);
                disegnaMappa(mappa);
                scriviClassificaAnnata(voce, massimo);
                // Il velo si accende un istante prima del cambio e si spegne
                // subito dopo: e' lo stacco fra una mappa e l'altra.
                velo.style.opacity = '0';
                i += 1;
                if (i < cronaca.length) {
                    setTimeout(() => { velo.style.opacity = '1'; }, Math.max(0, passo - 260));
                    setTimeout(scrivi, passo);
                } else {
                    setTimeout(chiudi, passo);
                }
            };
            velo.style.opacity = '0';
            scrivi();
        });
    }

    // L'unico modo di entrare, e lo usa la schermata della stagione. Tre
    // movimenti in fila; il quarto (l'albo d'oro) lo mostra la schermata quando
    // questa promessa si risolve.
    window.f1PremiazioneAvvia = function (righe, tutte, cronaca, nome, opzioni) {
        premiazioneInCorso = true;
        // PRIMA si copre, poi si toglie la schermata. Nell'ordine inverso resta
        // scoperto un frame con la camera di gioco, che inquadra la propria auto
        // ferma sulla pista dell'ultima gara — segnalato in playtest: «per un
        // secondo vedo la mia macchina nell'ultima pista».
        sipario(true, 0);
        document.getElementById('stagione-overlay').style.display = 'none';
        // La scena si costruisce DURANTE lo stacco: caricarla quando serve la
        // farebbe arrivare in ritardo sul proprio ingresso, ed e' l'errore gia'
        // fatto una volta con l'auto in pole del riepilogo griglia.
        const scenaPronta = costruisciPremiazione(righe, tutte, opzioni);
        // Anche le mappe dell'annata: lo stacco dura 4.2 s, ed e' li' che si
        // paga il caricamento che l'utente ha accettato («accetto un
        // caricamento per arrivarci»). Se non bastasse, si aspetta a sipario
        // chiuso — mai davanti alla schermata gia' aperta.
        let mappeFinite = false;
        const mappePronte = preparaMappe(cronaca).then((m) => { mappeFinite = true; return m; });
        const attesa = document.getElementById('premiazione-attesa');
        return F1Sting.play({
            titolo: 'Campione del mondo',
            sottotitolo: nome || '',
            durataMs: PRE_STING_MS,
        })
            .then(() => {
                // Se le vedute non sono pronte allo scadere dello stacco, si
                // aspetta a sipario chiuso — ma dicendo che si sta aspettando.
                if (!mappeFinite && attesa) attesa.style.display = '';
                return mappePronte;
            })
            .then((mappe) => {
                if (attesa) attesa.style.display = 'none';
                return premiazioneInCorso ? mostraAnnata(cronaca, mappe) : null;
            })
            .then(() => scenaPronta)
            .then((scena) => {
                if (!premiazioneInCorso) {
                    // Saltata durante lo stacco o l'annata: la scena e' stata
                    // costruita comunque, e va smaltita invece che lasciata
                    // appesa a una cerimonia che non ci sara'.
                    if (scena) { scene.remove(scena.gruppo); smaltisciAuto(scena.gruppo); }
                    fermaPremiazione();
                    return null;
                }
                return avviaConsegna(scena, righe);
            });
    };

    // ── PREMIAZIONE DI PROVA (F8) ───────────────────────────────────────
    // Guardare la cerimonia costava tre gare di campionato. Da una gara
    // veloce, F8 la lancia con un campionato inventato: stessi movimenti,
    // stessa scena, stessi suoni.
    //   F8         — la festa che tocca a questo circuito (notte o giorno)
    //   Shift+F8   — l'altra, per vederle entrambe senza cambiare pista
    // Le piste del calendario finto sono quelle vere del gioco, cosi' anche le
    // mappe dell'annata sono quelle vere.
    function premiazioneDiProvaAvvia(inverti) {
        if (premiazioneInCorso) return;
        premiazioneDiProva = true;
        const COLORI = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'];
        const nomi = ['Tu', 'Bot 1', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5'];
        // Il primo pilota sei tu, col tuo colore: cosi' si vede la propria
        // livrea sul gradino piu' alto.
        const colori = [myColor || COLORI[0]].concat(COLORI.filter(c => c !== myColor)).slice(0, 6);
        const punti = [129, 107, 97, 73, 63, 59];
        const podio = colori.slice(0, 3).map((colore, i) => ({
            uid: i === 0 ? (user ? user.uid : null) : null,
            colore, bot: i !== 0, punti: punti[i], etichetta: nomi[i],
        }));
        const tutti = colori.map((colore, i) => ({
            uid: i === 0 ? (user ? user.uid : null) : null, colore, bot: i !== 0,
        }));

        fetch('/api/f1/tracks').then(r => r.json()).then((piste) => {
            const scelte = (piste || []).slice(0, 5);
            const cronaca = scelte.map((pista, k) => ({
                numero: k + 1,
                pistaId: pista.id,
                pista: pista.name || pista.id,
                vincitore: { etichetta: nomi[k % 3], colore: colori[k % 3] },
                testa: colori.slice(0, 5).map((colore, i) => ({
                    etichetta: nomi[i], colore, posizione: i + 1,
                    // I punti crescono tappa dopo tappa, come in un campionato
                    // vero: e' quello che le barre devono raccontare.
                    punti: Math.round(punti[i] * (k + 1) / scelte.length),
                })),
            }));
            window.f1PremiazioneAvvia(podio, tutti, cronaca, 'Premiazione di prova',
                { invertiFesta: !!inverti });
        }).catch((e) => {
            console.error('[F1] premiazione di prova:', e);
            premiazioneDiProva = false;
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'F8') return;
        // Solo in gara veloce: in campionato la cerimonia vera arriva da se',
        // e sovrapporle una di prova la lascerebbe a meta'.
        if (formatoPartita === 'stagione') return;
        e.preventDefault();
        premiazioneDiProvaAvvia(e.shiftKey);
    });

    // Si puo' saltare: una cerimonia che non si puo' interrompere e' una
    // cerimonia che la seconda volta si subisce.
    document.addEventListener('keydown', (e) => {
        if (!premiazioneInCorso) return;
        if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return;
        fermaPremiazione();
    });

    // Durante la premiazione la pista resta viva dietro le quinte: il server
    // continua a simulare finché non smonta la partita, quindi i bot che non
    // hanno ancora finito continuano a girare. Sul traguardo, dove sta il
    // podio, passavano proprio in mezzo alla scena (segnalato in playtest,
    // insieme all'HUD di gioco rimasto acceso davanti al podio).
    //
    // Si nascondono le auto invece di fermare la simulazione: la gara deve
    // poter chiudersi normalmente per chi è ancora in pista, e "Riavvia"
    // riparte da quella stessa partita.
    function mostraAutoDiGara(visibili) {
        if (myCarGroup) myCarGroup.visible = visibili;
        for (const g of Object.values(otherCars)) if (g) g.visible = visibili;
        document.body.classList.toggle('in-cerimonia', !visibili);
    }

    function avviaCerimonia(durataMs) {
        if (!cerimoniaGruppo || !cerimoniaCam) return;
        cerimoniaGruppo.visible = true;
        mostraAutoDiGara(false);
        cerimoniaDa = performance.now();
        cerimoniaDurata = Math.max(1, durataMs || 1);
        cerimoniaAttiva = true;
        // Stesso piano vicino della panoramica: anche qui si guarda da
        // ventiquattro unità, e col near di gioco l'asfalto sfarfalla.
        camera.near = PANORAMICA_NEAR;
        camera.updateProjectionMatrix();
    }

    function aggiornaCameraCerimonia() {
        if (!cerimoniaCam) return;
        const t = Math.min(1, (performance.now() - cerimoniaDa) / cerimoniaDurata);
        const e = t * t * (3 - 2 * t);
        const c = cerimoniaCam;
        camera.position.set(misto(c.da.x, c.a.x, e), misto(c.da.y, c.a.y, e), misto(c.da.z, c.a.z, e));
        camera.lookAt(c.mira.x, c.mira.y, c.mira.z);
    }

    function fermaCerimonia() {
        cerimoniaPronta = null;
        if (cerimoniaAttiva) {
            cerimoniaAttiva = false;
            mostraAutoDiGara(true);
            camera.near = nearDiGioco;
            camera.updateProjectionMatrix();
        }
        if (cerimoniaGruppo) {
            scene.remove(cerimoniaGruppo);
            smaltisciAuto(cerimoniaGruppo);
            cerimoniaGruppo = null;
        }
        cerimoniaCam = null;
    }

    function nascondiAutoInPole() {
        // Anche il precaricamento eventualmente in corso: chi lo sta
        // aspettando si accorge del cambio di sequenza e smaltisce il modello
        // invece di appenderlo a una schermata che non c'e' piu'.
        autoInPolePronta = null;
        if (!autoInPole) return;
        camera.remove(autoInPole);
        smaltisciAuto(autoInPole);
        autoInPole = null;
    }

    socket.on('f1RaceEnded', async (data) => {
        fineGaraScadeA = null;
        isRacing = false;
        const mia = ++sequenzaCorrente;
        silenzioTransizione(true);
        sipario(true);
        const cer = data.cerimonia || {};

        // La scena si costruisce SUBITO, mentre lo stacco copre lo schermo:
        // un podio e tre auto con le loro livree sono più lavoro dell'auto in
        // pole del riepilogo griglia, e i quattro secondi di stacco servono
        // esattamente a questo (stessa lezione di preparaAutoInPole).
        const scenaPronta = costruisciCerimonia(data.podium || []);

        await F1Sting.play({
            durataMs: cer.staccoMs,
            titolo: 'Gara conclusa',
            sottotitolo: data.trackName || '',
        });
        if (mia !== sequenzaCorrente) return;
        await scenaPronta;
        if (mia !== sequenzaCorrente) return;

        avviaCerimonia(cer.scenaMs);
        mostraCerimonia(data, cer.scenaMs);
        sipario(false, 520);
    });

    // Fascia dei risultati sopra la scena della premiazione, più i comandi per
    // uscire: pulsante o scadenza del tempo, come chiesto.
    function mostraCerimonia(data, durataMs) {
        const box = document.getElementById('race-ceremony');
        const lista = document.getElementById('rc-lista');
        if (!box || !lista) return;
        const mia = sequenzaCorrente;

        document.getElementById('rc-circuito').textContent = data.trackName || '';
        document.getElementById('rc-titolo').textContent = data.isFinal ? 'Gara conclusa' : 'Fine gara';

        lista.innerHTML = (data.podium || []).map((e, i) => {
            const t = e.totalTime;
            // Nessuno resta senza tempo: chi non era ancora arrivato quando la
            // gara ha chiuso riceve il tempo PROIETTATO dal ritmo che ha tenuto
            // davvero (vedi endRace). Il "≈" dice che è una proiezione e non un
            // tempo cronometrato.
            const tempo = (t === null || t === undefined) ? '—'
                : (e.stimato ? '≈ ' : '') + formattaTempoGiro(t);
            const pene = [];
            if (e.pitPenalty) pene.push(['+30', 'Sosta obbligatoria non effettuata']);
            if (e.falseStart) pene.push(['+5', 'Falsa partenza']);
            if (e.collisionPenaltyMs > 0) pene.push(['+' + (e.collisionPenaltyMs / 1000).toFixed(1), 'Collisioni causate']);
            const classi = ['rc-riga'];
            if (i < 3) classi.push('p' + (i + 1));
            if (e.color === myColor) classi.push('sono-io');
            return `<li class="${classi.join(' ')}">
                <span class="rc-pos">${i + 1}</span>
                <span class="rc-barra" style="background:${e.color}"></span>
                <span class="rc-chi">${e.color === myColor ? 'Tu' : (e.isBot ? 'Bot' : 'Pilota')}</span>
                <span class="rc-tempo${e.stimato ? ' stimato' : ''}"${e.stimato ? ' title="Tempo proiettato dal ritmo tenuto in gara: non era ancora arrivato alla chiusura"' : ''}>${tempo}${pene.map(([n, t2]) => `<span class="rc-pen" title="${t2}">${n}s</span>`).join('')}</span>
            </li>`;
        }).join('');

        box.style.display = 'block';
        const righe = lista.querySelectorAll('.rc-riga');
        if (typeof anime === 'function') {
            anime({
                targets: righe, opacity: [0, 1], translateY: [10, 0],
                delay: anime.stagger(40), duration: 320, easing: 'easeOutQuad',
            });
        } else {
            righe.forEach(r => { r.style.opacity = 1; });
        }

        // ── Uscita ──────────────────────────────────────────────────────
        const riavvia = document.getElementById('rc-riavvia');
        const inLobby = document.getElementById('rc-lobby');
        const conto = document.getElementById('rc-conto');

        // "Riavvia" rimette in moto QUESTA partita dalla qualifica: ha senso
        // solo in modalità singola e solo per chi ospita.
        const puoiRiavviare = !!data.restaAlPodio && myColor === hostColor;
        riavvia.style.display = puoiRiavviare ? '' : 'none';
        riavvia.onclick = () => { sequenzaCorrente++; socket.emit('f1RestartRace', lobbyId); };

        // Dopo una gara di CAMPIONATO il pulsante porta al calendario, non in
        // lobby: la stagione continua, e uscire dal gioco e' una decisione che
        // si prende dal calendario, dove si vede a che punto si e'. Chiesto in
        // playtest ("dovrei tornare al calendario in ogni caso, e poi dal
        // calendario scelgo se andare alla lobby"), e per giunta uscire di qui
        // faceva chiudere la partita mentre la pagina stava per ricaricarsi.
        //
        // In gara veloce resta com'era: il pulsante porta in lobby CHI LO
        // PREME, e solo chi ospita chiude la partita per tutti — un giocatore
        // qualunque non deve poter strappare gli altri dalla premiazione.
        if (campionatoTornaAlCalendario) {
            inLobby.textContent = 'Vai al calendario';
            inLobby.onclick = () => { alCalendario(); };
        } else {
            inLobby.textContent = 'Torna alla lobby';
            inLobby.onclick = () => {
                if (myColor === hostColor) socket.emit('f1ReturnToLobby', lobbyId);
                else window.location.href = `/lobby.html?lobby=${lobbyId}`;
            };
        }

        // Il tempo lo decide il server, ed è lo stesso su cui programma lo
        // smontaggio della partita: non possono divergere.
        //
        // In CAMPIONATO cambia la destinazione, non il timer: dopo una gara di
        // stagione non si rientra in lobby, si torna al calendario — che è
        // questa stessa pagina ricaricata. Un secondo timer parallelo avrebbe
        // fatto sparire il podio mentre il conto ne annunciava un altro, cioè
        // avrebbe scritto il falso per tutta la premiazione.
        const dove = () => (campionatoTornaAlCalendario ? 'al calendario' : 'in lobby');
        let resta = Math.max(1000, durataMs || 15000);
        conto.textContent = `Si torna ${dove()} fra ${Math.ceil(resta / 1000)}s`;
        const passo = setInterval(() => {
            if (mia !== sequenzaCorrente) { clearInterval(passo); return; }
            resta -= 1000;
            if (resta > 0) { conto.textContent = `Si torna ${dove()} fra ${Math.ceil(resta / 1000)}s`; return; }
            clearInterval(passo);
            if (campionatoTornaAlCalendario) {
                conto.textContent = 'Al calendario…';
                alCalendario();
                return;
            }
            conto.textContent = 'Rientro in lobby…';
            window.location.href = `/lobby.html?lobby=${lobbyId}`;
        }, 1000);
    }

    function nascondiCerimonia() {
        const box = document.getElementById('race-ceremony');
        if (box) box.style.display = 'none';
    }

    // Dissolvenza a nero durante la pausa "Riavvia" (RESTART_GRACE_MS lato
    // server, vedi backend): copre il riposizionamento dell'auto al via
    // della qualifica, che altrimenti si vedrebbe "teletrasportata" appena
    // il podio si chiude. Il fade-out finisce all'incirca quando arriva
    // f1Countdown (che nasconde comunque podium-modal per conto suo, in
    // modo idempotente — nessun conflitto se questo handler lo ha già
    // fatto sparire prima).
    socket.on('f1RestartTransition', ({ graceMs }) => {
        const el = document.getElementById('restart-transition');
        document.getElementById('podium-modal').style.display = 'none';
        el.style.display = 'flex';
        anime({ targets: el, opacity: [0, 1], duration: 250, easing: 'easeOutQuad' });
        setTimeout(() => {
            anime({
                targets: el, opacity: [1, 0], duration: 400, easing: 'easeInQuad',
                complete: () => { el.style.display = 'none'; }
            });
        }, Math.max(0, graceMs - 400));
    });

    // ── CAMPIONATO: dentro e fuori dal weekend ──────────────────────────
    // Si RICARICA invece di ricostruire la scena a caldo. E' la scelta che
    // tiene intatto il codice del weekend: la pagina riparte con la pista della
    // gara del calendario e da li' gira il flusso di sempre. Il caricamento fra
    // una gara e l'altra e' lo stesso che c'e' gia' fra lobby e gara.
    socket.on('f1StagioneInPista', () => {
        window.location.reload();
    });

    // Gara di campionato finita. Non fa partire nessun timer: cambia solo la
    // DESTINAZIONE del conto alla rovescia che il podio ha gia' avviato (vedi
    // il conto in fondo alla cerimonia), cosi' il podio si vede tutto e il
    // testo dice la verita' fin dal primo secondo.
    socket.on('f1StagioneAlCalendario', () => {
        campionatoTornaAlCalendario = true;
    });

    socket.on('f1RedirectToLobby', () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}`;
    });

    // ====================================================
    // INPUT TASTIERA + GAMEPAD
    // ====================================================
    // Protocollo unificato: la tastiera manda sempre valori estremi
    // (0/1/-1), il gamepad manda valori analogici continui — la fisica
    // server tratta i due casi con la stessa formula. Un solo invio
    // "throttled" per frame (vedi maybeSendInputs in animate()) copre sia
    // i cambi da tastiera che il flusso continuo del gamepad.
    const keys = { w: false, a: false, s: false, d: false };
    const inputs = { throttle: 0, brake: 0, steer: 0 };

    function applyKeys() {
        inputs.throttle = keys.w ? 1 : 0;
        inputs.brake = keys.s ? 1 : 0;
        inputs.steer = (keys.a ? 1 : 0) + (keys.d ? -1 : 0);
    }

    // ── Avvisi brevi a schermo ─────────────────────────────────────────
    // Un messaggio che compare per un attimo e sparisce: lo usano le
    // segnalazioni in gioco (M / Shift+M) e il tasto delle ombre (O). Un solo
    // timer: due pressioni ravvicinate non devono lasciare il testo appeso.
    let timerAvviso = null;
    function mostraAvviso(testo, errore) {
        const el = document.getElementById('segnalazione-avviso');
        if (!el) return;
        el.textContent = testo;
        el.classList.toggle('segnalazione-errore', !!errore);
        el.style.display = 'block';
        clearTimeout(timerAvviso);
        timerAvviso = setTimeout(() => { el.style.display = 'none'; }, 1500);
    }

    // Registra dove sei e dove stai guardando. Il numero mostrato è quello
    // che il SERVER ha scritto nel file: così il "terzo punto" di cui si
    // parla dopo in chat è lo stesso record per tutti e due.
    async function registraSegnalazione() {
        if (!myCarGroup) return;
        const stato = serverState[myColor];
        const rec = F1Segnalazioni.componiSegnalazione({
            sessione: sessioneSegnalazioni,
            t: new Date().toISOString(),
            trackId,
            pos: myCarGroup.position,
            rotY: myCarGroup.rotation.y,
            camera: cameraMode,
            guardaDietro: isLookingBack(),
            // Stessa conversione dell'HUD (speedEl, in animate): il valore
            // nel file dev'essere quello che il giocatore aveva sotto gli occhi.
            velocita: Math.abs((stato && stato.speed) || 0) * 55,
            giro: giroCorrente
        });
        try {
            const risposta = await fetch('/dev/f1-marker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rec)
            });
            const esito = await risposta.json();
            if (esito.ok) mostraAvviso(`Segnalazione ${esito.n} registrata`);
            else mostraAvviso('Segnalazione NON salvata', true);
        } catch (err) {
            // Mai una conferma falsa: se il server non ha risposto, il punto
            // non esiste e chi guida deve saperlo subito, non dopo il giro.
            mostraAvviso('Segnalazione NON salvata', true);
        }
    }

    async function annullaUltimaSegnalazione() {
        try {
            const risposta = await fetch('/dev/f1-marker/annulla', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessione: sessioneSegnalazioni })
            });
            const esito = await risposta.json();
            if (esito.ok) mostraAvviso(`Segnalazione ${esito.n} annullata`);
            else mostraAvviso('Niente da annullare', true);
        } catch (err) {
            mostraAvviso('Annullamento NON riuscito', true);
        }
    }

    // Il campo nome del record (3 lettere) è l'unico input di testo della
    // pagina: mentre ci si scrive dentro, la freccia giù non deve essere
    // intercettata come "guarda dietro".
    function isTypingInField(e) {
        const t = e.target;
        return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    }

    function isLookBackKey(k) { return k === 'b' || k === 'arrowdown'; }

    document.addEventListener('keydown', (e) => {
        // Se si sta scrivendo in un campo, i tasti sono LETTERE, non comandi.
        // Mancava, e si vedeva: scrivere il nome di una stagione mandava
        // sterzate al server (la "a" e la "d" di "Mondiale"), la "c" cambiava
        // telecamera e la "h" accendeva le hitbox. Le voci che avevano gia' la
        // guardia da sole restano corrette, questa le copre tutte.
        // Nessun rischio di tasto incastrato: se il keydown non lo accende, il
        // keyup lo spegne comunque.
        if (isTypingInField(e)) return;
        const k = e.key.toLowerCase();
        if (k === 'w') keys.w = true;
        if (k === 'a') keys.a = true;
        if (k === 's') keys.s = true;
        if (k === 'd') keys.d = true;
        if (k === 'c') cameraMode = cameraMode === 'third' ? 'first' : 'third';
        if (isLookBackKey(k) && !isTypingInField(e)) {
            lookBackKey = true;
            if (k === 'arrowdown') e.preventDefault();   // niente scroll della pagina
        }
        if (k === 'h') {   // DEBUG: mostra/nascondi le hitbox di collisione
            showHitboxes = !showHitboxes;
            for (const mesh of Object.values(hitboxMeshes)) mesh.visible = showHitboxes;
        }
        // O = ombre dinamiche. Passa dal pannello (ToonPanel) e non tocca il
        // renderer da qui: la casella F9 e il tasto devono restare due modi di
        // premere lo stesso interruttore, non due interruttori.
        // Spegnendole si torna esattamente all'aspetto che aveva "prova"
        // prima che il riquadro delle ombre seguisse l'auto: nessuna ombra.
        // L = indicatore luci a schermo durante il via. Il semaforo vero resta
        // sempre quello sul ponte: questo è solo un aiuto per chi parte in
        // fondo alla griglia. La scelta resta fra una gara e l'altra.
        if (k === 'l' && !e.repeat && !isTypingInField(e)) {
            indicatoreLuci = !indicatoreLuci;
            try { localStorage.setItem('f1IndicatoreLuci', indicatoreLuci ? '1' : '0'); } catch (err) { /* modalità privata */ }
            const board = document.getElementById('lights-board');
            if (board && lightsSequenceActive) board.style.display = indicatoreLuci ? 'flex' : 'none';
            mostraAvviso(indicatoreLuci ? 'Indicatore luci acceso' : 'Indicatore luci spento');
        }
        // Invio: chiude subito la finestra di cortesia di fine gara. Vale solo
        // mentre la finestra è aperta, cioè quando tutti gli umani hanno già
        // tagliato il traguardo.
        if (e.key === 'Enter' && !e.repeat && !isTypingInField(e) && fineGaraScadeA != null) {
            socket.emit('f1ChiudiGara', { lobbyId });
            fineGaraScadeA = null;
        }
        if (k === 'o' && !e.repeat && !isTypingInField(e) && pannello && pannello.ombreDinamiche) {
            const accese = !pannello.ombreAccese();
            pannello.ombreDinamiche(accese);
            mostraAvviso(accese ? 'Ombre accese' : 'Ombre spente');
        }
        // V gira la manopola del senso di velocità: quattro effetti nuovi
        // insieme si giudicano male a parola ("un po' meno") e bene a numero.
        // Zero è anche l'interruttore di sicurezza — la camera torna esattamente
        // com'era prima che tutto questo esistesse.
        if (k === 'v' && !e.repeat && !isTypingInField(e)) {
            const scala = [0, 0.5, 1, 1.5];
            const ora = F1SensoVelocita.getIntensita();
            const prossimo = scala[(scala.findIndex(s => Math.abs(s - ora) < 0.01) + 1) % scala.length];
            F1SensoVelocita.impostaIntensita(prossimo);
            mostraAvviso(prossimo === 0 ? 'Senso di velocità: spento' : `Senso di velocità: ${prossimo}×`);
        }
        // M segnala il punto in cui sei, Shift+M annulla l'ultima. `e.repeat`
        // esclude l'autorepeat: tenendo premuto si riempirebbe il file di
        // copie dello stesso punto.
        if (k === 'm' && !e.repeat && !isTypingInField(e)) {
            if (e.shiftKey) annullaUltimaSegnalazione();
            else registraSegnalazione();
        }
        applyKeys();
    });

    document.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'w') keys.w = false;
        if (k === 'a') keys.a = false;
        if (k === 's') keys.s = false;
        if (k === 'd') keys.d = false;
        // Rilascio incondizionato (nessun controllo sul campo di testo): se il
        // focus finisse in un input MENTRE il tasto è premuto, la camera
        // resterebbe girata per sempre.
        if (isLookBackKey(k)) lookBackKey = false;
        applyKeys();
    });

    window.addEventListener('blur', () => {
        keys.w = keys.a = keys.s = keys.d = false;
        // Il keyup non arriva se la finestra perde il fuoco a tasto premuto:
        // senza questo la camera resterebbe girata al ritorno sulla pagina.
        lookBackKey = false;
        applyKeys();
    });

    document.addEventListener('contextmenu', e => e.preventDefault());

    function sendInputs() {
        socket.emit('f1Input', { lobbyId, playerColor: myColor, inputs });
    }

    // Invio continuo throttled: chiamato ogni frame da animate(). Manda solo
    // se qualcosa è cambiato di più di un epsilon, e non più spesso del tick
    // fisico server (50ms) — evita di floodare il socket coi valori analogici
    // del gamepad, che cambiano quasi ogni frame anche per il minimo tremore.
    const SEND_EPS = 0.02, SEND_MIN_MS = 50;
    let lastSent = { throttle: 0, brake: 0, steer: 0 };
    let lastSendTime = 0;

    function maybeSendInputs() {
        // In gara (mai in qualifica) l'input parte già durante la sequenza
        // luci: serve al server SOLO per il rilevamento falsa partenza — la
        // fisica resta congelata lato server finché la gara non parte
        // davvero, quindi non c'è rischio che l'auto si muova prima del via.
        if (!isRacing && !lightsSequenceActive) return;
        const now = performance.now();
        const changed = Math.abs(inputs.throttle - lastSent.throttle) > SEND_EPS ||
            Math.abs(inputs.brake - lastSent.brake) > SEND_EPS ||
            Math.abs(inputs.steer - lastSent.steer) > SEND_EPS;
        if (changed && now - lastSendTime >= SEND_MIN_MS) {
            sendInputs();
            lastSent = { ...inputs };
            lastSendTime = now;
        }
    }

    // ── Gamepad ──────────────────────────────────────────────────────────
    // Azioni a tasto (edge-triggered), sterzo/gas/freno analogici li legge
    // animate() via F1GamepadInput.poll() ad ogni frame. X (onConfirm) è
    // contestuale: conferma la mescola se una schermata di scelta è attiva,
    // altrimenti conta come reazione pit stop durante il minigioco.
    if (typeof F1GamepadInput !== 'undefined') {
        F1GamepadInput.setCallbacks({
            onConfirm: () => {
                if (activeTyreContainerId) tyreConfirm();
                else if (pitting || pitMuro) premiReazionePit();
            },
            onCameraToggle: () => { cameraMode = cameraMode === 'third' ? 'first' : 'third'; },
            onNavLeft: () => tyreNav(-1),
            onNavRight: () => tyreNav(1),
            onTyreToggle: () => { tyrePanelOpen = !tyrePanelOpen; renderTyreVisibility(); },
            // Nessun tasto controller per la scelta riparazione danni ai
            // box prima d'ora — segnalato dall'utente. Stessa funzione
            // richiamata dal click sul pulsante (vedi toggleRepairChoice
            // sopra, dichiarata prima di f1PitLaneEntered).
            onRepairToggle: toggleRepairChoice,
        });
    }

    // Tutti i socket.on(...) sono registrati sopra: SOLO ora è sicuro chiedere
    // al server lo stato (f1Setup arriva in risposta sincrona a joinF1Game).
    // Emesso prima — subito dopo io(), come prima del refactor track-editor —
    // apriva una finestra di race: il fetch del JSON pista qui sopra è
    // asincrono, quindi f1Setup poteva arrivare dal server prima che il
    // listener fosse registrato ed essere perso (schermata bloccata sul cielo
    // blu, "certe volte" — bug segnalato dall'utente).
    socket.emit('joinLobby', { lobbyId, color: myColor, token: sessione.token });
    socket.emit('joinF1Game', { lobbyId, playerColor: myColor, uid: user ? user.uid : null });

    // ====================================================
    // RENDER LOOP — LERP + CAMERA
    // ====================================================
    const LERP = 0.22;
    // Angolo massimo di rotazione visiva delle ruote anteriori in sterzata
    // (solo estetico — la fisica reale usa l'input grezzo lato server,
    // SteeringModel.js — non questo valore). Stesso ordine di grandezza
    // del clamp ±0.4 rad usato nell'editor di riferimento navigato per
    // progettare questo effetto. Da tarare a vista in localhost.
    const MAX_WHEEL_STEER_RAD = 0.35;

    // Isteresi sulla soglia "fuori pista" usata per scegliere la sorgente
    // della quota visiva (trackY del punto pista vs terrainHeightAt): senza
    // margine, distFromCenter che oscilla anche di pochi centimetri attorno
    // a ROAD_HALF+2 (confermato via log: si assesta esattamente lì quando
    // l'auto tocca il muro rigido del ponte) fa flippare il ramo ogni frame
    // tra due quote radicalmente diverse (quota ponte vs ~0 del terreno
    // sotto), il vero scatto segnalato dall'utente — non un problema di
    // v.x/z vs target.x/z (già escluso in un tentativo precedente). Stato
    // "appiccicoso" per colore: entra nel ramo fuori-pista solo oltre
    // soglia+margine, ne esce solo sotto soglia-margine.
    const OFF_BRIDGE_EDGE_HYSTERESIS = 1.5;
    const _offBridgeEdgeState = {};

    function lerpAngle(a, b, t) {
        let d = b - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return a + d * t;
    }

    const _camOff = new THREE.Vector3();
    const _lookTgt = new THREE.Vector3();

    // ── Sguardo ai semafori ────────────────────────────────────────────
    // Dalla griglia le luci del ponte sono FUORI inquadratura: la camera
    // d'inseguimento punta l'auto dall'alto (5.5 di quota verso 1.2), quindi
    // guarda in giù di 18°, mentre le luci stanno 14° sopra l'orizzonte — 32°
    // sopra il centro dell'immagine, cioè al limite esatto del campo visivo.
    // Dall'halo-cam, che è ancora più bassa e inclinata di altri 10° in giù,
    // non si vedono affatto. Misurato in griglia su tutti e tre i tracciati.
    //
    // Quindi durante il via la camera alza lo sguardo sulle luci e lo riporta
    // giù quando la gara parte: è quello che fa un pilota vero. Solo il PUNTO
    // MIRATO si sposta, la camera resta dov'è — cambiando anche la posizione
    // sembrerebbe un cambio di inquadratura, non una testa che si alza.
    //
    // La salita è più rapida della discesa: alzare gli occhi è un gesto, il
    // ritorno alla pista è l'attenzione che si riassesta.
    const SGUARDO_SU_MS = 900;
    const SGUARDO_GIU_MS = 1700;
    let sguardoSemaforo = 0;    // 0 = pista, 1 = semafori
    let sguardoObiettivo = 0;
    const _puntoLuci = new THREE.Vector3();

    // Centro delle luci nel mondo: la colonna di mezzo, che sta sopra l'asse
    // della pista. Il raggio di ingombro dell'InstancedMesh è già in
    // coordinate mondo (lo calcola loadScenery), quindi non serve altro.
    function puntoSemafori() {
        const centrale = semaforiPonte[2] || semaforiPonte[0];
        if (!centrale || !centrale.geometry.boundingSphere) return null;
        return centrale.geometry.boundingSphere.center;
    }

    function avanzaSguardo(dtMs) {
        const durata = sguardoObiettivo > sguardoSemaforo ? SGUARDO_SU_MS : SGUARDO_GIU_MS;
        const passo = dtMs / durata;
        if (sguardoSemaforo < sguardoObiettivo) sguardoSemaforo = Math.min(sguardoObiettivo, sguardoSemaforo + passo);
        else if (sguardoSemaforo > sguardoObiettivo) sguardoSemaforo = Math.max(sguardoObiettivo, sguardoSemaforo - passo);
    }

    // Sposta il punto mirato verso le luci, in proporzione a `sguardoSemaforo`.
    // Con una progressione morbida agli estremi: lineare, l'inizio e la fine
    // del movimento si sentono come due scatti.
    function mescolaSguardoSemaforo(target) {
        if (sguardoSemaforo <= 0) return;
        const luci = puntoSemafori();
        if (!luci) return;
        const t = sguardoSemaforo * sguardoSemaforo * (3 - 2 * sguardoSemaforo);
        _puntoLuci.copy(luci);
        target.lerp(_puntoLuci, t);
    }

    // Dove puntare il riquadro delle ombre, frame per frame: durante la scelta
    // mescola sul punto che il carosello sta inquadrando (altrimenti nelle
    // inquadrature lontane dalla griglia non ci sarebbe un'ombra), in gara
    // davanti all'auto. Avanti è +Z locale — la camera d'inseguimento sta a
    // (0, 5.5, -13), cioè dietro.
    function seguiConLeOmbre() {
        if (tyreSelectActive) {
            const s = anteprimaScatti[scattoCorrente];
            if (s) puntaOmbre(s.target.x, s.target.z);
            return;
        }
        if (panoramicaAttiva) {
            const s = scattoPanoramica();
            if (s) puntaOmbre(s.target.x, s.target.z);
            return;
        }
        if (cerimoniaAttiva && cerimoniaCam) {
            puntaOmbre(cerimoniaCam.mira.x, cerimoniaCam.mira.z);
            return;
        }
        if (!myCarGroup) return;
        _avanti.set(0, 0, 1).applyQuaternion(myCarGroup.quaternion);
        puntaOmbre(myCarGroup.position.x + _avanti.x * ANTICIPO_OMBRA,
                   myCarGroup.position.z + _avanti.z * ANTICIPO_OMBRA);
    }

    // ── Senso di velocità ───────────────────────────────────────────────────
    // Lo stato sta qui, la matematica in shared/f1SensoVelocita.js (che non sa
    // niente di Three.js e si verifica senza browser). Primo effetto: il campo
    // visivo che si apre con la velocità — l'unico che a costo zero cambia
    // davvero la percezione, perché allarga la periferia dell'immagine e con
    // essa la velocità apparente di ciò che scorre ai lati.
    const sensoVelocita = F1SensoVelocita.creaStato();

    // Che cosa c'è sotto l'auto in questo istante: asfalto, cordolo o fuori
    // (erba/ghiaia). La geometria sta nel modulo, che la sa fare su qualunque
    // tracciato e viene verificata sui tracciati veri; qui si passano solo i
    // dati di questa partita.
    function superficieSottoLAuto() {
        const mio = serverState[myColor];
        if (!mio || !myCarGroup) return null;
        return F1SensoVelocita.misuraSottoAuto(TrackGeometry, {
            trackPts, pitPts: PIT_PTS,
            idxPrecedente: mio.trackIndex || 0,
            x: myCarGroup.position.x, z: myCarGroup.position.z,
            roadHalf: ROAD_HALF, curbW: CURB_W,
        });
    }

    // Si "sta guidando" solo quando la camera è quella di gioco. Nelle altre
    // (scelta mescole, panoramica, premiazione) il campo visivo torna a 65 nello
    // STESSO frame: quelle inquadrature sono tarate su quel valore, e la vetrina
    // dell'auto in pole ricava la propria posizione leggendo camera.fov.
    function aggiornaCampoVisivo(dtMs, misura) {
        const guidando = !tyreSelectActive && !panoramicaAttiva && !cerimoniaAttiva && !!myCarGroup;
        const mio = serverState[myColor];
        F1SensoVelocita.avanza(sensoVelocita, {
            velocita: guidando ? (mio && mio.speed) || 0 : 0,
            attivo: guidando,
            superficie: (guidando && misura) ? misura.superficie : F1SensoVelocita.ASFALTO,
        }, dtMs);
        // La matrice di proiezione si ricalcola solo quando il valore si muove
        // per davvero: fermi ai box, o in una qualunque delle schermate, questo
        // non costa niente.
        if (Math.abs(camera.fov - sensoVelocita.fov) > 0.01) {
            camera.fov = sensoVelocita.fov;
            camera.updateProjectionMatrix();
        }
        aggiornaBordiSchermo(sensoVelocita.bordi);
    }

    // I bordi dello schermo (vignettatura + linee di flusso, vedi f1.css). Si
    // tocca SOLO l'opacità, che è la proprietà che il browser sa comporre senza
    // ridisegnare niente — e la si tocca solo quando cambia davvero.
    //
    // Sotto la soglia l'elemento sparisce del tutto (`display: none`) invece di
    // restare trasparente: un velo a schermo intero che non si vede è comunque
    // un livello che il compositore deve considerare, e per tutta la parte lenta
    // del giro non ha nulla da mostrare.
    const bordiEl = document.getElementById('senso-bordi');
    let bordiApplicati = -1;
    function aggiornaBordiSchermo(intensita) {
        if (!bordiEl) return;
        const val = intensita < 0.004 ? 0 : intensita;
        if (Math.abs(val - bordiApplicati) < 0.01) return;
        if (val === 0) {
            bordiEl.style.display = 'none';
        } else {
            if (bordiApplicati <= 0) bordiEl.style.display = 'block';
            bordiEl.style.opacity = val.toFixed(3);
        }
        bordiApplicati = val;
    }

    function updateCamera() {
        if (!myCarGroup) return;
        const pos = myCarGroup.position;
        const q = myCarGroup.quaternion;
        const back = isLookingBack();

        if (cameraMode === 'third') {
            // "Guarda dietro" = specchio esatto della camera normale: stessa
            // altezza e stessa distanza, ma davanti al musetto e con lo
            // sguardo all'indietro (il punto mirato resta l'auto, quindi la
            // rotazione di 180° viene da sé). Si vede il frontale della
            // propria vettura in primo piano, come guardando avanti se ne
            // vede il retro; con la camera a 5.5 che mira a 1.2 l'auto (alta
            // 1.79) resta nella fascia bassa dell'inquadratura e chi insegue
            // rimane visibile sopra di essa.
            // La molla del senso di velocità: arretra e si abbassa in
            // accelerazione, si avvicina e si alza in frenata. `dz` è in
            // coordinate locali (+Z = avanti), quindi vale anche per il "guarda
            // dietro", dove la camera sta davanti al musetto: lo stesso segno
            // dice che accelerando è l'auto ad avvicinarsi alla camera.
            const m = F1SensoVelocita.molla(sensoVelocita.spinta);
            const sc = F1SensoVelocita.scossone(sensoVelocita);
            _camOff.set(sc.dx, 5.5 + m.dy + sc.dy, (back ? 13 : -13) + m.dz);
            _camOff.applyQuaternion(q);
            camera.position.copy(pos).add(_camOff);
            _lookTgt.copy(pos).add(new THREE.Vector3(0, 1.2, 0));
            mescolaSguardoSemaforo(_lookTgt);
            camera.lookAt(_lookTgt);
            // Il rollio va DOPO lookAt: ruota attorno all'asse di vista, che
            // lookAt ha appena finito di stabilire.
            if (sc.rollRad) camera.rotateZ(sc.rollRad);
        } else {
            // Halo-cam broadcast (F1 TV pod): misurato sulla mesh reale (non
            // dedotto) analizzando il profilo di altezza lungo la lunghezza
            // dell'auto — il punto più alto del modello (apice halo/roll-hoop)
            // sta a z locale ≈ -0.14, y locale = 0.256 (il max assoluto della
            // mesh). Scalato ×3.5 e nel frame world del group (centrato in
            // x/z, y=0 a terra): apice halo ≈ (0, 1.79, -0.49). La camera sta
            // poco sopra e poco dietro quel punto, inclinata verso il basso
            // così l'halo compare in basso nell'inquadratura invece di
            // riempirla (era troppo vicino/dentro la mesh a y=1.85, z=0.3).
            const COCKPIT_HEIGHT = 1.95;  // ~0.16m sopra l'apice halo misurato (1.79)
            const COCKPIT_Z = -0.5;  // appena dietro l'apice halo misurato (-0.49)
            const COCKPIT_PITCH_DEG = 10;    // inclinazione verso il basso
            const COCKPIT_LOOK_DIST = 30;

            // Qui la camera è sul telaio: prende gli scossoni per intero (×1.5
            // rispetto alla camera d'inseguimento, che è un'astrazione), ma come
            // ROTAZIONE e non come spostamento — la scocca è a mezza unità
            // dall'obiettivo, e traslare qui la faceva saltare per parallasse
            // invece di far tremare l'inquadratura (segnalato al playtest).
            // `dx`/`dy` sono zero per costruzione in questo ramo.
            const scHalo = F1SensoVelocita.scossone(sensoVelocita, { halo: true });
            _camOff.set(0, COCKPIT_HEIGHT, COCKPIT_Z);
            _camOff.applyQuaternion(q);
            camera.position.copy(pos).add(_camOff);

            // Dall'halo-cam la camera è imbullonata al telaio: spostarla
            // sarebbe la testa del pilota che scivola nell'abitacolo. La molla
            // qui è un beccheggio di pochi gradi — il muso che si siede in
            // accelerazione, che si tuffa in frenata.
            const pitchRad = (COCKPIT_PITCH_DEG + F1SensoVelocita.molla(sensoVelocita.spinta).beccheggioDeg) * Math.PI / 180;
            // "Guarda dietro" dall'halo-cam = il pilota gira la testa: la
            // camera resta dov'è e il punto mirato passa dietro l'auto, con
            // la stessa inclinazione verso il basso. La distanza orizzontale
            // fra i due va presa in valore assoluto: guardando indietro il
            // bersaglio sta dalla parte opposta della camera, e la differenza
            // con segno ribalterebbe l'inclinazione facendo puntare in alto.
            const lookDist = back ? -COCKPIT_LOOK_DIST : COCKPIT_LOOK_DIST;
            const lookDropY = Math.tan(pitchRad) * Math.abs(lookDist - COCKPIT_Z);
            _lookTgt.set(0, COCKPIT_HEIGHT - lookDropY, lookDist);
            _lookTgt.applyQuaternion(q);
            _lookTgt.add(pos);
            mescolaSguardoSemaforo(_lookTgt);
            camera.lookAt(_lookTgt);
            // Tutte e tre dopo lookAt: sono rotazioni negli assi della camera,
            // che lookAt ha appena finito di stabilire. Tremano insieme il
            // mondo e l'auto in primo piano, nella stessa misura — che è
            // esattamente ciò che vede chi ha la testa dentro l'abitacolo.
            if (scHalo.pitchRad) camera.rotateX(scHalo.pitchRad);
            if (scHalo.yawRad) camera.rotateY(scHalo.yawRad);
            if (scHalo.rollRad) camera.rotateZ(scHalo.rollRad);
        }
    }

    // Contorno pista/corsia box: generato una tantum come prima. I marker
    // (uno per giocatore, non più solo il proprio) sono <circle> SVG creati
    // e distrutti dinamicamente — stesso pattern già usato per
    // otherCars/hitboxMeshes altrove in questo file — non anime.js: con un
    // insieme dinamico di piloti che si uniscono/lasciano la partita,
    // gestire N istanze anime.js parallele è inutilmente complesso, e
    // getPointAtLength nativo basta da solo per posizionare un punto.
    const minimapTrackEl = document.getElementById('minimap-track');
    const minimapPitEl = document.getElementById('minimap-pit');
    const minimapT = minimapTransform([...trackPts, ...PIT_PTS]);
    const dPista = minimapPathString(trackPts, minimapT, true);
    const dBox = minimapPathString(PIT_PTS, minimapT, false);
    minimapTrackEl.setAttribute('d', dPista);
    minimapPitEl.setAttribute('d', dBox);
    // Il filo chiaro sopra il nastro scuro: stessa `d`, tratto più sottile.
    const pistaChiara = document.getElementById('minimap-track-fill');
    const boxChiara = document.getElementById('minimap-pit-fill');
    if (pistaChiara) pistaChiara.setAttribute('d', dPista);
    if (boxChiara) boxChiara.setAttribute('d', dBox);

    // ── Traguardo e confini di settore ──────────────────────────────────────
    // Due trattini di traverso al nastro dove finisce un settore e ne comincia
    // un altro, più la linea del traguardo a scacchi. I confini sono a un terzo
    // e a due terzi del giro CONTATI DAL TRAGUARDO, che è la stessa definizione
    // del server (SECTOR1_REL_IDX / SECTOR2_REL_IDX in f1GameSocket.js): se qui
    // li si contasse dall'inizio dell'array, la mappa mostrerebbe confini che
    // non sono quelli su cui vengono presi i tempi.
    function segnoDiTraverso(idx, lunghezza) {
        const p = trackPts[idx % trackPts.length];
        const n = TrackGeometry.normalAt(trackPts, idx % trackPts.length, true);
        const x = p.x * minimapT.scale + minimapT.offX;
        const y = p.z * minimapT.scale + minimapT.offZ;
        // La normale è unitaria e `lunghezza` è in unità del viewBox, non del
        // mondo: il trattino deve avere la stessa lunghezza A SCHERMO su un
        // circuito da un chilometro e su uno da sette, altrimenti sul più
        // grande diventa invisibile e sul più piccolo taglia la mappa in due.
        const dx = n.nx * lunghezza, dy = n.nz * lunghezza;
        return { x1: x - dx, y1: y - dy, x2: x + dx, y2: y + dy };
    }

    const svgMinimappa = document.getElementById('minimap-svg');
    function aggiungiSegno(idx, classe, lunghezza) {
        if (!svgMinimappa || !trackPts.length) return;
        const s = segnoDiTraverso(idx, lunghezza);
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        el.setAttribute('class', classe);
        el.setAttribute('x1', s.x1.toFixed(2)); el.setAttribute('y1', s.y1.toFixed(2));
        el.setAttribute('x2', s.x2.toFixed(2)); el.setAttribute('y2', s.y2.toFixed(2));
        // Prima dei pallini dei piloti, che vengono appesi in coda e devono
        // restare sopra a tutto.
        svgMinimappa.appendChild(el);
    }

    {
        const n = trackPts.length;
        const s1 = (START_FINISH_INDEX + Math.round(n / 3)) % n;
        const s2 = (START_FINISH_INDEX + Math.round(2 * n / 3)) % n;
        aggiungiSegno(s1, 'minimap-settore', 5.5);
        aggiungiSegno(s2, 'minimap-settore', 5.5);
        // Il traguardo per ultimo, così sta sopra gli altri due se il circuito
        // è così corto da farli quasi coincidere.
        aggiungiSegno(START_FINISH_INDEX, 'minimap-traguardo', 6.5);
    }

    // La mappa dentro l'anteprima del circuito non c'e piu: tolta su richiesta
    // dell'utente quando la pagina e' stata rifatta sull'infografica. Diceva
    // dove cadesse l'inquadratura corrente sul giro — un'informazione di
    // contorno dentro l'unico riquadro che deve mostrare il circuito e basta.

    const minimapDots = {};   // color -> <circle> element

    function ensureMinimapDot(color) {
        if (minimapDots[color]) return minimapDots[color];
        const svg = document.getElementById('minimap-svg');
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('r', color === myColor ? '4' : '3');
        c.setAttribute('fill', color);
        c.setAttribute('stroke', 'rgba(0,0,0,0.55)');
        c.setAttribute('stroke-width', '1');
        svg.appendChild(c);
        minimapDots[color] = c;
        return c;
    }

    // Sceglie il tracciato (pista o corsia box) da cui prendere la posizione
    // in base a quale dei due passa più vicino alla posizione REALE (x,z)
    // del giocatore, invece di affidarsi solo a trackIndex (che è un indice
    // sulla sola pista principale: durante la sosta ai box restava agganciato
    // al punto più vicino della pista, quindi il pallino restava fermo
    // sull'ingresso box invece di seguire l'auto lungo la corsia).
    function updateMinimapDot(color, x, z) {
        const dot = ensureMinimapDot(color);
        const nearTrack = TrackGeometry.nearestPoint(trackPts, x, z);
        const nearPit = TrackGeometry.nearestPoint(PIT_PTS, x, z);

        let pt;
        if (nearPit.dist < nearTrack.dist) {
            const progress = nearPit.index / (PIT_PTS.length - 1);
            const len = minimapPitEl.getTotalLength();
            pt = minimapPitEl.getPointAtLength(progress * len);
        } else {
            const progress = (nearTrack.index / trackPts.length) % 1;
            const len = minimapTrackEl.getTotalLength();
            pt = minimapTrackEl.getPointAtLength(progress * len);
        }
        dot.setAttribute('cx', pt.x);
        dot.setAttribute('cy', pt.y);
    }

    const timerEl = document.getElementById('hud-timer');
    const speedEl = document.getElementById('speed-value');
    const timerDeltaEl = document.getElementById('hud-timer-delta');

    function animate() {
        requestAnimationFrame(animate);
        // Quanto di un frame è LOGICA e quanto è disegno. Senza questa
        // separazione il pannello dice solo "disegno 11 ms su 20", e gli
        // altri 9 restano un buco nero in cui può esserci di tutto: fisica
        // del client, interpolazione, audio, o semplicemente l'attesa che la
        // GPU finisca il frame precedente.
        const _tLogica = performance.now();

        // Durata del frame precedente: serve a far avanzare lo sguardo verso
        // i semafori a tempo e non a frame, così il movimento dura uguale a
        // 30 e a 144 fps. Il tetto di 100 ms evita che una pausa lunga (una
        // scheda tornata in primo piano) lo faccia saltare tutto in un colpo.
        const _dt = Math.min(100, _tLogica - (animate._ultimo || _tLogica));
        animate._ultimo = _tLogica;
        avanzaSguardo(_dt);

        if (typeof F1GamepadInput !== 'undefined') {
            const gp = F1GamepadInput.poll();
            // Fuori dal ramo "connected": a controller staccato poll()
            // restituisce lookBack false, che è esattamente ciò che serve.
            lookBackPad = !!(gp && gp.lookBack);
            if (gp && gp.connected) {
                inputs.throttle = gp.throttle;
                inputs.brake = gp.brake;
                inputs.steer = gp.steer;
            }
        }
        maybeSendInputs();

        for (const [color, target] of Object.entries(serverState)) {
            const v = visualState[color];
            if (!v) continue;

            v.x += (target.x - v.x) * LERP;
            v.z += (target.z - v.z) * LERP;
            v.angle = lerpAngle(v.angle || 0, target.angle || 0, LERP);
            v.steerAngle = (v.steerAngle || 0) + ((target.steerInput || 0) * MAX_WHEEL_STEER_RAD - (v.steerAngle || 0)) * LERP;

            const carGroup = color === myColor ? myCarGroup : otherCars[color];
            if (carGroup) {
                // Quota e inclinazione solo visive, agganciate all'indice pista
                // che tiene già il server (trackIndex): niente ricerca "punto più
                // vicino nello spazio", che su tracciati che si riavvicinano a se
                // stessi può agganciarsi a un tratto sbagliato del giro. La
                // fisica server resta interamente 2D (x/z), qui si aggiusta solo
                // dove/come appare l'auto quando la pista ha dislivelli.
                const idx = (target.trackIndex != null)
                    ? target.trackIndex
                    : TrackGeometry.nearestPoint(trackPts, v.x, v.z).index;
                // Il server aggiorna trackIndex solo al proprio tick (20/s): senza
                // ammorbidire quota e beccheggio come già succede per x/z/angle,
                // ogni salto di campione si vede come uno scatto, evidente sui
                // dislivelli e invisibile in piano (dove restano sempre a 0).
                // Fuori pista (stessa soglia di applyOffTrackDrag lato server,
                // roadHalf+2) la quota visiva segue il terrapieno alla
                // posizione REALE dell'auto invece di restare agganciata alla
                // quota dell'indice pista — sui tratti sopraelevati altrimenti
                // l'auto resterebbe a "volare" alla quota pista anche ben
                // oltre il bordo.
                // Decisione e query sulla posizione AUTORITATIVA del server
                // (target.x/z), non su v.x/v.z (smussata via LERP verso quella):
                // su una curva, v.x/v.z può restare per qualche frame dietro/di
                // lato rispetto alla posizione vera già corretta dal muro
                // rigido dei ponti, facendo scattare qui il fallback "fuori
                // pista" anche quando il server non l'ha mai considerata tale —
                // su un vero incrocio (dove terrainHeightAt scende quasi a 0,
                // vedi sopra) questo si vedeva come un crollo/risalita di quota
                // a scatti (segnalato dall'utente).
                const distFromCenter = Math.hypot(target.x - trackPts[idx].x, target.z - trackPts[idx].z);
                // groundPts (non trackPts): se l'auto esce di pista proprio
                // sotto/accanto a un ponte, la quota deve seguire il terreno
                // vero, non agganciarsi al punto-ponte più vicino.
                const wasOffBridgeEdge = _offBridgeEdgeState[color] || false;
                const offBridgeEdge = wasOffBridgeEdge
                    ? distFromCenter > (ROAD_HALF + 2 - OFF_BRIDGE_EDGE_HYSTERESIS)
                    : distFromCenter > (ROAD_HALF + 2 + OFF_BRIDGE_EDGE_HYSTERESIS);
                _offBridgeEdgeState[color] = offBridgeEdge;
                const targetY = offBridgeEdge
                    ? TrackGeometry.terrainHeightAt(groundPts, target.x, target.z, EMBANK_PLATEAU, EMBANK_OUTER)
                    : (trackPts[idx].y || 0);

                v.y = (v.y || 0) + (targetY - (v.y || 0)) * LERP;
                v.pitch = (v.pitch || 0) + (trackPitchAt(idx) - (v.pitch || 0)) * LERP;
                carGroup.position.set(v.x, v.y, v.z);
                carGroup.rotation.order = 'YXZ';
                carGroup.rotation.x = v.pitch;
                carGroup.rotation.y = v.angle;
                // Rotazione ruote basata sulla velocità
                if (carGroup.userData.wheels && carGroup.userData.wheels.length > 0) {
                    carGroup.userData.wheelRot = (carGroup.userData.wheelRot || 0) + Math.abs(target.speed || 0) * 1.4;
                    const wr = carGroup.userData.wheelRot;
                    for (const w of carGroup.userData.wheels) w.rotation.x = wr;
                }
                // Sterzo visivo: solo le ruote anteriori ruotano sull'asse
                // verticale (Y) in base a v.steerAngle (smussato sopra) —
                // effetto puramente cosmetico, la traiettoria reale resta
                // quella calcolata dal server su x/z/angle.
                if (carGroup.userData.frontWheels && carGroup.userData.frontWheels.length > 0) {
                    for (const w of carGroup.userData.frontWheels) w.rotation.y = v.steerAngle;
                }
                // Colore cerchio in base alla mescola montata: si rigenera la
                // texture ruota una sola volta per ogni cambio effettivo (non
                // ad ogni frame), confrontando col valore già applicato
                // memorizzato su carGroup.userData.appliedCompound. Prima che
                // il server sappia la mescola (tyre_select, compound=null) il
                // controllo non scatta e il cerchio resta al colore originale.
                if (target.compound && tyreCompoundsInfo && carGroup.userData.setCompoundColor
                    && carGroup.userData.appliedCompound !== target.compound) {
                    const info = tyreCompoundsInfo[target.compound];
                    if (info) {
                        const compoundHex = parseInt(info.color.replace('#', ''), 16);
                        carGroup.userData.setCompoundColor(compoundHex);
                        carGroup.userData.appliedCompound = target.compound;
                    }
                }
                // Motore: pitch/volume seguono la velocità REALE in
                // continuo, con range diversi se l'auto sta accelerando o
                // decelerando/rilasciando (anche solo per attrito, senza
                // frenare, è comunque una decelerazione udibile) — stesso
                // loop per entrambe le fasi, nessun file diverso.
                // Eccezione: in corsia box con autopilota (limitatore
                // inserito) il regime è fisso, perché la velocità è
                // costante ma il motore gira comunque, anche se non stai
                // guidando tu in quella fase.
                if (carGroup.userData.engineSound) {
                    const spd = target.speed || 0;
                    const actxNow = listener.context.currentTime;
                    const RAMP = 0.08;   // costante di tempo rampa volume (setTargetAtTime), evita click
                    // Il playbackRate salta tra due formule diverse
                    // (accelerando/decelerando) nello stesso istante in cui
                    // lo stato cambia — un salto anche di 0.6 a frac≈1. La
                    // rampa interna di THREE.Audio.setPlaybackRate (fissa a
                    // 10ms) è troppo breve per un salto così ampio e si
                    // sente come un "colpo": qui bypassiamo setPlaybackRate
                    // e rampiamo noi il parametro sottostante, più lento.
                    const RATE_RAMP = 0.15;
                    let targetRate, targetVolume, frac;

                    if (target.pitLimiter) {
                        targetRate = 0.9;
                        targetVolume = 0.15;
                        frac = 0.25;   // regime fisso e basso, coerente col limitatore
                    } else {
                        const now = performance.now();
                        const prevChecked = engineLastCheckedSpeed[color];
                        const magPrev = Math.abs(prevChecked ?? spd);
                        const magNow = Math.abs(spd);
                        if (prevChecked === undefined || Math.abs(magNow - magPrev) > ENGINE_SPEED_DELTA_EPS) {
                            engineActiveSince[color] = now;
                            engineLastCheckedSpeed[color] = spd;
                        }
                        let active = (now - (engineActiveSince[color] || 0)) < ENGINE_ACTIVE_HOLD_MS;
                        // La mia auto: niente silenzio finché tengo premuto
                        // accelera/freno, anche se la velocità ha smesso di
                        // cambiare perché ha toccato il tetto massimo (avanti
                        // o in retromarcia) — lì la variazione di velocità da
                        // sola non basta più a tenere acceso il motore.
                        if (color === myColor && (inputs.throttle > 0 || inputs.brake > 0)) active = true;

                        // Accelerando o decelerando: per la mia auto uso
                        // direttamente i tasti premuti (diretto, niente
                        // ritardo di rete); per le altre auto, di cui non
                        // conosco gli input, lo deduco dalla variazione di
                        // velocità osservata — se non cambia in modo
                        // significativo, tengo l'ultimo stato noto invece di
                        // far sfarfallare il suono.
                        let accelerating;
                        if (color === myColor && (inputs.throttle > 0 || inputs.brake > 0)) {
                            accelerating = inputs.throttle > 0;
                        } else if (magNow > magPrev + ENGINE_SPEED_DELTA_EPS) {
                            accelerating = true;
                        } else if (magNow < magPrev - ENGINE_SPEED_DELTA_EPS) {
                            accelerating = false;
                        } else {
                            accelerating = engineAccelerating[color] ?? true;
                        }
                        engineAccelerating[color] = accelerating;

                        frac = Math.min(1, magNow / ENGINE_REF_MAX_SPEED);
                        if (accelerating) {
                            targetRate = 0.8 + frac * 0.9;                    // 0.8x fermo → 1.7x a tutta velocità
                            targetVolume = active ? (0.09 + frac * 0.30) : 0;
                        } else {
                            targetRate = 0.6 + frac * 0.5;                    // 0.6x fermo → 1.1x a tutta velocità, più cupo
                            targetVolume = active ? (0.05 + frac * 0.14) : 0;
                        }
                    }

                    carGroup.userData.engineSound.source.playbackRate.setTargetAtTime(targetRate, actxNow, RATE_RAMP);
                    carGroup.userData.engineSound.gain.gain.setTargetAtTime(targetVolume * ENGINE_VOLUME_MULT, actxNow, RAMP);
                }
            }

            if (color === myColor) {
                speedEl.textContent = Math.round(Math.abs(target.speed || 0) * 55);
                // Questo è animate(), girato a ~60fps: target è la stessa
                // istanza di serverState[color] finché non arriva un NUOVO
                // f1StateUpdate (~ogni 50ms) — riagganciare qui SOLO quando
                // il valore è davvero cambiato, altrimenti Date.now() si
                // resetta ad ogni frame e l'estrapolazione sotto non ha mai
                // il tempo di accumularsi (bug reale, causa dei salti di
                // 50/150ms segnalati dall'utente).
                if (typeof target.elapsedMs === 'number' && target.elapsedMs !== myLiveElapsedMs) {
                    myLiveElapsedMs = target.elapsedMs;
                    myLiveElapsedSyncedAt = Date.now();
                }
                if (target.finished && target.time) {
                    myFinalTime = target.time;
                }
                myDeltaToPreviousLapMs = (typeof target.deltaToPreviousLapMs === 'number') ? target.deltaToPreviousLapMs : null;
                const sectorBarsEl = document.getElementById('sector-bars');
                if (sectorBarsEl) sectorBarsEl.style.display = (currentPhase === 'race') ? 'flex' : 'none';
                if (currentPhase === 'race') {
                    updateSectorBars(target.sectorTimes, target.prevSectorTimes, target.bestSectorTimes);
                }
                // Overlay "in attesa degli altri piloti": mostrato solo se la
                // sessione è ancora aperta (qualiSessionOpen, chiuso SOLO da
                // eventi di ciclo vita — mai da target.finished, vedi
                // dichiarazione della variabile). Rif. 2026-08-07, terzo
                // giro: durante 'grid_display' (il pannello coi tempi che
                // segue f1QualiEnded) il server smette di mandare
                // f1StateUpdate del tutto (playersVisibleTo ritorna {} per
                // quella fase) — quindi target.finished per il proprio
                // colore resta congelato true per l'INTERA durata della
                // griglia, non pochi tick: un mostra/nascondi basato solo su
                // target.finished (tentativo precedente) restava sovrapposto
                // al pannello dei tempi per tutti gli 8 secondi. qualiSessionOpen
                // si autocorregge SEMPRE su eventi certi (mai su un dato che
                // può congelarsi), quindi qui basta leggerlo.
                // Vale anche in GARA, non più solo in qualifica: da quando il
                // traguardo non congela l'auto, chi ha finito continua a
                // girare e ha bisogno di sapere perché la sessione non si
                // chiude. `qualiSessionOpen` copre la qualifica; in gara
                // basta che il podio non sia ancora comparso, e ci pensa
                // f1RaceEnded a nascondere l'avviso.
                const sessioneAperta = currentPhase === 'race' ? isRacing : qualiSessionOpen;
                aggiornaContoFineGara();
                const avviso = document.getElementById('quali-waiting-overlay');
                if (sessioneAperta && target.finished && target.time) {
                    const titolo = document.getElementById('quali-waiting-titolo');
                    if (titolo) {
                        titolo.textContent = currentPhase === 'race'
                            ? 'GARA COMPLETATA' : 'QUALIFICA COMPLETATA';
                    }
                    avviso.style.display = 'flex';
                } else {
                    avviso.style.display = 'none';
                }
            }
        }

        if (isRacing && myLiveElapsedMs !== null) {
            // Estrapolazione locale dall'ultimo aggancio reale (vedi sopra):
            // scorre liscio ad ogni frame invece di restare fermo fino al
            // prossimo tick del server, ma resta ancorato al tempo VERO
            // (mai driftare come il vecchio Date.now()-localStart, perché si
            // ri-sincronizza ad ogni tick reale, non solo all'inizio).
            const t = myFinalTime !== null ? myFinalTime : (myLiveElapsedMs + (Date.now() - myLiveElapsedSyncedAt));
            const m = Math.floor(t / 60000);
            const s = Math.floor((t % 60000) / 1000);
            const ms = t % 1000;
            timerEl.textContent = `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
            // Colore: verde a tempo fissato (comportamento invariato, ha
            // sempre priorità — mai sovrascritto dal delta sotto), altrimenti
            // nessun override così resta il colore chiaro di .hud-mono — il
            // vecchio #2C3E50 (blu navy, pensato per il pannello chiaro
            // pre-redesign) era quasi invisibile sullo schermo scuro
            // incassato (segnalato dall'utente come "blu su blu"). Mentre il
            // giro è in corso, verde/rosso in base al delta continuo rispetto
            // al giro precedente (Rif.
            // docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md).
            if (myFinalTime !== null) {
                timerEl.style.color = '#2ecc71';
            } else if (myDeltaToPreviousLapMs == null || myDeltaToPreviousLapMs === 0) {
                timerEl.style.color = '';
            } else {
                timerEl.style.color = myDeltaToPreviousLapMs < 0 ? 'var(--green)' : 'var(--red)';
            }
            // Testo del delta ("di quanto"): visibile solo mentre il giro è
            // in corso e c'è un giro precedente con cui confrontare — sparisce
            // a giro concluso (myFinalTime) insieme al resto del "live".
            if (timerDeltaEl) {
                if (myFinalTime !== null || myDeltaToPreviousLapMs == null) {
                    timerDeltaEl.style.display = 'none';
                } else {
                    timerDeltaEl.style.display = 'block';
                    timerDeltaEl.textContent = formatDelta(myDeltaToPreviousLapMs);
                    timerDeltaEl.style.color = myDeltaToPreviousLapMs < 0 ? 'var(--green)' : (myDeltaToPreviousLapMs > 0 ? 'var(--red)' : '');
                }
            }
        }

        // Che cosa c'è sotto l'auto: una misura sola per frame, usata sia dalla
        // camera (gli scossoni) sia dai detriti (il colore e se emettere).
        const _misuraSuperficie = superficieSottoLAuto();

        // Prima di scegliere DOVE sta la camera, quanto vede: il campo visivo
        // partecipa alle inquadrature delle schermate (che lo leggono per
        // posizionare l'auto della vetrina), quindi va risolto per primo.
        aggiornaCampoVisivo(_dt, _misuraSuperficie);
        aggiornaEffettiVetture(_dt, _misuraSuperficie);
        aggiornaMuroPit();
        aggiornaTempiCorsia();

        if (tyreSelectActive) updateTyreSelectCamera();
        else if (premiazione) aggiornaPremiazione(_dt);
        else if (panoramicaAttiva) aggiornaCameraPanoramica();
        else if (cerimoniaAttiva) aggiornaCameraCerimonia();
        else updateCamera();
        seguiConLeOmbre();
        toonSky.update(camera);
        F1Perf.logica = performance.now() - _tLogica;
        ToonOutline.render(renderer, scene, camera);
        // Un frame è stato disegnato: da qui in poi togliere la schermata di
        // caricamento non scopre un canvas ancora vuoto.
        segnalaPrimoFrame();
    }

    animate();

    // ====================================================
    // FINE DEL CARICAMENTO
    // ====================================================
    // Si scopre il gioco solo a circuito COMPLETO: scenografia istanziata,
    // propria auto in scena (che implica la risposta del server: è f1Setup a
    // farla caricare) e un frame già disegnato.
    //
    // Il paracadute non è pessimismo: senza, un asset che non risponde o un
    // f1Setup mai arrivato lascerebbero il giocatore davanti a una barra
    // ferma, cioè un guasto peggiore dello schermo nero che stiamo togliendo.
    const CARICAMENTO_MAX_MS = 20000;
    Promise.race([
        Promise.all([scenografiaPronta, autoPronta, primoFrame]),
        new Promise(r => setTimeout(() => r('scaduto'), CARICAMENTO_MAX_MS)),
    ]).then((esito) => {
        if (esito === 'scaduto') {
            console.warn(`[F1] caricamento oltre ${CARICAMENTO_MAX_MS / 1000}s: si prosegue comunque`);
        }
        caricamento.passo('Pronti', 1);
        caricamento.spegni();
    });
    scenografiaPronta.then(() => caricamento.passo('Vetture…', 0.98));

    window.addEventListener('resize', () => {
        if (tyreSelectActive) {
            const frame = document.getElementById('tyre-preview-frame');
            camera.aspect = frame.clientWidth / frame.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(frame.clientWidth, frame.clientHeight);
        } else {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
        // L'auto della vetrina sta in una frazione di schermo, non a una
        // coordinata fissa: cambiando proporzioni va rimessa dov'e' la colonna.
        posizionaAutoInPole();
        // Fuori dall'if: il buffer dei contorni va ridimensionato in entrambi
        // i rami, altrimenti resta della misura precedente e il tratto si
        // sposta rispetto all'immagine.
        ToonOutline.setSize(renderer);
    });
});
