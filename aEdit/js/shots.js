/* BeatKurgu - yakin / uzak plan analizi (panel tarafi)
   Beyaz fon onunde cekilmis karelerde uzak planda fon karenin buyuk kismini kaplar.
   Kare basina "beyaz oran" olculur, sonra kareler iki gruba ayrilir. */

/* RGBA piksel dizisinden beyaz fon oranini hesaplar (0..1).
   Pozlama farkina dayanikli olsun diye "beyaz" seviyesi karenin en parlak %5'inden alinir. */
function bkWhiteRatio(data, w, h) {
    var n = w * h, hist = new Array(256), i;
    for (i = 0; i < 256; i++) hist[i] = 0;
    var Y = new Uint8Array(n), C = new Uint8Array(n);
    for (i = 0; i < n; i++) {
        var r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        var y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
        Y[i] = y;
        C[i] = Math.max(r, g, b) - Math.min(r, g, b);
        hist[y]++;
    }
    // %95 parlaklik seviyesi = bu karedeki "beyaz"
    var target = n * 0.95, acc = 0, p95 = 255;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) { p95 = i; break; } }
    if (p95 < 90) return 0;               // karanlik kare: beyaz fon yok
    var lo = p95 * 0.86, white = 0;
    for (i = 0; i < n; i++) if (Y[i] >= lo && C[i] <= 38) white++;
    return white / n;
}

/* Oranlari iki gruba ayirir (1B k-means). threshold verilirse onu kullanir.
   Doner: { ok, threshold, wide:{key:1/0}, centers:[yakin, uzak] } */
function bkClassify(items, threshold) {
    var vals = items.map(function (it) { return it.ratio; }).filter(function (v) { return v >= 0; });
    var res = { ok: false, wide: {}, threshold: null, centers: null };
    if (vals.length < 2) return res;
    var t;
    if (threshold !== null && threshold !== undefined && !isNaN(threshold)) {
        t = threshold;
        res.ok = true;
    } else {
        var c0 = Math.min.apply(null, vals), c1 = Math.max.apply(null, vals);
        for (var it = 0; it < 30; it++) {
            var s0 = 0, n0 = 0, s1 = 0, n1 = 0, mid = (c0 + c1) / 2;
            vals.forEach(function (v) { if (v < mid) { s0 += v; n0++; } else { s1 += v; n1++; } });
            var nc0 = n0 ? s0 / n0 : c0, nc1 = n1 ? s1 / n1 : c1;
            if (Math.abs(nc0 - c0) < 1e-6 && Math.abs(nc1 - c1) < 1e-6) break;
            c0 = nc0; c1 = nc1;
        }
        res.centers = [c0, c1];
        t = (c0 + c1) / 2;
        res.ok = (c1 - c0) >= 0.12;      // gruplar birbirinden yeterince farkli mi
    }
    res.threshold = t;
    items.forEach(function (it) { if (it.ratio >= 0) res.wide[it.key] = it.ratio >= t ? 1 : 0; });
    return res;
}

if (typeof module !== "undefined" && module.exports) module.exports = { bkWhiteRatio: bkWhiteRatio, bkClassify: bkClassify };
