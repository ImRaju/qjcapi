module.exports = function(Quoteitem) {

  Quoteitem.disableRemoteMethod('upsert',true);
  Quoteitem.disableRemoteMethod('create',true);
  Quoteitem.disableRemoteMethod('updateAttributes',false);
  Quoteitem.disableRemoteMethod('deleteById',true);
  Quoteitem.disableRemoteMethod('createChangeStream',true);
  Quoteitem.disableRemoteMethod('createChangeStream__0',true);
  Quoteitem.disableRemoteMethod('updateAll',true);
  
  Quoteitem.observe('before save', function beforeSave(ctx, next){
    ctx.hookState.ostatus=(ctx.currentInstance)?ctx.currentInstance.status:"";
    //check for illegal status updates. dont log stock.
    if(ctx.isNewInstance){
      ctx.instance.created=new Date();
      ctx.instance.unsetAttribute('id');
    }
    if(ctx.data && ctx.data.status){
      ctx.data.statusdate=new Date();
      var status=ctx.data.status;
      var valids=["pending","shipped","return"];
      if(valids.indexOf(status)==-1){
        var err=new Error("invalid status code");err.status=403;
        return next(err);
      }
      if(!ctx.isNewInstance&&ctx.currentInstance&&ctx.currentInstance.status!="pending"){
        var err=new Error("can not change from status: "+ctx.hookState.ostatus);err.status=403;
        return next(err);
      }
    }
    next();
  });

  Quoteitem.observe('after save', function afterSave(ctx, next){
    var ostatus=ctx.hookState.ostatus;
    var vshipped=0; var vreturn=0;var skucode="";var reason="";var vpending=0;
    //check if status changed to special value for stock log update
    if(ctx.instance.status!=ostatus){
      if(ctx.instance.status==="shipped"){
        vshipped=ctx.instance.value;
        console.log("QI adding shipped",vshipped);
        // toquote
        reason="toquote";
        if(ctx.instance.skucode===ctx.instance.productcode){
          //is product.
          skucode=ctx.instance.productcode;
        }else{
          //is sku.
          skucode=ctx.instance.skucode;
        }
      }else if(ctx.instance.status==="return"){
        vreturn=ctx.instance.value;
        console.log("QI adding return ",vreturn);
        // retquote
        reason="retquote";
        if(ctx.instance.skucode===ctx.instance.productcode){
          //is product.
          skucode=ctx.instance.productcode;
        }else{
          //is sku.
          skucode=ctx.instance.skucode;
        }
      }else if(ctx.instance.status==="pending"){
        vpending=ctx.instance.value;
      }
      ctx.instance.quote(function(err,quote){
        if(err) next(err);
        console.log("QI fetched quote object for ",quote.id);
        var qObj={"discount":quote.value().discount,"charge":quote.value().charge};
        // change quote subtotal.
        qObj["pending"]=quote.value().pending+vpending;
        qObj["itemtotal"]=quote.value().itemtotal+vshipped-vreturn;
        qObj["return"]=quote.value().return+vreturn;
        qObj["total"]=qObj["itemtotal"]-qObj["discount"]+qObj["charge"]-qObj["return"];
        //console.log("quote value present",quote.value());
        //console.log("new quote value",qObj);
        //no trigger to quote status update
        var status=quote.status;
        if(vshipped!=0 && quote.status=="confirm") status="inprocess";
        quote.updateAttributes({"_value":qObj,"status":status},function(err,qvalue){
          if(err) next(err);
          console.log("QI updated quote value and status");
          if(skucode){
            Quoteitem.app.models.Stock.log(
              skucode,reason,ctx.instance.id,ctx.instance.qty,0,
              "quote "+ctx.instance.status,ctx.instance.price,0,quote.customer().id
              ,function(err,instance){
                if(err) next(err);
                if(!err) next(null, instance);
              });
          }else{
            next(null, ctx.instance);
          }
        });
      })
    }else{
      next();
    }
  });

  Quoteitem.observe('before delete', function(ctx,next){
    //in case of single quote item being deleted
    if(ctx.instance && ctx.instance.status!='pending'){
      //accept only pending quote items to be deleted.
      var err=new Error("Can not delete ",ctx.instance.status," quote item");
      err.statusCode=403;
      console.log("denied deletion of quoteitem ",ctx.instance.id);
      next(err);
    }
  });
  //give method to change status
  Quoteitem.remoteMethod(
    'status',
    {
      http: {path: '/:id/status', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'status', type: 'string', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'update quote item status'
    }
  );
  Quoteitem.status = function(id,status,next) {
    console.log("quoteitem.statusupdate");
    Quoteitem.findById(id, function(err, qitem){
      if(err) next(err);
      if(!qitem){
        var err=new Error("no such quote item");
        err.statusCode=403;
        next(err);
      }
      if(qitem.status!="pending"){
        console.log("quote item status can not be changed from ",qitem.status);
        var err= new Error("quote item is processed, can not update status now.");
        err.statusCode=403;
        next(err);
      }else{
        if(status=="return"){
          qitem.quote({include:{relation:"quoteitems",scope:{
            fields:["status","qty","value"],where:{skucode:qitem.skucode}
          }}},function(err, quote){
            if(err) next(err);
            console.log("QI.status found quote&items for quote ", quote.id);
            if(quote.status!="confirm" && quote.status!="inprocess"){
              var err= new Error("only confirm or inprocess quotes' items can be processed");
              err.statusCode=403;
              next(err);
            }else{
              var qty=0;
              quote.quoteitems().forEach(function(i){
                if(i.status=="shipped") qty+=i.qty;
                if(i.status=="return") qty-=i.qty;
              });
              if(qty<qitem.qty){
                var err=new Error("can not return more than shipped qty");
                err.statusCode=403;
                next(err);
              }else{
                console.log("QI.status updating quoteitem returned ",qitem.id);
                qitem.updateAttributes({"status":status}, function(ctx, instance){
                  if(err) next(err);
                  if(!err) next(null, instance);
                });
              }
            }
          });
        }else if(status=="shipped"){
          //find related quote
          qitem.quote(function(err, quote){
            if(err) next(err);
            //create shipment with quoteitem.
            var sObj={"type":"quote","logistic":quote.logistic,"_customer":quote._customer,"address":quote.shipping,
              "quoteId":quote.id};
            console.log("QI.status creating shipment for quote ", quote.id);
            Quoteitem.app.models.Shipment.create(sObj, function(err, shipment){
              if(err) next(err);
              console.log("QI.status updating quoteitem shipped ",qitem.id);
              qitem.updateAttributes({"status":status,"shipmentId":shipment.id}, function(ctx, instance){
                if(err) next(err);
                if(!err) next(null, instance);
              });
            });
          });
        }else{
          var err= new Error("invalid status code");
          err.statusCode=403;
          next(err);
        }
      }
    });
  }
};
