# Zona Jazz — Layout v4 "due anelli" (design)

Data: 2026-07-06. Sostituisce il layout v3 (anello singolo + 4 fondali) che l'utente ha
bocciato: geometria sbagliata e edifici "ruotati a caso". Riferimento: disegno dell'utente
(`autodraw 06_07_2026.png`) — piazza centrale col club, due corsie anulari separate da
isolotti staccati (varchi di passaggio), perimetro chiuso di edifici.

**Nessuna modellazione nuova**: si riusano i GLB esistenti (18 `edificio_*` + `edificio13`
+ `club` + props), istanziandoli più volte. Si riscrivono solo `zona-jazz-layout.py`
(che rigenera anche `pavimentazione.glb`) e `zona-layout.json`.

## Geometria (coordinate di GIOCO: x est, z sud, fronte non ruotato = +Z)

Struttura concentrica, dal centro verso fuori (i "raggi" sono linee di facciata):

| Anello | Estensione | Contenuto |
|---|---|---|
| Sagrato piazza | quadrato ±15, rialzato 0.12 | club al centro ruotato −30° + 6 edifici sul bordo |
| Corsia interna | 15 → 25 (10 m) | strada anulare, props |
| Isolotti | fronti a 25, retri ~31 | 4 file dritte (N/E/S/O) da 4-5 edifici, ~±13/±15 di span |
| Corsia esterna | 31 → 41 (10 m) | strada anulare, props |
| Perimetro | fronti a 41 | 4 file contigue (~±36) + 4 angolari `02` a 45° (~±40,±40) |

Base pavimentazione ~104×104. Gli anelli sono quadrati con angolari a 45° nel perimetro:
in prima persona l'effetto è il percorso circolare del disegno. Mappa chiusa (nessuna uscita).

## Regola d'orientamento (FISSA — richiesta esplicita dell'utente)

**Ogni edificio guarda il CENTRO della mappa.** Nessuna eccezione, nessuna rotazione casuale:
- lato nord (z<0) → rotY 0 · lato sud → 180 · lato ovest (x<0) → 90 · lato est → −90
- angoli: NO 45 · NE −45 · SE −135 · SO 135 (dir fronte = (sin rotY, cos rotY))
- club: rotY −30 (diagonale come nel disegno, fronte verso sud-ovest)

Conseguenze: il perimetro affaccia sulla corsia esterna, gli isolotti sulla corsia interna
(dalla corsia esterna se ne vedono i retri — scelta utente "fila singola"), gli edifici
della piazza guardano il club. I fronti di ogni fila sono ALLINEATI sulla linea di facciata
(la profondità varia per modello ⇒ varia il centro, non il fronte).

## Varchi

I 4 isolotti non girano gli angoli: le 4 zone diagonali (NE/NO/SE/SO) tra un isolotto e
l'altro sono aperte e collegano le due corsie.

## Composizione (footprint larghezza×profondità dai sorgenti)

01 6×5.5 · 02/02a 7×6 · 03/03a 3.2×4.5 · 04/04a 6.5×5.5 · 05/05a 5.5×5 · 06 6×5 ·
07/07a 5.5×5 · 08/08a 6×5.5 · 09/09a 8×6 · 10/10a 6.5×6 · 13 6×5.5 · club 13×9.

- **Piazza** (6): cardinali a r=12 (05 N, 07 S, 06 E, 10 O) + diagonali a (±9.5,∓9.5)
  (03 NE, 03a SO). Tutti sul sagrato (y=0.12), fronte verso il club.
- **Isolotti** (fronte a 25): N `09 01 04 07a` · E `04a 08 03 10 05` · S `10a 06 09a 05a`
  · O `08a 04 13 07` (il civico 13 debutta qui). File contigue, senza fessure.
- **Perimetro**: file contigue per lato (~11-12 edifici, mix di varianti senza gemelli
  adiacenti) + angolare 02/02a ruotato a 45° in ogni angolo. Piccole compenetrazioni agli
  angoli sono ammesse (il retro dà sul vuoto), le fessure NO.
- **Props (nelle corsie)**: lampioni sui bordi di entrambe le corsie e ai varchi; festoni
  10 m di traverso sulle corsie ai 4 punti cardinali (interna r=20, esterna r=36, y=4.2);
  insegna DANCE su un fronte isolotto; 2-3 tombini fuori carreggiata.
- **Pavimentazione**: base unica, sagrato rialzato con cordolo + sanpietrini (come v3 ma
  30×30), marciapiedi (1.4 m) davanti a perimetro e fronti isolotti, anelli sanpietrini
  sui tombini.

## Verifica orientamento (nuovo, anti "edifici ruotati a caso")

Lo script genera un render `zona_top_debug.png` con una FRECCIA sopra ogni edificio che
ne indica il fronte: si controlla che ogni freccia punti sulla strada giusta PRIMA dei
render finali (`zona_top/sw/s/ne`). Gli oggetti-freccia vengono cancellati prima
dell'export e dei render finali. Gate finale dell'utente in Blender.

## zona-layout.json

Stesso schema di v3 (`edifici[{modello,x,z,rotY}]`, `props[{…,y}]`, `vie[]`), con in più
`y` opzionale sugli edifici (0.12 per quelli sul sagrato). Vie: 4 segmenti corsia interna,
4 corsia esterna, 4 varchi diagonali (rettangoli approssimati).
