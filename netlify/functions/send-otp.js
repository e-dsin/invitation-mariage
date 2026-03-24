const { google } = require("googleapis");
const twilio = require("twilio");

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const OTP_VALIDITY_MS = 10 * 60 * 1000;

function generateOTP() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function findGuestByPhone(sheets, phone) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Invités!A:L",
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const tel = (row[1] || "").replace(/\s/g, "");
    if (tel === phone) {
      return { rowIndex: i + 1, prenom: row[0], niveau: parseInt(row[2]) || 1, phone: row[1] };
    }
  }
  return null;
}

async function findGuestByToken(sheets, token) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Invités!A:L",
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if ((row[11] || "") === token) {
      return { rowIndex: i + 1, prenom: row[0], niveau: parseInt(row[2]) || 1, phone: row[1] };
    }
  }
  return null;
}

async function writeOTP(sheets, rowIndex, otp) {
  const expires = Date.now() + OTP_VALIDITY_MS;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Invités!D${rowIndex}:E${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[otp, expires.toString()]] },
  });
}

async function sendSMS(to, prenom, otp) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_SMS_FROM,
    to: to,
    body: `Bonjour ${prenom} 🌸\n\nVotre code d'accès à l'invitation de Lynda & Marcel-Cédric :\n\n${otp}\n\nCe code est valable 10 minutes.`,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let phone, guestToken;
  try { ({ phone, guestToken } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  try {
    const sheets = await getSheetsClient();
    let guest = null;

    if (guestToken) {
      guest = await findGuestByToken(sheets, guestToken);
      if (!guest) return { statusCode: 404, body: JSON.stringify({ error: "Lien d'invitation invalide." }) };
    } else if (phone) {
      const cleanPhone = phone.replace(/\s/g, "");
      if (!/^\+[1-9]\d{6,14}$/.test(cleanPhone)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Numéro invalide." }) };
      }
      guest = await findGuestByPhone(sheets, cleanPhone);
      if (!guest) return { statusCode: 404, body: JSON.stringify({ error: "Ce numéro n'est pas dans la liste des invités." }) };
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "Paramètre manquant." }) };
    }

    const otp = generateOTP();
    await writeOTP(sheets, guest.rowIndex, otp);
    await sendSMS(guest.phone, guest.prenom, otp);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, prenom: guest.prenom, message: `Code SMS envoyé à ${guest.prenom}` }),
    };
  } catch (err) {
    console.error("send-otp error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur. Réessayez dans quelques instants." }) };
  }
};
