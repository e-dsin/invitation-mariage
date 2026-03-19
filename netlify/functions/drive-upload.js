const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const stream = require("stream");

const FOLDER_MAP = {
  once: "Il etait une fois",
  cer:  "Céremonie",
  ck1:  "Cocktail 1",
  ck2:  "Cocktail 2",
};

/* "Il etait une fois" est toujours lecture seule pour tout le monde */
const READ_ONLY = ["once"];

async function getDriveClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

async function getFolderId(drive, folderName) {
  const rootId = process.env.DRIVE_ROOT_FOLDER_ID;
  const res = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`,
    fields: "files(id)",
  });
  return res.data.files.length > 0 ? res.data.files[0].id : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let token, category, fileData, fileName, mimeType;
  try {
    ({ token, category, fileData, fileName, mimeType } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) };
  }

  /* Vérifier JWT */
  let payload;
  try {
    payload = jwt.verify(token, process.env.OTP_SECRET);
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: "Session expirée" }) };
  }

  /* "Il était une fois" — lecture seule pour tout le monde */
  if (READ_ONLY.includes(category)) {
    return { statusCode: 403, body: JSON.stringify({ error: "Cet album est géré par les mariés" }) };
  }

  /* Vérifier le niveau d'accès upload selon catégorie */
  const niveau = payload.niveau || 0;
  const isAdmin = payload.role === "admin";
  if (!isAdmin) {
    if (category === "ck1" && niveau < 2) return { statusCode: 403, body: JSON.stringify({ error: "Accès non autorisé" }) };
    if (category === "ck2" && niveau < 3) return { statusCode: 403, body: JSON.stringify({ error: "Accès non autorisé" }) };
  }

  if (!fileData || !fileName || !mimeType) {
    return { statusCode: 400, body: JSON.stringify({ error: "Fichier manquant" }) };
  }

  /* Nom de l'uploader : prénom de l'invité ou "Admin" */
  const uploaderName = isAdmin ? "Admin" : (payload.prenom || "Invité");

  const folderName = FOLDER_MAP[category];
  if (!folderName) return { statusCode: 400, body: JSON.stringify({ error: "Catégorie invalide" }) };

  try {
    const drive = await getDriveClient();
    const folderId = await getFolderId(drive, folderName);
    if (!folderId) {
      return { statusCode: 404, body: JSON.stringify({ error: "Dossier introuvable. Lancez d'abord drive-setup." }) };
    }

    /* Convertir base64 → stream */
    const buffer = Buffer.from(fileData, "base64");
    const bufStream = new stream.PassThrough();
    bufStream.end(buffer);

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const safeName = `${timestamp}_${uploaderName}_${fileName}`;

    const res = await drive.files.create({
      requestBody: {
        name: safeName,
        parents: [folderId],
        /* description = nom de l'uploader → affiché dans le placeholder et la lightbox */
        description: uploaderName,
      },
      media: {
        mimeType,
        body: bufStream,
      },
      fields: "id,name,description",
    });

    /* Rendre le fichier lisible publiquement via thumbnail */
    await drive.permissions.create({
      fileId: res.data.id,
      requestBody: { role: "reader", type: "anyone" },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        photo: {
          id: res.data.id,
          name: res.data.name,
          uploader: uploaderName,
          thumbnailUrl: `https://drive.google.com/thumbnail?id=${res.data.id}&sz=w400`,
          fullUrl: `https://drive.google.com/uc?export=view&id=${res.data.id}`,
        },
      }),
    };
  } catch (err) {
    console.error("drive-upload error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
