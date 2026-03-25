const { google } = require("googleapis");

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function nowFR() {
  return new Date().toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let guestToken, evt, pin;
  try { ({ guestToken, event: evt, pin } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  /* Vérifier le PIN scanner */
  if (!pin || pin !== process.env.SCANNER_PIN) {
    return { statusCode: 401, body: JSON.stringify({ error: "PIN invalide" }) };
  }

  if (!guestToken || !["ck1", "ck2"].includes(evt)) {
    return { statusCode: 400, body: JSON.stringify({ status: "invalid" }) };
  }

  try {
    const sheets = await getSheetsClient();

    /* Lire colonnes A:N */
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Invités!A:N",
    });

    const rows = res.data.values || [];
    let rowIndex = -1;
    let guest = null;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if ((row[11] || "") === guestToken) {
        rowIndex = i + 1;
        guest = {
          prenom:        row[0] || "",
          niveau:        parseInt(row[2]) || 1,
          rsvp_presence: (row[5] || "").toLowerCase(),
          rsvp_ck1:      (row[9] || "").toLowerCase(),
          rsvp_ck2:      (row[10] || "").toLowerCase(),
          entry_ck1:     row[12] || "",
          entry_ck2:     row[13] || "",
        };
        break;
      }
    }

    if (!guest) {
      return { statusCode: 200, body: JSON.stringify({ status: "invalid" }) };
    }

    /* Vérifier accès niveau */
    const niveau = guest.niveau;
    if (evt === "ck1" && niveau !== 2 && niveau < 4) {
      return { statusCode: 200, body: JSON.stringify({ status: "unconfirmed", prenom: guest.prenom, reason: "Niveau non autorisé" }) };
    }
    if (evt === "ck2" && niveau !== 3 && niveau < 4) {
      return { statusCode: 200, body: JSON.stringify({ status: "unconfirmed", prenom: guest.prenom, reason: "Niveau non autorisé" }) };
    }

    /* Vérifier RSVP */
    if (guest.rsvp_presence !== "oui") {
      return { statusCode: 200, body: JSON.stringify({ status: "unconfirmed", prenom: guest.prenom, reason: "RSVP non confirmé" }) };
    }

    /* Vérifier si déjà scanné */
    const entryCol = evt === "ck1" ? guest.entry_ck1 : guest.entry_ck2;
    if (entryCol) {
      return {
        statusCode: 200,
        body: JSON.stringify({ status: "already_scanned", prenom: guest.prenom, event: evt, scanned_at: entryCol }),
      };
    }

    /* Enregistrer l'entrée */
    const now = nowFR();
    const col = evt === "ck1" ? `M${rowIndex}` : `N${rowIndex}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Invités!${col}`,
      valueInputOption: "RAW",
      requestBody: { values: [[now]] },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ status: "granted", prenom: guest.prenom, event: evt, scanned_at: now }),
    };

  } catch (err) {
    console.error("check-entry error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};