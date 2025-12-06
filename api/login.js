// api/login.js
// Endpoint de login PPP (ADMINISTRADOR, GERENTE_PPP, BASE_PPP)
// Usa a aba USUARIOS da planilha definida em ID_DA_PLANILHA.

import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// Cria o cliente do Google Sheets usando as MESMAS variáveis
// que você já configurou na Vercel:
async function getSheetsClient() {
  // ATENÇÃO: aqui usamos exatamente os nomes que aparecem na Vercel
  const clientEmail = process.env["E-MAIL DA CONTA DE SERVIÇO DO GOOGLE"];
  const privateKeyRaw = process.env["CHAVE_PRIVADA_DO_GOOGLE"];

  if (!clientEmail || !privateKeyRaw) {
    console.error("Variáveis de credencial não configuradas corretamente.");
    throw new Error("Credenciais do Google não configuradas.");
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

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
      console.error("ID_DA_PLANILHA não configurado na Vercel.");
      throw new Error("ID_DA_PLANILHA não configurado.");
    }

    // Estrutura esperada:
    // A: USUARIO | B: SENHA | C: LOJAS | D: PERFIL
    const range = "USUARIOS!A2:D";

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });

    const rows = response.data.values || [];

    // Procura o usuário na coluna A
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

    // Perfis que podem acessar o PPP
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
