/* global output, http, json, STEP, COUNT */
// Host-side steps for uploads.yaml, run through the dev-only demo sign-in on the local API.
// STEP=create makes a fresh live event, STEP=end ends it, STEP=arrived waits for photos.
var API = "http://localhost:8171";

function send(method, path, body) {
    var options = { headers: { "Content-Type": "application/json" } };
    if (output.token) options.headers.Authorization = "Bearer " + output.token;
    if (body !== undefined) options.body = JSON.stringify(body);
    var res = method === "GET" ? http.get(API + path, options) : http.post(API + path, options);
    if (res.ok === false || res.status >= 400) {
        throw new Error(method + " " + path + " returned " + res.status + ": " + res.body);
    }
    return res.body ? json(res.body) : {};
}

if (STEP === "create") {
    output.token = send("POST", "/v1/auth/demo").session;
    var now = Date.now();
    var created = send("POST", "/v1/events", {
        occasion: "party",
        title: "Upload check",
        startsAt: new Date(now - 60000).toISOString(),
        endsAt: new Date(now + 3600000).toISOString(),
        timeZone: "America/Vancouver",
        revealMode: "at-end",
        shotsPerGuest: 5,
        visibility: "everyone",
        look: "warm-98@1",
    }).event;
    send("POST", "/v1/events/" + created.id + "/live");
    output.id = created.id;
    output.code = created.code;
} else if (STEP === "end") {
    send("POST", "/v1/events/" + output.id + "/end");
} else if (STEP === "arrived") {
    var want = parseInt(COUNT, 10);
    var deadline = Date.now() + 30000;
    var total = 0;
    while (Date.now() < deadline) {
        total = send("GET", "/v1/e/" + output.code + "/gallery").total;
        if (total >= want) break;
    }
    if (total < want) throw new Error("Expected " + want + " photos on the server, got " + total);
}
