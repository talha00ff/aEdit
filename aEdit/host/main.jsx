/*  aEdit by talha0ff - Premiere Pro host script (ExtendScript / ES3)
    Beat edit: lays the selected look clips on the selected music clip's beat markers.
    - one part per video, neighbouring clips never back to back
    - fills the music from start to end (slow-down / second parts when needed)
    - cuts on strong beats, alternates close / wide shots
    Pose cut: splits a long take into its usable poses (see aed_* functions at the end). */

var BK_TICKS = 254016000000;

/* ---------- yardimcilar ---------- */
function bk_secs(t) {
    if (t === undefined || t === null) return 0;
    if (typeof t === "number") return t;
    if (t.seconds !== undefined) return Number(t.seconds);
    return parseFloat(t);
}
function bk_frameDur(seq) {
    var tb = parseFloat(seq.timebase);
    if (!tb || isNaN(tb)) return 1 / 25;
    return tb / BK_TICKS;
}
function bk_snap(t, fd) { return Math.round(t / fd) * fd; }
function bk_shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
}
function bk_time(sec) { var t = new Time(); t.seconds = sec; return t; }
function bk_tc(sec) { var m = Math.floor(sec / 60), x = sec - m * 60; return m + ":" + (x < 10 ? "0" : "") + x.toFixed(2); }
function bk_sortUnique(arr, fd) {
    arr.sort(function (a, b) { return a - b; });
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        var v = bk_snap(arr[i], fd);
        if (out.length === 0 || Math.abs(v - out[out.length - 1]) > fd / 2) out.push(v);
    }
    return out;
}
function bk_findClipAt(track, t, fd) {
    for (var i = 0; i < track.clips.numItems; i++) {
        var c = track.clips[i];
        if (Math.abs(bk_secs(c.start) - t) < fd / 2) return c;
    }
    return null;
}
/* Sequence timecode metni (QE razor icin) */
function bk_tcString(seq, sec, fd) {
    try {
        var st = seq.getSettings();
        var t = bk_time(sec);
        var s = t.getFormatted(st.videoFrameRate, st.videoDisplayFormat);
        if (s) return s;
    } catch (e) {}
    var fps = Math.round(1 / fd), fr = Math.round(sec / fd);
    var f = fr % fps, ss = Math.floor(fr / fps), h = Math.floor(ss / 3600), m = Math.floor(ss / 60) % 60;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(h) + ";" + p(m) + ";" + p(ss % 60) + ";" + p(f);
}

/* ---------- muzik ve marker'lar ---------- */
/* Uzerinde marker olan TEK muzik klibini secer:
   1) secili ses klibi, 2) secili video klipleriyle en cok cakisan, 3) en uzun. */
function bk_getMarkers(seq, fd, selStart, selEnd) {
    var best = null, bestScore = -1;
    for (var a = 0; a < seq.audioTracks.numTracks; a++) {
        var tr = seq.audioTracks[a];
        for (var c = 0; c < tr.clips.numItems; c++) {
            var cl = tr.clips[c];
            var pi = cl.projectItem;
            if (!pi) continue;
            var pm = null;
            try { pm = pi.getMarkers(); } catch (e) { pm = null; }
            if (!pm || pm.numMarkers < 1) continue;
            var st = bk_secs(cl.start), en = bk_secs(cl.end), inp = bk_secs(cl.inPoint);
            var ts = [], cols = [], nms = [];
            var k = pm.getFirstMarker();
            while (k) {
                var t = st + (bk_secs(k.start) - inp);
                if (t >= st - 0.001 && t <= en + 0.001) {
                    ts.push(t);
                    var col = -1;
                    try { col = k.getColorByIndex(); } catch (eC) { col = -1; }
                    cols.push(col);
                    var nm = ""; try { nm = String(k.name); } catch (eN) {}
                    nms.push(nm);
                }
                k = pm.getNextMarker(k);
            }
            if (ts.length < 2) continue;
            var sel = false;
            try { sel = cl.isSelected(); } catch (eS) {}
            var ov = Math.max(0, Math.min(en, selEnd) - Math.max(st, selStart));
            var score = (sel ? 1000000 : 0) + ov * 1000 + (en - st);
            if (score > bestScore) { bestScore = score; best = { st: st, en: en, ts: ts, cols: cols, nms: nms, name: cl.name }; }
        }
    }
    if (!best) return null;

    // guclu vurus: ilk marker'in rengi (beat eklentisinde 1. vurus)
    var order = [];
    for (var o = 0; o < best.ts.length; o++) order.push(o);
    order.sort(function (x, y) { return best.ts[x] - best.ts[y]; });
    var accentCol = best.cols[order[0]];
    var accents = [];
    // aEdit Beat Marker names its markers "1".."4": beat 1 is the strong beat
    for (var n1 = 0; n1 < best.nms.length; n1++) if (best.nms[n1] === "1") accents.push(bk_snap(best.ts[n1], fd));
    var named = accents.length > 0 && accents.length < best.ts.length;
    if (named) { for (var n2 = 0; n2 < best.nms.length; n2++) if (best.nms[n2] === "1") { accentCol = best.cols[n2]; break; } }
    else accents = [];
    if (!named && accentCol !== -1 && accentCol !== undefined) {
        var diff = false;
        for (var q = 0; q < best.cols.length; q++) if (best.cols[q] !== accentCol) diff = true;
        if (diff) for (var q2 = 0; q2 < best.ts.length; q2++) if (best.cols[q2] === accentCol) accents.push(bk_snap(best.ts[q2], fd));
    }

    var pts = best.ts.slice(0);
    pts.push(best.st); pts.push(best.en);
    pts = bk_sortUnique(pts, fd);
    var gap = (best.ts.length > 1) ? (best.ts[order[order.length - 1]] - best.ts[order[0]]) / (best.ts.length - 1) : 0.5;
    var clean = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
        var isEnd = (i === pts.length - 1);
        if (pts[i] - clean[clean.length - 1] < gap * 0.5) {
            if (isEnd) clean[clean.length - 1] = pts[i];
            continue;
        }
        clean.push(pts[i]);
    }
    return { times: clean, accents: accents, accentCol: accentCol, name: best.name, st: best.st, en: best.en, count: best.ts.length, beat: gap };
}

/* ---------- secim ---------- */
/* Parcalara bolme ayari (panelden bk_setSplit ile gelir) */
var BK_SPLIT = { on: false, len: 3 };
function bk_setSplit(on, len) {
    BK_SPLIT.on = Number(on) === 1;
    var l = Number(len);
    BK_SPLIT.len = (l > 0.2) ? l : 3;
    return "OK";
}

function bk_collect(seq, perClip) {
    var sel = seq.getSelection();
    var r = { groups: {}, keys: [], selVideo: [], nest: 0, selStart: 1e9, selEnd: -1 };
    for (var s = 0; s < sel.length; s++) {
        var ti = sel[s];
        if (ti.mediaType !== "Video") continue;
        var pi = ti.projectItem;
        if (!pi) continue;
        r.selVideo.push(ti);
        if (BK_SPLIT.on) {
            // uzun klibi esit parcalara bol; her parca ayri bir "video" sayilir
            var inP0 = bk_secs(ti.inPoint), outP0 = bk_secs(ti.outPoint), st0 = bk_secs(ti.start);
            var spd0 = 1;
            try { var gs = Number(ti.getSpeed()); if (gs > 0) spd0 = gs > 5 ? gs / 100 : gs; } catch (eSp) {}
            var L = outP0 - inP0, nSeg = Math.max(1, Math.round(L / BK_SPLIT.len)), seg = L / nSeg;
            for (var sg = 0; sg < nSeg; sg++) {
                var kS = "c" + s + "_" + sg;
                var a0 = inP0 + sg * seg, b0 = inP0 + (sg + 1) * seg;
                r.groups[kS] = { pi: pi, items: [{ inP: a0, outP: b0, ti: ti, tlStart: st0 + (a0 - inP0) / spd0, tlEnd: st0 + (b0 - inP0) / spd0 }], ord: st0 + (a0 - inP0) / spd0, uses: [] };
                r.keys.push(kS);
            }
            if (st0 < r.selStart) r.selStart = st0;
            if (bk_secs(ti.end) > r.selEnd) r.selEnd = bk_secs(ti.end);
            continue;
        }
        var key = (Number(perClip) === 1) ? ("c" + s) : pi.nodeId;
        try { if (pi.isSequence()) r.nest++; } catch (eN) {}
        if (!r.groups[key]) { r.groups[key] = { pi: pi, items: [], ord: 1e9, uses: [] }; r.keys.push(key); }
        var g = r.groups[key];
        var tStart = bk_secs(ti.start);
        if (tStart < g.ord) g.ord = tStart;
        g.items.push({ inP: bk_secs(ti.inPoint), outP: bk_secs(ti.outPoint), ti: ti });
        if (tStart < r.selStart) r.selStart = tStart;
        if (bk_secs(ti.end) > r.selEnd) r.selEnd = bk_secs(ti.end);
    }
    var ordList = r.keys.slice(0).sort(function (x, y) { return r.groups[x].ord - r.groups[y].ord; });
    for (var i = 0; i < ordList.length; i++) {
        var gg = r.groups[ordList[i]];
        gg.rank = i;
        var m = 0;
        for (var z = 0; z < gg.items.length; z++) m = Math.max(m, gg.items[z].outP - gg.items[z].inP);
        gg.maxLen = m;
    }
    return r;
}

function bk_parseOpts(beatOpts) {
    var opts = [], parts = String(beatOpts).split(",");
    for (var p = 0; p < parts.length; p++) { var v = parseInt(parts[p], 10); if (v > 0) opts.push(v); }
    return opts;
}

/* ---------- kanal ---------- */
function bk_findEmptyTrack(seq) {
    var n = Math.min(seq.videoTracks.numTracks, seq.audioTracks.numTracks);
    for (var i = n - 1; i >= 0; i--) {
        if (seq.videoTracks[i].clips.numItems === 0 && seq.audioTracks[i].clips.numItems === 0) return i;
    }
    return -1;
}
function bk_addTrackPair(seq) {
    var nV = seq.videoTracks.numTracks, nA = seq.audioTracks.numTracks;
    var target = Math.max(nV, nA);
    var addV = target + 1 - nV, addA = target + 1 - nA;
    try { qe.project.getActiveSequence().addTracks(addV, nV, addA, 1, nA, 0, 0, 0); } catch (e) { return -1; }
    var s2 = app.project.activeSequence;
    if (s2.videoTracks.numTracks < target + 1 || s2.audioTracks.numTracks < target + 1) return -1;
    return target;
}

/* ---------- klip islemleri ---------- */
function bk_setIO(pi, a, b, fd) {
    var ok = false;
    try { pi.setInPoint(bk_time(a), 4); pi.setOutPoint(bk_time(b), 4); } catch (e) {}
    try { ok = Math.abs(bk_secs(pi.getInPoint()) - a) < fd && Math.abs(bk_secs(pi.getOutPoint()) - b) < fd; } catch (e2) {}
    if (ok) return true;
    try { pi.setInPoint(a, 4); pi.setOutPoint(b, 4); } catch (e3) {}
    try { ok = Math.abs(bk_secs(pi.getInPoint()) - a) < fd && Math.abs(bk_secs(pi.getOutPoint()) - b) < fd; } catch (e4) {}
    return ok;
}

function bk_setSpeed(trackIndex, t, fd, speed, track) {
    var qt = qe.project.getActiveSequence().getVideoTrackAt(trackIndex);
    var candidates = [speed * 100, speed];
    for (var c = 0; c < candidates.length; c++) {
        var qItem = null;
        for (var q = 0; q < qt.numItems; q++) {
            var it = qt.getItemAt(q);
            if (it.type === "Empty") continue;
            if (Math.abs(parseFloat(it.start.secs) - t) < fd / 2) { qItem = it; break; }
        }
        if (!qItem) return false;
        var before = null, ti0 = bk_findClipAt(track, t, fd);
        if (ti0) before = bk_secs(ti0.end) - bk_secs(ti0.start);
        try { qItem.setSpeed(candidates[c], "", false, false, false); } catch (e) { continue; }
        var ti = bk_findClipAt(track, t, fd);
        if (!ti) continue;
        var sp = -1;
        try { sp = Number(ti.getSpeed()); } catch (e2) {}
        if (Math.abs(sp - speed) < 0.01 || Math.abs(sp - speed * 100) < 1) return true;
        var dur = bk_secs(ti.end) - bk_secs(ti.start);
        if (before !== null && Math.abs(dur - before / speed) <= fd * 2.5) return true;
    }
    return false;
}

/* Klibin sonunu tam olarak endT'ye ceker; olmazsa QE ile keser ve fazlayi siler */
function bk_enforceEnd(seq, trackIndex, vt, at, startT, endT, fd) {
    var ti = bk_findClipAt(vt, startT, fd);
    if (!ti) return false;
    var cur = bk_secs(ti.end);
    if (Math.abs(cur - endT) <= fd * 1.5) return true;   // 1 karelik yuvarlama sorun degil
    var wasShort = cur < endT;
    try { ti.end = bk_time(endT); } catch (e) {}
    ti = bk_findClipAt(vt, startT, fd);
    if (ti && Math.abs(bk_secs(ti.end) - endT) <= fd * 1.5) {
        var a0 = bk_findClipAt(at, startT, fd);
        if (a0) { try { a0.end = bk_time(endT); } catch (eA) {} }
        return true;
    }
    if (wasShort) return false; // kaynakta yeterli goruntu yok
    // yedek: QE razor
    var tc = bk_tcString(seq, endT, fd);
    try {
        var qs = qe.project.getActiveSequence();
        var qv = qs.getVideoTrackAt(trackIndex);
        try { qv.razor(tc); } catch (r1) { try { qv.razor(tc, true, true); } catch (r2) {} }
        try { qs.getAudioTrackAt(trackIndex).razor(tc); } catch (r3) {}
    } catch (eQ) {}
    var tail = bk_findClipAt(vt, endT, fd);
    if (tail) { try { tail.remove(false, false); } catch (eR) {} }
    var atail = bk_findClipAt(at, endT, fd);
    if (atail) { try { atail.remove(false, false); } catch (eR2) {} }
    ti = bk_findClipAt(vt, startT, fd);
    return !!(ti && Math.abs(bk_secs(ti.end) - endT) <= fd);
}

/* ---------- yakin / uzak plan analizi ----------
   Her klibin ortasindan bir kare PNG olarak disari aktarilir; panel (JS) beyaz oranini olcer. */
var BK_SHOTS = {};   // key -> { wide: 1/0, ratio: 0..1 }

function bk_exportFrames(perClip) {
    try {
        app.enableQE();
        var seq = app.project.activeSequence;
        if (!seq) return "ERROR: No active sequence.";
        var qs = qe.project.getActiveSequence();
        var c = bk_collect(seq, perClip);
        if (!c.keys.length) return "ERROR: Select the look clips first.";
        var dir = new Folder(Folder.temp.fsName + "/beatkurgu_frames");
        if (!dir.exists) dir.create();
        var old = dir.getFiles("*.png");
        for (var o = 0; o < old.length; o++) { try { old[o].remove(); } catch (eO) {} }

        // diger video kanallarini gecici olarak kapat (ust katmanlar kareyi ortmesin)
        var muted = [];
        var origPos = null;
        try { origPos = seq.getPlayerPosition().ticks; } catch (eP) {}
        var lines = [], stamp = (new Date()).getTime();
        for (var i = 0; i < c.keys.length; i++) {
            var k = c.keys[i], g = c.groups[k];
            // en uzun parcayi al
            var best = g.items[0];
            for (var z = 1; z < g.items.length; z++) if (g.items[z].outP - g.items[z].inP > best.outP - best.inP) best = g.items[z];
            var ti = best.ti;
            var mid = (best.tlStart !== undefined) ? (best.tlStart + best.tlEnd) / 2 : bk_secs(ti.start) + (bk_secs(ti.end) - bk_secs(ti.start)) / 2;
            var trackIdx = -1;
            for (var vt = 0; vt < seq.videoTracks.numTracks && trackIdx < 0; vt++) {
                var tr = seq.videoTracks[vt];
                for (var cc = 0; cc < tr.clips.numItems; cc++) {
                    var cl = tr.clips[cc];
                    if (Math.abs(bk_secs(cl.start) - bk_secs(ti.start)) < 0.001 && cl.name === ti.name) { trackIdx = vt; break; }
                }
            }
            muted = [];
            for (var m = 0; m < seq.videoTracks.numTracks; m++) {
                if (m === trackIdx) continue;
                var vtr = seq.videoTracks[m], wasMuted = false;
                try { wasMuted = vtr.isMuted(); } catch (eM) {}
                if (!wasMuted) { try { vtr.setMute(1); muted.push(vtr); } catch (eM2) {} }
            }
            var wasDisabled = false;
            try { wasDisabled = ti.disabled; if (wasDisabled) ti.disabled = false; } catch (eD) {}

            seq.setPlayerPosition(String(Math.round(mid * BK_TICKS)));
            var tc = null;
            try { tc = qs.CTI.timecode; } catch (eT) {}
            if (!tc) tc = bk_tcString(seq, mid, bk_frameDur(seq));
            var outBase = dir.fsName + "/bk_" + stamp + "_" + i;
            var exOk = true;
            try { qs.exportFramePNG(tc, outBase); } catch (eX) { exOk = false; }

            for (var u = 0; u < muted.length; u++) { try { muted[u].setMute(0); } catch (eU) {} }
            try { if (wasDisabled) ti.disabled = true; } catch (eD2) {}
            lines.push(k + "|" + (exOk ? outBase.replace(/\\/g, "/") : "ERR"));
        }
        if (origPos) { try { seq.setPlayerPosition(origPos); } catch (eR) {} }
        return "OK\n" + lines.join("\n");
    } catch (err) { return "ERROR: " + err.toString() + (err.line ? " (line " + err.line + ")" : ""); }
}

/* Secimin imzasi: secim degismediyse eski analiz tekrar kullanilir */
function bk_selSig(perClip) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "";
        var c = bk_collect(seq, perClip), out = [];
        for (var i = 0; i < c.keys.length; i++) {
            var g = c.groups[c.keys[i]];
            out.push(c.keys[i] + "@" + g.pi.name + "@" + g.ord.toFixed(3));
        }
        return out.join("|");
    } catch (e) { return ""; }
}

/* JS'ten sonuc: "key=1:0.83;key2=0:0.31" (1 = uzak plan) */
function bk_setShots(str) {
    BK_SHOTS = {};
    var parts = String(str).split(";"), n = 0;
    for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split("=");
        if (kv.length !== 2) continue;
        var v = kv[1].split(":");
        BK_SHOTS[kv[0]] = { wide: Number(v[0]), ratio: Number(v[1]) };
        n++;
    }
    return "OK " + n;
}

/* ---------- on kontrol ---------- */
function bk_preview(beatOpts, perClip, useAll) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "No active sequence.";
        var fd = bk_frameDur(seq);
        var opts = bk_parseOpts(beatOpts);
        if (!opts.length) return "Pick at least one marker interval.";
        var c = bk_collect(seq, perClip);
        var mk = bk_getMarkers(seq, fd, c.selStart, c.selEnd);
        var out = [];
        out.push(BK_SPLIT.on ? ("Selected clips: " + c.selVideo.length + ", parts: " + c.keys.length + " (~" + BK_SPLIT.len + " s each)") : ("Selected look clips: " + c.keys.length));
        if (!mk) { out.push("No music clip with beat markers found."); return out.join("\n"); }
        var M = mk.times.length - 1;
        var sum = 0, mx = 0;
        for (var i = 0; i < opts.length; i++) { sum += opts[i]; mx = Math.max(mx, opts[i]); }
        var avg = sum / opts.length;
        out.push("Music: " + mk.name + " (" + (mk.en - mk.st).toFixed(1) + " s, " + mk.count + " markers)");
        out.push("Clips needed to fill the music: min " + Math.ceil(M / mx) + ", comfortable " + Math.ceil(M / avg));
        if (c.keys.length === 0) out.push("No look clips selected yet.");
        else if (c.keys.length < Math.ceil(M / mx)) out.push("WARNING: Too few clips. Turn on slow-down or second parts.");
        else if (c.keys.length < Math.ceil(M / avg)) out.push("Enough, but tight: longer intervals will be used more.");
        else out.push("Clip count is fine.");
        if (mk.accents.length) out.push("Strong-beat markers: " + mk.accents.length + ".");
        if (Number(useAll) === 1 && c.keys.length) {
            var mn = 1e9; for (var j = 0; j < opts.length; j++) mn = Math.min(mn, opts[j]);
            if (c.keys.length * mn <= M) out.push("Use every clip: OK, all " + c.keys.length + " clips fit.");
            else if (c.keys.length <= M) out.push("Use every clip: tight - some clips will get fewer than " + mn + " markers.");
            else out.push("WARNING: Use every clip: " + c.keys.length + " clips but only " + M + " beats. " + (c.keys.length - M) + " clips will be left out.");
        }
        return out.join("\n");
    } catch (err) { return "ERROR: " + err.toString(); }
}

/* ---------- ana islem ----------
   slowPct, fastPct (hiz araligi), beatOpts("2,4,6"), removeAudio, disableSources, perClip,
   accent (guclu vurus), openClose (acilis/kapanis uzun), stretch (yavaslat), reuse (ikinci parca), minSpeedPct */
function bk_run(slowPct, fastPct, beatOpts, removeAudio, disableSources, perClip, accent, openClose, stretch, reuse, minSpeedPct, alternate, useAll) {
    var log = [];
    try {
        app.enableQE();
        var seq = app.project.activeSequence;
        if (!seq) return "ERROR: No active sequence.";
        var slow = Number(slowPct) / 100, speed = Number(fastPct) / 100;
        if (!(slow > 0) || !(speed > 0)) return "ERROR: Invalid speed value.";
        if (slow > speed) { var tmpS = slow; slow = speed; speed = tmpS; }   // ters girildiyse duzelt
        var minSpeed = Number(minSpeedPct) / 100;
        if (!(minSpeed > 0) || minSpeed > slow) minSpeed = Math.min(slow, 0.4);
        var fd = bk_frameDur(seq);
        var opts = bk_parseOpts(beatOpts);
        if (opts.length === 0) return "ERROR: Pick at least one marker interval (2/4/6).";
        var maxOpt = 0, minOpt = 1e9;
        for (var mo = 0; mo < opts.length; mo++) { maxOpt = Math.max(maxOpt, opts[mo]); minOpt = Math.min(minOpt, opts[mo]); }
        accent = Number(accent) === 1; openClose = Number(openClose) === 1;
        stretch = Number(stretch) === 1; reuse = Number(reuse) === 1;

        var c = bk_collect(seq, perClip);
        var groups = c.groups, keys = c.keys;
        if (keys.length === 0) return "ERROR: Select the look clips on the timeline and try again.";

        var mk = bk_getMarkers(seq, fd, c.selStart, c.selEnd);
        if (!mk || mk.times.length < 3) return "ERROR: No music clip with beat markers found.";
        var times = mk.times, M = times.length - 1;
        var isAcc = function (t) {
            for (var z = 0; z < mk.accents.length; z++) if (Math.abs(mk.accents[z] - t) < fd) return true;
            return false;
        };
        if (accent && !mk.accents.length) log.push("Note: Marker colours unreadable, strong-beat option skipped.");
        // "use every clip": keep enough markers back so every selected clip gets at least allUnit markers
        useAll = Number(useAll) === 1;
        var allUnit = (keys.length * minOpt <= M) ? minOpt : Math.max(1, Math.floor(M / keys.length));
        if (useAll && allUnit < minOpt) log.push("Note: Many clips for this music - some clips get only " + allUnit + " marker(s) so every clip fits.");

        // klipler muzigi bu hizda dolduramiyorsa (ve yavaslatma acik, ikinci parca kapali): hizi hepsine esit dagitarak dusur
        // bir klibin dolduracabilecegi en uzun secili aralik (2/4/6'dan biri)
        var capOf = function (len, sp) {
            var raw = Math.floor(len / (mk.beat * sp) + 0.05), best = 0;
            for (var z = 0; z < opts.length; z++) if (opts[z] <= raw && opts[z] > best) best = opts[z];
            return best;
        };
        var totalCap = function (sp) {
            var t = 0;
            for (var gk in groups) if (groups.hasOwnProperty(gk)) t += capOf(groups[gk].maxLen, sp);
            return t;
        };
        var baseSpeed = speed;
        if (stretch && !reuse) {
            while (totalCap(baseSpeed) < M && baseSpeed - 0.05 >= minSpeed - 0.001) baseSpeed -= 0.05;
            baseSpeed = Math.round(baseSpeed * 100) / 100;
            if (baseSpeed < speed) log.push("Note: Clips are short, fastest speed lowered to " + Math.round(baseSpeed * 100) + "%.");
        }
        var slowEff = Math.min(slow, baseSpeed);
        var pickSpeed = function () { return Math.round((slowEff + Math.random() * (baseSpeed - slowEff)) * 100) / 100; };
        var spMin = 9, spMax = 0, cutTotal = 0, cutAcc = 0, accPossible = 0;

        // hedef kanal
        var ti_idx = bk_findEmptyTrack(seq);
        if (ti_idx < 0) {
            ti_idx = bk_addTrackPair(seq);
            seq = app.project.activeSequence;
            if (ti_idx < 0 || bk_findEmptyTrack(seq) !== ti_idx)
                return "ERROR: Could not add an empty track. Use Add Tracks so video and audio track counts match and leave one empty pair.";
            log.push("New track: V" + (ti_idx + 1) + " / A" + (ti_idx + 1));
        }
        var vt = seq.videoTracks[ti_idx], at = seq.audioTracks[ti_idx];
        for (var v1 = 0; v1 < seq.videoTracks.numTracks; v1++) { try { seq.videoTracks[v1].setTargeted(v1 === ti_idx, true); } catch (e1) {} }
        for (var a1 = 0; a1 < seq.audioTracks.numTracks; a1++) { try { seq.audioTracks[a1].setTargeted(a1 === ti_idx, true); } catch (e2) {} }

        var used = {}, usedCount = 0, idx = 0, placed = 0;
        var shortSteps = 0, speedFail = 0, ioFail = 0, adjForced = 0, slowed = 0, reused = 0, endFail = 0, round = 1;
        var touched = [], lastRank = -99, lastKey = null;
        // yakin / uzak plan sirasi
        alternate = Number(alternate) === 1;
        var shotOf = function (kx) { var r = BK_SHOTS[kx]; return (r && (r.wide === 0 || r.wide === 1)) ? r.wide : -1; };
        var shotKnown = 0;
        if (alternate) { for (var sk = 0; sk < keys.length; sk++) if (shotOf(keys[sk]) !== -1) shotKnown++; }
        if (alternate && shotKnown < 2) { log.push("Note: No shot analysis yet - press 'Analyze shots' first. Close/wide order skipped."); alternate = false; }
        var lastShot = -1, altTotal = 0, altOk = 0;

        // klipten 'need' saniyelik, daha once kullanilmamis bir kesit sec
        var pickPart = function (grp, need) {
            var cands = [];
            for (var j = 0; j < grp.items.length; j++) if (grp.items[j].outP - grp.items[j].inP >= need - fd / 2) cands.push(grp.items[j]);
            if (!cands.length) return null;
            for (var tr = 0; tr < 12; tr++) {
                var part = cands[Math.floor(Math.random() * cands.length)];
                var slack = Math.max(0, part.outP - part.inP - need);
                var a = part.inP + Math.random() * slack;
                var clash = false;
                for (var u = 0; u < grp.uses.length; u++) if (a < grp.uses[u][1] && a + need > grp.uses[u][0]) clash = true;
                if (!clash || tr === 11) return { a: a, clash: clash };
            }
            return null;
        };

        var lastPlace = null;
        var placeOne = function (k, n, spd) {
            var grp = groups[k];
            var D = times[idx + n] - times[idx];
            var need = bk_snap(D * spd, fd);
            if (need < fd) return false;
            var pp = pickPart(grp, need);
            if (!pp) return false;
            if (round > 1 && pp.clash) return false; // ikinci turda ayni kesiti tekrar kullanma
            var srcIn = pp.a;
            var ioOk = bk_setIO(grp.pi, srcIn, srcIn + need, fd);
            if (!ioOk) { try { grp.pi.clearInPoint(); grp.pi.clearOutPoint(); } catch (eC) {} }
            vt.overwriteClip(grp.pi, times[idx]);
            touched.push(grp.pi);
            if (!ioOk) {
                var ni = bk_findClipAt(vt, times[idx], fd), ok2 = false;
                if (ni) {
                    try {
                        ni.inPoint = bk_time(srcIn);
                        ni.end = bk_time(bk_secs(ni.start) + need);
                        ok2 = Math.abs((bk_secs(ni.end) - bk_secs(ni.start)) - need) < fd * 1.5;
                    } catch (eT) {}
                }
                if (!ok2) {
                    if (ni) { try { ni.remove(false, false); } catch (eR) {} }
                    var na = bk_findClipAt(at, times[idx], fd);
                    if (na) { try { na.remove(false, false); } catch (eR2) {} }
                    ioFail++;
                    return null; // bu klip kullanilamaz
                }
            }
            if (!bk_setSpeed(ti_idx, times[idx], fd, spd, vt)) speedFail++;
            if (!bk_enforceEnd(seq, ti_idx, vt, at, times[idx], times[idx + n], fd)) endFail++;
            grp.uses.push([srcIn, srcIn + need]);
            if (Math.abs(grp.rank - lastRank) === 1) adjForced++;
            if (spd < slowEff - 0.001) slowed++;
            if (spd < spMin) spMin = spd; if (spd > spMax) spMax = spd;
            if (round > 1) reused++;
            lastPlace = { k: k, idx: idx, n: n, prevRank: lastRank, prevKey: lastKey, spd: spd };
            var shNow = alternate ? shotOf(k) : -1;
            if (shNow !== -1 && lastShot !== -1) { altTotal++; if (shNow !== lastShot) altOk++; }
            if (shNow !== -1) lastShot = shNow;
            lastRank = grp.rank; lastKey = k;
            used[k] = true; usedCount++; placed++;
            idx += n;
            return true;
        };

        while (idx < M) {
            var rem = M - idx;
            var left = keys.length - usedCount;
            if (left <= 0) {
                if (reuse && round < 3) { used = {}; usedCount = 0; round++; left = keys.length; }
                else break;
            }
            var budget = left + (reuse && round < 3 ? keys.length * (3 - round) : 0);
            // kalan kliplerin gercek kapasitesi (kisa klip uzun araligi dolduramaz)
            var caps = [];
            for (var ck in groups) {
                if (!groups.hasOwnProperty(ck) || used[ck]) continue;
                caps.push(capOf(groups[ck].maxLen, baseSpeed));
            }
            caps.sort(function (x, y) { return y - x; });
            var capSum = function (cnt) { var t = 0; for (var z = 0; z < Math.min(cnt, caps.length); z++) t += caps[z]; return t; };
            var extra = (reuse && round < 3) ? keys.length * (3 - round) * maxOpt : 0;
            var feasibleAfter = function (kx, nx) {
                var r3 = rem - nx;
                if (r3 <= 0 || extra > 0) return true;
                var cs = [], t3 = 0;
                for (var ck2 in groups) if (groups.hasOwnProperty(ck2) && !used[ck2] && ck2 !== kx) cs.push(capOf(groups[ck2].maxLen, baseSpeed));
                for (var z3 = 0; z3 < cs.length; z3++) t3 += cs[z3];
                return r3 <= t3;
            };

            // adim secenekleri (kac marker)
            var ns = [];
            for (var o2 = 0; o2 < opts.length; o2++) {
                var n2 = opts[o2];
                if (n2 > rem) continue;
                var r2 = rem - n2;
                if (r2 === 0 || r2 <= capSum(left - 1) + extra) ns.push(n2);
            }
            // don't leave a leftover that is shorter than the shortest interval (it would become a 1-2 marker flash)
            var nsOk = [];
            for (var q0 = 0; q0 < ns.length; q0++) { var rr = rem - ns[q0]; if (rr === 0 || rr >= minOpt) nsOk.push(ns[q0]); }
            if (nsOk.length) ns = nsOk;
            else if (rem < maxOpt + minOpt) ns = [rem];   // final clip takes the odd remainder (e.g. 5 or 7 markers)
            if (rem <= maxOpt && (budget === 1 || ns.length === 0)) ns = [rem];
            if (ns.length === 0) ns = [Math.min(maxOpt, rem)];
            var avg = rem / Math.max(1, budget), hi = [], lo = [];
            for (var q1 = 0; q1 < ns.length; q1++) (ns[q1] >= avg - 0.001 ? hi : lo).push(ns[q1]);
            bk_shuffle(hi); bk_shuffle(lo);
            if (lo.length && hi.length && (budget - 1) * maxOpt >= rem - lo[0] + maxOpt && Math.random() < 0.35) ns = lo.concat(hi);
            else ns = hi.concat(lo);
            if (accent && mk.accents.length) {
                var ac = [], na2 = [];
                for (var q3 = 0; q3 < ns.length; q3++) {
                    var land = idx + ns[q3];
                    ((land === M || isAcc(times[land])) ? ac : na2).push(ns[q3]);
                }
                ns = ac.concat(na2);
            }
            if (openClose && placed === 0) {
                // acilis: en uzun aralik, ama guclu vurus aciksa guclu vurusa inen en uzun aralik
                var landAcc = function (x) { return (accent && mk.accents.length && (idx + x === M || isAcc(times[idx + x]))) ? 1 : 0; };
                ns.sort(function (x, y) { return (landAcc(y) - landAcc(x)) || (y - x); });
            }
            var nsSmall = [];
            // fallback order: a normal interval that leaves an odd remainder, then shorter steps
            for (var q6 = opts.length - 1; q6 >= 0; q6--) { var inNs = false; for (var q7 = 0; q7 < ns.length; q7++) if (ns[q7] === opts[q6]) inNs = true; if (opts[q6] <= rem && !inNs) nsSmall.push(opts[q6]); }
            for (var sn = minOpt - 1; sn >= 1; sn--) if (sn <= rem) nsSmall.push(sn);
            if (useAll && round === 1 && left > 1) {
                var maxAllowed = rem - (left - 1) * allUnit, fns = [], seenN = {};
                for (var q4 = 0; q4 < ns.length; q4++) if (ns[q4] <= maxAllowed && !seenN[ns[q4]]) { seenN[ns[q4]] = 1; fns.push(ns[q4]); }
                if (!fns.length) for (var s5 = Math.min(maxAllowed, minOpt); s5 >= 1; s5--) fns.push(s5);
                if (fns.length) ns = fns;
                var fsm = []; for (var q5 = 0; q5 < nsSmall.length; q5++) if (nsSmall[q5] <= maxAllowed) fsm.push(nsSmall[q5]);
                nsSmall = fsm;
            }

            // aday klipler
            // oncelik katmani: 0 = zit plan + komsu degil, 1 = ayni plan + komsu degil, 2 = zit + komsu, 3 = ayni + komsu
            var pool = bk_shuffle(keys.slice(0)), cand = [], jit = {}, tier = {};
            var wantShot = -1;
            if (alternate) {
                if (lastShot === -1) {
                    // ilk klip: sayilar dengeliyse uzak plan, degilse cogunluktaki plan (daha cok degisim saglar)
                    var nWide = 0, nClose = 0;
                    for (var cq = 0; cq < keys.length; cq++) { var sq = shotOf(keys[cq]); if (sq === 1) nWide++; else if (sq === 0) nClose++; }
                    wantShot = (Math.abs(nWide - nClose) <= 1) ? 1 : (nWide > nClose ? 1 : 0);
                } else wantShot = 1 - lastShot;
            }
            for (var g0 = 0; g0 < pool.length; g0++) {
                var kk = pool[g0];
                if (used[kk] || kk === lastKey) continue;
                jit[kk] = groups[kk].maxLen + Math.random() * 0.6;
                var adj = Math.abs(groups[kk].rank - lastRank) === 1 ? 2 : 0;
                var shk = shotOf(kk);
                var same = (wantShot !== -1 && shk !== -1 && shk !== wantShot) ? 1 : 0;
                tier[kk] = adj + same;
                cand.push(kk);
            }
            var longFirst = openClose && (placed === 0);
            var byTierLen = function (x, y) {
                if (tier[x] !== tier[y]) return tier[x] - tier[y];
                return longFirst ? jit[y] - jit[x] : jit[x] - jit[y];
            };
            cand.sort(byTierLen);
            var order = cand;

            // once normal hiz, sonra (izin varsa) kademeli yavaslatma
            var sp0 = pickSpeed();
            var speeds = [sp0];
            if (sp0 > slowEff + 0.001) speeds.push(slowEff);   // kisa klip icin aralik icinde yavasla
            if (stretch) for (var sp = slowEff - 0.05; sp >= minSpeed - 0.001; sp -= 0.05) speeds.push(Math.max(minSpeed, sp));

            var done = false, nsMain = ns;
            for (var phase = 0; phase < 2 && !done; phase++) {
            ns = phase === 0 ? nsMain : nsSmall;   // phase 1 = shorter-than-chosen steps, only if nothing else fits
            if (phase === 1 && ns.length) shortSteps++;
            for (var si = 0; si < speeds.length && !done; si++) {
                for (var o = 0; o < ns.length && !done; o++) {
                    var n = ns[o];
                    if (openClose && idx + n === M && si === 0) {
                        // kapanis: en uzun klibi one al
                        order.sort(function (x, y) { return (tier[x] - tier[y]) || (jit[y] - jit[x]); });
                    }
                    for (var g = 0; g < order.length && !done; g++) {
                        var k = order[g];
                        if (used[k]) continue;
                        // bu klibi bu araliga koyarsak kalanlar muzigi hala doldurabilir mi?
                        if (si === 0 && o < ns.length - 1 && !feasibleAfter(k, n)) continue;
                        var res = placeOne(k, n, speeds[si]);
                        if (res === true) done = true;
                        else if (res === null) { used[k] = true; usedCount++; }
                    }
                }
            }
            }
            if (!done) {
                if (reuse && round < 3 && usedCount < keys.length) { for (var uk in used) used[uk] = true; usedCount = keys.length; continue; }
                break;
            }
        }

        // muzik bitmeden klipler bittiyse: son klibi yavaslatarak sona kadar uzat
        if (idx < M && stretch && lastPlace) {
            var lp = lastPlace, startT = times[lp.idx];
            var vrm = bk_findClipAt(vt, startT, fd); if (vrm) { try { vrm.remove(false, false); } catch (x1) {} }
            var arm = bk_findClipAt(at, startT, fd); if (arm) { try { arm.remove(false, false); } catch (x2) {} }
            groups[lp.k].uses.pop();
            placed--; idx = lp.idx; lastRank = lp.prevRank; lastKey = lp.prevKey;
            used[lp.k] = false; usedCount--;
            var okS = false;
            for (var sp2 = lp.spd - 0.05; sp2 >= minSpeed - 0.001 && !okS; sp2 -= 0.05) {
                if (placeOne(lp.k, M - idx, Math.max(minSpeed, sp2)) === true) okS = true;
            }
            if (!okS) placeOne(lp.k, lp.n, lp.spd); // olmadiysa eski haline don
        }

        // temizlik
        for (var q = 0; q < touched.length; q++) { try { touched[q].clearInPoint(); touched[q].clearOutPoint(); } catch (e3) {} }
        if (Number(removeAudio) === 1) {
            for (var r = at.clips.numItems - 1; r >= 0; r--) { try { at.clips[r].remove(false, false); } catch (e4) {} }
        }
        if (Number(disableSources) === 1) {
            for (var d = 0; d < c.selVideo.length; d++) { try { c.selVideo[d].disabled = true; } catch (e5) {} }
        }

        log.unshift("Done: " + placed + " clips placed on V" + (ti_idx + 1) + ".");
        log.push("Music: " + mk.name + " (" + mk.count + " markers, " + bk_tc(mk.st) + " - " + bk_tc(mk.en) + ")");
        log.push("Selected clips: " + keys.length + ", used: " + placed + (reused ? " (" + reused + " second parts)" : ""));
        // dogrulama: kesim noktalarini timeline'dan oku
        var starts = [];
        for (var vi = 0; vi < vt.clips.numItems; vi++) starts.push(bk_secs(vt.clips[vi].start));
        starts.sort(function (x, y) { return x - y; });
        for (var cs2 = 1; cs2 < starts.length; cs2++) { cutTotal++; if (isAcc(starts[cs2])) cutAcc++; }
        var offBeat = 0;
        for (var cs3 = 1; cs3 < starts.length; cs3++) {
            var onM = false;
            for (var tm = 0; tm < times.length; tm++) if (Math.abs(times[tm] - starts[cs3]) < fd * 1.5) { onM = true; break; }
            if (!onM) offBeat++;
        }
        if (idx >= M) log.push("The edit covers the music from start to end.");
        else log.push("Note: Ran out of clips, edit ends at " + bk_tc(times[idx]) + " (music ends " + bk_tc(mk.en) + "). Turn on slow-down / second parts or select more clips.");
        if (alternate) log.push("Close/wide: shot type changed on " + altOk + " of " + altTotal + " cuts.");
        if (useAll) {
            var unused = 0;
            for (var uk2 = 0; uk2 < keys.length; uk2++) if (!groups[keys[uk2]].uses.length) unused++;
            log.push(unused ? "WARNING: " + unused + " of " + keys.length + " clips are not in the edit (too short or not enough beats)." : "Every selected clip is in the edit.");
        }
        if (spMax > 0) log.push("Speeds: " + Math.round(spMin * 100) + "%" + (spMax > spMin ? " - " + Math.round(spMax * 100) + "%" : ""));
        var COLN = ["green", "red", "purple", "orange", "yellow", "white", "blue", "cyan"];
        if (mk.accents.length) log.push("Strong beat (" + (COLN[mk.accentCol] || ("colour " + mk.accentCol)) + "): " + cutAcc + " of " + cutTotal + " cuts on a strong beat" + (accent ? "" : " (option off)") + ".");
        if (offBeat) log.push("WARNING: " + offBeat + " cuts are not on a marker.");
        else if (cutTotal) log.push("Check: every cut is on a marker.");
        if (shortSteps) log.push("Note: " + shortSteps + " times no clip was long enough even when slowed, so a shorter interval was used. Select longer clips or lower 'Lowest speed %'.");
        if (slowed) log.push("Note: " + slowed + " clips were slowed down to fill the music.");
        if (adjForced) log.push("Note: " + adjForced + " times neighbouring clips had to sit next to each other.");
        if (ioFail) log.push("WARNING: " + ioFail + " clips could not be trimmed and were skipped.");
        if (speedFail) log.push("WARNING: speed could not be set on " + speedFail + " clips.");
        if (endFail) log.push("WARNING: " + endFail + " clip ends could not be snapped to a marker.");
        return log.join("\n");
    } catch (err) {
        return "ERROR: " + err.toString() + (err.line ? " (line " + err.line + ")" : "");
    }
}

/* =====================================================================
   POSE CUT  (aed_*)  - splits one long take into its usable poses.
   The panel analyses the source file with ffmpeg and sends back the pose
   ranges in source seconds; here we rebuild the clip from those ranges.
   ===================================================================== */

function aed_esc(s) { return String(s).replace(/\|/g, "/"); }

/* Info about the single selected video clip: OK|path|in|out|start|end|speed|track|name */
function aed_clipInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "ERROR: No active sequence.";
        var sel = seq.getSelection(), vids = [];
        for (var i = 0; i < sel.length; i++) if (sel[i].mediaType === "Video" && sel[i].projectItem) vids.push(sel[i]);
        if (!vids.length) return "ERROR: Select the long take (one video clip) on the timeline.";
        var ti = vids[0];
        var path = "";
        try { path = ti.projectItem.getMediaPath(); } catch (e) {}
        if (!path) return "ERROR: Could not read the clip's media file.";
        var spd = 1;
        try { var g = Number(ti.getSpeed()); if (g > 0) spd = g > 5 ? g / 100 : g; } catch (e2) {}
        var track = -1;
        for (var v = 0; v < seq.videoTracks.numTracks && track < 0; v++) {
            var tr = seq.videoTracks[v];
            for (var c = 0; c < tr.clips.numItems; c++) {
                var cl = tr.clips[c];
                if (Math.abs(bk_secs(cl.start) - bk_secs(ti.start)) < 0.001 && cl.name === ti.name) { track = v; break; }
            }
        }
        return ["OK", aed_esc(path), bk_secs(ti.inPoint), bk_secs(ti.outPoint), bk_secs(ti.start), bk_secs(ti.end), spd, track, aed_esc(ti.name), vids.length].join("|");
    } catch (err) { return "ERROR: " + err.toString() + (err.line ? " (line " + err.line + ")" : ""); }
}

/* place source range [a,b] of projectItem at timeline time pos on track vt; returns the new track item or null */
function aed_place(vt, at, pi, a, b, pos, fd) {
    var ok = bk_setIO(pi, a, b, fd);
    if (!ok) { try { pi.clearInPoint(); pi.clearOutPoint(); } catch (e0) {} }
    vt.overwriteClip(pi, pos);
    var ni = bk_findClipAt(vt, pos, fd);
    if (!ni) return null;
    if (!ok) {
        // fallback: whole clip was placed, trim it on the timeline
        try {
            ni.inPoint = bk_time(a);
            ni.end = bk_time(bk_secs(ni.start) + (b - a));
        } catch (e1) {}
        ni = bk_findClipAt(vt, pos, fd);
        if (!ni || Math.abs((bk_secs(ni.end) - bk_secs(ni.start)) - (b - a)) > fd * 1.5) {
            if (ni) { try { ni.remove(false, false); } catch (e2) {} }
            var na = at ? bk_findClipAt(at, pos, fd) : null;
            if (na) { try { na.remove(false, false); } catch (e3) {} }
            return null;
        }
    }
    return ni;
}

/* trackIdx/startSec identify the analysed clip; segStr = "a-b;c-d" in source seconds.
   closeGaps = 1 packs the poses one after another from the clip's start. */
function aed_cutPoses(trackIdx, startSec, segStr, closeGaps) {
    try {
        app.enableQE();
        var seq = app.project.activeSequence;
        if (!seq) return "ERROR: No active sequence.";
        var fd = bk_frameDur(seq);
        var vt = seq.videoTracks[Number(trackIdx)];
        if (!vt) return "ERROR: Track not found.";
        var ti = bk_findClipAt(vt, Number(startSec), fd);
        if (!ti) return "ERROR: The analysed clip is no longer at the same place. Analyse it again.";
        var pi = ti.projectItem;
        var inP = bk_secs(ti.inPoint), outP = bk_secs(ti.outPoint), st = bk_secs(ti.start), spd = 1;
        try { var g = Number(ti.getSpeed()); if (g > 0) spd = g > 5 ? g / 100 : g; } catch (eS) {}

        // pose ranges inside the clip
        var segs = [], parts = String(segStr).split(";");
        for (var i = 0; i < parts.length; i++) {
            var ab = parts[i].split("-");
            if (ab.length !== 2) continue;
            var a = Math.max(inP, Number(ab[0])), b = Math.min(outP, Number(ab[1]));
            if (b - a >= fd * 2) segs.push([a, b]);
        }
        if (!segs.length) return "ERROR: No poses to keep.";
        segs.sort(function (x, y) { return x[0] - y[0]; });

        // linked audio of the original clip (same start, same media)
        var at = seq.audioTracks[Number(trackIdx)] || null, audioGone = 0;
        for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var atr = seq.audioTracks[t];
            for (var c = atr.clips.numItems - 1; c >= 0; c--) {
                var ac = atr.clips[c];
                if (Math.abs(bk_secs(ac.start) - st) < fd / 2 && ac.projectItem && ac.projectItem.nodeId === pi.nodeId) {
                    try { ac.remove(false, false); audioGone++; } catch (eA) {}
                }
            }
        }
        try { ti.remove(false, false); } catch (eR) { return "ERROR: Could not remove the original clip."; }

        // deselect everything else
        try {
            var cur = seq.getSelection();
            for (var d = 0; d < cur.length; d++) { try { cur[d].setSelected(false, true); } catch (eD) {} }
        } catch (eSel) {}

        var placed = 0, failed = 0, cursor = st, kept = 0, made = [];
        for (var k = 0; k < segs.length; k++) {
            var s0 = segs[k][0], s1 = segs[k][1];
            var pos = (Number(closeGaps) === 1) ? cursor : st + (s0 - inP) / spd;
            var ni = aed_place(vt, at, pi, s0, s1, pos, fd);
            if (ni) { placed++; kept += s1 - s0; cursor = pos + (s1 - s0); made.push(pos); }
            else failed++;
        }
        try { pi.clearInPoint(); pi.clearOutPoint(); } catch (eC) {}
        // select the new poses so the beat edit can run right away
        for (var m = 0; m < made.length; m++) {
            var it = bk_findClipAt(vt, made[m], fd);
            if (it) { try { it.setSelected(true, true); } catch (eT) {} }
        }
        var out = ["Done: " + placed + " takes kept (" + kept.toFixed(1) + " s of " + (outP - inP).toFixed(1) + " s)."];
        out.push(Number(closeGaps) === 1 ? "Takes are packed back to back." : "Takes stay at their original position.");
        out.push("The takes are selected - you can run 'Build edit' now.");
        if (Math.abs(spd - 1) > 0.01) out.push("Note: the original clip had speed " + Math.round(spd * 100) + "%; takes are placed at 100%.");
        if (failed) out.push("WARNING: " + failed + " takes could not be placed.");
        out.push("Undo with Ctrl+Z if needed.");
        return out.join("\n");
    } catch (err) { return "ERROR: " + err.toString() + (err.line ? " (line " + err.line + ")" : ""); }
}
