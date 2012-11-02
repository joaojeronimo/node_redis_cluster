var redis = require('redis');
var redisClusterSlot = require('./redisClusterSlot');
var commands = require('./lib/commands');

var connectToLink = function(str, auth) {
  var spl = str.split(':');
  if (auth) {
    return (redis.createClient(spl[1], spl[0]).auth(auth));
  } else {
    return (redis.createClient(spl[1], spl[0]));
  }
}

/*
  Connect to a node of a Redis Cluster, discover the other nodes and
  respective slots with the "CLUSTER NODES" command, connect to them
  and return an array of the links to all the nodes in the cluster.
*/
function connectToNodesOfCluster (firstLink, callback) {
  var redisLinks = [];
  var fireStarter = connectToLink(firstLink);
  fireStarter.cluster('nodes', function(err, nodes) {
    if (err) {
      callback(err, null);
      return;
    }
    var lines = nodes.split('\n');
    var n = lines.length;
    while (n--) {
      var items = lines[n].split(' ');
      var name = items[0];
      var flags = items[2];
      var link = (flags === 'myself') ? firstLink : items[1];
      var lastPingSent = items[4];
      var lastPongReceived = items[5];
      var linkState = items[6];
      var slots = items[7];

      if (linkState === 'connected') {
        redisLinks.push({name: name, link: connectToLink(link), slots: slots.split('-')});
      }
      if (n === 0) {
        callback(err, redisLinks);
      }
    }
  });
}

/*
  Connect to all the nodes that form a cluster. Takes an array in the form of
  [
    {name: "node1", link: "127.0.0.1:6379", slots: [0, 2048], auth: foobared},
    {name: "node2", link: "127.0.0.1:7379", slots: [2048, 4096], auth:foobared},
  ]

  *auth is optional

  You decide the allocation of the 4096 slots, but they must be all covered, and
  if you decide to add/remove a node from the "cluster", don't forget to MIGRATE
  the keys accordingly to the new slots allocation.

*/
function connectToNodes (cluster) {
  var redisLinks = [];
  var n = cluster.length;
  while (n--) {
    var node = cluster[n];
    redisLinks.push({
      name: node.name,
      link: connectToLink(node.link, node.auth),
      slots: node.slots
    });
  }
  return (redisLinks);
}


function bindCommands (nodes) {
  var client = {};
  client.nodes = nodes;
  var n = nodes.length;
  var c = commands.length;
  while (c--) {
    (function (command) {
      client[command] = function () {
        var o_arguments = Array.prototype.slice.call(arguments);
        var o_callback = o_arguments.pop();
        var slot = redisClusterSlot(o_arguments[0]);
        var i = n;
        while (i--) {
          var node = nodes[i];
          var slots = node.slots;
          if ((slot >= slots[0]) && (slot <= slots[1])) {
            node.link.send_command(command, o_arguments, o_callback);
          }
        }
      }
    })(commands[c]);
  }
  return(client);
}

module.exports.clusterClient = function (firstLink, callback) {
  connectToNodesOfCluster(firstLink, function (err, nodes) {
    callback(err, bindCommands(nodes));
  });
}

module.exports.poorMansClusterClient = function (cluster, callback) {
  return bindCommands(connectToNodes(cluster));
}