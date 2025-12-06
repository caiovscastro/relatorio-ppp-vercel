// api/login-gestor.js
// Login específico para o PAINEL GERENTE PPP
// Usa a mesma planilha USUARIOS e valida perfis ADMINISTRADOR / GERENTE_PPP.

import { google } from "googleapis";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido." });
  }

  const { usuario, senha } = req.body || {};

  if (!usuario || !senha) {
    return res
      .status(400)
      .json({ sucesso: false, message: "Usuário e senha são obrigatórios." });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });

    const sheets = google.sheets({ version: "v4", auth });

    const spreadsheetId = process.env.ID_DA_PLANILHA;
    const range = "USUARIOS!A2:D";

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });

    const rows = response.data.values || [];

    const linha = rows.find((r) => (r[0] || "").trim() === usuario.trim());

    if (!linha) {
      return res
        .status(401)
        .json({ sucesso: false, message: "Usuário ou senha inválidos." });
    }

    const senhaPlanilha = (linha[1] || "").trim();
    const lojasStr      = (linha[2] || "").trim();
    const perfil        = (linha[3] || "").trim();

    if (senha !== senhaPlanilha) {
      return res
        .status(401)
        .json({ sucesso: false, message: "Usuário ou senha inválidos." });
    }

    // Perfis permitidos no painel de gerente PPP
    if (perfil !== "ADMINISTRADOR" && perfil !== "GERENTE_PPP") {
      return res.status(403).json({
        sucesso: false,
        message: "Este usuário não tem permissão para acessar o Painel de Gerente PPP."
      });
    }

    // Só uma checagem simples: se tem lojas cadastradas ou TODAS
    const lojasPermitidas = lojasStr || "TODAS";

    return res.status(200).json({
      sucesso: true,
      usuario,
      perfil,
      lojas: lojasPermitidas
    });

  } catch (erro) {
    console.error("Erro em /api/login-gestor:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao validar login de gerente.",
      detalhe: erro.message
    });
  }
}
