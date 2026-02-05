// /api/usuarios-trocar-minha-senha.js
//
// Troca a senha do próprio usuário logado.
// ✅ Regra: ao trocar, remove PRIMEIRO_LOGIN=SIM em TODAS as lojas daquele usuário
// ✅ Atualiza hash (senha global) em TODAS as linhas daquele usuário
// ✅ Reemite cookie removendo forcePwdChange

import bcrypt from "bcryptjs";
import { requireSession, createSessionCookie } from "./_authUsuarios.js";
import { bad, ok, getSheetsClient, SHEET_NAME, spreadsheetId } from "./_usuariosSheet.js";

function nowBR() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function normLower(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return bad(res, 405, "Método não permitido. Use POST.");
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");

    // ✅ Permite esse endpoint mesmo quando a sessão está travada por troca obrigatória
    const s = requireSession(req, res, { allowForcePwdChange: true });
    if (!s) return;

    const { senhaAtual, novaSenha } = req.body || {};
    if (!senhaAtual || !novaSenha) return bad(res, 400, "Preencha senha atual e nova senha.");
    if (String(novaSenha).trim().length < 8) return bad(res, 400, "Nova senha muito curta (mín. 8 caracteres).");

    const usuarioSessao = String(s.usuario || "").trim();
    if (!usuarioSessao) return bad(res, 401, "Sessão inválida. Faça login novamente.");

    const sheets = await getSheetsClient();

    // Lê A2:K para:
    // - encontrar uma linha do usuário (para validar senha atual)
    // - atualizar todas as linhas desse usuário
    const get = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A2:K`,
    });

    const rows = get.data.values || [];
    const userNorm = normLower(usuarioSessao);

    // Encontra a primeira ocorrência do usuário na planilha (qualquer loja)
    const idx0 = rows.findIndex(r => normLower(r?.[1] || "") === userNorm);
    if (idx0 === -1) return bad(res, 404, "Usuário não encontrado na base.");

    // Valida ATIVO apenas na loja da sessão? (opcional)
    // Como seu login já bloqueia por loja, aqui a sessão já é válida.
    // Ainda assim, se quiser bloquear se esta linha estiver desativada:
    // const ativo = String(rows[idx0]?.[5] || "SIM").trim().toUpperCase();
    // if (ativo !== "SIM") return bad(res, 403, "Usuário desativado nesta loja.");

    // ===== valida senha atual (bcrypt ou legado) =====
    const senhaPlanilha = String(rows[idx0]?.[2] || "").trim(); // C
    const senhaAtualIn = String(senhaAtual).trim();

    const ehHashBcrypt = /^\$2[aby]\$\d{2}\$/.test(senhaPlanilha);
    const okSenha = ehHashBcrypt
      ? await bcrypt.compare(senhaAtualIn, senhaPlanilha)
      : (senhaPlanilha === senhaAtualIn);

    if (!okSenha) return bad(res, 401, "Senha atual incorreta.");

    // ===== cria novo hash =====
    const novoHash = await bcrypt.hash(String(novaSenha), 10);

    // ===== lista todas as linhas do usuário para atualizar =====
    const linhas = [];
    for (let i = 0; i < rows.length; i++) {
      if (normLower(rows[i]?.[1] || "") === userNorm) {
        linhas.push(i + 2); // porque começamos em A2
      }
    }

    // ===== batch update: C (hash), G (primeiro login), J/K (auditoria) =====
    const data = [];

    for (const linha of linhas) {
      data.push({ range: `${SHEET_NAME}!C${linha}:C${linha}`, values: [[novoHash]] });     // senha hash
      data.push({ range: `${SHEET_NAME}!G${linha}:G${linha}`, values: [["NAO"]] });       // PRIMEIRO_LOGIN = NAO
      data.push({ range: `${SHEET_NAME}!J${linha}:J${linha}`, values: [[nowBR()]] });     // ULT_RESET_EM
      data.push({ range: `${SHEET_NAME}!K${linha}:K${linha}`, values: [[usuarioSessao]] });// ULT_RESET_POR (auto)
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data },
    });

    // ✅ Reemite cookie removendo o "travamento" (forcePwdChange=false)
    // Mantém loja/perfil atuais da sessão
    createSessionCookie(
      res,
      {
        usuario: usuarioSessao,
        loja: String(s.loja || "").trim(),
        perfil: String(s.perfil || "").trim(),
        forcePwdChange: false
      },
      { ttlSec: 60 * 60 * 8 }
    );

    return ok(res, {
      sucesso: true,
      message: `Senha alterada. Troca obrigatória removida em ${linhas.length} loja(s).`,
      lojasAfetadas: linhas.length
    });

  } catch (e) {
    console.error("usuarios-trocar-minha-senha error:", e);
    return bad(res, 500, "Erro interno ao trocar senha.");
  }
}
