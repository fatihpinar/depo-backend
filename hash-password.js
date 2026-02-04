const bcrypt = require('bcrypt');

async function run() {
  const plain = '1234';
  const saltRounds = 12; // mevcut hash'lerin başı $2b$12$ olduğu için 12 kullanıyoruz

  const hash = await bcrypt.hash(plain, saltRounds);
  console.log('1234 hash =>', hash);
}

run().then(() => process.exit(0));
