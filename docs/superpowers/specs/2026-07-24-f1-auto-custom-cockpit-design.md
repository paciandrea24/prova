# F1 — modello auto custom per visuale cockpit (sotto-progetto A)

## Contesto

L'utente vuole una visuale in prima persona (tasto C) più immersiva, in stile
"cockpit arretrato" come nei giochi F1 ufficiali (vede il muso, l'halo, gli
specchietti della propria auto davanti a sé), e una velocità mostrata come
cruscotto digitale in basso al centro quando si è in quella visuale.

Il modello auto attuale (`frontend/assets/kenney/raceCarWhite.glb`, pack
Kenney "Racing Kit" CC0) è un'auto generica stile go-kart, senza halo,
specchietti o muso a punta — non regge una visuale cockpit ravvicinata.
Nessun asset CC0 pronto nello stesso stile Kenney copre un'auto a ruote
scoperte con halo (verificato via ricerca web: il Racing Kit non lo
contiene, pack terzi trovati sono a pagamento o di provenienza/licenza non
verificata). Si costruisce quindi un modello su misura.

L'utente ha fornito due immagini di riferimento (proprie, generate con
ChatGPT Image) di un'auto F1 in stile voxel molto dettagliato: una vista
dall'alto e un foglio di controllo con vista laterale, frontale, posteriore
e dall'alto. Replicare quel livello di dettaglio voxel-per-voxel non è
praticabile (nessuna informazione di profondità reale oltre le 4 proiezioni,
e migliaia di cubetti per auto sarebbero pesanti in un gioco multiplayer
con più auto in pista in WebGL). Si usa invece una tecnica di **scultura
per silhouette** (visual hull) che ricostruisce automaticamente una forma
3D semplificata a partire dalle 4 viste ortogonali fornite — vedi sezione
dedicata sotto.

Questo è il primo di tre sotto-progetti collegati, in quest'ordine:
- **A (questo documento)**: nuovo modello auto in Blender.
- **B**: riposizionamento della camera cockpit, tarato sulle proporzioni
  reali del modello costruito in A.
- **C**: spostamento del readout velocità in basso al centro, solo in
  visuale cockpit.

B e C avranno ciascuno il proprio spec/piano una volta che A è completo e
approvato — le proporzioni esatte del modello (dove sta l'halo, quanto è
lungo il muso) servono per tarare la camera in B.

## Obiettivo di questo sotto-progetto

Costruire un modello 3D custom di un'auto stile F1 a ruote scoperte, in
stile boxy/voxel coerente col resto della scena, con halo, muso/ala
anteriore, ala posteriore, specchietti e ruote — sufficiente a rendere
credibile una visuale cockpit ravvicinata. Il modello viene renderizzato in
anteprima e approvato dall'utente PRIMA di essere collegato al gioco.

## Vincoli tecnici (dal codice esistente)

Da `frontend/f1.js`, funzione `loadCarModel()` (righe ~295-405):

- **Ricolore per team a runtime**: qualunque mesh il cui colore materiale è
  quasi-bianco (`r,g,b > 0.85`) viene ricolorata con l'hex del giocatore
  (righe 324-329). La carrozzeria "verniciabile" (musetto, sidepod, cover
  motore, endplate ala) va modellata in bianco/quasi-bianco. Le parti che
  devono restare fisse indipendentemente dal team (gomme, halo, dettagli
  carbonio) vanno modellate in altri colori (nero/grigio scuro) per non
  essere toccate dal ricolore.
- **Riconoscimento ruote**: mesh o nodo-parent il cui nome contiene
  "wheel"/"tyre"/"tire" (case-insensitive, righe 331-350) vengono raccolte e
  ruotate ogni frame in base alla velocità. Se non trovate per nome, c'è un
  fallback su bounding-box (parti nel 38% inferiore d'altezza) e infine
  ruote cilindriche sintetiche — entrambi i fallback sono meno affidabili,
  quindi le 4 ruote nel modello vanno nominate esplicitamente (es. nodi
  `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR`).
- **Pivot e scala**: al caricamento il modello viene ricentrato sul proprio
  bounding box (X/Z al centro, Y a terra, righe 308-313) e poi scalato
  ×3.5 (riga 301) — il pivot grezzo esportato da Blender non conta,
  contano le proporzioni relative fra le parti.
- **Footprint fisico**: l'hitbox di collisione lato server è fissa e
  indipendente dal modello visivo — `CAR_HALF_WIDTH=1.3`,
  `CAR_HALF_LENGTH=2.4` (`backend/sockets/games/f1GameSocket.js:58-59`,
  quindi ingombro reale 2.6m × 4.8m). Il modello va costruito con
  proporzioni realistiche di un'auto a ruote scoperte; la scala finale
  (il fattore ×3.5 o un valore corretto) si aggiusta in fase di rifinitura
  per far combaciare visivo e hitbox, senza toccare l'hitbox stessa.
- **Path asset**: il modello va salvato fuori dalla cartella
  `frontend/assets/kenney/` (che contiene solo asset del pack Kenney CC0),
  in `frontend/assets/custom/f1Car.glb` — nuova cartella per asset custom
  del progetto.
- I 3 file `raceCarGreen/Orange/Red.glb` non sono referenziati da nessun
  loader (solo `raceCarWhite.glb` viene caricato, sempre, indipendentemente
  dal colore giocatore — il ricolore avviene sempre a runtime). Restano
  come sono, non toccati da questo lavoro.

## Tecnica: scultura per silhouette (visual hull)

Il riferimento fornito dall'utente (`backend/tools/reference/f1-car-turnaround.png`,
copiato nel repo) contiene 4 viste ortogonali utilizzabili: laterale,
frontale, posteriore, dall'alto (più due render prospettici non usati).
Bounding box già misurate (frazioni dell'immagine 1672×941):

| vista      | x                | y                |
|------------|------------------|------------------|
| laterale   | [0.0257, 0.5652] | [0.0925, 0.3124] |
| frontale   | [0.6525, 0.8894] | [0.0840, 0.3284] |
| posteriore | [0.6519, 0.9139] | [0.3294, 0.6281] |
| dall'alto  | [0.0377, 0.4898] | [0.6440, 0.9564] |

Algoritmo (fedele a una tecnica standard di ricostruzione 3D da più
silhouette, semplificata per uso in un gioco):

1. **Segmentazione ruote/scocca per vista**: su ciascuna delle 4 viste
   ritagliate, si etichettano le regioni connesse non-sfondo (soglia sulla
   distanza dal colore di sfondo ~`(26,26,26)`); le componenti compatte
   (area riempita vicina al proprio bounding box, bounding box vicino al
   quadrato) sono classificate come ruote e rimosse dalla maschera
   "scocca" usata per lo scavo. Le stesse componenti-ruota nella vista
   dall'alto e laterale danno anche diametro/carreggiata/passo reali da
   riusare per il posizionamento delle ruote parametriche (vedi sotto).
2. **Scavo (voxel carving)**: si definisce una griglia 3D (NX×NY×NZ, es.
   32×60×18) che copre l'ingombro autorato (vedi footprint sotto). Per
   ogni cella si proietta il suo centro sulla maschera "scocca" della
   vista dall'alto (piano larghezza/lunghezza), laterale (piano
   lunghezza/altezza) e frontale-o-posteriore (piano larghezza/altezza,
   frontale se la cella è nella metà anteriore, posteriore se nella metà
   posteriore — muso e ala posteriore hanno sagome diverse). La cella
   resta piena solo se **tutte e 3** le proiezioni cadono dentro la
   sagoma (intersezione, non unione).
3. **Colore**: ogni cella piena prende il colore campionato dal pixel
   corrispondente nella vista dall'alto, poi viene classificato in una
   delle 4 categorie fisse sotto (non si usa il colore esatto per-voxel,
   per restare compatibili col meccanismo di ricolore a runtime già
   presente nel gioco).
4. **Merge**: celle piene adiacenti lungo l'asse lunghezza con la stessa
   categoria colore vengono fuse in un unico parallelepipedo (riduce
   drasticamente il numero di oggetti rispetto a un cubo per voxel).
5. **Ruote**: NON scavate dalla griglia — restano cilindri parametrici
   (stessa tecnica del design precedente), ma dimensioni/posizione lette
   dalle componenti-ruota individuate al punto 1 invece che indovinate.

## Requisiti visivi

- **Stile**: risultato "voxel chunky" coerente con l'estetica del
  riferimento ma a risoluzione da gioco (non foto-per-pixel) — poligoni
  contenuti, adatto a più auto in pista contemporaneamente in WebGL.
- **Parti attese nel risultato scavato**: muso, sidepod, cover motore,
  halo, ali anteriore/posteriore con endplate, specchietti — non sono
  costruite a mano pezzo per pezzo come nel design precedente, ma devono
  emergere naturalmente dallo scavo se la segmentazione e la griglia sono
  abbastanza fini; se qualche dettaglio (es. gli specchietti, molto
  piccoli nel riferimento) risultasse troppo debole dopo lo scavo, si
  aggiunge a mano un piccolo box in stile "hand-placed" solo per quel
  dettaglio, senza toccare il resto della pipeline automatica.
- **Palette a 4 categorie fisse** (ogni voxel pieno viene classificato in
  una di queste, non si usa il colore esatto campionato):
  - `livery` → materiale quasi-bianco (r,g,b ≈ 0.92) — **verniciabile a
    runtime**: le aree rosse del riferimento diventano il colore del team
    in gioco, come richiede il meccanismo esistente
    (`frontend/f1.js:324-329`) e come già previsto nel design precedente.
  - `trim` → grigio scuro/nero fisso — aree scure del riferimento (ali,
    halo, dettagli).
  - `accent` → giallo/arancio fisso — eventuali accenti colorati non rossi
    non neri.
  - `trim_light` → grigio chiaro fisso (r,g,b ≈ 0.78, sotto la soglia
    0.85 di ricolore) — testi/loghi sponsor chiari sulla scocca: restano
    leggibili e non vengono tinti dal ricolore per team.
  - Gomme: nero fisso (materiale ruota già esistente nel design
    precedente, non derivato dallo scavo).

## Deliverable e workflow di approvazione

Pipeline in due stadi (analisi immagine separata dalla costruzione mesh,
così ogni stadio è testabile ed eseguibile da solo):

1. **Stadio 1** — script Python "normale" (non Blender; l'ambiente ha già
   `numpy`, `scipy`, `PIL` disponibili, nessuna nuova dipendenza) che
   applica l'algoritmo sopra al riferimento e scrive un file intermedio
   `backend/tools/f1CarVoxelData.json` con l'elenco dei parallelepipedi
   (posizione, dimensione, categoria colore) e i parametri ruota misurati.
2. **Stadio 2** — script Python headless per Blender (`blender.exe
   --background --python <script>`) che legge quel JSON, costruisce la
   mesh via `bpy` (box scavati + ruote parametriche), unisce i box per
   categoria colore in poche mesh (una per categoria, per tenere basso il
   numero di draw call), esporta il GLB in `frontend/assets/custom/f1Car.glb`
   e renderizza due PNG di anteprima (3/4 esterno + punto di vista pilota)
   nella stessa passata.
3. L'utente valuta i render; si itera aggiustando risoluzione griglia,
   soglie di segmentazione o palette (Stadio 1) e/o dettagli aggiunti a
   mano (Stadio 2) finché lo stile non è approvato.
4. Solo dopo l'approvazione esplicita, `loadCarModel()` viene aggiornata
   per puntare al nuovo file — nessun collegamento al gioco prima del gate.
5. Nessun commit/push automatico: come da convenzione di progetto, lo fa
   l'utente quando vuole.

## Fuori scope (rimandato ai sotto-progetti B e C)

- Il riposizionamento della camera cockpit (offset, altezza, FOV) — verrà
  tarato sulle proporzioni reali di questo modello, non su stime a priori.
- Lo spostamento del readout velocità in basso al centro.
- La colorazione per-team dell'halo (se mai richiesta) o altre rifiniture
  estetiche oltre l'approvazione iniziale.
