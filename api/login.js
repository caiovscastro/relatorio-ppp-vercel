// api/login.js
import { google } from "googleapis";
import bcrypt from "bcryptjs";
import { createSessionCookie } from "./_authUsuarios.js";

// ✅ ENV com fallback PT-BR (inclui variável com hífen)
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

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

function normLower(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function normUpper(s) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

// Agora lê até G para pegar ATIVO e PRIMEIRO_LOGIN
async function carregarUsuarios() {
  const auth = new google.auth.JWT(
    serviceAccountEmail,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const range = "USUARIOS!A2:G";

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const rows = resp.data.values || [];

  return rows.map((row) => {
    const [loja, usuario, senha, perfil, _id, ativo, primeiroLogin] = row;
    return {
      loja: String(loja || "").trim(),
      usuario: String(usuario || "").trim(),
      senha: String(senha || "").trim(), // hash bcrypt ou texto antigo
      perfil: normUpper(perfil || ""),
      ativo: String(ativo || "SIM").trim().toUpperCase(),
      primeiroLogin: String(primeiroLogin || "NAO").trim().toUpperCase(),
    };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message: "Configuração da API incompleta. Verifique as variáveis de ambiente.",
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
    const senhaInput = String(senha).trim();
    const lojaInput = normLower(loja);

    const usuarios = await carregarUsuarios();

    // 1) encontra por usuário + loja
    const encontrado = usuarios.find((u) =>
      normLower(u.usuario) === usuarioInput && normLower(u.loja) === lojaInput
    );

    if (!encontrado) {
      return res.status(401).json({ sucesso: false, message: "Usuário, senha ou loja inválidos." });
    }

    // 2) bloqueia desativado
    if (String(encontrado.ativo || "SIM").toUpperCase() !== "SIM") {
      return res.status(403).json({
        sucesso: false,
        message: "Usuário desativado. Procure um ADMINISTRADOR.",
      });
    }

    // 3) valida senha (bcrypt ou legado)
    const senhaPlanilha = String(encontrado.senha || "").trim();
    let okSenha = false;

    if (/^\$2[aby]\$\d{2}\$/.test(senhaPlanilha)) {
      okSenha = await bcrypt.compare(senhaInput, senhaPlanilha);
    } else {
      okSenha = (senhaPlanilha === senhaInput);
    }

    if (!okSenha) {
      return res.status(401).json({ sucesso: false, message: "Usuário, senha ou loja inválidos." });
    }

    const perfil = normUpper(encontrado.perfil || "");
    const perfisPermitidos = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];
    if (!perfisPermitidos.includes(perfil)) {
      return res.status(403).json({ sucesso: false, message: "Usuário não habilitado para este acesso." });
    }

    // ✅ Se for primeiro login, cria sessão travada (forcePwdChange)
    const precisaTrocar = (String(encontrado.primeiroLogin || "NAO").toUpperCase() === "SIM");

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
      requirePasswordChange: precisaTrocar
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
