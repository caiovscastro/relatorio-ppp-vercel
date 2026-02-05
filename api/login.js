// api/login.js
//
// Login PPP
// - Valida usuário, senha e loja na aba USUARIOS
// - Valida perfil permitido
// - Cria sessão (cookie HttpOnly assinado) com expiração em 8 horas
//
// Requer ENV (padrão):
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - SPREADSHEET_ID
// - SESSION_SECRET  (>= 32 chars)
//
// Compatível também com suas ENV em PT-BR:
// - "E-MAIL_DA_CONTA_DE_SERVICO_DO_GOOGLE" (atenção: tem hífen, precisa de colchetes)
// - CHAVE_PRIVADA_DO_GOOGLE
// - ID_DA_PLANILHA
//
// Observações:
// 1) Em DEV (HTTP), cookie Secure pode não gravar. O ajuste disso está no _authUsuarios.js.
// 2) Senha agora pode estar em HASH (bcrypt) na planilha. O login usa bcrypt.compare().

import { google } from "googleapis";
import bcrypt from "bcryptjs";
import { createSessionCookie } from "./_authUsuarios.js";

// ====== LEITURA DAS VARIÁVEIS DE AMBIENTE ======
// ✅ Fallback para suas env vars PT-BR (inclui a que tem hífen)
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

// Conserta as quebras de linha da chave privada (Vercel costuma salvar com \n literal)
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Loga erro de configuração (não derruba automaticamente aqui, porque o handler também valida)
if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
  console.error(
    "[/api/login] Configuração Google incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY/SPREADSHEET_ID (ou as versões PT-BR)."
  );
}

// ====== Helpers de normalização ======
function normLower(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normUpper(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

// ====== FUNÇÃO AUXILIAR: CARREGAR USUÁRIOS DA ABA USUARIOS ======
// Sua aba já está usando A..D no login atual.
// (Obs: sua gestão de usuários usa mais colunas, mas isso não atrapalha.)
async function carregarUsuarios() {
  const auth = new google.auth.JWT(
    serviceAccountEmail,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const range = "USUARIOS!A2:D";

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const rows = resp.data.values || [];

  return rows.map((row) => {
    const [loja, usuario, senha, perfil] = row;
    return {
      loja: String(loja || "").trim(),
      usuario: String(usuario || "").trim(),
      senha: String(senha || "").trim(), // pode ser hash bcrypt ou texto (legado)
      perfil: normUpper(perfil || ""),
    };
  });
}

// ====== HANDLER PRINCIPAL ======
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração da API incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e SPREADSHEET_ID (ou as versões PT-BR).",
    });
  }

  const secret = String(process.env.SESSION_SECRET || "").trim();
  if (!secret || secret.length < 32) {
    return res.status(500).json({
      sucesso: false,
      message:
        "SESSION_SECRET ausente ou fraco. Configure uma string forte (>= 32 caracteres) para habilitar sessão segura.",
    });
  }

  try {
    const { usuario, senha, loja } = req.body || {};

    if (!usuario || !senha || !loja) {
      return res.status(400).json({
        sucesso: false,
        message: "Preencha usuário, senha e loja.",
      });
    }

    // Normaliza inputs
    const usuarioInput = normLower(usuario);
    const senhaInput = String(senha).trim();
    const lojaInput = normLower(loja);

    // Carrega usuários da planilha
    const usuarios = await carregarUsuarios();

    // ✅ Primeiro encontra por USUÁRIO + LOJA
    const encontrado = usuarios.find((u) => {
      const lojaPlanilha = normLower(u.loja);
      const usuarioPlanilha = normLower(u.usuario);
      return usuarioPlanilha === usuarioInput && lojaPlanilha === lojaInput;
    });

    if (!encontrado) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário, senha ou loja inválidos.",
      });
    }

    // ✅ Agora valida senha:
    // - Se a planilha tiver hash bcrypt ($2a$..., $2b$...), usa bcrypt.compare()
    // - Se ainda tiver texto (legado), compara direto (mantém compatibilidade)
    const senhaPlanilha = String(encontrado.senha || "").trim();
    let okSenha = false;

    if (/^\$2[aby]\$\d{2}\$/.test(senhaPlanilha)) {
      // HASH bcrypt
      okSenha = await bcrypt.compare(senhaInput, senhaPlanilha);
    } else {
      // Legado: senha em texto
      okSenha = (senhaPlanilha === senhaInput);
    }

    if (!okSenha) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário, senha ou loja inválidos.",
      });
    }

    // Perfis permitidos
    const perfil = normUpper(encontrado.perfil || "");
    const perfisPermitidos = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];

    if (!perfisPermitidos.includes(perfil)) {
      return res.status(403).json({
        sucesso: false,
        message: "Usuário não habilitado para este acesso.",
      });
    }

    // Cria cookie de sessão (8h)
    createSessionCookie(
      res,
      {
        usuario: encontrado.usuario,
        loja: encontrado.loja,
        perfil,
      },
      { ttlSec: 60 * 60 * 8 }
    );

    return res.status(200).json({
      sucesso: true,
      message: "Login autorizado.",
      usuario: encontrado.usuario,
      loja: encontrado.loja,
      perfil,
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
