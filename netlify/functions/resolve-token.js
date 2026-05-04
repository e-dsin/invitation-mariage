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

async function findGuestByToken(sheets, token) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Invités!A:R",
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    /* Col L (index 11) = guest_token */
    if ((row[11] || "") === token) {
      return {
        rowIndex: i + 1,
        prenom:   row[0] || "",
        phone:    row[1] || "",
        niveau:   parseInt(row[2]) || 1,
        firstClick: row[14] || "",
        storedIp:   row[15] || "",
      };
    }
  }
  return null;
}

async function recordFirstClick(sheets, rowIndex, ip) {
  const now = new Date().toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
  /* Col O (index 14) = timestamp_first_click, Col P (index 15) = adr_ip */
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Invités!O${rowIndex}:P${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[now, ip]] },
  });
}

async function logIpCheck(sheets, rowIndex, ip, status) {
  /* Col Q=ip_log(16), R=count(17), S=table(18), T=ip_status(19) */
  const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Invités!Q${rowIndex}:T${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[now + " — " + ip, "", "", status]] },
  });
}

/* Géolocalisation IP via ip-api.com (gratuit, pas de clé nécessaire) */
async function geolocate(ip) {
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=lat,lon,status`);
    const data = await res.json();
    if (data.status === "success") return { lat: data.lat, lon: data.lon };
  } catch (e) { console.warn("geolocate error:", e.message); }
  return null;
}

/* Distance Haversine en mètres */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getClientIp(event) {
  return (event.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || event.headers["x-real-ip"]
    || "unknown";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let guestToken;
  try { ({ guestToken } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  if (!guestToken) return { statusCode: 400, body: JSON.stringify({ error: "Token manquant" }) };

  try {
    const sheets = await getSheetsClient();
    const guest = await findGuestByToken(sheets, guestToken);

    if (!guest) {
      return { statusCode: 404, body: JSON.stringify({ error: "Lien d'invitation invalide. Veuillez contacter les mariés." }) };
    }

    const clientIp = getClientIp(event);

    /* ── Sécurité IP (Changement 4) ── */
    if (!guest.storedIp) {
      /* Premier clic → enregistrer IP + timestamp */
      await recordFirstClick(sheets, guest.rowIndex, clientIp);
      await logIpCheck(sheets, guest.rowIndex, clientIp, "green");
    } else {
      /* Clics suivants → comparer géographiquement */
      if (clientIp !== guest.storedIp) {
        const [geo1, geo2] = await Promise.all([
          geolocate(guest.storedIp),
          geolocate(clientIp)
        ]);
        if (geo1 && geo2) {
          const dist = haversine(geo1.lat, geo1.lon, geo2.lat, geo2.lon);
          const status = dist > 100 ? "red" : "orange";
          await logIpCheck(sheets, guest.rowIndex, clientIp, status);
          if (dist > 100) {
            console.warn(`IP change >100m for ${guest.prenom}: ${dist.toFixed(0)}m`);
            /* Accès autorisé mais loggé rouge */
          }
        } else {
          await logIpCheck(sheets, guest.rowIndex, clientIp, "orange");
        }
      } else {
        await logIpCheck(sheets, guest.rowIndex, clientIp, "green");
      }
    }

    /* Générer JWT 24h */
    const token = jwt.sign(
      { prenom: guest.prenom, phone: guest.phone, niveau: guest.niveau, guestToken },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        prenom:  guest.prenom,
        niveau:  guest.niveau,
        token,
      }),
    };
  } catch (err) {
    console.error("resolve-token error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur." }) };
  }
};
