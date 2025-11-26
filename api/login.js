// api/login.js

export default function handler(req, res) {
  // Só aceita POST
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Método não permitido" });
  }

  const { usuario, senha, loja } = req.body || {};

  // Validação básica
  if (!usuario || !senha || !loja) {
    return res.status(400).json({ message: "Preencha todos os campos." });
  }

  // Aqui você configura seus logins válidos
  const usuariosValidos = [
    { usuario: "LOJA1", senha: "123", loja: "ULT 01 - PLANALTINA" },
    { usuario: "LOJA2", senha: "456", loja: "ULT 08 - ARAPOANGA" },
    { usuario: "LOJA3", senha: "789", loja: "ULT 14 - ÁGUAS LINDAS" }
  ];

  const autorizado = usuariosValidos.find(
    (u) =>
      u.usuario === usuario &&
      u.senha === senha &&
      u.loja === loja
  );

  if (!autorizado) {
    return res.status(401).json({
      message: "Usuário, senha ou loja inválidos."
    });
  }

  // OK
  return res.status(200).json({
    message: "Login autorizado.",
    usuario: autorizado.usuario,
    loja: autorizado.loja
  });
}
