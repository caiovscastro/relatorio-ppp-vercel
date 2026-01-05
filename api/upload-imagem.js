// api/upload-imagem.js
//
// Upload imagem (Firebase Storage)
// ✅ Segurança:
// - Exige sessão válida (cookie HttpOnly)
// - Não confia em loja/usuario do body; usa a sessão (fonte de verdade)
// - Não cachear resposta (no-store)

import admin from "firebase-admin";
import { Buffer } from "buffer";
import crypto from "crypto";
import { requireSession } from "./_authUsuarios.js";

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

const privateKeyRaw = env("GOOGLE_PRIVATE_KEY", "CHAVE_PRIVADA_DO_GOOGLE");
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : "";

const firebaseProjectId = env("FIREBASE_PROJECT_ID");
const firebaseStorageBucket = env("FIREBASE_STORAGE_BUCKET");

function getAdminApp() {
  if (admin.apps.length) return admin.app();

  if (!serviceAccountEmail || !privateKey || !firebaseProjectId) {
    throw new Error(
      "Configuração Firebase/Admin incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e FIREBASE_PROJECT_ID."
    );
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: firebaseProjectId,
      clientEmail: serviceAccountEmail,
      privateKey,
    }),
    storageBucket: firebaseStorageBucket || undefined,
  });
}

function sanitizeName(name) {
  return String(name || "foto.jpg").replace(/[^\w.\-]+/g, "_");
}

function buildFirebaseDownloadUrl(bucket, filePath, token) {
  const encodedPath = encodeURIComponent(filePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${token}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      sucesso: false,
      message: "Método não permitido. Use POST.",
    });
  }

  // ✅ não cachear
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

  // ✅ exige sessão válida
  const session = requireSession(req, res);
  if (!session) return;

  if (!serviceAccountEmail || !privateKey || !firebaseProjectId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração da API incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e FIREBASE_PROJECT_ID.",
      debug: {
        temServiceAccountEmail: !!serviceAccountEmail,
        temPrivateKey: !!privateKey,
        temFirebaseProjectId: !!firebaseProjectId,
        temFirebaseStorageBucket: !!firebaseStorageBucket,
      },
    });
  }

  if (!firebaseStorageBucket) {
    return res.status(500).json({
      sucesso: false,
      message:
        "FIREBASE_STORAGE_BUCKET não configurado. Ex.: ppp-storage.firebasestorage.app",
    });
  }

  try {
    const app = getAdminApp();
    const bucket = admin.storage(app).bucket(firebaseStorageBucket);

    const body = req.body || {};
    const base64Input = String(body.base64 || "").trim();
    const mimeTypeBody = String(body.mimeType || "").trim();
    const filename = sanitizeName(body.filename || "foto.jpg");

    const doc = String(body.doc || "").trim();

    // ✅ fonte de verdade: sessão
    const loja = String(session.loja || "").trim();
    const usuario = String(session.usuario || "").trim();

    if (!base64Input) {
      return res.status(400).json({
        sucesso: false,
        message: "Nenhuma imagem enviada (base64 vazio).",
      });
    }

    const prefixMatch = base64Input.match(/^data:([^;,]+);base64,/i);
    const mimeTypeFromDataUrl = prefixMatch?.[1]?.trim() || "";
    const rawMimeType = mimeTypeBody || mimeTypeFromDataUrl || "image/jpeg";
    const mimeType = rawMimeType.toLowerCase().startsWith("image/")
      ? rawMimeType
      : "image/jpeg";

    const rawBase64 = base64Input.includes(",")
      ? base64Input.substring(base64Input.indexOf(",") + 1)
      : base64Input;

    const base64 = rawBase64.replace(/\s+/g, "");
    const buffer = Buffer.from(base64, "base64");

    if (!buffer.length) {
      return res.status(400).json({
        sucesso: false,
        message: "Imagem inválida. Verifique o arquivo selecionado.",
      });
    }

    if (buffer.length > 4_000_000) {
      return res.status(413).json({
        sucesso: false,
        message:
          "Imagem muito grande. Tire a foto novamente ou selecione uma imagem menor.",
      });
    }

    const ts = Date.now();
    const safeLoja = sanitizeName(loja || "SEM_LOJA");
    const safeUser = sanitizeName(usuario || "SEM_USUARIO");

    const ext = (() => {
      const mt = mimeType.toLowerCase();
      if (mt.includes("png")) return "png";
      if (mt.includes("gif")) return "gif";
      if (mt.includes("webp")) return "webp";
      return "jpg";
    })();

    const baseName = doc
      ? `${sanitizeName(doc)}_${ts}.${ext}`
      : `PPP_${safeLoja}_${safeUser}_${ts}.${ext}`;

    const filePath = `relatorios/${safeLoja}/${baseName}`;

    const downloadToken =
      (crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const file = bucket.file(filePath);

    await file.save(buffer, {
      resumable: false,
      contentType: mimeType,
      metadata: {
        contentType: mimeType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    const imageUrl = buildFirebaseDownloadUrl(
      firebaseStorageBucket,
      filePath,
      downloadToken
    );

    return res.status(200).json({
      sucesso: true,
      message: "Imagem enviada com sucesso (Firebase Storage).",
      fileId: filePath,
      imageUrl,
      webViewLink: "",
      debug: {
        bucket: firebaseStorageBucket,
        path: filePath,
        contentType: mimeType,
        size: buffer.length,
        filename,
      },
    });
  } catch (erro) {
    console.error("Erro na API /api/upload-imagem (Firebase):", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro ao enviar imagem para o Firebase Storage.",
      detalhe: erro?.message || String(erro),
    });
  }
}
