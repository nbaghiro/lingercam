/* global http, output, EMAIL -- Maestro gives runScript these. */
// Reads the newest sign-in code sent to EMAIL from the local Mailpit.
const list = JSON.parse(
    http.get(`http://localhost:8176/api/v1/search?query=${encodeURIComponent(`to:${EMAIL}`)}`).body,
);
const id = list.messages[0].ID;
const message = JSON.parse(http.get(`http://localhost:8176/api/v1/message/${id}`).body);
output.code = message.Text.match(/\b\d{6}\b/)[0];
