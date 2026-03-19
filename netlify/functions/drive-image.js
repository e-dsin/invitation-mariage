const { google } = require("googleapis");
const jwt = require("jsonwebtoken");

async function getDriveClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };

  /* Accepte GET ?id=FILE_ID&token=JWT ou POST { id, token } */
  let fileId, token;
  if (event.httpMethod === "GET") {
    fileId = event.queryStringParameters && event.queryStringParameters.id;
    token  = event.queryStringParameters && event.queryStringParameters.token;
  } else {
    try { ({ id: fileId, token } = JSON.parse(event.body)); }
    catch { return { statusCode: 400, body: "Corps invalide" }; }
  }

  if (!fileId || !token) {
    return { statusCode: 400, body: "Paramètres manquants" };
  }

  /* Vérifier JWT */
  try {
    jwt.verify(token, process.env.OTP_SECRET);
  } catch {
    return { statusCode: 401, body: "Session expirée" };
  }

  try {
    const drive = await getDriveClient();

    /* Récupérer les métadonnées pour connaître le mimeType */
    const meta = await drive.files.get({
      fileId,
      fields: "mimeType,size",
    });

    const mimeType = meta.data.mimeType || "image/jpeg";

    /* Télécharger le contenu du fichier */
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );

    const buffer = Buffer.from(res.data);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=3600",
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("drive-image error:", err.message);
    return { statusCode: 500, body: err.message };
  }
};
