# Zona Jazz — Layout v5 "circolare a raggiera" (design)

Data: 2026-07-06. Evoluzione del v4 dopo le annotazioni dell'utente sul render
`zona_top.png` (tracciato verde = perimetro morbido, croci = angoli da eliminare,
linee blu = lotti/isolotti curvi concentrici, riquadri+frecce rosse = ingombro e
orientamento dei palazzi, "J" = jazz club diagonale al centro).

Principi (dalle annotazioni):
1. **Niente più quadrato**: perimetro tondeggiante (cerchio, non serve perfetto) che
   maschera la base; gli spazi angolari morti spariscono. Base = DISCO (r=52).
2. **Isolotti = lotti curvi**: anelli concentrici di fondamenta (lastre sotto ogni
   edificio che si fondono in bande ad arco) che assecondano la curva.
3. **Raggiera**: gli edifici ruotano seguendo la curvatura e puntano il fronte VERSO
   L'ESTERNO (rotazione radiale + jitter ±6° per l'effetto organico "variabile").
   Il perimetro invece guarda verso l'interno (è il muro che chiude la mappa).
4. **Club = punto focale**: unico edificio in diagonale (−30°), al centro sul sagrato
   TONDO rialzato; tutto il resto segue il flusso circolare.

## Struttura (coordinate polari: φ orario da nord; x = r·sinφ, z = −r·cosφ)

| Anello | r centro | Contenuto | rotY |
|---|---|---|---|
| Sagrato tondo | disco r=11.5 (h 0.16, cordolo r 11.8) | club (0,0,−30) y=0.16 | −30 fisso |
| Anello A | 17 | 6 edifici equidistanti su 360° | 180−φ (fuori) + jitter |
| Corsia 1 | ~20 → 27.7 | strada anulare, festoni ai 4 diagonali | — |
| Anello B (isolotti) | 31.5 | 4 archi da 5 edifici centrati sui diagonali | 180−φ (fuori) + jitter |
| Varchi | — | 4 aperture ai punti CARDINALI tra gli archi | — |
| Corsia 2 | ~34.7 → 42.5 | strada anulare, festoni ai 4 diagonali | — |
| Perimetro | 45.5 | ~48 edifici a cerchio chiuso, leggere compenetrazioni | −φ (dentro), niente jitter |

Formule: fronte fuori → rotY = 180−φ; fronte dentro → rotY = −φ (dir fronte =
(sin rotY, cos rotY)). Gli archi adattano l'occupazione angolare esattamente allo
span (scala su Δφ = (larghezza+gap)/r), il perimetro si chiude su 360° esatti con
gap negativo (sovrapposizioni ammesse: il retro dà sul vuoto).

Conseguenze visive: la piazza attorno al club vede i RETRI dell'anello A (serbatoi,
scale antincendio — coerente con la raggiera annotata); corsia 1 = fronti A + retri B;
corsia 2 = fronti B + fronti perimetro (via principale). Random con SEED FISSO (7):
il layout è riproducibile.

## Pavimentazione e props
- Disco base r=52; sagrato tondo con cordolo-anello e corona di sanpietrini.
- Fondamenta: lastra (w+1.6 × p+1.6, h 0.10) ruotata sotto OGNI edificio (y edifici
  = 0.10 nel JSON; club 0.16). Le lastre adiacenti si fondono in bande curve (i
  "lotti" blu delle annotazioni).
- Props: 8 lampioni attorno al sagrato, 8 agli imbocchi dei varchi, 4 sul perimetro
  ai cardinali; festoni 10 m RADIALI ai 4 diagonali su entrambe le corsie (rotY=90−φ);
  insegna DANCE su un fronte dell'anello B; 4 tombini fuori carreggiata.
- `edificio_02/02a` (angolari a 90°) non si usano più: non esistono più angoli.

## Revisione v5.1 — ISOLATO centrale (feedback utente, stessa data)

Isolotti e perimetro APPROVATI. Bocciato il centro "club isolato + palazzi staccati
intorno": al centro va un **ISOLATO** — un rettangolo smussato compatto di palazzi
ATTIGUI tra loro e al club, dal quale il club spicca (unico diagonale, cresta a 14 m).
- L'anello A sparisce. Al suo posto: lotto centrale a **superellisse** (rettangolo
  smussato ~27.6×23.6, n=3, h 0.16 con cordolo) con il club al centro (0,0,−30) e
  ~9 edifici bassi (2-3 piani, MAI i 4-piani 09/03) disposti contigui lungo il bordo
  del lotto, fronte verso l'esterno, retri contro il club (compenetrazioni ammesse:
  attiguità voluta).
- **Apertura d'ingresso**: varco di ~8 m nell'anello di palazzi centrato su φ=210°
  (la direzione del fronte del club a rotY −30), con 2 lampioni ai lati: la facciata
  del club resta visibile dalla corsia 1. Il civico `edificio13` chiude l'isolato di
  fianco all'ingresso.
- Corsia 1 diventa l'anello tra il lotto centrale (±13.8/±11.8) e i retri degli
  isolotti (~27.7): più larga, da piazza. Festoni solo in corsia 2 (in corsia 1 le
  campate sarebbero >10 m, i festoni fluttuerebbero).
- Sanpietrini lungo il bordo del lotto (percorso superellisse), non più corona tonda.

## Revisione v5.2 — club NELL'anello dell'isolato (feedback utente, stessa data)

Bocciato il club al CENTRO dell'isolato: il club va a UN ESTREMO, come parte
dell'anello di edifici. Il centro del rettangolo smussato può restare VUOTO purché
non si veda mai in gioco.
- TUTTI gli edifici, club compreso, costeggiano il bordo del lotto, ADIACENTI tra
  loro: anello sigillato, niente apertura (la corte interna non deve vedersi).
- Il club occupa l'angolo SUD-OVEST del rettangolo smussato (φ=225): lì la normale
  è diagonale (rotY ≈ −45), quindi resta ruotato in diagonale e col fronte/insegne
  sulla corsia 1.
- L'adiacenza si calcola sulla LINEA DELLE FACCIATE (superellisse 13.25×11.25):
  ogni edificio ha il FRONTE sulla linea e il centro arretrato di profondità/2
  lungo la normale (il club di 4.5). I fronti si toccano (+0.25 di margine
  riscalato), i retri si compenetrano nella corte NASCOSTA. Servono 11 edifici
  (2-3 piani: il club deve spiccare per mole e altezza); `edificio13` è il primo
  a fianco del club.
- FIX sovrapposizioni PERIMETRO (segnalate dall'utente): l'occupazione angolare del
  perimetro ora si calcola sulla linea delle facciate (r−3, il cerchio interno), non
  sul cerchio dei centri: prima le facciate adiacenti si compenetravano di ~0.9 m.
  Ora margine +0.1: fronti che si sfiorano, i cunei si aprono solo DIETRO il piano
  delle facciate (invisibili dall'interno, il retro dà sul vuoto).

## Verifica
Render `zona_top_debug.png` con frecce-fronte: anelli A/B a raggiera verso l'esterno,
perimetro verso l'interno, club in diagonale. Poi render puliti top/sw/s/ne e gate
utente in Blender. `zona-layout.json`: stesso schema (y sugli edifici; vie = corde
approssimate delle corsie + 4 varchi radiali ai cardinali).
