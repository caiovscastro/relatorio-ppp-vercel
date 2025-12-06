// api/login.js
// Endpoint de login PPP (usado por ADMINISTRADOR, GERENTE_PPP e BASE_PPP)

import { google } from "googleapis";

export default async function handler(req, res) {
  // 1) Garante que apenas o método POST seja aceito
  if (req.method !== "POST") {
    return res.status(405).json({
      sucesso: false,
      message: "Método não permitido. Use POST para acessar este endpoint."
    });
  }

  // 2) Extrai os campos enviados no corpo da requisição
  const { usuario, senha, loja } = req.body || {};

  if (!usuario || !senha || !loja) {
    return res.status(400).json({
      sucesso: false,
      message: "Usuário, senha e loja são obrigatórios."
    });
  }

  try {
    // 3) Autentica na API do Google Sheets com Service Account
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });

    const sheets = google.sheets({ version: "v4", auth });

    // 4) Usa a variável de ambiente com o ID da planilha
    const spreadsheetId = process.env.ID_DA_PLANILHA;
    const range = "USUARIOS!A2:D"; // A: USUARIO, B: SENHA, C: LOJAS, D: PERFIL

    // 5) Lê a aba USUARIOS
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });

    const rows = response.data.values || [];

    // 6) Procura o usuário na coluna A
    const linha = rows.find((r) => (r[0] || "").trim() === usuario.trim());

    if (!linha) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário ou senha inválidos."
      });
    }

    const senhaPlanilha = (linha[1] || "").trim();
    const lojasStr      = (linha[2] || "").trim();
    const perfil        = (linha[3] || "").trim(); // ADMINISTRADOR, GERENTE_PPP, BASE_PPP, etc.

    // 7) Perfis que podem usar o módulo PPP
    const perfisPermitidos = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];

    if (!perfisPermitidos.includes(perfil)) {
      return res.status(403).json({
        sucesso: false,
        message: "Este usuário não tem permissão para acessar o módulo PPP."
      });
    }

    // 8) Valida senha
    if (senha !== senhaPlanilha) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário ou senha inválidos."
      });
    }

    // 9) Valida loja
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

    // 10) Login OK
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
