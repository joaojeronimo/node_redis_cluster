var redis = require('redis');
var fastRedis = null;
try {
  fastRedis = require('redis-fast-driver');
} catch(e) {}

var redisClusterSlot = require('./redisClusterSlot');
var commands = require('./lib/commands');

var connectToLink = function(str, auth, options) {
  var spl = str.split(':');
  options = options || {};
  if (auth) {
    if(fastRedis) {
      return new fastRedis({
        host: spl[0],
        port: spl[1],
        auth: auth
      });
    }
    return (redis.createClient(spl[1], spl[0], options).auth(auth));
  } else {
    if(fastRedis) {
      return new fastRedis({
        host: spl[0],
        port: spl[1]
      });
    }
    return (redis.createClient(spl[1], spl[0], options));
  }
};

/*
  Connect to a node of a Redis Cluster, discover the other nodes and
  respective slots with the "CLUSTER NODES" command, connect to them
  and return an array of the links to all the nodes in the cluster.
*/
function connectToNodesOfCluster (firstLink, callback) {
  var redisLinks = [];
  var fireStarter = connectToLink(firstLink);
  var clusterFn = fastRedis ? function(subcommand, cb) {
    fireStarter.rawCall(['cluster', subcommand], cb);
  } : fireStarter.cluster.bind(fireStarter);
  clusterFn('nodes', function(err, nodes) {
    if (err) {
      callback(err, null);
      return;
    }
    var lines = nodes.split('\n');
    var n = lines.length -1;
    while (n--) {
      var items = lines[n].split(' ');
      var name = items[0];
      var flags = items[2];
      var link = ( flags === 'myself' || flags === 'myself,master' || flags === 'myself,slave') ? firstLink : items[1];
      if(flags === 'slave' || flags === 'myself,slave') {
          if (n === 0) {
            callback(err, redisLinks);
            return;
          } 
          continue;
      }
      //var lastPingSent = items[4];
      //var lastPongReceived = items[5];
      var linkState = items[7];

      if (lines.length === 1 && lines[1] === '') {
        var slots = [0, 16383]
      } else {
        var slots = [];
        for(var i = 8; i<items.length;i++) {
          if(items[i].indexOf('-<-') !== -1 || items[i].indexOf('->-') !== -1) {
            //migrate in process...
            continue;
          }
          if(items[i].indexOf('-') === -1) {
            slots.push(items[i], items[i]);
            continue;
          }
          var t = items[i].split('-');
          slots.push(t[0], t[1]);
        }
      }
      
      if (linkState === 'connected') {
        redisLinks.push({
          name: name,
          connectStr: link,
          link: connectToLink(link), 
          slots: slots
        });
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
    {name: "node1", link: "127.0.0.1:6379", slots: [0, 8192], auth: foobared},
    {name: "node2", link: "127.0.0.1:7379", slots: [8193, 16384], auth:foobared},
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
    var options = node.options || {};
    redisLinks.push({
      name: node.name,
      link: connectToLink(node.link, node.auth, options),
      slots: node.slots
    });
  }
  return (redisLinks);
}

function bindCommands (nodes, oldClient) {
  var client = oldClient || {};
  client.nodes = nodes;
  var n = nodes.length;
  var c = commands.length;
  while (c--) {
    (function (command) {
      client[command] = function () {
        var o_arguments = Array.prototype.slice.call(arguments);
        var orig_arguments = Array.prototype.slice.call(arguments);
        var o_callback;
        var lastusednode;
        
        //Array.indexOf used for any other special functions that needs to be converted to something else
        if(fastRedis && ['hmset'].indexOf(command) !== -1) {
          //special functions
          if(command === 'hmset') {
            if(typeof arguments[1] === 'object') {
              // making from a
              //   redis.hmset('a', {a:1,b:2,c:3}, cb)
              // a
              //   redis.hmset('a', 'a', 1, 'b', 2, 'c', 3, cb);
              var tmp = [1,1];
              for(var k in arguments[1]) {
                tmp.push(k);
                tmp.push(arguments[1][k]);
              }
              Array.prototype.splice.apply(o_arguments, tmp);
            }
          }
        }
        
        // Taken from code in node-redis.
        var last_arg_type = typeof o_arguments[o_arguments.length - 1];

        if (last_arg_type === 'function') {
          o_callback = o_arguments.pop();
        }

        //for commands such as PING use slot 0
        var slot = o_arguments[0] ? redisClusterSlot(o_arguments[0]) : 0;
        
        var redirections = 0;
        
        function callback(e, data){
          if(e) {
            // Need to handle here errors '-ASK' and '-MOVED'
            // http://redis.io/topics/cluster-spec
            
            // ASK error example: ASK 12182 127.0.0.1:7001
            // When we got ASK error, we need just repeat a request on right node with ASKING command
            // If after ASK we got MOVED err, thats mean no key found
            if(e.substr(0, 3)==='ASK') {
              if(redirections++ > 5) {
                if(o_callback)
                  o_callback('Too much redirections');
                return;
              }
              //console.log('ASK redirection')
              var connectStr = e.split(' ')[2];
              var node = null;
              for(var i=0;i<nodes.length;i++) {
                if(nodes[i].connectStr === connectStr) {
                  node = nodes[i];
                  break;
                }
              }
              if(node) {
                if(fastRedis) {
                  node.link.rawCall(['ASKING'], function(){});
                } else {
                  node.link.send_command('ASKING', [], function(){});
                }
                return callNode(node, true);
              }
              if(o_callback)
                o_callback('Requested node for redirection not found `%s`', connectStr);
              return;
            } else if(e.substr(0, 5) === 'MOVED') {
              //MOVED error example: MOVED 12182 127.0.0.1:7002
              //this is our trigger when cluster topology is changed
              //console.log('got MOVED');
              clusterTopologyChanged(lastusednode.connectStr,function(e){
                //repeat command
                //console.log('repeat command', orig_arguments);
                client[command].apply(client, orig_arguments);
              });
              return;
            }
          }
          if(o_callback)
            o_callback(e, data);
        };
        
        function clusterTopologyChanged(firstLink, cb) {
          //console.log('clusterTopologyChanged');
          if(module.exports.clusterClient.redisLinks) {
            module.exports.clusterClient.redisLinks.forEach(function(node){
              node.link.end();
            });
          }
          module.exports.clusterClient.redisLinks = null;
          connectToNodesOfCluster(firstLink, function (err, newNodes) {
            //console.log('reconnected');
            module.exports.clusterClient.redisLinks = newNodes;
            client = bindCommands(newNodes, client);
            cb(err);
          });
        }
        
        var i = nodes.length;
        while (i--) {
          var node = nodes[i];
          var slots = node.slots;
          for(var r=0;r<slots.length;r+=2) {
            if ((slot >= slots[r]) && (slot <= slots[r+1])) {
              callNode(node);
              return;
            }
          }
        }
        
        throw 'slot '+slot+' found on no nodes';
        
        function callNode(node, argumentsAlreadyFixed) {
          // console.log('callNode',node);
          lastusednode = node;
          if(fastRedis) {
            if(!argumentsAlreadyFixed) o_arguments.unshift(command);
            if(command === 'hgetall') {
              node.link.rawCall(o_arguments, function(e, d){
                if(e) return callback(e);
                if(!Array.isArray(d) || d.length < 1)
                  return callback(e, d);
                var obj = {};
                for(var i=0;i<d.length;i+=2) {
                  obj[d[i]] = d[i+1];
                }
                callback(e, obj);
              });
              return;
            }
            if(command === 'hmget') {
              node.link.rawCall(o_arguments, function(e, d){
                if(e)
                  return callback(e);
                var obj = {};
                for(var i=0;i<d.length;i++) {
                  obj[o_arguments[i+2]] = d[i];
                }
                callback(e, obj);
              });
              return;
            }
            node.link.rawCall(o_arguments, callback);
            return;
          }
          node.link.send_command(command, o_arguments, callback);
        }
      };
    })(commands[c]);
  }
  return(client);
}

module.exports = {
    clusterClient : {
      redisLinks: null,
      clusterInstance: function (firstLink, callback) {
        connectToNodesOfCluster(firstLink, function (err, nodes) {
          module.exports.clusterClient.redisLinks = nodes;
          callback(err, bindCommands(nodes));
        });
      }
    },
    poorMansClusterClient : function (cluster) {
      return bindCommands(connectToNodes(cluster));
    }
};
