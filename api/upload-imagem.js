// api/upload-imagem.js
// Faz upload de uma imagem (opcional da ocorrência) para uma pasta do Google Drive
// e retorna um link direto da imagem.
//
// Variáveis de ambiente (Vercel) — alinhado com o que está na sua Vercel:
// - E-MAIL DA CONTA DE SERVIÇO DO GOOGLE   (ou GOOGLE_SERVICE_ACCOUNT_EMAIL)
// - CHAVE_PRIVADA_DO_GOOGLE                (ou GOOGLE_PRIVATE_KEY)
// - ID_DA_PASTA_PPP_DA_UNIDADE             (ID da pasta imagens_ppp)
// - E-MAIL_DO_PROPRIETÁRIO_DO_MOTORISTA    (opcional: só se quiser usar futuramente)

import { google } from "googleapis";
import { Readable } from "stream";

// Helper para ler ENV mesmo quando o nome tiver hífen/espaço/acentos
function env(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

const serviceAccountEmail = env(
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "E-MAIL DA CONTA DE SERVIÇO DO GOOGLE",
  "E-MAIL_DA_CONTA_DE_SERVIÇO_DO_GOOGLE",
  "E-MAIL_DA_CONTA_DE_SERVICO_DO_GOOGLE"
);

const privateKeyRaw = env(
  "GOOGLE_PRIVATE_KEY",
  "CHAVE_PRIVADA_DO_GOOGLE"
);

// ✅ Sua Vercel está assim:
const driveFolderId = env(
  "ID_DA_PASTA_PPP_DA_UNIDADE",
  "DRIVE_PPP_FOLDER_ID"
);

// Conserta quebras de linha da chave privada (vem com "\n" e precisa virar newline real)
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Auth da Service Account com escopo do Drive
const auth = new google.auth.JWT(serviceAccountEmail, null, privateKey, [
  "https://www.googleapis.com/auth/drive",
]);

const drive = google.drive({ version: "v3", auth });

function sanitizeName(name) {
  return String(name || "foto.jpg").replace(/[^\w.\-]+/g, "_");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      sucesso: false,
      message: "Método não permitido. Use POST.",
    });
  }

  // Valida variáveis
  if (!serviceAccountEmail || !privateKey || !driveFolderId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração da API incompleta. Verifique Service Account, chave privada e ID_DA_PASTA_PPP_DA_UNIDADE.",
      debug: {
        temServiceAccountEmail: !!serviceAccountEmail,
        temPrivateKey: !!privateKey,
        temDriveFolderId: !!driveFolderId,
        driveFolderIdLido: driveFolderId || null,
      },
    });
  }

  try {
    const body = req.body || {};
    const base64 = String(body.base64 || "").trim();
    const mimeType = String(body.mimeType || "image/jpeg").trim();
    const filename = sanitizeName(body.filename || "foto.jpg");

    const doc = String(body.doc || "").trim();
    const loja = String(body.loja || "").trim();
    const usuario = String(body.usuario || "").trim();

    if (!base64) {
      return res.status(400).json({
        sucesso: false,
        message: "Nenhuma imagem enviada (base64 vazio).",
      });
    }

    // base64 -> Buffer
    const buffer = Buffer.from(base64, "base64");

    // Guard-rail: evita request grande demais
    if (buffer.length > 4_000_000) {
      return res.status(413).json({
        sucesso: false,
        message:
          "Imagem muito grande. Tire a foto novamente ou selecione uma imagem menor.",
      });
    }

    // Nome final no Drive (organiza por DOC quando existir)
    const ts = Date.now();
    const nomeDrive = sanitizeName(
      doc ? `${doc}_${ts}.jpg` : `PPP_${loja}_${usuario}_${ts}.jpg`
    );

    // Upload no Drive para a pasta informada
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
      fields: "id, webViewLink",
    });

    const fileId = createResp?.data?.id;
    const webViewLink = createResp?.data?.webViewLink || "";

    if (!fileId) {
      return res.status(500).json({
        sucesso: false,
        message: "Falha ao criar arquivo no Drive (sem fileId).",
      });
    }

    // Permissão pública de leitura (link direto funcionar)
    await drive.permissions.create({
      fileId,
      requestBody: { type: "anyone", role: "reader" },
    });

    // Link direto para visualização
    const directViewUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    return res.status(200).json({
      sucesso: true,
      message: "Imagem enviada com sucesso.",
      fileId,
      imageUrl: directViewUrl,
      webViewLink,
      folderId: driveFolderId,
      nomeDrive,
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
