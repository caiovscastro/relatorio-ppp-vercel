// api/upload-imagem.js
// Upload de imagem para Google Drive (pasta imagens_ppp) e retorno do link direto.
//
// CORREÇÃO PRINCIPAL:
// - O upload é feito pela SERVICE ACCOUNT.
// - Depois transferimos a PROPRIEDADE para o seu e-mail (owner),
//   para a imagem "aparecer" corretamente na sua pasta no Drive.
//
// Variáveis de ambiente (Vercel):
// - E-MAIL DA CONTA DE SERVIÇO DO GOOGLE   (ou GOOGLE_SERVICE_ACCOUNT_EMAIL)
// - CHAVE_PRIVADA_DO_GOOGLE                (ou GOOGLE_PRIVATE_KEY)
// - ID_DA_PASTA_PPP_DA_UNIDADE
// - E-MAIL_DO_PROPRIETÁRIO_DO_MOTORISTA    (seu e-mail dono do Drive)
//   (opcional alternativo recomendado: DRIVE_OWNER_EMAIL)

import { google } from "googleapis";
import { Readable } from "stream";

export const config = {
  api: {
    bodyParser: { sizeLimit: "6mb" },
  },
};

// Helper: lê env por lista de nomes possíveis (robusto contra variações)
function readEnv(...names) {
  for (const n of names) {
    // process.env["NOME"] para suportar nomes com espaços/hífens
    const v = process.env[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

// Lê conforme sua Vercel (e também aceita nomes "limpos" caso você padronize depois)
const serviceAccountEmail = readEnv(
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "E-MAIL DA CONTA DE SERVIÇO DO GOOGLE",         // como pode aparecer em alguns projetos
  "E-MAIL_DA_CONTA_DE_SERVIÇO_DO_GOOGLE",         // variação comum
  "E-MAIL_DA_CONTA_DE_SERVICO_DO_GOOGLE"          // sem acento
);

const privateKeyRaw = readEnv(
  "GOOGLE_PRIVATE_KEY",
  "CHAVE_PRIVADA_DO_GOOGLE"
);

// Sua pasta (já está ok no print)
const driveFolderId = readEnv(
  "ID_DA_PASTA_PPP_DA_UNIDADE"
);

// Seu e-mail dono (no print está com hífens e acento)
const driveOwnerEmail = readEnv(
  "DRIVE_OWNER_EMAIL",                 // alternativo recomendado (limpo)
  "E-MAIL_DO_PROPRIETÁRIO_DO_MOTORISTA", // EXATAMENTE como está na Vercel (com hífen/acento)
  "E-MAIL_DO_PROPRIETARIO_DO_MOTORISTA"  // fallback sem acento (caso a Vercel normalize)
);

// Corrige quebras de linha da chave privada
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Auth Drive
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

  // Valida config
  if (!serviceAccountEmail || !privateKey || !driveFolderId || !driveOwnerEmail) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração incompleta. Verifique as variáveis do Drive (service account, chave, pasta e e-mail do proprietário).",
      debug: {
        temServiceEmail: !!serviceAccountEmail,
        temPrivateKey: !!privateKey,
        temFolderId: !!driveFolderId,
        temOwnerEmail: !!driveOwnerEmail,
        folderIdLido: driveFolderId || null,
        ownerEmailLido: driveOwnerEmail || null,
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

    // Limite defensivo para evitar payload enorme
    if (buffer.length > 4_000_000) {
      return res.status(413).json({
        sucesso: false,
        message: "Imagem muito grande. Tire novamente em resolução menor.",
      });
    }

    const ts = Date.now();
    const nomeDrive = sanitizeName(doc ? `${doc}_${ts}.jpg` : `PPP_${loja}_${usuario}_${ts}.jpg`);

    // 1) Cria arquivo na pasta (owner inicial: service account)
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
      fields: "id, name, parents, webViewLink",
    });

    const fileId = createResp?.data?.id;
    if (!fileId) {
      return res.status(500).json({ sucesso: false, message: "Falha ao criar arquivo no Drive (sem fileId)." });
    }

    // 2) Permissão pública (mantenho como você vinha fazendo)
    await drive.permissions.create({
      fileId,
      requestBody: { type: "anyone", role: "reader" },
    });

    // 3) Transfere propriedade para o seu e-mail (faz aparecer corretamente no seu Drive)
    // Observação: em alguns domínios Workspace, isso pode ser bloqueado por política.
    await drive.permissions.create({
      fileId,
      sendNotificationEmail: false,
      transferOwnership: true,
      requestBody: {
        type: "user",
        role: "owner",
        emailAddress: driveOwnerEmail,
      },
    });

    const directViewUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    return res.status(200).json({
      sucesso: true,
      message: "Imagem enviada e propriedade transferida com sucesso.",
      fileId,
      imageUrl: directViewUrl,
      webViewLink: createResp?.data?.webViewLink || "",
      parents: createResp?.data?.parents || [],
      folderIdEsperado: driveFolderId,
      ownerEmail: driveOwnerEmail,
      nomeDrive,
    });
  } catch (erro) {
    console.error("Erro na API /api/upload-imagem:", erro);
    return res.status(500).json({
      sucesso: false,
      message:
        "Erro ao enviar imagem para o Drive. Se a transferência de propriedade estiver bloqueada, o erro virá aqui no 'detalhe'.",
      detalhe: erro.message,
    });
  }
}
