var crc16 = require('node-redis-crc16').crc16;

module.exports = redisHash;

function redisHash(bytes) {
	return crc16(bytes) % 16384;
};

// key: привет
// slot: 7365
//
// key: 123456789
// slot: 12739
//
// key: nht.reach.accounts:زووم
// slot: 4107