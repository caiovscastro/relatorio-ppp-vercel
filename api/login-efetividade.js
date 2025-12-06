// api/login-efetividade.js
// Login específico para o módulo de EFETIVIDADE OPERACIONAL (Scan&Sell)
// Perfis permitidos: GERENTE_REGIONAL, BASE_OPERACAO, ADMINISTRADOR

import { google } from "googleapis";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  try {
    const { usuario, senha, loja } = req.body || {};

    if (!usuario || !senha || !loja) {
      return res.status(400).json({
        sucesso: false,
        message: "Informe usuário, senha e loja."
      });
    }

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
      return res.status(401).json({
        sucesso: false,
        message: "Usuário ou senha inválidos para Efetividade."
      });
    }

    const senhaPlanilha = (linha[1] || "").trim();
    const lojasStr      = (linha[2] || "").trim();
    const perfil        = (linha[3] || "").trim();

    if (senha !== senhaPlanilha) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário ou senha inválidos para Efetividade."
      });
    }

    // Perfis permitidos na Efetividade
    const perfisPermitidos = ["GERENTE_REGIONAL", "BASE_OPERACAO", "ADMINISTRADOR"];

    if (!perfisPermitidos.includes(perfil)) {
      return res.status(403).json({
        sucesso: false,
        message: "Este usuário não tem permissão para acessar Efetividade."
      });
    }

    // Validação de loja
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
        message: "Acesso não permitido para esta loja na Efetividade."
      });
    }

    // Ok
    return res.status(200).json({
      sucesso: true,
      message: "Login Efetividade autorizado.",
      usuario,
      loja,
      perfil
    });

  } catch (erro) {
    console.error("Erro em /api/login-efetividade:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao validar login de Efetividade.",
      detalhe: erro.message
    });
  }
}
