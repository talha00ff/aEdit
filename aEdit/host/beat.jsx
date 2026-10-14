/* aEdit · Beat Marker tab — host script (ExtendScript / ES3)
   Reads the selected music clip and writes beat markers onto its clip (project item) markers.
   Marker name = beat number in the bar ("1".."4"), colour per beat; Beat Edit reads these. */

var ABM_TAG = "aEdit beat";

function abm_secs(t) {
    if (t === undefined || t === null) return 0;
    if (typeof t === "number") return t;
    if (t.seconds !== undefined) return Number(t.seconds);
    return parseFloat(t);
}
function abm_q(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }

function abm_selectedAudio() {
    var seq = app.project.activeSequence;
    if (!seq) return null;
    var sel = seq.getSelection();
    for (var i = 0; i < sel.length; i++) if (sel[i].mediaType === "Audio" && sel[i].projectItem) return sel[i];
    return null;
}

/* {"path","name","inP","outP"} of the selected music clip */
function abm_audioInfo() {
    try {
        if (!app.project.activeSequence) return '{"error":"No active sequence."}';
        var ti = abm_selectedAudio();
        if (!ti) return '{"error":"Select the music clip on the timeline (the audio clip)."}';
        var path = "";
        try { path = ti.projectItem.getMediaPath(); } catch (e) {}
        if (!path) return '{"error":"Could not read the music file."}';
        return '{"path":' + abm_q(path) + ',"name":' + abm_q(ti.projectItem.name) +
               ',"inP":' + abm_secs(ti.inPoint) + ',"outP":' + abm_secs(ti.outPoint) + '}';
    } catch (err) { return '{"error":' + abm_q(err.toString()) + '}'; }
}

/* remove markers inside the clip's used range; onlyOurs = 1 keeps markers made by other tools */
function abm_clear(ti, onlyOurs) {
    var pm = ti.projectItem.getMarkers(), a = abm_secs(ti.inPoint) - 0.001, b = abm_secs(ti.outPoint) + 0.001;
    var kill = [], m = pm.getFirstMarker();
    while (m) {
        var t = abm_secs(m.start);
        if (t >= a && t <= b && (!onlyOurs || m.comments === ABM_TAG)) kill.push(m);
        m = pm.getNextMarker(m);
    }
    for (var i = 0; i < kill.length; i++) { try { pm.deleteMarker(kill[i]); } catch (e) {} }
    return kill.length;
}

/* data = "t,beat,colour;t,beat,colour;..." (t in source seconds). replaceAll = 1 also removes other markers in range */
function abm_create(data, replaceAll) {
    try {
        var ti = abm_selectedAudio();
        if (!ti) return "ERROR: Select the music clip on the timeline.";
        var removed = abm_clear(ti, Number(replaceAll) === 1 ? 0 : 1);
        var pm = ti.projectItem.getMarkers(), parts = String(data).split(";"), made = 0, colFail = 0;
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].split(",");
            if (p.length < 3) continue;
            var t = Number(p[0]);
            var m = pm.createMarker(t);
            if (!m) continue;
            try { m.name = p[1]; } catch (e1) {}
            try { m.comments = ABM_TAG; } catch (e2) {}
            try { m.setColorByIndex(Number(p[2])); } catch (e3) { colFail++; }
            made++;
        }
        return "OK|" + made + "|" + removed + "|" + colFail;
    } catch (err) { return "ERROR: " + err.toString(); }
}

function abm_remove() {
    try {
        var ti = abm_selectedAudio();
        if (!ti) return "ERROR: Select the music clip on the timeline.";
        return "OK|" + abm_clear(ti, 0);
    } catch (err) { return "ERROR: " + err.toString(); }
}
