module.exports = function(Orderitem) {

  Orderitem.disableRemoteMethod('upsert',true);
  Orderitem.disableRemoteMethod('create',true);
  Orderitem.disableRemoteMethod('updateAttributes',false);
  Orderitem.disableRemoteMethod('deleteById',true);
  Orderitem.disableRemoteMethod('__create__orderitemlogs',false);
  Orderitem.disableRemoteMethod('__delete__orderitemlogs',false);
  Orderitem.disableRemoteMethod('__updateById__orderitemlogs',false);
  Orderitem.disableRemoteMethod('__destroyById__orderitemlogs',false);
  Orderitem.disableRemoteMethod('__count__orderitemlogs',false);
  Orderitem.disableRemoteMethod('createChangeStream',true);
  Orderitem.disableRemoteMethod('createChangeStream__0',true);
  Orderitem.disableRemoteMethod('updateAll',true);

  Orderitem.observe('before save', function beforeSave(ctx, next){
    //ctx.hookState.before=ctx.currentInstance;
    ctx.hookState.value=(ctx.currentInstance)?ctx.currentInstance.value:"";
    ctx.hookState.ostatus=(ctx.currentInstance)?ctx.currentInstance.status:"";
    //check for illegal status updates. dont log stock.
    if(ctx.isNewInstance){
      ctx.instance.status="pending";
      ctx.instance.created=new Date();
      ctx.instance.unsetAttribute('id');
    }
    if(ctx.currentInstance){
      //initialize orderitemlog before object
      var ci=ctx.currentInstance;
      var before={};
      console.log(ci.__data)
      for(var key in ci.__data){
        if(ci.__data.hasOwnProperty(key)){
          before[key]=ci.__data[key]
        }
      }
      ctx.hookState.before=before;
    }
    if(ctx.data && ctx.data.status){
      ctx.data.statusdate=new Date();
      var status=ctx.data.status;
      var valids=["pending","cancel","shipped","return"];
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

  Orderitem.observe('after save', function afterSave(ctx, next){
    var ostatus=ctx.hookState.ostatus;
    var ovalue=ctx.hookState.value;
    var vreturn=0;var skucode=""; var reason="";var vpending=0;
    ctx.instance.order(function(err,order){
      if(err) next(err);
      console.log("orderitem after save: fetched order object",order.id);
      var oObj={"discount":order.value().discount,"charge":order.value().charge};
      //check if status changed to special value for stock log update
      if(ctx.instance.status!=ostatus && ctx.instance.status!="shipped"){
        if(ctx.instance.status==="return"){
          vreturn=ctx.instance.value;
          console.log("adding return ",vreturn);
          // retorder
          reason="retorder";
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
        // change order subtotal. other order triggers
        oObj["pending"]=Number((order.value().pending+vpending-vreturn).toFixed(2));
        oObj["shipped"]=Number((order.value().shipped-vreturn).toFixed(2));
        oObj["return"]=Number((order.value().return+vreturn).toFixed(2));
        //oObj["total"]=oObj["shipped"]-oObj["discount"]+oObj["charge"]-oObj["return"];
        console.log("value present",order.value());
        console.log("value obj",oObj);
        //no update to order status
        var status=order.status;
        order.updateAttributes({"_value":oObj,"status":status},function(err,ovalue){
          if(err) next(err);
          console.log("updated order value", ovalue._value);
          if(skucode){
            console.log("log stock for orderitem skucode",skucode);
            Orderitem.app.models.Stock.log(
              skucode,reason,ctx.instance.id,ctx.instance.qty,0,
              "orderitem "+ctx.instance.status,ctx.instance.price,0,order.customer().email
              ,function(err,instance){
                if(err) next(err);
            });
          }
        });
      }else{
        if(ctx.instance.status=="pending" && ctx.instance.value!=ovalue){
          ctx.instance.order(function(err,order){
            var oObj={"discount":order.value().discount,"charge":order.value().charge,
            "shipped":order.value().shipped,"return":order.value().return};
            oObj["pending"]=Number((order.value().pending-ovalue+ctx.instance.value).toFixed(2));
            order.updateAttributes({"_value":oObj},function(err,instance){
              if(err) next(err)
            })
          }) 
        }
      }
    })
    //orderitemlog
    var before=ctx.hookState.before;var after=ctx.instance;
    ctx.instance.orderitemlogs.create({"before":before,"after":after,logdate:new Date(),"orderId":ctx.instance.orderId},
      function(err,instance){
        if(err) next(err);
        if(!err) next(null, instance);
      });
  });
  
  Orderitem.observe('before delete', function beforeDelete(ctx, next) {
  var ci=ctx.instance;
  if(ci.status!="pending"){
    var err= new Error("only pending orderitems can be deleted");
    err.status=403;
    next(err);
  }
  next();
  });

  Orderitem.observe('after delete', function afterDelete(ctx, next) {
    var ci=ctx.instance;
    ci.order(function(err,o){
      if(err) next(err)
      var oObj={"discount":o.value().discount,"charge":o.value().charge,"shipped":o.value().shipped,"return":o.value().return};
      oObj["pending"]=Number((o.value().pending-ci.value).toFixed(2));
      o.updateAttributes({"_value":oObj}, function(err,ovalue){
        if(err) next(err);
      })
    })
    next(); 
  });

  Orderitem.status=function(id,oitems,shipmentId,cid,next){
    var vshipped=0; var vreturn=0;var skucode=""; var reason="";
    var shipitems=[];
    var loop= oitems.length;
    oitems.forEach(function(oitem,index,oitems){
      if(oitem.status=='pending'){
        if(oitem.skucode===oitem.productcode){
          skucode=oitem.productcode;
        }else{
          skucode=oitem.skucode
        }
        if(skucode){
          console.log("log stock for orderitem skucode",skucode);
          Orderitem.app.models.Stock.log(skucode,"toorder",oitem.id,oitem.qty,0,
            "orderitem shipped ",oitem.price,0,cid
            ,function(err,instance){
              if(err) next(err);
              else{
                oitem.updateAttributes({"status":"shipped","shipmentId":shipmentId}, function(err,success){
                  if(err) console.log(err);
                  else{
                    vshipped+=oitem.value;
                    shipitems.push(success.id);
                    loop--;
                    if(!loop/*index===oitems.length-1*/){
                      return next(null, vshipped, shipitems);
                    }
                  }
                })
              }
          });
        }
      }else{
        console.log("only pending orderitems can be shipped");
        loop--;
      }
    })
  }
      /*oitems.forEach(function(i){
        if(i.status=='pending'){
          i.updateAttributes({"status":"shipped","shipmentId":shipmentId}, function(err,oitem){
            if(err) console.log(err);
            vshipped+=oitem.value;
            // toorder
            reason="toorder";
            //condition or it being plain. ds or quote order
            // if(oitem.quoteitemId) reason="quoteorder";
            // if(order.dropshipper) reason="dsorder";
            if(oitem.skucode===oitem.productcode){
              //is product.
              skucode=oitem.productcode;
            }else{
              //is sku.
              skucode=oitem.skucode;
            }
            if(skucode){
              console.log("log stock for orderitem skucode",skucode);
              Orderitem.app.models.Stock.log(
                skucode,reason,oitem.id,oitem.qty,0,
                "order "+oitem.status,oitem.price,0,order.customer().id
                ,function(err,instance){
                  if(err) next(err);
              });
            }
            loop--;
            if(!loop){
              var oObj=order._value;
              oObj["pending"]=order.value().pending-vshipped;
              oObj["shipped"]=order.value().shipped+vshipped;
              order.updateAttributes({"_value":oObj,"status":"inprocess"},function(err,ovalue){
                if(err) next(err);
                console.log("updated order value", ovalue._value);
                next(null,oitem);
              })            
            }
          })
        }else{
          loop--;
        }
      });*/
    /*});
  }*/
  

  Orderitem.remoteMethod(
    'updateQuantity',
    {
      http: {path: '/:id/updateQuantity', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'qty', type: 'number', required: true},
        {arg: 'value', type: 'number', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'update order items quantity'
    }
  );
  Orderitem.updateQuantity = function(id,qty,value,next) {
    Orderitem.findById(id,function(err,oitem){
      if(err) next(err)
      if(oitem.qty==qty){
        var err= new Error("qty must be different from previous quantity");
        err.statusCode=403;
        next(err);
      }else if(oitem.status!="pending"){
        var err= new Error("only pending order items quantity can be updated");
        err.statusCode=403;
        next(err);
      }else{
        oitem.updateAttributes({"qty":qty,"value":value},function(err,data){
          if(err) next(err);
          next(null,data)
        })
      }
    })
  }

  Orderitem.remoteMethod(
    'updprice',
    {
      http: {path: '/:id/updprice', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'price', type: 'number', required: true},
        {arg: 'value', type: 'number', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'update order items price'
    }
  );
  Orderitem.updprice = function(id,price,value,next) {
    Orderitem.findById(id,function(err,oitem){
      if(err) next(err)
      if(oitem.price==price){
        var err= new Error("price must be different from previous ");
        err.statusCode=403;
        next(err);
      }else if(oitem.status!="pending"){
        var err= new Error("only pending order items price can be updated");
        err.statusCode=403;
        next(err);
      }else{
        oitem.updateAttributes({"price":price,"value":value},function(err,data){
          if(err) next(err);
          next(null,data)
        })
      }
    })
  }
  //new method for order item returns
  Orderitem.remoteMethod(
    'return',
    {
      http: {path: '/:id/return', verb: 'put'},
      accepts: [
      {arg: 'id', type: 'string', required: true},
      {arg: 'qty', type: 'number', required: true},
      {arg: 'value', type: 'number', required: true},
    ],
    returns: {root: true, type: 'object'},
    description: 'return order item'
    }
  );
  Orderitem.return =function(id,qty,value,next) {
    Orderitem.findById(id, function(err,oitem){
      if(err) next(err);
      if(oitem.status=='shipped'){
        oitem.order({include:{relation:"orderitems",scope:{
          fields:["status","qty","value"],where:{skucode:oitem.skucode}
        }}},function(err,order){
          if(err) next(err);
          console.log("found oitem orderitems", order.orderitems());
          if(order.status!="confirm" && order.status!="inprocess"){
            var err=new Error("only confirm or inprocess orders' items can be processed");
            err.statusdate=403;
            next(err);
          }else{
            var tqty=0;
            order.orderitems().forEach(function(i){
              if(i.status=="shipped") tqty+=i.qty;
              if(i.status=="return") tqty-=i.qty;
            });
            if(tqty<qty){
              var err=new Error("can not return more than shipped qty");
              err.statusCode=403;
              next(err);
            }else{
              var oiObj=oitem;
              oiObj["qty"]=qty;
              oiObj["value"]=value;
              Orderitem.create(oiObj,function(err,noitem){
                if(err) next(err);
                noitem.updateAttributes({"status":"return"},function(err,instance){
                  if(err) next(err);
                  else next(null,instance);
                });
              })
            }
          }
        });
      }else{
        var err= new Error("only shipped order items can be returned");
        err.statusCode=403;
        next(err);
      }
    });
  }
//to-do: check all correction & changes before uncomment
/*  Orderitem.remoteMethod(
    'shipped',
    {
      http: {path: '/:id/shipped', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'mark order item as shipped'
    }
  );
  Orderitem.shipped = function(id,next) {
    var oitems=[];
    Orderitem.findById(id, function(err, oitem){
      if(err) next(err);
      if(!oitem){
        var err=new Error("no such order item");
        err.statusCode=403;
        next(err);
      }
      else if(oitem.status!="pending"){
        console.log("order item status can not be changed from ",oitem.status);
        var err= new Error("order item is processed, can not update status now.");
        err.statusCode=403;
        next(err);
      }else{
      //find related order
        oitem.order(function(err, order){
          if(err) next(err);
          if(order.status!="confirm" && order.status!="inprocess"){
            var err= new Error("only confirm or inprocess orders' items can be processed");
            err.statusCode=403;
            next(err);
          }else{
          //create shipment with orderitem.
          var sObj={"type":"order","logistic":order.logistic,"_customer":order._customer,"address":order.shipping,
              "orderId":order.id};
          Orderitem.app.models.Shipment.create(sObj, function(err, shipment){
            if(err) next(err);
            oitems.push(oitem);
            Orderitem.status(order.id,oitems,shipment.id, function(err, obj){
              if(err) next(err);
              else next(null, obj)
            })
          });
          }
        });
      }
    });
  }*/
};
