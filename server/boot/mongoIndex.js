module.exports = function(server) {
  require('events').EventEmitter.defaultMaxListeners = Infinity;
  //To Fix warning : (node) warning: possible EventEmitter memory leak detected.
  var ds = server.dataSources.mongoDS;
  var models=['product','price','media','sku','stock','stocklog','order','orderlog',
		'orderitem','orderitemlog','shipment','transaction','transactionlog']
	ds.autoupdate(models, function (err,done) {
	  if(err) console.log(err);
	  else console.log("index created for models ", models);
	});
};
