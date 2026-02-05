// api/login.js
//
// Login PPP
// - Valida usuário + loja na aba USUARIOS
// - Bloqueia usuário desativado (coluna F)
// - Suporta senha em hash bcrypt (coluna C) e legado (texto)
// - Identifica primeiro login (coluna G) para exigir troca de senha
// - Cria sessão via cookie HttpOnly assinado (8h)

import { google } from "googleapis";
import bcrypt from "bcryptjs";
import { createSessionCookie } from "./_authUsuarios.js";

// ====== ENV (padrão + fallback PT-BR) ======
const serviceAccountEmail =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
  process.env["E-MAIL_DA_CONTA_DE_SERVICO_DO_GOOGLE"] ||
  process.env.EMAIL_DA_CONTA_DE_SERVICO_DO_GOOGLE ||
  "";

const privateKeyRaw =
  process.env.GOOGLE_PRIVATE_KEY ||
  process.env.CHAVE_PRIVADA_DO_GOOGLE ||
  "";

const spreadsheetId =
  process.env.SPREADSHEET_ID ||
  process.env.ID_DA_PLANILHA ||
  "";

// Corrige \n literal (Vercel)
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// ====== Normalização ======
function normLower(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function normUpper(s) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

// ====== Helpers retry/backoff (Google 500/503/429) ======
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getGoogleStatus(err) {
  // googleapis costuma preencher err.code (number) e/ou err.response.status
  const c = err?.code;
  const s = err?.response?.status;
  const status = Number.isFinite(Number(c)) ? Number(c) : (Number.isFinite(Number(s)) ? Number(s) : null);
  return status;
}

function isTransientGoogleError(status) {
  return status === 429 || status === 500 || status === 503;
}

async function withRetry(fn, { tries = 4, baseMs = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = getGoogleStatus(err);
      if (!isTransientGoogleError(status)) throw err;

      // backoff exponencial com jitter leve
      const wait = Math.round(baseMs * Math.pow(2, i) + Math.random() * 120);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// ====== Carrega usuários (A..G) ======
// A=LOJA, B=USUARIO, C=SENHA, D=PERFIL, E=ID, F=ATIVO, G=PRIMEIRO_LOGIN
async function carregarUsuarios() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const resp = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "USUARIOS!A2:G",
      valueRenderOption: "FORMATTED_VALUE",
    })
  );

  const rows = resp.data.values || [];
  return rows.map((row) => {
    const [loja, usuario, senha, perfil, _id, ativo, primeiroLogin] = row || [];
    return {
      loja: String(loja || "").trim(),
      usuario: String(usuario || "").trim(),
      senha: String(senha || "").trim(),
      perfil: normUpper(perfil || ""),
      ativo: String(ativo || "SIM").trim().toUpperCase(),
      primeiroLogin: String(primeiroLogin || "NAO").trim().toUpperCase(),
    };
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message: "Configuração Google incompleta (ENV).",
    });
  }

  const secret = String(process.env.SESSION_SECRET || "").trim();
  if (!secret || secret.length < 32) {
    return res.status(500).json({
      sucesso: false,
      message: "SESSION_SECRET ausente ou fraco (>= 32 caracteres).",
    });
  }

  try {
    const { usuario, senha, loja } = req.body || {};
    if (!usuario || !senha || !loja) {
      return res.status(400).json({ sucesso: false, message: "Preencha usuário, senha e loja." });
    }

    const usuarioInput = normLower(usuario);
    const lojaInput = normLower(loja);
    const senhaInput = String(senha).trim();

    let usuarios;
    try {
      usuarios = await carregarUsuarios();
    } catch (err) {
      const st = getGoogleStatus(err);
      if (isTransientGoogleError(st)) {
        console.error("[/api/login] Google Sheets instável:", st, err?.message || err);
        return res.status(503).json({
          sucesso: false,
          message: "Instabilidade ao consultar o Google Planilhas. Tente novamente em alguns segundos.",
        });
      }
      throw err;
    }

    const encontrado = usuarios.find(
      (u) => normLower(u.usuario) === usuarioInput && normLower(u.loja) === lojaInput
    );

    if (!encontrado) {
      return res.status(401).json({ sucesso: false, message: "Usuário, senha ou loja inválidos." });
    }

    if (String(encontrado.ativo || "SIM") !== "SIM") {
      return res.status(403).json({
        sucesso: false,
        message: "Usuário desativado. Procure um ADMINISTRADOR.",
      });
    }

    const senhaPlanilha = String(encontrado.senha || "").trim();
    const ehHashBcrypt = /^\$2[aby]\$\d{2}\$/.test(senhaPlanilha);

    const okSenha = ehHashBcrypt
      ? await bcrypt.compare(senhaInput, senhaPlanilha)
      : (senhaPlanilha === senhaInput);

    if (!okSenha) {
      return res.status(401).json({ sucesso: false, message: "Usuário, senha ou loja inválidos." });
    }

    const perfil = normUpper(encontrado.perfil || "");
    const perfisPermitidos = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];
    if (!perfisPermitidos.includes(perfil)) {
      return res.status(403).json({ sucesso: false, message: "Usuário não habilitado para este acesso." });
    }

    // ✅ primeiro login?
    const precisaTrocar = (String(encontrado.primeiroLogin || "NAO") === "SIM");

    // ✅ ÚNICA MUDANÇA FUNCIONAL:
    // se precisa trocar, o cookie já sai "travado" (forcePwdChange)
    createSessionCookie(
      res,
      {
        usuario: encontrado.usuario,
        loja: encontrado.loja,
        perfil,
        forcePwdChange: precisaTrocar
      },
      { ttlSec: 60 * 60 * 8 }
    );

    return res.status(200).json({
      sucesso: true,
      message: precisaTrocar ? "Troca de senha obrigatória." : "Login autorizado.",
      usuario: encontrado.usuario,
      loja: encontrado.loja,
      perfil,
      requirePasswordChange: precisaTrocar,
    });

  } catch (erro) {
    console.error("[/api/login] Erro:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao validar login.",
      detalhe: erro?.message || String(erro),
    });
  }
}
