// /api/login-gestor.js
//
// Login GERENTE PPP (painel-gestor.html).
// Valida usuário e senha na aba USUARIOS (planilha EAN) e
// verifica se o PERFIL tem permissão para acessar o PAINEL GERENTE.
//
// Perfis permitidos aqui:
//   - ADMINISTRADOR
//   - GERENTE_PPP
//
// Se usuário existir mas perfil NÃO for permitido, retorna:
//   403 + { sucesso:false, message:"Usuário não habilitado para este acesso." }
//
// Se usuário/senha não baterem com a planilha, retorna:
//   401 + { sucesso:false, message:"Usuário ou senha inválidos." }

import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
  console.error(
    "Configuração Google incompleta em /api/login-gestor. Verifique variáveis de ambiente."
  );
}

// Carrega todos os usuários da aba USUARIOS
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
    const { usuario, senha } = req.body || {};

    if (!usuario || !senha) {
      return res.status(400).json({
        sucesso: false,
        message: "Preencha usuário e senha.",
      });
    }

    const usuarioInput = String(usuario).trim().toLowerCase();
    const senhaInput = String(senha).trim();

    const usuarios = await carregarUsuarios();

    // Aqui NÃO exigimos loja: é login corporativo do gerente
    const encontrado = usuarios.find((u) => {
      const usuarioPlanilha = u.usuario.trim().toLowerCase();
      const senhaPlanilha = u.senha.trim();
      return usuarioPlanilha === usuarioInput && senhaPlanilha === senhaInput;
    });

    if (!encontrado) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário ou senha inválidos.",
      });
    }

    const perfil = (encontrado.perfil || "").toUpperCase();

    // Perfis permitidos para PAINEL GERENTE
    const perfisPermitidos = ["ADMINISTRADOR", "GERENTE_PPP"];

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
      perfil,
      // Se quiser usar futuramente:
      token: null,
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
