module.exports = function(Shipment) {
  Shipment.disableRemoteMethod('upsert',true);
  Shipment.disableRemoteMethod('create',true);
  Shipment.disableRemoteMethod('updateAttributes',false);
  Shipment.disableRemoteMethod('deleteById',true);
  Shipment.disableRemoteMethod('createChangeStream',true);
  Shipment.disableRemoteMethod('createChangeStream__0',true);
  Shipment.disableRemoteMethod('updateAll',true);

  Shipment.observe('before save', function beforeSave(ctx,next){
    ctx.hookState.status=(ctx.currentInstance)?ctx.currentInstance.status:"";
    ctx.hookState.shipdate=(ctx.data)?ctx.data.shipdate:"";
    next();
  })
  Shipment.observe('after save', function afterSave(ctx,next){
    var status= ctx.hookState.status;
    var shipdate= ctx.hookState.shipdate
    var shipstatus="";
    var oObj={};
    var ometa={};
    Shipment.app.models.order.findById(ctx.instance.orderId,{include:['orderitems','shipments']},function(err,o){
      if(status && ctx.instance.status!=status && ctx.instance.status!="pending"){
        shipstatus="shipped";
        o.shipments().forEach(function(s){
          if(s.status=="pending")
            shipstatus="partshipped"
        })
        o.orderitems().forEach(function(oi){
          if(oi.status=="pending")
            shipstatus="partshipped";
        })
        if(o.shipstatus!=shipstatus){
          oObj["shipstatus"]=shipstatus;
        }
      }
      if(shipdate  && (o.channel=="dropship"||o.channel=="wholesale")){
        var cdays= o._customer.creditdays;
        if(o.meta)
          ometa=o.meta;
        ometa["duedate"]= new Date(shipdate.setTime( shipdate.getTime() + cdays * 86400000 ));
        oObj["meta"]=ometa;
      }
      if(Object.keys(oObj).length){
          console.log("updating order value: ",oObj);
          o.updateAttributes(oObj, function(err){
            if(err) console.log(err);
          })
        }
      })
    next();
  })

  Shipment.remoteMethod(  
    'tracking',
    {
      http: {path: '/:id/tracking', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'trackingurl', type: 'string', required: false},
        {arg: 'label', type: 'string', required: false},
        {arg: 'trackingref', type: 'string', required: false},
        {arg: 'status', type: 'string', required: false},
        {arg: 'shipdate', type: 'date', required: false},
      ],
      returns: {root: true, type: 'object'},
      description: 'update shipment'
    }
  );
  Shipment.tracking = function(id, trackingurl, label, trackingref, status, shipdate, next){
  	var sObj={"trackingurl":trackingurl, "label":label, "trackingref":trackingref, "status":status};
    Shipment.findById(id, function(err, s){
      if(shipdate){
        //Note: don't know why shipdate is invalid when pannel user pass it blank.
        if(isNaN( shipdate.getTime())){
          var err= new Error("shipdate is not valid");
          err.status= 403;
          return next(err);
        }else{
          var sdate= shipdate.getTime();
          var osdate= s.shipdate.getTime();
          if(sdate!=osdate)
            sObj["shipdate"]=shipdate;
        }
      }
      s.updateAttributes(sObj, function(err, instance){
  	  	if(err)next(err);
  	  	next(null, instance);
  	  })
  	})
  }
}