// api/login-efetividade.js
//
// Valida login de Efetividade Operacional usando a aba USUARIOS da planilha.
//
//   A: USUARIO
//   B: SENHA
//   C: LOJAS
//
// Request (POST):
//   { "usuario": "...", "senha": "...", "loja": "ULT 01 - PLANALTINA" }

import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw       = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId       = process.env.SPREADSHEET_ID;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
  console.error("Variáveis de ambiente do Google não configuradas para /api/login-efetividade.");
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email:  serviceAccountEmail,
    key:    privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

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
        "Configuração do Google ausente. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e SPREADSHEET_ID.",
    });
  }

  const { usuario, senha, loja } = req.body || {};

  if (!usuario || !senha || !loja) {
    return res.status(400).json({
      sucesso: false,
      message: "Preencha usuário, senha e loja.",
    });
  }

  try {
    const sheets = await getSheetsClient();

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "USUARIOS!A2:C",
      valueRenderOption: "FORMATTED_VALUE",
    });

    const linhas = resp.data.values || [];

    const usuarioInput = String(usuario).trim().toLowerCase();
    const senhaInput   = String(senha).trim();
    const lojaInput    = String(loja).trim().toLowerCase();

    const encontrou = linhas.find((row) => {
      const [usuarioCol = "", senhaCol = "", lojaCol = ""] = row;
      return (
        String(usuarioCol).trim().toLowerCase() === usuarioInput &&
        String(senhaCol).trim()                  === senhaInput &&
        String(lojaCol).trim().toLowerCase()    === lojaInput
      );
    });

    if (!encontrou) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário, senha ou loja inválidos.",
      });
    }

    return res.status(200).json({
      sucesso: true,
      usuario: usuarioInput,
      loja,
    });
  } catch (erro) {
    console.error("Erro em /api/login-efetividade:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao validar login (Efetividade).",
      detalhe: erro.message || String(erro),
    });
  }
}
