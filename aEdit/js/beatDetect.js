/* aEdit · Beat Marker analysis (pure JS, no dependencies)
   Input: mono Float32Array samples. Output: tempo, beat times and the bar phase (which beat is "1").
   Method: spectral-flux onset envelope -> autocorrelation tempo -> dynamic-programming beat tracker
   (beats follow small tempo changes) -> downbeat from low-frequency (kick) energy. */
(function (root) {
  "use strict";

  function fft(re, im) {                       // in-place radix-2
    var n = re.length, i, j = 0, k, len, ang, wr, wi, cr, ci, tr, ti, half;
    for (i = 1; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { tr = re[i]; re[i] = re[j]; re[j] = tr; tr = im[i]; im[i] = im[j]; im[j] = tr; }
    }
    for (len = 2; len <= n; len <<= 1) {
      ang = -2 * Math.PI / len; wr = Math.cos(ang); wi = Math.sin(ang); half = len >> 1;
      for (i = 0; i < n; i += len) {
        cr = 1; ci = 0;
        for (k = 0; k < half; k++) {
          var a = i + k, b = a + half;
          tr = re[b] * cr - im[b] * ci; ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          var t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  /* onset envelopes: full band and low band (kick), one value per hop */
  function onsets(x, sr) {
    var N = 512, H = 128, nF = Math.max(0, Math.floor((x.length - N) / H) + 1);
    var win = new Float32Array(N), i, f, b;
    for (i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    var nb = N / 2, lowTop = Math.max(2, Math.round(160 / (sr / N)));
    var prev = new Float32Array(nb), env = new Float32Array(nF), low = new Float32Array(nF);
    var re = new Float64Array(N), im = new Float64Array(N);
    for (f = 0; f < nF; f++) {
      var off = f * H;
      for (i = 0; i < N; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
      fft(re, im);
      var s = 0, sl = 0;
      for (b = 1; b < nb; b++) {
        var m = Math.log(1 + 100 * Math.sqrt(re[b] * re[b] + im[b] * im[b]));
        var d = m - prev[b]; prev[b] = m;
        if (d > 0) { s += d; if (b <= lowTop) sl += d; }
      }
      env[f] = s; low[f] = sl;
    }
    return { env: norm(env, 43), low: norm(low, 43), fps: sr / H, t0: (N / 2) / sr, H: H };
  }
  function norm(e, w) {                         // remove local mean, half-wave rectify, unit std
    var n = e.length, out = new Float32Array(n), cs = new Float64Array(n + 1), i;
    for (i = 0; i < n; i++) cs[i + 1] = cs[i] + e[i];
    for (i = 0; i < n; i++) {
      var a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
      var v = e[i] - (cs[b] - cs[a]) / (b - a);
      out[i] = v > 0 ? v : 0;
    }
    var ss = 0; for (i = 0; i < n; i++) ss += out[i] * out[i];
    var sd = Math.sqrt(ss / Math.max(1, n)) || 1;
    for (i = 0; i < n; i++) out[i] /= sd;
    return out;
  }

  /* tempo in BPM from autocorrelation of the onset envelope */
  function tempo(env, fps, minBpm, maxBpm, centre) {
    var lo = Math.floor(60 * fps / maxBpm), hi = Math.ceil(60 * fps / minBpm), n = env.length;
    var ac = new Float64Array(hi + 2), L, i, best = -1, bestL = lo;
    for (L = lo - 1; L <= hi + 1; L++) {
      if (L < 1) continue;
      var s = 0; for (i = L; i < n; i++) s += env[i] * env[i - L];
      ac[L] = s / (n - L);
    }
    function acAt(l) {
      var li = Math.round(l); if (li < 1 || li >= n) return 0;
      var t = 0; for (var q = li; q < n; q++) t += env[q] * env[q - li];
      return t / (n - li);
    }
    for (L = lo; L <= hi; L++) {
      var bpm = 60 * fps / L, z = Math.log(bpm / centre) / Math.LN2;
      var w = Math.exp(-0.5 * z * z / (0.9 * 0.9));
      // a real beat lattice also repeats at 2x the lag and has subdivisions at half the lag;
      // a 3:2 "false" period has neither, which keeps us off 120 vs 180 type errors
      var sc = w * (ac[L] + 0.5 * acAt(2 * L) + 0.5 * acAt(L / 2));
      if (ac[L] >= ac[L - 1] && ac[L] >= ac[L + 1] && sc > best) { best = sc; bestL = L; }
    }
    var a = ac[bestL - 1], b = ac[bestL], c = ac[bestL + 1], den = a - 2 * b + c;
    var p = den ? 0.5 * (a - c) / den : 0;
    return 60 * fps / (bestL + Math.max(-0.5, Math.min(0.5, p)));
  }

  /* dynamic-programming beat tracker (Ellis 2007) */
  function track(env, fps, bpm, tight) {
    var n = env.length, P = 60 * fps / bpm, score = new Float64Array(n), back = new Int32Array(n), t, p;
    for (t = 0; t < n; t++) {
      var a = Math.max(0, Math.round(t - 2 * P)), b = Math.round(t - P / 2), best = 0, bi = -1;
      for (p = a; p <= b; p++) {
        var r = Math.log((t - p) / P), v = score[p] - tight * r * r;
        if (bi < 0 || v > best) { best = v; bi = p; }
      }
      score[t] = env[t] + (bi >= 0 ? best : 0); back[t] = bi;
    }
    var end = n - 1, m = -1e9;
    for (t = Math.max(0, Math.floor(n - P)); t < n; t++) if (score[t] > m) { m = score[t]; end = t; }
    var beats = [];
    for (t = end; t >= 0; t = back[t]) beats.unshift(t);
    return beats;
  }

  /* sub-frame peak position of the envelope near a beat frame */
  function refine(env, f) {
    var best = f, i;
    for (i = Math.max(1, f - 2); i <= Math.min(env.length - 2, f + 2); i++) if (env[i] > env[best]) best = i;
    if (env[best] <= 0.3) return f;
    var a = env[best - 1], b = env[best], c = env[best + 1], den = a - 2 * b + c;
    return best + (den ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0);
  }

  function analyze(x, sr, opt) {
    opt = opt || {};
    var o = onsets(x, sr);
    if (o.env.length < o.fps * 2) return { error: "Clip is too short to analyse." };
    var bpm = opt.bpm || tempo(o.env, o.fps, opt.minBpm || 60, opt.maxBpm || 200, opt.centre || 120);
    var fr = track(o.env, o.fps, bpm, opt.tight || 100);

    // drop leading / trailing beats that sit in silence
    var sm = fr.map(function (f) { var s = 0, k; for (k = -3; k <= 3; k++) s = Math.max(s, o.env[f + k] || 0); return s; });
    var mean = sm.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, sm.length), th = mean * 0.15;
    var s0 = 0, s1 = fr.length - 1;
    while (s0 < s1 && sm[s0] < th) s0++;
    while (s1 > s0 && sm[s1] < th) s1--;
    fr = fr.slice(s0, s1 + 1);

    var times = fr.map(function (f) { return refine(o.env, f) / o.fps + o.t0; });

    // downbeat: which of the 4 positions carries the most kick energy
    var ph = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
    fr.forEach(function (f, i) {
      var e = 0, k; for (k = -2; k <= 2; k++) e = Math.max(e, o.low[f + k] || 0);
      ph[i % 4] += e + 0.3 * (o.env[f] || 0); cnt[i % 4]++;
    });
    var down = 0;
    for (var q = 1; q < 4; q++) if (ph[q] / (cnt[q] || 1) > ph[down] / (cnt[down] || 1)) down = q;

    // real tempo + stability from the tracked beats
    var ibi = [];
    for (var i = 1; i < times.length; i++) ibi.push(times[i] - times[i - 1]);
    var avg = ibi.length ? (times[times.length - 1] - times[0]) / ibi.length : 60 / bpm;
    var sd = 0; ibi.forEach(function (d) { sd += (d - avg) * (d - avg); });
    sd = ibi.length ? Math.sqrt(sd / ibi.length) : 0;

    return { bpm: 60 / avg, trackBpm: bpm, times: times, downbeat: down, variation: sd / avg,
             env: o.env, fps: o.fps, t0: o.t0, duration: x.length / sr };
  }

  var api = { analyze: analyze };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.aEditBeat = api;
})(typeof window !== "undefined" ? window : this);
