module.exports = function(Transaction) {

  Transaction.disableRemoteMethod('find',true);
  Transaction.disableRemoteMethod('upsert',true);
  Transaction.disableRemoteMethod('create',true);
  Transaction.disableRemoteMethod('updateAttributes',false);
  Transaction.disableRemoteMethod('deleteById',true);
  Transaction.disableRemoteMethod('__create__billing',false);
  Transaction.disableRemoteMethod('__destroy__billing',false);
  Transaction.disableRemoteMethod('__update__ccards',false);
  Transaction.disableRemoteMethod('__destroy__ccards',false);
  Transaction.disableRemoteMethod('__create__transactionlogs',false);
  Transaction.disableRemoteMethod('__delete__transactionlogs',false);
  Transaction.disableRemoteMethod('__updateById__transactionlogs',false);
  Transaction.disableRemoteMethod('__destroyById__transactionlogs',false);
  Transaction.disableRemoteMethod('createChangeStream',true);
  Transaction.disableRemoteMethod('createChangeStream__0',true);
  Transaction.disableRemoteMethod('updateAll',true);
//before save mark bookdate and completedate
  Transaction.observe('before save', function upDates(ctx,next) {
    //ctx.hookState.before=ctx.currentInstance;
    if(ctx.data && ctx.data.status){
    //To do: Need to check proper validation and valid status and code
    var valids=["pending","cancel","success"];
    var status=ctx.data.status;
      if(valids.indexOf(status)==-1){
        var err=new Error("invalid status code");err.status=403;
        return next(err);
      }
      if(ctx.data.status==="success") ctx.data.completedate = new Date();
    }
    if(ctx.instance && ctx.instance.status==="success") ctx.instance.completedate = new Date();
    ctx.hookState.ostatus=(ctx.currentInstance)?ctx.currentInstance.status:"";
    if (ctx.data && ctx.data.status){
      ctx.data.statusdate=new Date();
    }
    //if new instance take billing and orderid from order. 
    //if order txn set paymode.mode to txn.mode
    if(ctx.isNewInstance){
      ctx.instance.bookdate = new Date();
      ctx.instance.created = new Date();
      ctx.instance.unsetAttribute('id');
      ctx.instance.status = "pending";
      if(!ctx.instance.txnreqdata)
        ctx.instance.txnreqdata={};
      if(!ctx.instance.txnresdata)
        ctx.instance.txnresdata={};
      Transaction.app.models.Order.findById(ctx.instance.orderId, function(err, order){
        ctx.instance._billing=order._billing;
        ctx.instance.orderid=order.orderid;
        ctx.instance.paymode=order._paymode.mode;
        //check only valid txn modes are supplied.
        //check if we need to update order values related to payment success.
        console.log("ctx.instance before txn save",ctx.instance);
        next();
      });
    }else{
      if(ctx.currentInstance){
        var before={};
        var ci=ctx.currentInstance;
        for(var key in ci.__data){
          if(ci.__data.hasOwnProperty(key)){
            before[key]=ci.__data[key]
          }
        }
      }
      ctx.hookState.before=before;
      next();
    }
  });

  Transaction.observe('after save', function updateOrder(ctx,next) {
    var ostatus=ctx.hookState.ostatus;
    var nstatus=ctx.instance.status;
    var orderstatus="";

    if(ostatus!=nstatus && nstatus==="success"){
      Transaction.app.models.order.findById(ctx.instance.orderId, {"include":"transactions"},function(err,o){
        if(err) next(err);
        var txnvalue=0;
        o.transactions().forEach(function(txn){
          if(txn.code=='bill' && txn.status=='success'){
            txnvalue=Number((txnvalue+txn.txnvalue).toFixed(2));
          }else if(txn.code=='refund' && txn.status=='success'){
            txnvalue=Number((txnvalue-txn.txnvalue).toFixed(2));
          }
        })
        o.value.update({"txntotal":txnvalue},function(err,t){
          console.log(err);
        })
      })
    }
    //transactionlog 
    var before=ctx.hookState.before;var after=ctx.instance;
    ctx.instance.transactionlogs.create({"before":before,"after":after,logdate:new Date()},
        function(err,instance){
          if(err) next(err);
        });
    next();
  });

  Transaction.remoteMethod(
    "status",
    {
      http: {path: '/:id/status', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'status', type: 'string', required: true},
        {arg: 'txnreqdata', type: 'object', required: false},
        {arg: 'txnresdata', type: 'object', required: false},
      ],
      returns: {root: true, type: 'object'},
      description: 'update transaction status'
    }
  );
  Transaction.status=function(id,status,txnreqdata,txnresdata,next) {
    var tObj={};
    Transaction.findById(id,function(err,txn){
      if(err) next(err);
      else{
        if(txn.status!="pending"||status=="pending")
          tObj={"txnreqdata":txnreqdata,"txnresdata":txnresdata};
        else
          tObj={"status":status,"txnreqdata":txnreqdata,"txnresdata":txnresdata}
        txn.updateAttributes(tObj,function(err, instance){
          if(err) next(err);
          else next(null,instance);
        });
      }
    });
  }

  Transaction.remoteMethod(
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
  Transaction.history = function(id,next){
    var lv1={};
    Transaction.findById(id,{"include":"transactionlogs"}, function(err,t){
      if(err) next(err);
      else if(t.transactionlogs().length){
        t.transactionlogs().forEach(function(i){
          var lv2={};
          var after=i.after.__data;
          if(!i.before){
            lv1[i.logdate.toISOString()]={"msg":"transaction created"};
          }else{
            var before=i.before.__data;
            for(var key in after){
              if(typeof after[key]!=="object"){
                if(before[key]===undefined){
                  lv2[key]={"a":after[key]}
                }else if(after[key]!==before[key]){
                  lv2[key]={"b":before[key],"a":after[key]}
                }
              }else{
                if(key=="txnresdata"|| key=="txnreqdata"){
                  var bObj="";
                  if(before[key]!==undefined)
                    bObj=before[key];
                  var aObj=after[key];
                  for(var key2 in aObj){
                    if(typeof aObj[key2]!=="object"){
                      if(bObj[key2]===undefined)
                        lv2[key+"."+key2]={"a":aObj[key2]}
                      else if(aObj[key2]!==bObj[key2]){
                        lv2[key+"."+key2]={"b":bObj[key2],"a":aObj[key2]}
                      }
                    }else{
                      var a2Obj=aObj[key2]
                      var b2Obj="";
                      if(bObj[key2]!==undefined)
                        b2Obj=bObj[key2]
                      for(var key3 in a2Obj){
                        if(b2Obj[key3]===undefined)
                          lv2[key+"."+key2+"."+key3]={"a":a2Obj[key3]}
                        else if(a2Obj[key3]!==b2Obj[key3])
                          lv2[key+"."+key2+"."+key3]={"b":b2Obj[key3],"a":a2Obj[key3]}
                      }
                    }
                  }
                }
                if(key=="statusdate"){
                  var bObj=before["statusdate"];
                  var aObj=after["statusdate"];
                  var bdate= bObj.getTime();
                  var adate= aObj.getTime();
                  if(bdate!=adate)
                    lv2[key]={"b":bObj,"a":aObj}
                }
              }
            }
            lv1[i.logdate.toISOString()]=lv2;
          }
        });
      }
      next(null,lv1)
    })
  }
};
