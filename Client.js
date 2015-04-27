var EventEmitter = require('events').EventEmitter;
var util = require('util');
var redisClusterSlot = require('./redisClusterSlot');

function Client() {
    EventEmitter.call(this);
}
util.inherits(Client, EventEmitter);

Client.prototype.getSlot = function (key) {
    if (!key) return;
    return redisClusterSlot(key);
};

Client.prototype.getNode = function (key) {
    if (!this.nodes) return;
    var slot = this.getSlot(key);
    if (!slot) return;
    var l = this.nodes.length;
    for (var i = 0; i < l; i++) {
        var node = this.nodes[i];
        if (node && node.slots && node.slots[0] <= slot && slot <= node.slots[1])
            return node;
    }
};

module.exports = Client;