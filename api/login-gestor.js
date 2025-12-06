// api/login-gestor.js
//
// Login do GERENTE PPP baseado na aba USUARIOS.
//
//   A: USUARIO
//   B: SENHA
//   C: LOJAS (ignorado aqui)
//
// Request (POST):
//   { "usuario": "gaspar.silva", "senha": "842142" }

import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw       = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId       = process.env.SPREADSHEET_ID;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
  console.error("Variáveis de ambiente do Google não configuradas para /api/login-gestor.");
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

  const { usuario, senha } = req.body || {};

  if (!usuario || !senha) {
    return res.status(400).json({
      sucesso: false,
      message: "Preencha usuário e senha.",
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

    const encontrou = linhas.find((row) => {
      const [usuarioCol = "", senhaCol = ""] = row;
      return (
        String(usuarioCol).trim().toLowerCase() === usuarioInput &&
        String(senhaCol).trim()                 === senhaInput
      );
    });

    if (!encontrou) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário ou senha inválidos.",
      });
    }

    return res.status(200).json({
      sucesso: true,
      usuario: usuarioInput,
      token: null, // se quiser, depois colocamos JWT ou algo assim
    });
  } catch (erro) {
    console.error("Erro em /api/login-gestor:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao validar login de gerente.",
      detalhe: erro.message || String(erro),
    });
  }
}
