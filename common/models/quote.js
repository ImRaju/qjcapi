module.exports = function(Quote) {
  Quote.validatesUniquenessOf('quoteid', {message: 'quoteid is not unique'});

  Quote.observe('before save', function updateStatusDate(ctx, next) {
    console.log("quote data: %o",ctx.data);
    if (ctx.data && ctx.data.status){
      ctx.data.statusdate=new Date();
    }
    if(ctx.isNewInstance){
      ctx.instance._value={"pending":0,"itemtotal":0,"discount":ctx.instance._discount.cdiscount,
        "charge":ctx.instance._paymode.charge+ctx.instance.shippingrate,"return":0,"total":0};
      ctx.instance.unsetAttribute('id');
      ctx.instance.status="pending";
      ctx.instance.created=new Date();
      if(ctx.instance.expires<new Date()){
        var err=new Error("Expire date is not valid");
        err.statusCode=403;
        next(err);
      }
    }else if(ctx.instance){
      var ci=ctx.instance;
      var total = ci._value.itemtotal-ci._discount.cdiscount+ci.shippingrate+ci._paymode.charge-ci._value.return;
      ctx.instance._value={"pending":ci._value.pending,"itemtotal":ci._value.itemtotal,"discount":ci._discount.cdiscount,
        "charge":ci._paymode.charge+ci.shippingrate,"return":ci._value.return,"total":total};
      console.log("filing value for quote");
    }else if(ctx.currentInstance){
      var ci=ctx.currentInstance;
      var shippingrate=ci.shippingrate;
      if(ctx.data.shippingrate||ctx.data.shippingrate==0)
        shippingrate=ctx.data.shippingrate;
      var total = ci._value.itemtotal-ci._discount.cdiscount+shippingrate+ci._paymode.charge-ci._value.return;
      if(ctx.data._value){
        total = ctx.data._value.itemtotal-ci._discount.cdiscount+shippingrate+ci._paymode.charge-ctx.data._value.return;
        ctx.data._value={"pending":ci._value.pending,"itemtotal":ctx.data._value.itemtotal,"discount":ci._discount.cdiscount,
          "charge":ci._paymode.charge+shippingrate,"return":ctx.data._value.return,"total":total};
      }else{
        ctx.data._value={"pending":ci._value.pending,"itemtotal":ci._value.itemtotal,"discount":ci._discount.cdiscount,
          "charge":ci._paymode.charge+shippingrate,"return":ci._value.return,"total":total};
      }
    }
    next();
  });

  //remote methods for quote confirm/ shipping/ cancel
  Quote.remoteMethod(
    'status',
    {
      http: {path: '/:id/status', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'status', type: 'string', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'update quote status'
    }
  );
  Quote.status = function(id,status,next){
    console.log("quote status update");
    Quote.findById(id, function(err,q){
      if(err) next(err);
      if(status=="confirm"){
        //can confirm only pending quotes
        if(q.status!="pending"){
          var err=new Error("can confirm only pending quotes");
          err.statusCode=403;
          next(err);
        }else{
          q.updateAttributes({"status":status}, function(err, instance){
            if(err) next(err);
            console.log("updated quote to confirm");
            if(!err) next(null, instance);
          });
        }
      }else if(status=="ship"){
        //if shipping change all pending items to shipped
        q.quoteitems(function(err, qitems){
          if(err) next(err);
          //create shipment.
          var sObj={"type":"quote","logistic":q.logistic,"_customer":q._customer,"address":q.shipping,
            "quoteId":q.id};
          Quote.app.models.Shipment.create(sObj, function(err, shipment){
            if(err) next(err);
            qitems.forEach(function(i){
              if(i.status=="pending"){
                i.updateAttributes({"status":"shipped","shipmentId":shipment.id},function(err,instance){
                  if(err) next(err);
                });
              };
            });
            //do not know if all items are already successfully update, get headers sent error
            next();
          });
        });
      }else if(status=="cancel"){
        //can cancel confirm, if all items pending
        if(q.status=="confirm"){
          var can=true;
          q.quoteitems(function(err, qitems){
            if(err) next(err);
            qitems.forEach(function(i){
              if(i.status!="pending"){
                can=false;
              };
            });
            if(can){
              q.updateAttributes({"status":status}, function(err, instance){
                if(err) next(err);
                if(!err) next(null, instance);
              });
            }else{
              var err=new Error("can not cancel as items are shipped/returned ");
              err.statusCode=403;next(err);
            }
          });
        //can cancel pending quotes
        }else if(q.status=="pending"){
          q.updateAttributes({"status":status}, function(err, instance){
            if(err) next(err);
            if(!err) next(null, instance);
          });
        }else{
          var err=new Error("can not cancel quote with status ",q.status);
          err.statusCode=403;next(err);
        }
      }else if(status=="converted"){
        //can convert only non converted quotes
        if(q.status=="converted"){
          var err=new Error("quote already converted");
          err.statusCode=403;
          next(err);
        }else{
          q.updateAttributes({"status":status}, function(err, instance){
            if(err) next(err);
            if(!err) next(null, instance);
          });
        }
      }else{
        //exit invalid status
        var err=new Error("invalid status code ",status);
        err.statusCode=403;next(err);
      }
    });
  };

  //TODO give remote method to convert quote to order
  //pending and confirm quote directly converts, copy q->o qi->oi
  //get transaction object in data. set base quote
  //inprocess quote converts with mapping shipments to order, all qi->oi

  //TODO optional a method to change shippingrate
  Quote.remoteMethod(
    'shippingrate',
    {
      http: {path: '/:id/shippingrate', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'shippingrate', type: 'Number', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'update shippingrate'
    }
  );
  Quote.shippingrate = function(id,shippingrate,next){
    if(shippingrate<0){
      var err=new Error("shippingrate must be greater equal 0")
      next(err);
    }else{
      Quote.findById(id, function(err,q){
        if(err) next(err);
        if(q.activ){
          q.updateAttributes({"shippingrate":shippingrate}, function(ctx, instance){
          if(err) next(err);
          if(!err) next(null, instance);
          });
        }else{
          var err= new Error("Quote is not active");
          next(err);
        }   
      })
    }  
  }
  
  Quote.disableRemoteMethod("upsert",true);
  //not allowing update to quote
  Quote.disableRemoteMethod("updateAttributes",false);
  Quote.disableRemoteMethod("deleteById",true);
  Quote.disableRemoteMethod("__create__billing",false);
  Quote.disableRemoteMethod("__destroy__billing",false);
  Quote.disableRemoteMethod("__create__customer",false);
  Quote.disableRemoteMethod("__destroy__customer",false);
  Quote.disableRemoteMethod("__create__discount",false);
  Quote.disableRemoteMethod("__destroy__discount",false);
  Quote.disableRemoteMethod("__create__paymode",false);
  Quote.disableRemoteMethod("__destroy__paymode",false);
  Quote.disableRemoteMethod("__findById__quoteitems",false);
  Quote.disableRemoteMethod("__updateById__quoteitems",false);
  Quote.disableRemoteMethod("__create__shipping",false);
  Quote.disableRemoteMethod("__destroy__shipping",false);
  Quote.disableRemoteMethod("__create__value",false);
  Quote.disableRemoteMethod("__update__value",false);
  Quote.disableRemoteMethod("__destroy__value",false);
  Quote.disableRemoteMethod("__delete__quoteitems",false);
  Quote.disableRemoteMethod("__delete__shipments",false);
  Quote.disableRemoteMethod("__findById__shipments",false);
  Quote.disableRemoteMethod("__updateById__shipments",false);
  Quote.disableRemoteMethod("__destroyById__shipments",false);
  Quote.disableRemoteMethod("createChangeStream",true);
  Quote.disableRemoteMethod("createChangeStream__0",true);
  Quote.disableRemoteMethod("updateAll",true);
};
