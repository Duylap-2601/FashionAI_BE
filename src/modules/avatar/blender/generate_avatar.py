"""
FashionAI - Generate a 3D mannequin (GLB) from body measurements using MPFB2.

Usage:
    blender --background --python generate_avatar.py -- <input.json> <output.glb>

input.json:
{
  "gender": "male" | "female",
  "height": 172.0,    // cm
  "weight": 68.0,     // kg
  "chest": 94.0,      // cm (bust/chest circumference)
  "waist": 80.0,      // cm
  "hip": 94.0,        // cm
  "shoulder": 44.0,   // cm (biacromial width)
  "draco": true,      // enable Draco mesh compression
  "morph": true       // keep morph targets (shape keys) in the GLB
  // "force_morph_targets": true  // preset mode: base=macro-only, all measure-*
  //                              // shape keys loaded at weight 0 (cho FE morph)
}

Prints a single JSON line prefixed with AVATAR_RESULT= on success.
"""

import bpy
import addon_utils
import importlib
import json
import os
import sys
import time
from collections import defaultdict

try:
    from mathutils import Vector
    import bmesh
except ImportError:
    Vector = None
    bmesh = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def dynamic_import(pkg: str, key: str):
    for module_name in sys.modules:
        if module_name.endswith(pkg):
            mod = importlib.import_module(module_name)
            if hasattr(mod, key):
                return getattr(mod, key)
    raise ImportError(f"MPFB package {pkg} not found")


def load_calibration():
    path = os.path.join(SCRIPT_DIR, "calibration.json")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# ── Height macro solve ────────────────────────────────────────────────────────
def solve_height_macro(calib, gender: str, height_cm: float) -> float:
    """Invert the non-linear height curve (cm -> macro) via piecewise-linear search."""
    curve = calib["height_curve_cm"][gender]
    macros = [p[0] for p in curve]
    heights = [p[1] for p in curve]

    if height_cm <= heights[0]:
        return 0.0
    if height_cm >= heights[-1]:
        return 1.0

    for i in range(len(curve) - 1):
        h_lo, h_hi = heights[i], heights[i + 1]
        if h_lo <= height_cm <= h_hi:
            t = (height_cm - h_lo) / (h_hi - h_lo)
            return macros[i] + t * (macros[i + 1] - macros[i])
    return 0.5


def solve_weight_macro(gender: str, height_cm: float, weight_kg: float) -> float:
    """Map kg to the abstract weight macro using a BMI 18.5-30 plausible band."""
    h_m = height_cm / 100.0
    w_min = 18.5 * h_m * h_m
    w_max = 30.0 * h_m * h_m
    if w_max <= w_min:
        return 0.5
    return max(0.0, min(1.0, (weight_kg - w_min) / (w_max - w_min)))


# ── Body measurement (cross-section) ─────────────────────────────────────────
def torso_loop_perimeter(obj, depsgraph, z: float) -> float:
    """Perimeter of the torso cross-section at height z, ignoring arm/leg loops."""
    bm = bmesh.new()
    bm.from_object(obj, depsgraph)
    bm.transform(obj.matrix_world)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(
        bm, geom=geom,
        plane_co=Vector((0.0, 0.0, z)),
        plane_no=Vector((0.0, 0.0, 1.0)),
        clear_inner=True, clear_outer=True, dist=0.0001,
    )
    cut = [e for e in bm.edges if all(abs(v.co.z - z) < 0.02 for v in e.verts)]

    adj = defaultdict(list)
    coords = {}
    for e in cut:
        a, b = e.verts[0], e.verts[1]
        coords[a.index] = a.co
        coords[b.index] = b.co
        adj[a.index].append(b.index)
        adj[b.index].append(a.index)

    seen = set()
    loops = []
    for start in adj:
        if start in seen:
            continue
        stack, comp = [start], set()
        while stack:
            v = stack.pop()
            if v in seen:
                continue
            seen.add(v)
            comp.add(v)
            stack.extend(adj[v])
        loops.append(comp)

    best, best_dist = None, float("inf")
    for comp in loops:
        cx = sum(coords[v][0] for v in comp) / len(comp)
        cy = sum(coords[v][1] for v in comp) / len(comp)
        d = abs(cx) + abs(cy)
        if d < best_dist:
            best_dist = d
            best = comp

    total = 0.0
    if best is not None:
        total = sum(
            e.calc_length()
            for e in cut
            if e.verts[0].index in best and e.verts[1].index in best
        )
    bm.free()
    return total


def width_at_band(obj, depsgraph, z_lo: float, z_hi: float) -> float:
    bm = bmesh.new()
    bm.from_object(obj, depsgraph)
    bm.transform(obj.matrix_world)
    xs = [v.co.x for v in bm.verts if z_lo <= v.co.z <= z_hi]
    bm.free()
    return (max(xs) - min(xs)) if xs else 0.0


def measure(obj, depsgraph):
    """Measure the current body in cm: height + bust/waist/hip/shoulder."""
    z = obj.dimensions.z
    return {
        "height": z * 100.0,
        "bust": max(torso_loop_perimeter(obj, depsgraph, t * z) for t in (0.70, 0.72, 0.74)) * 100.0,
        "waist": min(torso_loop_perimeter(obj, depsgraph, t * z) for t in (0.56, 0.60, 0.64, 0.68)) * 100.0,
        "hip": max(torso_loop_perimeter(obj, depsgraph, t * z) for t in (0.48, 0.52)) * 100.0,
        "shoulder": width_at_band(obj, depsgraph, 0.80 * z, 0.88 * z) * 100.0,
    }


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    t0 = time.time()
    argv = sys.argv[sys.argv.index("--") + 1:]
    if len(argv) < 2:
        raise SystemExit("Usage: blender --background --python generate_avatar.py -- <input.json> <output.glb>")

    config_path, output_path = argv[0], argv[1]
    with open(config_path, encoding="utf-8") as fh:
        cfg = json.load(fh)

    gender = cfg.get("gender", "female")
    if gender not in ("male", "female"):
        raise ValueError(f"gender must be 'male' or 'female', got {gender!r}")

    calib = load_calibration()

    addon_utils.enable("mpfb", default_set=True, persistent=True)
    HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
    TargetService = dynamic_import("mpfb.services.targetservice", "TargetService")
    HOP = dynamic_import("mpfb.entities.objectproperties", "HumanObjectProperties")

    t_enable = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    human = HumanService.create_human()
    t_create = time.time()

    height_cm = float(cfg["height"])
    weight_kg = float(cfg["weight"])
    HOP.set_value("gender", 0.0 if gender == "female" else 1.0, entity_reference=human)
    HOP.set_value("height", solve_height_macro(calib, gender, height_cm), entity_reference=human)
    HOP.set_value("weight", solve_weight_macro(gender, height_cm, weight_kg), entity_reference=human)
    TargetService.reapply_macro_details(human)
    t_macro = time.time()

    deps = bpy.context.evaluated_depsgraph_get()
    human.data.update()

    # Map input chest -> bust key used in calibration.
    target_map = {
        "chest": ("bust", "measure-bust-circ-incr", "measure-bust-circ-decr"),
        "waist": ("waist", "measure-waist-circ-incr", "measure-waist-circ-decr"),
        "hip": ("hip", "measure-hips-circ-incr", "measure-hips-circ-decr"),
        "shoulder": ("shoulder", "measure-shoulder-dist-incr", "measure-shoulder-dist-decr"),
    }

    force_morph = bool(cfg.get("force_morph_targets", False))
    morph_base = float(cfg.get("morph_base_value", 0.05))
    if force_morph:
        # Preset mode: base = hình macro-only (≈ reference_cm), mọi shape key
        # measure-* (cả incr lẫn decr) được load ở 1 giá trị nhỏ để tồn tại trong
        # GLB → FE tự áp morph theo số đo người dùng (weight gần 0 = base nguyên).
        values = {field: 0.0 for field in target_map}
        stack = [
            {"target": name, "value": morph_base}
            for _field, (_key, incr, decr) in target_map.items()
            for name in (incr, decr)
        ]
        TargetService.bulk_load_targets(human, stack)
        t_target = time.time()
        t_refine = t_target
    else:
        # Pass 1: measure, compute target values, load shape keys.
        measured = measure(human, deps)
        values = {}
        stack = []
        ref_height = calib["reference_cm"][gender]["height"]
        scale = measured["height"] / ref_height
        for field, (key, incr, decr) in target_map.items():
            desired = float(cfg.get(field, measured[key]))
            delta = calib["delta_cm_per_unit"][gender][key] * scale
            val = (desired - measured[key]) / delta if delta else 0.0
            val = max(-2.0, min(2.0, val))
            values[field] = val
            if abs(val) < 1e-3:
                continue
            stack.append({"target": incr if val > 0 else decr, "value": abs(val)})
        if stack:
            TargetService.bulk_load_targets(human, stack)
        t_target = time.time()

        # Pass 2: refinement using residual from re-measurement.
        deps = bpy.context.evaluated_depsgraph_get()
        human.data.update()
        measured2 = measure(human, deps)
        for field, (key, incr, decr) in target_map.items():
            residual = float(cfg.get(field, measured2[key])) - measured2[key]
            if abs(residual) < 0.3:
                continue
            delta = calib["delta_cm_per_unit"][gender][key] * scale
            correction = (residual / delta) if delta else 0.0
            new_val = max(-2.0, min(2.0, values[field] + correction))
            if abs(new_val - values[field]) < 1e-3:
                continue
            name = incr if new_val > 0 else decr
            TargetService.set_target_value(human, name, abs(new_val), delete_target_on_zero=False)
            values[field] = new_val
        t_refine = time.time()

    draco = bool(cfg.get("draco", True))
    morph = bool(cfg.get("morph", True))
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=False,
        export_morph=morph,
        export_draco_mesh_compression_enable=draco,
    )
    t_export = time.time()

    final = measure(human, bpy.context.evaluated_depsgraph_get())
    result = {
        "ok": True,
        "glb_kb": round(os.path.getsize(output_path) / 1024.0, 1),
        "timing_s": {
            "mpfb_enable": round(t_enable - t0, 2),
            "create_human": round(t_create - t_enable, 2),
            "macros": round(t_macro - t_create, 2),
            "targets": round(t_target - t_macro, 2),
            "refine": round(t_refine - t_target, 2),
            "export": round(t_export - t_refine, 2),
            "total": round(t_export - t0, 2),
        },
        "input": cfg,
        "measured_cm": {k: round(v, 1) for k, v in final.items()},
        "target_values": {k: round(v, 3) for k, v in values.items()},
    }
    print("AVATAR_RESULT=" + json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print("AVATAR_ERROR=" + json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        sys.exit(1)
