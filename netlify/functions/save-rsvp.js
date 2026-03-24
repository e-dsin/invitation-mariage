const { google } = require("googleapis");
const jwt = require("jsonwebtoken");

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const JWT_SECRET = process.env.OTP_SECRET;

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function findRowByPhone(sheets, phone) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Invités!A:B",
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    const tel = (rows[i][1] || "").replace(/\s/g, "");
    if (tel === phone) return i + 1;
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let token, presence, regime, message, rsvp_ck1, rsvp_ck2;
  try { ({ token, presence, regime, message, rsvp_ck1, rsvp_ck2 } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); }
  catch { return { statusCode: 401, body: JSON.stringify({ error: "Session expirée." }) }; }

  if (!presence || !["oui", "non", "yes", "no"].includes(presence)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Présence invalide" }) };
  }
  if (!message || message.trim().length < 20) {
    return { statusCode: 400, body: JSON.stringify({ error: "Message trop court (20 caractères minimum)" }) };
  }

  const presenceNorm = (presence === "yes" || presence === "oui") ? "oui" : "non";
  const norm = (v) => v ? ((v === "yes" || v === "oui") ? "oui" : "non") : "";

  try {
    const sheets = await getSheetsClient();
    const rowIndex = await findRowByPhone(sheets, payload.phone);
    if (!rowIndex) return { statusCode: 404, body: JSON.stringify({ error: "Invité introuvable" }) };

    const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

    /* F=présence G=régime H=message I=date J=rsvp_ck1 K=rsvp_ck2 */
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Invités!F${rowIndex}:K${rowIndex}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          presenceNorm,
          (regime || []).join(", "),
          message.trim(),
          now,
          norm(rsvp_ck1),
          norm(rsvp_ck2),
        ]],
      },
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, message: "RSVP enregistré avec succès" }) };
  } catch (err) {
    console.error("save-rsvp error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur." }) };
  }
};
