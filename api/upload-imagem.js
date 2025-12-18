// api/upload-imagem.js
// Upload de imagem para Google Drive (pasta imagens_ppp) e retorno do link direto.
//
// Variáveis Vercel:
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - ID_DA_PASTA_PPP_DA_UNIDADE   (ID da pasta /folders/<ID>)

import { google } from "googleapis";
import { Readable } from "stream";

export const config = {
  api: {
    bodyParser: { sizeLimit: "5mb" },
  },
};

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const driveFolderId = process.env.ID_DA_PASTA_PPP_DA_UNIDADE;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

const auth = new google.auth.JWT(serviceAccountEmail, null, privateKey, [
  "https://www.googleapis.com/auth/drive",
]);

const drive = google.drive({ version: "v3", auth });

function sanitizeName(name) {
  return String(name || "foto.jpg").replace(/[^\w.\-]+/g, "_");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  if (!serviceAccountEmail || !privateKey || !driveFolderId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e ID_DA_PASTA_PPP_DA_UNIDADE.",
      debug: {
        temEmail: !!serviceAccountEmail,
        temChave: !!privateKey,
        temFolderId: !!driveFolderId,
        folderIdLido: driveFolderId || null,
      },
    });
  }

  try {
    const body = req.body || {};
    const base64 = String(body.base64 || "").trim();
    const mimeType = String(body.mimeType || "image/jpeg").trim();
    const doc = String(body.doc || "").trim();
    const loja = String(body.loja || "").trim();
    const usuario = String(body.usuario || "").trim();

    if (!base64) {
      return res.status(400).json({ sucesso: false, message: "Nenhuma imagem enviada (base64 vazio)." });
    }

    const buffer = Buffer.from(base64, "base64");

    if (buffer.length > 3_800_000) {
      return res.status(413).json({
        sucesso: false,
        message: "Imagem muito grande. Tire novamente com qualidade menor.",
      });
    }

    const ts = Date.now();
    const nomeDrive = sanitizeName(doc ? `${doc}_${ts}.jpg` : `PPP_${loja}_${usuario}_${ts}.jpg`);

    // >>> CREATE
    const createResp = await drive.files.create({
      // IMPORTANTÍSSIMO para Shared Drives
      supportsAllDrives: true, // :contentReference[oaicite:1]{index=1}
      requestBody: {
        name: nomeDrive,
        parents: [driveFolderId],
        mimeType,
      },
      media: {
        mimeType,
        body: Readable.from(buffer),
      },
      // Puxa parents para diagnosticar onde foi parar
      fields: "id, name, parents, webViewLink, webContentLink",
    });

    const fileId = createResp?.data?.id;
    if (!fileId) {
      return res.status(500).json({ sucesso: false, message: "Falha ao criar arquivo no Drive (sem fileId)." });
    }

    // >>> GET (confirma parents/metadata real)
    const meta = await drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: "id, name, parents, webViewLink, owners",
    });

    // Permissão pública (se você realmente quer link abrindo para qualquer pessoa)
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: { type: "anyone", role: "reader" },
    }); // :contentReference[oaicite:2]{index=2}

    const directViewUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    return res.status(200).json({
      sucesso: true,
      message: "Imagem enviada com sucesso.",
      fileId,
      imageUrl: directViewUrl,
      webViewLink: meta?.data?.webViewLink || createResp?.data?.webViewLink || "",
      parents: meta?.data?.parents || createResp?.data?.parents || [],
      folderIdEsperado: driveFolderId,
      nomeDrive: meta?.data?.name || nomeDrive,
    });
  } catch (erro) {
    console.error("Erro na API /api/upload-imagem:", erro);
    return res.status(500).json({
      sucesso: false,
      message:
        "Erro ao enviar imagem para o Drive. Se a pasta estiver em Shared Drive, supportsAllDrives é obrigatório. Verifique também se o ID é de /folders/<ID> e não de atalho.",
      detalhe: erro.message,
    });
  }
}
