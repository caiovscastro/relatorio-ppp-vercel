// api/login.js
//
// Login PPP
// - Valida usuário, senha e loja na aba USUARIOS
// - Valida perfil permitido
// - Cria sessão (cookie HttpOnly assinado) com expiração em 8 horas
//
// Requer ENV:
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - SPREADSHEET_ID
// - SESSION_SECRET  (>= 32 chars)
//
// Observações:
// 1) Em DEV (HTTP), cookie Secure pode não gravar. O ajuste disso está no _authUsuarios.js.
// 2) Hoje a senha está em texto na planilha. Funciona, mas é um risco de segurança.
//    Ideal: armazenar hash (bcrypt) e comparar.

import { google } from "googleapis";
import { createSessionCookie } from "./_authUsuarios.js";

// ====== LEITURA DAS VARIÁVEIS DE AMBIENTE ======
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID;

// Conserta as quebras de linha da chave privada (Vercel costuma salvar com \n literal)
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Loga erro de configuração (não derruba automaticamente aqui, porque o handler também valida)
if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
  console.error(
    "[/api/login] Configuração Google incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e SPREADSHEET_ID."
  );
}

// ====== Helpers de normalização ======
// Evita falhas por espaços duplos, variação de caixa etc.
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
// Espera colunas:
// A=LOJA, B=USUARIO, C=SENHA, D=PERFIL
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

  // Normaliza para comparação consistente
  return rows.map((row) => {
    const [loja, usuario, senha, perfil] = row;
    return {
      loja: String(loja || "").trim(),
      usuario: String(usuario || "").trim(),
      senha: String(senha || "").trim(),
      perfil: normUpper(perfil || ""),
    };
  });
}

// ====== HANDLER PRINCIPAL ======
export default async function handler(req, res) {
  // Protege método
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  // Valida configuração Google
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração da API incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e SPREADSHEET_ID.",
    });
  }

  // ✅ Ajuste crítico: validar SESSION_SECRET antes de tentar criar cookie
  const secret = String(process.env.SESSION_SECRET || "").trim();
  if (!secret || secret.length < 32) {
    return res.status(500).json({
      sucesso: false,
      message:
        "SESSION_SECRET ausente ou fraco. Configure uma string forte (>= 32 caracteres) para habilitar sessão segura.",
    });
  }

  try {
    // Body esperado
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

    // Procura correspondência exata (com normalização)
    const encontrado = usuarios.find((u) => {
      const lojaPlanilha = normLower(u.loja);
      const usuarioPlanilha = normLower(u.usuario);
      const senhaPlanilha = String(u.senha || "").trim();

      return (
        usuarioPlanilha === usuarioInput &&
        senhaPlanilha === senhaInput &&
        lojaPlanilha === lojaInput
      );
    });

    if (!encontrado) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário, senha ou loja inválidos.",
      });
    }

    // Perfis permitidos para este sistema
    const perfil = normUpper(encontrado.perfil || "");
    const perfisPermitidos = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];

    if (!perfisPermitidos.includes(perfil)) {
      return res.status(403).json({
        sucesso: false,
        message: "Usuário não habilitado para este acesso.",
      });
    }

    // ✅ Cria cookie de sessão HttpOnly assinado (8h)
    // Importante: createSessionCookie(res, session, opts)
    createSessionCookie(
      res,
      {
        usuario: encontrado.usuario,
        loja: encontrado.loja,
        perfil,
      },
      { ttlSec: 60 * 60 * 8 } // 8 horas
    );

    // Retorna sucesso para o front.
    // Boa prática alternativa (opcional): retornar só sucesso/message e deixar o front chamar /api/session.
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
