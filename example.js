var rcluster = require('./index.js').clusterClient;

new rcluster.clusterInstance('127.0.0.1:7001', function (err, r) {
	if (err) throw err;
	
	r.hmset('hset:1', {a:1,b:2,c:'hello'}, function(e,d){
		console.log(e,d);
	});
	
	function doIt() {
		r.set('foo', 'bar', function (err, reply) {
			if (err) throw err;

			r.get('foo', function (err, reply) {
				if (err) throw err;
				console.log(err, reply);
			});
		});
	
		r.hgetall('hset:1', function(e, d){
			console.log(e,d);
		});
	
		try {
			console.log('hmget');
			r.hmget('hset:1', 'a', 'b', 'f', function(e, d){
				console.log('hmget',e,d);
			});
		} catch(e) {
			console.log('exception', e, e.stack)
		}
		
		setTimeout(doIt, 5000);
	}
	doIt();
});