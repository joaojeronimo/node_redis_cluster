# node_redis_cluster
## A thin layer over node_redis to handle Redis Clusters


Redis Cluster is coming out later this year, but I can't wait for it so I made this module.

All it does is connect to the nodes of a Redis Cluster, and before sending any commands it checks in which slot the key is with `HASH_SLOT = CRC16(key) mod 16384` and then sends the command to the node that has that slot.

# Installation

    npm install redis-cluster

# Usage

This module exports two objects. `clusterClient` is to be used with a regular Redis Cluster, you just need to supply a link (like `127.0.0.1:6379`) and the other members of the cluster will be found, after that you can use it pretty much like the original `node_redis` module:

```javascript
var RedisCluster = require('redis-cluster').clusterClient;
var redis = RedisCluster;
var redisPubSub = RedisCluster;
var assert = require('assert');

var firstLink = '127.0.0.1:6379'; // Used to discover the rest of the cluster
new redis.clusterInstance(firstLink, function (err, r) {
  if (err) throw err;
  r.set('foo', 'bar', function (err, reply) {
    if (err) throw err;
    assert.equal(reply,'OK');

    r.get('foo', function (err, reply) {
      if (err) throw err;
      assert.equal(reply, 'bar');
    });
  });
});

new redisPubSub.clusterInstance(firstLink, function (err, r) {
  r.subscribe('channel');

  for( var link in redisPubSub.redisLinks )
  {
    redisPubSub.redisLinks[link].link.on('message', function (channel, message) {
        // New message in a channel, necessarily 'channel' here because it's the only one we're subscribed to.
    });
  }
});
```

Don't forget that despite being a thin wrapper above `node_redis`, you still can't use all the commands you would use against a normal Redis server. For instance, don't expect the `KEYS` command to work (in fact, in the [Redis Cluster spec](http://redis.io/topics/cluster-spec) it says that "all the operations where in theory keys are not available in the same node are not implemented").

# But Redis Cluster is unstable!

If you really want to have a cluster of Redis nodes but don't want to run unstable software, you can always use the **Poor Man's Cluster Client**, also supplied by this module.

This time you can't supply a link of one node of the cluster (maybe because it's not a real cluster), you have to supply the links to all the nodes, like this:

```javascript
var RedisCluster = require('redis-cluster').poorMansClusterClient;
var assert = require('assert');

var cluster = [
  {name: 'redis01', link: '127.0.0.1:6379', slots: [   0, 5462], options: {max_attempts: 5}},
  {name: 'redis02', link: '127.0.0.1:7379', slots: [5463, 12742], options: {max_attempts: 5}},
  {name: 'redis03', link: '127.0.0.1:8379', slots: [12743, 16384], options: {max_attempts: 5}}
];

var r = poorMansClusterClient(cluster);

r.set('foo', 'bar', function (err, reply) {
  if (err) throw err;
  assert.equal(reply,'OK');

  r.get('foo', function (err, reply) {
    if (err) throw err;
    assert.equal(reply, 'bar');
  });
});
```
As you noticed, you must specify the interval of slots allocated to each node. All 16384 slots must be covered, otherwise you will run in some nasty errors (some keys might have no where to go).

Options are optional and may be added or left out. All valid options for the redis client may be found in the redis client documentation.

If you decide to re-allocate the slots, add or remove a node, you must move all the affected keys yourself. The [MIGRATE](http://redis.io/commands/migrate) command might help you with that.

# Notes on performance

Before every operation, a CRC16 of the key gets computed, so we can know in which node of the cluster this key is. It turns out it's not such an expensive operation to run for every command after all. My laptop can hash 2793296.089 strings of 32 characters per second, that will in no way be a bottleneck to all database operations.

Some quick test showed it achieved a very similar performance to the `node_redis` module, so I'll assume it's not so bad and as soon as I have time I'll publish some tests

# Other notes

This is of course not intended for production and has probably stupid (not bad, stupid) code inside, but I just needed something that works as there are no modules to work with Redis Clusters yet.

# Credits

This module shamelessly borrows some code from the mranney's `node_redis` module and alexgorbatchev's `node-crc`, although I didn't feel the need to include it as a dependency because only CRC16 is needed.