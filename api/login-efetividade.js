// /api/login-efetividade.js
//
// Login EFETIVIDADE OPERACIONAL (painel-efetividade.html).
// Valida usuário, senha e loja na aba USUARIOS,
// e verifica se o PERFIL tem permissão para o PAINEL DE EFETIVIDADE.
//
// Perfis permitidos aqui:
//   - ADMINISTRADOR
//   - GERENTE_REGIONAL
//   - BASE_OPERACAO
//
// Se usuário existir mas perfil NÃO for permitido, retorna:
//   403 + { sucesso:false, message:"Usuário não habilitado para este acesso." }
//
// Se usuário/senha/loja não baterem com a planilha, retorna:
//   401 + { sucesso:false, message:"Usuário, senha ou loja inválidos." }

import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
  console.error(
    "Configuração Google incompleta em /api/login-efetividade. Verifique variáveis de ambiente."
  );
}

// Carrega a lista de usuários da aba USUARIOS
async function carregarUsuarios() {
  const auth = new google.auth.JWT(
    serviceAccountEmail,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const range = "USUARIOS!A2:D"; // A=LOJA, B=USUARIO, C=SENHA, D=PERFIL

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const rows = resp.data.values || [];

  return rows.map((row) => {
    const [loja, usuario, senha, perfil] = row;
    return {
      loja: (loja || "").trim(),
      usuario: (usuario || "").trim(),
      senha: (senha || "").trim(),
      perfil: (perfil || "").trim().toUpperCase(),
    };
  });
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
        "Configuração da API incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e SPREADSHEET_ID.",
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

    const usuarioInput = String(usuario).trim().toLowerCase();
    const senhaInput = String(senha).trim();
    const lojaInput = String(loja).trim().toLowerCase();

    const usuarios = await carregarUsuarios();

    // Exige combinação exata de USUARIO + SENHA + LOJA
    const encontrado = usuarios.find((u) => {
      const lojaPlanilha = u.loja.trim().toLowerCase();
      const usuarioPlanilha = u.usuario.trim().toLowerCase();
      const senhaPlanilha = u.senha.trim();

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

    const perfil = (encontrado.perfil || "").toUpperCase();

    // Perfis permitidos para a Efetividade
    const perfisPermitidos = [
      "ADMINISTRADOR",
      "GERENTE_REGIONAL",
      "BASE_OPERACAO",
    ];

    if (!perfisPermitidos.includes(perfil)) {
      return res.status(403).json({
        sucesso: false,
        message: "Usuário não habilitado para este acesso.",
      });
    }

    // LOGIN OK
    return res.status(200).json({
      sucesso: true,
      message: "Login autorizado.",
      usuario: encontrado.usuario,
      loja: encontrado.loja,
      perfil,
    });
  } catch (erro) {
    console.error("Erro em /api/login-efetividade:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao validar login de efetividade.",
      detalhe: erro.message || String(erro),
    });
  }
}
