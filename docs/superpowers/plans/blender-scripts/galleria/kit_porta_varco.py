# kit_porta_varco.py — costruisce SOLO portale_varco.glb (cornice Deco verde come il
# portale sigillato, ma con un VARCO passabile ~3.5 m senza anta e PARETE PIENA sopra il
# varco con COL → non si scavalca). NON rilancia kit_muri: non tocca gli altri asset.
# Output nella cartella -wip.
import sys, math
GALLERIA = "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-galleria-art-deco/docs/superpowers/plans/blender-scripts/galleria"
sys.path.insert(0, GALLERIA)
import bpy
import galleria_lib as gl
gl.MODELS_DIR = "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-galleria-art-deco/frontend/assets/models/galleria-wip"


def build_portale_varco(mats):
    W, H = 11.0, 9.5
    y_c = 0.4
    DOOR_HALF = 1.75    # varco 3.5 m = larghezza flank
    DOOR_H = 3.0        # altezza varco
    # ── cornice perimetrale a gradoni (identica al portale sigillato) ──
    for gi, off in enumerate((0.0, 0.35, 0.7)):
        wgi = 0.55 - gi * 0.12
        mat = mats['nero'] if gi == 0 else mats['oro']
        for s in (-1, 1):
            gl.add_box(f"spalla_{gi}_{s}", wgi, 0.8 + gi * 0.06, H - off, s * (W / 2 - off - wgi / 2), y_c - gi * 0.03, 0.0, mat, bevel=0.015)
        gl.add_box(f"traversa_{gi}", W - 2 * off, 0.8 + gi * 0.06, wgi, 0, y_c - gi * 0.03, H - off - wgi, mat, bevel=0.015)
    gl.add_text_mesh("scritta", "GALLERIA", 0.42, 0, y_c - 0.48, 8.52, mats['oro'], extrude=0.06)
    gl.cornice_gradoni("corona", 4.0, 0.9, 0, y_c, H, mats, gradoni=3, gh=0.16, verso=-1)
    # ── TAMPONAMENTO verde ai lati del varco (ante Deco fisse) con fasce dorate ──
    fill_w = (W / 2 - 0.55) - DOOR_HALF          # da DOOR_HALF al filo interno delle spalle
    for s in (-1, 1):
        cx = s * (DOOR_HALF + fill_w / 2)
        gl.add_box(f"tampone_{s}", fill_w, 0.55, H - 1.0, cx, y_c, 0.0, mats['verde_scuro'], bevel=0.01)
        for li in range(4):
            gl.add_box(f"tampone_fascia_{s}_{li}", fill_w - 0.3, 0.10, 0.10, cx, y_c - 0.2, 0.8 + li * 1.7, mats['oro'], bevel=0.01)
    # ── ARCHITRAVE sopra il varco (parete piena verde → niente scavalco) + raggiera ──
    gl.add_box("architrave", 2 * DOOR_HALF, 0.55, H - 1.0 - DOOR_H, 0, y_c, DOOR_H, mats['verde_scuro'], bevel=0.01)
    gl.sunburst("arco_varco", 0, 0.06, DOOR_H + 0.05, DOOR_HALF, mats, n_raggi=7, apertura=160.0)
    # ── COL: stipiti pieni (da DOOR_HALF al bordo W/2) + architrave sopra il varco.
    #    Varco centrale (|z|<DOOR_HALF, y<DOOR_H) LIBERO e passabile. ──
    col_w = W / 2 - DOOR_HALF                     # 3.75 → copre fino al bordo cornice
    for s in (-1, 1):
        cxc = s * (DOOR_HALF + col_w / 2)
        gl.add_box(f"COL_tampone_{'sx' if s < 0 else 'dx'}", col_w, 0.85, H, cxc, y_c, 0.0, mats['nero'], bevel=0)
    gl.add_box("COL_architrave", 2 * DOOR_HALF, 0.85, H - DOOR_H, 0, y_c, DOOR_H, mats['nero'], bevel=0)


gl.clear_scene()
mats = gl.make_materials()
build_portale_varco(mats)
gl.export_glb("portale_varco.glb")
gl.render_previews("portale_varco", ortho_scale=14, alt_front=4.8, quarter_pos=(11, -12, 8), quarter_target_z=4.5)
print("portale_varco esportato in galleria-wip")
