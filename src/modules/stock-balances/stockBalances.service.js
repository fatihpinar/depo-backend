// src/modules/stock-balances/stockBalances.service.js
const repo = require("./stockBalances.repository");

exports.getMasterSummary = async (masterId, { warehouseId, statusId } = {}) => {
  return repo.getMasterSummary({
    masterId: Number(masterId),
    warehouseId: warehouseId ? Number(warehouseId) : 0,
    statusId: statusId ? Number(statusId) : 0,
  });
};
