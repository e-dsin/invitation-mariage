const { google } = require("googleapis");
const jwt = require("jsonwebtoken");

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let adminToken;
  try { ({ token: adminToken } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  try {
    const payload = jwt.verify(adminToken, process.env.OTP_SECRET);
    if (payload.role !== "admin") throw new Error("Not admin");
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: "Session admin expirée" }) };
  }

  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Invités!A:L",
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return { statusCode: 200, body: JSON.stringify({ guests: [] }) };

    /* A=prenom B=tel C=niveau D=otp E=expires F=rsvp_presence G=rsvp_regime
       H=rsvp_message I=rsvp_date J=rsvp_ck1 K=rsvp_ck2 L=guest_token */
    const guests = rows.slice(1).map(function(row, i) {
      return {
        index:         i + 2,
        prenom:        row[0] || "",
        telephone:     row[1] || "",
        niveau:        parseInt(row[2]) || 1,
        rsvp_presence: row[5] || "",
        rsvp_regime:   row[6] || "",
        rsvp_message:  row[7] || "",
        rsvp_date:     row[8] || "",
        rsvp_ck1:      row[9] || "",
        rsvp_ck2:      row[10] || "",
        guest_token:   row[11] || "",
      };
    });

    return { statusCode: 200, body: JSON.stringify({ guests }) };
  } catch (err) {
    console.error("admin-list-guests error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Erreur lecture Sheets" }) };
  }
};
