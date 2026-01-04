// Status enum (DB'deki id'ler)
const STATUS = {
  in_stock:     1,
  used:         2,
  sold:         3,
  pending:      4,
  damaged_lost: 5,
  production:   6,
  screenprint:  7,
  deleted:      8,
};

// List ekranında scope -> hangi status listelensin?
const LIST_STATUS_BY_SCOPE = {
  stock:       STATUS.pending,
  production:  STATUS.production,
  screenprint: STATUS.screenprint,
};

// Üretim/serigrafi onaylarında hedef deponun departmanı aynıysa direkt in_stock
const DEPT_BY_SCOPE = { production: "production", screenprint: "screenprint" };

// kind -> tablo adı
const KIND_TABLE = { component: "components", product: "products" };

module.exports = { STATUS, LIST_STATUS_BY_SCOPE, DEPT_BY_SCOPE, KIND_TABLE };
