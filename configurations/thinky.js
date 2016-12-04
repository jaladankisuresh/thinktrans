var config = require('./config');
var thinky = require('thinky')({
    host: config.host,
    port: config.rethinkPort,
    db: config.rethinkDb
});

module.exports = thinky;
