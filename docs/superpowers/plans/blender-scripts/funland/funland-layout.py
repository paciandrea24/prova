# funland-layout.py — genera frontend/assets/models/funland/funland-layout.json
# Task 4: base + perimetro (recinzione, cancello est, raccordo ovest).
# I task 5-10 aggiungono qui le istanze delle attrazioni.
#
# Moduli recinzione FISSI a s=1.0 (loadZone applica `s` uniforme su tutti gli
# assi: un modulo accorciato si abbasserebbe anche in altezza). n = round(L/4)
# → gap max ~6 cm (invisibile, non attraversabile), overlap max ~0.4 m.
import sys, os, json, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import funland_lib as fl

edifici = [{"modello": "funland_base", "x": 63.0, "z": -35.0, "rotY": 0.0, "y": -0.02, "s": 1.0}]

def fila(x0, z0, x1, z1, modulo=4.0, nome="recinzione"):
    # moduli lungo il segmento, centrati; rotY allinea il lato-X del modello:
    # loadZone manda il locale (x,0) in (x·cos rot, −x·sin rot) → rot = atan2(−dz, dx)
    L = math.hypot(x1 - x0, z1 - z0)
    n = max(1, round(L / modulo))
    rot = math.degrees(math.atan2(-(z1 - z0), x1 - x0))
    for i in range(n):
        f = (i + 0.5) / n
        edifici.append({"modello": nome, "x": round(x0 + (x1 - x0) * f, 2),
                        "z": round(z0 + (z1 - z0) * f, 2), "rotY": round(rot, 1),
                        "y": 0.0, "s": 1.0})

# ── PERIMETRO ──
# SUD (l'arco al centro occupa x 51..60). Render combinato reale (debug_ovest):
# il retro di edificio_06 taglia z=-18 a x≈44.8, NON a 48.5 come stimato dal
# piano → la fila parte da 44.5 (penetra il retro) o resta un buco di ~3 m.
fila(44.5, -18.0, 51.0, -18.0)
fila(60.0, -18.0, 88.0, -18.0)
# EST con cancello a z=-36 (bocca 3.5 → moduli fino a -34.25 e da -37.75)
fila(88.0, -18.0, 88.0, -34.25)
edifici.append({"modello": "cancello", "x": 88.0, "z": -36.0, "rotY": 90.0, "y": 0.0, "s": 1.0})
fila(88.0, -37.75, 88.0, -52.0)
# NORD
fila(88.0, -52.0, 37.0, -52.0)
# DIAGONALE NO: dal capo nord fin SUL muro del raccordo (il capolinea del piano
# (31.8,-34.6) restava ~1.5 m davanti all'ala → tasca; ora muore sul punto a
# t=2.8 lungo l'ala nord, 1 m oltre il bordo del varco 3.5: sigillato senza invaderlo)
fila(37.0, -52.0, 30.5, -33.76)
# RACCORDO OVEST sul varco NE Jazz: varco locale lungo X → rotY = tangente del
# perimetro jazz in (32.5,-31.8) (radiale a ~45.6° → tangente a ~135.6°)
rot_var = math.degrees(math.atan2(32.5, 31.8)) + 90.0
edifici.append({"modello": "raccordo_ovest", "x": 32.5, "z": -31.8, "rotY": round(rot_var, 1), "y": 0.0, "s": 1.0})

# ── ATTRAZIONI ──
# Arco d'ingresso: la FACCIA del modello sta sul lato sud locale (vedi arco.py)
# → rotY 0 la punta verso la piazza (il piano diceva 180 con faccia a -z).
edifici.append({"modello": "arco_ingresso", "x": 55.5, "z": -17.5, "rotY": 0.0, "y": 0.0, "s": 1.0})
# Giostra centrale (rotY 15: rompe l'allineamento assiale col viale)
edifici.append({"modello": "giostra", "x": 56.0, "z": -34.0, "rotY": 15.0, "y": 0.0, "s": 1.0})
# Autoscontro (aperture a OVEST e SUD) + 6 macchinine (l'ultima "in panne" sul viale SE)
edifici.append({"modello": "autoscontro", "x": 72.0, "z": -32.0, "rotY": 0.0, "y": 0.0, "s": 1.0})
for (mx, mz, mr) in ((67.0, -30.0, 20), (74.5, -29.0, 160), (70.0, -34.5, 75),
                     (76.5, -35.0, 290), (71.5, -31.5, 120), (63.0, -24.0, 205)):
    edifici.append({"modello": "macchinina", "x": mx, "z": mz, "rotY": mr, "y": 0.0, "s": 1.0})
# Ruota panoramica (piano ruota E-O: vista frontale arrivando da sud)
edifici.append({"modello": "ruota", "x": 78.0, "z": -46.0, "rotY": 0.0, "y": 0.0, "s": 1.0})
# Area ristoro (churros con sportello verso il viale) + tiro a segno (bancone verso EST/giostra)
edifici.append({"modello": "chiosco_churros", "x": 48.5, "z": -24.0, "rotY": 250.0, "y": 0.0, "s": 1.0})
for (tx, tz, tr) in ((46.5, -27.0, 15), (50.5, -27.5, 80), (47.0, -21.0, 200)):
    edifici.append({"modello": "tavolino", "x": tx, "z": tz, "rotY": tr, "y": 0.0, "s": 1.0})
edifici.append({"modello": "tiro_a_segno", "x": 44.0, "z": -40.0, "rotY": 270.0, "y": 0.0, "s": 1.0})
# Coaster-fondale oltre il recinto nord (z=-55, fuori mappa giocabile, no COL)
for (cx, rot) in ((48.0, 2.0), (66.0, -3.0), (82.0, 4.0)):
    edifici.append({"modello": "coaster_fondale", "x": cx, "z": -55.0, "rotY": rot, "y": 0.0, "s": 1.0})
# Recinti bassi spezza-sightline (diagonale arco-ruota e corsia est verso il cancello)
for (bx, bz, br) in ((64.0, -39.5, 45), (61.0, -44.0, 10), (80.5, -23.5, 90)):
    edifici.append({"modello": "recinto_basso", "x": bx, "z": bz, "rotY": br, "y": 0.0, "s": 1.0})

layout = {"edifici": edifici, "props": [],
          "vie": [{"nome": "funland", "asse": "x", "da": 38, "a": 88, "centro": -35, "larghezza": 34}]}
os.makedirs(fl.MODELS_DIR, exist_ok=True)
with open(fl.MODELS_DIR + "/funland-layout.json", "w", encoding="utf-8") as f:
    json.dump(layout, f, indent=2, ensure_ascii=False)
print("funland-layout.json:", len(edifici), "istanze")
