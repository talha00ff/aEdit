// aEdit Export tab — host script (ExtendScript, ES3)
// Finds "blocks" of contiguous clips on one video track and queues each block in Adobe Media Encoder.

var AEX_TICKS = 254016000000;

function aex__json(o) {
    // minimal JSON serializer (ExtendScript has no JSON)
    if (o === null) return "null";
    var t = typeof o;
    if (t === "number" || t === "boolean") return String(o);
    if (t === "string") return '"' + o.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
    if (o instanceof Array) {
        var a = [];
        for (var i = 0; i < o.length; i++) a.push(aex__json(o[i]));
        return "[" + a.join(",") + "]";
    }
    var p = [];
    for (var k in o) if (o.hasOwnProperty(k)) p.push('"' + k + '":' + aex__json(o[k]));
    return "{" + p.join(",") + "}";
}

function aex__secs(t) { return Number(t.ticks) / AEX_TICKS; }

function aex__fps(seq) {
    try { return AEX_TICKS / Number(seq.timebase); } catch (e) { return 30; }
}

function aex__tc(sec, fps) {
    var f = Math.round(sec * fps);
    var r = Math.round(fps);
    var ff = f % r, s = Math.floor(f / r);
    var ss = s % 60, m = Math.floor(s / 60) % 60, h = Math.floor(s / 3600);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(h) + ":" + p(m) + ":" + p(ss) + ":" + p(ff);
}

function aex__isAdj(clip) {
    try {
        if (clip.projectItem && typeof clip.projectItem.isAdjustmentLayer === "function")
            return clip.projectItem.isAdjustmentLayer();
    } catch (e) {}
    return /adjustment layer/i.test(clip.name);
}

// Returns blocks for the given track (1-based index), merging clips whose gap <= gapSec.
/* Blocks are found on ALL video tracks together, so a logo / graphic on an upper track extends its video.
   Skipped: hidden tracks (eye off), disabled clips and adjustment layers (they span everything). */
function aex_findBlocks(gapSec, minLenSec) {
    var seq = app.project.activeSequence;
    if (!seq) return aex__json({ error: "No active sequence." });
    var tracks = seq.videoTracks;
    var items = [], used = [], hidden = [];
    for (var t = 0; t < tracks.numTracks; t++) {
        var track = tracks[t], off = false;
        try { off = track.isMuted(); } catch (eM) {}
        if (off) { if (track.clips.numItems) hidden.push("V" + (t + 1)); continue; }
        var n = 0;
        for (var i = 0; i < track.clips.numItems; i++) {
            var c = track.clips[i], dis = false;
            try { dis = c.disabled; } catch (eD) {}
            if (dis || aex__isAdj(c)) continue;
            items.push({ s: aex__secs(c.start), e: aex__secs(c.end) }); n++;
        }
        if (n) used.push("V" + (t + 1));
    }
    if (!items.length) return aex__json({ error: "No visible clips found (all tracks hidden or empty)." });
    items.sort(function (a, b) { return a.s - b.s; });

    var blocks = [];
    for (var j = 0; j < items.length; j++) {
        var it = items[j];
        var last = blocks.length ? blocks[blocks.length - 1] : null;
        if (last && it.s - last.e <= gapSec) {
            if (it.e > last.e) last.e = it.e;
            last.n++;
        } else {
            blocks.push({ s: it.s, e: it.e, n: 1 });
        }
    }

    var fps = aex__fps(seq), out = [];
    for (var k = 0; k < blocks.length; k++) {
        var b = blocks[k];
        if (b.e - b.s < minLenSec) continue;
        out.push({ start: b.s, end: b.e, clips: b.n, len: b.e - b.s, startTC: aex__tc(b.s, fps), endTC: aex__tc(b.e, fps) });
    }
    return aex__json({ sequence: seq.name, fps: fps, blocks: out, tracks: used.join(", "), hidden: hidden.join(", ") });
}

function aex_pickPreset() {
    var f = File.openDialog("Choose an export preset (.epr)", "Export preset:*.epr");
    return f ? f.fsName : "";
}

function aex_pickFolder() {
    var f = Folder.selectDialog("Choose output folder");
    return f ? f.fsName : "";
}

function aex_pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }

function aex__ext(presetPath) {
    // Ask AME for the right extension; fall back to .mp4
    try {
        var seq = app.project.activeSequence;
        var e = seq.getExportFileExtension(presetPath);
        if (e) return e.charAt(0) === "." ? e : "." + e;
    } catch (err) {}
    return ".mp4";
}

// blocksJson: [{start,end}], selectedIdx: comma-separated indexes to export (empty = all)
function aex_queue(blocksJson, presetPath, outFolder, baseName, startNow) {
    var seq = app.project.activeSequence;
    if (!seq) return aex__json({ error: "No active sequence." });
    if (!presetPath || !File(presetPath).exists) return aex__json({ error: "Preset not found." });
    outFolder = outFolder.replace(/[\\\/]+$/, "");
    if (!outFolder || !Folder(outFolder).exists) return aex__json({ error: "Output folder not found." });

    var blocks = eval("(" + blocksJson + ")");
    var oldIn = seq.getInPointAsTime ? seq.getInPointAsTime() : null;
    var oldOut = seq.getOutPointAsTime ? seq.getOutPointAsTime() : null;
    var ext = aex__ext(presetPath);
    var name = (baseName || seq.name).replace(/[\\\/:*?"<>|]/g, "_");
    var sep = (Folder.fs === "Windows") ? "\\" : "/";

    app.encoder.launchEncoder();
    var queued = 0, errors = [];
    for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        try {
            seq.setInPoint(b.start);
            seq.setOutPoint(b.end);
            var path = outFolder + sep + name + "_" + b.num + ext;
            // 1 = ENCODE_IN_TO_OUT, last arg 1 = remove from queue when done
            var id = app.encoder.encodeSequence(seq, path, presetPath, 1, 1);
            if (id) queued++; else errors.push("Block " + b.num + ": AME refused the job");
        } catch (e) {
            errors.push("Block " + b.num + ": " + e.toString());
        }
    }

    // restore user's in/out
    try {
        if (oldIn) seq.setInPoint(oldIn.seconds);
        if (oldOut) seq.setOutPoint(oldOut.seconds);
    } catch (e2) {}

    if (startNow && queued > 0) app.encoder.startBatch();
    return aex__json({ queued: queued, errors: errors });
}

// Jump playhead + set in/out to preview a block in the timeline
function aex_gotoBlock(start, end) {
    var seq = app.project.activeSequence;
    if (!seq) return "";
    seq.setInPoint(start);
    seq.setOutPoint(end);
    seq.setPlayerPosition(String(Math.round(start * AEX_TICKS)));
    return "ok";
}
