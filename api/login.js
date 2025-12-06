// /api/login.js
import { lerUsuariosDaPlanilha } from "./_authUsuarios.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ sucesso: false, message: "Método não permitido." });
  }

  const { usuario, senha, loja } = req.body || {};

  if (!usuario || !senha || !loja) {
    return res.status(400).json({ sucesso: false, message: "Dados incompletos." });
  }

  const todos = await lerUsuariosDaPlanilha();

  const user = todos.find(
    (u) =>
      u.usuario === usuario.trim().toLowerCase() &&
      u.senha === senha.trim() &&
      u.loja.toLowerCase() === loja.trim().toLowerCase()
  );

  if (!user) {
    return res.status(401).json({
      sucesso: false,
      message: "Usuário, senha ou loja inválidos.",
    });
  }

  // PERFIL QUE PODE ENTRAR NO PAINEL PPP
  const perfisPermitidos = ["ADMINISTRADOR", "GERENTE PPP", "BASE_PPP"];

  if (!perfisPermitidos.includes(user.perfil)) {
    return res.status(403).json({
      sucesso: false,
      message: "Usuário não habilitado para este painel.",
    });
  }

  const token = Buffer.from(`${usuario}:${Date.now()}`).toString("base64");

  return res.status(200).json({
    sucesso: true,
    usuario: user.usuario,
    loja: user.loja,
    perfil: user.perfil,
    token,
  });
}
