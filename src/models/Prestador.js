// src/models/Prestador.js
const mongoose = require("mongoose");

// Esquema de Endereço
const enderecoSchema = new mongoose.Schema({
  cep: { type: String, match: /^\d{8}$/ },
  rua: String,
  numero: String,
  complemento: String,
  cidade: String,
  estado: String,
});

// Esquema de Dados Bancários
const dadosBancariosSchema = new mongoose.Schema({
  banco: String,
  agencia: String,
  conta: String,
  tipoConta: { type: String, enum: ["", "corrente", "poupanca"] },
});

// Esquema Principal do Prestador
const prestadorSchema = new mongoose.Schema(
  {
    sciUnico: { type: Number, match: /^\d{5,}$/, unique: true },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
    nome: { type: String, required: true },
    sid: {
      type: Number,
      required: true,
      unique: true,
      match: [/^\d{7}$/, "O SID deve ter exatamente 7 dígitos."],
    },
    tipo: { type: String, enum: ["pj", "pf"] },
    documento: { type: String, match: /^\d{11}$|^\d{14}$/ },
    dadosBancarios: dadosBancariosSchema,
    email: {
      type: String,
      lowercase: true,
      validate: {
        validator: function (v) {
          return v === null ? true : /\S+@\S+\.\S+/.test(v);
        },
        message: (props) => `${props.value} não é um e-mail válido!`,
      },
      required: false,
    },
    endereco: enderecoSchema,
    pessoaFisica: {
      dataNascimento: Date,
      pis: String,
      nomeMae: String,
      rg: {
        numero: String,
        orgaoEmissor: String,
      },
    },
    pessoaJuridica: {
      razaoSocial: String,
      nomeFantasia: String,
      codigoCNAE: String,
      codigoServicoNacional: String,
      regimeTributario: {
        type: String,
        enum: ["MEI", "Simples Nacional", "Lucro Presumido", "Lucro Real"],
      },
    },
    comentariosRevisao: String,
    status: {
      type: String,
      enum: [
        "ativo",
        "em-analise",
        "pendente-de-revisao",
        "inativo",
        "arquivado",
        "aguardando-codigo-sci",
      ],
      default: "ativo",
    },
    dataExportacao: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Prestador", prestadorSchema);
