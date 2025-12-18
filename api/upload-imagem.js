// api/upload-imagem.js
// Faz upload de uma imagem (opcional da ocorrência) para uma pasta do Google Drive
// e retorna um link direto da imagem.
//
// Observações importantes:
// 1) A pasta de destino (imagens_ppp) PRECISA estar compartilhada com o e-mail da Service Account
//    (GOOGLE_SERVICE_ACCOUNT_EMAIL), senão o upload para "parents: [folderId]" falha.
// 2) Envio via base64 pode estourar limite de payload. No Next.js, ajuste sizeLimit do bodyParser.
//
// Variáveis de ambiente (Vercel):
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - ID_DA_PASTA_PPP_DA_UNIDADE   <-- (SEU NOME REAL NA VERCEL)

import { google } from "googleapis";
import { Readable } from "stream";

// AUMENTA o limite do bodyParser (se seu projeto for Next.js API Routes).
// Se não for Next, isso não atrapalha.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "5mb",
    },
  },
};

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;

// >>> AQUI está a correção do nome da variável <<<
const driveFolderId = process.env.ID_DA_PASTA_PPP_DA_UNIDADE;

// Conserta quebras de linha da chave privada (vem com "\n" e precisa virar newline real)
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Auth da Service Account com escopo do Drive (criar arquivo + permissões)
const auth = new google.auth.JWT(serviceAccountEmail, null, privateKey, [
  "https://www.googleapis.com/auth/drive",
]);

const drive = google.drive({ version: "v3", auth });

function sanitizeName(name) {
  return String(name || "foto.jpg").replace(/[^\w.\-]+/g, "_");
}

export default async function handler(req, res) {
  // Só POST
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  // Valida variáveis
  if (!serviceAccountEmail || !privateKey || !driveFolderId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração da API incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e ID_DA_PASTA_PPP_DA_UNIDADE.",
      debug: {
        temEmail: !!serviceAccountEmail,
        temChave: !!privateKey,
        temFolderId: !!driveFolderId,
      },
    });
  }

  try {
    const body = req.body || {};
    const base64 = String(body.base64 || "").trim();
    const mimeType = String(body.mimeType || "image/jpeg").trim();
    const filename = sanitizeName(body.filename || "foto.jpg");

    // Metadados opcionais
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

    // Guard-rail para payload
    if (buffer.length > 3_800_000) {
      return res.status(413).json({
        sucesso: false,
        message:
          "Imagem muito grande. Tire a foto novamente ou use uma imagem menor.",
      });
    }

    // Nome no Drive (organizado por DOC quando existir)
    const ts = Date.now();
    const nomeDrive = sanitizeName(
      doc ? `${doc}_${ts}.jpg` : `PPP_${loja}_${usuario}_${ts}.jpg`
    );

    // Upload no Drive dentro da pasta (parents)
    // Referência: files.create + parents :contentReference[oaicite:4]{index=4}
    const createResp = await drive.files.create({
      requestBody: {
        name: nomeDrive,
        parents: [driveFolderId],
        mimeType,
      },
      media: {
        mimeType,
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

    // Permissão pública (anyone reader) para o link abrir para qualquer pessoa.
    // Referência: permissions.create :contentReference[oaicite:5]{index=5}
    await drive.permissions.create({
      fileId,
      requestBody: {
        type: "anyone",
        role: "reader",
      },
    });

    // Link direto (visualização)
    const directViewUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    return res.status(200).json({
      sucesso: true,
      message: "Imagem enviada com sucesso.",
      fileId,
      imageUrl: directViewUrl,
      webViewLink,
      filenameOriginal: filename,
      nomeDrive,
    });
  } catch (erro) {
    console.error("Erro na API /api/upload-imagem:", erro);

    // Dica diagnóstica comum: pasta não compartilhada com service account
    return res.status(500).json({
      sucesso: false,
      message:
        "Erro ao enviar imagem para o Drive. Verifique se a pasta do Drive foi compartilhada com o e-mail da Service Account (como editor) e se o ID da pasta está correto.",
      detalhe: erro.message,
    });
  }
}
