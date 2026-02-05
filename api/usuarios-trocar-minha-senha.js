// /api/usuarios-trocar-minha-senha.js
//
// Trocar a própria senha (fluxo de primeiro login / senha temporária)
// - Requer sessão válida (cookie assinado)
// - Permite execução mesmo quando forcePwdChange=true
// - Valida senha atual (bcrypt ou legado texto)
// - Atualiza planilha USUARIOS: C (hash), G (PRIMEIRO_LOGIN=NAO), J/K (reset)
// - Recria cookie removendo forcePwdChange

import bcrypt from "bcryptjs";
import { requireSession, createSessionCookie } from "./_authUsuarios.js";
import { bad, ok, getSheetsClient, findRowById, updateRow } from "./_usuariosSheet.js";

function nowBR() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function padToK(row) {
  const out = Array.from(row || []);
  while (out.length < 11) out.push("");
  return out.slice(0, 11);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return bad(res, 405, "Método não permitido. Use POST.");
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");

    // ✅ Sessão obrigatória (permitindo trocar senha mesmo travado)
    const s = requireSession(req, res, { allowForcePwdChange: true });
    if (!s) return;

    const { senhaAtual, novaSenha } = req.body || {};
    const atual = String(senhaAtual || "").trim();
    const nova = String(novaSenha || "").trim();

    if (!atual || !nova) return bad(res, 400, "Preencha a senha atual e a nova senha.");
    if (nova.length < 8) return bad(res, 400, "Nova senha muito curta. Use pelo menos 8 caracteres.");
    if (nova === atual) return bad(res, 400, "A nova senha não pode ser igual à senha atual.");

    // Busca linha do usuário por ID (melhor), mas sua sessão hoje não carrega ID.
    // Então: vamos localizar por usuario+loja lendo a coluna B (usuário) e A (loja).
    // Para ficar rápido e consistente com seu modelo, vamos usar a planilha inteira A:K (normal para 46 lojas).
    const sheets = await getSheetsClient();

    // Lê A2:K e encontra pelo par (loja + usuario)
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: (await import("./_usuariosSheet.js")).spreadsheetId, // reaproveita o export
      range: "USUARIOS!A2:K",
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = resp.data.values || [];

    const alvoUsuario = String(s.usuario || "").trim().toLowerCase();
    const alvoLoja = String(s.loja || "").trim().toLowerCase();

    let rowIndex = -1;
    let rowValues = null;

    for (let i = 0; i < values.length; i++) {
      const r = padToK(values[i]);
      const loja = String(r[0] || "").trim().toLowerCase();
      const usuario = String(r[1] || "").trim().toLowerCase();
      if (loja === alvoLoja && usuario === alvoUsuario) {
        rowIndex = i + 2; // começou no A2
        rowValues = r;
        break;
      }
    }

    if (!rowValues || rowIndex < 2) {
      return bad(res, 404, "Usuário da sessão não encontrado na base.");
    }

    // Valida senha atual (hash bcrypt ou texto legado)
    const senhaPlanilha = String(rowValues[2] || "").trim(); // C
    const ehHashBcrypt = /^\$2[aby]\$\d{2}\$/.test(senhaPlanilha);

    const okAtual = ehHashBcrypt
      ? await bcrypt.compare(atual, senhaPlanilha)
      : (senhaPlanilha === atual);

    if (!okAtual) {
      return bad(res, 401, "Senha atual inválida.");
    }

    // Atualiza: C=novo hash, G=NAO, J/K com auditoria
    rowValues[2] = await bcrypt.hash(nova, 10);           // C
    rowValues[6] = "NAO";                                 // G PRIMEIRO_LOGIN
    rowValues[9] = nowBR();                               // J ULT_RESET_EM
    rowValues[10] = String(s.usuario || "").trim();       // K ULT_RESET_POR

    // Escreve linha A:K
    await updateRow(sheets, rowIndex, rowValues);

    // Recria cookie liberando o sistema (forcePwdChange=false)
    createSessionCookie(
      res,
      { usuario: s.usuario, loja: s.loja, perfil: s.perfil, forcePwdChange: false },
      { ttlSec: 60 * 60 * 8 }
    );

    return ok(res, { sucesso: true });

  } catch (e) {
    console.error("usuarios-trocar-minha-senha error:", e);
    return bad(res, 500, "Erro interno ao trocar senha.");
  }
}
