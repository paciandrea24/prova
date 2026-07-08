# Galleria d'Arte Art Déco — design (quartiere 2 della mappa FPS)

Data: 2026-07-07. Riferimento visivo: arcata commerciale Art Déco con volta vetrata e
cupola. Da corridoio scenografico → **arena FPS**: croce + rotonda + mezzanino.
Archetipi: galleria all'italiana (Vitt. Emanuele) + atrio a ballatoi (Galeries
Lafayette / Cleveland Arcade).

## Decisioni bloccate con l'utente
1. **Struttura A — croce + rotonda + mezzanino**: due arcate perpendicolari che si
   incrociano in una rotonda centrale sotto la cupola (fontana + insegna pensile
   "ART DECO GALLERIA").
2. **Taglia media**: tip-to-tip ~66 m, rotonda Ø ~22 m, bracci ~22 m (ciascuno),
   mezzanino a ~4,5 m, cupola ~11 m.
3. **Negozi**: perlopiù vetrine chiuse (scenografia+copertura); POCHI entrabili; di
   questi alcuni (a caso, RNG a seme fisso stile `rng_per`) con porta sul retro che
   apre un retro-corridoio di flanking.
4. **Mezzanino**: anello completo attorno alla rotonda + gallerie su tutti e 4 i
   bracci, affaccio sul vuoto centrale, parapetti in ottone Déco.
5. **Salita**: 2 scale a pioli in ferro (nicchie di servizio) + NUOVA meccanica di
   arrampicata in fps.js (zone `climb`, riusabile per il Luna Park). Niente scaloni.
6. **Estremità bracci**: 4 grandi portali/vetrate Art Déco sigillati; l'OVEST è il
   futuro aggancio alla Zona Jazz (varco Ovest Jazz già riservato). Hub-fontana e
   stitching mondo unico: PARCHEGGIATI.
7. **Palette Déco**: crema/avorio, oro/ottone, nero, verdeacqua; motivi a
   raggiera/sunburst. Toon-shading in Three.js (Blender solo colori piatti).
8. **Trade-off come Jazz**: priorità fluidità (~40 draw call), COL_* box, gate
   utente in Blender e poi in localhost; committa solo l'utente.

## Geometria (coordinate di gioco: x est, z sud; y su. Blender: bx=x, by=−z)
- Rotonda: cerchio r=11 al centro (0,0). Cupola sopra, tamburo con costoloni.
- 4 bracci ai cardinali (N/E/S/O): corridoi larghi ~10 m, lunghi ~22 m, fiancheggiati
  da vetrine; volta a botte vetrata sopra (scenografia, no COL).
- Mezzanino a y=4.5: anello attorno alla rotonda (affaccio sul vuoto, il centro
  della rotonda resta a doppia altezza) + gallerie laterali lungo i bracci.
- Soffitto di gioco: `ceilingY` nel json (sotto la cupola), usato dal clamp verticale.
- Confini: muri/vetrine/portali con COL (niente clamp radiale).

## Verifica
Render Blender headless (top debug con frecce, top pulito, 3/4, close-up rotonda/
mezzanino/scala) confrontati col riferimento; gate utente sul GLB; poi playtest
localhost `?map=galleria` (fluidità, collisioni, scala su/giù, spawn).
