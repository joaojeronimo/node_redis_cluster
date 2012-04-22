node_redis_cluster - A thin layer over node_redis to handle Redis Clusters
===========================

Redis Cluster is comming out later this year, but I can't wait for it so I made this module.

All it does is connect to the nodes of a Redis Cluster, and before sending any commands it checks in which slot the key is with `HASH_SLOT = CRC16(key) mod 4096` and then sends the command to the node that has that slot.

Installation
===========================

  npm install redis-cluster

Usage
===========================

This module exports two objects. `clusterClient` is to be used with a regular Redis Cluster, you just need to supply a link (like `127.0.0.1:6379`) and the other members of the cluster will be found, after that you can use it pretty much like the original `node_redis` module:

```javascript
    var RedisCluster = require('redis-cluster').clusterClient;
    var assert = require('assert');

    var firstLink = '127.0.0.1:6379' // Used to discover the rest of the cluster
    new RedisCluster(firstLink, function (err, r) {
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
```

Don't forget that despite being a thin wrapper above `node_redis`, you still can't use all the commands you would use against a normal Redis server. For instance, don't expect the `KEYS` command to work (infact, in the [Redis Cluster spec](http://redis.io/topics/cluster-spec) it says that "all the operations where in theory keys are not available in the same node are not implemented").

But Redis Cluster is unstable!
===========================

If you really want to have a cluster of Redis nodes but don't want to run unstable software, you can always use the **Poor Man's Cluster Client**, also supplied by this module.

This time you can't supply a link of one node of the cluster (maybe because it's not a real cluster), you have to supply the links to all the nodes, like this:

```javascript

    var RedisCluster = require('redis-cluster').poorMansClusterClient;
    var assert = require('assert');

    var cluster = [
      {name: 'redis01', link: '127.0.0.1:6379', slots: [0, 1364]},
      {name: 'redis02', link: '127.0.0.1:7379', slots: [1364, 2370]},
      {name: 'redis03', link: '127.0.0.1:8379', slots: [2370, 4096]}
    ]

    new poorMansClusterClient(cluster, function (err, r) {
      if (err) throw err;
      r.set('foo', 'bar', function (err, reply) {
        if (err) throw err;
        assert.equal(reply,'OK');

        r.get('foo', function (err, reply) {
          if (err) throw err;
          assert.equal(reply, 'bar');
        });
      });
    }

```
As you noticed, you must specify the interval of slots allocated to each node. All 4096 slots must be covered, otherwise you will run in some nasty errors (some keys might have no where to go).

If you decide to re-allocate the slots, add or remove a node, you must move all the affected keys yourself. The [MIGRATE](http://redis.io/commands/migrate) command might help you with that.

Notes on performance
===========================

Before every operation, a CRC16 of the key gets computed, so we can know in which node of the cluster this key is. It turns out it's not such an expensive operation to run for every command after all. My laptop can hash 2793296.089 strings of 32 characters per second, that will in no way be a bottleneck to all database operations.

Some quick test showed it achieved a very similar performance to the `node_redis` module, so I'll assume it's not so bad and as soon as I have time I'll publish some tests

Other notes
===========================

This is of course not intended for production and has probably stupid (not bad, stupid) code inside, but I just needed something that works as there are no decent modules to work with Redis Clusters yet. It's also my first nodejs module so go easy on me and don't send me something like [this epic pull request](https://github.com/zenorocha/jquery-boilerplate/pull/10).