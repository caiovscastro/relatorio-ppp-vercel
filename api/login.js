// api/login.js
// Endpoint de login PPP (ADMINISTRADOR, GERENTE_PPP, BASE_PPP)
// Valida usuário, senha, loja e perfil usando a aba USUARIOS da planilha.

import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// Cria cliente do Google Sheets usando as MESMAS variáveis de ambiente
// que você já usa nos outros endpoints (service account).
async function getSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : null;

  if (!clientEmail || !privateKey) {
    console.error("Variáveis GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY não configuradas.");
    throw new Error("Credenciais do Google não configuradas.");
  }

  const auth = new google.auth.JWT(clientEmail, null, privateKey, SCOPES);
  await auth.authorize();

  return google.sheets({ version: "v4", auth });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      sucesso: false,
      message: "Método não permitido. Use POST para acessar este endpoint."
    });
  }

  const { usuario, senha, loja } = req.body || {};

  if (!usuario || !senha || !loja) {
    return res.status(400).json({
      sucesso: false,
      message: "Usuário, senha e loja são obrigatórios."
    });
  }

  try {
    const sheets = await getSheetsClient();

    const spreadsheetId = process.env.ID_DA_PLANILHA;
    if (!spreadsheetId) {
      console.error("Variável ID_DA_PLANILHA não configurada.");
      throw new Error("ID da planilha não configurado.");
    }

    // A: USUARIO, B: SENHA, C: LOJAS, D: PERFIL
    const range = "USUARIOS!A2:D";

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });

    const rows = response.data.values || [];

    // Procura usuário
    const linha = rows.find((r) => (r[0] || "").trim() === usuario.trim());

    if (!linha) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário ou senha inválidos."
      });
    }

    const senhaPlanilha = (linha[1] || "").trim();
    const lojasStr      = (linha[2] || "").trim();
    const perfil        = (linha[3] || "").trim();

    // Perfis que podem usar o módulo PPP
    const perfisPermitidos = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];

    if (!perfisPermitidos.includes(perfil)) {
      return res.status(403).json({
        sucesso: false,
        message: "Este usuário não tem permissão para acessar o módulo PPP."
      });
    }

    // Valida senha
    if (senha !== senhaPlanilha) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário ou senha inválidos."
      });
    }

    // Valida loja
    let temPermissao = false;

    if (lojasStr.toUpperCase() === "TODAS") {
      temPermissao = true;
    } else {
      const lojasPermitidas = lojasStr
        .split("|")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      temPermissao = lojasPermitidas.includes(loja);
    }

    if (!temPermissao) {
      return res.status(403).json({
        sucesso: false,
        message: "Acesso não permitido para esta loja."
      });
    }

    // Login OK
    return res.status(200).json({
      sucesso: true,
      usuario,
      loja,
      perfil
    });
  } catch (erro) {
    console.error("Erro no /api/login:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao validar login."
    });
  }
}
