// /api/bono-notificar.js
import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

function json(res, status, data) {
  return res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(data));
}

function getEnv(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : "";
}

function normalizeKey(s) {
  return String(s || "").trim();
}

function normalizarTelefoneParaWa(dado) {
  const digits = String(dado || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return digits; // fallback
}

async function getContatoWhatsAppPorLoja(loja) {
  const spreadsheetId = getEnv("SPREADSHEET_ID");
  const clientEmail = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKeyRaw = getEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  if (!spreadsheetId || !clientEmail || !privateKeyRaw) {
    throw new Error("Variáveis Google (SPREADSHEET_ID/GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY) ausentes.");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKeyRaw,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const range = "CONTATOS_BONO!A:B";

  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = resp?.data?.values || [];

  let whatsapp = "";
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    const lojaRow = normalizeKey(row[0]);
    const telRow = normalizeKey(row[1]);
    if (lojaRow && lojaRow === loja) {
      whatsapp = telRow;
      break;
    }
  }

  return whatsapp;
}

function montarLinkAprovacaoPadrao() {
  // ✅ defina APP_BASE_URL em produção, ex: https://ppp.seudominio.com
  const base = getEnv("APP_BASE_URL");
  if (base) return base.replace(/\/+$/, "") + "/login.html";
  // fallback: vazio (não quebra o envio, só perde o link)
  return "";
}

/**
 * Envio via Cloud API:
 * - Recomendado: usar TEMPLATE aprovado (mais previsível fora da janela 24h).
 * - Você precisa criar o template no WhatsApp Manager.
 */
async function enviarTemplateWhatsApp({ toPhone, templateName, languageCode, paramsText = [] }) {
  const token = getEnv("WHATSAPP_TOKEN");
  const phoneNumberId = getEnv("WHATSAPP_PHONE_NUMBER_ID");

  if (!token || !phoneNumberId) {
    throw new Error("Variáveis WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID ausentes.");
  }

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const components = [
    {
      type: "body",
      parameters: paramsText.map((t) => ({ type: "text", text: String(t ?? "") }))
    }
  ];

  const payload = {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components
    }
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok) {
      const errMsg = data?.error?.message || "Erro ao enviar WhatsApp (Cloud API).";
      const errCode = data?.error?.code || resp.status;
      throw new Error(`${errMsg} (code: ${errCode})`);
    }

    return data;
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { sucesso: false, mensagem: "Método não permitido. Use POST." });
  }

  // ✅ protege (evita alguém externo disparando WhatsApp)
  const session = requireSession(req, res);
  if (!session) return;

  const body = req.body || {};

  const lojaOrigem = normalizeKey(body.lojaOrigem || session.loja || "");
  const usuario = normalizeKey(body.usuario || session.usuario || "");
  const lojaDestino = normalizeKey(body.lojaDestino || "");
  const dataHora = normalizeKey(body.dataHora || "");
  const documento = normalizeKey(body.documento || "");
  const totalItens = Number(body.totalItens || 0);

  if (!lojaDestino) {
    return json(res, 400, { sucesso: false, mensagem: "lojaDestino é obrigatório." });
  }

  // 1) busca telefone na planilha
  let telefoneRaw = "";
  try {
    telefoneRaw = await getContatoWhatsAppPorLoja(lojaDestino);
  } catch (e) {
    console.error("[BONO][NOTIF] erro ao buscar contato:", e);
    return json(res, 500, { sucesso: false, mensagem: "Falha ao buscar contato do destino." });
  }

  if (!telefoneRaw) {
    return json(res, 200, { sucesso: false, mensagem: "Contato não encontrado para a loja destino." });
  }

  const toPhone = normalizarTelefoneParaWa(telefoneRaw);
  if (!toPhone) {
    return json(res, 200, { sucesso: false, mensagem: "Telefone do destino inválido." });
  }

  // 2) monta parâmetros do template
  // ✅ Você cria o template com placeholders nessa ordem:
  // 1) lojaDestino
  // 2) lojaOrigem
  // 3) usuario
  // 4) dataHora
  // 5) totalItens
  // 6) documento
  // 7) linkAprovacao
  const link = montarLinkAprovacaoPadrao();

  const templateName = getEnv("WHATSAPP_TEMPLATE_BONO") || "bono_mov_interna_pendente";
  const languageCode = getEnv("WHATSAPP_TEMPLATE_LANG") || "pt_BR";

  const params = [
    lojaDestino,
    lojaOrigem,
    usuario,
    dataHora || "—",
    String(Number.isFinite(totalItens) ? totalItens : 0),
    documento || "—",
    link || "—"
  ];

  // 3) envia via Cloud API
  try {
    const result = await enviarTemplateWhatsApp({
      toPhone,
      templateName,
      languageCode,
      paramsText: params
    });

    return json(res, 200, {
      sucesso: true,
      mensagem: "WhatsApp enviado com sucesso.",
      to: toPhone,
      template: templateName,
      cloud: result
    });
  } catch (e) {
    console.error("[BONO][NOTIF] erro ao enviar WhatsApp:", e);
    return json(res, 200, {
      sucesso: false,
      mensagem: "Falha ao enviar WhatsApp (Cloud API).",
      detalhe: String(e?.message || e)
    });
  }
}

/*
Fontes confiáveis:
- Cloud API /messages: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
- Template messages: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
- Webhooks e conceitos de janela 24h: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/conversation-types
*/
