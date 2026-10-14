/*  aEdit by talha0ff - Pose detector
    Finds usable "pose" segments in a long take shot on a white backdrop.
    Keep rule (in order of importance):
      1. subject is centred / symmetric in frame
      2. no focus / motion-blur problem
      3. camera move (any direction) is smooth, no shake
    Input: small RGB frames (default 144x256) at a fixed fps (default 15).
    Pure JS, no dependencies: runs inside the CEP panel and in Node for testing. */
(function (root) {
    "use strict";

    var DEFAULTS = {
        sym: 0.7,        // min symmetry / centring score (0..1)
        blur: 0.45,      // min sharpness relative to the surrounding 3 s
        jit: 0.3,        // max shake relative to camera speed
        acc: 0.3,        // max jerkiness relative to camera speed
        whip: 14,        // max camera speed averaged over 1 s (px/frame at 144 px width)
        maxSpeed: 6,     // max camera speed in ANY single moment (px/frame, ~0.6 frame widths per second)
        pad: 0.1,        // grow each segment this many seconds at both ends (a couple of frames)
        tighten: 1,      // trim take edges where the camera starts moving / subject leaves centre
        minLen: 1.0,     // shortest usable region (s)
        takeMin: 1.0,    // shortest take handed to the edit (source seconds)
        takeMax: 5.0     // MAXIMUM take length; longer regions are split into several takes
    };

    /* ---------- small helpers ---------- */
    function boxFilter(a, w) {                    // centred moving average, edge-normalised
        var n = a.length, out = new Float64Array(n), h = Math.floor(w / 2), s = 0, c = 0, i;
        for (i = 0; i < Math.min(n, h); i++) { s += a[i]; c++; }
        for (i = 0; i < n; i++) {
            var add = i + h, rem = i - h - 1;
            if (add < n) { s += a[add]; c++; }
            if (rem >= 0) { s -= a[rem]; c--; }
            out[i] = s / c;
        }
        return out;
    }
    function maxFilter(a, w) {
        var n = a.length, out = new Float64Array(n), h = Math.floor(w / 2);
        for (var i = 0; i < n; i++) {
            var m = -Infinity;
            for (var j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) if (a[j] > m) m = a[j];
            out[i] = m;
        }
        return out;
    }
    function medianFilter(a, w) {
        var n = a.length, out = new Float64Array(n), h = Math.floor(w / 2), buf = [];
        for (var i = 0; i < n; i++) {
            buf.length = 0;
            for (var j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) buf.push(a[j]);
            buf.sort(function (x, y) { return x - y; });
            out[i] = buf[buf.length >> 1];
        }
        return out;
    }
    function histPercentile(arr, p) {             // values 0..255
        var h = new Uint32Array(256), n = arr.length, i;
        for (i = 0; i < n; i++) { var v = arr[i] | 0; h[v < 0 ? 0 : v > 255 ? 255 : v]++; }
        var t = n * p / 100, c = 0;
        for (i = 0; i < 256; i++) { c += h[i]; if (c >= t) return i; }
        return 255;
    }
    function percentileOf(arr, p) {
        var s = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
        return s[Math.min(s.length - 1, Math.max(0, Math.floor(p / 100 * (s.length - 1))))];
    }

    /* ---------- per-frame image measures ---------- */
    function toGray(rgb, W, H) {
        var n = W * H, g = new Float32Array(n);
        for (var i = 0, j = 0; i < n; i++, j += 3) g[i] = 0.299 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2];
        return g;
    }
    function laplacianVar(g, W, H) {
        var s = 0, s2 = 0, c = 0;
        for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
            var i = y * W + x;
            var v = g[i - 1] + g[i + 1] + g[i - W] + g[i + W] - 4 * g[i];
            s += v; s2 += v * v; c++;
        }
        var m = s / c; return s2 / c - m * m;
    }
    /* Subject mask: background = bright, low-chroma, flat pixels connected to the frame border */
    function subjectMask(rgb, g, W, H) {
        var n = W * H, i, x, y;
        var p97 = histPercentile(g, 97);
        // 5x5 local mean / std via integral images
        var I = new Float64Array((W + 1) * (H + 1)), I2 = new Float64Array((W + 1) * (H + 1));
        for (y = 0; y < H; y++) {
            var rs = 0, rs2 = 0;
            for (x = 0; x < W; x++) {
                var v = g[y * W + x]; rs += v; rs2 += v * v;
                I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + rs;
                I2[(y + 1) * (W + 1) + x + 1] = I2[y * (W + 1) + x + 1] + rs2;
            }
        }
        var bg = new Uint8Array(n);
        for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
            i = y * W + x;
            var x0 = Math.max(0, x - 2), x1 = Math.min(W, x + 3), y0 = Math.max(0, y - 2), y1 = Math.min(H, y + 3);
            var cnt = (x1 - x0) * (y1 - y0);
            var S = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
            var S2 = I2[y1 * (W + 1) + x1] - I2[y0 * (W + 1) + x1] - I2[y1 * (W + 1) + x0] + I2[y0 * (W + 1) + x0];
            var mu = S / cnt, sd = Math.sqrt(Math.max(S2 / cnt - mu * mu, 0));
            var r = rgb[i * 3], gg = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
            var chroma = Math.max(r, gg, b) - Math.min(r, gg, b);
            bg[i] = (g[i] >= p97 * 0.80 && chroma <= 30 && sd < 4.0) ? 1 : 0;
        }
        // flood fill background from the border
        var conn = new Uint8Array(n), stack = [];
        function seed(k) { if (bg[k] && !conn[k]) { conn[k] = 1; stack.push(k); } }
        for (x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
        for (y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
        while (stack.length) {
            var k = stack.pop(), kx = k % W, ky = (k - kx) / W;
            if (kx > 0) seed(k - 1); if (kx < W - 1) seed(k + 1);
            if (ky > 0) seed(k - W); if (ky < H - 1) seed(k + W);
        }
        var fg = new Uint8Array(n);
        for (i = 0; i < n; i++) fg[i] = conn[i] ? 0 : 1;
        // 3x3 opening (erode then dilate) to drop speckles
        var er = new Uint8Array(n), op = new Uint8Array(n);
        for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
            var all = 1;
            for (var dy = -1; dy <= 1 && all; dy++) for (var dx = -1; dx <= 1; dx++) {
                var yy = y + dy, xx = x + dx;
                if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
                if (!fg[yy * W + xx]) { all = 0; break; }
            }
            er[y * W + x] = all;
        }
        for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
            var any = 0;
            for (var dy2 = -1; dy2 <= 1 && !any; dy2++) for (var dx2 = -1; dx2 <= 1; dx2++) {
                var y2 = y + dy2, x2 = x + dx2;
                if (y2 < 0 || y2 >= H || x2 < 0 || x2 >= W) continue;
                if (er[y2 * W + x2]) { any = 1; break; }
            }
            op[y * W + x] = any;
        }
        return op;
    }
    /* symmetry: mirror IoU for big subjects, centring for small ones (floor strip ignored) */
    function symmetryOf(fg, W, H) {
        var cut = Math.floor(H * 0.92), x, y, area = 0;
        for (y = 0; y < cut; y++) for (x = 0; x < W; x++) area += fg[y * W + x];
        area /= W * H;
        if (area < 0.01) return { area: area, sym: 0 };
        var inter = 0, uni = 0;
        for (y = 0; y < cut; y++) for (x = 0; x < W; x++) {
            var a = fg[y * W + x], b = fg[y * W + (W - 1 - x)];
            if (a && b) inter++; if (a || b) uni++;
        }
        var mir = uni ? inter / uni : 0;
        var upTo = Math.floor(H * 0.8), xs = [], minX = W, maxX = -1;
        for (y = 0; y < upTo; y++) for (x = 0; x < W; x++) if (fg[y * W + x]) { xs.push(x); if (x < minX) minX = x; if (x > maxX) maxX = x; }
        if (xs.length < 20) {
            xs = []; minX = W; maxX = -1;
            for (y = 0; y < cut; y++) for (x = 0; x < W; x++) if (fg[y * W + x]) { xs.push(x); if (x < minX) minX = x; if (x > maxX) maxX = x; }
        }
        xs.sort(function (p, q) { return p - q; });
        var cxm = xs[xs.length >> 1] / W, bx = (minX + maxX) / 2 / W;
        var tol = area < 0.35 ? 0.3 : 0.2;
        var cent = Math.max(0, 1 - Math.abs(0.5 * (cxm + bx) - 0.5) / tol);
        return { area: area, sym: Math.max(mir, cent) };
    }

    /* Global camera translation between two frames: pyramidal Lucas-Kanade with robust re-weighting
       (behaves like the median of a dense flow field). Returns {dx, dy} in pixels. */
    function downsample(g, W, H) {
        var w2 = W >> 1, h2 = H >> 1, o = new Float32Array(w2 * h2);
        for (var y = 0; y < h2; y++) for (var x = 0; x < w2; x++) {
            var i = 2 * y * W + 2 * x;
            o[y * w2 + x] = 0.25 * (g[i] + g[i + 1] + g[i + W] + g[i + W + 1]);
        }
        return { g: o, W: w2, H: h2 };
    }
    function blur3(g, W, H) {
        var o = new Float32Array(W * H);
        for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
            var s = 0, c = 0;
            for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
                var yy = y + dy, xx = x + dx;
                if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
                s += g[yy * W + xx]; c++;
            }
            o[y * W + x] = s / c;
        }
        return o;
    }
    function sample(g, W, H, x, y) {
        if (x < 0) x = 0; if (y < 0) y = 0; if (x > W - 1.001) x = W - 1.001; if (y > H - 1.001) y = H - 1.001;
        var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * W + x0;
        return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + W] * (1 - fx) + g[i + W + 1] * fx) * fy;
    }
    function lkLevel(A, B, W, H, dx, dy) {
        var m = 4;
        for (var it = 0; it < 5; it++) {
            var sxx = 0, sxy = 0, syy = 0, sxt = 0, syt = 0, hist = new Uint32Array(256), cnt = 0;
            // first pass: residual median (histogram) for a robust scale
            for (var y = m; y < H - m; y++) for (var x = m; x < W - m; x++) {
                var t = Math.abs(sample(B, W, H, x + dx, y + dy) - A[y * W + x]) | 0;
                hist[t > 255 ? 255 : t]++; cnt++;
            }
            var half = cnt / 2, cum = 0, med = 0;
            for (var hb = 0; hb < 256; hb++) { cum += hist[hb]; if (cum >= half) { med = hb + 0.5; break; } }
            var sc = Math.max(2, 2.5 * med);
            for (var y2 = m; y2 < H - m; y2 += 1) for (var x2 = m; x2 < W - m; x2 += 1) {
                var i = y2 * W + x2;
                var ix = 0.5 * (A[i + 1] - A[i - 1]), iy = 0.5 * (A[i + W] - A[i - W]);
                var tt = sample(B, W, H, x2 + dx, y2 + dy) - A[i];
                var u = tt / sc, w = Math.abs(u) < 1 ? (1 - u * u) * (1 - u * u) : 0;   // Tukey weight
                sxx += w * ix * ix; sxy += w * ix * iy; syy += w * iy * iy; sxt += w * ix * tt; syt += w * iy * tt;
            }
            var det = sxx * syy - sxy * sxy;
            if (Math.abs(det) < 1e-6) break;
            var ux = -(syy * sxt - sxy * syt) / det, uy = -(sxx * syt - sxy * sxt) / det;
            dx += ux; dy += uy;
            if (Math.abs(ux) < 0.01 && Math.abs(uy) < 0.01) break;
        }
        return [dx, dy];
    }
    function globalShift(prev, cur, W, H) {
        var P = [{ g: blur3(prev, W, H), W: W, H: H }], C = [{ g: blur3(cur, W, H), W: W, H: H }];
        for (var l = 1; l < 4; l++) { P.push(downsample(P[l - 1].g, P[l - 1].W, P[l - 1].H)); C.push(downsample(C[l - 1].g, C[l - 1].W, C[l - 1].H)); }
        var dx = 0, dy = 0;
        for (var lv = 3; lv >= 1; lv--) {               // full-resolution level skipped: same result, ~4x faster
            if (lv < 3) { dx *= 2; dy *= 2; }
            var r = lkLevel(P[lv].g, C[lv].g, P[lv].W, P[lv].H, dx, dy); dx = r[0]; dy = r[1];
        }
        return { dx: dx * 2, dy: dy * 2 };
    }

    /* ---------- streaming analyser ---------- */
    function Analyzer(W, H, fps) {
        this.W = W || 144; this.H = H || 256; this.fps = fps || 15;
        this.gx = []; this.gy = []; this.sharp = []; this.area = []; this.sym = []; this.prev = null;
    }
    Analyzer.prototype.push = function (rgb) {
        var g = toGray(rgb, this.W, this.H);
        if (this.prev) { var s = globalShift(this.prev, g, this.W, this.H); this.gx.push(s.dx); this.gy.push(s.dy); }
        else { this.gx.push(0); this.gy.push(0); }
        this.prev = g;
        this.sharp.push(laplacianVar(g, this.W, this.H));
        var fg = subjectMask(rgb, g, this.W, this.H), sm = symmetryOf(fg, this.W, this.H);
        this.area.push(sm.area); this.sym.push(sm.sym);
    };
    Analyzer.prototype.features = function () {
        var n = this.gx.length, Wn = 15, i;
        var gx = medianFilter(this.gx, 3), gy = medianFilter(this.gy, 3);
        var sp = new Float64Array(n); for (i = 0; i < n; i++) sp[i] = Math.hypot(gx[i], gy[i]);
        var spd = boxFilter(sp, Wn);
        var gx5 = boxFilter(gx, 5), gy5 = boxFilter(gy, 5), ac = new Float64Array(n);
        for (i = 0; i < n; i++) ac[i] = i ? Math.hypot(gx5[i] - gx5[i - 1], gy5[i] - gy5[i - 1]) : 0;
        var acc = boxFilter(ac, Wn);
        var gx7 = boxFilter(gx, 7), gy7 = boxFilter(gy, 7), jt = new Float64Array(n);
        for (i = 0; i < n; i++) jt[i] = Math.hypot(gx[i] - gx7[i], gy[i] - gy7[i]);
        var jit = boxFilter(jt, Wn);
        var shs = boxFilter(this.sharp, 5), mx = maxFilter(shs, 45), shr = new Float64Array(n);
        for (i = 0; i < n; i++) shr[i] = shs[i] / (mx[i] + 1e-6);
        var sh = boxFilter(shr, Wn);
        var area = boxFilter(this.area, 8), sym = boxFilter(medianFilter(this.sym, 15), 8);
        var spdRaw = boxFilter(sp, 3), symRaw = boxFilter(medianFilter(this.sym, 3), 3);
        return { n: n, fps: this.fps, spd: spd, acc: acc, jit: jit, sh: sh, area: area, sym: sym, spdRaw: spdRaw, symRaw: symRaw };
    };

    function segmentsFrom(good, n, fps, minLen) {
        var out = [], i = 0;
        while (i < n) {
            if (good[i]) { var j = i; while (j < n && good[j]) j++; if ((j - i) / fps >= minLen) out.push([i / fps, j / fps]); i = j; }
            else i++;
        }
        return out;
    }
    /* returns [[start, end], ...] in seconds of the analysed clip */
    function detect(f, opts) {
        var P = {}, k; for (k in DEFAULTS) P[k] = DEFAULTS[k]; for (k in (opts || {})) P[k] = opts[k];
        var n = f.n, fps = f.fps, good = new Uint8Array(n), hard = new Uint8Array(n), i;
        for (i = 0; i < n; i++) {
            var s = f.spd[i] + 1;
            good[i] = (f.sym[i] >= P.sym && f.area[i] >= 0.03 && f.sh[i] >= P.blur &&
                       f.jit[i] / s <= P.jit && f.acc[i] / s <= P.acc && f.spd[i] <= P.whip) ? 1 : 0;
            hard[i] = (f.area[i] < 0.03 || f.sh[i] < P.blur * 0.7) ? 1 : 0;   // empty frame / clear blur
        }
        // fast camera moves: judged frame by frame (not averaged) and kept out with a small margin
        if (f.spdRaw && P.maxSpeed > 0) {
            var fast = new Uint8Array(n), mg = Math.round(0.2 * fps);
            for (i = 0; i < n; i++) if (f.spdRaw[i] > P.maxSpeed) for (var d = Math.max(0, i - mg); d <= Math.min(n - 1, i + mg); d++) fast[d] = 1;
            for (i = 0; i < n; i++) if (fast[i]) { good[i] = 0; hard[i] = 1; }
        }
        var segs = segmentsFrom(good, n, fps, P.minLen);
        if (P.pad > 0) {
            var grown = [], kk = Math.round(P.pad * fps);
            segs.forEach(function (sg) {
                var ia = Math.round(sg[0] * fps), ib = Math.round(sg[1] * fps) - 1, na = ia, nb = ib;
                while (na > 0 && ia - na < kk && !hard[na - 1]) na--;
                while (nb < n - 1 && nb - ib < kk && !hard[nb + 1]) nb++;
                grown.push([na / fps, (nb + 1) / fps]);
            });
            grown.sort(function (a, b) { return a[0] - b[0]; });
            segs = [];
            grown.forEach(function (g) {
                if (segs.length && g[0] <= segs[segs.length - 1][1]) segs[segs.length - 1][1] = Math.max(segs[segs.length - 1][1], g[1]);
                else segs.push(g);
            });
        }
        if (P.tighten && f.spdRaw) segs = tightenEdges(segs, f, P);
        if (P.takeMax > 0) segs = splitTakes(segs, f, P, good, hard);
        return segs;
    }

    /* The 1 s smoothing used for detection blurs where a move begins or ends by about half a second.
       Walk each edge inward on the lightly smoothed signals: stop where the camera is calm again
       (no faster than ~1.6x the take's typical speed) and the subject is centred. */
    function tightenEdges(segs, f, P) {
        var fps = f.fps, out = [];
        segs.forEach(function (sg) {
            var a = Math.round(sg[0] * fps), b = Math.round(sg[1] * fps) - 1;
            if (b - a < 4) return;
            var sp = []; for (var i = a; i <= b; i++) sp.push(f.spdRaw[i]);
            sp.sort(function (x, y) { return x - y; });
            var typical = sp[sp.length >> 1], lim = Math.max(1.2, typical * 1.6 + 0.4);
            var symLim = P.sym - 0.08, maxTrim = Math.round(0.8 * fps);
            function bad(i) { return f.spdRaw[i] > lim || f.symRaw[i] < symLim; }
            var na = a, nb = b;
            while (na < b && na - a < maxTrim && bad(na)) na++;
            while (nb > na && b - nb < maxTrim && bad(nb)) nb--;
            if ((nb + 1 - na) / fps >= P.minLen) out.push([na / fps, (nb + 1) / fps]);
        });
        return out;
    }

    /* per-frame quality used to place cuts inside a long region (higher = better moment) */
    function frameQuality(f, i) {
        var s = f.spd[i] + 1;
        var smooth = 1 / (1 + 4 * f.jit[i] / s + 4 * f.acc[i] / s);
        return f.sym[i] * Math.min(1, f.sh[i]) * smooth;
    }
    /* Turn usable regions into takes of takeMin..takeMax seconds.
       - long regions are split into equal takes, each cut nudged (+-0.75 s) to the weakest frame nearby
       - a region a bit longer than takeMax but too short for two takes gives its best takeMax window
       - short regions are grown into neighbouring usable frames up to takeMin, otherwise dropped */
    function splitTakes(segs, f, P, good, hard) {
        var fps = f.fps, n = f.n, out = [], tMin = Math.max(0.5, P.takeMin), tMax = Math.max(tMin, P.takeMax);
        var q = new Float64Array(n); for (var i = 0; i < n; i++) q[i] = frameQuality(f, i);
        function bestWindow(a, b, len) {        // frame indices [a,b), window length in frames
            var best = a, bestS = -1, sum = 0, j;
            for (j = a; j < a + len; j++) sum += q[j];
            for (j = a; j + len <= b; j++) {
                if (j > a) sum += q[j + len - 1] - q[j - 1];
                if (sum > bestS) { bestS = sum; best = j; }
            }
            return best;
        }
        segs.forEach(function (sg) {
            var a = Math.round(sg[0] * fps), b = Math.round(sg[1] * fps), L = (b - a) / fps;
            var minF = Math.round(tMin * fps), maxF = Math.round(tMax * fps);
            if (L < tMin) {
                // grow into neighbouring frames that are not empty / blurred
                var need = minF - (b - a), na = a, nb = b;
                while (need > 0 && (na > 0 && !hard[na - 1] || nb < n && !hard[nb])) {
                    if (nb < n && !hard[nb] && (need % 2 === 0 || na === 0 || hard[na - 1])) { nb++; need--; }
                    else if (na > 0 && !hard[na - 1]) { na--; need--; }
                }
                if (need <= 0) out.push([na / fps, nb / fps]);
                return;
            }
            if (L <= tMax) { out.push([a / fps, b / fps]); return; }
            var k = Math.ceil(L / tMax);         // fewest pieces that respect the maximum
            var cuts = [a], step = (b - a) / k, win = Math.round(0.75 * fps);
            for (var c = 1; c < k; c++) {
                var ideal = Math.round(a + c * step), lo = Math.max(cuts[c - 1] + minF, ideal - win), hi = Math.min(b - minF * (k - c), ideal + win);
                var cut = ideal, worst = Infinity;
                for (var x = lo; x <= hi; x++) if (q[x] < worst) { worst = q[x]; cut = x; }
                cuts.push(Math.min(cut, cuts[c - 1] + maxF));
            }
            cuts.push(b);
            for (var t = 0; t < cuts.length - 1; t++) {
                var s0 = cuts[t], s1 = cuts[t + 1];
                if (s1 - s0 > maxF) { var bw = bestWindow(s0, s1, maxF); s0 = bw; s1 = bw + maxF; }
                if (s1 - s0 >= minF - 1) out.push([s0 / fps, s1 / fps]);
            }
        });
        return out;
    }

    /* Decode a clip with ffmpeg and feed every frame to an Analyzer.
       cp = require("child_process"); Buf = require("buffer").Buffer.
       cb: { progress(frac), frame(rgbBuffer, index), done(analyzer, frames, stderr), error(msg) }
       Returns { cancel() }. Runs in small time slices so the panel stays responsive. */
    function analyzeFile(cp, Buf, ffmpeg, file, inSec, durSec, W, H, fps, cb) {
        var FS = W * H * 3, an = new Analyzer(W, H, fps);
        var args = ["-v", "error", "-hwaccel", "auto", "-ss", inSec.toFixed(3), "-t", durSec.toFixed(3), "-i", file,
                    "-an", "-sn", "-dn", "-vf", "fps=" + fps + ",scale=" + W + ":" + H + ":flags=fast_bilinear",
                    "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"];
        var proc, pending = [], pendLen = 0, frames = 0, total = Math.max(1, Math.round(durSec * fps));
        var ended = false, busy = false, stopped = false, finished = false, errTxt = "", timer = null;
        try { proc = cp.spawn(ffmpeg, args); } catch (e) { cb.error("could not start ffmpeg (" + e.message + ")"); return { cancel: function () {} }; }
        function takeFrame() {
            if (pendLen < FS) return null;
            var out = Buf.allocUnsafe(FS), off = 0;
            while (off < FS) {
                var b = pending[0], need = FS - off;
                if (b.length <= need) { b.copy(out, off); off += b.length; pending.shift(); }
                else { b.copy(out, off, 0, need); pending[0] = b.subarray(need); off += need; }
            }
            pendLen -= FS; return out;
        }
        function finish() {
            if (finished || stopped) return; finished = true;
            if (timer) clearInterval(timer);
            cb.done(an, frames, errTxt);
        }
        function pump() {
            if (busy || stopped) return; busy = true;
            var t0 = Date.now(), f;
            try {
                while (Date.now() - t0 < 30 && (f = takeFrame())) { an.push(f); if (cb.frame) cb.frame(f, frames); frames++; }
            } catch (e) {
                stopped = true; if (timer) clearInterval(timer); try { proc.kill(); } catch (e2) {}
                cb.error("analysis failed: " + (e && e.message ? e.message : e)); return;
            }
            if (cb.progress) cb.progress(Math.min(1, frames / total), frames, total);
            if (pendLen < FS * 20) proc.stdout.resume();
            busy = false;
            if (pendLen >= FS) setTimeout(pump, 0); else if (ended) finish();
        }
        proc.stdout.on("data", function (d) {
            pending.push(d); pendLen += d.length;
            if (pendLen > FS * 60) proc.stdout.pause();
            if (!busy) setTimeout(pump, 0);
        });
        proc.stderr.on("data", function (d) { errTxt += d.toString(); });
        proc.on("error", function (e) { if (!stopped) { stopped = true; if (timer) clearInterval(timer); cb.error("could not start ffmpeg (" + e.message + ")"); } });
        proc.on("close", function () { ended = true; if (!busy) { if (pendLen >= FS) setTimeout(pump, 0); else finish(); } });
        timer = setInterval(function () { if (!busy && pendLen >= FS) pump(); }, 200);
        return { cancel: function () { stopped = true; if (timer) clearInterval(timer); try { proc.kill(); } catch (e) {} } };
    }

    var api = { Analyzer: Analyzer, detect: detect, DEFAULTS: DEFAULTS, analyzeFile: analyzeFile,
                _internal: { subjectMask: subjectMask, symmetryOf: symmetryOf, globalShift: globalShift, toGray: toGray, laplacianVar: laplacianVar } };
    // always expose on the page (in the Premiere panel "module" also exists, so set both)
    if (root) root.aEditPose = api;
    if (typeof window !== "undefined") window.aEditPose = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(this);
