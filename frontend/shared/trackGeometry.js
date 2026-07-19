// frontend/shared/trackGeometry.js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TrackGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    function dist(a, b) {
        return Math.hypot(b.x - a.x, b.z - a.z, (b.y || 0) - (a.y || 0));
    }

    // Punto sul segmento p1->p2 di una Catmull-Rom centripeta (algoritmo
    // piramidale di Barry-Goldman), dati i 4 punti di controllo p0,p1,p2,p3
    // e il parametro locale u in [0,1].
    function evalSegment(p0, p1, p2, p3, u) {
        const alpha = 0.5; // centripeta
        const t0 = 0;
        const t1 = t0 + Math.pow(dist(p0, p1), alpha) || 1e-6;
        const t2 = t1 + Math.pow(dist(p1, p2), alpha) || t1 + 1e-6;
        const t3 = t2 + Math.pow(dist(p2, p3), alpha) || t2 + 1e-6;
        const t = t1 + u * (t2 - t1);

        function lerp(a, b, ta, tb, tt) {
            const d = tb - ta;
            if (Math.abs(d) < 1e-9) return { x: a.x, y: a.y || 0, z: a.z };
            const f = (tt - ta) / d;
            return {
                x: a.x + (b.x - a.x) * f,
                y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * f,
                z: a.z + (b.z - a.z) * f
            };
        }

        const A1 = lerp(p0, p1, t0, t1, t);
        const A2 = lerp(p1, p2, t1, t2, t);
        const A3 = lerp(p2, p3, t2, t3, t);
        const B1 = lerp(A1, A2, t0, t2, t);
        const B2 = lerp(A2, A3, t1, t3, t);
        return lerp(B1, B2, t1, t2, t);
    }

    // Valuta la curva (chiusa o aperta) al parametro globale t in [0,1].
    function evalCurve(controlPoints, closed, t) {
        const n = controlPoints.length;
        const segCount = closed ? n : n - 1;
        const segF = t * segCount;
        let i = Math.floor(segF);
        if (i >= segCount) i = segCount - 1;
        if (i < 0) i = 0;
        const u = segF - i;

        function at(idx) {
            if (closed) return controlPoints[((idx % n) + n) % n];
            if (idx < 0) return controlPoints[0];
            if (idx >= n) return controlPoints[n - 1];
            return controlPoints[idx];
        }

        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        return evalSegment(p0, p1, p2, p3, u);
    }

    // Ricampiona la curva in `samples` punti equidistanti per lunghezza
    // d'arco (non per parametro), come getSpacedPoints() di Three.js.
    function resample(controlPoints, closed, samples) {
        if (controlPoints.length < 3) {
            throw new Error('Servono almeno 3 punti di controllo');
        }
        const FINE = Math.max(samples * 4, 2000);
        const fine = [];
        for (let i = 0; i < FINE; i++) {
            fine.push(evalCurve(controlPoints, closed, i / (closed ? FINE : FINE - 1)));
        }

        const cum = [0];
        for (let i = 1; i < fine.length; i++) {
            cum.push(cum[i - 1] + dist(fine[i - 1], fine[i]));
        }
        const total = cum[cum.length - 1];

        const out = [];
        for (let s = 0; s < samples; s++) {
            const target = closed
                ? (s / samples) * total
                : (s / (samples - 1)) * total;
            let lo = 0, hi = cum.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (cum[mid] < target) lo = mid + 1; else hi = mid;
            }
            const idx = Math.max(1, lo);
            const segLen = cum[idx] - cum[idx - 1] || 1e-9;
            const f = (target - cum[idx - 1]) / segLen;
            const a = fine[idx - 1], b = fine[idx];
            out.push({
                x: a.x + (b.x - a.x) * f,
                y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * f,
                z: a.z + (b.z - a.z) * f
            });
        }
        return out;
    }

    function sampleLoop(controlPoints, samples) {
        return resample(controlPoints, true, samples);
    }

    function sampleOpenPath(controlPoints, samples) {
        return resample(controlPoints, false, samples);
    }

    function lapLength(points) {
        let len = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            len += Math.hypot(b.x - a.x, b.z - a.z);
        }
        return len;
    }

    // Ricerca globale (non finestrata): usata per il fuoripista e per
    // agganciare l'altezza y visiva della macchina al punto più vicino della
    // pista. Costo O(n) sui punti campionati, accettabile a 50 tick/s con
    // poche decine di punti-auto.
    function nearestPoint(points, x, z) {
        let bestIdx = 0, bestDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const dd = (x - p.x) ** 2 + (z - p.z) ** 2;
            if (dd < bestDist) { bestDist = dd; bestIdx = i; }
        }
        const p = points[bestIdx];
        return { x: p.x, y: p.y || 0, z: p.z, index: bestIdx, dist: Math.sqrt(bestDist) };
    }

    // Giri necessari per coprire (circa) targetKm, dati in metri = unità di
    // gioco (coerente con le scale esistenti: CAR_HALF_LENGTH ~2.4 unità
    // già pensato come metri reali).
    function lapsForDistance(lapLengthUnits, targetKm) {
        return Math.max(1, Math.round((targetKm * 1000) / lapLengthUnits));
    }

    function nearestIndexNear(points, prevIndex, x, z, window) {
        const n = points.length;
        const w = window || 20;
        let bestIdx = prevIndex || 0;
        let bestDist = Infinity;
        for (let d = -w; d <= w; d++) {
            const idx = ((prevIndex + d) % n + n) % n;
            const pt = points[idx];
            const dd = (x - pt.x) ** 2 + (z - pt.z) ** 2;
            if (dd < bestDist) { bestDist = dd; bestIdx = idx; }
        }
        return bestIdx;
    }

    // closed=true: normale/tangente "avvolgente" (usa il vicino oltre gli
    // estremi). closed=false: agli estremi usa solo il vicino disponibile.
    function tangentAt(points, i, closed) {
        const n = points.length;
        const next = closed ? points[(i + 1) % n] : points[Math.min(i + 1, n - 1)];
        const prev = closed ? points[(i - 1 + n) % n] : points[Math.max(i - 1, 0)];
        const tx = next.x - prev.x;
        const tz = next.z - prev.z;
        const len = Math.hypot(tx, tz) || 1;
        return { tx: tx / len, tz: tz / len };
    }

    function normalAt(points, i, closed) {
        const { tx, tz } = tangentAt(points, i, closed);
        return { nx: -tz, nz: tx };
    }

    return {
        sampleLoop,
        sampleOpenPath,
        lapLength,
        lapsForDistance,
        nearestIndexNear,
        nearestPoint,
        tangentAt,
        normalAt
    };
});
