// api/upload-imagem.js
// Faz upload de uma imagem (opcional da ocorrência) para uma pasta do Google Drive
// e retorna um link direto da imagem.
//
// Por que usamos base64?
// - Evita dependências extras (multipart/form-data) no seu projeto atual.
// - Mas exige compressão no CLIENTE para não bater o limite de 4.5MB na Vercel. :contentReference[oaicite:8]{index=8}
//
// Variáveis de ambiente (Vercel):
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - DRIVE_PPP_FOLDER_ID   (NOVA)  <-- criar com o ID da pasta imagens_ppp

import { google } from "googleapis";
import { Readable } from "stream";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const driveFolderId = process.env.DRIVE_PPP_FOLDER_ID;

// Conserta quebras de linha da chave privada (vem com "\n" e precisa ser newline de verdade)
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Auth da Service Account com escopo do Drive (criar arquivo + permissão)
const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  [
    "https://www.googleapis.com/auth/drive",
  ]
);

const drive = google.drive({ version: "v3", auth });

function sanitizeName(name) {
  return String(name || "foto.jpg").replace(/[^\w.\-]+/g, "_");
}

export default async function handler(req, res) {
  // Só aceitamos POST
  if (req.method !== "POST") {
    return res.status(405).json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  // Valida variáveis
  if (!serviceAccountEmail || !privateKey || !driveFolderId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração da API incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e DRIVE_PPP_FOLDER_ID.",
    });
  }

  try {
    const body = req.body || {};
    const base64 = String(body.base64 || "").trim();
    const mimeType = String(body.mimeType || "image/jpeg").trim();
    const filename = sanitizeName(body.filename || "foto.jpg");

    // Metadados opcionais (não obrigatórios)
    const doc = String(body.doc || "").trim();
    const loja = String(body.loja || "").trim();
    const usuario = String(body.usuario || "").trim();

    if (!base64) {
      return res.status(400).json({
        sucesso: false,
        message: "Nenhuma imagem enviada (base64 vazio).",
      });
    }

    // Decodifica base64 -> Buffer
    const buffer = Buffer.from(base64, "base64");

    // Guard-rail: evita request grande demais na Vercel
    // (A Vercel tem limite de payload 4.5MB) :contentReference[oaicite:9]{index=9}
    if (buffer.length > 3_800_000) {
      return res.status(413).json({
        sucesso: false,
        message:
          "Imagem muito grande. Tire a foto novamente ou use uma imagem menor (o app já comprime, mas esta excedeu o limite).",
      });
    }

    // Nome final no Drive (organizado por DOC quando existir)
    const ts = Date.now();
    const nomeDrive = sanitizeName(doc ? `${doc}_${ts}.jpg` : `PPP_${loja}_${usuario}_${ts}.jpg`);

    // Upload no Drive
    // - parents: pasta destino
    // - fields: traz links úteis
    const createResp = await drive.files.create({
      requestBody: {
        name: nomeDrive,
        parents: [driveFolderId],
        mimeType: mimeType,
      },
      media: {
        mimeType: mimeType,
        body: Readable.from(buffer),
      },
      fields: "id, webViewLink, webContentLink",
    });

    const fileId = createResp?.data?.id;
    const webViewLink = createResp?.data?.webViewLink || "";

    if (!fileId) {
      return res.status(500).json({
        sucesso: false,
        message: "Falha ao criar arquivo no Drive (sem fileId).",
      });
    }

    // Permissão pública para "link direto" funcionar (anyone reader). :contentReference[oaicite:10]{index=10}
    // Se você quiser restringir, este é o ponto a ajustar (mas aí o link pode não abrir para todos).
    await drive.permissions.create({
      fileId,
      requestBody: {
        type: "anyone",
        role: "reader",
      },
    });

    // Link direto (visualização)
    // Observação: Drive tem variações; este padrão costuma funcionar bem para imagem.
    const directViewUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    return res.status(200).json({
      sucesso: true,
      message: "Imagem enviada com sucesso.",
      fileId,
      imageUrl: directViewUrl,
      webViewLink,
    });
  } catch (erro) {
    console.error("Erro na API /api/upload-imagem:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro ao enviar imagem para o Drive.",
      detalhe: erro.message,
    });
  }
}
