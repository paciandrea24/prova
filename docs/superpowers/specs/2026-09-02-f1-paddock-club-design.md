# Il Paddock Club: il lusso sta sopra i box (blocco G, fase G2, voce 3) — design

**Data:** 2026-09-02
**Blocco:** G, fase 2, voce 3 — l'ultima del blocco.
**Spec madri:** `2026-08-27-f1-citta-g2-design.md` (dove la voce è enunciata),
`2026-08-26-f1-ambientazione-cittadina-design.md`.

## La richiesta, e il vuoto che colma

Dalla carrellata del 23-08: «i circuiti sono delle zone per ricchi… la zona
intorno al rettilineo del traguardo e in generale ai box è curatissima e
lussuosa». L'utente ha poi deciso (27-08) che **vale ovunque**, non solo sui
circuiti cittadini.

Misurato oggi, nella finestra di 200 unità attorno al traguardo:

| | `prova` (verde) | `citta-prova` | `shanghai` |
|---|---|---|---|
| tribune | 12 coperte + 2 con tettoia | 14 coperte + 2 scoperte | 15 coperte + 4 con tettoia |
| edifici della corsia box | 10 uffici + 9 garage | **nessuno** (vedi sotto) | 11 + 11 |
| landmark | gantry + podio | solo gantry | gantry, podio, torre |
| **oggetti di lusso** | **zero** | **zero** | 3 hospitality |

⚠️ **La fila dei box non sta sempre sul rettilineo del traguardo.** Su `prova`
la corsia comincia esattamente alla linea e si sviluppa per 300 unità; su
`citta-prova` comincia **211 unità dopo** e corre per 528. Il coronamento nasce
dove nascono gli edifici, quindi veste la zona dei box — che è dove il giocatore
si ferma — ma su una pista come `citta-prova` non è la stessa inquadratura della
griglia di partenza. È una proprietà della pista, non del coronamento, e non si
corregge da qui.

`hospitalityDeck` e `vipSuite` esistono come asset dal 13-08, ma li distribuisce
`sceneryInfrastructure` **lungo tutto il giro**, dove il contesto lo consente:
nella finestra del traguardo non ne cade nemmeno uno. In città non ne nasce
neppure uno sull'intero circuito — il muro sta sul cordolo, ogni punto è
«stretto», e in quel contesto la palette non ammette niente. La zona dei box è
quindi quella che il giocatore guarda **da fermo** — griglia, sosta, podio — ed
è anche la più spoglia di tutte.

## La decisione: sopra i box, non accanto

Scelta dell'utente fra quattro posizioni possibili: **sopra i box**, cioè il
Paddock Club della F1 vera. Le ragioni che l'hanno fatta preferire:

- È dove sta nella realtà, e riusa una fila **già posata e già orientata** —
  compreso l'orientamento perpendicolare al nastro degli edifici, quello che in
  curva impedisce alla fila di aprirsi a ventaglio.
- Si vede da entrambe le situazioni in cui il giocatore è fermo o lento: la
  griglia di partenza e la corsia box.
- Non consuma terreno nuovo: niente da negoziare con tribune, paddock, facciate.

Scartate: il lato delle tribune (dove il giocatore non si ferma mai), i due lati
insieme (raddoppia il costo nella zona già più cara della scena), il blocco
staccato dietro i garage (lo coprono i garage stessi).

## I due asset

Alternanza già esistente sulla fila: `pitsGarageClosed` (alto 8.3) e
`pitsOffice` (alto 13.1) si alternano. Il coronamento la asseconda invece di
appiattirla, e ne esce una skyline mossa: **12.1 / 17.3 / 12.1 / 17.3**.

- **`pitRoofTerrace`**, sul garage. Terrazza aperta: parapetto **pieno** con
  banda di colore — una fila di montanti sottili da lontano non si legge, è la
  lezione già pagata sull'`hospitalityDeck` — pergola su montanti, tavolini con
  ombrelloni, fioriere, bancone sul fondo. Alto ~3.8.
- **`pitRoofLounge`**, sull'ufficio. ⚠️ L'ufficio **ha già** una terrazza in
  copertura, con solaio, bordo rosso e parapetto perimetrale: oggi è vuota, e il
  salotto ci si posa dentro. Vetrata continua sul fronte, marcapiano dorato,
  insegna, e un angolo lasciato aperto con verde e gazebo perché non diventi una
  scatola cieca. Alto ~4.2.

Vincoli di modellazione, gli stessi di tutto il catalogo: pianta esatta degli
edifici (corpo 12.3 × 14.0), **fronte verso -Y Blender = +Z gioco**, niente
facce complanari, massimo quattro materiali (ogni materiale in più è una draw
call in più per cella), nessun basamento — l'edificio sotto È il basamento.

⚠️ **Gate di approvazione**: i render vanno mostrati all'utente prima di cablare
gli asset in gioco. La deroga del 27-08 («li generi e li cabli direttamente»)
riguardava l'arredo di strada, non gli asset grossi in primo piano.

## Come si posano

Dove nasce un edificio nasce il suo coronamento: stesso `x`, stesso `z`, stesso
`rotY`, e `y` = quota del terreno **+ altezza dell'edificio**.

⚠️ L'altezza si legge dalla tabella degli ingombri (che un test tiene allineata
ai `.glb` veri), **mai** scritta a mano: un numero ricopiato qui diverge il
giorno in cui l'edificio cambia, e il coronamento resta sospeso o affonda senza
che nessun test se ne accorga. È lo stesso difetto già pagato tre volte sugli
ingombri dell'arredo di strada.

**Non serve nessuna esenzione ai controlli di compenetrazione.**
`SceneryAssetSizes.itemsOverlap` confronta già le quote (`a.y >= topOf(b)` →
non si toccano), quindi il modulo appoggiato sul tetto entra dalla porta della
scenografia come qualunque altro oggetto, senza indebolire la regola per
nessuno. Nessuna riga nuova in `FILE_CONTIGUE`, in `coppiaLecita` o in
`SENZA_INGOMBRO`.

Categoria nuova: **`paddock-club`**. Non riusa `paddock` perché quella gode
dell'esenzione «fila contigua», che qui mascherebbe difetti veri invece di
descrivere il disegno.

Quantità, misurate sulle piste esistenti: 25 moduli su `prova`, 31 su
`citta-prova`, 38 su `nuova-pista`, 53 su `shanghai`, 5 su `monte-rosso`.

## La gente affacciata

Riuso del sistema che già popola le terrazze delle hospitality
(`SceneryCrowd.buildTerraceCrowd`, ancore da `terraceAnchors.json`, generato
dal builder Blender insieme ai `.glb`). Le ancore dei due asset nuovi entrano
in quel file.

⚠️ Con un'aggiunta: oggi `trackScenery` elenca **a mano** quali asset hanno una
terrazza (`v.asset === 'hospitalityDeck' || v.asset === 'vipSuite'`, in due
punti, più un terzo in `trackValidatore`). Diventa una domanda al file delle
ancore: «di questo asset ho delle ancore?». Così un asset nuovo con la sua
terrazza non può più nascere spopolato per dimenticanza — che è esattamente il
modo in cui questa voce fallirebbe in silenzio.

Circa 6 figure a terrazza; il tetto per pista lo impone già `MAX_TERRACE`.

## Dove vale

Su tutte le piste, cittadine comprese: gli edifici della corsia box esistono
ovunque, e in città sono espressamente fra le cose che **non** si tolgono. Le
piste non cittadine non perdono niente: si aggiunge, non si sposta.

## Il costo

Due asset istanziati su poche decine di copie tutte vicine fra loro: pochi
InstancedMesh, e il numero che conta è quello. Misura prima/dopo con
`node backend/tools/f1-costo-scenografia.js` su `prova`, `citta-prova` e
`shanghai` (la più affollata). Il gioco è GPU-bound sui pixel, non sulle draw
call: se il conto sale in modo visibile, la leva è ridurre i materiali degli
asset, non spargere meno moduli.

Le ombre restano accese: sono decine di istanze, non le 5273 delle facciate.

## Invarianti e test

Girano da sole su ogni pista della cartella, comprese quelle che l'utente
creerà: compenetrazione oltre 1 unità, validatore della scenografia, «in città
niente di bordo pista finisce dentro una facciata», ingombro dichiarato ==
`.glb`.

Se ne aggiungono tre:

1. **Ogni edificio della corsia box ha il suo coronamento, e nessun coronamento
   è orfano** — la fila non deve avere buchi, ed è la stessa misura con cui si è
   chiuso il fronte dei box.
2. **La quota di posa coincide con l'altezza dell'edificio letta dall'ingombro
   dichiarato**, con tolleranza zero: né sospeso né affondato.
3. **Chi ha ancore di terrazza ha spettatori sopra** — la regola nuova, misurata
   sul layout e non sulla lista scritta a mano.

## Cosa NON si fa

- Niente lusso sul lato delle tribune: è stato scartato esplicitamente.
- Niente marchi reali sulle insegne (decisione del 26-08, vale anche qui).
- Non si tocca il paddock esterno: quello è logistica, e in città non nasce più.
- Non si sposta né si ridisegna la fila dei box: ci si appoggia sopra.
