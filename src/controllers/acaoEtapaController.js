const XLSX = require("xlsx");
const fs = require("fs");

const Servico = require("../models/Servico");
const Prestador = require("../models/Prestador");
const Ticket = require("../models/Ticket");

const mongoose = require("mongoose");
const { max, addDays, format } = require("date-fns");

const {
  criarPrestadorParaExportacao,
} = require("../services/integracaoRPAs/exportarPrestadores");

const {
  criarServicoParaExportacao,
} = require("../services/integracaoRPAs/exportarServicos");

const emailUtils = require("../utils/emailUtils");

exports.importarComissoes = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const arquivo = req.file;

    if (!arquivo) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Nenhum arquivo enviado." });
    }

    // Ler o arquivo usando XLSX
    const workbook = XLSX.readFile(arquivo.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
    });

    // Processar os dados pela posição das colunas
    const processedData = jsonData
      .map((row, index) => {
        if (index === 0) return null; // Ignorar cabeçalho, se existir

        return {
          sid: row[0] || "",
          nomePrestador: row[1] || "",
          mesCompetencia: row[2] || "",
          anoCompetencia: row[3] || "",
          valorPrincipal: row[4] || 0,
          valorBonus: row[5] || 0,
          valorAjusteComercial: row[6] || 0,
          valorHospedagemAnuncio: row[7] || 0,
          valorTotal: row[8] || 0,
        };
      })
      .filter((row) => row !== null && row.sid && row.nomePrestador); // Filtra linhas inválidas

    // Percorrer os dados e salvar no banco
    for (const row of processedData) {
      try {
        let prestador = await Prestador.findOne({ sid: row.sid }).session(
          session,
        );
        if (!prestador) {
          prestador = new Prestador({
            sid: row.sid,
            nome: row.nomePrestador,
            status: "pendente-de-revisao",
          });
          await prestador.save({ session });
        }

        const servico = new Servico({
          prestador: prestador._id,
          mesCompetencia: row.mesCompetencia,
          anoCompetencia: row.anoCompetencia,
          valorPrincipal: row.valorPrincipal,
          valorBonus: row.valorBonus,
          valorAjusteComercial: row.valorAjusteComercial,
          valorHospedagemAnuncio: row.valorHospedagemAnuncio,
          valorTotal: row.valorTotal,
          correcao: row.correcao || false,
          status: "ativo",
        });
        await servico.save({ session });

        const ticket = new Ticket({
          servicos: [servico._id],
          prestador: prestador._id,
          titulo: `Comissão ${prestador.nome}: ${servico.mesCompetencia}/${servico.anoCompetencia}`,
          status: "aguardando-inicio",
          etapa: "requisicao",
        });
        await ticket.save({ session });

        console.log("Ticket criado:", ticket.titulo);
      } catch (err) {
        console.error(
          `Erro ao processar linha: ${JSON.stringify(row)} - ${err}`,
        );
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({
          message: "Erro ao importar comissões.",
          detalhes: err.message,
        });
      }
    }

    // Remover o arquivo após o processamento
    fs.unlinkSync(arquivo.path);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ message: "Comissões importadas com sucesso." });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Erro ao importar comissões:", error);
    res
      .status(500)
      .json({ message: "Erro interno do servidor.", detalhes: error.message });
  }
};

exports.exportarServicos = async (req, res) => {
  try {
    const tickets = await Ticket.find({
      etapa: "integracao-unico",
      status: { $ne: "concluido" },
    })
      .populate("servicos")
      .populate("prestador");

    if (!tickets) {
      return res.status(400).json({
        mensagem: "Não foram encontrados tickets a serem exportados",
      });
    }

    res
      .status(200)
      .json({ mensagem: "Serviços sendo processados e exportados" });

    let documento = "";
    const prestadoresComTicketsExportados = [];

    for (const ticket of tickets) {
      const { prestador, servicos } = ticket;
      if (
        prestador.sciUnico &&
        servicos.length > 0 &&
        !prestadoresComTicketsExportados.includes(prestador._id)
      ) {
        let valorTotalDoTicket = 0;
        const datasDeCompetencia = [];
        for (const { valorTotal, mesCompetencia, anoCompetencia } of servicos) {
          console.log(valorTotal);

          valorTotalDoTicket += valorTotal;
          // -1 por que para o date fns janeiro = 0
          datasDeCompetencia.push(new Date(anoCompetencia, mesCompetencia - 1));
        }

        if (valorTotalDoTicket > 0) {
          const dataDeCompetenciaMaisRecente = max(datasDeCompetencia);

          documento += criarServicoParaExportacao({
            codAutonomo: prestador.sciUnico,
            codCentroDeCustos: process.env.SCI_CODIGO_CENTRO_CUSTO,
            codEmpresa: process.env.SCI_CODIGO_EMPRESA,
            porcentualIss: process.env.SCI_PORCENTAGEM_ISS,
            dataDePagamento: format(
              addDays(new Date(), Number(process.env.SCI_DIAS_PAGAMENTO)),
              "ddMMyyyy",
            ),
            dataDeRealizacao: format(dataDeCompetenciaMaisRecente, "ddMMyyyy"),
            tipoDeDocumento: 1, // numero do exemplo
            valor: valorTotalDoTicket,
          }).concat("\n\n");

          ticket.status = "trabalhando";
          await ticket.save();

          prestadoresComTicketsExportados.push(prestador._id);
        }
      }
    }

    emailUtils.emailServicosExportados({ documento, usuario: req.usuario });
  } catch (error) {
    console.error(error);
  }
};

exports.exportarPrestadores = async (req, res) => {
  console.log("Exportando prestadores");
  res
    .status(200)
    .json({ mensagem: "Prestadores sendo processados e exportados" });

  try {
    const tickets = await Ticket.find({
      etapa: "integracao-unico",
      status: { $ne: "concluido" },
    }).populate("prestador");

    const prestadoresExportados = [];
    let documento = "";

    for (const { prestador } of tickets) {
      if (
        !prestador.sciUnico &&
        !prestadoresExportados.includes(prestador._id)
      ) {
        documento += criarPrestadorParaExportacao({
          documento: prestador.documento,
          bairro: prestador.bairro,
          email: prestador.email,
          nome: prestador.nome,
          cep: prestador.endereco ? prestador.endereco.cep : "",
          nomeMae: prestador.pessoaFisica ? prestador.pessoaFisica.nomeMae : "",
          pisNis: prestador.pessoaFisica ? prestador.pessoaFisica.pis : "",
          rg: prestador.pessoaFisica ? prestador.pessoaFisica.rg.numero : "",
          orgaoEmissorRG: prestador.pessoaFisica
            ? prestador.pessoaFisica.rg.orgaoEmissor
            : "",
          dataNascimento: prestador.pessoaFisica
            ? format(prestador.pessoaFisica.dataNascimento, "ddMMyyyy")
            : "",
        }).concat("\n\n");

        prestador.status = "aguardando-codigo-sci";
        prestador.dataExportacao = new Date();
        await prestador.save();
        prestadoresExportados.push(prestador._id);
      }
    }

    emailUtils.emailPrestadoresExportados({ documento, usuario: req.usuario });
  } catch (error) {
    console.error(error);
  }
};

exports.importarPrestadores = async (req, res) => {
  console.log("Importar prestadores");
  res.send("Importar prestadores");
};

exports.importarRPAs = async (req, res) => {
  console.log("Importar RPA");
  res.send("Importar RPA");
};
