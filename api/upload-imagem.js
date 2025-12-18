// api/upload-imagem.js
// Faz upload de uma imagem (opcional da ocorrência) para uma pasta do Google Drive
// e retorna um link direto da imagem.
//
// OBJETIVO DESTA VERSÃO:
// - Manter seu fluxo atual intacto (frontend já chama /api/upload-imagem).
// - Resolver o caso "sucesso:true mas não aparece na pasta":
//   1) habilita Shared Drives (supportsAllDrives)
//   2) valida se o arquivo ficou com parent correto
//   3) se não ficou, MOVE o arquivo para a pasta (files.update addParents/removeParents)
//
// Variáveis de ambiente (Vercel):
// - GOOGLE_SERVICE_ACCOUNT_EMAIL (recomendado)
// - GOOGLE_PRIVATE_KEY           (recomendado)
// - ID_DA_PASTA_PPP_DA_UNIDADE   (ID da pasta imagens_ppp)
//
// Observação importante:
// Se sua pasta estiver em "Drive Compartilhado", a Service Account precisa ter acesso adequado.
// Em muitos cenários, "compartilhar só a pasta" não é tão robusto quanto adicionar a SA como membro
// do Shared Drive (com permissão de Conteúdo/Manager).

import { google } from "googleapis";
import { Readable } from "stream";

// Helper para ler ENV com múltiplos nomes possíveis
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

const driveFolderId = env(
  "ID_DA_PASTA_PPP_DA_UNIDADE",
  "DRIVE_PPP_FOLDER_ID"
);

// Conserta \n da private key (Vercel geralmente armazena como string com "\n")
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Auth da Service Account
const auth = new google.auth.JWT(serviceAccountEmail, null, privateKey, [
  "https://www.googleapis.com/auth/drive",
]);

const drive = google.drive({ version: "v3", auth });

function sanitizeName(name) {
  return String(name || "foto.jpg").replace(/[^\w.\-]+/g, "_");
}

// Pequeno helper para montar um direct view link
function driveDirectViewUrl(fileId) {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

// Garante que o arquivo está dentro da pasta desejada.
// Se não estiver, move usando addParents/removeParents.
// (Isso é a diferença crítica versus “apenas criar”)
async function ensureInFolder({ fileId, folderId }) {
  // Lê parents atuais
  const getResp = await drive.files.get({
    fileId,
    fields: "id, parents, driveId, webViewLink",
    supportsAllDrives: true,
  });

  const parents = getResp?.data?.parents || [];
  const jaEstaNaPasta = Array.isArray(parents) && parents.includes(folderId);

  if (jaEstaNaPasta) {
    return {
      moved: false,
      parents,
      driveId: getResp?.data?.driveId || null,
      webViewLink: getResp?.data?.webViewLink || "",
    };
  }

  // Se não estiver, move: adiciona a pasta e remove pais antigos
  // (Se não remover, o arquivo pode ficar em múltiplos lugares dependendo do contexto)
  const removeParents = Array.isArray(parents) && parents.length ? parents.join(",") : "";

  const updateResp = await drive.files.update({
    fileId,
    addParents: folderId,
    removeParents,
    fields: "id, parents, driveId, webViewLink",
    supportsAllDrives: true,
  });

  return {
    moved: true,
    parents: updateResp?.data?.parents || [],
    driveId: updateResp?.data?.driveId || null,
    webViewLink: updateResp?.data?.webViewLink || "",
  };
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

    // 1) Cria arquivo no Drive
    // supportsAllDrives: essencial se pasta estiver em Drive Compartilhado
    const createResp = await drive.files.create({
      requestBody: {
        name: nomeDrive,
        parents: [driveFolderId],
        mimeType, // ok mesmo se nome terminar em .jpg
      },
      media: {
        mimeType,
        body: Readable.from(buffer),
      },
      fields: "id, webViewLink, parents, driveId",
      supportsAllDrives: true,
    });

    const fileId = createResp?.data?.id;
    if (!fileId) {
      return res.status(500).json({
        sucesso: false,
        message: "Falha ao criar arquivo no Drive (sem fileId).",
      });
    }

    // 2) Garante que realmente caiu na pasta desejada (e move se necessário)
    const ensured = await ensureInFolder({
      fileId,
      folderId: driveFolderId,
    });

    // 3) Permissão pública de leitura (para link direto funcionar)
    await drive.permissions.create({
      fileId,
      requestBody: { type: "anyone", role: "reader" },
      supportsAllDrives: true,
    });

    // Link direto para visualização
    const directViewUrl = driveDirectViewUrl(fileId);

    return res.status(200).json({
      sucesso: true,
      message: ensured.moved
        ? "Imagem enviada com sucesso (arquivo foi movido para a pasta configurada)."
        : "Imagem enviada com sucesso.",
      fileId,
      imageUrl: directViewUrl,
      webViewLink: ensured.webViewLink || createResp?.data?.webViewLink || "",
      folderId: driveFolderId,
      nomeDrive,
      debug: {
        parentsDepois: ensured.parents || [],
        driveId: ensured.driveId,
        movedToFolder: ensured.moved,
      },
    });
  } catch (erro) {
    console.error("Erro na API /api/upload-imagem:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro ao enviar imagem para o Drive.",
      detalhe: erro?.message || String(erro),
    });
  }
}
