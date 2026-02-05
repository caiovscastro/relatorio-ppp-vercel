// api/_authUsuarios.js
//
// Objetivo: validação de sessão no backend.
//
// Modo recomendado (seguro):
// - Defina SESSION_SECRET (string forte) para habilitar cookie assinado.
// - Sua API de login seta o cookie ppp_session via createSessionCookie().
//
// Modo compatibilidade (não recomendado):
// - Se você ainda não implementou cookie assinado no login,
//   você pode permitir sessão via header "X-PPP-Session" (base64 do JSON),
//   habilitando ALLOW_INSECURE_SESSION=true.
//
// Segurança:
// - Bloqueio em HTML (localStorage/sessionStorage) é fácil de burlar.
// - Proteção correta: endpoints /api devem rejeitar chamadas sem sessão válida.

import crypto from "crypto";

const COOKIE_NAME = "ppp_session";

function envBool(name, def = false) {
  const v = String(process.env[name] || "").trim().toLowerCase();
  if (!v) return def;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function getSessionSecret() {
  const s = String(process.env.SESSION_SECRET || "").trim();
  return s || null;
}

function isProdEnv() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function parseCookies(req) {
  const header = req?.headers?.cookie;
  const out = {};
  if (!header) return out;

  const parts = header.split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const {
    httpOnly = true,
    secure = true,
    sameSite = "Lax",
    path = "/",
    maxAgeSec = 60 * 60 * 8,
    domain
  } = opts;

  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAgeSec}; SameSite=${sameSite}`;
  if (httpOnly) cookie += "; HttpOnly";
  if (secure) cookie += "; Secure";
  if (domain) cookie += `; Domain=${domain}`;

  const prev = res.getHeader("Set-Cookie");
  if (!prev) {
    res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(prev)) {
    res.setHeader("Set-Cookie", [...prev, cookie]);
  } else {
    res.setHeader("Set-Cookie", [prev, cookie]);
  }
}

function clearCookie(res, name, opts = {}) {
  // Importante: atributos precisam combinar com os usados no setCookie
  const {
    secure = true,
    sameSite = "Lax",
    path = "/",
    domain
  } = opts;

  let cookie = `${name}=; Path=${path}; Max-Age=0; SameSite=${sameSite}; HttpOnly`;
  if (secure) cookie += "; Secure";
  if (domain) cookie += `; Domain=${domain}`;

  const prev = res.getHeader("Set-Cookie");
  if (!prev) res.setHeader("Set-Cookie", cookie);
  else if (Array.isArray(prev)) res.setHeader("Set-Cookie", [...prev, cookie]);
  else res.setHeader("Set-Cookie", [prev, cookie]);
}

function signToken(payloadObj, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = b64urlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payloadObj)));
  const data = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  const sigB64 = b64urlEncode(sig);
  return `${data}.${sigB64}`;
}

function verifyToken(token, secret) {
  const t = String(token || "").trim();
  const parts = t.split(".");
  if (parts.length !== 3) return null;

  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const sigExpected = crypto.createHmac("sha256", secret).update(data).digest();
  const sigGot = b64urlDecode(s);

  if (sigGot.length !== sigExpected.length) return null;
  if (!crypto.timingSafeEqual(sigGot, sigExpected)) return null;

  const payloadBuf = b64urlDecode(p);
  const payload = safeJsonParse(payloadBuf.toString("utf8"));
  if (!payload) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) < now) return null;

  return payload;
}

function normalizeProfile(p) {
  return String(p || "").trim().toUpperCase();
}

function decodeHeaderSession(req) {
  const raw =
    req?.headers?.["x-ppp-session"] ||
    req?.headers?.["X-PPP-Session"];

  if (!raw) return null;

  const s = String(raw).trim();
  let jsonStr = "";

  try {
    jsonStr = Buffer.from(s, "base64").toString("utf8");
  } catch (e) {
    jsonStr = s;
  }

  const obj = safeJsonParse(jsonStr);
  if (!obj) return null;

  const session = {
    usuario: obj.usuario || obj.user || obj.login || "",
    loja: obj.loja || obj.store || "",
    perfil: obj.perfil || obj.profile || "",
    origem: obj.origem || obj.source || ""
  };

  if (!session.usuario) return null;
  return session;
}

export function createSessionCookie(res, session, opts = {}) {
  const secret = getSessionSecret();
  if (!secret) throw new Error("SESSION_SECRET não configurado.");

  const now = Math.floor(Date.now() / 1000);
  const ttlSec = Number(opts.ttlSec || (60 * 60 * 8));

  const payload = {
    usuario: session?.usuario || "",
    loja: session?.loja || "",
    perfil: normalizeProfile(session?.perfil || ""),
    // ✅ NOVO: trava o sistema até trocar senha
    forcePwdChange: !!session?.forcePwdChange,
    iat: now,
    exp: now + ttlSec
  };

  if (!payload.usuario) throw new Error("Sessão inválida: usuario ausente.");

  const token = signToken(payload, secret);

  const secure = isProdEnv();

  setCookie(res, COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAgeSec: ttlSec
  });

  return payload;
}

export function requireSession(req, res, options = {}) {
  const { allowedProfiles, allowForcePwdChange } = options;

  // 1) Modo seguro: cookie assinado
  const secret = getSessionSecret();
  if (secret) {
    const cookies = parseCookies(req);
    const token = cookies[COOKIE_NAME];
    if (token) {
      const payload = verifyToken(token, secret);
      if (payload && payload.usuario) {

        // ✅ NOVO: trava acesso enquanto precisa trocar senha
        if (payload.forcePwdChange && !allowForcePwdChange) {
          res.status(403).json({
            sucesso: false,
            message: "Troca de senha obrigatória antes de acessar o sistema."
          });
          return null;
        }

        if (Array.isArray(allowedProfiles) && allowedProfiles.length > 0) {
          const p = normalizeProfile(payload.perfil);
          const ok = allowedProfiles.map(normalizeProfile).includes(p);
          if (!ok) {
            res.status(403).json({ sucesso: false, message: "Sessão sem permissão para este acesso." });
            return null;
          }
        }
        return payload;
      }
    }
  }

  // 2) Modo compatibilidade: header X-PPP-Session (inseguro)
  if (envBool("ALLOW_INSECURE_SESSION", false)) {
    const s = decodeHeaderSession(req);
    if (s) {

      // ✅ Aqui também bloqueia (se você quiser suportar força de troca nesse modo)
      // Como header não tem forcePwdChange, não bloqueia.

      if (Array.isArray(allowedProfiles) && allowedProfiles.length > 0) {
        const p = normalizeProfile(s.perfil);
        const ok = allowedProfiles.map(normalizeProfile).includes(p);
        if (!ok) {
          res.status(403).json({ sucesso: false, message: "Sessão sem permissão para este acesso." });
          return null;
        }
      }
      return s;
    }
  }

  res.status(401).json({
    sucesso: false,
    message: "Sessão inválida ou ausente. Faça login novamente."
  });
  return null;
}

  // 2) Modo compatibilidade: header X-PPP-Session (inseguro)
  if (envBool("ALLOW_INSECURE_SESSION", false)) {
    const s = decodeHeaderSession(req);
    if (s) {
      if (Array.isArray(allowedProfiles) && allowedProfiles.length > 0) {
        const p = normalizeProfile(s.perfil);
        const ok = allowedProfiles.map(normalizeProfile).includes(p);
        if (!ok) {
          res.status(403).json({ sucesso: false, message: "Sessão sem permissão para este acesso." });
          return null;
        }
      }
      return s;
    }
  }

  res.status(401).json({
    sucesso: false,
    message: "Sessão inválida ou ausente. Faça login novamente."
  });
  return null;
}
