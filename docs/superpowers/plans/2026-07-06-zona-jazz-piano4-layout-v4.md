# Piano 4 — Zona Jazz layout v4 "due anelli"

> ⚠️ AGGIORNAMENTO stesso giorno: il v4 è stato rivisto in **v5 "circolare a raggiera"**
> dopo le annotazioni dell'utente — spec:
> `docs/superpowers/specs/2026-07-06-zona-jazz-layout-v5-circolare-design.md`.
> I task e i criteri qui sotto restano validi, applicati alla geometria v5.

Spec: `docs/superpowers/specs/2026-07-06-zona-jazz-layout-v4-design.md`.
Nessun modello nuovo: si riscrive solo `blender-scripts/zona-jazz-layout.py`
(pavimentazione + zona-layout.json + composizione + render). Niente commit (committa l'utente).

## Task
1. **Riscrivere `zona-jazz-layout.py`**: dizionario footprint, helper `fila()` che allinea
   i FRONTI di ogni schiera sulla linea di facciata (centro calcolato dalla profondità),
   liste esplicite per piazza/isolotti/perimetro/angolari (regola: tutti i fronti verso il
   centro), pavimentazione v4 (sagrato 34×34, marciapiedi perimetro+isolotti, tombini),
   props nelle corsie, export `pavimentazione.glb` + `zona-layout.json`.
2. **Verifica orientamento**: render `zona_top_debug.png` con freccia-fronte sopra ogni
   edificio; correggere finché OGNI freccia punta sulla strada giusta (niente rotazioni a caso).
   Le frecce si eliminano prima dei render finali.
3. **Render finali + gate utente**: `zona_top/sw/s/ne.png` (camera con clip_end alto,
   ortho_scale ≥ 115 per la mappa ~108 m), poi verifica dell'utente in Blender.

## Criteri di accettazione
- Due corsie anulari chiuse e percorribili, larghe 10 m, separate dai 4 isolotti.
- 4 varchi diagonali aperti tra le corsie.
- Ogni freccia-fronte nel render debug punta verso il centro/strada corretta.
- Nessuna fessura nelle schiere (compenetrazioni ammesse solo agli angoli del perimetro).
- Club in diagonale (−30°) al centro del sagrato con ≥2.5 m di passaggio attorno.
