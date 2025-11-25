// api/login.js
export default function handler(req, res) {
  // Só aceitamos POST. GET continua respondendo "Método não permitido".
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Método não permitido" });
  }

  // Garante que vamos conseguir ler o JSON tanto em string quanto em objeto
  let data = req.body || {};

  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (e) {
      data = {};
    }
  }

  const { usuario, senha, loja } = data;

  // Lista de acessos válidos (ajuste aqui conforme sua regra real)
  const usuariosValidos = [
    {
      usuario: "LOJA1",
      senha: "1234",
      loja: "ULT 01 - PLANALTINA",
    },
    {
      usuario: "LOJA2",
      senha: "5678",
      loja: "ULT 08 - ARAPOANGA",
    },
    {
      usuario: "GERENTE",
      senha: "9999",
      loja: "ULT 14 - ÁGUAS LINDAS",
    },
  ];

  // Verifica se existe um registro que bate com as 3 infos
  const encontrado = usuariosValidos.find(
    (u) =>
      u.usuario === usuario &&
      u.senha === senha &&
      u.loja === loja
  );

  // Se não encontrou, login inválido
  if (!encontrado) {
    return res
      .status(401)
      .json({ message: "Usuário, senha ou loja inválidos." });
  }

  // Se encontrou, login OK
  return res.status(200).json({
    message: "Login autorizado.",
    usuario: encontrado.usuario,
    loja: encontrado.loja,
  });
}
