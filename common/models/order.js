var Promise = require('bluebird');
module.exports = function(Order) {
  Order.validatesUniquenessOf('orderid', {message: 'orderid is not unique'});
  
  Order.observe('before save', function updateStatusDate(ctx, next) {
    //ctx.hookState.before=ctx.currentInstance;
    /*if (ctx.data && ctx.data.status){
      console.log("order d: %o",ctx.data);
      ctx.data.statusdate=new Date();
    }*/
    var discount=0;

    if(ctx.isNewInstance){
      //punch pending item value
      var ci=ctx.instance;
      if(!ci.channel) ci.channel="retail";
      ci.txnstatus="pending";
      if(ci._discount && ci._discount.cdiscount)
        discount=ci._discount.cdiscount;
      if(ci._discount && ci._discount.adiscount)
        discount= discount+ci._discount.adiscount;
      if(!ci.tax)  ci.tax=0; 
      ci._value={"pending":0,"shipped":0,"discount":discount,"charge":ci._paymode.charge+ci.shippingrate+ci.tax,
        "return":0,"txntotal":0,"total":0,"gtotal":0};
      ci.unsetAttribute('id');
      ci.shipstatus="pending";
      if(ci.status!="draft"){
        ci.status="pending";
      }
      ci.created=new Date();
    }else if(ctx.instance){
      var ci=ctx.instance;
      if(ci._discount && ci._discount.cdiscount)
        discount=ci._discount.cdiscount;
      if(ci._discount && ci._discount.adiscount)
        discount= discount+ci._discount.adiscount;
      var total = ci._value.shipped-discount+ci.shippingrate+ci._paymode.charge;
      var gtotal= total+ci._value.pending;
      total=Number(total.toFixed(2));
      gtotal=Number(gtotal.toFixed(2));
      ctx.instance._value={"pending":ci._value.pending,"shipped":ci._value.shipped,"discount":discount,
        "charge":ci._paymode.charge+ci.shippingrate+ci.tax,"return":ci._value.return,"txntotal":ci._value.txntotal,"total":total,"gtotal":gtotal};
      if(ci._value.txntotal>0){
        if(ci._value.txntotal<gtotal )
          ci.txnstatus="partpaid";
        else if(ci._value.txntotal>gtotal)
          ci.txnstatus="overpaid";
        else if(ci._value.txntotal==gtotal)
          ci.txnstatus="paid";
      }
      console.log("order ci value",ctx.instance._value);
    }else if(ctx.currentInstance){
      //updateAttributes needs this
      var ci=ctx.currentInstance;
      var shippingrate=ci.shippingrate;
      if(ctx.data.shippingrate||ctx.data.shippingrate==0)
        shippingrate=ctx.data.shippingrate;
      if(ci._discount && ci._discount.cdiscount)
        discount=ci._discount.cdiscount;
      if(ci._discount && ci._discount.adiscount)
        discount= discount+ci._discount.adiscount;
      var total = ci._value.shipped-discount+shippingrate+ci._paymode.charge;
      var gtotal= total+ci._value.pending;
      total=Number(total.toFixed(2));
      gtotal=Number(gtotal.toFixed(2));
      if(ctx.data._value){
        total = ctx.data._value.shipped-discount+shippingrate+ci.tax+ci._paymode.charge;
        gtotal = total+ctx.data._value.pending;
        total=Number(total.toFixed(2));
        gtotal=Number(gtotal.toFixed(2));
        ctx.data._value={"pending":ctx.data._value.pending,"shipped":ctx.data._value.shipped,"discount":discount,
          "charge":ci._paymode.charge+shippingrate+ci.tax,"return":ctx.data._value.return,"txntotal":ci._value.txntotal,"total":total,"gtotal":gtotal};
        if(ci._value.txntotal>0){
          if(ci._value.txntotal<gtotal )
            ctx.data.txnstatus="partpaid";
          else if(ci._value.txntotal>gtotal)
            ctx.data.txnstatus="overpaid";
          else if(ci._value.txntotal==gtotal)
            ctx.data.txnstatus="paid";
        }
      }else{
        ctx.data._value={"pending":ci._value.pending,"shipped":ci._value.shipped,"discount":discount,
          "charge":ci._paymode.charge+shippingrate+ci.tax,"return":ci._value.return,"txntotal":ci._value.txntotal,"total":total,"gtotal":gtotal};
        if(ci._value.txntotal>0){
          if(ci._value.txntotal<gtotal )
            ci.txnstatus="partpaid";
          else if(ci._value.txntotal>gtotal)
            ci.txnstatus="overpaid";
          else if(ci._value.txntotal==gtotal)
            ci.txnstatus="paid";
        }
      }
      console.log("order cci value",ctx.data._value);
      //initialize orderlog before object
      var before={};
      for(var key in ci.__data){
        if(ci.__data.hasOwnProperty(key)){
          before[key]=ci.__data[key]
        }
      }
      ctx.hookState.before=before;
    }
    next();
  });

  Order.observe('after save', function afterSave(ctx,next){
    //orderlog
    var before=ctx.hookState.before;var after=ctx.instance;
    ctx.instance.orderlogs.create({"before":before,"after":after,logdate:new Date()},
      function(err,instance){
        if(err) next(err);
      });
    next();
  });

  //method to confirm/ ship/ settle/ cancel order
  Order.remoteMethod(
    'status',
    {
      http: {path: '/:id/status', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'status', type: 'string', required: true},
        {arg: 'statusdate', type: 'date', required: false},
      ],
      returns: {root: true, type: 'object'},
      description: 'update order status'
    }
  );
  Order.status = function(id,status,statusdate,next){
    console.log("order status update");
    var sdate = new Date;
    if(statusdate) sdate= statusdate;
    Order.findById(id, function(err,o){
      if(err) next(err);
      if(status=="confirm"){
        var ecount=0;
        //can confirm only pending orders
        if(o.status!="pending"){
          var err=new Error("can confirm only pending orders");
          err.statusCode=403;
          next(err);
        }else{
          o.orderitems(function(err,oitems){
            if(err) next(err);
            var promises= oitems.map(function(oitem){
              return Order.app.models.stock.findOne({"where":{"skucode":oitem.skucode}}).then(function(ostock){
                if(!ostock){
                  var err= new Error("stock not found for sku "+oitem.skucode);
                  err.status= 404;
                  throw err;
                }else if(ostock && oitem.qty>ostock._qty.forsale){
                  var err= new Error("no forsale qty for sku "+ostock.skucode);
                  err.status= 400;
                  throw err;
                }
              },function(err){
                throw err;
              })
            })
            Promise.all(promises).then(function(){
              oitems.forEach(function(oitem2,index2,oitems){
                if(oitem2.status=="pending"){
                  Order.app.models.Stock.log(oitem2.skucode,"ordered",oitem2.id,oitem2.qty,0,"order "+status,oitem2.price,0,
                    o.customer().email,function(err,instance){
                      if(err) return next(err);
                      else if(index2==oitems.length-1){
                        o.updateAttributes({"status":status,"statusdate":sdate}, function(err, instance){
                          if(err) next(err);
                          if(!err) next(null, instance);
                        });
                      }
                  });
                }
              })
            },function(err){
              return next(err);
            })
          })
          /*o.orderitems(function(err,oitems){
            if(err) next(err);
            oitems.forEach(function(oitem,index,oitems){
              Order.app.models.stock.findOne({"where":{"skucode":oitem.skucode}},function(err,ostock){
                if(err) return next(err);
                else if(ostock && ostock._qty.forsale<oitem.qty){
                  var err=new Error("no forsale qty for sku"+ostock.skucode);
                  err.statusCode=400;
                  ecount++;
                  return next(err);
                }else if(index===oitems.length-1 && !ecount){
                  oitems.forEach(function(oitem2,index2,oitems){
                    if(oitem2.status=="pending"){
                      Order.app.models.Stock.log(oitem2.skucode,"ordered",oitem2.id,oitem2.qty,0,"order "+status,oitem2.price,0,
                        o.customer().email,function(err,instance){
                          if(err) return next(err);
                          else if(index2==oitems.length-1){
                            o.updateAttributes({"status":status,"statusdate":sdate}, function(err, instance){
                              if(err) console.log(err);
                              if(!err) next(null, instance);
                            });
                          }
                      });
                    }
                  })
                }
              })
            })
          }) */
        }
      }else if(status=="ship"){
        if(o.status!="confirm" && o.status!="inprocess"){
          var err= new Error("only confirm or inprocess orders' items can be processed");
          err.statusCode=403;
          next(err);
        }else{
          //if shipping change all pending items to shipped
          o.orderitems(function(err, oitems){
            if(err) next(err);
            //create shipment.
            var sObj={"type":"order","logistic":o.logistic,"_customer":o._customer,"address":o.shipping,
              "shipdate":sdate, "orderId":o.id};
            Order.app.models.Shipment.create(sObj, function(err, shipment){
              if(err) next(err);
              Order.app.models.orderitem.status(o.id,oitems,shipment.id,o.customer().email, function(err,vshipped){
                if(err) next(err);
                else{
                  var ovObj=o.value();
                  ovObj["pending"]=Number((o.value().pending-vshipped).toFixed(2));
                  ovObj["shipped"]=Number((o.value().shipped+vshipped).toFixed(2));
                  var oObj={"status":"inprocess","statusdate":sdate, "_value":ovObj};
                  if(o.channel=="dropship"||o.channel=="wholesale"){
                    var cdays= o._customer.creditdays;
                    var ometa={};
                    if(o.meta)
                      ometa=o.meta;
                    ometa["duedate"]= new Date(sdate.setTime( sdate.getTime() + cdays * 86400000 ));
                    oObj["meta"]=ometa;
                  }
                  o.updateAttributes(oObj, function(err,instance){
                    if(err) next(err);
                    else next(null,instance);
                  })
                }
              })
            });
          });
        }
      }else if(status=="cancel"){
        //can cancel confirm order, if all items pending
        if(o.status=="confirm"){
          var can=true;
          o.orderitems(function(err, oitems){
            if(err) next(err);
            oitems.forEach(function(i){
              if(i.status!="pending"){
                can=false;
              };
            });
            if(can){
              o.updateAttributes({"status":status,"statusdate":sdate}, function(err, instance){
                if(err) next(err);
                if(!err){
                  o.orderitems(function(err,oitems){
                    if(err) next(err);
                    oitems.forEach(function(i){
                      i.updateAttributes({"status":status}, function(err,coi){
                        if(err) next(err);
                        Order.app.models.Stock.log(i.skucode,"cancelorder",i.id,i.qty,0,"order "+status,i.price,0,
                          o.customer().email,function(err,instance){
                            if(err) next(err);
                        });
                      })
                    })
                  })
                  next(null, instance);
                }
              });
            }else{
              var err=new Error("can not cancel as items are shipped/returned ");
              err.statusCode=403;next(err);
            }
          });
        //can cancel pending orders
        }else if(o.status=="pending"){
          o.updateAttributes({"status":status,"statusdate":sdate}, function(err, instance){
            if(err) next(err);
            if(!err){
              o.orderitems(function(err,oitems){
                if(err) next(err);
                oitems.forEach(function(i){
                  i.updateAttributes({"status":status}, function(err,coi){
                    if(err) next(err);
                  })
                })
              })
              next(null, instance);
            }
          });
        }else{
          var err=new Error("can not cancel order with status "+o.status);
          err.statusCode=403;next(err);
        }
      }else if(status=="settled"){
        //can settle confirm/ inprocess order, if all items shipped or returned
        if(o.status=="confirm" || o.status=="inprocess"){
          var can=true;
          o.orderitems(function(err, oitems){
            if(err) next(err);
            oitems.forEach(function(i){
              if(i.status=="pending"){
                can=false;
              };
            });
            if(can){
              o.updateAttributes({"status":status,"statusdate":sdate}, function(err, instance){
                if(err) next(err);
                if(!err) next(null, instance);
              });
            }else{
              var err=new Error("can not settle order as all items are not shipped/returned ");
              err.statusCode=403;next(err);
            }
          });
        }else{
          var err=new Error("can not settle order with status "+o.status);
          err.statusCode=403;next(err);
        }
      }else if(status=="pending"){
        if(o.status=="draft"){
          o.updateAttributes({"status":"pending","statusdate":sdate}, function(err, instance){
            if(err) next(err);
            else next(null, instance);
          })
        }else{
          var err = new Error("can not pending order with status "+o.status);
          err.statusCode=403;next(err);
        }
      }else{
        //exit invalid status
        var err=new Error("invalid status code "+status);
        err.statusCode=403;next(err);
      }
    });
  };

  Order.remoteMethod(
    'logistic',
    {
      http: {path: '/:id/logistic', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'logistic', type: 'string', required: true},
        {arg: 'shippingrate', type: 'Number', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'update logistic'
    }
  );
  Order.logistic = function(id,logistic,shippingrate,next){
    if(shippingrate<0){
      var err=new Error("shippingrate must be greater equal 0")
      next(err);
    }else{
      Order.findById(id, function(err,o){
        if(err) next(err);
        if(o.activ){
          o.updateAttributes({"shippingrate":shippingrate,"logistic":logistic}, function(ctx, instance){
            if(err) next(err);
            if(!err) next(null, instance);
          });
        }else{
          var err= new Error("order is not active");
          next(err);
        }   
      })
    }  
  }

  Order.remoteMethod(
    'total',
    {
      http: {path: '/total', verb: 'get'},
      accepts: [
        {arg: 'channel', type: 'string', required: false},
        {arg: 'group', type: 'string', required: false},
        {arg: 'from', type: 'Date', description: 'yyyy-mm-dd', required: true},
        {arg: 'to', type: 'Date', description: 'yyyy-mm-dd', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'get total value'
    }
  );

  Order.total= function(channel,group,from,to,next){
    var pending=0; var shipped=0; var discount=0; var charge=0; var ret=0; var txntotal=0; var total=0; var gtotal=0;
    var soldqty=0; var skus=[];
    Order.find({"where":{"channel":channel,"_customer.group":group,"created":{"between":[from,to]}},"include":"orderitems"}, function(err,o){
      if(err) next(err);
      o.forEach(function(i){
        i.orderitems().forEach(function(oi){
          if(oi.status=="shipped"){
            soldqty+=oi.qty;
            if(skus.indexOf(oi.skucode)<0)
              skus.push(oi.skucode)
          }
        })
        pending= Number((pending+i._value.pending).toFixed(2))
        shipped= Number((shipped+i._value.shipped).toFixed(2));
        discount= Number((discount+i._value.discount).toFixed(2));
        charge= Number((charge+i._value.charge).toFixed(2));
        ret= Number((ret+i._value.return).toFixed(2));
        txntotal= Number((txntotal+ i._value.txntotal).toFixed(2));
        total= Number((total+i._value.total).toFixed(2));
        gtotal= Number((gtotal+i._value.gtotal).toFixed(2));
      })
      var value={"pending":pending,"shipped":shipped,"discount":discount,"charge":charge,"return":ret,"txntotal":txntotal,"total":total,"gtotal":gtotal, "soldqty":soldqty, "skuunitsold":skus.length};
      next(null,value);
    })
  }
  // adiscount update
  Order.remoteMethod(
    'adiscount',
    {
      http: {path: '/adiscount', verb: 'put'},
      accepts: [
        {arg: 'orderId', type: 'string', required: true},
        {arg: 'adiscount', type: 'Number', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'update admin discount'
    }
  );

  Order.adiscount= function(orderId,adiscount,next){
    var discount={};
    Order.findById(orderId, function(err,o){
      if(err) next(err);
      else if(o){
        if(o._discount)
          discount=o._discount;
        if(adiscount<o._value.gtotal && adiscount>0){
          discount["adiscount"]=adiscount;
          o.updateAttributes({"_discount":discount},function(err,order){
            if(err) next(err);
            else next(null,order)
          })
        }else{
          var err= new Error("discount amount is not valid");
          err.statusCode=403;
          next(err);
        }
      }else{
        var err= new Error("order not found");
        err.statusCode= 404;
        next(err);
      }
    })
  }

  Order.remoteMethod(
    'shipitems',
    {
      http: {path: '/:id/shipitems', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'oitemsid', type: 'array', required: true},
        {arg: 'statusdate', type: 'date', required: false},
      ],
      returns: {root: true, type: 'object'},
      description: 'update logistic'
    }
  );
  Order.shipitems = function(id,oitemsid,statusdate,next){
    var sdate = new Date; var response={};
    if(statusdate) sdate= statusdate;
    Order.findById(id,{"include":{"relation": "orderitems", "scope":{"where":{"id":{"inq":oitemsid}}}}}, function(err,o){
      if(err) next(err);
      if(o.status!="confirm" && o.status!="inprocess"){
        var err= new Error("only confirm or inprocess order can be processed");
        err.statusCode= 403;
        return next(err);
      }
      if(o.orderitems().length){
        var sObj={"type":"order","logistic":o.logistic,"_customer":o._customer,"address":o.shipping,"shipdate":sdate, "orderId":o.id};
        Order.app.models.Shipment.create(sObj, function(err,shipment){
          if(err) next(err);
          else{
            Order.app.models.orderitem.status(o.id,o.orderitems(),shipment.id,o._customer.id,function(err,vshipped,shippeditem){
              if(err) next(err);
              else{
                var ovObj=o.value();
                ovObj["pending"]=Number((o.value().pending-vshipped).toFixed(2));
                ovObj["shipped"]=Number((o.value().shipped+vshipped).toFixed(2));
                var oObj={"status":"inprocess","statusdate":sdate, "_value":ovObj};
                if(o.channel=="dropship"||o.channel=="wholesale"){
                  var cdays= o._customer.creditdays;
                  var ometa={};
                  if(o.meta)
                    ometa=o.meta;
                  ometa["duedate"]= new Date(sdate.setTime( sdate.getTime() + cdays * 86400000 ));
                  oObj["meta"]=ometa;
                }
                /*oitemsid.forEach(function(oi){
                  if(shippeditem.indexOf(oi)==-1){
                    var robj={"id":oi, "msg":"cant process this item", "status":"failed"};
                  }else{
                    var robj={"id":oi, "msg":"item successfully processed", "status":"success"};
                  }
                  response.push(robj)
                })*/
                response={"shipment":shipment, "shippeditems":shippeditem};
                o.updateAttributes(oObj, function(err,instance){
                  if(err) next(err);
                  else next(null,response);
                })
              }
            })
          }
        })  
      }else{
        var err= new Error("orderitems not exist");
        err.statusCode= 403;
        next(err)
      }
    })
  }

  Order.remoteMethod(
    'history',
    {
      http: {path: '/:id/history', verb: 'get'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'get order history'
    }
  );
  Order.history = function(id,next){
    var result=[];
    var lv1={};
    Order.findById(id,{"include":["orderlogs","orderitemlogs"]}, function(err,o){
      if(err) next(err);
      o.orderlogs().forEach(function(i){ 
        var lv2={};
        var after=i.after.__data;
        if(!i.before){
          lv1[i.logdate.toISOString()]={"logtype":"order","msg":"order created"};
        }else{
          var before=i.before.__data;
          lv2["logtype"]="order";
          for(var key in after){
            if(typeof after[key]!=="object"){
              if(before[key]===undefined){
                  lv2[key]={"a":after[key]}
                }else if(after[key]!==before[key]){
                lv2[key]={"b":before[key],"a":after[key]}
              }
            }else{
              var bObj=before[key].__data;
              var aObj=after[key].__data;
              for(var key2 in aObj){
                if(bObj[key2]===undefined){
                  lv2[key+"."+key2]={"a":aObj[key2]}
                }else if(aObj[key2]!==bObj[key2]){
                  lv2[key+"."+key2]={"b":bObj[key2],"a":aObj[key2]}
                }
              }
            }
          }
          lv1[i.logdate.toISOString()]=lv2;
          //result.push(lv1)
        }
      });
      o.orderitemlogs().forEach(function(i){
        //var lv1={};
        var lv2={};
        var after=i.after.__data
        if(!i.before){
          lv1[i.logdate.toISOString()]={"logtype":"orderitem","orderitemID":i.orderitemId,"msg":"orderitem created"};
          //result.push(lv1);
        }else{
          var before=i.before.__data;
          lv2={"logtype":"orderitem","orderitemID":i.orderitemId}
          for(var key in before){
            if(typeof before[key]!=="object"){
              if(after[key]!==before[key]){
                var ologdata={};
                lv2[key]={"b":before[key],"a":after[key]}
              }
            }
          }
          lv1[i.logdate.toISOString()]=lv2;
          //result.push(lv1)
        }
      })
      //sorting lv1 object 
      var datekeys=[]
      for(datekey in lv1){
        datekeys.push(datekey);
      }
      var date_sort_asc = function (date1, date2) {
        if (date1 > date2) return 1;
        if (date1 < date2) return -1;
        return 0;
      }
      var result={}
      var sortkeys=datekeys.sort(date_sort_asc);
      sortkeys.forEach(function(key){
        result[key]=lv1[key]
      })
      next(null,result)
    })
  }

  Order.disableRemoteMethod("upsert",true);
  Order.disableRemoteMethod("updateAttributes",false);
  Order.disableRemoteMethod("deleteById",true);
  Order.disableRemoteMethod("__create__billing",false);
  Order.disableRemoteMethod("__destroy__billing",false);
  Order.disableRemoteMethod("__create__customer",false);
  Order.disableRemoteMethod("__destroy__customer",false);
  Order.disableRemoteMethod("__create__discount",false);
  Order.disableRemoteMethod("__destroy__discount",false);
  Order.disableRemoteMethod("__create__paymode",false);
  Order.disableRemoteMethod("__destroy__paymode",false);
  Order.disableRemoteMethod("__create__shipping",false);
  Order.disableRemoteMethod("__destroy__shipping",false);
  Order.disableRemoteMethod("__create__value",false);
  Order.disableRemoteMethod("__update__value",false);
  Order.disableRemoteMethod("__destroy__value",false);
  Order.disableRemoteMethod("__delete__orderitems",false);
  Order.disableRemoteMethod("__findById__orderitems",false);
  Order.disableRemoteMethod("__updateById__orderitems",false);
  Order.disableRemoteMethod("__delete__orderitemlogs",false);
  Order.disableRemoteMethod("__create__orderitemlogs",false);
  Order.disableRemoteMethod("__updateById__orderitemlogs",false);
  Order.disableRemoteMethod("__destroyById__orderitemlogs",false);
  Order.disableRemoteMethod("__create__orderlogs",false);
  Order.disableRemoteMethod("__delete__orderlogs",false);
  Order.disableRemoteMethod("__updateById__orderlogs",false);
  Order.disableRemoteMethod("__destroyById__orderlogs",false);
  Order.disableRemoteMethod("__delete__shipments",false);
  Order.disableRemoteMethod("__findById__shipments",false);
  Order.disableRemoteMethod("__updateById__shipments",false);
  Order.disableRemoteMethod("__destroyById__shipments",false);
  Order.disableRemoteMethod("__delete__transactions",false);
  Order.disableRemoteMethod("__findById__transactions",false);
  Order.disableRemoteMethod("__updateById__transactions",false);
  Order.disableRemoteMethod("__destroyById__transactions",false);
  Order.disableRemoteMethod("createChangeStream",true);
  Order.disableRemoteMethod("createChangeStream__0",true);
};
